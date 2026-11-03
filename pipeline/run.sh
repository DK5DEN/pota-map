#!/usr/bin/env bash
# Full data run. Weekly - the areas rarely change.
set -euo pipefail
cd /pipeline

echo "== 1/6 POTA park list =="
python fetch_pota.py

echo "== 2/6 areas and trails (pota-map.info) =="
python fetch_potamap.py

echo "== 3/6 SOTA summits =="
python fetch_sota.py

echo "== 4/6 overlaps and plausibility =="
python compute_overlaps.py
python check_plausibility.py

echo "== 5/6 tiles and web files =="
python make_web_index.py
bash build_tiles.sh

# The outlines have just been rebuilt, and the places sit on them: a boundary
# that moved changes which bench is inside and how much room it has. Six
# minutes for all of them, so it runs with every weekly pass rather than only
# with the monthly POI run.
echo "== 6/6 places in the parks =="
python compute_places.py

curl -sS -X POST http://backend:8000/api/reload || true
echo "done."
