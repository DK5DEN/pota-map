#!/usr/bin/env bash
# Full data run. Weekly - the areas rarely change.
set -euo pipefail
cd /pipeline

echo "== 1/5 POTA park list =="
python fetch_pota.py

echo "== 2/5 areas and trails (pota-map.info) =="
python fetch_potamap.py

echo "== 3/5 SOTA summits =="
python fetch_sota.py

echo "== 4/5 overlaps and plausibility =="
python compute_overlaps.py
python check_plausibility.py

echo "== 5/5 tiles and web files =="
python make_web_index.py
bash build_tiles.sh

curl -sS -X POST http://backend:8000/api/reload || true
echo "done."
