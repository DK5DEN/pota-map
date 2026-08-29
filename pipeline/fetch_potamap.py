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
from shapely.geometry import LineString, MultiLineString, mapping, shape
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


def group_by_reference(features):
    """Merge the objects of one reference into a single geometry."""
    areas, lines = defaultdict(list), defaultdict(list)
    for ft in features:
        geom = ft.get("geometry")
        ref = (ft.get("properties") or {}).get("id")
        if not geom or not ref:
            continue
        try:
            g = shape(geom)
        except Exception:
            continue
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

    # A park can carry both (a trail with a protected area of its own). The
    # area wins, otherwise the same reference would sit in two tile layers and
    # the popup would show it twice.
    both = sorted(set(areas) & set(lines))
    for ref in both:
        lines.pop(ref, None)

    parks_dir = os.path.join(WEB_DIR, "parks")
    shutil.rmtree(parks_dir, ignore_errors=True)
    os.makedirs(parks_dir, exist_ok=True)

    poly_feats, line_feats = [], []
    unknown = []
    boxes = []

    def store(ref, geom, kind):
        """Per-park file and tile feature from the same geometry."""
        park = known.get(ref)
        if park is None:
            unknown.append(ref)
            return None
        # Bounding box for the question "which park am I standing in?".
        # In the browser the areas exist only as tiles, so it can only test
        # what is currently on screen. With this list (about 140 KB) it finds
        # the candidates anywhere, loads exactly their per-park file and does
        # the exact test. Five decimals are a bit over one metre.
        minx, miny, maxx, maxy = geom.bounds
        boxes.append([ref, round(minx, 5), round(miny, 5),
                        round(maxx, 5), round(maxy, 5),
                        1 if kind == "trail" else 0])
        save(os.path.join(parks_dir, f"{ref}.geojson"), {
            "type": "Feature", "geometry": mapping(geom),
            "properties": {
                "ref": ref, "name": park["name"], "source": "potamap",
                "kind": kind, "attribution": ATTRIBUTION,
            },
        })
        return {
            "type": "Feature",
            "geometry": mapping(geom),
            "properties": {
                "ref": ref,
                "name": park["name"],
                "prog": ref.split("-")[0],
                "src": kind if kind == "trail" else "potamap",
            },
        }

    for ref, parts in sorted(areas.items()):
        g = parts[0] if len(parts) == 1 else unary_union(parts)
        feat = store(ref, g, "area")
        if feat:
            poly_feats.append(feat)

    for ref, parts in sorted(lines.items()):
        pieces = []
        for g in parts:
            pieces.extend(g.geoms if g.geom_type == "MultiLineString" else [g])
        g = MultiLineString([LineString(list(t.coords)) for t in pieces])
        feat = store(ref, g, "trail")
        if feat:
            line_feats.append(feat)

    save(os.path.join(DATA, "parks_polygons.geojson"),
         {"type": "FeatureCollection", "features": poly_feats})
    save(os.path.join(DATA, "trails.geojson"),
         {"type": "FeatureCollection", "features": line_feats})
    save(os.path.join(CACHE, "matched_refs.json"),
         [f["properties"]["ref"] for f in poly_feats + line_feats])
    save(os.path.join(WEB_DIR, "park_bbox.json"), sorted(boxes))
    save(os.path.join(CACHE, "sources.json"),
         {f["properties"]["ref"]: f["properties"]["src"]
          for f in poly_feats + line_feats})

    missing = sorted(set(known) - set(areas) - set(lines))
    print(f"{len(poly_feats)} areas, {len(line_feats)} trails")
    print(f"{len(boxes)} bounding boxes -> {WEB_DIR}/park_bbox.json")
    if both:
        print(f"area and trail at once, trail dropped: {', '.join(both)}")
    if unknown:
        print(f"not in the POTA list, skipped: {len(unknown)} "
              f"(e.g. {unknown[:5]})")
    if missing:
        print(f"without geometry, shown as a point: {len(missing)} "
              f"(e.g. {missing[:5]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
