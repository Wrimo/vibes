"""Neighborhood incident rates from Metro Nashville's official open data.

Source: MNPD Incidents, published by Metro Nashville Government on
data.nashville.gov under the Socrata Open Data API.

Two things this module deliberately does NOT do:

  * It does not produce a "good area / bad area" label. It reports a count of
    reported incidents per year within a radius, and a percentile relative to
    other Nashville neighborhoods. That's a measurable quantity with a public,
    citable source.
  * It does not use demographic data of any kind.

Two honest caveats, surfaced in the report rather than buried here:

  * Counts are *reported incidents*, which reflect reporting and patrol
    patterns as much as underlying risk.
  * Raw counts are inflated wherever the daytime population dwarfs the
    residential one. Downtown, Green Hills mall, and Midtown all look worse
    per-resident than they feel to someone living there. This is why safety
    carries the smallest weight in the default profile (6 of 100 points).
"""

from __future__ import annotations

import logging
from statistics import median

from ..models import Enrichment
from ..net import Fetcher, FetchError

log = logging.getLogger(__name__)

SAFETY_CACHE_TTL = 7 * 24 * 3600

# Reference points used to build the metro baseline distribution. Kept small
# and residential-leaning so the percentile compares like with like.
_BASELINE_POINTS = [
    (36.1497, -86.8361),  # Sylvan Park
    (36.1660, -86.8480),  # The Nations
    (36.1047, -86.8158),  # Green Hills
    (36.1250, -86.7990),  # Belmont-Hillsboro
    (36.1230, -86.7890),  # 12 South
    (36.1780, -86.7370),  # Lockeland Springs
    (36.1790, -86.7900),  # Germantown
    (36.1400, -86.7700),  # Wedgewood-Houston
    (36.2100, -86.7280),  # Inglewood
    (36.1180, -86.8930),  # West Meade
    (36.0700, -86.9300),  # Bellevue
    (36.1700, -86.6700),  # Donelson
]


class SafetyProvider:
    name = "safety"

    def __init__(
        self,
        fetcher: Fetcher,
        domain: str,
        dataset: str,
        app_token: str | None = None,
        radius_m: int = 800,
        lookback_days: int = 365,
        location_field: str = "mapped_location",
        date_field: str = "incident_occurred",
    ):
        self.fetcher = fetcher
        self.domain = domain.strip("/")
        self.dataset = dataset
        self.app_token = app_token or None
        self.radius_m = radius_m
        self.lookback_days = lookback_days
        self.location_field = location_field
        self.date_field = date_field
        self._baseline: list[float] | None = None

    # ---- public API --------------------------------------------------------

    def enrich(self, lat: float, lon: float, into: Enrichment) -> bool:
        count = self.incident_count(lat, lon)
        if count is None:
            return False

        per_year = count * (365.0 / max(self.lookback_days, 1))
        # Normalize to a per-1000-residents-ish figure using the circle area.
        # We don't have real population per circle, so this is per km^2 scaled
        # to a 1k-resident-equivalent at Nashville's ~1,600/km^2 urban density.
        area_km2 = 3.14159 * (self.radius_m / 1000.0) ** 2
        per_1k = (per_year / area_km2) / 1.6 if area_km2 else per_year

        into.incidents_per_1k_year = round(per_1k, 1)
        into.safety_sample_size = int(count)

        baseline = self._get_baseline()
        if baseline:
            below = sum(1 for b in baseline if b > per_1k)
            # Higher percentile == fewer incidents than peers.
            into.safety_percentile = round(100.0 * below / len(baseline), 1)
        return True

    def incident_count(self, lat: float, lon: float) -> int | None:
        """Reported incidents within `radius_m` over the lookback window."""
        where = (
            f"within_circle({self.location_field}, {lat:.6f}, {lon:.6f}, {self.radius_m}) "
            f"AND {self.date_field} > '{self._cutoff_iso()}'"
        )
        params = {"$select": "count(1) AS n", "$where": where}
        if self.app_token:
            params["$$app_token"] = self.app_token

        url = f"https://{self.domain}/resource/{self.dataset}.json"
        try:
            rows = self.fetcher.get_json(url, params=params, cache_ttl=SAFETY_CACHE_TTL)
        except FetchError as exc:
            log.warning("socrata query failed at %s,%s: %s", lat, lon, exc)
            return None

        if not rows:
            return 0
        try:
            return int(rows[0].get("n", 0))
        except (TypeError, ValueError):
            return None

    # ---- baseline ----------------------------------------------------------

    def _get_baseline(self) -> list[float]:
        """Per-1k incident rates at reference points, for percentile ranking.

        Computed once per process and cached on disk by the fetcher, so the
        cost is a dozen requests on the very first run and zero after that.
        """
        if self._baseline is not None:
            return self._baseline

        area_km2 = 3.14159 * (self.radius_m / 1000.0) ** 2
        rates: list[float] = []
        for blat, blon in _BASELINE_POINTS:
            n = self.incident_count(blat, blon)
            if n is None:
                continue
            per_year = n * (365.0 / max(self.lookback_days, 1))
            rates.append((per_year / area_km2) / 1.6 if area_km2 else per_year)

        # Fewer than half the reference points responding means the dataset
        # schema probably changed; better to report nothing than nonsense.
        self._baseline = rates if len(rates) >= len(_BASELINE_POINTS) // 2 else []
        if self._baseline:
            log.info(
                "safety baseline: n=%d median=%.1f incidents/1k/yr",
                len(self._baseline),
                median(self._baseline),
            )
        return self._baseline

    def _cutoff_iso(self) -> str:
        from datetime import datetime, timedelta, timezone

        cutoff = datetime.now(timezone.utc) - timedelta(days=self.lookback_days)
        # Socrata floating timestamps take no zone suffix.
        return cutoff.strftime("%Y-%m-%dT%H:%M:%S")
