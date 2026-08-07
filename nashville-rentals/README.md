# nashrent

A rental monitor for a specific search: a stand-alone house in west Nashville,
two-plus bedrooms, room to host people, walkable, under ~$2,500, moving
**March 2027**, with commutes to **downtown** and **Green Hills**.

It scrapes several listing sites, normalizes everything into one model,
enriches each address with real geographic data (parks, bars, drive times,
sidewalk coverage), scores it against that profile, and tracks it over time so
you can see what's *new*, what *dropped in price*, and what's gone.

```
  #  Score     Rent   Bd   SqFt  Type        Neighborhood     Commute
  1     80   $2,600    3  1,650  house       The Nations      16/21m
  2     78   $2,450    2  1,400  house       Sylvan Park      14/13m
  3     67   $2,500    2  1,400  duplex      Green Hills      22/6m
  4     34   $2,100    2  1,300  townhouse   Bellevue         31/24m

Why #1 ranks first — 3BR Nations bungalow open plan
  neighborhood      ████████████  18.0/18.0  The Nations (bullseye)
  hosting_space     ████████      12.1/18.0  1650 sqft; 3br; +firepit, outdoor_space
  home_type         ████████████  10.0/10.0  house
  price_value       ██████         6.1/12.0  $2,600/mo — $100 over budget, $1.58/sqft
```

---

## Quick start

```bash
cd nashville-rentals
python3 -m venv .venv && .venv/bin/pip install -e .

# What actually works from your machine and network?
.venv/bin/nashrent doctor

# Collect, score, and write an HTML report
.venv/bin/nashrent run --html
open reports/latest.html
```

`config/search.yaml` is the search. Edit it, re-run, done — no code changes.

---

## Read this before you trust the numbers

**Scraper adapters are unverified against live sites.** This was built in a
sandbox whose egress policy blocked every listing site and every geo API, so
Craigslist, Zillow, Realtor.com and Apartments.com were written against their
known response formats and tested against fixtures — not against the real
endpoints. The CSV source, the scoring engine, dedupe, storage, and the HTTP
layer are fully tested (145 tests, all offline).

`nashrent doctor` is the answer to this. It smoke-tests every enabled source
and every enrichment API from wherever you run it and tells you exactly what
works. **Run it first.** If a site changed shape, the adapter says so with a
message aimed at fixing it rather than returning a silent empty list.

**$2,500 is tight for what you want.** A detached 2BR house in Sylvan Park
proper, in good condition, tends to sit above that. The config handles this in
three ways rather than pretending otherwise:

- `stretch_price: 2800` — listings up to $2,800 still appear, they just lose
  points, because a great house at $2,650 is worth seeing.
- The Nations, Charlotte Park, Sylvan Heights and West Meade's eastern edge
  are all in the top tier alongside Sylvan Park. They're the same side of town
  with more inventory in your range.
- `nashrent comps` builds median asking rents per neighborhood from everything
  you've collected, so by January you'll know what $2,500 actually buys
  instead of guessing.

**You're searching seven months early.** Nashville leases post 30–60 days
ahead, so almost nothing listed today is a candidate for a March 2027 move.
That's fine and it's the point: listings you see now are *comps*. The scorer
labels them as such rather than penalizing them. Suggested cadence:

| When | What to do |
|---|---|
| Now → Nov 2026 | Run weekly. Build price history and calibrate the weights. |
| Dec 2026 → Jan 2027 | Run daily. Inventory for March starts appearing. |
| Jan → Feb 2027 | Run daily with `--notify`. This is when you actually pounce. |

---

## How scoring works

Each component is normalized to 0–1, then weighted. Weights live in config and
are rescaled to 100 points, so you can use any scale you like.

| Component | Weight | What it measures |
|---|---|---|
| `neighborhood` | 18 | Tier of the matched neighborhood — west Nashville is the bullseye |
| `hosting_space` | 18 | Square footage, bed count, and language signalling gathering space |
| `commute` | 16 | Drive times to both anchors, weighted to protect the *worse* one |
| `price_value` | 12 | Position in budget, plus $/sqft efficiency |
| `walkability` | 12 | Amenity density, intersection density, sidewalk coverage, park proximity |
| `home_type` | 10 | Detached house → duplex → townhouse → condo → apartment unit |
| `dining_nightlife` | 8 | Bars, restaurants and cafés within a 15-minute walk |
| `safety` | 6 | Reported-incident rate vs other Nashville neighborhoods |

Three design decisions worth knowing:

**Missing data lowers *coverage*, not score.** A listing scored before
enrichment runs is graded only on what's known, and the report shows
"58% of the profile evaluated". A score of 82 at 45% coverage is a different
claim than 82 at 100%, and you can see which you're looking at.

**Hard filters are separate from scoring.** A 1-bedroom isn't a low score, it's
disqualified — but it stays in the database so price history and comps survive.

**Commute protects the worse commute.** 30% of that component is the *worst*
single drive time, so a house that's 10 minutes from downtown and 40 from Green
Hills loses to one that's 20 and 20. Two people have to live there.

