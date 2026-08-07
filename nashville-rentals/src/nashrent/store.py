"""SQLite persistence.

State is the whole point of a monitor: knowing a listing is *new*, that a
price *dropped*, or that something you liked vanished, is worth more than any
single snapshot. Everything lives in one file you can back up or delete.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterator, Literal

from .models import Listing, ListingStatus

log = logging.getLogger(__name__)

UpsertResult = Literal["new", "price_changed", "updated", "unchanged"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS listings (
    key             TEXT PRIMARY KEY,
    source          TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    fingerprint     TEXT,
    url             TEXT NOT NULL,
    title           TEXT,
    price           INTEGER,
    beds            REAL,
    baths           REAL,
    sqft            INTEGER,
    home_type       TEXT,
    address         TEXT,
    neighborhood    TEXT,
    lat             REAL,
    lon             REAL,
    available_date  TEXT,
    posted_at       TEXT,
    first_seen      TEXT NOT NULL,
    last_seen       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'new',
    notes           TEXT DEFAULT '',
    score_total     REAL,
    score_coverage  REAL,
    hard_fails      TEXT,
    payload         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_score ON listings(score_total DESC);
CREATE INDEX IF NOT EXISTS idx_listings_fingerprint ON listings(fingerprint);
CREATE INDEX IF NOT EXISTS idx_listings_last_seen ON listings(last_seen);

CREATE TABLE IF NOT EXISTS price_history (
    key       TEXT NOT NULL,
    seen_at   TEXT NOT NULL,
    price     INTEGER,
    PRIMARY KEY (key, seen_at)
);

CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT,
    found       INTEGER DEFAULT 0,
    new_count   INTEGER DEFAULT 0,
    stats       TEXT
);
"""


