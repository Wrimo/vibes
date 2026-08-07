"""Source adapter contract and registry.

Adding a site means writing one class and decorating it with @register.
Nothing else in the codebase changes.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Callable, Iterator

from ..config import Config, SourceConfig
from ..models import Listing
from ..net import Fetcher, FetchError

log = logging.getLogger(__name__)

_REGISTRY: dict[str, type["Source"]] = {}


def register(cls: type["Source"]) -> type["Source"]:
    _REGISTRY[cls.name] = cls
    return cls


def available() -> dict[str, type["Source"]]:
    return dict(_REGISTRY)


def build_enabled(config: Config, fetcher: Fetcher) -> list["Source"]:
    """Instantiate every source that's turned on in config."""
    out: list[Source] = []
    for name, src_cfg in config.sources.items():
        if not src_cfg.enabled:
            continue
        cls = _REGISTRY.get(name)
        if cls is None:
            log.warning("config enables unknown source %r; known: %s",
                        name, ", ".join(sorted(_REGISTRY)))
            continue
        out.append(cls(config, src_cfg, fetcher))
    return out


class SourceError(RuntimeError):
    """A source could not produce results.

    Message should tell the user what to do next — these fire when a site
    changes its markup, which is the normal failure mode of a scraper.
    """


class Source(ABC):
    """One website (or file) that produces listings."""

    name: str = "base"
    #: Human-readable note surfaced by `nashrent sources`.
    blurb: str = ""
    #: True when the site actively blocks datacenter IPs / needs a proxy.
    needs_proxy: bool = False

    def __init__(self, config: Config, source_config: SourceConfig, fetcher: Fetcher):
        self.config = config
        self.options = source_config.options
        self.fetcher = fetcher

    @abstractmethod
    def search(self) -> Iterator[Listing]:
        """Yield listings matching the configured profile.

        Implementations should yield as they go rather than building a list,
        so a mid-run failure still delivers everything found so far.
        """

    def collect(self) -> list[Listing]:
        """Run `search`, converting failures into a clean SourceError.

        A blocked or rate-limited site is an expected, routine outcome here —
        it gets a one-line message, not a stack trace. Only genuinely
        unexpected exceptions (a parser bug) are worth a traceback.
        """
        out: list[Listing] = []
        try:
            for listing in self.search():
                out.append(listing)
        except SourceError:
            raise
        except FetchError as exc:
            log.debug("%s: network failure after %d listings", self.name, len(out),
                      exc_info=True)
            raise SourceError(f"{self.name}: {_brief(exc)}") from exc
        except Exception as exc:
            log.exception("%s: search aborted after %d listings", self.name, len(out))
            raise SourceError(f"{self.name} failed: {exc}") from exc
        return out

    # ---- shared helpers ----------------------------------------------------

    def _price_bounds(self) -> tuple[int, int]:
        """Query the site up to the stretch price, filter precisely later."""
        return self.config.budget.min_price, self.config.budget.stretch_price

    def _min_beds(self) -> int:
        return int(self.config.requirements.min_beds)


def guard(predicate: bool, message: str) -> None:
    """Assert a response shape, with a message aimed at whoever has to fix it."""
    if not predicate:
        raise SourceError(message)


def first_of(mapping: dict[str, Any], *keys: str, default: Any = None) -> Any:
    """Return the first present, non-null key. Sites rename fields constantly."""
    for k in keys:
        if k in mapping and mapping[k] is not None:
            return mapping[k]
    return default


def safe(fn: Callable[[], Any], default: Any = None) -> Any:
    try:
        return fn()
    except Exception:
        return default


def _brief(exc: Exception) -> str:
    """Collapse a fetch failure to something that fits on one line.

    The full URL with 40 query params tells you nothing you didn't know;
    the status code and host do.
    """
    import re

    text = str(exc).replace("\n", " ")
    text = re.sub(r"(https?://[^\s?]+)\?\S*", r"\1", text)
    return text[:180]
