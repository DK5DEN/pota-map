#!/usr/bin/env python3
"""Are the geometries plausible at all?

The reason this exists: 118 of 137 German trails had a geometry, which looked
fine in the statistics. In truth one long-distance trail came out 1.9 km long
instead of 223 - a feeder path had been matched instead. "Has a geometry" is
something else than "has the right one".

This check compares the order of magnitude of the geometry with what the POTA
name promises. It changes nothing, it only reports - and the report belongs in
the cron log, so that such a thing does not go unnoticed for weeks again.
"""
import math
import os
import re
import sys

from common import CACHE, DATA, load, save

# name pattern -> expected minimum size in km2
AREA_EXPECTATION = [
    (re.compile(r"national ?park|nationalpark", re.I), 20.0),
    (re.compile(r"biosphere|biosphären", re.I), 50.0),
    (re.compile(r"nature park|naturpark", re.I), 15.0),
]

# trails that cannot possibly be a handful of kilometres long
LONG_TRAIL = re.compile(
    r"fernwander|weitwander|\bE\d\b|europä|radweg|jakobsweg|pilgerweg|"
    r"küsten|hauptwanderweg|\bHW ?\d",
    re.IGNORECASE,
)
LONG_TRAIL_MIN_KM = 40.0


def length_km(geom):
    lines = (geom["coordinates"] if geom["type"] == "MultiLineString"
              else [geom["coordinates"]])
    s = 0.0
    for line in lines:
        for a, b in zip(line, line[1:]):
            dx = (b[0] - a[0]) * 111 * math.cos(math.radians(a[1]))
            dy = (b[1] - a[1]) * 111
            s += math.hypot(dx, dy)
    return s


def area_km2(geom):
    """Rough area via the shoelace formula, with latitude compression."""
    def ring_area(ring):
        s = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            s += x1 * y2 - x2 * y1
        return abs(s) / 2

    polys = (geom["coordinates"] if geom["type"] == "MultiPolygon"
             else [geom["coordinates"]])
    deg2 = 0.0
    for poly in polys:
        if not poly:
            continue
        deg2 += ring_area(poly[0]) - sum(ring_area(r) for r in poly[1:])
    if not polys or not polys[0] or not polys[0][0]:
        return 0.0
    lat = polys[0][0][0][1]
    return deg2 * 111.32 * 111.32 * math.cos(math.radians(lat))


def main():
    # Since the areas come from pota-map.info there is no matching of our own
    # left that could go wrong. What shows up here is almost always POTA's
    # naming (not every "National Park" in the list is one) - it is still
    # reported, as a view from outside.
    findings = []

    trails = load(os.path.join(DATA, "trails.geojson")).get("features", []) \
        if os.path.exists(os.path.join(DATA, "trails.geojson")) else []
    for f in trails:
        name = f["properties"]["name"]
        if not LONG_TRAIL.search(name):
            continue
        km = length_km(f["geometry"])
        if km < LONG_TRAIL_MIN_KM:
            ref = f["properties"]["ref"]
            findings.append({
                "ref": ref, "name": name, "kind": "trail too short",
                "value": round(km, 1), "expected": LONG_TRAIL_MIN_KM,
            })

    areas = load(os.path.join(DATA, "parks_polygons.geojson")).get("features", [])
    for f in areas:
        name = f["properties"]["name"]
        for pattern, minimum in AREA_EXPECTATION:
            if not pattern.search(name):
                continue
            km2 = area_km2(f["geometry"])
            if km2 < minimum:
                ref = f["properties"]["ref"]
                findings.append({
                    "ref": ref, "name": name, "kind": "area too small",
                    "value": round(km2, 1), "expected": minimum,
                })
            break

    save(os.path.join(CACHE, "plausibility.json"), findings)

    if not findings:
        print("plausibility: nothing to report")
        return 0

    print(f"plausibility: {len(findings)} suspicious magnitudes")
    for b in sorted(findings, key=lambda x: x["value"])[:15]:
        unit = "km" if b["kind"].startswith("trail") else "km2"
        print(f"  {b['ref']:9} {b['value']:8.1f} {unit:3} "
              f"(expected {b['expected']:.0f}) {b['name'][:44]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