`hosting_space` reads the listing text for things that actually matter when
twelve people come over — open floor plans, decks and porches, fenced yards,
separate dining rooms, kitchen islands, fire pits — and penalizes "quiet
building, no parties", shared kitchens, and room-only rentals.

---

## Sources

| Source | Default | Notes |
|---|---|---|
| `craigslist` | **on** | Best source for by-owner house rentals. No key needed. |
| `csv` | **on** | Manual listings you find yourself. Never breaks. |
| `zillow` | off | Richest data, blocks datacenter IPs hardest. Run from home. |
| `realtor` | off | Good house coverage, moderate bot defenses. |
| `apartments` | off | Complex-heavy — the least useful source for this profile. |

Zillow and Realtor.com will likely work from your laptop and fail from a
server. That's why they're off by default: a fresh clone works immediately.
Turn them on, run `nashrent doctor`, and keep whatever passes.

### The CSV source is the one that always works

```bash
nashrent init-csv config/manual-listings.csv
```

Drop in anything you find by hand — a Facebook Marketplace post, a yard sign, a
property manager's own site — and it gets geocoded, enriched, scored and
tracked alongside the scraped listings. One ranked list, not two. Only `url` is
required; missing fields are parsed out of the title and notes.

### Adding a source

Write one class, decorate it, and nothing else changes:

```python
from nashrent.sources.base import Source, register
from nashrent.models import Listing

@register
class MySource(Source):
    name = "mysite"
    blurb = "what this covers"

    def search(self):
        for row in self.fetcher.get_json("https://...")["results"]:
            yield Listing(source=self.name, source_id=row["id"], url=row["url"], ...)
```

Then enable it in `config/search.yaml`. Dedupe, enrichment, scoring, storage,
reporting and alerting all pick it up automatically.

---

## Data sources and their limits

**Geography** — OpenStreetMap via Nominatim (geocoding), Overpass (parks,
bars, restaurants, sidewalks) and OSRM (drive times). All free and public.
Please keep `net.per_host_delay` at 1.5s or higher; Nominatim's usage policy
caps you at 1 request/second and the cache means you rarely re-fetch anyway.

Drive times come from OSRM's free-flow routing with a 1.45× rush-hour
multiplier applied (`enrich/commute.py`). Treat them as a consistent relative
ranking, not a promise about 8am on I-440.

**Neighborhoods** — the bundled `data/neighborhoods.json` is a hand-placed
centroid-and-radius approximation, accurate to a few hundred meters. Good
enough for tier assignment, not for boundaries. Point
`neighborhoods.geojson_path` at a real GeoJSON file and it takes precedence.

**Safety** — Metro Nashville PD incident data published on data.nashville.gov.
Two honest caveats, both shown in the report:

- These are *reported incidents*, which reflect reporting and patrol patterns
  as much as underlying risk.
- Raw counts are inflated wherever the daytime population dwarfs the
  residential one. Downtown, Midtown and the Green Hills mall area all read
  worse per-resident than they feel to someone living there.

That's why safety carries the smallest weight (6 of 100) and is expressed as a
percentile against other Nashville neighborhoods rather than a label. No
demographic data is used anywhere in this project.

---

## Commands

| Command | What it does |
|---|---|
| `nashrent run [--html] [--notify] [--no-enrich]` | Scrape, score, store, report |
| `nashrent doctor [--dump SOURCE]` | Smoke-test every source and API from here |
| `nashrent report [--html] [--all]` | Re-render from the database, no network |
| `nashrent rescore` | Re-score stored listings after changing weights |
| `nashrent comps` | Median asking rent by neighborhood, from your own data |
| `nashrent status` | Database summary |
| `nashrent mark KEY STATUS [--note]` | Triage: `interested`, `applied`, `rejected` |
| `nashrent sources` | List adapters and whether they're enabled |

Triage survives re-scraping — a listing you mark `rejected` never comes back
as `new`.

## Scheduling

```cron
# Weekly now; switch to daily around December.
0 8 * * 1  cd /path/to/nashville-rentals && .venv/bin/nashrent run --html --notify
```

Alerts are off until you set `notify.enabled: true` and a webhook or SMTP
target. `notify.min_score` defaults to 70 — in a market this fast the
threshold matters more than the channel, since a notifier that fires on
everything gets muted within a week.

## Tests

```bash
.venv/bin/python -m pytest
```

145 tests, no network required.

## Layout

```
src/nashrent/
  config.py      search profile (YAML → validated model)
  models.py      canonical Listing, Score, Enrichment
  net.py         polite HTTP: robots, rate limits, disk cache, retries
  sources/       one adapter per site + shared text extraction
  geo/           geocoding, distance, neighborhood classification
  enrich/        Overpass amenities, OSRM commutes, MNPD safety data
  score.py       the weighted profile
  dedupe.py      cross-source merging
  store.py       SQLite: history, triage, comps
  report.py      terminal table + HTML report
  pipeline.py    the run loop, with per-stage failure isolation
```
