"""Manual CSV source.

The one source that can never break. Drop anything you find by hand — a
Facebook Marketplace post, a yard sign, a property manager's own site — into
a CSV and it gets geocoded, enriched, scored and tracked right alongside the
scraped listings. That means a single ranked list, not two.

Only `url` is required. Everything else is filled in by enrichment or parsed
out of `title`/`description`.
"""

from __future__ import annotations

import csv
import hashlib
import logging
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterator

from ..models import HomeType, Listing
from .base import Source, register
from .extract import find_available_date, find_baths, find_beds, find_price, find_sqft, infer_home_type

log = logging.getLogger(__name__)

TEMPLATE_HEADER = [
    "url",
    "title",
    "price",
    "beds",
    "baths",
    "sqft",
    "home_type",
    "address",
    "neighborhood",
    "available_date",
    "notes",
]


@register
class CsvSource(Source):
    name = "csv"
    blurb = "Manual listings from a CSV file — always works, never breaks"
    needs_proxy = False

    def search(self) -> Iterator[Listing]:
        path = Path(self.options.get("path", "config/manual-listings.csv"))
        if not path.exists():
            log.info("csv source: %s does not exist yet, skipping", path)
            return

        with path.open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for lineno, row in enumerate(reader, start=2):
                listing = self._to_listing(row, path, lineno)
                if listing is not None:
                    yield listing

    def _to_listing(self, row: dict[str, Any], path: Path, lineno: int) -> Listing | None:
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        url = row.get("url")
        if not url:
            log.warning("%s:%d has no url, skipping", path, lineno)
            return None

        blob = " ".join(filter(None, [row.get("title"), row.get("notes"), row.get("description")]))

        home_type = _parse_home_type(row.get("home_type")) or infer_home_type(
            row.get("title"), blob
        )

        listing = Listing(
            source=self.name,
            # Stable across reorderings of the file, unlike a line number.
            source_id=hashlib.sha1(url.encode()).hexdigest()[:12],
            url=url,
            title=row.get("title") or url,
            price=row.get("price") or find_price(blob),
            beds=row.get("beds") or find_beds(blob),
            baths=row.get("baths") or find_baths(blob),
            sqft=row.get("sqft") or find_sqft(blob),
            home_type=home_type,
            address=row.get("address") or None,
            raw_area=row.get("neighborhood") or None,
            description=row.get("description") or row.get("notes") or "",
            notes=row.get("notes") or "",
            available_date=_parse_date(row.get("available_date")) or find_available_date(blob),
        )

        lat, lon = row.get("lat"), row.get("lon")
        if lat and lon:
            try:
                listing.geo.lat, listing.geo.lon = float(lat), float(lon)
                listing.geo.geocode_precision = "address"
                listing.geo.geocode_source = "manual"
            except ValueError:
                log.warning("%s:%d has unparseable lat/lon", path, lineno)
        return listing


def _parse_home_type(value: str | None) -> HomeType | None:
    if not value:
        return None
    try:
        return HomeType(value.strip().lower())
    except ValueError:
        return infer_home_type(value)


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%b %d %Y", "%B %d %Y"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return find_available_date(value)


def write_template(path: Path) -> None:
    """Create an empty CSV with the right header, plus one example row."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(TEMPLATE_HEADER)
        writer.writerow(
            [
                "https://example.com/listing/123",
                "2BR bungalow with big fenced yard",
                "2450",
                "2",
                "2",
                "1400",
                "house",
                "4200 Park Ave, Nashville, TN",
                "Sylvan Park",
                "2027-03-01",
                "Found on a yard sign — deck out back, open kitchen",
            ]
        )
