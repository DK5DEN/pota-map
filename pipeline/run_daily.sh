#!/usr/bin/env bash
# Daily: refresh park list and activations, leave the tiles alone.
set -euo pipefail
cd /pipeline
echo "=== $(date -Is) daily run ==="
python fetch_pota.py
python fetch_activations.py
python make_web_index.py
curl -sS -X POST http://backend:8000/api/reload || true
echo "done."
