"""Polite HTTP client shared by every source and enrichment provider.

Responsibilities, in the order they matter:
  1. Honor robots.txt (on by default; sources that need it off say so loudly).
  2. Rate limit per host, so we never hammer anyone.
  3. Cache on disk, so re-runs and enrichment retries are nearly free —
     this matters most for Nominatim/Overpass, whose results barely change.
  4. Retry transient failures with backoff, and give up cleanly on 4xx.
"""

from __future__ import annotations

import hashlib
import json
import logging
import random
import time
import urllib.robotparser
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

log = logging.getLogger(__name__)


class FetchError(RuntimeError):
    """Raised when a request cannot be satisfied after retries."""


class RobotsDenied(FetchError):
    """The target's robots.txt disallows this path for our user agent."""


@dataclass
class FetchStats:
    requests: int = 0
    cache_hits: int = 0
    retries: int = 0
    errors: int = 0
    robots_blocks: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "requests": self.requests,
            "cache_hits": self.cache_hits,
            "retries": self.retries,
            "errors": self.errors,
            "robots_blocks": self.robots_blocks,
        }


@dataclass
class Fetcher:
    user_agent: str = "nashrent/0.1"
    timeout: float = 25.0
    per_host_delay: float = 1.5
    max_retries: int = 3
    respect_robots: bool = True
    cache_dir: Path | None = None
    cache_ttl: int = 3600
    proxy: str | None = None

    _last_hit: dict[str, float] = field(default_factory=dict, init=False)
    _robots: dict[str, urllib.robotparser.RobotFileParser | None] = field(
        default_factory=dict, init=False
    )
    _client: httpx.Client | None = field(default=None, init=False)
    stats: FetchStats = field(default_factory=FetchStats, init=False)

    @classmethod
    def from_config(cls, net_cfg: Any) -> "Fetcher":
        ua = net_cfg.user_agent
        if getattr(net_cfg, "contact_email", None):
            ua = f"{ua} ({net_cfg.contact_email})"
        return cls(
            user_agent=ua,
            timeout=net_cfg.request_timeout,
            per_host_delay=net_cfg.per_host_delay,
            max_retries=net_cfg.max_retries,
            respect_robots=net_cfg.respect_robots,
            cache_dir=Path(net_cfg.cache_dir) if net_cfg.cache_dir else None,
            cache_ttl=net_cfg.cache_ttl_seconds,
            proxy=net_cfg.proxy,
        )

    # ---- lifecycle ---------------------------------------------------------

    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=self.timeout,
                follow_redirects=True,
                proxy=self.proxy,
                headers={
                    "User-Agent": self.user_agent,
                    "Accept-Language": "en-US,en;q=0.9",
                },
            )
        return self._client

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def __enter__(self) -> "Fetcher":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ---- politeness --------------------------------------------------------

    def _robots_for(self, url: str) -> urllib.robotparser.RobotFileParser | None:
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin in self._robots:
            return self._robots[origin]

        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{origin}/robots.txt")
        try:
            resp = self.client.get(f"{origin}/robots.txt", timeout=10.0)
            if resp.status_code >= 400:
                # No robots.txt (or unreadable) means no restrictions.
                self._robots[origin] = None
                return None
            rp.parse(resp.text.splitlines())
        except httpx.HTTPError as exc:
            log.debug("robots.txt unreachable for %s: %s", origin, exc)
            self._robots[origin] = None
            return None
        self._robots[origin] = rp
        return rp

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        rp = self._robots_for(url)
        if rp is None:
            return True
        return rp.can_fetch(self.user_agent, url)

    def _throttle(self, host: str) -> None:
        last = self._last_hit.get(host)
        if last is not None:
            # Jitter keeps a burst of hosts from marching in lockstep.
            wait = self.per_host_delay + random.uniform(0, self.per_host_delay * 0.3)
            elapsed = time.monotonic() - last
            if elapsed < wait:
                time.sleep(wait - elapsed)
        self._last_hit[host] = time.monotonic()

    # ---- cache -------------------------------------------------------------

    def _cache_path(self, method: str, url: str, body: str | None) -> Path | None:
        if self.cache_dir is None:
            return None
        digest = hashlib.sha256(
            f"{method}|{url}|{body or ''}".encode()
        ).hexdigest()
        return self.cache_dir / digest[:2] / f"{digest}.json"

    def _cache_read(self, path: Path | None, ttl: int | None) -> str | None:
        if path is None or not path.exists():
            return None
        ttl = self.cache_ttl if ttl is None else ttl
        if ttl >= 0 and (time.time() - path.stat().st_mtime) > ttl:
            return None
        try:
            return json.loads(path.read_text())["body"]
        except (json.JSONDecodeError, KeyError, OSError):
            return None

    def _cache_write(self, path: Path | None, url: str, body: str) -> None:
        if path is None:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({"url": url, "body": body}))
        except OSError as exc:
            log.debug("cache write failed for %s: %s", url, exc)

    # ---- requests ----------------------------------------------------------

    def get(
        self,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        cache_ttl: int | None = None,
        force: bool = False,
    ) -> str:
        """GET a URL, returning the body as text."""
        full = str(httpx.URL(url, params=params or {}))
        return self._request("GET", full, None, headers, cache_ttl, force)

    def post(
        self,
        url: str,
        *,
        data: str | None = None,
        json_body: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
        cache_ttl: int | None = None,
        force: bool = False,
    ) -> str:
        body = data if data is not None else json.dumps(json_body or {})
        return self._request("POST", url, body, headers, cache_ttl, force)

    def get_json(self, url: str, **kw: Any) -> Any:
        text = self.get(url, **kw)
        try:
            return json.loads(text)
        except json.JSONDecodeError as exc:
            raise FetchError(f"{url} returned non-JSON ({exc})") from exc

    def _request(
        self,
        method: str,
        url: str,
        body: str | None,
        headers: dict[str, str] | None,
        cache_ttl: int | None,
        force: bool,
    ) -> str:
        cache_path = self._cache_path(method, url, body)
        if not force:
            cached = self._cache_read(cache_path, cache_ttl)
            if cached is not None:
                self.stats.cache_hits += 1
                return cached

        if method == "GET" and not self.allowed(url):
            self.stats.robots_blocks += 1
            raise RobotsDenied(
                f"robots.txt disallows {url} for user-agent {self.user_agent!r}. "
                f"Set net.respect_robots=false only if you have a right to fetch it."
            )

        host = urlparse(url).netloc
        last_exc: Exception | None = None

        for attempt in range(self.max_retries + 1):
            self._throttle(host)
            self.stats.requests += 1
            try:
                if method == "GET":
                    resp = self.client.get(url, headers=headers)
                else:
                    resp = self.client.post(
                        url,
                        content=body,
                        headers={
                            "Content-Type": "application/json",
                            **(headers or {}),
                        },
                    )
            except httpx.HTTPError as exc:
                last_exc = exc
                log.debug("%s %s failed (attempt %d): %s", method, url, attempt + 1, exc)
            else:
                if resp.status_code < 400:
                    text = resp.text
                    self._cache_write(cache_path, url, text)
                    return text

                # 429/5xx are worth retrying; other 4xx are not.
                if resp.status_code not in (429, 500, 502, 503, 504):
                    self.stats.errors += 1
                    raise FetchError(
                        f"{method} {_display_url(url)} -> HTTP {resp.status_code}: "
                        f"{resp.text[:160].strip()}"
                    )
                last_exc = FetchError(f"HTTP {resp.status_code}")
                retry_after = _retry_after_seconds(resp)
                if retry_after:
                    time.sleep(min(retry_after, 60))

            if attempt < self.max_retries:
                self.stats.retries += 1
                time.sleep((2**attempt) + random.uniform(0, 1))

        self.stats.errors += 1
        raise FetchError(
            f"{method} {_display_url(url)} failed after "
            f"{self.max_retries + 1} attempts: {last_exc}"
        )


def _display_url(url: str) -> str:
    """Drop the query string for error messages.

    A Socrata or Craigslist URL carries hundreds of characters of encoded
    parameters that tell you nothing about why the request failed — the host
    and path do.
    """
    base = url.split("?", 1)[0]
    return base if len(base) <= 120 else base[:117] + "..."


def _retry_after_seconds(resp: httpx.Response) -> float | None:
    raw = resp.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None
