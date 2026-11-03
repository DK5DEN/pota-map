#!/usr/bin/env python3
"""Where to sit down in a park: the best places, computed once for everyone.

The idea comes from POTASpotFinder (MIT, github.com/mooxle/POTASpotFinder) by
DA6MAX: pick a park, get the handful of places in it that are worth carrying a
station to - a picnic table on a rise with a clear horizon beats a bench in a
hollow under a power line. His tool asks Overpass and an elevation service for
every run, which is fine for one person and impossible for a public map.

It does not have to be that way here. The pipeline already holds everything:
the OSM extracts, the classified points, the park outlines. So the question is
answered the other way round - once a month for all parks, written out as one
small file each. Nobody's API is asked at run time, and what a visitor tapped
once is in their browser cache for the day out.

  places/<REF>.json      the places of one park, best first
  places_index.json      count and best score per park, so the map knows
                         before asking whether there is anything to ask for

Run as part of run_pois.sh, or for single parks:

    python compute_places.py --ref DE-0123
    python compute_places.py --missing        # everything without a file yet
"""
import argparse
import json
import math
import os
import sys
import time

import numpy as np
import shapely
from shapely.geometry import shape
from shapely.strtree import STRtree

import places_common as pc
from common import DATA, load, save
from dem import Dem, pixel_metres
from geo import (factors, mercator_metres, mercator_points, metres_to_degrees,
                 pad_bbox, to_mercator)

# Reading a gigabyte of JSON is only cheap if most lines never see a parser.
CANDIDATE_MARKS = tuple(f'"group": "{g}"' for g in pc.CANDIDATE_GROUPS)
NEIGHBOUR_MARKS = tuple(f'"group": "{g}"' for g in pc.NEIGHBOUR_GROUPS)
HOTSPOT_MARKS = tuple(f'"kind": "{k}"' for k in pc.HOTSPOT_KINDS)

CHUNK = 250_000
EARTH_R = 6371000.0
REFRACTION = 1.33          # standard atmosphere, the usual approximation
DIRECTIONS = 8


# ----------------------------------------------------------------- reading

def features(path, marks=None):
    """Stream a FeatureCollection that was written one feature per line.

    The first line carries the collection header, the last one the closing
    brackets; everything else is a feature with a trailing comma. Anything
    that does not contain one of `marks` never reaches json.loads.
    """
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            start = line.find('{"type": "Feature"')
            if start < 0:
                continue
            if marks and not any(m in line for m in marks):
                continue
            body = line[start:].rstrip().rstrip("]}").rstrip().rstrip(",")
            try:
                yield json.loads(body)
            except json.JSONDecodeError:
                continue


def load_parks(refs=None):
    """Park outlines with the reference they belong to."""
    parks = []
    for path, is_trail in ((pc.PARKS_PATH, False), (pc.TRAILS_PATH, True)):
        if not os.path.exists(path):
            continue
        for feature in load(path).get("features", []):
            props = feature.get("properties") or {}
            ref = props.get("ref")
            if not ref or (refs and ref not in refs):
                continue
            try:
                geom = shape(feature["geometry"])
            except Exception:
                continue
            if geom.is_empty:
                continue
            if not geom.is_valid:
                geom = geom.buffer(0)
                if geom.is_empty:
                    continue
            # A trail has no area. Nothing would ever sit exactly on the line,
            # so it gets the same room the map gives it - and the distance is
            # then measured to the line itself, not to the edge of that room.
            line = None
            if is_trail:
                lat0 = (geom.bounds[1] + geom.bounds[3]) / 2
                _, dy = metres_to_degrees(pc.TRAIL_BUFFER_M, lat0)
                line, geom = geom, geom.buffer(dy)
                if geom.is_empty:
                    continue
            parks.append({"ref": ref, "name": props.get("name") or "",
                          "geom": geom, "line": line, "trail": is_trail,
                          "candidates": []})
    return parks


# -------------------------------------------------------------- the joins

def progress(what, done, started):
    """A run of this length has to say where it is - it lands in the cron log."""
    print(f"  {what}: {done:,} after {time.time() - started:.0f} s", flush=True)


