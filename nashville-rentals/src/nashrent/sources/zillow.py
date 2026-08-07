"""Zillow adapter.

Zillow serves its map search from `GetSearchPageState.htm`, which returns
clean JSON with coordinates, home type and square footage already parsed —
by far the richest single source for stand-alone house rentals.

The catch: Zillow fingerprints aggressively and blocks datacenter IPs, so
this returns a PerimeterX challenge page from most cloud hosts. It runs fine
from a residential connection (your laptop). Off by default; see README.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Iterator

from ..models import HomeType, Listing
from .base import Source, SourceError, first_of, register
from .extract import find_available_date, infer_home_type

log = logging.getLogger(__name__)

SEARCH_URL = "https://www.zillow.com/search/GetSearchPageState.htm"

# Nashville map bounds, west-weighted to match the search profile.
DEFAULT_BOUNDS = {
    "west": -87.05,
    "east": -86.62,
    "south": 36.02,
    "north": 36.30,
}

_HOME_TYPE_MAP = {
    "SINGLE_FAMILY": HomeType.HOUSE,
    "TOWNHOUSE": HomeType.TOWNHOUSE,
    "CONDO": HomeType.CONDO,
    "MULTI_FAMILY": HomeType.DUPLEX,
    "APARTMENT": HomeType.APARTMENT,
    "MANUFACTURED": HomeType.UNKNOWN,
    "LOT": HomeType.UNKNOWN,
}


@register
class ZillowSource(Source):
    name = "zillow"
    blurb = "Zillow rentals — richest data, but needs a residential IP"
    needs_proxy = True

    def search(self) -> Iterator[Listing]:
        min_price, max_price = self._price_bounds()
        bounds = {**DEFAULT_BOUNDS, **(self.options.get("bounds") or {})}

        query_state: dict[str, Any] = {
            "mapBounds": bounds,
            "isMapVisible": True,
            "filterState": {
                "price": {"min": min_price * 12, "max": max_price * 12},
                "monthlyPayment": {"min": min_price, "max": max_price},
                "beds": {"min": self._min_beds()},
                "isForRent": {"value": True},
                "isForSaleByAgent": {"value": False},
                "isForSaleByOwner": {"value": False},
                "isNewConstruction": {"value": False},
                "isComingSoon": {"value": False},
                "isAuction": {"value": False},
                "isForSaleForeclosure": {"value": False},
                # Deprioritize big complexes: the user wants stand-alone homes.
                "isApartment": {"value": not self.options.get("houses_only", False)},
            },
            "isListVisible": True,
            "pagination": {},
        }

        page = 1
        max_pages = int(self.options.get("max_pages", 4))
        seen = 0

        while page <= max_pages:
            query_state["pagination"] = {"currentPage": page}
            body = self.fetcher.get(
                SEARCH_URL,
                params={
                    "searchQueryState": json.dumps(query_state, separators=(",", ":")),
                    "wants": json.dumps({"cat1": ["listResults", "mapResults"]}),
                    "requestId": page + 1,
                },
                headers={
                    "Accept": "application/json,text/javascript,*/*;q=0.01",
                    "Referer": "https://www.zillow.com/nashville-tn/rentals/",
                    "X-Requested-With": "XMLHttpRequest",
                },
                cache_ttl=1800,
            )

            if body.lstrip().startswith("<"):
                raise SourceError(
                    "Zillow returned HTML instead of JSON — almost certainly a bot "
                    "challenge. Run from a residential connection, or set "
                    "net.proxy to a residential proxy. Disable this source to skip it."
                )

            try:
                payload = json.loads(body)
            except json.JSONDecodeError as exc:
                raise SourceError(f"Zillow returned unparseable JSON: {exc}") from exc

            results = _list_results(payload)
            if not results:
                break

            for row in results:
                listing = self._to_listing(row)
                if listing is not None:
                    seen += 1
                    yield listing

            total_pages = _total_pages(payload)
            if total_pages and page >= total_pages:
                break
            page += 1

        log.info("zillow: %d listings across %d page(s)", seen, page)

    def _to_listing(self, row: dict[str, Any]) -> Listing | None:
        zpid = first_of(row, "zpid", "id")
        if not zpid:
            return None

        info = row.get("hdpData", {}).get("homeInfo", {}) or {}
        detail = first_of(row, "detailUrl", default="")
        url = detail if str(detail).startswith("http") else f"https://www.zillow.com{detail}"

        raw_type = str(first_of(info, "homeType", default="")).upper()
        home_type = _HOME_TYPE_MAP.get(raw_type, HomeType.UNKNOWN)

        title = first_of(row, "statusText", "name", default="") or ""
        address = first_of(row, "address", default=None) or first_of(
            info, "streetAddress", default=None
        )

        listing = Listing(
            source=self.name,
            source_id=str(zpid),
            url=url,
            title=title or (address or f"Zillow {zpid}"),
            price=first_of(row, "unformattedPrice", "price", default=None),
            beds=first_of(row, "beds", default=None) or first_of(info, "bedrooms", default=None),
            baths=first_of(row, "baths", default=None) or first_of(info, "bathrooms", default=None),
            sqft=first_of(row, "area", default=None) or first_of(info, "livingArea", default=None),
            home_type=home_type,
            address=address,
            zipcode=first_of(info, "zipcode", default=None),
            description=first_of(row, "statusText", default="") or "",
            photos=[p for p in [first_of(row, "imgSrc", default=None)] if p],
        )

        if home_type is HomeType.UNKNOWN:
            listing.home_type = infer_home_type(listing.title, listing.description)

        latlong = row.get("latLong") or {}
        lat = first_of(latlong, "latitude", default=None) or first_of(info, "latitude", default=None)
        lon = first_of(latlong, "longitude", default=None) or first_of(info, "longitude", default=None)
        if lat is not None and lon is not None:
            listing.geo.lat, listing.geo.lon = float(lat), float(lon)
            listing.geo.geocode_precision = "address"
            listing.geo.geocode_source = "zillow"

        avail = find_available_date(listing.description)
        if avail:
            listing.available_date = avail
        return listing


def _list_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    cat1 = payload.get("cat1") or {}
    results = (cat1.get("searchResults") or {}).get("listResults")
    if isinstance(results, list):
        return results
    results = (payload.get("searchResults") or {}).get("listResults")
    return results if isinstance(results, list) else []


def _total_pages(payload: dict[str, Any]) -> int | None:
    cat1 = payload.get("cat1") or {}
    pagination = cat1.get("searchList", {}).get("totalPages")
    return int(pagination) if isinstance(pagination, int) else None
