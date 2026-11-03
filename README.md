# pota-map

A fast map of POTA park boundaries for DE, AT, CH, LI, CZ, DK and LU, with SOTA
summits and live spots on top. Runs at <https://pota-map.afu.tools>.

POTA (Parks on the Air) publishes one point per park and no boundary at all.
This map draws the actual areas, tells you whether you are standing inside one,
and works without a network once an area has been saved.

The interface speaks German and English; the language follows `?lang=`, then
the visitor's choice, then the browser. Every text lives in `web/src/i18n.js` -
adding a language means adding one block there. Code comments and this README
are English.

## What it does

* park areas and trails as vector tiles, not as one giant GeoJSON in the page
* "which park am I standing in", including the distance to the boundary
* live tracking with a notification when you enter or leave a park
* live spots with filters (band, mode, age, QRT, hunted) and a list view
* your own activations by callsign, and your hunted parks from a CSV export
* overlapping references ("n-fer"), so one setup can count for several parks
* offline: save the visible area down three zoom levels
* the standard OpenStreetMap rendering as the base you start on, and
  OpenTopoMap with trails and contour lines next to it
* GeoJSON and GPX download per park

## Services

| Service   | Job                                                                  |
|-----------|----------------------------------------------------------------------|
| `web`     | nginx: static page, tile cache, API proxy                            |
| `tiles`   | `pmtiles serve`: resolves z/x/y out of the archives                   |
| `backend` | FastAPI: caches live spots, serves activations per callsign           |
| `cron`    | supercronic: daily and weekly data runs                              |

The map itself is MapLibre GL on three PMTiles archives:

* `data/basemap/basemap.pmtiles` - Protomaps basemap, regional extract, 6 GB
* `data/parks.pmtiles` - park areas, park points, trails, SOTA summits, ~60 MB
* `data/pois.pmtiles` - what is out there: parking, benches, shelters,
  guideposts, activation targets, and the power lines you do not set up under

Next to those there are two raster bases, and one of them is what the map
starts with: "Hell" is the standard OpenStreetMap rendering (the same tiles
pota-map.info uses), "Topo" is OpenTopoMap with contour lines. Both carry the
path network the vector base does not have, which is what somebody walking
into a park is looking for.

Our own light vector base has no button at the moment (`HIDDEN_BASES` in
`web/src/main.js`); it is still built, still served and still what the offline
store holds. "Dunkel" is the one base you can take into the field.

They come from other people's servers, which decides how they are handled: they
are fetched for what is on the screen and never ahead of time, they are kept
while they are fresh and handed out stale for as long as the server's own
`stale-while-revalidate` allows, and they stay out of the offline store. Both
prefetchers skip them on purpose. See the comments at `RASTER_BASES` in
`web/src/main.js` and `RASTER_HOSTS` in `web/sw.js` before changing any of it -
a host missing there is kept by nobody, and a prefetcher that picks them up
breaks the terms we use them under.

## Where the data comes from

