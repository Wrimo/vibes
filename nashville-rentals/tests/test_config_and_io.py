"""Config loading, the shipped profile, the CSV source, and report rendering."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from nashrent.config import Config, SourceConfig
from nashrent.models import HomeType
from nashrent.net import Fetcher
from nashrent.pipeline import RunResult
from nashrent.report import to_markdown, write_html
from nashrent.score import Scorer
from nashrent.sources.csvfile import CsvSource, write_template
from tests.conftest import full_enrichment, make_listing

REPO_CONFIG = Path(__file__).resolve().parents[1] / "config" / "search.yaml"


# ---- config ----------------------------------------------------------------


def test_shipped_config_loads_and_is_coherent():
    """The config file in the repo must actually work — it's the first thing
    anyone runs."""
    config = Config.load(REPO_CONFIG)

    assert config.budget.max_price == 2500
    assert config.budget.stretch_price >= config.budget.max_price
    assert config.requirements.min_beds >= 2
    assert len(config.anchors) == 2
    assert {a.name for a in config.anchors} == {"work-downtown", "partner-green-hills"}
    assert sum(config.normalized_weights().values()) == pytest.approx(100.0)


def test_shipped_config_tiers_are_all_scored():
    config = Config.load(REPO_CONFIG)
    for tier in config.neighborhoods.tiers:
        assert tier in config.neighborhoods.tier_scores, f"tier {tier} has no score"


def test_shipped_config_prefers_west_nashville_over_bellevue():
    config = Config.load(REPO_CONFIG)
    _, sylvan = config.tier_of("Sylvan Park")
    _, green_hills = config.tier_of("Green Hills")
    _, bellevue = config.tier_of("Bellevue")
    assert sylvan > green_hills > bellevue


def test_blocklist_is_enforced():
    config = Config.load(REPO_CONFIG)
    assert config.is_blocked("Murfreesboro")
    assert not config.is_blocked("Sylvan Park")


def test_env_vars_expand(tmp_path, monkeypatch):
    monkeypatch.setenv("TEST_TOKEN", "sekrit")
    path = tmp_path / "c.yaml"
    path.write_text("enrich:\n  socrata_app_token: '${TEST_TOKEN}'\n")
    assert Config.load(path).enrich.socrata_app_token == "sekrit"


def test_missing_config_gives_an_actionable_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="--config"):
        Config.load(tmp_path / "nope.yaml")


def test_zero_weights_are_rejected(config):
    for field in type(config.weights).model_fields:
        setattr(config.weights, field, 0)
    with pytest.raises(ValueError):
        config.normalized_weights()


def test_unknown_neighborhood_gets_the_default_score(config):
    tier, value = config.tier_of("Nowheresville")
    assert tier is None
    assert value == config.neighborhoods.unknown_score


# ---- CSV source ------------------------------------------------------------


def test_csv_template_roundtrips(tmp_path, config):
    path = tmp_path / "manual.csv"
    write_template(path)

    source = CsvSource(config, SourceConfig(enabled=True, options={"path": str(path)}),
                       Fetcher(cache_dir=None))
    listings = list(source.search())

    assert len(listings) == 1
    listing = listings[0]
    assert listing.price == 2450
    assert listing.beds == 2
    assert listing.sqft == 1400
    assert listing.home_type is HomeType.HOUSE
    assert listing.raw_area == "Sylvan Park"
    assert listing.available_date.isoformat() == "2027-03-01"


def test_csv_infers_missing_fields_from_text(tmp_path, config):
    path = tmp_path / "manual.csv"
    path.write_text(
        "url,title,notes\n"
        "https://example.com/9,3BR duplex 1600 sq ft,"
        "\"Big deck and fenced yard, $2350 a month\"\n"
    )
    source = CsvSource(config, SourceConfig(enabled=True, options={"path": str(path)}),
                       Fetcher(cache_dir=None))
    listing = list(source.search())[0]

    assert listing.beds == 3
    assert listing.sqft == 1600
    assert listing.price == 2350
    assert listing.home_type is HomeType.DUPLEX


def test_csv_source_id_is_stable_across_reordering(tmp_path, config):
    def ids(content: str) -> list[str]:
        path = tmp_path / "m.csv"
        path.write_text(content)
        source = CsvSource(config, SourceConfig(enabled=True, options={"path": str(path)}),
                           Fetcher(cache_dir=None))
        return [listing.source_id for listing in source.search()]

    a = ids("url\nhttps://example.com/1\nhttps://example.com/2\n")
    b = ids("url\nhttps://example.com/2\nhttps://example.com/1\n")
    assert set(a) == set(b)


def test_csv_skips_rows_without_a_url(tmp_path, config):
    path = tmp_path / "m.csv"
    path.write_text("url,title\n,No URL here\nhttps://example.com/1,Fine\n")
    source = CsvSource(config, SourceConfig(enabled=True, options={"path": str(path)}),
                       Fetcher(cache_dir=None))
    assert len(list(source.search())) == 1


def test_missing_csv_file_is_not_an_error(tmp_path, config):
    source = CsvSource(
        config, SourceConfig(enabled=True, options={"path": str(tmp_path / "absent.csv")}),
        Fetcher(cache_dir=None),
    )
    assert list(source.search()) == []


# ---- reporting -------------------------------------------------------------


@pytest.fixture
def scored_result(config):
    listings = []
    for i, (price, hood) in enumerate([(2400, "Sylvan Park"), (2600, "Green Hills")]):
        listing = make_listing(source_id=str(i), price=price)
        listing.geo.neighborhood = hood
        listing.enrichment = full_enrichment()
        Scorer(config).score(listing)
        listings.append(listing)
    return RunResult(listings=listings, new=[listings[0]], per_source={"test": 2})


def test_html_report_renders(scored_result, config, tmp_path):
    config.report_dir = str(tmp_path)
    path = write_html(scored_result, config)

    html = path.read_text()
    assert "Sylvan Park" in html
    assert "NEW" in html
    assert "hosting space" in html          # component names are humanized
    assert "data.nashville.gov" in html     # safety data is attributed
    assert html.count("<div class=\"card\">") >= 2


def test_html_report_escapes_listing_text(scored_result, config, tmp_path):
    config.report_dir = str(tmp_path)
    scored_result.listings[0].title = "<script>alert('xss')</script>"
    html = write_html(scored_result, config).read_text()
    assert "<script>alert" not in html
    assert "&lt;script&gt;" in html


def test_markdown_digest(scored_result):
    md = to_markdown(scored_result.qualified)
    assert md.startswith("| # | Score |")
    assert "Sylvan Park" in md
    assert md.count("\n") >= 3


def test_markdown_handles_pipes_in_titles(scored_result):
    scored_result.listings[0].title = "2BR | big yard"
    md = to_markdown(scored_result.qualified)
    # A raw pipe would break the table.
    assert "2BR / big yard" in md
