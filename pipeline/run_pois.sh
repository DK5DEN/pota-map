#!/usr/bin/env bash
# POI run. Monthly - it pulls about 9 GB of country extracts and the things it
# collects (benches, shelters, guideposts) do not move.
set -euo pipefail
cd /pipeline
echo "=== $(date -Is) POI run ==="
python fetch_osm_pois.py
bash build_poi_tiles.sh
echo "done."
echo "The tile service keeps the archive it has open - restart it to serve the"
echo "new one: docker compose restart tiles"
