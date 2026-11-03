#!/usr/bin/env bash
# Daily: refresh park list and activations, leave the tiles alone.
set -euo pipefail
cd /pipeline
echo "=== $(date -Is) daily run ==="
python fetch_pota.py
python fetch_activations.py
python make_web_index.py
# A park that appeared since the monthly run has no places yet. Computing
# the handful of new ones takes seconds; everything else keeps its file.
python compute_places.py --missing
curl -sS -X POST http://backend:8000/api/reload || true
echo "done."
