from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from nashrent.config import (
    Anchor,
    BudgetConfig,
    Config,
    EnrichConfig,
    NeighborhoodConfig,
    RequirementsConfig,
    WeightsConfig,
)
from nashrent.models import Enrichment, Geo, HomeType, Listing

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def config() -> Config:
    """A profile matching the real search, but self-contained."""
    return Config(
        db_path=":memory:",
        budget=BudgetConfig(max_price=2500, stretch_price=2800, min_price=900),
        requirements=RequirementsConfig(
            min_beds=2,
            min_baths=1,
            hosting_target_sqft=1500,
            target_move_in=date(2027, 3, 1),
            move_in_window_days=45,
        ),
        anchors=[
            Anchor(name="work-downtown", lat=36.1627, lon=-86.7816, max_minutes=25),
            Anchor(name="partner-green-hills", lat=36.1047, lon=-86.8158, max_minutes=25),
        ],
        neighborhoods=NeighborhoodConfig(
            tiers={
                "bullseye": ["Sylvan Park", "The Nations", "Sylvan Heights"],
                "strong": ["Green Hills", "12 South", "Belmont-Hillsboro"],
                "good": ["East Nashville", "Germantown"],
                "far": ["Bellevue", "Antioch"],
            },
            tier_scores={"bullseye": 1.0, "strong": 0.85, "good": 0.68, "far": 0.22},
            blocklist=["Murfreesboro", "Franklin"],
        ),
        weights=WeightsConfig(),
        enrich=EnrichConfig(enabled=False),
    )


def make_listing(**overrides) -> Listing:
    """A qualifying baseline listing; override just what a test cares about."""
    defaults = dict(
        source="test",
        source_id="1",
        url="https://example.com/1",
        title="Charming 2BR bungalow in Sylvan Park",
        price=2400,
        beds=2.0,
        baths=2.0,
        sqft=1450,
        home_type=HomeType.HOUSE,
        address="4200 Park Ave, Nashville, TN",
        description="Open floor plan, large fenced yard, big deck for entertaining.",
    )
    defaults.update(overrides)
    listing = Listing(**defaults)
    if "geo" not in overrides:
        listing.geo = Geo(lat=36.1497, lon=-86.8361, neighborhood="Sylvan Park")
    return listing


def full_enrichment(**overrides) -> Enrichment:
    """Enrichment with every field populated, so coverage hits 100%."""
    defaults = dict(
        commute_downtown_min=14.0,
        commute_partner_min=13.0,
        parks_within_1km=3,
        nearest_park_m=300.0,
        nearest_park_name="Richland Park",
        greenway_within_1km=True,
        bars_within_1200m=6,
        restaurants_within_1200m=18,
        cafes_within_1200m=4,
        grocery_within_1600m=2,
        intersection_density=95.0,
        sidewalk_ratio=0.45,
        walk_amenity_count=30,
        incidents_per_1k_year=40.0,
        safety_percentile=72.0,
        safety_sample_size=80,
    )
    defaults.update(overrides)
    return Enrichment(**defaults)


@pytest.fixture
def listing():
    return make_listing()
