"""Map a coordinate (or a source's free-text area string) to a neighborhood.

Two backends, in priority order:
  1. Real GeoJSON polygons, if `neighborhoods.geojson_path` is configured.
  2. The bundled centroid+radius approximation in `data/neighborhoods.json`.

Both expose the same `classify()` signature, so the scorer neither knows nor
cares which one is in play.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from pathlib import Path

from .distance import haversine_m, point_in_geometry

# A point this far outside every circle is still attributed to the nearest one,
# flagged as approximate. Beyond it, we return unknown rather than guess.
_SLOP = 1.75


@dataclass(frozen=True)
class NeighborhoodMatch:
    name: str
    exact: bool
    distance_m: float | None = None


@dataclass
class Circle:
    name: str
    lat: float
    lon: float
    radius_m: float


class NeighborhoodIndex:
    def __init__(
        self,
        circles: list[Circle],
        aliases: dict[str, str],
        polygons: list[dict] | None = None,
    ) -> None:
        self.circles = sorted(circles, key=lambda c: c.radius_m)
        self.aliases = aliases
        self.polygons = polygons or []
        self._by_slug = {_slug(c.name): c.name for c in circles}
        for alias, target in aliases.items():
            self._by_slug.setdefault(_slug(alias), target)

    # ---- construction ------------------------------------------------------

    @classmethod
    def load(cls, geojson_path: str | Path | None = None) -> "NeighborhoodIndex":
        raw = json.loads(
            resources.files("nashrent.data")
            .joinpath("neighborhoods.json")
            .read_text()
        )
        circles = [
            Circle(n["name"], n["lat"], n["lon"], float(n["radius_m"]))
            for n in raw["neighborhoods"]
        ]
        aliases = raw.get("aliases", {})

        polygons: list[dict] = []
        if geojson_path:
            path = Path(geojson_path)
            if path.exists():
                fc = json.loads(path.read_text())
                for feat in fc.get("features", []):
                    props = feat.get("properties") or {}
                    name = (
                        props.get("name")
                        or props.get("NAME")
                        or props.get("neighborhood")
                    )
                    if name and feat.get("geometry"):
                        polygons.append({"name": name, "geometry": feat["geometry"]})
        return cls(circles, aliases, polygons)

    # ---- lookup ------------------------------------------------------------

    def classify(self, lat: float, lon: float) -> NeighborhoodMatch | None:
        """Point -> neighborhood."""
        for poly in self.polygons:
            if point_in_geometry(lat, lon, poly["geometry"]):
                return NeighborhoodMatch(poly["name"], exact=True, distance_m=0.0)

        # Circles are radius-sorted, so the first containing circle is the
        # tightest — 'Sylvan Park' beats the broad 'West Nashville' catch-all.
        best_near: tuple[float, Circle] | None = None
        for c in self.circles:
            d = haversine_m(lat, lon, c.lat, c.lon)
            if d <= c.radius_m:
                return NeighborhoodMatch(c.name, exact=True, distance_m=round(d, 1))
            slack = d - c.radius_m
            if d <= c.radius_m * _SLOP and (best_near is None or slack < best_near[0]):
                best_near = (slack, c)

        if best_near is not None:
            return NeighborhoodMatch(
                best_near[1].name, exact=False, distance_m=round(best_near[0], 1)
            )
        return None

    def resolve_name(self, text: str | None) -> str | None:
        """Normalize a source's free-text area blurb to a canonical name.

        Craigslist gives us things like '(Sylvan Park / West Nashville)'.
        """
        if not text:
            return None
        cleaned = text.strip().strip("()").strip()
        candidates = [cleaned] + re.split(r"[/,|·-]| in | near ", cleaned)
        for cand in candidates:
            s = _slug(cand)
            if not s:
                continue
            if s in self._by_slug:
                return self._by_slug[s]
        # Substring fallback: '2br house in sylvan park!' -> Sylvan Park.
        # Longest names first so 'Belmont-Hillsboro' wins over 'Belmont'.
        blob = _slug(cleaned)
        for slug, name in sorted(
            self._by_slug.items(), key=lambda kv: -len(kv[0])
        ):
            if len(slug) >= 6 and slug in blob:
                return name
        return None

    def centroid(self, name: str) -> tuple[float, float] | None:
        want = _slug(name)
        for c in self.circles:
            if _slug(c.name) == want:
                return c.lat, c.lon
        return None


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


@lru_cache(maxsize=8)
def get_index(geojson_path: str | None = None) -> NeighborhoodIndex:
    return NeighborhoodIndex.load(geojson_path)
