#!/usr/bin/env python3
"""Fetch the SOTA summits of the associations inside the map extent.

Unlike POTA parks, summits are points, not areas - nothing to match here, the
SOTA database gives the coordinates directly.

Source: api-db2.sota.org.uk. "Summits on the Air", SOTA and the SOTA logo are
marks of that program; the data is open to the amateur radio community.
"""
import os
import sys
import time

import requests

from common import CACHE, DATA, UA, save

API = "https://api-db2.sota.org.uk/api"

# SOTA association -> POTA program. This hangs the summits off the same
# country selection as the parks; Germany has two associations (Alps and
# uplands), Liechtenstein one of its own.
ASSOCIATION_TO_PROGRAM = {
    "DL": "DE",    # Deutschland, Alpen
    "DM": "DE",    # Deutschland, Mittelgebirge
    "HB": "CH",
    "HB0": "LI",
    "OE": "AT",
    "OK": "CZ",
    "OZ": "DK",
    "LX": "LU",
}
ASSOCIATIONS = list(ASSOCIATION_TO_PROGRAM)

# Point value -> colour, the way SOTA usually shows it
POINT_COLORS = {1: "#6DA536", 2: "#4D7A20", 4: "#AEA727",
                6: "#EFA818", 8: "#DC5D04", 10: "#C8101E"}


def get(session, path):
    for attempt in range(3):
        try:
            r = session.get(f"{API}/{path}", timeout=45)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
        time.sleep(3 * (attempt + 1))
    return None


def main():
    session = requests.Session()
    session.headers["User-Agent"] = UA

    features = []
    for code in ASSOCIATIONS:
        assoc = get(session, f"associations/{code}")
        if not assoc:
            print(f"SOTA {code}: not reachable", flush=True)
            continue
        regions = assoc.get("regions") or []
        count = 0
        for region in regions:
            rc = region.get("regionCode")
            data = get(session, f"regions/{code}/{rc}")
            if not data:
                continue
            for s in data.get("summits") or []:
                lat, lon = s.get("latitude"), s.get("longitude")
                if lat is None or lon is None or not s.get("valid", True):
                    continue
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
                    "properties": {
                        "ref": s.get("summitCode"),
                        "name": s.get("name"),
                        # program of that country, so the country filter applies
                        "prog": ASSOCIATION_TO_PROGRAM[code],
                        "assoc": code,
                        "pts": s.get("points"),
                        "alt": s.get("altM"),
                        "acts": s.get("activationCount", 0),
                    },
                })
                count += 1
            time.sleep(0.2)
        print(f"SOTA {code}: {count} summits from {len(regions)} regions", flush=True)

    out = os.path.join(DATA, "sota_summits.geojson")
    save(out, {"type": "FeatureCollection", "features": features})
    save(os.path.join(CACHE, "sota_count.json"), {"summits": len(features)})
    print(f"{len(features)} summits -> {out}")


if __name__ == "__main__":
    sys.exit(main())
