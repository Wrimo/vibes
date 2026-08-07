"""Source adapters. Importing this package registers every built-in source."""

from .base import Source, SourceError, available, build_enabled, register

# Import for side effects: each module registers itself.
from . import apartments, craigslist, csvfile, realtor, zillow  # noqa: F401,E402

__all__ = ["Source", "SourceError", "available", "build_enabled", "register"]
