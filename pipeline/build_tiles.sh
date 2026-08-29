#!/usr/bin/env bash
# Build a single PMTiles archive from the GeoJSON files.
#
# Four layers:
#   parks   - POTA areas
#   points  - every POTA park as a point, including those without an area
#   sota    - SOTA summits
#   trails  - trails as lines
#
# Three switches against silent thinning. tippecanoe is built to keep tiles
# small and sacrifices features for that - without a warning:
#
#   --drop-rate=1                 keeps point layers complete. Without it, 2
#                                 of 64 SOTA summits in an area survived.
#   --no-tiny-polygon-reduction   keeps small areas. Without it only 1734 of
#                                 2263 park areas were in the archive at zoom
#                                 4, and the missing ones appeared one by one
#                                 while zooming in - parks popping up out of
#                                 nowhere, as far as the viewer is concerned.
#   --no-feature-limit            no cap on the number of features per tile.
#
# No --coalesce-densest-as-needed: it merges neighbouring features into one
# and throws away the properties of the second. On a map where every feature
# is its own reference with its own popup, that is data loss, not compression.
set -euo pipefail
DATA="${POTA_DATA:-/data}"
cd "$DATA"

# The tile service expects the archives flat under /data/tiles
mkdir -p "$DATA/tiles"
ln -sfn ../basemap/basemap.pmtiles "$DATA/tiles/basemap.pmtiles"
ln -sfn ../parks.pmtiles "$DATA/tiles/parks.pmtiles"

echo "-- building the point layer"
python /pipeline/make_points.py

echo "-- tippecanoe"
tippecanoe --quiet \
    --output="$DATA/parks.new.pmtiles" \
    --force \
    --named-layer=parks:"$DATA/parks_polygons.geojson" \
    --named-layer=points:"$DATA/parks_points.geojson" \
    --named-layer=sota:"$DATA/sota_summits.geojson" \
    --named-layer=trails:"$DATA/trails.geojson" \
    --minimum-zoom=4 \
    --maximum-zoom=14 \
    --drop-rate=1 \
    --no-tiny-polygon-reduction \
    --no-feature-limit \
    --no-tile-size-limit \
    --extend-zooms-if-still-dropping \
    --simplification=4 \
    --attribution='© pota-map.info (DK5UR, MIT), POTA, SOTA' \
    --name='POTA-Map DACH'

# Rename only once the file is complete - nginx is reading in parallel. The
# temporary name has to end in .pmtiles: tippecanoe picks the output format
# from the extension and would silently write an MBTiles otherwise.
mv -f "$DATA/parks.new.pmtiles" "$DATA/parks.pmtiles"

ls -lh "$DATA/parks.pmtiles"
