"""End-to-end pipeline behaviour, using a fake source so nothing touches the
network. Covers the failure-isolation guarantees, which are the difference
between a monitor that keeps running and one you have to babysit."""

from __future__ import annotations

from typing import Iterator

import pytest

from nashrent import pipeline
from nashrent.config import SourceConfig
from nashrent.models import ListingStatus
from nashrent.sources.base import Source, SourceError, register
from nashrent.store import Store
from tests.conftest import make_listing


@register
class FakeSource(Source):
    name = "fake"
    blurb = "test double"
    #: Mutated per-test to control what the pipeline sees.
    payload: list = []
    raises: Exception | None = None

    def search(self) -> Iterator:
        if FakeSource.raises is not None:
            raise FakeSource.raises
        yield from FakeSource.payload


@register
class BrokenSource(Source):
    name = "broken"
    blurb = "always fails"

    def search(self) -> Iterator:
        raise SourceError("site markup changed")
        yield  # pragma: no cover


@pytest.fixture(autouse=True)
def reset_fake():
    FakeSource.payload = []
    FakeSource.raises = None
    yield
    FakeSource.payload = []
    FakeSource.raises = None


@pytest.fixture
def cfg(config, tmp_path):
    config.db_path = str(tmp_path / "pipeline.sqlite3")
    config.report_dir = str(tmp_path / "reports")
    config.sources = {"fake": SourceConfig(enabled=True)}
    return config


def test_run_scores_and_persists(cfg):
    FakeSource.payload = [make_listing(source="fake", source_id="1")]

    result = pipeline.run(cfg, enrich=False)

    assert len(result.listings) == 1
    assert len(result.new) == 1
    assert result.listings[0].score.total > 0

    with Store(cfg.db_path) as store:
        assert store.get("fake:1") is not None


def test_second_run_reports_nothing_new(cfg):
    FakeSource.payload = [make_listing(source="fake", source_id="1")]
    pipeline.run(cfg, enrich=False)

    second = pipeline.run(cfg, enrich=False)
    assert second.new == []
    assert len(second.listings) == 1


def test_price_drop_is_reported(cfg):
    FakeSource.payload = [make_listing(source="fake", source_id="1", price=2500)]
    pipeline.run(cfg, enrich=False)

    FakeSource.payload = [make_listing(source="fake", source_id="1", price=2300)]
    result = pipeline.run(cfg, enrich=False)

    assert len(result.price_drops) == 1
    listing, old, new = result.price_drops[0]
    assert (old, new) == (2500, 2300)


def test_price_increase_is_not_a_drop(cfg):
    FakeSource.payload = [make_listing(source="fake", source_id="1", price=2300)]
    pipeline.run(cfg, enrich=False)
    FakeSource.payload = [make_listing(source="fake", source_id="1", price=2500)]
    assert pipeline.run(cfg, enrich=False).price_drops == []


def test_disappeared_listing_is_marked_gone(cfg):
    FakeSource.payload = [make_listing(source="fake", source_id="1")]
    pipeline.run(cfg, enrich=False)

    FakeSource.payload = []
    result = pipeline.run(cfg, enrich=False)

    assert result.gone == 1
    with Store(cfg.db_path) as store:
        assert store.get("fake:1").status is ListingStatus.GONE


def test_a_failing_source_does_not_sink_the_run(cfg):
    cfg.sources["broken"] = SourceConfig(enabled=True)
    FakeSource.payload = [make_listing(source="fake", source_id="1")]

    result = pipeline.run(cfg, enrich=False)

    assert "broken" in result.source_errors
    assert len(result.listings) == 1, "the working source must still deliver"


def test_a_failing_source_does_not_bury_its_previous_listings(cfg):
    """If Zillow breaks, yesterday's Zillow listings must not all be marked
    gone — that would erase the ranked list on a transient failure."""
    cfg.sources["broken"] = SourceConfig(enabled=True)
    FakeSource.payload = [make_listing(source="broken", source_id="b1")]
    pipeline.run(cfg, enrich=False)  # seeds a listing attributed to 'broken'

    FakeSource.payload = []
    pipeline.run(cfg, enrich=False)

    with Store(cfg.db_path) as store:
        assert store.get("broken:b1").status is not ListingStatus.GONE


def test_qualified_excludes_hard_failures_and_sorts_by_score(cfg):
    FakeSource.payload = [
        make_listing(source="fake", source_id="ok", price=2400),
        make_listing(source="fake", source_id="studio", beds=1),
        make_listing(source="fake", source_id="cheap", price=1800),
    ]
    result = pipeline.run(cfg, enrich=False)

    keys = [listing.source_id for listing in result.qualified]
    assert "studio" not in keys
    scores = [listing.score.total for listing in result.qualified]
    assert scores == sorted(scores, reverse=True)


def test_duplicates_across_sources_collapse(cfg):
    FakeSource.payload = [
        make_listing(source="fake", source_id="1", address="4200 Park Ave"),
        make_listing(source="fake", source_id="2", address="4200 Park Avenue"),
    ]
    result = pipeline.run(cfg, enrich=False)
    assert len(result.listings) == 1


def test_neighborhood_resolves_without_enrichment(cfg):
    """With enrichment off we should still get the neighborhood from the
    source's own text, since it carries the largest single weight."""
    listing = make_listing(source="fake", source_id="1", raw_area="(Sylvan Park / West Nashville)")
    listing.geo.neighborhood = None
    listing.geo.lat = listing.geo.lon = None
    FakeSource.payload = [listing]

    result = pipeline.run(cfg, enrich=False)
    assert result.listings[0].geo.neighborhood == "Sylvan Park"


def test_alertable_respects_threshold(cfg):
    cfg.notify.enabled = True
    cfg.notify.min_score = 99
    FakeSource.payload = [make_listing(source="fake", source_id="1")]
    result = pipeline.run(cfg, enrich=False)
    assert pipeline.alertable(result, cfg) == []

    cfg.notify.min_score = 1
    assert len(pipeline.alertable(result, cfg)) == 1


def test_summary_is_human_readable(cfg):
    FakeSource.payload = [make_listing(source="fake", source_id="1")]
    result = pipeline.run(cfg, enrich=False)
    assert "1 homes" in result.summary()
    assert "new" in result.summary()
