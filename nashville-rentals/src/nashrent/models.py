"""Canonical data model.

Every source adapter normalizes into `Listing`. Everything downstream — dedupe,
enrichment, scoring, reporting — only ever sees a `Listing`, so adding a source
never touches the rest of the pipeline.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator


class HomeType(str, Enum):
    """Physical form of the unit.

    Ordered loosely from "stand alone house" to "unit in a big building",
    which is the axis the scorer cares about.
    """

    HOUSE = "house"
    TOWNHOUSE = "townhouse"
    DUPLEX = "duplex"
    CONDO = "condo"
    APARTMENT = "apartment"
    UNKNOWN = "unknown"

    @property
    def standalone_rank(self) -> float:
        """1.0 == detached single-family, 0.0 == unit in an apartment complex."""
        return {
            HomeType.HOUSE: 1.0,
            HomeType.DUPLEX: 0.72,
            HomeType.TOWNHOUSE: 0.62,
            HomeType.CONDO: 0.35,
            HomeType.APARTMENT: 0.10,
            HomeType.UNKNOWN: 0.40,
        }[self]


class ListingStatus(str, Enum):
    """User-managed triage state, persisted across runs."""

    NEW = "new"
    SEEN = "seen"
    INTERESTED = "interested"
    APPLIED = "applied"
    REJECTED = "rejected"
    GONE = "gone"


class Geo(BaseModel):
    """Resolved location for a listing."""

    lat: float | None = None
    lon: float | None = None
    neighborhood: str | None = None
    neighborhood_tier: str | None = None
    geocode_precision: str | None = None
    geocode_source: str | None = None

    @property
    def has_point(self) -> bool:
        return self.lat is not None and self.lon is not None


class Enrichment(BaseModel):
    """Facts gathered about a location from third-party APIs.

    All fields optional: enrichment is best-effort and every scorer degrades
    gracefully when a provider is down or disabled.
    """

    # Commute (minutes, driving, free-flow unless the provider gives traffic)
    commute_downtown_min: float | None = None
    commute_partner_min: float | None = None

    # Amenities within the configured radii (counts)
    parks_within_1km: int | None = None
    nearest_park_m: float | None = None
    nearest_park_name: str | None = None
    greenway_within_1km: bool | None = None

    bars_within_1200m: int | None = None
    restaurants_within_1200m: int | None = None
    cafes_within_1200m: int | None = None
    grocery_within_1600m: int | None = None

    # Walkability proxy inputs
    intersection_density: float | None = None
    sidewalk_ratio: float | None = None
    walk_amenity_count: int | None = None

    # Safety (official Metro Nashville PD incident data)
    incidents_per_1k_year: float | None = None
    safety_percentile: float | None = None
    safety_sample_size: int | None = None

    enriched_at: datetime | None = None
    providers_ok: list[str] = Field(default_factory=list)
    providers_failed: list[str] = Field(default_factory=list)


class ScoreComponent(BaseModel):
    """One weighted line item in the final score."""

    name: str
    raw: float | None
    normalized: float  # 0..1
    weight: float
    points: float
    note: str = ""


class Score(BaseModel):
    total: float = 0.0
    components: list[ScoreComponent] = Field(default_factory=list)
    hard_fails: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    coverage: float = 1.0  # fraction of weight that had real data

    @property
    def passed(self) -> bool:
        return not self.hard_fails

    def component(self, name: str) -> ScoreComponent | None:
        return next((c for c in self.components if c.name == name), None)


class Listing(BaseModel):
    """A rental unit as seen at a point in time."""

    # Identity
    source: str
    source_id: str
    url: str

    # Core facts
    title: str = ""
    price: int | None = None
    beds: float | None = None
    baths: float | None = None
    sqft: int | None = None
    home_type: HomeType = HomeType.UNKNOWN

    # Location
    address: str | None = None
    raw_area: str | None = None  # source's own neighborhood string
    zipcode: str | None = None
    geo: Geo = Field(default_factory=Geo)

    # Detail
    description: str = ""
    amenities: list[str] = Field(default_factory=list)
    photos: list[str] = Field(default_factory=list)
    available_date: date | None = None
    pets_allowed: bool | None = None
    laundry: str | None = None
    parking: str | None = None

    # Bookkeeping
    posted_at: datetime | None = None
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    status: ListingStatus = ListingStatus.NEW
    notes: str = ""

    enrichment: Enrichment = Field(default_factory=Enrichment)
    score: Score = Field(default_factory=Score)
    raw: dict[str, Any] = Field(default_factory=dict)

    @field_validator("price", mode="before")
    @classmethod
    def _clean_price(cls, v: Any) -> Any:
        """Accept '$2,450/mo', '2450.00', 2450 — reject nonsense."""
        if v is None or isinstance(v, int):
            return v
        if isinstance(v, float):
            return int(v)
        digits = re.sub(r"[^\d.]", "", str(v))
        if not digits:
            return None
        try:
            return int(float(digits))
        except ValueError:
            return None

    @field_validator("beds", mode="before")
    @classmethod
    def _clean_beds(cls, v: Any) -> Any:
        """'2br' -> 2.0, 'studio' -> 0.0."""
        if v is None or isinstance(v, (int, float)):
            return v
        s = str(v).strip().lower()
        if "studio" in s or s in {"efficiency", "0br"}:
            return 0.0
        m = re.search(r"(\d+(?:\.\d+)?)", s)
        return float(m.group(1)) if m else None

    @field_validator("sqft", mode="before")
    @classmethod
    def _clean_sqft(cls, v: Any) -> Any:
        if v is None or isinstance(v, int):
            return v
        digits = re.sub(r"[^\d]", "", str(v))
        val = int(digits) if digits else None
        # Guard against a source handing us lot size or a bogus 3-digit value.
        if val is not None and not (150 <= val <= 20000):
            return None
        return val

    @property
    def key(self) -> str:
        """Stable per-source primary key."""
        return f"{self.source}:{self.source_id}"

    @property
    def fingerprint(self) -> str:
        """Cross-source identity hash, used to collapse the same house
        listed on Zillow and Craigslist at once.

        Deliberately coarse: normalized street address + bed count + price
        rounded to $50. Address-free listings fall back to their own key so
        they never merge with anything.
        """
        if not self.address:
            return hashlib.sha1(self.key.encode()).hexdigest()[:16]
        street = normalize_address(self.address)
        beds = int(self.beds) if self.beds is not None else -1
        bucket = round(self.price / 50) if self.price else -1
        return hashlib.sha1(f"{street}|{beds}|{bucket}".encode()).hexdigest()[:16]

    @property
    def price_per_sqft(self) -> float | None:
        if self.price and self.sqft:
            return round(self.price / self.sqft, 3)
        return None

    def touch(self, now: datetime | None = None) -> None:
        now = now or datetime.now(timezone.utc)
        self.first_seen = self.first_seen or now
        self.last_seen = now


_STREET_SUFFIXES = {
    "street": "st", "st": "st",
    "avenue": "ave", "av": "ave", "ave": "ave",
    "road": "rd", "rd": "rd",
    "drive": "dr", "dr": "dr",
    "boulevard": "blvd", "blvd": "blvd",
    "lane": "ln", "ln": "ln",
    "court": "ct", "ct": "ct",
    "place": "pl", "pl": "pl",
    "circle": "cir", "cir": "cir",
    "terrace": "ter", "ter": "ter",
    "parkway": "pkwy", "pkwy": "pkwy",
    "highway": "hwy", "hwy": "hwy",
    "pike": "pike",
}

_DIRECTIONS = {
    "north": "n", "south": "s", "east": "e", "west": "w",
    "northeast": "ne", "northwest": "nw",
    "southeast": "se", "southwest": "sw",
}


def normalize_address(addr: str) -> str:
    """Canonicalize a US street address enough for equality comparison.

    '1802 South Wilson Blvd., Nashville, TN 37212' and '1802 S Wilson Boulevard'
    both collapse to '1802 s wilson blvd'. Unit designators are dropped, since
    sources disagree wildly about how to render them.
    """
    s = addr.lower().strip()
    s = s.split(",")[0]  # drop city/state/zip
    s = re.sub(r"\b(apt|unit|ste|suite|#)\s*[\w-]+", " ", s)
    s = re.sub(r"[^\w\s]", " ", s)
    tokens = [t for t in s.split() if t]
    out: list[str] = []
    for tok in tokens:
        tok = _DIRECTIONS.get(tok, tok)
        tok = _STREET_SUFFIXES.get(tok, tok)
        out.append(tok)
    return " ".join(out)
