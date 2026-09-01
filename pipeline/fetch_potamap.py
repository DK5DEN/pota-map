#!/usr/bin/env python3
"""Fetch park areas and trails from pota-map.info.

The operator there has curated the reference-to-area mapping by hand for years
and allows reuse under the MIT license. It covers all 2585 parks of the seven
programs.

One file per country at https://pota-map.info/geojson/XX.geojson, where the
`id` property is the POTA reference. Several objects per reference are normal
(a park made of separate parts); line geometries are trails.

Output:
  parks_polygons.geojson, trails.geojson, web/parks/<REF>.geojson,
  web/park_bbox.json, cache/matched_refs.json
"""
import os
import shutil
import sys
import time
from collections import defaultdict

import requests
from shapely.geometry import (GeometryCollection, LineString,
                              MultiLineString, mapping, shape)
from shapely.ops import unary_union

from common import CACHE, DATA, PROGRAMS, UA, load, save

WEB_DIR = os.path.join(DATA, "web")
RAW_DIR = os.path.join(CACHE, "potamap")
URL = "https://pota-map.info/geojson/{}.geojson"

# Nothing is simplified here. An eight metre tolerance destroys real shape on
# small and scattered areas - a reference of a dozen tiny parts loses a third
# of its area - and tippecanoe simplifies per zoom level anyway, which is where
# it belongs (`--simplification=4` in build_tiles.sh). What comes out of here
# is exactly what pota-map.info publishes.

ATTRIBUTION = "© pota-map.info (DK5UR), MIT license"

# How the position check has to test a reference, written into
# park_bbox.json: an area is a point-in-polygon test, a trail one
# with a tolerance, and "both" needs either of them to hit.
BOX_KIND = {"area": 0, "trail": 1, "both": 2}


def fetch_country(prefix: str):
    """Download one country file and cache it. On a network error use the cache."""
    target = os.path.join(RAW_DIR, f"{prefix}.geojson")
    try:
        r = requests.get(URL.format(prefix), headers={"User-Agent": UA}, timeout=300)
        r.raise_for_status()
        os.makedirs(RAW_DIR, exist_ok=True)
        tmp = target + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(r.content)
        os.replace(tmp, target)
        print(f"  {prefix}: {len(r.content) / 1e6:.1f} MB downloaded", flush=True)
    except Exception as exc:
        if not os.path.exists(target):
            raise
        state = time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(target)))
        print(f"  {prefix}: download failed ({exc}), "
              f"using the cache from {state}", flush=True)
    return load(target)["features"]


def flatten(g):
    """Take a GeometryCollection apart, one level at a time.

    A single reference may arrive as a collection that holds area and line
    parts together instead of as separate objects. Without this the whole
    reference falls through the type check below and silently loses its
    geometry.
    """
    if g.geom_type == "GeometryCollection":
        for part in g.geoms:
            yield from flatten(part)
    else:
        yield g


def group_by_reference(features):
    """Merge the objects of one reference into a single geometry."""
    areas, lines = defaultdict(list), defaultdict(list)
    for ft in features:
        geom = ft.get("geometry")
        ref = (ft.get("properties") or {}).get("id")
        if not geom or not ref:
            continue
        try:
            collection = shape(geom)
        except Exception:
            continue
        for g in flatten(collection):
            if g.is_empty:
                continue
            if g.geom_type in ("Polygon", "MultiPolygon"):
                if not g.is_valid:
                    g = g.buffer(0)
                if not g.is_empty:
                    areas[ref].append(g)
            elif g.geom_type in ("LineString", "MultiLineString"):
                lines[ref].append(g)
    return areas, lines


