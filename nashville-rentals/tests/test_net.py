"""HTTP layer: caching, robots, retries, error classification.

These use a stub transport rather than a live server, so the suite stays
fast and offline.
"""

from __future__ import annotations

import httpx
import pytest

from nashrent.net import FetchError, Fetcher, RobotsDenied


def make_fetcher(handler, tmp_path=None, **kw) -> Fetcher:
    fetcher = Fetcher(
        per_host_delay=0.0,
        max_retries=kw.pop("max_retries", 2),
        cache_dir=tmp_path,
        respect_robots=kw.pop("respect_robots", False),
        **kw,
    )
    fetcher._client = httpx.Client(transport=httpx.MockTransport(handler))
    return fetcher


def test_get_returns_body():
    fetcher = make_fetcher(lambda r: httpx.Response(200, text="hello"))
    assert fetcher.get("https://example.com/x") == "hello"


def test_cache_prevents_a_second_request(tmp_path):
    calls = []

    def handler(request):
        calls.append(request.url)
        return httpx.Response(200, text="cached body")

    fetcher = make_fetcher(handler, tmp_path=tmp_path)
    fetcher.get("https://example.com/x")
    fetcher.get("https://example.com/x")

    assert len(calls) == 1
    assert fetcher.stats.cache_hits == 1


def test_force_bypasses_the_cache(tmp_path):
    calls = []

    def handler(request):
        calls.append(request.url)
        return httpx.Response(200, text="body")

    fetcher = make_fetcher(handler, tmp_path=tmp_path)
    fetcher.get("https://example.com/x")
    fetcher.get("https://example.com/x", force=True)
    assert len(calls) == 2


def test_different_urls_cache_separately(tmp_path):
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, text="body")

    fetcher = make_fetcher(handler, tmp_path=tmp_path)
    fetcher.get("https://example.com/a")
    fetcher.get("https://example.com/b")
    assert len(calls) == 2


def test_server_errors_are_retried_then_raise():
    attempts = []

    def handler(request):
        attempts.append(1)
        return httpx.Response(503, text="down")

    fetcher = make_fetcher(handler, max_retries=2)
    with pytest.raises(FetchError):
        fetcher.get("https://example.com/x")

    assert len(attempts) == 3  # initial + 2 retries
    assert fetcher.stats.retries == 2


def test_transient_failure_then_success():
    state = {"n": 0}

    def handler(request):
        state["n"] += 1
        if state["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, text="recovered")

    assert make_fetcher(handler).get("https://example.com/x") == "recovered"


def test_client_errors_are_not_retried():
    attempts = []

    def handler(request):
        attempts.append(1)
        return httpx.Response(404, text="nope")

    fetcher = make_fetcher(handler)
    with pytest.raises(FetchError, match="404"):
        fetcher.get("https://example.com/x")
    assert len(attempts) == 1


def test_get_json_parses():
    fetcher = make_fetcher(lambda r: httpx.Response(200, text='{"a": 1}'))
    assert fetcher.get_json("https://example.com/x") == {"a": 1}


def test_get_json_raises_on_html():
    fetcher = make_fetcher(lambda r: httpx.Response(200, text="<html>bot check</html>"))
    with pytest.raises(FetchError, match="non-JSON"):
        fetcher.get_json("https://example.com/x")


# ---- robots ----------------------------------------------------------------


def robots_handler(body: str):
    def handler(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(200, text=body)
        return httpx.Response(200, text="page")

    return handler


def test_robots_disallow_blocks_the_request():
    fetcher = make_fetcher(
        robots_handler("User-agent: *\nDisallow: /private\n"), respect_robots=True
    )
    with pytest.raises(RobotsDenied):
        fetcher.get("https://example.com/private/x")
    assert fetcher.stats.robots_blocks == 1


def test_robots_allows_other_paths():
    fetcher = make_fetcher(
        robots_handler("User-agent: *\nDisallow: /private\n"), respect_robots=True
    )
    assert fetcher.get("https://example.com/public") == "page"


def test_missing_robots_means_allowed():
    def handler(request):
        if request.url.path == "/robots.txt":
            return httpx.Response(404)
        return httpx.Response(200, text="page")

    fetcher = make_fetcher(handler, respect_robots=True)
    assert fetcher.get("https://example.com/anything") == "page"


def test_robots_is_fetched_once_per_origin():
    hits = []

    def handler(request):
        if request.url.path == "/robots.txt":
            hits.append(1)
            return httpx.Response(200, text="User-agent: *\nAllow: /\n")
        return httpx.Response(200, text="page")

    fetcher = make_fetcher(handler, respect_robots=True)
    fetcher.get("https://example.com/a")
    fetcher.get("https://example.com/b")
    assert len(hits) == 1


def test_respect_robots_false_skips_the_check():
    hits = []

    def handler(request):
        if request.url.path == "/robots.txt":
            hits.append(1)
        return httpx.Response(200, text="page")

    fetcher = make_fetcher(handler, respect_robots=False)
    fetcher.get("https://example.com/private")
    assert hits == []


def test_stats_are_reported():
    fetcher = make_fetcher(lambda r: httpx.Response(200, text="ok"))
    fetcher.get("https://example.com/x")
    assert fetcher.stats.as_dict()["requests"] == 1
