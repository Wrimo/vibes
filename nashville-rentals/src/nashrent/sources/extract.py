"""Text heuristics shared by every source.

Listing copy is written by humans in a hurry, so these are all deliberately
forgiving. They're pure functions over strings, which makes them cheap to
test — see tests/test_extract.py.
"""

from __future__ import annotations

import re
from datetime import date, datetime

from ..models import HomeType

# Ordered: the first pattern to match wins, so specific beats generic.
# 'apartment' is checked last because plenty of house listings say
# "no apartment living here".
_TYPE_PATTERNS: list[tuple[HomeType, re.Pattern[str]]] = [
    (HomeType.DUPLEX, re.compile(r"\b(duplex|triplex|fourplex|half of a house)\b", re.I)),
    (HomeType.TOWNHOUSE, re.compile(r"\b(town\s?home|town\s?house|row\s?house)\b", re.I)),
    (HomeType.CONDO, re.compile(r"\b(condo|condominium|co-?op)\b", re.I)),
    (
        HomeType.HOUSE,
        re.compile(
            r"\b(single[\s-]?family|detached|stand[\s-]?alone|bungalow|cottage|"
            r"craftsman|ranch home|whole house|entire house|\bhouse for rent\b|"
            r"\bhome for rent\b|full house)\b",
            re.I,
        ),
    ),
    (
        HomeType.APARTMENT,
        re.compile(r"\b(apartment|apt\b|flat\b|unit \d+|community|leasing office)\b", re.I),
    ),
    (HomeType.HOUSE, re.compile(r"\bhouse\b|\bhome\b", re.I)),
]

# Craigslist's own housing_type codes, when present, are authoritative.
CL_HOUSING_TYPE = {
    1: HomeType.APARTMENT,
    2: HomeType.CONDO,
    3: HomeType.HOUSE,
    4: HomeType.TOWNHOUSE,
    5: HomeType.DUPLEX,
    6: HomeType.UNKNOWN,  # flat
    7: HomeType.UNKNOWN,  # in-law
    8: HomeType.UNKNOWN,  # loft
    9: HomeType.UNKNOWN,  # cottage/cabin
    10: HomeType.UNKNOWN,  # land
    11: HomeType.UNKNOWN,  # assisted living
    12: HomeType.UNKNOWN,  # manufactured
}


def infer_home_type(*texts: str | None) -> HomeType:
    """Best guess at the physical form from title + description + attributes."""
    blob = " ".join(t for t in texts if t)
    if not blob.strip():
        return HomeType.UNKNOWN
    for home_type, pattern in _TYPE_PATTERNS:
        if pattern.search(blob):
            return home_type
    return HomeType.UNKNOWN


# Signals that a place can actually hold a party: gathering space, flow,
# and somewhere to put people when the kitchen fills up.
HOSTING_SIGNALS: dict[str, tuple[re.Pattern[str], float]] = {
    "outdoor_space": (
        re.compile(r"\b(deck|patio|porch|screened[\s-]?in|courtyard|pergola)\b", re.I),
        1.0,
    ),
    "fenced_yard": (
        re.compile(r"\b(fenced|fenced[\s-]?in|private yard|large yard|big yard|backyard)\b", re.I),
        0.9,
    ),
    "open_plan": (
        re.compile(r"\b(open[\s-]?(concept|floor\s?plan|living)|great room)\b", re.I),
        0.9,
    ),
    "dining_room": (
        re.compile(r"\b(dining room|separate dining|formal dining|eat[\s-]?in kitchen)\b", re.I),
        0.7,
    ),
    "island_kitchen": (
        re.compile(r"\b(kitchen island|breakfast bar|butcher block island)\b", re.I),
        0.6,
    ),
    "bonus_space": (
        re.compile(r"\b(bonus room|rec room|den\b|finished basement|flex space|sunroom)\b", re.I),
        0.7,
    ),
    "firepit": (re.compile(r"\b(fire\s?pit|outdoor kitchen|grill station)\b", re.I), 0.5),
}

