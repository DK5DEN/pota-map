#!/usr/bin/env python3
"""Build the small files the frontend loads directly.

  park_index.json      - search index (reference, name, point), kept small
  never_activated.json - references without a single activation
  stats.json           - coverage per program, shown in the panel
"""
import datetime
import os
import shutil
import sys
from collections import defaultdict

from common import CACHE, DATA, PROGRAMS, load, save

WEB_DIR = os.path.join(DATA, "web")


def main():
    pota = load(os.path.join(CACHE, "pota_parks.json"))

    matched = set()
    path = os.path.join(CACHE, "matched_refs.json")
    if os.path.exists(path):
        matched = set(load(path))

    sources = {}
    sources_path = os.path.join(CACHE, "sources.json")
    if os.path.exists(sources_path):
        sources = load(sources_path)

    index = []
    stats = defaultdict(lambda: {"parks": 0, "areas": 0,
                                 "potamap": 0, "trail": 0})
    for prefix in PROGRAMS:
        for park in pota.get(prefix, []):
            index.append({
                "r": park["reference"],
                "n": park["name"],
                "y": round(park["lat"], 5),
                "x": round(park["lon"], 5),
            })
            s = stats[prefix]
            s["parks"] += 1
            if park["reference"] in matched:
                s["areas"] += 1
                src = sources.get(park["reference"])
                if src in s:
                    s[src] += 1

    os.makedirs(WEB_DIR, exist_ok=True)
    save(os.path.join(WEB_DIR, "park_index.json"), index)

    total = {"parks": sum(v["parks"] for v in stats.values()),
             "areas": sum(v["areas"] for v in stats.values())}
    # The date is shown in the map. Without it, a report like "data is
    # missing" gives no way to tell whether the data set is stale or the
    # browser cache is.
    save(os.path.join(WEB_DIR, "stats.json"), {
        "programs": dict(stats),
        "total": total,
        "date": datetime.date.today().isoformat(),
    })

    # never_activated.json is written by fetch_activations.py; only passed on here
    src_never = os.path.join(CACHE, "never_activated.json")
    if os.path.exists(src_never):
        shutil.copyfile(src_never, os.path.join(WEB_DIR, "never_activated.json"))
    elif not os.path.exists(os.path.join(WEB_DIR, "never_activated.json")):
        save(os.path.join(WEB_DIR, "never_activated.json"), [])

    print(f"{len(index)} parks in the search index, "
          f"{total['areas']}/{total['parks']} with an area")


if __name__ == "__main__":
    sys.exit(main())
