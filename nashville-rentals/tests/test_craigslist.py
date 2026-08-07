"""Craigslist parsing.

The detail-page parser is the load-bearing part (CL's posting HTML has been
stable for years), so it gets the most coverage. The columnar decoder is
tested for the property that actually matters: it never mis-assigns fields,
even when the column order shifts.
"""

from __future__ import annotations

from datetime import date

import pytest

from nashrent.config import Config, SourceConfig
from nashrent.models import HomeType, Listing
from nashrent.net import Fetcher
from nashrent.sources.craigslist import CraigslistSource, _items_of, parse_detail
from nashrent.sources.base import SourceError
from tests.conftest import FIXTURES


@pytest.fixture
def posting_html() -> str:
    return (FIXTURES / "craigslist_posting.html").read_text()


@pytest.fixture
def source(config) -> CraigslistSource:
    return CraigslistSource(config, SourceConfig(enabled=True), Fetcher(cache_dir=None))


# ---- detail page -----------------------------------------------------------


class TestParseDetail:
    @pytest.fixture
    def parsed(self, posting_html) -> Listing:
        listing = Listing(source="craigslist", source_id="1", url="https://x/1.html")
        return parse_detail(posting_html, listing)

    def test_title_and_price(self, parsed):
        assert parsed.title.startswith("Charming 2BR/2BA bungalow")
        assert parsed.price == 2395

    def test_coordinates_from_map(self, parsed):
        assert parsed.geo.lat == pytest.approx(36.1497)
        assert parsed.geo.lon == pytest.approx(-86.8361)
        assert parsed.geo.geocode_source == "craigslist-map"

    def test_address(self, parsed):
        assert parsed.address == "4200 Park Ave"

    def test_beds_baths_sqft_from_attributes(self, parsed):
        assert parsed.beds == 2.0
        assert parsed.baths == 2.0
        assert parsed.sqft == 1350

    def test_home_type_from_attributes(self, parsed):
        assert parsed.home_type is HomeType.HOUSE

    def test_available_date(self, parsed):
        assert parsed.available_date is not None
        assert parsed.available_date.month == 3
        assert parsed.available_date.day == 1

    def test_pets_and_laundry(self, parsed):
        assert parsed.pets_allowed is True
        assert parsed.laundry is not None and "w/d" in parsed.laundry.lower()
        assert parsed.parking is not None and "garage" in parsed.parking.lower()

    def test_body_excludes_qr_boilerplate(self, parsed):
        assert "QR Code" not in parsed.description
        assert "Richland Park" in parsed.description

    def test_photos_collected(self, parsed):
        assert len(parsed.photos) == 2
        assert all(p.startswith("https://") for p in parsed.photos)

    def test_posted_at(self, parsed):
        assert parsed.posted_at is not None
        assert parsed.posted_at.date() == date(2026, 8, 1)

    def test_hosting_signals_survive_into_description(self, parsed):
        from nashrent.sources.extract import hosting_signals

        signals, _ = hosting_signals(parsed.description)
        assert "open_plan" in signals
        assert "outdoor_space" in signals
        assert "fenced_yard" in signals


def test_parse_detail_on_garbage_html_does_not_raise():
    listing = Listing(source="craigslist", source_id="1", url="https://x/1.html")
    parsed = parse_detail("<html><body>nope</body></html>", listing)
    assert parsed.price is None
    assert parsed.beds is None


# ---- columnar search decoding ----------------------------------------------


class TestDecodeItem:
    def test_decodes_a_representative_row(self, source):
        item = [
            7712345678,
            0,
            2395,
            36.1497,
            -86.8361,
            "Charming 2BR bungalow with fenced yard",
            "(Sylvan Park)",
            "apa/d/nashville-charming-2br-bungalow/7712345678.html",
        ]
        listing = source.decode_item(item)

        assert listing is not None
        assert listing.source_id == "7712345678"
        assert listing.price == 2395
        assert listing.geo.lat == pytest.approx(36.1497)
        assert listing.geo.lon == pytest.approx(-86.8361)
        assert listing.raw_area == "Sylvan Park"
        assert listing.url.endswith("7712345678.html")

    def test_field_order_does_not_matter(self, source):
        """The whole point of type/range-based decoding: CL can reshuffle
        columns without silently swapping price and square footage."""
        shuffled = [
            "(Sylvan Park)",
            -86.8361,
            "Charming 2BR bungalow with fenced yard",
            2395,
            36.1497,
            7712345678,
        ]
        listing = source.decode_item(shuffled)
        assert listing.source_id == "7712345678"
        assert listing.price == 2395
        assert listing.geo.lat == pytest.approx(36.1497)
        assert listing.geo.lon == pytest.approx(-86.8361)

    def test_handles_scaled_integer_coordinates(self, source):
        item = [7712345678, 2395, 36149700, -86836100, "Nice 2BR house in west Nashville"]
        listing = source.decode_item(item)
        assert listing.geo.lat == pytest.approx(36.1497, abs=1e-4)
        assert listing.geo.lon == pytest.approx(-86.8361, abs=1e-4)

    def test_nested_structures_are_flattened(self, source):
        item = [7712345678, {"price": 2395, "geo": [36.1497, -86.8361]},
                ["Charming 2BR bungalow with fenced yard"]]
        listing = source.decode_item(item)
        assert listing.price == 2395
        assert listing.geo.has_point

    def test_row_without_post_id_is_dropped(self, source):
        assert source.decode_item([1, 2, "short"]) is None

    def test_url_falls_back_when_no_slug_present(self, source):
        listing = source.decode_item([7712345678, 2395])
        assert listing is not None
        assert "7712345678" in listing.url
        assert listing.url.startswith("https://nashville.craigslist.org/")

    def test_beds_parsed_from_title(self, source):
        listing = source.decode_item(
            [7712345678, 2395, "Charming 3BR bungalow, 1350 sq ft, fenced yard"]
        )
        assert listing.beds == 3.0
        assert listing.sqft == 1350


class TestItemsOf:
    def test_finds_nested_items(self):
        assert _items_of({"data": {"items": [1, 2]}}) == [1, 2]

    def test_finds_top_level_items(self):
        assert _items_of({"items": [1]}) == [1]

    def test_raises_actionable_error_when_shape_changes(self):
        with pytest.raises(SourceError, match="doctor"):
            _items_of({"unexpected": {}})
