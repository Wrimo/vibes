"""Location enrichment: turn a lat/lon into the facts the scorer needs."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from ..config import Config
from ..geo import Geocoder, get_index
from ..models import Listing
from ..net import Fetcher
from .amenities import AmenityProvider
from .commute import CommuteProvider
from .safety import SafetyProvider

log = logging.getLogger(__name__)

__all__ = ["AmenityProvider", "CommuteProvider", "SafetyProvider", "Enricher"]


class Enricher:
    """Runs the enabled providers over a listing, in dependency order.

    Geocoding comes first because everything else needs a point. A listing
    that can't be geocoded still flows through the pipeline — it just scores
    on the fields we do have, with reduced coverage.
    """

    def __init__(self, config: Config, fetcher: Fetcher):
        self.config = config
        self.fetcher = fetcher
        self.enabled = set(config.enrich.providers)
        self.index = get_index(config.neighborhoods.geojson_path)

        self.geocoder = Geocoder(fetcher, config.enrich.nominatim_url, config.city)
        self.amenities = AmenityProvider(fetcher, config.enrich.overpass_url)
        self.commute = CommuteProvider(fetcher, config.enrich.osrm_url, config.anchors)
        self.safety = SafetyProvider(
            fetcher,
            config.enrich.socrata_domain,
            config.enrich.socrata_dataset,
            app_token=config.enrich.socrata_app_token,
            radius_m=config.enrich.safety_radius_m,
            lookback_days=config.enrich.safety_lookback_days,
        )

    def locate(self, listing: Listing) -> None:
        """Fill in geo, using the cheapest signal that works.

        Order matters: an exact address beats the source's own area blurb,
        which beats nothing.
        """
        if listing.geo.has_point:
            self._classify(listing)
            return

        if "geocode" in self.enabled and listing.address:
            hit = self.geocoder.geocode(listing.address)
            if hit:
                listing.geo.lat, listing.geo.lon, listing.geo.geocode_precision = hit
                listing.geo.geocode_source = "nominatim"
                self._classify(listing)
                return

        # No usable address: fall back to the neighborhood the source claimed,
        # and pin the listing to that neighborhood's centroid so commute and
        # amenity scores are at least directionally right.
        name = self.index.resolve_name(listing.raw_area) or self.index.resolve_name(
            listing.title
        )
        if name:
            listing.geo.neighborhood = name
            centroid = self.index.centroid(name)
            if centroid:
                listing.geo.lat, listing.geo.lon = centroid
                listing.geo.geocode_precision = "neighborhood"
                listing.geo.geocode_source = "area-centroid"

    def _classify(self, listing: Listing) -> None:
        if not listing.geo.has_point:
            return
        match = self.index.classify(listing.geo.lat, listing.geo.lon)
        if match:
            listing.geo.neighborhood = match.name
            if not match.exact:
                listing.score.warnings.append(
                    f"neighborhood '{match.name}' assigned approximately "
                    f"({match.distance_m:.0f}m outside its bounds)"
                )

    def enrich(self, listing: Listing) -> None:
        """Run the location-data providers. Safe to call repeatedly."""
        self.locate(listing)
        if not listing.geo.has_point:
            listing.enrichment.providers_failed.append("geocode")
            return

        lat, lon = listing.geo.lat, listing.geo.lon
        e = listing.enrichment

        for name, provider in (
            ("amenities", self.amenities),
            ("commute", self.commute),
            ("safety", self.safety),
        ):
            if name not in self.enabled:
                continue
            try:
                ok = provider.enrich(lat, lon, e)
            except Exception as exc:  # a bad provider must not sink the run
                log.warning("%s provider raised for %s: %s", name, listing.key, exc)
                ok = False
            (e.providers_ok if ok else e.providers_failed).append(name)

        e.enriched_at = datetime.now(timezone.utc)
