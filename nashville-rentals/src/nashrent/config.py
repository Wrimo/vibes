"""Configuration loading.

The whole search profile lives in one YAML file so tuning the hunt never
requires touching code. `Config.load()` merges the user's file over the
built-in defaults, so a short config file stays valid as the schema grows.
"""

from __future__ import annotations

import os
import re
from datetime import date
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

DEFAULT_CONFIG_PATH = Path("config/search.yaml")


class Anchor(BaseModel):
    """A place you need to get to regularly (an office, a gym, a partner's work)."""

    name: str
    lat: float
    lon: float
    mode: str = "driving"
    max_minutes: float | None = None  # soft ceiling; over this bleeds points
    weight: float = 1.0


class BudgetConfig(BaseModel):
    max_price: int = 2500
    # Listings between max_price and stretch_price survive but lose points,
    # because a great house at $2,650 is worth seeing.
    stretch_price: int = 2800
    min_price: int = 900


class RequirementsConfig(BaseModel):
    min_beds: float = 2
    min_baths: float = 1
    min_sqft: int | None = None
    # Hosting: not a hard gate by default, but drives the hosting score.
    hosting_target_sqft: int = 1500
    exclude_home_types: list[str] = Field(default_factory=list)
    require_types: list[str] = Field(default_factory=list)
    pets_required: bool = False
    target_move_in: date | None = None
    move_in_window_days: int = 45


class NeighborhoodConfig(BaseModel):
    """Tiered preference. Tier names map to scores in `tier_scores`."""

    tiers: dict[str, list[str]] = Field(default_factory=dict)
    tier_scores: dict[str, float] = Field(default_factory=dict)
    blocklist: list[str] = Field(default_factory=list)
    unknown_score: float = 0.45
    # Optional path to a GeoJSON FeatureCollection of real neighborhood
    # polygons; overrides the bundled centroid+radius approximation.
    geojson_path: str | None = None


class WeightsConfig(BaseModel):
    """Weights are relative — they get normalized to 100 points total."""

    neighborhood: float = 18
    hosting_space: float = 18
    commute: float = 16
    price_value: float = 12
    walkability: float = 12
    home_type: float = 10
    dining_nightlife: float = 8
    safety: float = 6


class SourceConfig(BaseModel):
    enabled: bool = False
    options: dict[str, Any] = Field(default_factory=dict)


class EnrichConfig(BaseModel):
    enabled: bool = True
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    osrm_url: str = "https://router.project-osrm.org"
    socrata_domain: str = "data.nashville.gov"
    socrata_dataset: str = "2u6v-ujjs"  # MNPD Incidents (public)
    socrata_app_token: str | None = None
    safety_radius_m: int = 800
    safety_lookback_days: int = 365
    providers: list[str] = Field(
        default_factory=lambda: ["geocode", "amenities", "commute", "safety"]
    )
    max_enrich_per_run: int = 60


class NetConfig(BaseModel):
    user_agent: str = (
        "nashrent/0.1 (personal rental search; +https://github.com/wrimo/vibes)"
    )
    contact_email: str | None = None
    request_timeout: float = 25.0
    per_host_delay: float = 1.5
    max_retries: int = 3
    respect_robots: bool = True
    cache_dir: str = "var/http-cache"
    cache_ttl_seconds: int = 3600
    proxy: str | None = None


class NotifyConfig(BaseModel):
    enabled: bool = False
    min_score: float = 70
    only_new: bool = True
    webhook_url: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_user: str | None = None
    smtp_password_env: str = "NASHRENT_SMTP_PASSWORD"
    email_to: list[str] = Field(default_factory=list)
    email_from: str | None = None


class Config(BaseModel):
    city: str = "Nashville, TN"
    db_path: str = "var/nashrent.sqlite3"
    report_dir: str = "reports"

    budget: BudgetConfig = Field(default_factory=BudgetConfig)
    requirements: RequirementsConfig = Field(default_factory=RequirementsConfig)
    neighborhoods: NeighborhoodConfig = Field(default_factory=NeighborhoodConfig)
    anchors: list[Anchor] = Field(default_factory=list)
    weights: WeightsConfig = Field(default_factory=WeightsConfig)
    sources: dict[str, SourceConfig] = Field(default_factory=dict)
    enrich: EnrichConfig = Field(default_factory=EnrichConfig)
    net: NetConfig = Field(default_factory=NetConfig)
    notify: NotifyConfig = Field(default_factory=NotifyConfig)

    # ---- resolution helpers -------------------------------------------------

    def anchor(self, name: str) -> Anchor | None:
        return next((a for a in self.anchors if a.name == name), None)

    def normalized_weights(self) -> dict[str, float]:
        """Scale configured weights so the maximum possible score is 100."""
        raw = self.weights.model_dump()
        total = sum(v for v in raw.values() if v > 0)
        if total <= 0:
            raise ValueError("weights must sum to a positive number")
        return {k: (v / total) * 100 for k, v in raw.items()}

    def tier_of(self, neighborhood: str | None) -> tuple[str | None, float]:
        """Map a neighborhood name to (tier_name, 0..1 score)."""
        if not neighborhood:
            return None, self.neighborhoods.unknown_score
        want = _slug(neighborhood)
        for tier, names in self.neighborhoods.tiers.items():
            if any(_slug(n) == want for n in names):
                return tier, self.neighborhoods.tier_scores.get(tier, 0.5)
        return None, self.neighborhoods.unknown_score

    def is_blocked(self, neighborhood: str | None) -> bool:
        if not neighborhood:
            return False
        want = _slug(neighborhood)
        return any(_slug(n) == want for n in self.neighborhoods.blocklist)

    @classmethod
    def load(cls, path: str | Path | None = None) -> "Config":
        path = Path(path) if path else DEFAULT_CONFIG_PATH
        if not path.exists():
            raise FileNotFoundError(
                f"config not found at {path} — copy config/search.yaml.example "
                f"or pass --config"
            )
        with path.open() as fh:
            data = yaml.safe_load(fh) or {}
        data = _expand_env(data)
        return cls.model_validate(data)


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def _expand_env(obj: Any) -> Any:
    """Expand ${VAR} references so secrets stay out of the YAML file."""
    if isinstance(obj, dict):
        return {k: _expand_env(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_expand_env(v) for v in obj]
    if isinstance(obj, str):
        return re.sub(
            r"\$\{(\w+)\}", lambda m: os.environ.get(m.group(1), ""), obj
        )
    return obj
