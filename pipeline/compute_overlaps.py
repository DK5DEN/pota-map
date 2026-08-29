#!/usr/bin/env python3
"""Find overlapping references ("n-fer").

Standing where two parks overlap activates two references from one setup.
People look for those spots; on a map of plain outlines you have to guess
them. With the geometries it can simply be computed.

Trails count: a trail running through a protected area is the most common
double hit there is.

Two outputs:
  * `nfer` as a tile property - cheap to filter on
  * `overlaps.json` with the actual partners per reference, for the popup

As a side effect a quality signal: whatever overlaps a striking number of
areas is often matched wrongly (a harbour does not overlap fourteen nature
reserves).
"""
import os
import sys
from collections import defaultdict

from shapely.geometry import shape
from shapely.strtree import STRtree

from common import CACHE, DATA, load, save

WEB_DIR = os.path.join(DATA, "web")

# From this many partners on, a match is suspicious
SUSPICIOUS_FROM = 10


def load_features(path):
    if not os.path.exists(path):
        return []
    return load(path).get("features", [])


def main():
    poly_path = os.path.join(DATA, "parks_polygons.geojson")
    trail_path = os.path.join(DATA, "trails.geojson")

    files = [(poly_path, load_features(poly_path)), (trail_path, load_features(trail_path))]
    all_features = []
    for _, feats in files:
        all_features.extend(feats)

    geoms, refs = [], []
    for f in all_features:
        try:
            g = shape(f["geometry"])
            if not g.is_valid:
                g = g.buffer(0)
            if g.is_empty:
                continue
        except Exception:
            continue
        geoms.append(g)
        refs.append(f["properties"]["ref"])

    print(f"comparing {len(geoms)} geometries", flush=True)

    tree = STRtree(geoms)
    partners = defaultdict(set)
    pairs = 0
    for i, g in enumerate(geoms):
        for j in tree.query(g):
            if j <= i:
                continue
            # `touches` means only the borders meet. You cannot stand there,
            # so that is not a double hit.
            if not g.intersects(geoms[j]) or g.touches(geoms[j]):
                continue
            if refs[i] == refs[j]:
                continue
            partners[refs[i]].add(refs[j])
            partners[refs[j]].add(refs[i])
            pairs += 1

    overlaps = {r: sorted(v) for r, v in sorted(partners.items())}
    os.makedirs(WEB_DIR, exist_ok=True)
    save(os.path.join(WEB_DIR, "overlaps.json"), overlaps)

    # write the count into the tiles as a property
    for path, feats in files:
        if not feats:
            continue
        for f in feats:
            f["properties"]["nfer"] = len(partners.get(f["properties"]["ref"], ()))
        save(path, {"type": "FeatureCollection", "features": feats})

    suspicious = [(r, len(v)) for r, v in partners.items() if len(v) >= SUSPICIOUS_FROM]
    suspicious.sort(key=lambda x: -x[1])

    print(f"{pairs} overlapping pairs, {len(overlaps)} references affected")
    if suspicious:
        print(f"suspiciously many partners, {len(suspicious)} of them:")
        for r, n in suspicious[:8]:
            print(f"  {r}: {n}")
    save(os.path.join(CACHE, "overlap_suspects.json"), dict(suspicious))
    return 0


if __name__ == "__main__":
    sys.exit(main())
