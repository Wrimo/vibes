"""Realtor.com adapter.

Realtor.com is a Next.js app, so every search page embeds its full result set
as JSON in a `__NEXT_DATA__` script tag. Parsing that is far more stable than
scraping the rendered markup, and it carries lat/lon and property type.

Blocks datacenter IPs less aggressively than Zillow, but still sometimes
serves a challenge page — the adapter says so plainly rather than returning
an empty list.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Iterator

from bs4 import BeautifulSoup

from ..models import HomeType, Listing
from .base import Source, SourceError, first_of, register
from .extract import infer_home_type

log = logging.getLogger(__name__)

BASE = "https://www.realtor.com/apartments"

_TYPE_MAP = {
    "single_family": HomeType.HOUSE,
    "townhomes": HomeType.TOWNHOUSE,
    "townhouse": HomeType.TOWNHOUSE,
    "condos": HomeType.CONDO,
    "condo": HomeType.CONDO,
    "duplex_triplex": HomeType.DUPLEX,
    "multi_family": HomeType.DUPLEX,
    "apartment": HomeType.APARTMENT,
    "apartments": HomeType.APARTMENT,
}


@register
class RealtorSource(Source):
    name = "realtor"
    blurb = "Realtor.com rentals — good house coverage, moderate bot defenses"
    needs_proxy = True

    def search(self) -> Iterator[Listing]:
        region = self.options.get("region", "Nashville_TN")
        _, max_price = self._price_bounds()
        beds = self._min_beds()
        max_pages = int(self.options.get("max_pages", 3))

        count = 0
        for page in range(1, max_pages + 1):
            path = f"{BASE}/{region}/beds-{beds}/price-na-{max_price}"
            if page > 1:
                path = f"{path}/pg-{page}"

            html = self.fetcher.get(path, cache_ttl=1800)
            data = _next_data(html)
            if data is None:
                raise SourceError(
                    "Realtor.com page had no __NEXT_DATA__ block — likely a bot "
                    "challenge or a site rewrite. Try from a residential IP, or "
                    "disable the `realtor` source."
                )

            rows = _properties(data)
            if not rows:
                break
            for row in rows:
                listing = self._to_listing(row)
                if listing is not None:
                    count += 1
                    yield listing

        log.info("realtor: %d listings", count)

    def _to_listing(self, row: dict[str, Any]) -> Listing | None:
        prop_id = first_of(row, "property_id", "listing_id", "id")
        if not prop_id:
            return None

        desc = row.get("description") or {}
        location = row.get("location") or {}
        address = location.get("address") or {}
        coord = address.get("coordinate") or location.get("coordinate") or {}

        price = first_of(row, "list_price", "price", default=None)
        if price is None:
            rng = row.get("list_price_min") or row.get("price_min")
            price = rng

        raw_type = str(first_of(desc, "type", "sub_type", default="")).lower()
        home_type = _TYPE_MAP.get(raw_type, HomeType.UNKNOWN)

        line = address.get("line")
        city = address.get("city")
        full_address = ", ".join(p for p in [line, city] if p) or None

        permalink = first_of(row, "permalink", default=None)
        url = (
            f"https://www.realtor.com/rentals/details/{permalink}"
            if permalink
            else f"https://www.realtor.com/realestateandhomes-detail/M{prop_id}"
        )

        listing = Listing(
            source=self.name,
            source_id=str(prop_id),
            url=url,
            title=full_address or f"Realtor {prop_id}",
            price=price,
            beds=first_of(desc, "beds", "beds_min", default=None),
            baths=first_of(desc, "baths", "baths_consolidated", "baths_min", default=None),
            sqft=first_of(desc, "sqft", "sqft_min", default=None),
            home_type=home_type,
            address=full_address,
            zipcode=address.get("postal_code"),
            raw_area=(location.get("neighborhoods") or [{}])[0].get("name")
            if location.get("neighborhoods")
            else None,
            photos=[p.get("href") for p in (row.get("photos") or []) if p.get("href")][:8],
        )

        if home_type is HomeType.UNKNOWN:
            listing.home_type = infer_home_type(listing.title, raw_type)

        lat, lon = coord.get("lat"), coord.get("lon")
        if lat is not None and lon is not None:
            listing.geo.lat, listing.geo.lon = float(lat), float(lon)
            listing.geo.geocode_precision = "address"
            listing.geo.geocode_source = "realtor"
        return listing


def _next_data(html: str) -> dict[str, Any] | None:
    soup = BeautifulSoup(html, "lxml")
    tag = soup.find("script", id="__NEXT_DATA__")
    if not tag or not tag.string:
        return None
    try:
        return json.loads(tag.string)
    except json.JSONDecodeError:
        return None


def _properties(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Walk to the results array, tolerating Next.js prop reshuffles."""
    page_props = (data.get("props") or {}).get("pageProps") or {}
    for path in (
        ("properties",),
        ("searchResults", "home_search", "results"),
        ("searchResults", "properties"),
    ):
        node: Any = page_props
        for key in path:
            node = (node or {}).get(key) if isinstance(node, dict) else None
        if isinstance(node, list) and node:
            return node
    return []