class Store:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        try:
            yield self.conn
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    # ---- writes ------------------------------------------------------------

    def upsert(self, listing: Listing) -> UpsertResult:
        """Insert or update, returning what actually changed.

        Preserves user-managed fields (status, notes) across runs — a listing
        you marked 'rejected' must not silently revert to 'new'.
        """
        now = datetime.now(timezone.utc)
        listing.touch(now)

        existing = self.get(listing.key)
        result: UpsertResult = "new"

        if existing is not None:
            listing.first_seen = existing.first_seen or listing.first_seen
            # Don't clobber triage the user did by hand.
            if existing.status not in (ListingStatus.NEW, ListingStatus.GONE):
                listing.status = existing.status
            elif existing.status is ListingStatus.GONE:
                listing.status = ListingStatus.SEEN
            else:
                listing.status = ListingStatus.SEEN
            listing.notes = listing.notes or existing.notes

            if existing.price != listing.price and listing.price is not None:
                result = "price_changed"
            else:
                result = "updated"

        with self._tx() as conn:
            conn.execute(
                """
                INSERT INTO listings (
                    key, source, source_id, fingerprint, url, title, price, beds,
                    baths, sqft, home_type, address, neighborhood, lat, lon,
                    available_date, posted_at, first_seen, last_seen, status,
                    notes, score_total, score_coverage, hard_fails, payload
                ) VALUES (
                    :key, :source, :source_id, :fingerprint, :url, :title, :price, :beds,
                    :baths, :sqft, :home_type, :address, :neighborhood, :lat, :lon,
                    :available_date, :posted_at, :first_seen, :last_seen, :status,
                    :notes, :score_total, :score_coverage, :hard_fails, :payload
                )
                ON CONFLICT(key) DO UPDATE SET
                    fingerprint=excluded.fingerprint,
                    url=excluded.url,
                    title=excluded.title,
                    price=excluded.price,
                    beds=excluded.beds,
                    baths=excluded.baths,
                    sqft=excluded.sqft,
                    home_type=excluded.home_type,
                    address=excluded.address,
                    neighborhood=excluded.neighborhood,
                    lat=excluded.lat,
                    lon=excluded.lon,
                    available_date=excluded.available_date,
                    posted_at=excluded.posted_at,
                    last_seen=excluded.last_seen,
                    status=excluded.status,
                    notes=excluded.notes,
                    score_total=excluded.score_total,
                    score_coverage=excluded.score_coverage,
                    hard_fails=excluded.hard_fails,
                    payload=excluded.payload
                """,
                _row_of(listing),
            )
            if listing.price is not None:
                conn.execute(
                    "INSERT OR REPLACE INTO price_history (key, seen_at, price) VALUES (?, ?, ?)",
                    (listing.key, now.date().isoformat(), listing.price),
                )
        return result

    def set_status(self, key: str, status: ListingStatus, notes: str | None = None) -> bool:
        with self._tx() as conn:
            if notes is None:
                cur = conn.execute(
                    "UPDATE listings SET status=? WHERE key=?", (status.value, key)
                )
            else:
                cur = conn.execute(
                    "UPDATE listings SET status=?, notes=? WHERE key=?",
                    (status.value, notes, key),
                )
        return cur.rowcount > 0

    def mark_missing_as_gone(self, seen_keys: set[str], sources: set[str]) -> int:
        """Anything from a source we just polled but didn't see is off-market.

        Scoped to the sources that actually ran, so a failing Zillow run
        doesn't wrongly bury every Zillow listing.
        """
        if not sources:
            return 0
        placeholders = ",".join("?" * len(sources))
        params: list[object] = [ListingStatus.GONE.value, *sources]
        sql = (
            f"UPDATE listings SET status=? WHERE source IN ({placeholders}) "
            f"AND status NOT IN ('gone','rejected','applied')"
        )
        if seen_keys:
            key_ph = ",".join("?" * len(seen_keys))
            sql += f" AND key NOT IN ({key_ph})"
            params.extend(seen_keys)
        with self._tx() as conn:
            cur = conn.execute(sql, params)
        return cur.rowcount

    def start_run(self) -> int:
        with self._tx() as conn:
            cur = conn.execute(
                "INSERT INTO runs (started_at) VALUES (?)",
                (datetime.now(timezone.utc).isoformat(),),
            )
        return int(cur.lastrowid or 0)

    def finish_run(self, run_id: int, found: int, new_count: int, stats: dict) -> None:
        with self._tx() as conn:
            conn.execute(
                "UPDATE runs SET finished_at=?, found=?, new_count=?, stats=? WHERE id=?",
                (
                    datetime.now(timezone.utc).isoformat(),
                    found,
                    new_count,
                    json.dumps(stats),
                    run_id,
                ),
            )

    # ---- reads -------------------------------------------------------------

    def get(self, key: str) -> Listing | None:
        row = self.conn.execute(
            f"SELECT {_SELECT_COLS} FROM listings WHERE key=?", (key,)
        ).fetchone()
        return _listing_of(row) if row else None

    def all(
        self,
        *,
        include_failed: bool = False,
        statuses: list[ListingStatus] | None = None,
        limit: int | None = None,
    ) -> list[Listing]:
        sql = f"SELECT {_SELECT_COLS} FROM listings WHERE 1=1"
        params: list[object] = []
        if not include_failed:
            sql += " AND (hard_fails IS NULL OR hard_fails='[]')"
        if statuses:
            sql += f" AND status IN ({','.join('?' * len(statuses))})"
            params.extend(s.value for s in statuses)
        sql += " ORDER BY score_total DESC NULLS LAST"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        return [_listing_of(r) for r in self.conn.execute(sql, params)]

    def by_fingerprint(self, fingerprint: str) -> list[Listing]:
        rows = self.conn.execute(
            f"SELECT {_SELECT_COLS} FROM listings WHERE fingerprint=?", (fingerprint,)
        )
        return [_listing_of(r) for r in rows]

    def price_history(self, key: str) -> list[tuple[str, int]]:
        rows = self.conn.execute(
            "SELECT seen_at, price FROM price_history WHERE key=? ORDER BY seen_at", (key,)
        )
        return [(r["seen_at"], r["price"]) for r in rows]

    def stats(self) -> dict[str, object]:
        cur = self.conn.execute(
            """
            SELECT COUNT(*) AS total,
                   SUM(status='new') AS new,
                   SUM(status='gone') AS gone,
                   SUM(status='interested') AS interested,
                   AVG(price) AS avg_price,
                   MIN(price) AS min_price
            FROM listings
            """
        ).fetchone()
        runs = self.conn.execute("SELECT COUNT(*) AS n FROM runs").fetchone()
        return {
            "listings": cur["total"] or 0,
            "new": cur["new"] or 0,
            "gone": cur["gone"] or 0,
            "interested": cur["interested"] or 0,
            "avg_price": round(cur["avg_price"]) if cur["avg_price"] else None,
            "min_price": cur["min_price"],
            "runs": runs["n"] or 0,
        }

    def neighborhood_medians(self) -> list[tuple[str, int, float]]:
        """(neighborhood, sample size, median price) — the comps you're
        building by running this thing for months before you move."""
        rows = self.conn.execute(
            """
            SELECT neighborhood, price FROM listings
            WHERE neighborhood IS NOT NULL AND price IS NOT NULL
            ORDER BY neighborhood, price
            """
        ).fetchall()
        buckets: dict[str, list[int]] = {}
        for r in rows:
            buckets.setdefault(r["neighborhood"], []).append(r["price"])
        out = []
        for name, prices in buckets.items():
            n = len(prices)
            median = (
                prices[n // 2] if n % 2 else (prices[n // 2 - 1] + prices[n // 2]) / 2
            )
            out.append((name, n, float(median)))
        return sorted(out, key=lambda t: -t[1])


# ---- row mapping -----------------------------------------------------------


def _row_of(listing: Listing) -> dict[str, object]:
    return {
        "key": listing.key,
        "source": listing.source,
        "source_id": listing.source_id,
        "fingerprint": listing.fingerprint,
        "url": listing.url,
        "title": listing.title,
        "price": listing.price,
        "beds": listing.beds,
        "baths": listing.baths,
        "sqft": listing.sqft,
        "home_type": listing.home_type.value,
        "address": listing.address,
        "neighborhood": listing.geo.neighborhood,
        "lat": listing.geo.lat,
        "lon": listing.geo.lon,
        "available_date": _iso(listing.available_date),
        "posted_at": _iso(listing.posted_at),
        "first_seen": _iso(listing.first_seen),
        "last_seen": _iso(listing.last_seen),
        "status": listing.status.value,
        "notes": listing.notes,
        "score_total": listing.score.total,
        "score_coverage": listing.score.coverage,
        "hard_fails": json.dumps(listing.score.hard_fails),
        "payload": listing.model_dump_json(),
    }


#: `payload` is the serialized Listing, but a handful of fields are mutated by
#: SQL after it's written (triage status, notes, the gone-sweep). Those columns
#: are authoritative and get overlaid on read — otherwise a listing you marked
#: 'rejected' would come back as 'new' the moment you reloaded it.
_SELECT_COLS = "payload, status, notes"


def _listing_of(row: sqlite3.Row) -> Listing:
    listing = Listing.model_validate_json(row["payload"])
    keys = row.keys()
    if "status" in keys and row["status"]:
        listing.status = ListingStatus(row["status"])
    if "notes" in keys and row["notes"] is not None:
        listing.notes = row["notes"]
    return listing


def _iso(value: datetime | date | None) -> str | None:
    return value.isoformat() if value is not None else None