def collect_points(parks, inner):
    """Read the POI file once: candidates into their parks, the rest into trees.

    The direction of the join is what makes this fast or hopeless. Asking a
    tree of parks for every point puts the work in the wrong place: a point
    lands in ten park boxes on average, and each of those ten answers with a
    full point-in-polygon walk over an outline that can have half a million
    edges - measured, nine minutes for a quarter of a million points, and
    there are millions of them.

    Turned around it is seconds: the points go into a tree, each park is asked
    once, and `contains_xy` tests all of its candidates in one vectorised call
    against the prepared outline.

    What is only ever asked "how far to the nearest one" - car parks, water,
    toilets - does not need a park at all. Those go into one tree in mercator
    and are answered per candidate later.
    """
    marks = CANDIDATE_MARKS + NEIGHBOUR_MARKS + HOTSPOT_MARKS
    cand_x, cand_y, cand_meta = [], [], []
    near = {"parking": ([], []), "water": ([], []), "toilets": ([], []),
            "crowd": ([], [])}
    seen = 0
    started = time.time()

    for feature in features(pc.POIS_PATH, marks):
        seen += 1
        if seen % 2_000_000 == 0:
            progress("points read", seen, started)
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            continue
        props = feature.get("properties") or {}
        group = props.get("group")
        kind = props.get("kind") or ""
        lon, lat = geometry["coordinates"][:2]
        if group in pc.CANDIDATE_GROUPS:
            cand_x.append(lon)
            cand_y.append(lat)
            cand_meta.append((kind, props.get("name") or ""))
        elif kind in near:
            near[kind][0].append(lon)
            near[kind][1].append(lat)
        elif kind in pc.HOTSPOT_KINDS:
            near["crowd"][0].append(lon)
            near["crowd"][1].append(lat)
    progress("points read", seen, started)

    cand_x = np.array(cand_x)
    cand_y = np.array(cand_y)
    cand_tree = STRtree(shapely.points(cand_x, cand_y)) if len(cand_x) else None

    started = time.time()
    found = 0
    for i, park in enumerate(parks, 1):
        if i % 1000 == 0:
            progress("parks joined", i, started)
        if cand_tree is None:
            continue
        maybe = cand_tree.query(inner[i - 1])
        if not len(maybe):
            continue
        hit = maybe[shapely.contains_xy(inner[i - 1], cand_x[maybe], cand_y[maybe])]
        for j in hit:
            kind, name = cand_meta[j]
            park["candidates"].append((float(cand_x[j]), float(cand_y[j]), kind, name))
        found += len(hit)

    trees = {}
    for kind, (xs, ys) in near.items():
        trees[kind] = STRtree(mercator_points(np.array(xs), np.array(ys))) if xs else None
    return found, trees


def load_lines(path):
    """Every line of a file as one tree in mercator, or None when there is none.

    They are never assigned to a park. A park does not need to own a road to
    be near it, and owning it meant projecting the same road once per park -
    with ten million assignments that was the bulk of the run.
    """
    geoms = []
    started = time.time()
    for feature in features(path):
        geometry = feature.get("geometry") or {}
        if geometry.get("type") not in ("LineString", "MultiLineString"):
            continue
        try:
            geoms.append(shape(geometry))
        except Exception:
            continue
        if len(geoms) % 500_000 == 0:
            progress(f"{os.path.basename(path)} read", len(geoms), started)
    if not geoms:
        return None
    tree = STRtree(to_mercator(np.array(geoms, dtype=object)))
    print(f"  {os.path.basename(path)}: {len(geoms)} lines in "
          f"{time.time() - started:.0f} s", flush=True)
    return tree


# ------------------------------------------------------------- the terrain

def prominence(patch, lat, lon, radius_px):
    """Height, and height above the mean of what stands around it."""
    height = patch.at(lat, lon)
    if height is None:
        return None, None
    row, col = patch.rowcol(lat, lon)
    around = patch.window(row, col, radius_px)
    if around.size < 9:
        return height, None
    return height, float(height - around.mean())


