"""Cross-source de-duplication.

The same house shows up on Zillow, Realtor.com and Craigslist at once,
usually with different photos, a slightly different price, and one of them
missing the square footage. Collapsing those into one record — while keeping
every link — is what makes the ranked list actually readable.

Matching is conservative on purpose: a false merge hides a real listing,
which is worse than showing a duplicate.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from .geo.distance import haversine_m
from .models import HomeType, Listing, normalize_address

log = logging.getLogger(__name__)

# Sources listed first win field conflicts, because their structured data is
# more trustworthy than text parsed out of a free-form post body.
SOURCE_PRIORITY = ["csv", "zillow", "realtor", "craigslist", "apartments"]

# Two listings this close, with the same beds and a near-identical price, are
# the same house even when neither gave us a street address.
NEARBY_METERS = 60
PRICE_TOLERANCE = 0.03


def merge_duplicates(listings: list[Listing]) -> list[Listing]:
    """Collapse duplicates, returning one merged Listing per real home."""
    groups = _group(listings)
    merged: list[Listing] = []
    for group in groups:
        if len(group) == 1:
            merged.append(group[0])
        else:
            merged.append(_merge(group))
    if len(merged) < len(listings):
        log.info("dedupe: %d listings -> %d homes", len(listings), len(merged))
    return merged


def _group(listings: list[Listing]) -> list[list[Listing]]:
    """Union listings by address fingerprint, then by geographic proximity."""
    by_fp: dict[str, list[Listing]] = defaultdict(list)
    for listing in listings:
        by_fp[listing.fingerprint].append(listing)

    groups = list(by_fp.values())

    # Second pass: merge groups whose members sit on top of each other with
    # matching beds and price. Catches the address-free Craigslist posts.
    result: list[list[Listing]] = []
    for group in groups:
        target = None
        for existing in result:
            if _same_home(existing[0], group[0]):
                target = existing
                break
        if target is not None:
            target.extend(group)
        else:
            result.append(list(group))
    return result


def _same_home(a: Listing, b: Listing) -> bool:
    if a.source == b.source and a.source_id == b.source_id:
        return True

    if a.address and b.address:
        if normalize_address(a.address) == normalize_address(b.address):
            return True

    if not (a.geo.has_point and b.geo.has_point):
        return False

    # Neighborhood-centroid coordinates are not evidence of anything — every
    # address-free listing in Sylvan Park would collide.
    if "centroid" in (a.geo.geocode_source or "") or "centroid" in (
        b.geo.geocode_source or ""
    ):
        return False

    distance = haversine_m(a.geo.lat, a.geo.lon, b.geo.lat, b.geo.lon)
    if distance > NEARBY_METERS:
        return False

    if a.beds is not None and b.beds is not None and a.beds != b.beds:
        return False

    if a.price and b.price:
        spread = abs(a.price - b.price) / max(a.price, b.price)
        if spread > PRICE_TOLERANCE:
            return False

    return True


def _merge(group: list[Listing]) -> Listing:
    """Build one listing from many, preferring the most trustworthy source
    for each field and backfilling gaps from the rest."""
    ordered = sorted(group, key=_priority)
    primary = ordered[0].model_copy(deep=True)

    for other in ordered[1:]:
        for field in ("price", "beds", "baths", "sqft", "address", "zipcode",
                      "available_date", "pets_allowed", "laundry", "parking"):
            if getattr(primary, field, None) is None:
                setattr(primary, field, getattr(other, field, None))

        if primary.home_type is HomeType.UNKNOWN and other.home_type is not HomeType.UNKNOWN:
            primary.home_type = other.home_type

        # The longest description usually has the details worth reading.
        if len(other.description) > len(primary.description):
            primary.description = other.description

        if not primary.geo.has_point and other.geo.has_point:
            primary.geo = other.geo.model_copy()
        elif primary.geo.neighborhood is None and other.geo.neighborhood:
            primary.geo.neighborhood = other.geo.neighborhood

        primary.amenities = list(dict.fromkeys(primary.amenities + other.amenities))
        primary.photos = list(dict.fromkeys(primary.photos + other.photos))[:12]

        if other.first_seen and (
            primary.first_seen is None or other.first_seen < primary.first_seen
        ):
            primary.first_seen = other.first_seen

    others = [o for o in ordered[1:]]
    primary.raw["also_listed_on"] = [
        {"source": o.source, "url": o.url, "price": o.price} for o in others
    ]
    # Cheapest advertised price across sources is the one worth chasing.
    prices = [o.price for o in ordered if o.price is not None]
    if prices:
        primary.price = min(prices)
    return primary


def _priority(listing: Listing) -> tuple[int, int]:
    try:
        rank = SOURCE_PRIORITY.index(listing.source)
    except ValueError:
        rank = len(SOURCE_PRIORITY)
    # Break ties by how complete the record is.
    filled = sum(
        1
        for f in (listing.price, listing.beds, listing.baths, listing.sqft,
                  listing.address, listing.geo.lat)
        if f is not None
    )
    return rank, -filled
