#!/usr/bin/env python3
"""Terrain tiles for the places scoring, fetched once.

Why a local store and not a height service: the map answers for two and a half
thousand parks, and every place in them wants a height, the ground around it
and eight lines of sight. Asking a public elevation API for that is the kind of
load those services ask people not to produce - and it would tie a feature of
this map to somebody else's uptime. Terrain does not move, so it is fetched
once and then belongs to us.

Source: the AWS terrain tiles (elevation-tiles-prod), terrarium format, no
account and no signing. In Europe they are built from EU-DEM. The attribution
they require is in the credits of the map, worded as their documentation
demands - do not shorten it.

Only tiles that touch a park are fetched, plus three kilometres of margin for
the horizon lines. That is a fraction of the map's bounding box.

Run by hand, like the basemap extract - not from cron:

    docker compose exec cron python fetch_dem.py           # everything missing
    docker compose exec cron python fetch_dem.py --refs DE-0123
"""
import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import requests

from common import UA, load
from dem import ROOT, ZOOM, tile_path, tiles_for_bbox
from geo import pad_bbox
from places_common import BBOX_PATH, HORIZON_M

URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"

# Their servers are large and ours is not the only client. Four at a time
# gets the whole set in well under an hour and stays polite.
WORKERS = 4
TIMEOUT = 30
RETRIES = 3


def wanted_tiles(refs=None):
    """Every tile that touches a park, plus the horizon margin."""
    tiles = set()
    for row in load(BBOX_PATH):
        ref = row[0]
        if refs and ref not in refs:
            continue
        bbox = pad_bbox((row[1], row[2], row[3], row[4]), HORIZON_M)
        tiles.update(tiles_for_bbox(bbox))
    return sorted(tiles)


def fetch(session, x, y):
    """One tile onto disk. True when something was written."""
    path = tile_path(x, y)
    if os.path.exists(path):
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    url = URL.format(z=ZOOM, x=x, y=y)
    for attempt in range(RETRIES):
        try:
            got = session.get(url, timeout=TIMEOUT)
            if got.status_code == 404:
                # Sea, or a gap in the source. Not an error, and asking again
                # every run would be rude - an empty file marks it as answered.
                open(path, "wb").close()
                return True
            got.raise_for_status()
            tmp = path + ".tmp"
            with open(tmp, "wb") as fh:
                fh.write(got.content)
            os.replace(tmp, path)
            return True
        except Exception as exc:
            if attempt == RETRIES - 1:
                print(f"  {x}/{y}: {exc}", flush=True)
                return False
            time.sleep(2 * (attempt + 1))
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refs", nargs="*", help="only the tiles of these parks")
    args = ap.parse_args()

    tiles = wanted_tiles(set(args.refs) if args.refs else None)
    todo = [t for t in tiles if not os.path.exists(tile_path(*t))]
    print(f"{len(tiles)} tiles wanted, {len(todo)} missing", flush=True)
    if not todo:
        return 0

    started = time.time()
    done = 0
    with requests.Session() as session:
        session.headers["User-Agent"] = UA
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            for ok in pool.map(lambda t: fetch(session, *t), todo):
                done += 1 if ok else 0
                if done and done % 500 == 0:
                    print(f"  {done}/{len(todo)}, {time.time() - started:.0f} s",
                          flush=True)

    stored = sum(os.path.getsize(os.path.join(where, name))
                 for where, _, names in os.walk(ROOT) for name in names)
    print(f"{done} tiles fetched in {time.time() - started:.0f} s, "
          f"store now {stored / 1e6:.0f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
