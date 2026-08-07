from __future__ import annotations

from nashrent.dedupe import merge_duplicates
from nashrent.models import Geo, HomeType
from tests.conftest import make_listing


def test_same_address_across_sources_merges():
    a = make_listing(source="craigslist", source_id="1", address="4200 Park Ave, Nashville, TN", sqft=None)
    b = make_listing(source="zillow", source_id="z1", address="4200 Park Avenue", sqft=1450)

    merged = merge_duplicates([a, b])
    assert len(merged) == 1
    # Zillow outranks Craigslist, and its square footage fills the gap.
    assert merged[0].source == "zillow"
    assert merged[0].sqft == 1450


def test_merge_backfills_missing_fields_from_lower_priority_source():
    a = make_listing(source="zillow", source_id="z1", baths=None, sqft=None,
                     description="short")
    b = make_listing(source="craigslist", source_id="1", baths=2.5, sqft=1600,
                     description="a much longer description with real detail about the deck")

    merged = merge_duplicates([a, b])[0]
    assert merged.baths == 2.5
    assert merged.sqft == 1600
    assert "deck" in merged.description


def test_merge_keeps_the_cheaper_advertised_price():
    a = make_listing(source="zillow", source_id="z1", price=2500)
    b = make_listing(source="craigslist", source_id="1", price=2400)
    merged = merge_duplicates([a, b])[0]
    assert merged.price == 2400


def test_merge_records_the_other_listings():
    a = make_listing(source="zillow", source_id="z1")
    b = make_listing(source="craigslist", source_id="1", url="https://cl/1.html")
    merged = merge_duplicates([a, b])[0]
    also = merged.raw["also_listed_on"]
    assert len(also) == 1
    assert also[0]["source"] == "craigslist"


def test_nearby_listings_with_matching_facts_merge_without_addresses():
    a = make_listing(source="craigslist", source_id="1", address=None, price=2400)
    a.geo = Geo(lat=36.14970, lon=-86.83610, neighborhood="Sylvan Park",
                geocode_source="craigslist-map")
    b = make_listing(source="zillow", source_id="z1", address=None, price=2410)
    b.geo = Geo(lat=36.14975, lon=-86.83615, neighborhood="Sylvan Park",
                geocode_source="zillow")

    assert len(merge_duplicates([a, b])) == 1


def test_different_beds_at_same_point_do_not_merge():
    """A duplex with two units at one address is two listings, not one."""
    a = make_listing(source="craigslist", source_id="1", address=None, beds=2)
    a.geo = Geo(lat=36.1497, lon=-86.8361, geocode_source="craigslist-map")
    b = make_listing(source="craigslist", source_id="2", address=None, beds=3)
    b.geo = Geo(lat=36.1497, lon=-86.8361, geocode_source="craigslist-map")

    assert len(merge_duplicates([a, b])) == 2


def test_centroid_coordinates_never_merge():
    """Address-free listings pinned to a neighborhood centroid all share a
    point — merging them would erase most of Sylvan Park."""
    a = make_listing(source="craigslist", source_id="1", address=None, price=2400)
    a.geo = Geo(lat=36.1497, lon=-86.8361, geocode_source="area-centroid")
    b = make_listing(source="craigslist", source_id="2", address=None, price=2400)
    b.geo = Geo(lat=36.1497, lon=-86.8361, geocode_source="area-centroid")

    assert len(merge_duplicates([a, b])) == 2


def test_far_apart_listings_do_not_merge():
    a = make_listing(source="craigslist", source_id="1", address=None)
    a.geo = Geo(lat=36.1497, lon=-86.8361, geocode_source="craigslist-map")
    b = make_listing(source="craigslist", source_id="2", address=None)
    b.geo = Geo(lat=36.1830, lon=-86.7450, geocode_source="craigslist-map")

    assert len(merge_duplicates([a, b])) == 2


def test_unknown_home_type_is_filled_from_the_other_source():
    a = make_listing(source="zillow", source_id="z1", home_type=HomeType.UNKNOWN)
    b = make_listing(source="craigslist", source_id="1", home_type=HomeType.HOUSE)
    assert merge_duplicates([a, b])[0].home_type is HomeType.HOUSE


def test_single_listing_passes_through_unchanged():
    a = make_listing()
    assert merge_duplicates([a])[0] is a
