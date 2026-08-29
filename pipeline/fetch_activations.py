#!/usr/bin/env python3
"""Fetch the activations per park from POTA.

Two things the map needs come out of this:
  - which parks have never been activated (they get their own colour)
  - which parks a given callsign has activated (?call=)

One call per park, deliberately throttled - this runs at night, not in the
web request path.
"""
import os
import sys
import time
from collections import defaultdict

import requests

from common import CACHE, DATA, PROGRAMS, UA, load, save

API = "https://api.pota.app"
PAUSE = 0.35          # seconds between calls
RETRY_PAUSE = 5.0


def fetch_park(ref: str, session: requests.Session):
    url = f"{API}/park/activations/{ref}?count=all"
    for attempt in range(3):
        try:
            r = session.get(url, timeout=45)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 404:
                return []
        except Exception:
            pass
        time.sleep(RETRY_PAUSE * (attempt + 1))
    return None


def main():
    pota = load(os.path.join(CACHE, "pota_parks.json"))
    refs = [p["reference"] for prefix in PROGRAMS for p in pota.get(prefix, [])]

    session = requests.Session()
    session.headers["User-Agent"] = UA

    by_park = {}
    failed = []
    for i, ref in enumerate(refs, 1):
        acts = fetch_park(ref, session)
        if acts is None:
            failed.append(ref)
        else:
            calls = sorted({a.get("activeCallsign", "").upper()
                            for a in acts if a.get("activeCallsign")})
            by_park[ref] = calls
        if i % 100 == 0:
            print(f"  {i}/{len(refs)} Parks", flush=True)
        time.sleep(PAUSE)

    never = sorted(r for r, calls in by_park.items() if not calls)

    # Reverse index: callsign -> parks. That is what the frontend asks for.
    by_call = defaultdict(list)
    for ref, calls in by_park.items():
        for c in calls:
            by_call[c].append(ref)
    by_call = {c: sorted(v) for c, v in sorted(by_call.items())}

    save(os.path.join(CACHE, "activations_by_park.json"), by_park)
    save(os.path.join(CACHE, "never_activated.json"), never)
    save(os.path.join(DATA, "activations_by_call.json"), by_call)
    print(f"{len(by_park)} parks, {len(never)} never activated, "
          f"{len(by_call)} callsigns"
          + (f", {len(failed)} failed" if failed else ""))


if __name__ == "__main__":
    sys.exit(main())
