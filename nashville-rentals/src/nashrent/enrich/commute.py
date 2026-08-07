"""Drive times to your anchors, via OSRM.

The public OSRM demo server routes on free-flow speeds — it has no traffic
model — so treat these as a consistent *relative* ranking rather than a
promise about 8am on I-440. Nashville rush hour typically adds 30-60% to
these numbers; `RUSH_HOUR_MULTIPLIER` makes that adjustment explicit and
tunable rather than hidden.
"""

from __future__ import annotations

import logging

from ..models import Enrichment
from ..net import Fetcher, FetchError

log = logging.getLogger(__name__)

COMMUTE_CACHE_TTL = 14 * 24 * 3600
RUSH_HOUR_MULTIPLIER = 1.45


class CommuteProvider:
    name = "commute"

    def __init__(self, fetcher: Fetcher, osrm_url: str, anchors: list):
        self.fetcher = fetcher
        self.osrm_url = osrm_url.rstrip("/")
        self.anchors = anchors

    def enrich(self, lat: float, lon: float, into: Enrichment) -> bool:
        ok = False
        for anchor in self.anchors:
            minutes = self._route_minutes(lat, lon, anchor.lat, anchor.lon, anchor.mode)
            if minutes is None:
                continue
            ok = True
            # Anchor names are free-form in config; map the two well-known
            # roles onto the model, and ignore extras (they still contribute
            # via `commute_minutes_by_anchor` in the scorer).
            if "downtown" in anchor.name.lower():
                into.commute_downtown_min = minutes
            elif "partner" in anchor.name.lower() or "green" in anchor.name.lower():
                into.commute_partner_min = minutes
        return ok

    def route_all(self, lat: float, lon: float) -> dict[str, float]:
        """Minutes to every configured anchor, keyed by anchor name."""
        out: dict[str, float] = {}
        for anchor in self.anchors:
            minutes = self._route_minutes(lat, lon, anchor.lat, anchor.lon, anchor.mode)
            if minutes is not None:
                out[anchor.name] = minutes
        return out

    def _route_minutes(
        self, lat: float, lon: float, dlat: float, dlon: float, mode: str
    ) -> float | None:
        profile = {"driving": "driving", "walking": "foot", "cycling": "bike"}.get(
            mode, "driving"
        )
        url = (
            f"{self.osrm_url}/route/v1/{profile}/"
            f"{lon:.6f},{lat:.6f};{dlon:.6f},{dlat:.6f}"
        )
        try:
            data = self.fetcher.get_json(
                url,
                params={"overview": "false", "alternatives": "false"},
                cache_ttl=COMMUTE_CACHE_TTL,
            )
        except FetchError as exc:
            log.warning("osrm route failed %s,%s -> %s,%s: %s", lat, lon, dlat, dlon, exc)
            return None

        routes = data.get("routes") or []
        if not routes:
            return None
        seconds = routes[0].get("duration")
        if seconds is None:
            return None
        adjusted = (seconds / 60.0) * (RUSH_HOUR_MULTIPLIER if profile == "driving" else 1.0)
        return round(adjusted, 1)
