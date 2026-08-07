from __future__ import annotations

from datetime import date

import pytest

from nashrent.models import HomeType, normalize_address
from nashrent.sources.extract import (
    find_available_date,
    find_baths,
    find_beds,
    find_price,
    find_sqft,
    hosting_signals,
    infer_home_type,
    parse_epoch,
)


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Charming 2BR bungalow, single family home", HomeType.HOUSE),
        ("Spacious townhome near Sylvan Park", HomeType.TOWNHOUSE),
        ("Half of a duplex, private entrance", HomeType.DUPLEX),
        ("Luxury condo in The Gulch", HomeType.CONDO),
        ("1BR apartment, leasing office on site", HomeType.APARTMENT),
        ("", HomeType.UNKNOWN),
    ],
)
def test_infer_home_type(text, expected):
    assert infer_home_type(text) is expected


def test_house_language_beats_incidental_apartment_mention():
    """'no apartment living' is a house listing, not an apartment."""
    text = "Detached single family house — no apartment living here!"
    assert infer_home_type(text) is HomeType.HOUSE


@pytest.mark.parametrize(
    "text,expected",
    [("1200 sq ft", 1200), ("1,450 sqft home", 1450), ("980 square feet", 980),
     ("2000sf", 2000), ("no numbers here", None), ("50 sq ft", None),
     # Craigslist renders this as 1350ft<sup>2</sup>.
     ("1350ft 2", 1350)],
)
def test_find_sqft(text, expected):
    assert find_sqft(text) == expected


def test_find_beds_and_baths():
    assert find_beds("3BR / 2Ba") == 3.0
    assert find_baths("3BR / 2Ba") == 2.0
    assert find_beds("studio apartment") == 0.0
    assert find_beds("nothing") is None
    assert find_baths("1.5 bath") == 1.5


def test_find_price_ignores_implausible_values():
    assert find_price("$2,450 / month") == 2450
    assert find_price("$150 application fee") is None   # too low for rent
    assert find_price("$450,000 home value") is None    # a sale price


class TestAvailableDate:
    def test_available_now(self):
        today = date(2026, 8, 7)
        assert find_available_date("available now", today) == today

    def test_numeric_with_year(self):
        assert find_available_date("available 3/1/2027", date(2026, 8, 7)) == date(2027, 3, 1)

    def test_month_name(self):
        assert find_available_date(
            "Available March 1, 2027", date(2026, 8, 7)
        ) == date(2027, 3, 1)

    def test_bare_date_rolls_to_next_occurrence(self):
        # In August 2026, "available 3/1" means March 2027.
        assert find_available_date("available 3/1", date(2026, 8, 7)) == date(2027, 3, 1)

    def test_invalid_date_returns_none(self):
        assert find_available_date("available 13/45", date(2026, 8, 7)) is None

    def test_no_date_returns_none(self):
        assert find_available_date("call for details") is None


def test_hosting_signals_detects_entertaining_features():
    signals, penalties = hosting_signals(
        "Open concept living, large fenced yard, huge deck, formal dining room."
    )
    assert "open_plan" in signals
    assert "fenced_yard" in signals
    assert "outdoor_space" in signals
    assert "dining_room" in signals
    assert penalties == []


def test_hosting_signals_detects_penalties():
    _, penalties = hosting_signals("Shared kitchen. Quiet building, no parties.")
    assert "shared_space" in penalties
    assert "no_parties" in penalties


def test_parse_epoch_accepts_seconds_and_millis():
    assert parse_epoch(1_700_000_000) is not None
    assert parse_epoch(1_700_000_000_000) is not None
    assert parse_epoch(42) is None
    assert parse_epoch("not a number") is None


# ---- address normalization -------------------------------------------------


def test_normalize_address_collapses_variants():
    a = normalize_address("1802 South Wilson Blvd., Nashville, TN 37212")
    b = normalize_address("1802 S Wilson Boulevard")
    assert a == b == "1802 s wilson blvd"


def test_normalize_address_drops_unit_designators():
    assert normalize_address("400 Park Ave Apt 3B") == normalize_address("400 Park Avenue")


def test_normalize_address_keeps_distinct_addresses_distinct():
    assert normalize_address("400 Park Ave") != normalize_address("401 Park Ave")
