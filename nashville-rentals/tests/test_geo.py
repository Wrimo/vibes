from __future__ import annotations

import pytest

from nashrent.geo.distance import bbox_around, haversine_m, point_in_geometry
from nashrent.geo.neighborhoods import NeighborhoodIndex, get_index


@pytest.fixture(scope="module")
def index() -> NeighborhoodIndex:
    return get_index(None)


def test_haversine_matches_known_distance():
    # Downtown to Green Hills is roughly 6.9 km as the crow flies.
    d = haversine_m(36.1627, -86.7816, 36.1047, -86.8158)
    assert 6000 < d < 8000


def test_haversine_is_symmetric_and_zero_at_identity():
    assert haversine_m(36.1, -86.8, 36.1, -86.8) == 0
    a = haversine_m(36.1, -86.8, 36.2, -86.9)
    b = haversine_m(36.2, -86.9, 36.1, -86.8)
    assert a == pytest.approx(b)


def test_bbox_contains_its_center():
    south, west, north, east = bbox_around(36.15, -86.83, 800)
    assert south < 36.15 < north
    assert west < -86.83 < east


def test_point_in_polygon_with_hole():
    geometry = {
        "type": "Polygon",
        "coordinates": [
            [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]],   # outer
            [[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2], [-0.2, -0.2]],  # hole
        ],
    }
    assert point_in_geometry(0.5, 0.5, geometry) is True
    assert point_in_geometry(0.0, 0.0, geometry) is False   # in the hole
    assert point_in_geometry(5.0, 5.0, geometry) is False   # outside


# ---- classification --------------------------------------------------------


def test_known_points_classify_correctly(index):
    cases = [
        ((36.1497, -86.8361), "Sylvan Park"),
        ((36.1047, -86.8158), "Green Hills"),
        ((36.1660, -86.8480), "The Nations"),
        ((36.1627, -86.7816), "Downtown"),
        ((36.0700, -86.9300), "Bellevue"),
    ]
    for (lat, lon), expected in cases:
        match = index.classify(lat, lon)
        assert match is not None, f"{expected} did not classify"
        assert match.name == expected
        assert match.exact


def test_tightest_circle_wins_over_broad_catchall(index):
    """Sylvan Park sits inside the broad 'West Nashville' circle; the specific
    name must win, or every west-side listing collapses into one bucket."""
    match = index.classify(36.1497, -86.8361)
    assert match.name == "Sylvan Park"


def test_far_away_point_is_unknown(index):
    assert index.classify(40.7128, -74.0060) is None  # New York City


def test_resolve_name_handles_source_blurbs(index):
    assert index.resolve_name("(Sylvan Park / West Nashville)") == "Sylvan Park"
    assert index.resolve_name("east nash") == "East Nashville"
    assert index.resolve_name("12South") == "12 South"
    assert index.resolve_name("greenhills") == "Green Hills"
    assert index.resolve_name("2br house in sylvan park!") == "Sylvan Park"
    assert index.resolve_name("") is None
    assert index.resolve_name("somewhere nobody named") is None


def test_resolve_name_prefers_longer_match(index):
    """'Belmont-Hillsboro' must not be shadowed by a shorter alias."""
    assert index.resolve_name("Belmont-Hillsboro") == "Belmont-Hillsboro"


def test_centroid_roundtrips(index):
    lat, lon = index.centroid("Sylvan Park")
    assert index.classify(lat, lon).name == "Sylvan Park"


def test_geojson_polygons_take_precedence(tmp_path):
    """A user-supplied boundary file must override the bundled approximation."""
    geojson = tmp_path / "hoods.geojson"
    geojson.write_text(
        """
        {"type": "FeatureCollection", "features": [
          {"type": "Feature",
           "properties": {"name": "Test Hood"},
           "geometry": {"type": "Polygon", "coordinates": [[
             [-86.85, 36.14], [-86.82, 36.14], [-86.82, 36.16], [-86.85, 36.16], [-86.85, 36.14]
           ]]}}
        ]}
        """
    )
    index = NeighborhoodIndex.load(geojson)
    # This point is inside both the custom polygon and bundled Sylvan Park.
    assert index.classify(36.1497, -86.8361).name == "Test Hood"
