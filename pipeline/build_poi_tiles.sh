#!/usr/bin/env bash
# Build the POI archive. Separate from build_tiles.sh on purpose: the POIs come
# from a 9 GB download and are refreshed monthly, the park areas weekly. Baking
# them into the same run would make the weekly run drag a rebuild of three
# million points along for nothing.
#
# Own archive as well, not another layer in parks.pmtiles: the offline store
# should only grow for someone who switched the layer on.
set -euo pipefail
DATA="${POTA_DATA:-/data}"
cd "$DATA"

if [ ! -f "$DATA/pois.geojson" ]; then
  echo "no pois.geojson - run fetch_osm_pois.py first" >&2
  exit 1
fi

mkdir -p "$DATA/tiles"
ln -sfn ../pois.pmtiles "$DATA/tiles/pois.pmtiles"

# From zoom 13, not lower. A bench is not drawn before 13 anyway, and a zoom 12
# tile of a city centre would carry thousands of points that nobody sees - the
# archive holds both layers, so the line layer would drag all of them along.
#
# Same switches against silent thinning as the park tiles, and for the same
# reason: a bench that appears only at zoom 15 while its neighbour appears at
# 14 looks like a broken map, not like a small tile.
tippecanoe --quiet \
    --output="$DATA/pois.new.pmtiles" \
    --force \
    --named-layer=pois:"$DATA/pois.geojson" \
    --named-layer=qrm:"$DATA/qrm.geojson" \
    --minimum-zoom=13 \
    --maximum-zoom=14 \
    --drop-rate=1 \
    --no-feature-limit \
    --no-tile-size-limit \
    --simplification=4 \
    --attribution='© OpenStreetMap contributors, ODbL' \
    --name='POTA-Map POIs'

mv -f "$DATA/pois.new.pmtiles" "$DATA/pois.pmtiles"
ls -lh "$DATA/pois.pmtiles"
