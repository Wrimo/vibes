"""Address -> coordinates, via Nominatim (OpenStreetMap).

Nominatim's usage policy caps us at 1 request/second and requires an
identifying User-Agent. `Fetcher` handles both, and results are cached on disk
for a month, since a street address does not move.
"""

from __future__ import annotations

import logging
import re

from ..net import Fetcher, FetchError

log = logging.getLogger(__name__)

GEOCODE_CACHE_TTL = 30 * 24 * 3600  # a month

# Craigslist and friends often only give a cross street or a partial address.
_UNUSABLE = re.compile(
    r"^\s*(near|around|close to)?\s*(nashville|tn|tennessee|usa)?\s*$", re.I
)


class Geocoder:
    def __init__(self, fetcher: Fetcher, base_url: str, city_hint: str = "Nashville, TN"):
        self.fetcher = fetcher
        self.base_url = base_url.rstrip("/")
        self.city_hint = city_hint

    def geocode(self, address: str) -> tuple[float, float, str] | None:
        """Return (lat, lon, precision) or None.

        `precision` mirrors Nominatim's osm_type/class so the scorer can
        discount a listing that only resolved to a whole neighborhood.
        """
        if not address or _UNUSABLE.match(address):
            return None

        query = address
        if "nashville" not in address.lower() and "tn" not in address.lower():
            query = f"{address}, {self.city_hint}"

        try:
            results = self.fetcher.get_json(
                f"{self.base_url}/search",
                params={
                    "q": query,
                    "format": "jsonv2",
                    "limit": 1,
                    "countrycodes": "us",
                    "addressdetails": 1,
                },
                cache_ttl=GEOCODE_CACHE_TTL,
            )
        except FetchError as exc:
            log.warning("geocode failed for %r: %s", address, exc)
            return None

        if not results:
            return None

        hit = results[0]
        try:
            lat, lon = float(hit["lat"]), float(hit["lon"])
        except (KeyError, TypeError, ValueError):
            return None

        if not _in_middle_tennessee(lat, lon):
            log.debug("geocode for %r landed outside the metro: %s,%s", address, lat, lon)
            return None

        precision = _precision_of(hit)
        return lat, lon, precision


def _precision_of(hit: dict) -> str:
    """Coarse label: 'address' (rooftop-ish), 'street', or 'area'."""
    category = hit.get("category") or hit.get("class") or ""
    typ = hit.get("type") or ""
    if category == "place" and typ in {"house", "building"}:
        return "address"
    if hit.get("address", {}).get("house_number"):
        return "address"
    if category == "highway":
        return "street"
    return "area"


def _in_middle_tennessee(lat: float, lon: float) -> bool:
    """Sanity box around the Nashville metro — catches geocoder hallucinations
    like resolving 'Charlotte Ave' to Charlotte, NC."""
    return 35.4 <= lat <= 36.7 and -87.6 <= lon <= -86.0
