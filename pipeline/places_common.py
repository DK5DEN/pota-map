#!/usr/bin/env python3
"""What the places share: where the data lies, and what makes a place good.

The scoring is the model of POTASpotFinder (MIT,
github.com/mooxle/POTASpotFinder) by DA6MAX, down to the thresholds: five
components, prominence 30, quiet 25, horizon 20, comfort 15, access 10. They
are copied on purpose - a place ranked here and the same place ranked by his
tool should come out in the same order, otherwise comparing the two says
nothing.

Two things sit next to that hundred rather than inside it, so the comparison
stays honest and our own additions are visible as additions:

  * QRM distance - for a radio operator the distance to the overhead wire is
    more to the point than the distance to a road.
  * Edge distance - POTA wants you inside the park. A hundred and fifty
    metres of margin settle every GPS argument before it starts.

Two deviations from the original, both because of the data we have:

  * No tourist hotspot penalty. He asks Overpass for attractions; our POI set
    has no comparable category, and inventing one would move places around
    for a reason nobody could check.
  * The horizon is measured as an angle along the terrain out to three
    kilometres, not as "higher than the sample at 200, 500 and 1000 m". The
    result is turned back into his "open directions out of eight" so the
    points come out on the same scale.
"""
import os

from common import DATA

WEB = os.path.join(DATA, "web")

BBOX_PATH = os.path.join(WEB, "park_bbox.json")
PLACES_DIR = os.path.join(WEB, "places")
INDEX_PATH = os.path.join(WEB, "places_index.json")

POIS_PATH = os.path.join(DATA, "pois.geojson")
QRM_PATH = os.path.join(DATA, "qrm.geojson")
ROADS_PATH = os.path.join(DATA, "roads.geojson")
PARKS_PATH = os.path.join(DATA, "parks_polygons.geojson")
TRAILS_PATH = os.path.join(DATA, "trails.geojson")

FORMAT_VERSION = 1

# --------------------------------------------------------------- distances

HORIZON_M = 3000          # how far a line of sight is followed, for the display
HORIZON_NEAR_M = 1000     # what decides whether a direction counts as open
PROMINENCE_M = 200        # the surroundings a place is measured against
MERGE_M = 30              # closer than this is one place, not two
TRAIL_BUFFER_M = 60       # a trail has no area; this is its room, as in the map
JOIN_TOLERANCE = 1e-5     # degrees, about a metre: detail the join does not need
SUPPLY_M = 400            # water and toilets worth mentioning
KEEP = 10                 # places written per park
SHORTLIST = 40            # candidates that get the expensive terrain work

# ------------------------------------------------------- the model, in points

MAX_PROMINENCE = 30
MAX_QUIET = 25
MAX_HORIZON = 20
MAX_COMFORT = 15
MAX_ACCESS = 10
MAX_QRM = 15              # ours
MAX_EDGE = 10             # ours

# Metres above the surroundings -> points. First match wins.
PROMINENCE_STEPS = [(30, 30), (15, 22), (8, 14), (3, 7), (0, 3)]

# Metres to the nearest road that carries through traffic -> points. Being far
# away is good, but the sweet spot is 300 to 800 m: further out is usually a
# longer carry for the same quiet.
ROAD_STEPS = [(100, 0), (300, 8), (800, 20), (2000, 15)]
ROAD_DEFAULT = 10

# Where people gather, quiet ends. Taken off the road points, as in the
# original. What counts as a crowd here: an attraction, or an information
# board - both mark a place somebody drives to. Waymarkers are deliberately
# left out although the original counts them: they are the most common object
# in our woods by far, and a signpost at a junction says nothing about how
# busy a bench is.
HOTSPOT_NEAR_M = 100
HOTSPOT_MID_M = 300
HOTSPOT_PENALTY_NEAR = 5
HOTSPOT_PENALTY_MID = 2
HOTSPOT_KINDS = ("attraction", "board")