def horizon(patch, lat, lon, height, pixel_m):
    """Eight lines of sight, in degrees above the horizontal.

    Two numbers per direction, from one walk along the ray: the worst
    obstruction within a kilometre, which is what decides whether a direction
    counts as open, and the worst over the full three kilometres, which is
    what gets shown. Judging openness over three kilometres would call almost
    every place in hill country blocked - somewhere out there something is
    always higher - and a ridge that far away is not what stops a signal.

    Curvature and standard refraction are taken off the far end. Over three
    kilometres that is barely half a metre, but it costs one line and keeps
    the number honest on a flat coast.
    """
    steps = max(4, int(pc.HORIZON_M / pixel_m))
    near_steps = max(2, int(pc.HORIZON_NEAR_M / pixel_m))
    distances = np.arange(1, steps + 1, dtype=np.float64) * pixel_m
    drop = distances * distances / (2.0 * REFRACTION * EARTH_R)
    row, col = patch.rowcol(lat, lon)
    grid = patch.grid
    rows, cols = grid.shape
    angles, near = [], []
    for i in range(DIRECTIONS):
        azimuth = 2.0 * math.pi * i / DIRECTIONS
        rr = np.rint(row - np.cos(azimuth) * distances / pixel_m).astype(np.int64)
        cc = np.rint(col + np.sin(azimuth) * distances / pixel_m).astype(np.int64)
        inside = (rr >= 0) & (rr < rows) & (cc >= 0) & (cc < cols)
        if not inside.any():
            angles.append(0.0)
            near.append(0.0)
            continue
        values = grid[rr[inside], cc[inside]].astype(np.float64)
        good = values != -32768
        if not good.any():
            angles.append(0.0)
            near.append(0.0)
            continue
        d = distances[inside][good]
        deg = np.degrees(np.arctan2(values[good] - height - drop[inside][good], d))
        angles.append(round(float(max(0.0, deg.max())), 1))
        close = d <= pc.HORIZON_NEAR_M
        near.append(round(float(max(0.0, deg[close].max())), 1) if close.any() else 0.0)
    return angles, near


# -------------------------------------------------------------- one park

def merge_candidates(points, fx, fy):
    """Points closer than MERGE_M are one place with several things on it.

    A rest area is three nodes in OSM - table, bench, waste basket - and
    listing it three times would fill the whole list with one spot. The
    comparison has to happen in metres, so the degrees are scaled first:
    thirty degrees of tolerance would merge a country.
    """
    merged = []
    for x, y, kind, name in points:
        for slot in merged:
            if ((slot["x"] - x) * fx) ** 2 + ((slot["y"] - y) * fy) ** 2 <= pc.MERGE_M ** 2:
                slot["kinds"].append(kind)
                if pc.COMFORT_RANK.get(kind, -1) > pc.COMFORT_RANK.get(slot["kind"], -1):
                    slot["kind"], slot["x"], slot["y"] = kind, x, y
                if name and not slot["name"]:
                    slot["name"] = name
                break
        else:
            merged.append({"x": x, "y": y, "kind": kind, "name": name,
                           "kinds": [kind]})
    return merged


def nearest_metres(tree, points, scale):
    """Distance to the closest thing in the tree, for all points at once."""
    if tree is None or not len(points):
        return [None] * len(points)
    # With an array of inputs the first row of the result says which input a
    # hit belongs to; the tree index itself is of no interest here.
    pairs, dist = tree.query_nearest(points, return_distance=True, all_matches=False)
    out = [None] * len(points)
    for position, value in zip(pairs[0], dist):
        out[int(position)] = float(value) * scale
    return out


