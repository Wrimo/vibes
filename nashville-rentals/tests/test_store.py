from __future__ import annotations

import pytest

from nashrent.models import ListingStatus
from nashrent.store import Store
from tests.conftest import make_listing


@pytest.fixture
def store(tmp_path) -> Store:
    with Store(tmp_path / "test.sqlite3") as s:
        yield s


def test_first_insert_is_new_then_updated(store):
    listing = make_listing()
    assert store.upsert(listing) == "new"
    assert store.upsert(make_listing()) == "updated"


def test_price_change_is_detected(store):
    store.upsert(make_listing(price=2400))
    assert store.upsert(make_listing(price=2300)) == "price_changed"


def test_roundtrip_preserves_the_full_model(store):
    listing = make_listing()
    listing.enrichment.commute_downtown_min = 14.0
    store.upsert(listing)

    loaded = store.get(listing.key)
    assert loaded is not None
    assert loaded.title == listing.title
    assert loaded.geo.neighborhood == "Sylvan Park"
    assert loaded.enrichment.commute_downtown_min == 14.0
    assert loaded.home_type is listing.home_type


def test_manual_triage_survives_a_rescrape(store):
    """The whole point of persistence: a listing you rejected must not come
    back as 'new' on the next run."""
    listing = make_listing()
    store.upsert(listing)
    store.set_status(listing.key, ListingStatus.REJECTED, "too close to the interstate")

    store.upsert(make_listing(price=2350))

    reloaded = store.get(listing.key)
    assert reloaded.status is ListingStatus.REJECTED
    assert "interstate" in reloaded.notes


def test_first_seen_is_preserved_across_updates(store):
    listing = make_listing()
    store.upsert(listing)
    original = store.get(listing.key).first_seen

    store.upsert(make_listing(price=2350))
    assert store.get(listing.key).first_seen == original


def test_price_history_accumulates(store):
    listing = make_listing(price=2400)
    store.upsert(listing)
    history = store.price_history(listing.key)
    assert history and history[-1][1] == 2400


def test_mark_missing_as_gone_only_touches_polled_sources(store):
    kept = make_listing(source="zillow", source_id="z1")
    stale = make_listing(source="craigslist", source_id="c1")
    store.upsert(kept)
    store.upsert(stale)

    # Only craigslist ran this time, and it didn't return c1.
    store.mark_missing_as_gone(seen_keys=set(), sources={"craigslist"})

    assert store.get(stale.key).status is ListingStatus.GONE
    assert store.get(kept.key).status is not ListingStatus.GONE


def test_gone_listing_that_reappears_is_marked_seen(store):
    listing = make_listing()
    store.upsert(listing)
    store.mark_missing_as_gone(seen_keys=set(), sources={"test"})
    assert store.get(listing.key).status is ListingStatus.GONE

    store.upsert(make_listing())
    assert store.get(listing.key).status is ListingStatus.SEEN


def test_rejected_listings_are_never_marked_gone(store):
    listing = make_listing()
    store.upsert(listing)
    store.set_status(listing.key, ListingStatus.REJECTED)
    store.mark_missing_as_gone(seen_keys=set(), sources={"test"})
    assert store.get(listing.key).status is ListingStatus.REJECTED


def test_all_excludes_hard_failures_by_default(store):
    good = make_listing(source_id="good")
    bad = make_listing(source_id="bad")
    bad.score.hard_fails = ["1 bed(s), need 2"]

    store.upsert(good)
    store.upsert(bad)

    assert [listing.source_id for listing in store.all()] == ["good"]
    assert len(store.all(include_failed=True)) == 2


def test_neighborhood_medians(store):
    for i, price in enumerate([2200, 2400, 2600]):
        listing = make_listing(source_id=f"s{i}", price=price)
        store.upsert(listing)

    rows = store.neighborhood_medians()
    assert rows[0][0] == "Sylvan Park"
    assert rows[0][1] == 3
    assert rows[0][2] == 2400


def test_stats(store):
    store.upsert(make_listing())
    stats = store.stats()
    assert stats["listings"] == 1
    assert stats["avg_price"] == 2400


def test_run_bookkeeping(store):
    run_id = store.start_run()
    store.finish_run(run_id, found=5, new_count=2, stats={"ok": True})
    assert store.stats()["runs"] == 1