# Things that make hosting harder — small footprint or shared walls/space.
HOSTING_PENALTIES: dict[str, re.Pattern[str]] = {
    "shared_space": re.compile(
        r"\b(shared (kitchen|bath|entrance|laundry)|roommate|room in|basement apartment)\b", re.I
    ),
    "no_parties": re.compile(
        r"\b(no part(y|ies)|quiet (building|enjoyment only)|no gatherings|"
        r"no overnight guests)\b",
        re.I,
    ),
    "tiny": re.compile(r"\b(tiny home|studio|micro[\s-]?unit|efficiency)\b", re.I),
    "walk_up": re.compile(r"\b(third floor walk[\s-]?up|4th floor walk[\s-]?up)\b", re.I),
}


def hosting_signals(text: str) -> tuple[dict[str, float], list[str]]:
    """Return (matched positive signals with weights, matched penalty names)."""
    found: dict[str, float] = {}
    for name, (pattern, weight) in HOSTING_SIGNALS.items():
        if pattern.search(text):
            found[name] = weight
    penalties = [n for n, p in HOSTING_PENALTIES.items() if p.search(text)]
    return found, penalties


# Accepts '1350 sqft', '1,450 square feet', '2000sf', and Craigslist's
# '1350ft<sup>2</sup>', which flattens to '1350ft 2'.
_SQFT_RE = re.compile(
    r"(\d[\d,]{2,6})\s*(?:sq\.?\s?(?:ft|feet)|square\s?feet|sf\b|ft\s*2\b|ft²)", re.I
)
_BED_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:bed|bd|br\b|bedroom)", re.I)
_BATH_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(?:bath|ba\b|bth)", re.I)
_PRICE_RE = re.compile(r"\$\s?([\d,]{3,7})")


def find_sqft(text: str) -> int | None:
    m = _SQFT_RE.search(text or "")
    if not m:
        return None
    val = int(m.group(1).replace(",", ""))
    return val if 150 <= val <= 20000 else None


def find_beds(text: str) -> float | None:
    m = _BED_RE.search(text or "")
    if m:
        val = float(m.group(1))
        return val if 0 <= val <= 12 else None
    if re.search(r"\bstudio\b", text or "", re.I):
        return 0.0
    return None


def find_baths(text: str) -> float | None:
    m = _BATH_RE.search(text or "")
    if not m:
        return None
    val = float(m.group(1))
    return val if 0 < val <= 12 else None


def find_price(text: str) -> int | None:
    m = _PRICE_RE.search(text or "")
    if not m:
        return None
    val = int(m.group(1).replace(",", ""))
    # Rents, not sale prices or deposits quoted in the body.
    return val if 300 <= val <= 20000 else None


_MONTHS = {
    m: i
    for i, m in enumerate(
        [
            "jan", "feb", "mar", "apr", "may", "jun",
            "jul", "aug", "sep", "oct", "nov", "dec",
        ],
        start=1,
    )
}


def find_available_date(text: str, today: date | None = None) -> date | None:
    """Parse 'available 3/1', 'available March 1, 2027', 'available now'."""
    today = today or date.today()
    t = text or ""

    if re.search(r"\bavailable\s+(now|immediately|today)\b", t, re.I):
        return today

    m = re.search(
        r"\bavail\w*\s*(?:on|:|-)?\s*(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?", t, re.I
    )
    if m:
        month, day = int(m.group(1)), int(m.group(2))
        year = m.group(3)
        return _make_date(month, day, year, today)

    m = re.search(
        r"\bavail\w*\s*(?:on|:|-)?\s*([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?"
        r"(?:,?\s*(\d{4}))?",
        t,
        re.I,
    )
    if m:
        month = _MONTHS.get(m.group(1)[:3].lower())
        if month:
            return _make_date(month, int(m.group(2)), m.group(3), today)
    return None


def _make_date(month: int, day: int, year: str | None, today: date) -> date | None:
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    if year:
        y = int(year)
        if y < 100:
            y += 2000
    else:
        # No year given: assume the next occurrence.
        y = today.year
        if (month, day) < (today.month, today.day):
            y += 1
    try:
        return date(y, month, day)
    except ValueError:
        return None


def parse_epoch(value: object) -> datetime | None:
    """Craigslist hands out both seconds and milliseconds. Accept either."""
    try:
        n = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if n > 1e11:
        n /= 1000.0
    if not (9e8 < n < 4e9):  # ~2000-01-01 .. ~2096
        return None
    return datetime.fromtimestamp(n)