def score_park(park, dem, want_dem, trees):
    """Everything for one park, from candidates to the finished list."""
    if not park["candidates"]:
        return []

    bounds = park["geom"].bounds
    lat0 = (bounds[1] + bounds[3]) / 2
    fx, fy = factors(lat0)
    scale = mercator_metres(lat0)

    merged = merge_candidates(park["candidates"], fx, fy)
    xs = np.array([m["x"] for m in merged])
    ys = np.array([m["y"] for m in merged])
    points = mercator_points(xs, ys)

    # The boundary is the only thing that belongs to this park alone, so it is
    # the only geometry projected here.
    # simplify against the same zero length segments as everywhere else: the
    # outlines carry vertices far below a centimetre, and GEOS divides by zero
    # on them ("invalid value encountered in distance").
    edge_geom = to_mercator(
        park["line"] if park["trail"] else park["geom"].boundary).simplify(0.01)
    edges = (shapely.distance(edge_geom, points) * scale
             if not edge_geom.is_empty else np.full(len(points), np.nan))

    qrm = nearest_metres(trees.get("qrm"), points, scale)
    road = nearest_metres(trees.get("road"), points, scale)
    parking = nearest_metres(trees.get("parking"), points, scale)
    water = nearest_metres(trees.get("water"), points, scale)
    toilets = nearest_metres(trees.get("toilets"), points, scale)
    crowd = nearest_metres(trees.get("crowd"), points, scale)

    places = []
    for i, slot in enumerate(merged):
        edge_m = None if np.isnan(edges[i]) else float(edges[i])
        supply = min([d for d in (water[i], toilets[i]) if d is not None], default=None)
        distances = {"edge": edge_m, "qrm": qrm[i], "road": road[i], "park": parking[i]}
        if crowd[i] is not None and crowd[i] <= pc.HOTSPOT_MID_M:
            distances["crowd"] = crowd[i]
        if supply is not None and supply <= pc.SUPPLY_M:
            distances["water"] = supply
        places.append({
            "slot": slot,
            "d": distances,
            "f": {
                # The five of the model, terrain filled in below.
                "prom": 0,
                "quiet": pc.quiet_points(distances["road"], crowd[i]),
                "hor": pc.horizon_points(None, slot["kinds"]),
                "comfort": pc.comfort_points(slot["kinds"]),
                "access": pc.access_points(distances["park"]),
                # Ours.
                "qrm": pc.qrm_points(distances["qrm"]),
                "edge": pc.edge_points(edge_m, park["trail"]),
            },
        })

    # Only the best few are worth terrain work.
    places.sort(key=lambda p: sum(p["f"].values()), reverse=True)
    places = places[:pc.SHORTLIST]

    if want_dem and dem is not None:
        for place in places:
            lat, lon = place["slot"]["y"], place["slot"]["x"]
            # One patch per place, not one per park: a national park with three
            # kilometres of margin is a grid of tens of millions of cells, and
            # forty places touch a fraction of it. The tile cache in dem.py
            # keeps neighbouring places from reading the same tile twice.
            patch = dem.patch(pad_bbox((lon, lat, lon, lat), pc.HORIZON_M))
            if patch is None:
                continue
            pixel_m = pixel_metres(lat)
            radius_px = max(1, int(round(pc.PROMINENCE_M / pixel_m)))
            height, relative = prominence(patch, lat, lon, radius_px)
            place["d"]["ele"] = height
            place["f"]["prom"] = pc.prominence_points(relative)
            if height is not None:
                place["hz"], near = horizon(patch, lat, lon, height, pixel_m)
                place["f"]["hor"] = pc.horizon_points(near, place["slot"]["kinds"])

    out = []
    for place in places:
        slot = place["slot"]
        entry = {
            "y": round(slot["y"], 5),
            "x": round(slot["x"], 5),
            "s": sum(place["f"].values()),
            "k": slot["kind"],
            "f": place["f"],
            "d": {k: (round(v) if isinstance(v, float) else v)
                  for k, v in place["d"].items() if v is not None},
        }
        if slot["name"]:
            entry["n"] = slot["name"][:80]
        if place.get("hz"):
            entry["hz"] = place["hz"]
        out.append(entry)
    out.sort(key=lambda e: e["s"], reverse=True)
    return out[:pc.KEEP]