def main():
    pota = load(os.path.join(CACHE, "pota_parks.json"))
    known = {}
    for prefix in PROGRAMS:
        for park in pota.get(prefix, []):
            known[park["reference"]] = park

    raw = []
    for prefix in PROGRAMS:
        raw.extend(fetch_country(prefix))
    print(f"{len(raw)} objects from {len(PROGRAMS)} country files", flush=True)

    areas, lines = group_by_reference(raw)

    # A park can carry both: a trail with a protected area of its own. Both
    # are kept. The tile layers stay apart (a line is not a fill), while the
    # per-park file holds everything the reference has, so download, GPX and
    # the position check see the whole park.
    both = sorted(set(areas) & set(lines))

    area_geom = {ref: (parts[0] if len(parts) == 1 else unary_union(parts))
                 for ref, parts in areas.items()}
    line_geom = {}
    for ref, parts in lines.items():
        pieces = []
        for g in parts:
            pieces.extend(g.geoms if g.geom_type == "MultiLineString" else [g])
        line_geom[ref] = MultiLineString(
            [LineString(list(t.coords)) for t in pieces])

    parks_dir = os.path.join(WEB_DIR, "parks")
    shutil.rmtree(parks_dir, ignore_errors=True)
    os.makedirs(parks_dir, exist_ok=True)

    poly_feats, line_feats = [], []
    unknown = []
    boxes = []
    kinds = {}

    def tile_feature(ref, geom, src):
        return {
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": {
                "ref": ref,
                "name": known[ref]["name"],
                "prog": ref.split("-")[0],
                "src": src,
            },
        }

    for ref in sorted(set(area_geom) | set(line_geom)):
        if ref not in known:
            unknown.append(ref)
            continue
        area = area_geom.get(ref)
        line = line_geom.get(ref)
        kind = "both" if area is not None and line is not None else \
               "area" if area is not None else "trail"
        kinds[ref] = kind

        # Everything this reference has, in one geometry - a collection where
        # it is both. One file per reference is what the frontend expects.
        whole = (GeometryCollection([area, line]) if kind == "both"
                 else area if kind == "area" else line)

        # Bounding box for the question "which park am I standing in?".
        # In the browser the areas exist only as tiles, so it can only test
        # what is currently on screen. With this list (about 140 KB) it finds
        # the candidates anywhere, loads exactly their per-park file and does
        # the exact test. Five decimals are a bit over one metre.
        minx, miny, maxx, maxy = whole.bounds
        boxes.append([ref, round(minx, 5), round(miny, 5),
                      round(maxx, 5), round(maxy, 5),
                      BOX_KIND[kind]])
        save(os.path.join(parks_dir, f"{ref}.geojson"), {
            "type": "Feature", "geometry": mapping(whole),
            "properties": {
                "ref": ref, "name": known[ref]["name"], "source": "potamap",
                "kind": kind, "attribution": ATTRIBUTION,
            },
        })

        src = "both" if kind == "both" else kind if kind == "trail" else "potamap"
        if area is not None:
            poly_feats.append(tile_feature(ref, area, src))
        if line is not None:
            line_feats.append(tile_feature(ref, line, src))

    save(os.path.join(DATA, "parks_polygons.geojson"),
         {"type": "FeatureCollection", "features": poly_feats})
    save(os.path.join(DATA, "trails.geojson"),
         {"type": "FeatureCollection", "features": line_feats})
    save(os.path.join(CACHE, "matched_refs.json"), sorted(kinds))
    save(os.path.join(WEB_DIR, "park_bbox.json"), sorted(boxes))
    # The statistics count a reference once, by what it mainly is: a park with
    # an area is an area, even when a trail runs through it.
    save(os.path.join(CACHE, "sources.json"),
         {ref: "trail" if kind == "trail" else "potamap"
          for ref, kind in sorted(kinds.items())})

    missing = sorted(set(known) - set(kinds))
    print(f"{len(poly_feats)} areas, {len(line_feats)} trails")
    print(f"{len(boxes)} bounding boxes -> {WEB_DIR}/park_bbox.json")
    if both:
        print(f"area and trail at once, both kept: {', '.join(both)}")
    if unknown:
        print(f"not in the POTA list, skipped: {len(unknown)} "
              f"(e.g. {unknown[:5]})")
    if missing:
        print(f"without geometry, shown as a point: {len(missing)} "
              f"(e.g. {missing[:5]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