| Data | Source | Terms |
|---|---|---|
| Park areas and trails | <https://pota-map.info> (DK5UR) | MIT, with the operator's explicit permission |
| References, names, spots, activations | `api.pota.app` | undocumented, no published terms |
| SOTA summits | `api-db2.sota.org.uk` | open to the amateur radio community |
| Basemap | [Protomaps](https://protomaps.com) builds from OpenStreetMap | ODbL |
| Raster base "Hell" | [openstreetmap.org tiles](https://operations.osmfoundation.org/policies/tiles/) | ODbL; their policy: interactive viewing only, no bulk downloading, no offline use |
| Raster base "Topo" | [OpenTopoMap](https://opentopomap.org) | CC-BY-SA, app use welcome as long as their server is not hit with mass downloads |
| POIs out there | country extracts from [geofabrik](https://download.geofabrik.de), falling back to [openstreetmap.fr](https://download.openstreetmap.fr/extracts) | ODbL |
| Terrain for the places | [AWS terrain tiles](https://registry.opendata.aws/terrain-tiles/) (terrarium, zoom 12) | public domain and EU-DEM, attribution wording fixed by [their docs](https://github.com/tilezen/joerd/blob/master/docs/attribution.md) |
| Scoring of the places | [POTASpotFinder](https://github.com/mooxle/POTASpotFinder) (DA6MAX) | MIT - the model, not the code: same five factors, same weights |

**Naming the sources is a condition of use, not politeness.** The credits live
in five places and have to stay in sync: the footer in `web/index.html`
(including `credits-places` for the terrain wording),
`customAttribution` and the `attribution` of every entry in `RASTER_BASES` in
`web/src/main.js`, `--attribution` in `pipeline/build_tiles.sh`, and the
`attribution` array every `places/<REF>.json` carries with it. The wording for
the raster bases and for the terrain tiles is theirs and is not to be
shortened.

## Running it

```bash
cp .env.example .env      # optional, only for the report feature
docker compose up -d
docker compose run --rm cron bash /pipeline/run.sh   # first data run
```

The first run downloads about 150 MB of GeoJSON and builds the tiles. The
basemap is not part of it, see below.

### Data runs

```bash
# everything: POTA list, areas from pota-map.info, SOTA, tiles
docker compose run --rm cron bash /pipeline/run.sh

# activations and search index only (this is what cron does daily)
docker compose run --rm cron bash /pipeline/run_daily.sh

# a single step
docker compose run --rm cron python /pipeline/fetch_potamap.py
```

The schedule is in `pipeline/crontab`: activations daily, areas and tiles
weekly.

### The POI run

Its own run, monthly, because it pulls about 9 GB of country extracts:

```bash
docker compose run --rm cron bash /pipeline/run_pois.sh
```

`fetch_osm_pois.py` downloads one country at a time, runs it through
`osmium tags-filter` with `pipeline/osm_filter.txt`, and deletes the raw
extract right away - only the filtered file per country stays in
`cache/osm/`. Areas (a car park, a castle) are reduced to one point; power
lines and electrified railways stay lines and go into a layer of their own.
`build_poi_tiles.sh` turns both into `pois.pmtiles`. Roads that carry through
traffic land in `roads.geojson`, which is never drawn and never turned into
tiles - it only feeds the quiet score of the places.

After a rebuild the tile service can still answer from the archive it had
open - it caches the directories of the file it is serving. A restart drops
that, and the nginx tile cache in front of it holds tiles for a day:

```bash
docker compose restart tiles
docker compose up -d --force-recreate web   # only if you want the cache gone now
```

Arguments limit what is downloaded again - for a test, or when one country was
unreachable last time. The others still come out of their cached extracts, so
the output stays complete:

```bash
docker compose run --rm cron python /pipeline/fetch_osm_pois.py LU
```

The categories are in `classify()` in `pipeline/fetch_osm_pois.py`; the tag
filter has to be wider than the categories, because osmium can only say OR.

### The places in a park

Which bench, picnic table or shelter in a park is worth carrying a station to.
Computed for every park - six minutes for all of them, so it runs with the
weekly pass as well as after the monthly POI run - and written as one small
file each, `data/web/places/<REF>.json`, plus `places_index.json` with count
and best score. Nothing is asked at run time - no Overpass, no elevation
service - and because the files sit under `/data/`, the service worker keeps
them for the day out.

The scoring follows [POTASpotFinder](https://github.com/mooxle/POTASpotFinder)
by DA6MAX: prominence 30, quiet 25, horizon 20, comfort 15, access 10, down to
his thresholds and the penalty for a tourist hotspot nearby. Two additions of
our own sit next to that hundred instead of inside it, so the numbers stay
comparable with his tool: distance to power lines and overhead wire, and
distance to the park boundary. All of it in `pipeline/places_common.py`, one
function per factor.

One deliberate difference: he counts every `tourism=information` as a hotspot,
which includes waymarkers - the most common object in our woods by far, and a
signpost at a junction says nothing about how busy a bench is. Only attractions
and information boards count here.

Heights, prominence and horizon need a terrain model. It is fetched once, by
hand, like the basemap - about 1 GB for the parks we cover, and terrain does
not move:

```bash
docker compose run --rm cron python /pipeline/fetch_dem.py
```

Single parks are cheap, seconds each, because the extracts are already on
disk. A park that appeared since the monthly run is picked up by the daily run
through `--missing`:

```bash
docker compose run --rm cron python /pipeline/compute_places.py --ref DE-0123
docker compose run --rm cron python /pipeline/compute_places.py --missing
```

Without the terrain tiles the run still works and scores what it can - the
files then say `"dem": null` and the prominence and horizon factors are zero.

Two things decide whether this takes minutes or hours, both learned the hard
way. The join asks the points, not the parks: turned the other way round every
point walks ten park outlines of up to half a million vertices, and a quarter
of a million points took nine minutes. And the lines - roads, power lines - are
projected once into web mercator and put into one tree, rather than scaled per
park: with ten million park-line pairs that scaling was the bulk of the run. A
mercator distance times the cosine of the latitude is metres again, well within
a per mille over the few kilometres that matter here.

### Refreshing the basemap

Not part of the cron run, it pulls 6 GB:

```bash
docker compose run --rm cron pmtiles extract \
  "https://build.protomaps.com/$(date -u +%Y%m%d).pmtiles" \
  /data/basemap/basemap.pmtiles.tmp \
  --bbox=5.5,45.4,19.2,58.1 --maxzoom=14 --download-threads=8
mv data/basemap/basemap.pmtiles.tmp data/basemap/basemap.pmtiles
```

### Configuration

`PUBLIC_HOST` is required, everything else is optional. Without the report
variables the map runs as usual: the routes for it are not registered, the
health endpoint says so, and the browser never fetches the module - reporting
costs an installation that does not use it exactly nothing.

| Variable | Meaning |
|---|---|
| `PUBLIC_HOST` | the host this instance runs under - router rule, tile URLs, and the name given to the APIs this map calls |
| `BUG_ENDPOINT` | base URL of an issue tracker, see `backend/reports.py` |
| `BUG_TOKEN` | token for that tracker, belongs to the program, not to a person |
| `BUG_ENVIRONMENT` | name this map reports under, default `pota-map` |
| `SPOT_TTL` | seconds the live spots are cached, default 45 |
| `PARK_TTL` | seconds the park details are cached, default 21600 |

There are no accounts and no user database. What a visitor sets is kept in
their own browser; a reporter is identified by a random id their browser
creates, nothing else.

## Checks

```bash
curl -s https://pota-map.afu.tools/api/health
curl -s https://pota-map.afu.tools/data/stats.json | python3 -m json.tool
docker compose logs -f backend
```

## Author

Written and operated by Dennis Eisold, DK5DEN.

## License

The code is MIT licensed, see LICENSE. The data is not ours to license: park
areas and trails come from pota-map.info under MIT and have to keep their
credit, and the same goes for the other sources listed above.

## Not affiliated

This site is not run by POTA and does not belong to it. "Parks on the Air" and
"Summits on the Air" are the programs' own marks.
