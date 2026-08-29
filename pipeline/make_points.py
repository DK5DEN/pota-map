#!/usr/bin/env python3
"""Point layer: every POTA park as a point, flagged whether it has an area.

Plus `minz`: the lowest zoom level at which the area can be drawn at all. A
tile is 4096 units wide; at zoom 4 one unit is roughly 600 m. A city park 85 m
across collapses into a single point there, its area rounds to zero and
tippecanoe drops it -- rightly so, it could not be drawn anyway.

So that the map knows the same parks at every zoom level (not just shows them
-- clickable, findable), such parks carry a point below their `minz`. That
affects 62 parks at zoom 4 and a single one at zoom 7.
"""
import json
import os
import sys

from common import CACHE, DATA, PROGRAMS, load, save

TILE_UNITS = 4096
MAX_Z = 8


def lowest_zoom(geom):
    """From which zoom level does the area measure at least one tile unit?"""
    polys = (geom["coordinates"] if geom["type"] == "MultiPolygon"
             else [geom["coordinates"]])
    points = [c for poly in polys for ring in poly for c in ring]
    if not points:
        return MAX_Z
    width = max(c[0] for c in points) - min(c[0] for c in points)
    height = max(c[1] for c in points) - min(c[1] for c in points)
    extent = max(width, height)
    for z in range(4, MAX_Z):
        if extent >= 360.0 / (2 ** z * TILE_UNITS):
            return z
    return MAX_Z


def area_zoom_levels():
    path = os.path.join(DATA, "parks_polygons.geojson")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as fh:
        feats = json.load(fh)["features"]
    return {f["properties"]["ref"]: lowest_zoom(f["geometry"])
            for f in feats}


def main():
    pota = load(os.path.join(CACHE, "pota_parks.json"))
    path = os.path.join(CACHE, "matched_refs.json")
    matched = set(load(path)) if os.path.exists(path) else set()
    minz = area_zoom_levels()

    features = []
    for prefix in PROGRAMS:
        for park in pota.get(prefix, []):
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [park["lon"], park["lat"]]},
                "properties": {
                    "ref": park["reference"],
                    "name": park["name"],
                    "prog": prefix,
                    "area": 1 if park["reference"] in matched else 0,
                    "minz": minz.get(park["reference"], 4),
                },
            })

    out = os.path.join(DATA, "parks_points.geojson")
    save(out, {"type": "FeatureCollection", "features": features})
    print(f"{len(features)} points -> {out}")


if __name__ == "__main__":
    sys.exit(main())