# ------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Best places per park")
    ap.add_argument("--ref", nargs="*", help="only these references")
    ap.add_argument("--missing", action="store_true",
                    help="only parks that have no file yet")
    ap.add_argument("--no-dem", action="store_true",
                    help="skip heights, horizon and prominence")
    args = ap.parse_args()

    refs = set(r.upper() for r in args.ref) if args.ref else None
    if args.missing:
        have = set(load(pc.INDEX_PATH)) if os.path.exists(pc.INDEX_PATH) else set()
        known = {row[0] for row in load(pc.BBOX_PATH)}
        refs = (refs or known) - have
        if not refs:
            print("nothing missing")
            return 0

    started = time.time()
    parks = load_parks(refs)
    if not parks:
        print("no park geometries - run fetch_potamap.py first", file=sys.stderr)
        return 1
    print(f"{len(parks)} outlines loaded, {time.time() - started:.0f} s", flush=True)

    # Two trees, and both are asked millions of times - which is where the
    # only real cost of this script sits.
    #
    # The outlines are detailed to the metre; the largest is half a million
    # vertices. For "is this bench inside", a metre of tolerance is nothing
    # and the vertices are everything, so the join runs on simplified copies.
    # `prepare` builds the index GEOS needs for repeated point-in-polygon -
    # without it every test walks the whole ring, and the run takes hours
    # instead of minutes.
    inner = [p["geom"].simplify(pc.JOIN_TOLERANCE) for p in parks]
    shapely.prepare(inner)

    found, trees = collect_points(parks, inner)
    print(f"{found} candidates in parks, {time.time() - started:.0f} s", flush=True)

    trees["qrm"] = load_lines(pc.QRM_PATH)
    trees["road"] = load_lines(pc.ROADS_PATH)
    print(f"lines indexed, {time.time() - started:.0f} s", flush=True)

    dem = None if args.no_dem else Dem()
    want_dem = dem is not None and dem.available()
    if dem is not None and not want_dem:
        print("no terrain tiles or no pillow - see fetch_dem.py; "
              "scoring without heights", flush=True)

    os.makedirs(pc.PLACES_DIR, exist_ok=True)
    index = {} if refs else None
    if refs and os.path.exists(pc.INDEX_PATH):
        index = load(pc.INDEX_PATH)
    elif index is None:
        index = {}

    empty = 0
    written = 0
    seen_refs = set()
    scoring = time.time()
    for done, park in enumerate(parks, 1):
        if done % 250 == 0:
            progress("parks scored", done, scoring)
        places = score_park(park, dem, want_dem, trees)
        if not places:
            empty += 1
            # Noted in the index all the same, with a count of nothing: a park
            # where OSM knows no bench is answered, not missing, and the daily
            # top-up must not rediscover it every morning.
            index.setdefault(park["ref"], [0, 0])
            continue
        # One reference can hold both an area and a trail (DE-0637 does).
        # Writing the second one over the first would drop half its places,
        # so they are merged and the best of both survive.
        if park["ref"] in seen_refs:
            before = load(os.path.join(pc.PLACES_DIR, f"{park['ref']}.json"))
            places = sorted(before["places"] + places,
                            key=lambda e: e["s"], reverse=True)[:pc.KEEP]
        seen_refs.add(park["ref"])
        save(os.path.join(pc.PLACES_DIR, f"{park['ref']}.json"), {
            "ref": park["ref"],
            "v": pc.FORMAT_VERSION,
            "built": time.strftime("%Y-%m-%d"),
            "dem": "terrarium-z12" if want_dem else None,
            "attribution": [
                "© OpenStreetMap contributors, ODbL",
                "© pota-map.info (DK5UR), MIT",
            ] + (["Europe terrain data produced using Copernicus data and "
                  "information funded by the European Union - EU-DEM layers"]
                 if want_dem else []),
            "places": places,
        })
        index[park["ref"]] = [len(places), places[0]["s"]]
        written = len(seen_refs)

    if not refs:
        # A full run is the whole truth: whatever is not in it any more (the
        # bench was removed, the outline changed) must not stay on the disk
        # answering requests.
        stale = 0
        for name in os.listdir(pc.PLACES_DIR):
            if name.endswith(".json") and name[:-5] not in index:
                os.remove(os.path.join(pc.PLACES_DIR, name))
                stale += 1
        if stale:
            print(f"{stale} files removed for parks without places")

    save(pc.INDEX_PATH, index)
    print(f"{written} parks with places, {empty} without a single candidate")
    if dem is not None and dem.missing:
        print(f"{len(dem.missing)} terrain tiles were missing from the store")
    print(f"done in {time.time() - started:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
