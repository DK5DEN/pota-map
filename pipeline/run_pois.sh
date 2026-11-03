#!/usr/bin/env bash
# POI run. Monthly - it pulls about 9 GB of country extracts and the things it
# collects (benches, shelters, guideposts) do not move.
set -euo pipefail
cd /pipeline
echo "=== $(date -Is) POI run ==="
python fetch_osm_pois.py
bash build_poi_tiles.sh
# The places live off the points that were just collected, so they are
# rebuilt in the same run. Terrain tiles are not fetched here - they are a
# one-off, see fetch_dem.py.
python compute_places.py
echo "done."
echo "The tile service keeps the archive it has open - restart it to serve the"
echo "new one: docker compose restart tiles"
