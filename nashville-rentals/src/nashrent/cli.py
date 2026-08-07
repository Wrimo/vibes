"""Command line interface."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from rich.console import Console
from rich.logging import RichHandler
from rich.table import Table

from . import pipeline, report as report_mod
from .config import Config
from .enrich import Enricher
from .models import ListingStatus
from .net import Fetcher
from .notify import notify
from .score import Scorer
from .sources import available, build_enabled
from .sources.csvfile import write_template
from .store import Store

console = Console()


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(message)s",
        handlers=[RichHandler(console=console, show_path=args.verbose, rich_tracebacks=True)],
    )
    # Third-party chatter is never what you want to see here.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)

    try:
        return args.func(args)
    except FileNotFoundError as exc:
        console.print(f"[red]{exc}[/red]")
        return 2
    except KeyboardInterrupt:
        console.print("\n[dim]interrupted[/dim]")
        return 130


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="nashrent",
        description="Monitor Nashville homes for rent against a personal fit profile.",
    )
    parser.add_argument("-c", "--config", default="config/search.yaml", help="config file")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="scrape, score and store a fresh snapshot")
    p_run.add_argument("--no-enrich", action="store_true", help="skip geo/API enrichment")
    p_run.add_argument("--html", action="store_true", help="also write the HTML report")
    p_run.add_argument("--notify", action="store_true", help="send alerts for new top matches")
    p_run.add_argument("--limit", type=int, default=20, help="rows to print")
    p_run.set_defaults(func=cmd_run)

    p_report = sub.add_parser("report", help="re-render from the database, no network")
    p_report.add_argument("--limit", type=int, default=25)
    p_report.add_argument("--html", action="store_true")
    p_report.add_argument("--all", action="store_true", help="include filtered-out listings")
    p_report.set_defaults(func=cmd_report)

    p_rescore = sub.add_parser("rescore", help="re-score stored listings after a config change")
    p_rescore.set_defaults(func=cmd_rescore)

    p_sources = sub.add_parser("sources", help="list source adapters")
    p_sources.set_defaults(func=cmd_sources)

    p_doctor = sub.add_parser("doctor", help="check which sources and APIs work from here")
    p_doctor.add_argument("--dump", metavar="SOURCE", help="save a raw payload for debugging")
    p_doctor.set_defaults(func=cmd_doctor)

    p_status = sub.add_parser("status", help="database summary")
    p_status.set_defaults(func=cmd_status)

    p_comps = sub.add_parser("comps", help="median asking rent by neighborhood, from your data")
    p_comps.set_defaults(func=cmd_comps)

    p_mark = sub.add_parser("mark", help="set a listing's triage status")
    p_mark.add_argument("key", help="listing key, e.g. craigslist:7712345678")
    p_mark.add_argument("status", choices=[s.value for s in ListingStatus])
    p_mark.add_argument("--note", default=None)
    p_mark.set_defaults(func=cmd_mark)

    p_csv = sub.add_parser("init-csv", help="write a manual-listings CSV template")
    p_csv.add_argument("path", nargs="?", default="config/manual-listings.csv")
    p_csv.set_defaults(func=cmd_init_csv)

    return parser


# ---- commands --------------------------------------------------------------


def cmd_run(args: argparse.Namespace) -> int:
    config = Config.load(args.config)
    result = pipeline.run(config, enrich=not args.no_enrich)

    report_mod.print_run(result, config, console, limit=args.limit)

    if args.html:
        path = report_mod.write_html(result, config)
        console.print(f"\n  [dim]HTML report:[/dim] {path}")

    if args.notify:
        targets = pipeline.alertable(result, config)
        if targets:
            channels = notify(targets, config)
            console.print(
                f"  [dim]alerted on {len(targets)} listing(s) via "
                f"{', '.join(channels) or 'no channel (check notify config)'}[/dim]"
            )

    # A run where every source failed is a failed run, and should be visible
    # to whatever scheduler invoked it.
    if result.source_errors and len(result.source_errors) == len(result.per_source):
        return 1
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    config = Config.load(args.config)
    with Store(config.db_path) as store:
        listings = store.all(include_failed=args.all)
        result = pipeline.RunResult(listings=listings)
        result.per_source = _count_by_source(listings)
        report_mod.print_run(result, config, console, limit=args.limit)
        if args.html:
            path = report_mod.write_html(result, config)
            console.print(f"\n  [dim]HTML report:[/dim] {path}")
    return 0


def cmd_rescore(args: argparse.Namespace) -> int:
    config = Config.load(args.config)
    scorer = Scorer(config)
    with Store(config.db_path) as store:
        listings = store.all(include_failed=True)
        for listing in listings:
            listing.score.warnings.clear()
            listing.score.hard_fails.clear()
            scorer.score(listing)
            store.upsert(listing)
    console.print(f"  re-scored {len(listings)} listing(s)")
    return 0


def cmd_sources(args: argparse.Namespace) -> int:
    config = Config.load(args.config)
    table = Table(box=None, header_style="bold")
    table.add_column("Source")
    table.add_column("Enabled")
    table.add_column("Proxy?")
    table.add_column("Notes")
    for name, cls in sorted(available().items()):
        cfg = config.sources.get(name)
        enabled = bool(cfg and cfg.enabled)
        table.add_row(
            name,
            "[green]yes[/green]" if enabled else "[dim]no[/dim]",
            "[yellow]residential IP[/yellow]" if cls.needs_proxy else "—",
            cls.blurb,
        )
    console.print()
    console.print(table)
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    """Smoke-test every enabled source and enrichment API from this machine.

    Scrapers rot and networks differ; this answers "what actually works from
    here, right now" in one command instead of a failed nightly run.
    """
    config = Config.load(args.config)
    failures = 0

    console.print("\n[bold]Sources[/bold]")
    with Fetcher.from_config(config.net) as fetcher:
        for source in build_enabled(config, fetcher):
            try:
                found = list(_take(source.search(), 3))
            except Exception as exc:
                failures += 1
                console.print(f"  [red]✗[/red] {source.name}: {str(exc).splitlines()[0][:160]}")
                continue
            if found:
                sample = found[0]
                console.print(
                    f"  [green]✓[/green] {source.name}: {len(found)} sample listing(s), "
                    f"e.g. {sample.price and '$' + format(sample.price, ',') or '?'} "
                    f"{sample.title[:48]!r}"
                )
            else:
                console.print(f"  [yellow]○[/yellow] {source.name}: reachable but returned nothing")

        if args.dump:
            _dump_raw(config, fetcher, args.dump)

        console.print("\n[bold]Enrichment APIs[/bold]")
        enricher = Enricher(config, fetcher)
        # A known address in Sylvan Park, used purely as a probe.
        probe_lat, probe_lon = 36.1497, -86.8361

        checks = [
            ("geocode", lambda: enricher.geocoder.geocode("4200 Park Ave, Nashville, TN")),
            ("amenities", lambda: _probe_amenities(enricher, probe_lat, probe_lon)),
            ("commute", lambda: enricher.commute.route_all(probe_lat, probe_lon)),
            ("safety", lambda: enricher.safety.incident_count(probe_lat, probe_lon)),
        ]
        for name, fn in checks:
            if name not in enricher.enabled:
                console.print(f"  [dim]−[/dim] {name}: disabled in config")
                continue
            try:
                value = fn()
            except Exception as exc:
                failures += 1
                console.print(f"  [red]✗[/red] {name}: {str(exc).splitlines()[0][:160]}")
                continue
            if value:
                console.print(f"  [green]✓[/green] {name}: {str(value)[:110]}")
            else:
                failures += 1
                # Providers swallow their own network errors so a run survives
                # them, which means "no data" here covers both a blocked host
                # and a genuine empty result. The logged warning above says which.
                console.print(
                    f"  [yellow]○[/yellow] {name}: no usable data "
                    f"(see the warning above — blocked host, rate limit, or schema change)"
                )

    console.print()
    if failures:
        console.print(f"  [yellow]{failures} check(s) need attention.[/yellow] "
                      f"Blocked sources can be disabled in config without affecting the rest.")
    else:
        console.print("  [green]Everything checks out.[/green]")
    return 1 if failures else 0


def cmd_status(args: argparse.Namespace) -> int:
    config = Config.load(args.config)
    with Store(config.db_path) as store:
        stats = store.stats()
    console.print()
    for key, value in stats.items():
        label = key.replace("_", " ")
        shown = f"${value:,}" if "price" in key and value else value
        console.print(f"  {label:<12} {shown}")
    return 0


def cmd_comps(args: argparse.Namespace) -> int:
    """Median asking rent per neighborhood, from everything you've collected.

    This is the quiet payoff of running the monitor months before you move:
    by January you'll know what $2,500 actually buys in Sylvan Park.
    """
    config = Config.load(args.config)
    with Store(config.db_path) as store:
        rows = store.neighborhood_medians()

    if not rows:
        console.print("\n  [dim]No data yet — run `nashrent run` a few times.[/dim]")
        return 0

    table = Table(box=None, header_style="bold")
    table.add_column("Neighborhood")
    table.add_column("Listings", justify="right")
    table.add_column("Median ask", justify="right")
    table.add_column("Tier")
    for name, count, median in rows:
        tier, _ = config.tier_of(name)
        table.add_row(name, str(count), f"${median:,.0f}", tier or "—")
    console.print()
    console.print(table)
    return 0


def cmd_mark(args: argparse.Namespace) -> int:
    config = Config.load(args.config)
    with Store(config.db_path) as store:
        ok = store.set_status(args.key, ListingStatus(args.status), args.note)
    if ok:
        console.print(f"  {args.key} -> {args.status}")
        return 0
    console.print(f"  [red]no listing with key {args.key}[/red]")
    return 1


def cmd_init_csv(args: argparse.Namespace) -> int:
    path = Path(args.path)
    if path.exists():
        console.print(f"  [yellow]{path} already exists — not overwriting[/yellow]")
        return 1
    write_template(path)
    console.print(f"  wrote {path}")
    return 0


# ---- helpers ---------------------------------------------------------------


def _take(iterator, n: int):
    for i, item in enumerate(iterator):
        if i >= n:
            return
        yield item


def _probe_amenities(enricher: Enricher, lat: float, lon: float):
    """Return a summary only if the provider actually populated something —
    an all-None dict is still truthy, which would report a false success."""
    from .models import Enrichment

    probe = Enrichment()
    if not enricher.amenities.enrich(lat, lon, probe):
        return None
    return {
        "parks": probe.parks_within_1km,
        "bars": probe.bars_within_1200m,
        "restaurants": probe.restaurants_within_1200m,
    }


def _dump_raw(config: Config, fetcher: Fetcher, source_name: str) -> None:
    """Save a raw source payload so a broken parser can be re-fitted fast."""
    out = Path(config.report_dir) / f"raw-{source_name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)

    if source_name == "craigslist":
        from .sources.craigslist import SAPI

        opts = (config.sources.get("craigslist") or type("x", (), {"options": {}})()).options
        payload = fetcher.get_json(
            SAPI,
            params={
                "batch": f"{opts.get('area_id', 25)}-0-360-0-0",
                "cc": "US",
                "lang": "en",
                "searchPath": opts.get("search_path", "apa"),
                "min_price": config.budget.min_price,
                "max_price": config.budget.stretch_price,
            },
            force=True,
        )
        out.write_text(json.dumps(payload, indent=2)[:2_000_000])
        console.print(f"  [dim]raw payload written to {out}[/dim]")
    else:
        console.print(f"  [yellow]no dump routine for {source_name}[/yellow]")


def _count_by_source(listings) -> dict[str, int]:
    counts: dict[str, int] = {}
    for listing in listings:
        counts[listing.source] = counts.get(listing.source, 0) + 1
    return counts


if __name__ == "__main__":
    sys.exit(main())
