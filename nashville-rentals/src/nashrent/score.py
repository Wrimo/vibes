"""Scoring: turn a Listing into a single comparable number, with receipts.

Design rules this file follows:

* **Every component is 0..1 before weighting**, so re-weighting in config is
  meaningful and you can compare components against each other.
* **Missing data never silently costs points.** A component with no data is
  dropped and the remaining weights are rescaled, with `coverage` recording
  how much of the profile we actually got to evaluate. A listing scoring 82
  on 45% coverage is a very different claim than 82 on 100%, and the report
  shows both.
* **Hard fails are separate from scoring.** A 1-bedroom isn't "a low score",
  it's disqualified — but it stays in the database so price history survives.
* **Every component carries a human-readable note**, because the point of
  this thing is deciding which four houses to tour, not admiring a number.
"""

from __future__ import annotations

from datetime import date

from .config import Config
from .models import HomeType, Listing, Score, ScoreComponent
from .sources.extract import hosting_signals


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def ramp(value: float | None, lo: float, hi: float) -> float | None:
    """Linear 0..1 as `value` goes lo -> hi. Reversed if lo > hi."""
    if value is None:
        return None
    if lo == hi:
        return 1.0 if value >= hi else 0.0
    return clamp((value - lo) / (hi - lo))


class Scorer:
    def __init__(self, config: Config):
        self.config = config
        self.weights = config.normalized_weights()

    # ---- entry point -------------------------------------------------------

    def score(self, listing: Listing, today: date | None = None) -> Score:
        today = today or date.today()
        result = Score(warnings=list(listing.score.warnings))

        self._hard_filters(listing, result)
        self._timing_notes(listing, result, today)

        components = [
            self._neighborhood(listing),
            self._hosting_space(listing),
            self._commute(listing),
            self._price_value(listing),
            self._walkability(listing),
            self._home_type(listing),
            self._dining_nightlife(listing),
            self._safety(listing),
        ]

        scored = [c for c in components if c is not None]
        result.components = scored

        available_weight = sum(c.weight for c in scored)
        total_weight = sum(self.weights.values())
        result.coverage = round(available_weight / total_weight, 3) if total_weight else 0.0

        if available_weight > 0:
            # Rescale to 100 across the components we could actually evaluate.
            earned = sum(c.points for c in scored)
            result.total = round(earned / available_weight * 100, 1)
        else:
            result.total = 0.0

        if result.coverage < 0.6:
            result.warnings.append(
                f"only {result.coverage:.0%} of the profile could be evaluated — "
                f"score is provisional (run enrichment to fill it in)"
            )

        listing.score = result
        return result

    # ---- hard filters ------------------------------------------------------

    def _hard_filters(self, listing: Listing, result: Score) -> None:
        req = self.config.requirements
        budget = self.config.budget

        if listing.price is None:
            result.warnings.append("no price listed")
        elif listing.price > budget.stretch_price:
            result.hard_fails.append(
                f"${listing.price:,}/mo is over the ${budget.stretch_price:,} stretch cap"
            )
        elif listing.price < budget.min_price:
            result.warnings.append(
                f"${listing.price:,}/mo is suspiciously low — check for a scam or a room-only rental"
            )

        if listing.beds is not None and listing.beds < req.min_beds:
            result.hard_fails.append(
                f"{listing.beds:g} bed(s), need {req.min_beds:g}"
            )
        elif listing.beds is None:
            result.warnings.append("bedroom count unknown")

        if listing.baths is not None and listing.baths < req.min_baths:
            result.hard_fails.append(f"{listing.baths:g} bath(s), need {req.min_baths:g}")

        if req.min_sqft and listing.sqft is not None and listing.sqft < req.min_sqft:
            result.hard_fails.append(f"{listing.sqft} sqft, need {req.min_sqft}")

        if self.config.is_blocked(listing.geo.neighborhood):
            result.hard_fails.append(
                f"{listing.geo.neighborhood} is outside the commute area"
            )

        if listing.home_type.value in req.exclude_home_types:
            result.hard_fails.append(f"{listing.home_type.value} is excluded by config")

        if req.require_types and listing.home_type.value not in req.require_types:
            result.hard_fails.append(
                f"{listing.home_type.value} is not in the required types"
            )

        if req.pets_required and listing.pets_allowed is False:
            result.hard_fails.append("no pets allowed")

    def _timing_notes(self, listing: Listing, result: Score, today: date) -> None:
        """Flag availability drift without penalizing it.

        Searching seven months out means nearly everything currently listed
        will be long gone. That's expected and not a defect in the listing —
        it's a signal about *when* to act, so it's a note, not a deduction.
        """
        target = self.config.requirements.target_move_in
        if not target or not listing.available_date:
            return
        delta = (listing.available_date - target).days
        window = self.config.requirements.move_in_window_days
        if abs(delta) <= window:
            result.warnings.append(
                f"available {listing.available_date} — lines up with your {target} move"
            )
        elif delta < -window:
            months = abs(delta) // 30
            result.warnings.append(
                f"available {listing.available_date}, ~{months} month(s) before your "
                f"target — treat as a comp, not a candidate"
            )
        else:
            result.warnings.append(
                f"available {listing.available_date}, after your {target} target"
            )

    # ---- components --------------------------------------------------------

    def _neighborhood(self, listing: Listing) -> ScoreComponent | None:
        weight = self.weights["neighborhood"]
        name = listing.geo.neighborhood
        if not name:
            return None
        tier, value = self.config.tier_of(name)
        note = f"{name}" + (f" ({tier})" if tier else " — not in any configured tier")
        return _mk("neighborhood", None, value, weight, note)

    def _hosting_space(self, listing: Listing) -> ScoreComponent | None:
        """Can you actually have twelve people over?

        Square footage is the backbone, but a 1,250 sqft bungalow with a deck,
        an open kitchen and a fenced yard genuinely hosts better than a boxy
        1,600 sqft townhouse, so description signals carry real weight.
        """
        weight = self.weights["hosting_space"]
        target = self.config.requirements.hosting_target_sqft
        parts: list[tuple[float, float]] = []  # (value, sub-weight)
        notes: list[str] = []

        sqft_score = ramp(listing.sqft, 900, target)
        if sqft_score is not None:
            # Room above target still helps, with diminishing returns.
            if listing.sqft and listing.sqft > target:
                sqft_score = clamp(1.0 + 0.15 * ((listing.sqft - target) / target), 0, 1.15) / 1.15
            parts.append((sqft_score, 0.45))
            notes.append(f"{listing.sqft} sqft")

        if listing.beds is not None:
            bed_score = ramp(listing.beds, 2, 4)
            parts.append((bed_score or 0.0, 0.20))
            notes.append(f"{listing.beds:g}br")

        blob = " ".join([listing.title, listing.description, " ".join(listing.amenities)])
        signals, penalties = hosting_signals(blob)
        if blob.strip():
            signal_score = clamp(sum(signals.values()) / 3.0)
            parts.append((signal_score, 0.35))
            if signals:
                notes.append("+" + ", ".join(sorted(signals)))

        if not parts:
            return None

        total_sub = sum(w for _, w in parts)
        value = sum(v * w for v, w in parts) / total_sub

        if penalties:
            value = clamp(value - 0.25 * len(penalties))
            notes.append("−" + ", ".join(penalties))

        return _mk("hosting_space", listing.sqft, value, weight, "; ".join(notes))

    def _commute(self, listing: Listing) -> ScoreComponent | None:
        """Blend both commutes, protecting the worse one.

        A house that's 10 minutes from downtown and 40 from Green Hills is not
        a good compromise, so 30% of this component is the *worst* single
        commute rather than the average.
        """
        weight = self.weights["commute"]
        e = listing.enrichment
        pairs: list[tuple[str, float, float, float | None]] = []

        for anchor in self.config.anchors:
            lname = anchor.name.lower()
            if "downtown" in lname:
                minutes = e.commute_downtown_min
            elif "partner" in lname or "green" in lname:
                minutes = e.commute_partner_min
            else:
                minutes = None
            if minutes is not None:
                pairs.append((anchor.name, anchor.weight, minutes, anchor.max_minutes))

        if not pairs:
            return None

        subs: list[tuple[float, float]] = []
        notes: list[str] = []
        for name, aweight, minutes, ceiling in pairs:
            ceiling = ceiling or 30.0
            # 1.0 at half the ceiling, 0.5 at the ceiling, 0 at double it.
            value = clamp(1.0 - (minutes - ceiling * 0.5) / (ceiling * 1.5))
            subs.append((value, aweight))
            notes.append(f"{name} {minutes:.0f}m")

        mean = sum(v * w for v, w in subs) / sum(w for _, w in subs)
        worst = min(v for v, _ in subs)
        value = 0.7 * mean + 0.3 * worst

        return _mk("commute", None, value, weight, ", ".join(notes) + " (est. w/ traffic)")

    def _price_value(self, listing: Listing) -> ScoreComponent | None:
        weight = self.weights["price_value"]
        budget = self.config.budget
        if listing.price is None:
            return None

        floor = budget.max_price * 0.6
        if listing.price <= budget.max_price:
            base = 0.4 + 0.6 * clamp(
                (budget.max_price - listing.price) / max(budget.max_price - floor, 1)
            )
            note = f"${listing.price:,}/mo"
        else:
            over = listing.price - budget.max_price
            span = max(budget.stretch_price - budget.max_price, 1)
            base = 0.35 * clamp(1 - over / span)
            note = f"${listing.price:,}/mo — ${over:,} over budget"

        ppsf = listing.price_per_sqft
        if ppsf is not None:
            # Under $1.50/sqft is a genuine bargain here; over $2.60 is steep.
            efficiency = ramp(ppsf, 2.60, 1.50) or 0.0
            value = 0.6 * base + 0.4 * efficiency
            note += f", ${ppsf:.2f}/sqft"
        else:
            value = base

        return _mk("price_value", listing.price, value, weight, note)

    def _walkability(self, listing: Listing) -> ScoreComponent | None:
        weight = self.weights["walkability"]
        e = listing.enrichment
        parts: list[tuple[float, float]] = []
        notes: list[str] = []

        amenity = ramp(e.walk_amenity_count, 3, 40)
        if amenity is not None:
            parts.append((amenity, 0.35))
            notes.append(f"{e.walk_amenity_count} places within 800m")

        density = ramp(e.intersection_density, 20, 120)
        if density is not None:
            parts.append((density, 0.25))

        sidewalk = ramp(e.sidewalk_ratio, 0.05, 0.60)
        if sidewalk is not None:
            parts.append((sidewalk, 0.20))
            notes.append(f"{e.sidewalk_ratio:.0%} sidewalk coverage")

        park = ramp(e.nearest_park_m, 1200, 200)
        if park is not None:
            if e.greenway_within_1km:
                park = clamp(park + 0.15)
            parts.append((park, 0.20))
            notes.append(f"{e.nearest_park_name} {e.nearest_park_m:.0f}m away")
        elif e.parks_within_1km == 0:
            parts.append((0.0, 0.20))
            notes.append("no park within 1km")

        if not parts:
            return None

        value = sum(v * w for v, w in parts) / sum(w for _, w in parts)
        return _mk("walkability", e.walk_amenity_count, value, weight, "; ".join(notes))

    def _home_type(self, listing: Listing) -> ScoreComponent | None:
        weight = self.weights["home_type"]
        if listing.home_type is HomeType.UNKNOWN and not listing.description:
            return None
        value = listing.home_type.standalone_rank
        note = listing.home_type.value
        if listing.home_type is HomeType.UNKNOWN:
            note += " (couldn't tell from the listing)"
        return _mk("home_type", None, value, weight, note)

    def _dining_nightlife(self, listing: Listing) -> ScoreComponent | None:
        weight = self.weights["dining_nightlife"]
        e = listing.enrichment
        if e.bars_within_1200m is None and e.restaurants_within_1200m is None:
            return None

        bars = ramp(e.bars_within_1200m, 1, 12) or 0.0
        restaurants = ramp(e.restaurants_within_1200m, 2, 25) or 0.0
        cafes = ramp(e.cafes_within_1200m, 1, 8) or 0.0
        value = 0.40 * bars + 0.40 * restaurants + 0.20 * cafes

        note = (
            f"{e.bars_within_1200m or 0} bars, "
            f"{e.restaurants_within_1200m or 0} restaurants, "
            f"{e.cafes_within_1200m or 0} cafes within a 15-min walk"
        )
        return _mk("dining_nightlife", None, value, weight, note)

    def _safety(self, listing: Listing) -> ScoreComponent | None:
        weight = self.weights["safety"]
        e = listing.enrichment
        if e.safety_percentile is None:
            return None
        value = clamp(e.safety_percentile / 100.0)
        note = (
            f"{e.incidents_per_1k_year:.0f} reported incidents/1k/yr — "
            f"{e.safety_percentile:.0f}th percentile vs other Nashville neighborhoods "
            f"(MNPD open data; commercial districts read high)"
        )
        return _mk("safety", e.incidents_per_1k_year, value, weight, note)


def _mk(
    name: str, raw: float | None, value: float, weight: float, note: str
) -> ScoreComponent:
    value = clamp(value)
    return ScoreComponent(
        name=name,
        raw=raw,
        normalized=round(value, 4),
        weight=round(weight, 3),
        points=round(value * weight, 3),
        note=note,
    )