# Metres to the nearest car park -> points.
PARKING_STEPS = [(200, 4), (800, 10), (2000, 7)]
PARKING_DEFAULT = 2
PARKING_UNKNOWN = 3       # no car park anywhere near: not a verdict

# Open directions out of eight -> points.
HORIZON_STEPS = [(7, 20), (6, 17), (5, 14), (4, 10), (3, 6), (2, 3)]
HORIZON_BLOCKED = 1
HORIZON_UNKNOWN = 5       # no terrain data
HORIZON_VIEWPOINT_BONUS = 3

# What stands at the place. Summed over everything within MERGE_M, capped.
# Our kinds, his points: `hut` counts as a shelter, `camp` a notch below.
COMFORT_POINTS = {
    "picnic": 8,
    "shelter": 5,
    "hut": 5,
    "camp": 4,
    "bench": 4,
    "lounger": 2,
    "viewpoint": 2,
    "peak": 2,
    "tower": 2,
}

# Which kind names the place when several sit within MERGE_M of each other.
COMFORT_RANK = {"picnic": 6, "shelter": 5, "hut": 4, "camp": 3, "bench": 2,
                "lounger": 2, "viewpoint": 1, "peak": 1, "tower": 0}

CANDIDATE_GROUPS = ("comfort", "view")
NEIGHBOUR_GROUPS = ("access", "supply")

# A direction counts as open when nothing within HORIZON_NEAR_M rises higher
# than this. One degree is seventeen metres at a kilometre - below that it is
# the resolution of the model talking, not a hill.
OPEN_ANGLE = 1.0


def _steps(value, table, default):
    for threshold, points in table:
        if value < threshold:
            return points
    return default


def prominence_points(relative_m):
    if relative_m is None:
        return 0
    for threshold, points in PROMINENCE_STEPS:
        if relative_m >= threshold:
            return points
    return 0


def quiet_points(road_m, hotspot_m=None):
    """Distance to the nearest loud road, less what a crowd nearby costs."""
    points = MAX_QUIET if road_m is None else _steps(road_m, ROAD_STEPS, ROAD_DEFAULT)
    if hotspot_m is not None:
        if hotspot_m < HOTSPOT_NEAR_M:
            points -= HOTSPOT_PENALTY_NEAR
        elif hotspot_m < HOTSPOT_MID_M:
            points -= HOTSPOT_PENALTY_MID
    return max(0, min(MAX_QUIET, points))


def access_points(parking_m):
    if parking_m is None:
        return PARKING_UNKNOWN
    return _steps(parking_m, PARKING_STEPS, PARKING_DEFAULT)


def horizon_points(angles, kinds):
    """From the eight angles to points, on the original's scale."""
    if not angles:
        points = HORIZON_UNKNOWN
    else:
        open_dirs = sum(1 for a in angles if a <= OPEN_ANGLE)
        points = HORIZON_BLOCKED
        for threshold, value in HORIZON_STEPS:
            if open_dirs >= threshold:
                points = value
                break
    if "viewpoint" in kinds:
        # Somebody stood there and tagged it as a view. That is worth more
        # than any model of the ground.
        points = min(MAX_HORIZON, points + HORIZON_VIEWPOINT_BONUS)
    return points


def comfort_points(kinds):
    return min(MAX_COMFORT, sum(COMFORT_POINTS.get(k, 0) for k in kinds))


def qrm_points(qrm_m):
    """Ours: distance to power lines, substations and overhead wire."""
    if qrm_m is None:
        return MAX_QRM
    if qrm_m < 50:
        return 0
    if qrm_m < 150:
        return 4
    if qrm_m < 300:
        return 9
    if qrm_m < 600:
        return 13
    return MAX_QRM


def edge_points(edge_m, is_trail):
    """Ours: room to the boundary. On a trail the other way round."""
    if edge_m is None:
        return 0
    if is_trail:
        return MAX_EDGE if edge_m <= 20 else (6 if edge_m <= 40 else 3)
    if edge_m < 15:
        return 0
    if edge_m < 50:
        return 3
    if edge_m < 150:
        return 7
    return MAX_EDGE
