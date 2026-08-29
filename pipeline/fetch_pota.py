#!/usr/bin/env python3
"""Fetch the POTA park list per program from api.pota.app.

Gives reference, name and a single point - POTA has no boundaries.
"""
import os
import sys
import time

import requests

from common import CACHE, PROGRAMS, UA, save

API = "https://api.pota.app"


def fetch_program(prefix: str):
    url = f"{API}/program/parks/{prefix}"
    r = requests.get(url, headers={"User-Agent": UA}, timeout=60)
    r.raise_for_status()
    parks = r.json()
    out = []
    for p in parks:
        if p.get("latitude") is None or p.get("longitude") is None:
            continue
        out.append({
            "reference": p["reference"],
            "name": p.get("name") or "",
            "lat": float(p["latitude"]),
            "lon": float(p["longitude"]),
            "grid": p.get("grid"),
            "locationDesc": p.get("locationDesc"),
        })
    return out


def main():
    all_parks = {}
    for prefix in PROGRAMS:
        print(f"POTA {prefix} ...", flush=True)
        parks = fetch_program(prefix)
        all_parks[prefix] = parks
        print(f"  {len(parks)} parks", flush=True)
        time.sleep(1)  # stay friendly to the API
    save(os.path.join(CACHE, "pota_parks.json"), all_parks)
    total = sum(len(v) for v in all_parks.values())
    print(f"{total} parks in total -> {CACHE}/pota_parks.json")


if __name__ == "__main__":
    sys.exit(main())
