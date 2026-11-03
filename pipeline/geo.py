#!/usr/bin/env python3
"""Metres without a projection library.

The pipeline has shapely but no pyproj, and pulling in a projection stack for
what happens here would be out of proportion: every distance we care about is
under three kilometres, inside one park, away from the poles.

So instead of projecting, the whole scene - park outline, candidates, lines -
is scaled once into a local metric plane: degrees of latitude are a constant
111320 m, degrees of longitude are that times the cosine of the latitude the
park sits at. After that `distance()`, `buffer()` and STRtree return metres
directly. Over a few kilometres the error stays under a per mille, far below
the scatter of the OSM points themselves.

The same constant is used in the frontend (distanceToEdge in main.js).
"""
import math

import numpy as np
import shapely
from shapely import affinity

M_PER_DEG_LAT = 111320.0


def factors(lat):
    """(x, y) factors that turn degrees into metres around this latitude."""
    return M_PER_DEG_LAT * math.cos(math.radians(lat)), M_PER_DEG_LAT


def to_metric(geom, lat, tolerance=0.01):
    """One geometry into the local metric plane of `lat`.

    The park outlines carry vertices far denser than a centimetre - in one
    Luxembourg park 586 of 758 vertices land on top of each other once the
    degrees are metres. Those zero length segments make GEOS compute a
    division by zero on every distance ("invalid value encountered"), and
    they cost time in every one of the thousands of distances that follow.
    Dropping them changes no result and is left switchable for the caller
    who wants the untouched geometry.
    """
    fx, fy = factors(lat)
    scaled = affinity.scale(geom, xfact=fx, yfact=fy, origin=(0, 0, 0))
    return scaled.simplify(tolerance) if tolerance else scaled


def metres_to_degrees(metres, lat):
    """(lon, lat) degrees that cover this many metres - for padding a bbox."""
    fx, fy = factors(lat)
    return metres / fx, metres / fy


def pad_bbox(bbox, metres):
    """Widen (minx, miny, maxx, maxy) in degrees by a distance in metres."""
    minx, miny, maxx, maxy = bbox
    dx, dy = metres_to_degrees(metres, (miny + maxy) / 2)
    return minx - dx, miny - dy, maxx + dx, maxy + dy


# ------------------------------------------------------------------ mercator

R = 6378137.0


def to_mercator(geoms):
    """Geometries into web mercator, vectorised over the whole array.

    Why a projection after all, when the rest of this file avoids one: the
    lines - roads and power lines - are asked for a distance millions of
    times, from parks all over the map. Scaling them per park meant scaling
    the same line again and again, and it was by far the most expensive thing
    the run did.

    Mercator is the same everywhere, so the lines are projected once and go
    into one tree. It stretches distances by 1/cos(latitude), and that factor
    is the same in both directions locally - so a distance measured here times
    cos(latitude) is metres again, to well under a per mille over the few
    kilometres that matter.
    """
    def project(coords):
        out = np.empty_like(coords)
        out[:, 0] = np.radians(coords[:, 0]) * R
        out[:, 1] = np.log(np.tan(np.pi / 4 + np.radians(coords[:, 1]) / 2)) * R
        return out

    return shapely.transform(geoms, project)


def mercator_points(xs, ys):
    """Longitude/latitude arrays straight to mercator points."""
    return shapely.points(np.radians(xs) * R,
                          np.log(np.tan(np.pi / 4 + np.radians(ys) / 2)) * R)


def mercator_metres(lat):
    """What a mercator distance around this latitude has to be multiplied by."""
    return math.cos(math.radians(lat))


def bbox_of(bbox_list):
    """The bounding box around several bounding boxes."""
    xs0, ys0, xs1, ys1 = zip(*bbox_list)
    return min(xs0), min(ys0), max(xs1), max(ys1)
