"""Craigslist adapter.

Two-stage, because the two halves of Craigslist have very different
stability profiles:

  1. **Discovery** hits the undocumented JSON search API that the CL front end
     itself calls. It returns a *columnar* payload with no field names — a
     positional schema that CL reorders without warning. So rather than
     hardcoding indices, `decode_item` walks the structure and identifies
     values by type and plausible range (a 10-digit int is a post id, a float
     near 36.1 is a Nashville latitude, and so on). That degrades gracefully
     instead of silently mis-assigning fields.

  2. **Detail** parses the server-rendered posting HTML, which has been stable
     for a decade and carries authoritative price, beds, sqft, coordinates,
     address and attributes. Anything discovery guessed gets overwritten here.

If CL changes shape, `nashrent doctor --dump craigslist` writes the raw
payload next to a diagnostic so the decoder can be re-fitted quickly.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Iterator

from bs4 import BeautifulSoup

from ..models import HomeType, Listing
from .base import Source, SourceError, guard, register
from .extract import (
    find_available_date,
    find_baths,
    find_beds,
    find_price,
    find_sqft,
    infer_home_type,
    parse_epoch,
)

log = logging.getLogger(__name__)

SAPI = "https://sapi.craigslist.org/web/v8/postings/search/full"
DEFAULT_HOST = "nashville.craigslist.org"

# Nashville metro sanity box, used to recognize coordinates positionally.
LAT_RANGE = (35.4, 36.9)
LON_RANGE = (-87.7, -85.9)


@register
class CraigslistSource(Source):
    name = "craigslist"
    blurb = "Craigslist apts/housing — best source for by-owner house rentals"
    needs_proxy = False

    def search(self) -> Iterator[Listing]:
        area_id = self.options.get("area_id", 25)
        search_path = self.options.get("search_path", "apa")
        host = self.options.get("host", DEFAULT_HOST)
        want_details = self.options.get("fetch_details", True)
        max_details = int(self.options.get("max_details", 80))
        min_price, max_price = self._price_bounds()

        params: dict[str, Any] = {
            "batch": f"{area_id}-0-360-0-0",
            "cc": "US",
            "lang": "en",
            "searchPath": search_path,
            "min_price": min_price,
            "max_price": max_price,
            "min_bedrooms": self._min_beds(),
            "availabilityMode": 0,
            "sale_date": "all dates",
        }
        if not self.options.get("include_nearby", False):
            params["searchNearby"] = 0

        raw = self.fetcher.get_json(SAPI, params=params, cache_ttl=900)
        items = _items_of(raw)
        guard(
            isinstance(items, list),
            "Craigslist search returned no 'items' array — the API shape changed. "
            "Run `nashrent doctor --dump craigslist` and inspect the payload.",
        )
        log.info("craigslist: %d raw items", len(items))

        detailed = 0
        for item in items:
            listing = self.decode_item(item, host=host, search_path=search_path)
            if listing is None:
                continue
            if want_details and detailed < max_details:
                try:
                    self.hydrate(listing)
                    detailed += 1
                except Exception as exc:
                    log.debug("detail fetch failed for %s: %s", listing.url, exc)
            yield listing

    # ---- stage 1: columnar decode -----------------------------------------

    def decode_item(
        self, item: Any, host: str = DEFAULT_HOST, search_path: str = "apa"
    ) -> Listing | None:
        """Turn one columnar search row into a Listing skeleton.

        Returns None when we can't even find a post id, since a listing we
        can't fetch or de-duplicate is worse than no listing.
        """
        ints, floats, strings = _flatten(item)

        post_id = next((i for i in ints if 1_000_000_000 <= i <= 9_999_999_999), None)
        if post_id is None:
            return None

        lat = next((f for f in floats if LAT_RANGE[0] <= f <= LAT_RANGE[1]), None)
        lon = next((f for f in floats if LON_RANGE[0] <= f <= LON_RANGE[1]), None)

        # Price: the smallest plausible-rent integer that isn't the post id or
        # a timestamp. Rents cluster far below CL's other numeric fields.
        price = next((i for i in sorted(ints) if 300 <= i <= 20_000), None)

        title = _pick_title(strings)
        url = _pick_url(strings, post_id, host, search_path)
        area = _pick_area(strings)

        posted = next(
            (parse_epoch(i) for i in ints if parse_epoch(i) is not None), None
        )

        listing = Listing(
            source=self.name,
            source_id=str(post_id),
            url=url,
            title=title or "",
            price=price,
            raw_area=area,
            posted_at=posted,
            home_type=infer_home_type(title),
            raw={"columnar": item} if log.isEnabledFor(logging.DEBUG) else {},
        )
        if lat is not None and lon is not None:
            listing.geo.lat, listing.geo.lon = lat, lon
            listing.geo.geocode_precision = "address"
            listing.geo.geocode_source = "craigslist"

        beds = find_beds(title or "")
        if beds is not None:
            listing.beds = beds
        sqft = find_sqft(title or "")
        if sqft is not None:
            listing.sqft = sqft
        return listing

    # ---- stage 2: authoritative detail page --------------------------------

    def hydrate(self, listing: Listing) -> None:
        """Overwrite the skeleton with facts from the posting page."""
        html = self.fetcher.get(listing.url, cache_ttl=6 * 3600)
        parse_detail(html, listing)


def parse_detail(html: str, listing: Listing) -> Listing:
    """Parse a Craigslist posting page into `listing` (mutated and returned).

    Kept module-level and side-effect free apart from `listing` so tests can
    run it against saved HTML with no network.
    """
    soup = BeautifulSoup(html, "lxml")

    title_el = soup.select_one("#titletextonly")
    if title_el and title_el.get_text(strip=True):
        listing.title = title_el.get_text(strip=True)

    price_el = soup.select_one(".price")
    if price_el:
        price = find_price(price_el.get_text())
        if price:
            listing.price = price

    # Coordinates from the embedded map are rooftop-accurate when CL has them.
    map_el = soup.select_one("#map")
    if map_el and map_el.get("data-latitude") and map_el.get("data-longitude"):
        try:
            listing.geo.lat = float(map_el["data-latitude"])
            listing.geo.lon = float(map_el["data-longitude"])
            listing.geo.geocode_precision = "address"
            listing.geo.geocode_source = "craigslist-map"
        except (TypeError, ValueError):
            pass

    addr_el = soup.select_one(".mapaddress") or soup.select_one("div.mapAddress")
    if addr_el:
        listing.address = addr_el.get_text(" ", strip=True)

    body_el = soup.select_one("#postingbody")
    if body_el:
        # CL injects a "QR Code Link to This Post" preamble; drop it.
        for junk in body_el.select(".print-information, .print-qrcode-container"):
            junk.decompose()
        listing.description = body_el.get_text("\n", strip=True)

    attrs = _attributes(soup)
    listing.amenities = attrs

    blob = " ".join([listing.title, listing.description, " ".join(attrs)])

    beds = find_beds(" ".join(attrs)) or find_beds(listing.title)
    if beds is not None:
        listing.beds = beds
    baths = find_baths(" ".join(attrs)) or find_baths(listing.title)
    if baths is not None:
        listing.baths = baths
    sqft = find_sqft(" ".join(attrs)) or find_sqft(blob)
    if sqft is not None:
        listing.sqft = sqft

    inferred = infer_home_type(" ".join(attrs), listing.title, listing.description)
    if inferred is not HomeType.UNKNOWN:
        listing.home_type = inferred

    avail = find_available_date(" ".join(attrs)) or find_available_date(blob)
    if avail:
        listing.available_date = avail

    lowered = " ".join(attrs).lower()
    if "no pets" in lowered:
        listing.pets_allowed = False
    elif "dogs are ok" in lowered or "cats are ok" in lowered or "pets ok" in lowered:
        listing.pets_allowed = True

    listing.laundry = next((a for a in attrs if "laundry" in a.lower() or "w/d" in a.lower()), None)
    listing.parking = next(
        (a for a in attrs if re.search(r"parking|garage|carport|street", a, re.I)), None
    )

    time_el = soup.select_one("time.date, time[datetime]")
    if time_el and time_el.get("datetime"):
        from datetime import datetime as _dt

        try:
            listing.posted_at = _dt.fromisoformat(str(time_el["datetime"]))
        except ValueError:
            pass

    listing.photos = [
        str(a["href"])
        for a in soup.select("a.thumb[href]")
        if str(a.get("href", "")).startswith("http")
    ][:12]

    return listing


def _attributes(soup: BeautifulSoup) -> list[str]:
    """Flatten CL's attribute groups into plain strings.

    Modern postings use `.attrgroup .attr` with a `.valu` child; older ones
    put everything in bare `<span>`s. Handle both.
    """
    out: list[str] = []
    for group in soup.select(".attrgroup"):
        for attr in group.select(".attr"):
            text = attr.get_text(" ", strip=True)
            if text:
                out.append(re.sub(r"\s+", " ", text))
        if not group.select(".attr"):
            for span in group.find_all("span", recursive=False):
                text = span.get_text(" ", strip=True)
                if text:
                    out.append(re.sub(r"\s+", " ", text))
    return [a for a in dict.fromkeys(out) if a]


# ---- columnar helpers ------------------------------------------------------


def _items_of(payload: Any) -> Any:
    """Find the items array regardless of how deep CL nests it this month."""
    if isinstance(payload, dict):
        data = payload.get("data", payload)
        if isinstance(data, dict) and isinstance(data.get("items"), list):
            return data["items"]
        if isinstance(payload.get("items"), list):
            return payload["items"]
    raise SourceError(
        "Craigslist response had no recognizable 'items' array. "
        "Run `nashrent doctor --dump craigslist` to capture the payload."
    )


def _flatten(node: Any) -> tuple[list[int], list[float], list[str]]:
    """Collect every scalar in a nested structure, bucketed by type."""
    ints: list[int] = []
    floats: list[float] = []
    strings: list[str] = []

    def walk(n: Any) -> None:
        if isinstance(n, bool):
            return
        if isinstance(n, int):
            ints.append(n)
        elif isinstance(n, float):
            floats.append(n)
            # CL sometimes ships coordinates as ints scaled by 1e6.
        elif isinstance(n, str):
            strings.append(n)
        elif isinstance(n, list):
            for x in n:
                walk(x)
        elif isinstance(n, dict):
            for x in n.values():
                walk(x)

    walk(node)

    # Recover coordinates stored as scaled integers (36150000 -> 36.15).
    for i in list(ints):
        scaled = i / 1_000_000
        if LAT_RANGE[0] <= scaled <= LAT_RANGE[1] or LON_RANGE[0] <= scaled <= LON_RANGE[1]:
            floats.append(scaled)

    return ints, floats, strings


_SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+){2,}$", re.I)


def _pick_title(strings: list[str]) -> str | None:
    """The title is the longest human-looking string in the row."""
    candidates = [
        s
        for s in strings
        if len(s) >= 12
        and " " in s
        and not s.startswith("http")
        and not s.endswith(".html")
        and not s.endswith((".jpg", ".png", ".webp"))
    ]
    return max(candidates, key=len) if candidates else None


def _pick_area(strings: list[str]) -> str | None:
    """CL's neighborhood blurb: short, often parenthesized, no spaces-heavy prose."""
    for s in strings:
        stripped = s.strip()
        if stripped.startswith("(") and stripped.endswith(")") and len(stripped) < 60:
            return stripped.strip("()")
    short = [s for s in strings if 3 <= len(s) <= 40 and not s.startswith("http")]
    # Prefer the one that reads like a place name rather than a code.
    named = [s for s in short if re.match(r"^[A-Za-z][A-Za-z .'/&-]+$", s)]
    return named[0] if named else None


def _pick_url(strings: list[str], post_id: int, host: str, search_path: str) -> str:
    for s in strings:
        if s.startswith("http") and s.endswith(".html"):
            return s
    for s in strings:
        if s.endswith(".html"):
            return f"https://{host}/{s.lstrip('/')}"
    slug = next((s for s in strings if _SLUG_RE.match(s) and len(s) > 12), None)
    if slug:
        return f"https://{host}/{search_path}/d/{slug}/{post_id}.html"
    # Last resort: CL resolves this form by post id and redirects to canonical.
    return f"https://{host}/{search_path}/d/listing/{post_id}.html"
