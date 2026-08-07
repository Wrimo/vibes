"""Parks, bars, restaurants and walkability inputs from OpenStreetMap.

One Overpass query per listing pulls everything we need in a single round
trip: leisure/park polygons, food & drink POIs, groceries, and the street
network bits that stand in for walkability (intersection density, sidewalk
coverage). Results are cached for a week — the built environment moves slowly.
"""

from __future__ import annotations

import logging

from ..geo.distance import bbox_around, haversine_m
from ..models import Enrichment
from ..net import Fetcher, FetchError

log = logging.getLogger(__name__)

AMENITY_CACHE_TTL = 7 * 24 * 3600

PARK_RADIUS = 1000
FOOD_RADIUS = 1200
GROCERY_RADIUS = 1600
WALK_RADIUS = 800

# Overpass QL. `around` takes meters and does the distance filtering server
# side, which keeps the response small.
_QUERY = """
[out:json][timeout:60];
(
  nwr(around:{park_r},{lat},{lon})[leisure=park];
  nwr(around:{park_r},{lat},{lon})[leisure=nature_reserve];
  nwr(around:{park_r},{lat},{lon})[route=foot];
  nwr(around:{park_r},{lat},{lon})[highway=footway][footway!=sidewalk][name];

  nwr(around:{food_r},{lat},{lon})[amenity~"^(bar|pub|biergarten)$"];
  nwr(around:{food_r},{lat},{lon})[amenity=restaurant];
  nwr(around:{food_r},{lat},{lon})[amenity=cafe];

  nwr(around:{groc_r},{lat},{lon})[shop~"^(supermarket|grocery|greengrocer)$"];
);
out tags center;

(
  way(around:{walk_r},{lat},{lon})[highway~"^(residential|tertiary|secondary|primary|living_street|unclassified|footway|pedestrian)$"];
);
out tags center;
"""


class AmenityProvider:
    name = "amenities"

    def __init__(self, fetcher: Fetcher, overpass_url: str):
        self.fetcher = fetcher
        self.overpass_url = overpass_url

    def enrich(self, lat: float, lon: float, into: Enrichment) -> bool:
        query = _QUERY.format(
            lat=lat,
            lon=lon,
            park_r=PARK_RADIUS,
            food_r=FOOD_RADIUS,
            groc_r=GROCERY_RADIUS,
            walk_r=WALK_RADIUS,
        )
        try:
            payload = self.fetcher.post(
                self.overpass_url,
                data=query,
                headers={"Content-Type": "text/plain; charset=utf-8"},
                cache_ttl=AMENITY_CACHE_TTL,
            )
            import json

            data = json.loads(payload)
        except (FetchError, ValueError) as exc:
            log.warning("overpass failed at %s,%s: %s", lat, lon, exc)
            return False

        elements = data.get("elements", [])
        _tally(elements, lat, lon, into)
        return True


def _element_point(el: dict) -> tuple[float, float] | None:
    if "lat" in el and "lon" in el:
        return el["lat"], el["lon"]
    center = el.get("center")
    if center and "lat" in center and "lon" in center:
        return center["lat"], center["lon"]
    return None


def _tally(elements: list[dict], lat: float, lon: float, into: Enrichment) -> None:
    """Fold raw Overpass elements into the Enrichment fields.

    Split out from the provider so tests can exercise it against a recorded
    fixture without any network.
    """
    parks: list[tuple[float, str]] = []
    bars = restaurants = cafes = grocery = 0
    greenway = False

    highway_ways = 0
    sidewalk_ways = 0
    node_refs: dict[tuple[float, float], int] = {}

    for el in elements:
        tags = el.get("tags") or {}
        point = _element_point(el)

        if tags.get("leisure") in {"park", "nature_reserve"}:
            if point:
                d = haversine_m(lat, lon, point[0], point[1])
                parks.append((d, tags.get("name", "unnamed park")))
            continue

        if tags.get("route") == "foot" or (
            tags.get("highway") == "footway" and tags.get("footway") != "sidewalk"
        ):
            greenway = True
            continue

        amenity = tags.get("amenity")
        if amenity in {"bar", "pub", "biergarten"}:
            bars += 1
            continue
        if amenity == "restaurant":
            restaurants += 1
            continue
        if amenity == "cafe":
            cafes += 1
            continue

        if tags.get("shop") in {"supermarket", "grocery", "greengrocer"}:
            grocery += 1
            continue

        highway = tags.get("highway")
        if highway:
            highway_ways += 1
            if tags.get("sidewalk") in {"both", "left", "right", "yes"} or highway in {
                "footway",
                "pedestrian",
            }:
                sidewalk_ways += 1
            if point:
                key = (round(point[0], 4), round(point[1], 4))
                node_refs[key] = node_refs.get(key, 0) + 1

    parks.sort()
    into.parks_within_1km = len(parks)
    into.nearest_park_m = round(parks[0][0], 1) if parks else None
    into.nearest_park_name = parks[0][1] if parks else None
    into.greenway_within_1km = greenway

    into.bars_within_1200m = bars
    into.restaurants_within_1200m = restaurants
    into.cafes_within_1200m = cafes
    into.grocery_within_1600m = grocery

    # Walkability proxies. Intersection density is approximated by way
    # segments per square kilometer inside the walk radius — dense grids
    # (Sylvan Park, East Nashville) score far above cul-de-sac subdivisions.
    area_km2 = 3.14159 * (WALK_RADIUS / 1000) ** 2
    into.intersection_density = round(highway_ways / area_km2, 2) if area_km2 else None
    into.sidewalk_ratio = (
        round(sidewalk_ways / highway_ways, 3) if highway_ways else None
    )
    into.walk_amenity_count = bars + restaurants + cafes + grocery
