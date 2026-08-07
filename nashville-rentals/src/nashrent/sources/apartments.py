"""Apartments.com adapter.

Included for completeness — but note it's the least useful source for this
particular search, because its inventory skews hard toward managed complexes
and the profile prefers stand-alone houses. It does carry some house and
duplex inventory under its "Houses for Rent" category, which is what this
adapter targets.

Parses the JSON-LD block the site embeds for search engines, falling back to
the rendered placards when that's missing.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Iterator

from bs4 import BeautifulSoup

from ..models import HomeType, Listing
from .base import Source, SourceError, register
from .extract import find_baths, find_beds, find_price, find_sqft, infer_home_type

log = logging.getLogger(__name__)


@register
class ApartmentsSource(Source):
    name = "apartments"
    blurb = "Apartments.com houses-for-rent — complex-heavy, lowest signal here"
    needs_proxy = True

    def search(self) -> Iterator[Listing]:
        _, max_price = self._price_bounds()
        beds = self._min_beds()
        # The /houses/ path is the one worth scraping for this profile.
        category = self.options.get("category", "houses")
        city = self.options.get("city_slug", "nashville-tn")
        max_pages = int(self.options.get("max_pages", 3))

        count = 0
        for page in range(1, max_pages + 1):
            url = f"https://www.apartments.com/{category}/{city}/{beds}-bedrooms-under-{max_price}/"
            if page > 1:
                url = f"{url}{page}/"

            html = self.fetcher.get(url, cache_ttl=1800)
            if "captcha" in html[:4000].lower() or "unusual traffic" in html[:4000].lower():
                raise SourceError(
                    "Apartments.com served a bot challenge. Run from a residential "
                    "IP or disable the `apartments` source."
                )

            rows = list(_from_jsonld(html)) or list(_from_placards(html))
            if not rows:
                break
            for row in rows:
                listing = self._to_listing(row)
                if listing is not None:
                    count += 1
                    yield listing

        log.info("apartments: %d listings", count)

    def _to_listing(self, row: dict[str, Any]) -> Listing | None:
        url = row.get("url")
        if not url:
            return None
        source_id = row.get("id") or _id_from_url(url)

        title = row.get("name") or row.get("title") or ""
        blob = " ".join(str(v) for v in row.values() if isinstance(v, str))

        listing = Listing(
            source=self.name,
            source_id=str(source_id),
            url=url,
            title=title,
            price=row.get("price") or find_price(blob),
            beds=row.get("beds") or find_beds(blob),
            baths=row.get("baths") or find_baths(blob),
            sqft=row.get("sqft") or find_sqft(blob),
            address=row.get("address"),
            zipcode=row.get("zipcode"),
            home_type=infer_home_type(title, row.get("address"), blob) or HomeType.UNKNOWN,
        )
        if row.get("lat") is not None and row.get("lon") is not None:
            listing.geo.lat = float(row["lat"])
            listing.geo.lon = float(row["lon"])
            listing.geo.geocode_precision = "address"
            listing.geo.geocode_source = "apartments"
        return listing


def _from_jsonld(html: str) -> Iterator[dict[str, Any]]:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all("script", type="application/ld+json"):
        if not tag.string:
            continue
        try:
            data = json.loads(tag.string)
        except json.JSONDecodeError:
            continue
        for item in _iter_items(data):
            about = item.get("about") or item
            addr = about.get("address") or {}
            geo = about.get("geo") or {}
            url = item.get("url") or about.get("url")
            if not url:
                continue
            yield {
                "url": url,
                "name": about.get("name") or item.get("name"),
                "address": _join_address(addr),
                "zipcode": addr.get("postalCode"),
                "lat": geo.get("latitude"),
                "lon": geo.get("longitude"),
            }


def _iter_items(data: Any) -> Iterator[dict[str, Any]]:
    if isinstance(data, list):
        for d in data:
            yield from _iter_items(d)
    elif isinstance(data, dict):
        if data.get("@type") in {"ItemList", "SearchResultsPage"}:
            for el in data.get("itemListElement") or []:
                yield from _iter_items(el)
        elif data.get("@type") in {"ListItem", "Apartment", "SingleFamilyResidence", "House"}:
            yield data


def _from_placards(html: str) -> Iterator[dict[str, Any]]:
    """Fallback: the rendered result cards."""
    soup = BeautifulSoup(html, "lxml")
    for card in soup.select("article.placard, li article[data-listingid]"):
        link = card.select_one("a.property-link[href], a[href]")
        if not link:
            continue
        yield {
            "url": link.get("href"),
            "id": card.get("data-listingid"),
            "name": _text(card, ".js-placardTitle, .property-title"),
            "address": _text(card, ".property-address"),
            "price_text": _text(card, ".property-pricing, .price-range"),
            "beds_text": _text(card, ".property-beds, .bed-range"),
        }


def _text(node: Any, selector: str) -> str | None:
    el = node.select_one(selector)
    return el.get_text(" ", strip=True) if el else None


def _join_address(addr: dict[str, Any]) -> str | None:
    parts = [
        addr.get("streetAddress"),
        addr.get("addressLocality"),
        addr.get("addressRegion"),
    ]
    joined = ", ".join(p for p in parts if p)
    return joined or None


def _id_from_url(url: str) -> str:
    m = re.search(r"/([a-z0-9]{6,})/?$", url, re.I)
    return m.group(1) if m else url.rsplit("/", 1)[-1] or url
