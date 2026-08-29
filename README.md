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
* GeoJSON and GPX download per park

## Services

| Service   | Job                                                                  |
|-----------|----------------------------------------------------------------------|
| `web`     | nginx: static page, tile cache, API proxy                            |
| `tiles`   | `pmtiles serve`: resolves z/x/y out of the archives                   |
| `backend` | FastAPI: caches live spots, serves activations per callsign           |
| `cron`    | supercronic: daily and weekly data runs                              |

The map itself is MapLibre GL on two PMTiles archives:

* `data/basemap/basemap.pmtiles` - Protomaps basemap, regional extract, 6 GB
* `data/parks.pmtiles` - park areas, park points, trails, SOTA summits, ~60 MB

## Where the data comes from

| Data | Source | Terms |
|---|---|---|
| Park areas and trails | <https://pota-map.info> (DK5UR) | MIT, with the operator's explicit permission |
| References, names, spots, activations | `api.pota.app` | undocumented, no published terms |
| SOTA summits | `api-db2.sota.org.uk` | open to the amateur radio community |
| Basemap | [Protomaps](https://protomaps.com) builds from OpenStreetMap | ODbL |

**Naming the sources is a condition of use, not politeness.** The credits live
in three places and have to stay in sync: the footer in `web/index.html`,
`customAttribution` in `web/src/main.js`, and `--attribution` in
`pipeline/build_tiles.sh`.

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
