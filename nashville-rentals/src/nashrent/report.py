"""Reporting: a terminal table for triage, an HTML page for browsing.

The HTML report is the thing you actually open on a Saturday morning, so it
leads with the score breakdown — "why is this ranked third?" should never
require reading code.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, StrictUndefined
from rich.console import Console
from rich.table import Table
from rich.text import Text

from .config import Config
from .models import Listing
from .pipeline import RunResult

_TEMPLATE = Path(__file__).parent / "templates" / "report.html.j2"


def print_run(result: RunResult, config: Config, console: Console | None = None,
              limit: int = 20) -> None:
    console = console or Console()

    console.print()
    console.rule("[bold]nashrent[/bold]")
    console.print(f"  {result.summary()}")

    if result.source_errors:
        console.print()
        for name, err in result.source_errors.items():
            console.print(f"  [yellow]![/yellow] {name}: {err.splitlines()[0][:140]}")

    qualified = result.qualified[:limit]
    if not qualified:
        console.print("\n  [dim]Nothing passed the hard filters this run.[/dim]")
        _print_rejections(result, console)
        return

    table = Table(box=None, pad_edge=False, header_style="bold")
    table.add_column("#", justify="right", style="dim", width=3)
    table.add_column("Score", justify="right", width=5)
    table.add_column("Rent", justify="right", width=7)
    table.add_column("Bd", justify="right", width=3)
    table.add_column("SqFt", justify="right", width=5)
    table.add_column("Type", width=10)
    table.add_column("Neighborhood", width=18)
    table.add_column("Commute", width=13)
    table.add_column("Listing", overflow="ellipsis", max_width=44)

    new_keys = {listing.key for listing in result.new}

    for i, listing in enumerate(qualified, start=1):
        e = listing.enrichment
        commute = (
            f"{e.commute_downtown_min:.0f}/{e.commute_partner_min:.0f}m"
            if e.commute_downtown_min is not None and e.commute_partner_min is not None
            else "—"
        )
        title = Text(listing.title or listing.url)
        if listing.key in new_keys:
            title = Text("NEW ", style="bold green") + title

        table.add_row(
            str(i),
            _score_text(listing.score.total),
            f"${listing.price:,}" if listing.price else "—",
            f"{listing.beds:g}" if listing.beds is not None else "—",
            f"{listing.sqft:,}" if listing.sqft else "—",
            listing.home_type.value,
            listing.geo.neighborhood or "—",
            commute,
            title,
        )

    console.print()
    console.print(table)

    top = qualified[0]
    console.print()
    console.print(f"[bold]Why #1 ranks first[/bold] — {top.title[:70]}")
    for component in sorted(top.score.components, key=lambda c: -c.points):
        bar = "█" * int(round(component.normalized * 12))
        console.print(
            f"  {component.name:<17} {bar:<12} "
            f"{component.points:5.1f}/{component.weight:<4.1f}  [dim]{component.note}[/dim]"
        )
    console.print(f"  [dim]coverage: {top.score.coverage:.0%} of the profile evaluated[/dim]")
    console.print(f"  {top.url}")

    if result.price_drops:
        console.print()
        console.print("[bold]Price drops[/bold]")
        for listing, old, new in result.price_drops:
            console.print(
                f"  ${old:,} → [green]${new:,}[/green]  {listing.title[:60]}"
            )

    _print_rejections(result, console)


def _print_rejections(result: RunResult, console: Console) -> None:
    failed = [listing for listing in result.listings if not listing.score.passed]
    if not failed:
        return
    reasons: dict[str, int] = {}
    for listing in failed:
        for reason in listing.score.hard_fails:
            key = reason.split("—")[0].split("(")[0].strip()
            key = _generalize(key)
            reasons[key] = reasons.get(key, 0) + 1
    console.print()
    console.print(f"[dim]Filtered out {len(failed)}:[/dim]")
    for reason, count in sorted(reasons.items(), key=lambda kv: -kv[1])[:6]:
        console.print(f"  [dim]{count:>3}  {reason}[/dim]")


def _generalize(reason: str) -> str:
    import re

    reason = re.sub(r"\$[\d,]+", "$X", reason)
    reason = re.sub(r"\b\d+(\.\d+)?\b", "N", reason)
    return reason


def _score_text(score: float) -> Text:
    if score >= 75:
        style = "bold green"
    elif score >= 60:
        style = "green"
    elif score >= 45:
        style = "yellow"
    else:
        style = "dim"
    return Text(f"{score:.0f}", style=style)


def write_html(
    result: RunResult, config: Config, path: str | Path | None = None, limit: int = 60
) -> Path:
    out = Path(path) if path else Path(config.report_dir) / "latest.html"
    out.parent.mkdir(parents=True, exist_ok=True)

    env = Environment(undefined=StrictUndefined, autoescape=True)
    env.filters["money"] = lambda v: f"${v:,}" if v else "—"
    env.filters["num"] = lambda v: f"{v:,.0f}" if v is not None else "—"
    template = env.from_string(_TEMPLATE.read_text())

    new_keys = {listing.key for listing in result.new}
    drops = {listing.key: (old, new) for listing, old, new in result.price_drops}

    html = template.render(
        generated=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        config=config,
        result=result,
        listings=result.qualified[:limit],
        new_keys=new_keys,
        drops=drops,
        summary=result.summary(),
    )
    out.write_text(html, encoding="utf-8")
    return out


def to_markdown(listings: list[Listing], limit: int = 15) -> str:
    """Compact digest, for a webhook body or an email."""
    lines = ["| # | Score | Rent | Beds | SqFt | Neighborhood | Listing |",
             "|---|-------|------|------|------|--------------|---------|"]
    for i, listing in enumerate(listings[:limit], start=1):
        price = f"${listing.price:,}" if listing.price else "—"
        beds = f"{listing.beds:g}" if listing.beds is not None else "—"
        sqft = f"{listing.sqft:,}" if listing.sqft else "—"
        hood = listing.geo.neighborhood or "—"
        title = (listing.title or "listing")[:60].replace("|", "/")
        lines.append(
            f"| {i} | {listing.score.total:.0f} | {price} | {beds} | {sqft} | "
            f"{hood} | [{title}]({listing.url}) |"
        )
    return "\n".join(lines)
