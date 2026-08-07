"""Scoring behaviour — the part most worth locking down, since it encodes
the actual preferences and is easy to break while tuning weights."""

from __future__ import annotations

from datetime import date

import pytest

from nashrent.models import HomeType
from nashrent.score import Scorer, ramp
from tests.conftest import full_enrichment, make_listing


def test_ramp_clamps_and_reverses():
    assert ramp(50, 0, 100) == 0.5
    assert ramp(-10, 0, 100) == 0.0
    assert ramp(200, 0, 100) == 1.0
    # Reversed: lower input is better (as with price per sqft).
    assert ramp(1.5, 2.6, 1.5) == 1.0
    assert ramp(2.6, 2.6, 1.5) == 0.0
    assert ramp(None, 0, 1) is None


def test_baseline_listing_scores_well(config):
    listing = make_listing()
    listing.enrichment = full_enrichment()
    score = Scorer(config).score(listing)

    assert score.passed
    assert score.coverage == pytest.approx(1.0, abs=0.01)
    assert score.total > 75, f"expected a strong score, got {score.total}"


# ---- hard filters ----------------------------------------------------------


def test_one_bedroom_is_disqualified(config):
    score = Scorer(config).score(make_listing(beds=1))
    assert not score.passed
    assert any("bed" in f for f in score.hard_fails)


def test_over_stretch_budget_is_disqualified(config):
    score = Scorer(config).score(make_listing(price=3200))
    assert not score.passed
    assert any("stretch cap" in f for f in score.hard_fails)


def test_stretch_zone_survives_but_loses_points(config):
    scorer = Scorer(config)
    in_budget = scorer.score(make_listing(price=2400)).component("price_value")
    stretched = scorer.score(make_listing(price=2700)).component("price_value")

    assert stretched.points < in_budget.points
    # Still a candidate, not a rejection.
    assert scorer.score(make_listing(price=2700)).passed


def test_blocked_neighborhood_is_disqualified(config):
    listing = make_listing()
    listing.geo.neighborhood = "Murfreesboro"
    score = Scorer(config).score(listing)
    assert not score.passed
    assert any("commute area" in f for f in score.hard_fails)


# ---- component behaviour ---------------------------------------------------


def test_neighborhood_tiers_are_ordered(config):
    scorer = Scorer(config)

    def hood_points(name: str) -> float:
        listing = make_listing()
        listing.geo.neighborhood = name
        return scorer.score(listing).component("neighborhood").points

    assert hood_points("Sylvan Park") > hood_points("Green Hills")
    assert hood_points("Green Hills") > hood_points("East Nashville")
    assert hood_points("East Nashville") > hood_points("Bellevue")


def test_house_beats_apartment_all_else_equal(config):
    scorer = Scorer(config)
    house = make_listing(home_type=HomeType.HOUSE)
    apartment = make_listing(home_type=HomeType.APARTMENT)
    house.enrichment = apartment.enrichment = full_enrichment()

    assert scorer.score(house).total > scorer.score(apartment).total


def test_hosting_signals_beat_raw_square_footage(config):
    """A smaller place built for gatherings should outrank a bigger blank box."""
    scorer = Scorer(config)

    hosting = make_listing(
        sqft=1300,
        description="Open concept great room, huge fenced yard, deck and fire pit, "
        "separate dining room, kitchen island.",
    )
    plain = make_listing(sqft=1550, description="Two bedroom home. Refrigerator included.")

    a = scorer.score(hosting).component("hosting_space")
    b = scorer.score(plain).component("hosting_space")
    assert a.points > b.points


def test_no_parties_language_penalizes_hosting(config):
    scorer = Scorer(config)
    normal = make_listing(description="Open floor plan with a big deck.")
    restricted = make_listing(
        description="Open floor plan with a big deck. Quiet building, no parties."
    )
    assert (
        scorer.score(restricted).component("hosting_space").points
        < scorer.score(normal).component("hosting_space").points
    )


def test_commute_protects_the_worse_of_the_two(config):
    """A lopsided pair must lose to a balanced pair with the same total."""
    scorer = Scorer(config)

    balanced = make_listing()
    balanced.enrichment = full_enrichment(commute_downtown_min=20, commute_partner_min=20)

    lopsided = make_listing()
    lopsided.enrichment = full_enrichment(commute_downtown_min=8, commute_partner_min=32)

    assert (
        scorer.score(balanced).component("commute").points
        > scorer.score(lopsided).component("commute").points
    )


def test_cheaper_per_sqft_scores_better(config):
    scorer = Scorer(config)
    roomy = make_listing(price=2400, sqft=1800)
    cramped = make_listing(price=2400, sqft=1000)
    assert (
        scorer.score(roomy).component("price_value").points
        > scorer.score(cramped).component("price_value").points
    )


def test_walkability_rewards_nearby_park_and_density(config):
    scorer = Scorer(config)
    walkable = make_listing()
    walkable.enrichment = full_enrichment(
        nearest_park_m=200, walk_amenity_count=38, sidewalk_ratio=0.6, intersection_density=120
    )
    isolated = make_listing()
    isolated.enrichment = full_enrichment(
        nearest_park_m=1200, walk_amenity_count=3, sidewalk_ratio=0.05,
        intersection_density=20, greenway_within_1km=False,
    )
    assert (
        scorer.score(walkable).component("walkability").points
        > scorer.score(isolated).component("walkability").points
    )


# ---- coverage --------------------------------------------------------------


def test_missing_enrichment_lowers_coverage_not_score(config):
    """An un-enriched listing must not be punished into irrelevance —
    it should score on what's known and report low coverage."""
    scorer = Scorer(config)

    bare = make_listing()  # no enrichment at all
    enriched = make_listing()
    enriched.enrichment = full_enrichment()

    bare_score = scorer.score(bare)
    rich_score = scorer.score(enriched)

    assert bare_score.coverage < 0.7
    assert rich_score.coverage == pytest.approx(1.0, abs=0.01)
    # Still a usable, comparable number rather than a near-zero.
    assert bare_score.total > 50
    assert any("provisional" in w for w in bare_score.warnings)


def test_components_never_exceed_their_weight(config):
    listing = make_listing(price=1000, sqft=2400, beds=4)
    listing.enrichment = full_enrichment(
        commute_downtown_min=5, commute_partner_min=5, safety_percentile=100,
        walk_amenity_count=90, bars_within_1200m=40, restaurants_within_1200m=60,
    )
    score = Scorer(config).score(listing)
    for component in score.components:
        assert 0 <= component.points <= component.weight + 1e-6
    assert score.total <= 100.0


def test_weights_normalize_to_100(config):
    assert sum(config.normalized_weights().values()) == pytest.approx(100.0)


# ---- timing ----------------------------------------------------------------


def test_availability_near_target_is_noted_not_penalized(config):
    scorer = Scorer(config)
    on_time = make_listing(available_date=date(2027, 3, 15))
    early = make_listing(available_date=date(2026, 9, 1))

    on_score = scorer.score(on_time, today=date(2026, 8, 7))
    early_score = scorer.score(early, today=date(2026, 8, 7))

    assert any("lines up" in w for w in on_score.warnings)
    assert any("comp, not a candidate" in w for w in early_score.warnings)
    # Timing is advisory: it must not change the number.
    assert on_score.total == early_score.total
