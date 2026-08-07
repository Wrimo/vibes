"""The run loop: collect -> dedupe -> enrich -> score -> persist -> notify.

Each stage is failure-isolated. A dead source, a rate-limited Overpass, or
one malformed listing degrades the run rather than ending it — a monitor that
stops monitoring the first time a website changes is worthless.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

from .config import Config
from .dedupe import merge_duplicates
from .enrich import Enricher
from .models import Listing, ListingStatus
from .net import Fetcher
from .score import Scorer
from .sources import SourceError, build_enabled
from .store import Store

log = logging.getLogger(__name__)


@dataclass
class RunResult:
    listings: list[Listing] = field(default_factory=list)
    new: list[Listing] = field(default_factory=list)
    price_drops: list[tuple[Listing, int, int]] = field(default_factory=list)
    per_source: dict[str, int] = field(default_factory=dict)
    source_errors: dict[str, str] = field(default_factory=dict)
    enriched: int = 0
    gone: int = 0
    fetch_stats: dict[str, int] = field(default_factory=dict)

    @property
    def qualified(self) -> list[Listing]:
        """Listings that passed every hard filter, best first."""
        return sorted(
            (listing for listing in self.listings if listing.score.passed),
            key=lambda listing: listing.score.total,
            reverse=True,
        )

    def summary(self) -> str:
        bits = [
            f"{len(self.listings)} homes",
            f"{len(self.qualified)} qualified",
            f"{len(self.new)} new",
        ]
        if self.price_drops:
            bits.append(f"{len(self.price_drops)} price drops")
        if self.source_errors:
            bits.append(f"{len(self.source_errors)} source errors")
        return ", ".join(bits)


def run(
    config: Config,
    *,
    store: Store | None = None,
    enrich: bool = True,
    today: date | None = None,
) -> RunResult:
    result = RunResult()
    owns_store = store is None
    store = store or Store(config.db_path)
    run_id = store.start_run()

    fetcher = Fetcher.from_config(config.net)
    try:
        collected = _collect(config, fetcher, result)
        homes = merge_duplicates(collected)

        if enrich and config.enrich.enabled:
            _enrich(config, fetcher, store, homes, result)
        else:
            # Even without network enrichment, resolve the neighborhood from
            # whatever the source told us so the biggest weight still applies.
            enricher = Enricher(config, fetcher)
            for listing in homes:
                if not listing.geo.neighborhood:
                    listing.geo.neighborhood = enricher.index.resolve_name(
                        listing.raw_area
                    ) or enricher.index.resolve_name(listing.title)

        scorer = Scorer(config)
        for listing in homes:
            try:
                scorer.score(listing, today=today)
            except Exception as exc:
                log.warning("scoring failed for %s: %s", listing.key, exc)

        _persist(store, homes, result)
        result.listings = homes

        polled = {name for name in result.per_source if name not in result.source_errors}
        seen_keys = {listing.key for listing in homes}
        result.gone = store.mark_missing_as_gone(seen_keys, polled)

        result.fetch_stats = fetcher.stats.as_dict()
        store.finish_run(
            run_id,
            found=len(homes),
            new_count=len(result.new),
            stats={
                "per_source": result.per_source,
                "errors": result.source_errors,
                "fetch": result.fetch_stats,
                "enriched": result.enriched,
                "gone": result.gone,
            },
        )
        return result
    finally:
        fetcher.close()
        if owns_store:
            store.close()


def _collect(config: Config, fetcher: Fetcher, result: RunResult) -> list[Listing]:
    sources = build_enabled(config, fetcher)
    if not sources:
        log.warning("no sources are enabled — check config.sources")

    collected: list[Listing] = []
    for source in sources:
        try:
            found = source.collect()
        except SourceError as exc:
            log.error("source %s failed: %s", source.name, exc)
            result.source_errors[source.name] = str(exc)
            result.per_source[source.name] = 0
            continue
        except Exception as exc:
            log.exception("source %s raised unexpectedly", source.name)
            result.source_errors[source.name] = repr(exc)
            result.per_source[source.name] = 0
            continue

        result.per_source[source.name] = len(found)
        collected.extend(found)
        log.info("source %s: %d listings", source.name, len(found))
    return collected


def _enrich(
    config: Config,
    fetcher: Fetcher,
    store: Store,
    homes: list[Listing],
    result: RunResult,
) -> None:
    """Enrich, newest and cheapest first, up to the per-run budget.

    Enrichment is four API calls per address, so we spend that budget on the
    listings most likely to matter and let the cache carry the rest forward.
    """
    enricher = Enricher(config, fetcher)
    budget = config.enrich.max_enrich_per_run

    def priority(listing: Listing) -> tuple[int, int]:
        cached = store.get(listing.key)
        already = bool(cached and cached.enrichment.enriched_at)
        return (1 if already else 0, listing.price or 99999)

    for listing in sorted(homes, key=priority):
        cached = store.get(listing.key)
        if cached and cached.enrichment.enriched_at and cached.geo.has_point:
            # Location facts don't change; reuse them and skip the API calls.
            listing.enrichment = cached.enrichment
            listing.geo = cached.geo if not listing.geo.has_point else listing.geo
            if not listing.geo.neighborhood:
                listing.geo.neighborhood = cached.geo.neighborhood
            continue
        if result.enriched >= budget:
            enricher.locate(listing)  # cheap: cached geocode or area centroid
            continue
        try:
            enricher.enrich(listing)
            result.enriched += 1
        except Exception as exc:
            log.warning("enrichment failed for %s: %s", listing.key, exc)


def _persist(store: Store, homes: list[Listing], result: RunResult) -> None:
    for listing in homes:
        previous = store.get(listing.key)
        outcome = store.upsert(listing)

        if outcome == "new":
            result.new.append(listing)
        elif (
            outcome == "price_changed"
            and previous
            and previous.price
            and listing.price
            and listing.price < previous.price
        ):
            result.price_drops.append((listing, previous.price, listing.price))


def alertable(result: RunResult, config: Config) -> list[Listing]:
    """Listings worth interrupting someone for."""
    threshold = config.notify.min_score
    pool = result.new if config.notify.only_new else result.qualified
    out = [
        listing
        for listing in pool
        if listing.score.passed and listing.score.total >= threshold
    ]
    # A price drop on something already flagged interesting always alerts.
    for listing, old, new in result.price_drops:
        if listing.status is ListingStatus.INTERESTED and listing not in out:
            out.append(listing)
    return sorted(out, key=lambda listing: listing.score.total, reverse=True)
