"""Alerting for listings worth dropping what you're doing over.

Deliberately quiet by default. In a market like Nashville's the good stand-alone
houses go in days, so the alert threshold matters more than the channel — a
notifier that fires on everything gets muted within a week.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

from .config import Config
from .models import Listing
from .net import Fetcher
from .report import to_markdown

log = logging.getLogger(__name__)


def notify(listings: list[Listing], config: Config) -> list[str]:
    """Send alerts through every configured channel.

    Returns the channels that fired. Never raises: a broken SMTP config must
    not take down a scheduled run.
    """
    if not config.notify.enabled or not listings:
        return []

    sent: list[str] = []
    subject = _subject(listings)
    body = _body(listings, config)

    if config.notify.webhook_url:
        try:
            _webhook(config, subject, body)
            sent.append("webhook")
        except Exception as exc:
            log.error("webhook notify failed: %s", exc)

    if config.notify.smtp_host and config.notify.email_to:
        try:
            _email(config, subject, body)
            sent.append("email")
        except Exception as exc:
            log.error("email notify failed: %s", exc)

    return sent


def _subject(listings: list[Listing]) -> str:
    best = listings[0]
    where = best.geo.neighborhood or "Nashville"
    price = f"${best.price:,}" if best.price else "?"
    if len(listings) == 1:
        return f"[nashrent] {best.score.total:.0f}/100 · {price} in {where}"
    return (
        f"[nashrent] {len(listings)} new matches · "
        f"top {best.score.total:.0f}/100 · {price} in {where}"
    )


def _body(listings: list[Listing], config: Config) -> str:
    lines = [
        f"{len(listings)} listing(s) scored at or above {config.notify.min_score:.0f}.",
        "",
        to_markdown(listings),
        "",
    ]
    best = listings[0]
    lines.append(f"Top match: {best.title}")
    lines.append(best.url)
    lines.append("")
    for component in sorted(best.score.components, key=lambda c: -c.points)[:5]:
        lines.append(f"  {component.name}: {component.points:.1f}/{component.weight:.0f} — {component.note}")
    if best.score.warnings:
        lines.append("")
        for warning in best.score.warnings:
            lines.append(f"  note: {warning}")
    return "\n".join(lines)


def _webhook(config: Config, subject: str, body: str) -> None:
    with Fetcher.from_config(config.net) as fetcher:
        # Slack and Discord both accept a bare {"text": ...}; so do most others.
        fetcher.post(
            config.notify.webhook_url,  # type: ignore[arg-type]
            json_body={"text": f"*{subject}*\n\n{body}"},
            cache_ttl=-1,
            force=True,
        )


def _email(config: Config, subject: str, body: str) -> None:
    password = os.environ.get(config.notify.smtp_password_env)
    if config.notify.smtp_user and not password:
        raise RuntimeError(
            f"SMTP user configured but ${config.notify.smtp_password_env} is unset"
        )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = config.notify.email_from or config.notify.smtp_user or "nashrent@localhost"
    msg["To"] = ", ".join(config.notify.email_to)
    msg.set_content(body)

    with smtplib.SMTP(config.notify.smtp_host, config.notify.smtp_port, timeout=30) as smtp:
        smtp.starttls()
        if config.notify.smtp_user and password:
            smtp.login(config.notify.smtp_user, password)
        smtp.send_message(msg)
