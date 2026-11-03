#!/usr/bin/env python3
"""Points of interest for operating portable, from OpenStreetMap.

The basemap already carries a `pois` layer, but only for what a general map
calls notable: shops, museums, stations. A bench, a shelter, a drinking water
tap or a guidepost is not in there - and those are exactly the things that
decide where you sit down for four hours. On top of that the basemap layer
cannot be filtered or clicked, so it cannot answer "show me only parking and
shelters".

So this builds a layer of its own. Everything comes from OSM under ODbL, which
the map already credits for the basemap.

The country extracts are large (about 9 GB together). They are deleted right
after filtering; only the filtered file per country stays in the cache. That is
a few hundred megabytes and enough to rebuild the tiles without downloading
again.

Output:
  pois.geojson  - points, one per feature (areas are reduced to a point)
  qrm.geojson   - lines: power lines and electrified railways, the two things
                  you do not want to set up under
  roads.geojson - lines: roads that carry through traffic. Never drawn, never
                  turned into tiles - input for the quiet score of the places,
                  see compute_places.py
  cache/poi_counts.json
"""
import json
import os
import subprocess
import sys
import time
from collections import Counter

from shapely.geometry import shape

from common import CACHE, DATA, UA, save

FILTER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "osm_filter.txt")
RAW_DIR = os.path.join(CACHE, "osm")

# Two sources for the same data. geofabrik is the usual address; when their
# download proxy is out (it answers 503 ERR_CONNECT_FAIL then, which is their
# side, not ours) openstreetmap.fr has the same extracts. Liechtenstein only
# exists at geofabrik - 15 parks, not worth a special case.
GEOFABRIK = "https://download.geofabrik.de/{}-latest.osm.pbf"
OSM_FR = "https://download.openstreetmap.fr/extracts/{}-latest.osm.pbf"

COUNTRIES = [
    ("DE", "europe/germany", "europe/germany"),
    ("AT", "europe/austria", "europe/austria"),
    ("CH", "europe/switzerland", "europe/switzerland"),
    ("CZ", "europe/czech-republic", "europe/czech_republic"),
    ("DK", "europe/denmark", "europe/denmark"),
    ("LU", "europe/luxembourg", "europe/luxembourg"),
    ("LI", "europe/liechtenstein", None),
]

DOWNLOAD_TIMEOUT = 3600

# Lines belong in their own file: they are drawn as lines, not as symbols.
LINE_KINDS = ("powerline", "railway")

# What "quiet" means for a spot. Only the classes that carry through traffic:
# the full road network would blow up the filtered extracts, and a residential
# street 300 m away is not the noise anyone means.
LOUD_ROADS = ("motorway", "trunk", "primary", "secondary", "tertiary",
              "motorway_link", "trunk_link", "primary_link", "secondary_link",
              "tertiary_link")


def classify(t):
    """OSM tags -> (group, kind), or None for everything we do not want.

    The filter file has to be wider than this - osmium can only say OR, so
    "a tower, but only a lookout tower" is decided here.
    """
    power = t.get("power")
    railway = t.get("railway")
    amenity = t.get("amenity")
    tourism = t.get("tourism")
    leisure = t.get("leisure")
    man_made = t.get("man_made")
    historic = t.get("historic")
    natural = t.get("natural")
    shop = t.get("shop")

    # Noise first. A substation is not a supply point.
    if power in ("line", "minor_line"):
        return "qrm", "powerline"
    if power == "substation":
        return "qrm", "substation"
    if power == "tower":
        return "qrm", "pylon"
    if railway == "rail":
        # Only the wire hums. An unelectrified branch line is just a line.
        if t.get("electrified") in (None, "no"):
            return None
        return "qrm", "railway"

    if amenity == "parking":
        return "access", "parking"
    if t.get("highway") == "bus_stop" or railway in ("station", "halt", "tram_stop"):
        return "access", "transit"

    # Loud roads. Their own group, not `qrm`: the QRM tick in the interface
    # means power lines and overhead wire, and it must not start drawing
    # motorways. They never reach the tiles, they are input for the scoring
    # in compute_places.py.
    if t.get("highway") in LOUD_ROADS:
        return "noise", "road"

    if amenity == "bench":
        return "comfort", "bench"
    if leisure == "lounger":
        return "comfort", "lounger"
    if amenity == "shelter":
        return "comfort", "shelter"
    if tourism in ("alpine_hut", "wilderness_hut"):
        return "comfort", "hut"
    if leisure in ("picnic_table", "firepit") or tourism == "picnic_site" or amenity == "bbq":
        return "comfort", "picnic"
    if tourism in ("camp_site", "caravan_site"):
        return "comfort", "camp"

    if amenity == "toilets":
        return "supply", "toilets"
    if amenity == "drinking_water" or man_made == "water_tap":
        return "supply", "water"
    if amenity in ("restaurant", "cafe", "pub", "biergarten", "fast_food") \
            or shop in ("supermarket", "convenience", "bakery"):
        return "supply", "food"

    # Not a destination for us and never drawn: an attraction is where the
    # coaches stop, and that is worth knowing when looking for quiet. Its own
    # group, so no tick in the interface ever switches it on.
    if tourism == "attraction":
        return "crowd", "attraction"

    if tourism == "viewpoint":
        return "view", "viewpoint"
    if man_made == "tower":
        # Radio masts and water towers are not a view. Only what you may climb.
        return ("view", "tower") if t.get("tower:type") == "observation" else None
    if natural in ("peak", "saddle"):
        return "view", "peak"

    if tourism == "information":
        info = t.get("information")
        if info == "guidepost":
            return "orientation", "guidepost"
        if info in ("board", "map"):
            return "orientation", "board"
        return None

    if t.get("military") == "bunker" or historic == "bunker":
        return "target", "bunker"
    if historic in ("castle", "ruins", "fort") or t.get("building") == "castle":
        return "target", "castle"
    if man_made == "lighthouse":
        return "target", "lighthouse"
    if man_made in ("windmill", "watermill") or historic in ("windmill", "watermill"):
        return "target", "mill"
    return None


def filtered_extract(code, geofabrik_path, osmfr_path):
    """Download one country and keep only the tags from the filter file.

    On a failure of both sources the cached file of the last run is used - a
    month-old bench is still a bench, and an aborted run would leave the map
    without any POIs at all.
    """
    target = os.path.join(RAW_DIR, f"{code}.osm.pbf")
    os.makedirs(RAW_DIR, exist_ok=True)
    # The suffix has to stay a readable one: osmium picks the format from
    # the file name and refuses to write to a plain ".tmp".
    tmp = os.path.join(RAW_DIR, f"{code}.tmp.osm.pbf")

    sources = [("geofabrik", GEOFABRIK.format(geofabrik_path))]
    if osmfr_path:
        sources.append(("openstreetmap.fr", OSM_FR.format(osmfr_path)))

    # The extract has to land on disk: tags-filter reads the file twice, once
    # for the matches and once for the nodes those ways are made of, and a pipe
    # cannot be rewound ("Can not read OSM input from STDIN"). It is deleted as
    # soon as the filter is through, so the 9 GB are traffic, not storage.
    raw = os.path.join(RAW_DIR, f"{code}.raw.osm.pbf")
    for name, url in sources:
        started = time.time()
        got = subprocess.run(
            ["curl", "-fsSL", "--max-time", str(DOWNLOAD_TIMEOUT),
             "-A", UA, url, "-o", raw],
            capture_output=True, text=True)
        if got.returncode != 0:
            note = (got.stderr or "").strip().splitlines()
            print(f"  {code}: {name} failed ({note[-1] if note else got.returncode})",
                  flush=True)
            continue
        loaded = os.path.getsize(raw) / 1e6
        done = subprocess.run(
            ["osmium", "tags-filter", raw, "-e", FILTER, "-o", tmp, "--overwrite"],
            capture_output=True, text=True)
        os.remove(raw)
        if done.returncode == 0 and os.path.exists(tmp):
            os.replace(tmp, target)
            size = os.path.getsize(target) / 1e6
            print(f"  {code}: {loaded:.0f} MB from {name} -> {size:.1f} MB filtered, "
                  f"{time.time() - started:.0f} s", flush=True)
            return target
        note = (done.stderr or "").strip().splitlines()
        print(f"  {code}: filtering failed ({note[-1] if note else done.returncode})",
              flush=True)

    for leftover in (raw, tmp):
        if os.path.exists(leftover):
            os.remove(leftover)
    if os.path.exists(target):
        state = time.strftime("%Y-%m-%d", time.localtime(os.path.getmtime(target)))
        print(f"  {code}: using the cache from {state}", flush=True)
        return target
    print(f"  {code}: no data and no cache, skipped", flush=True)
    return None


class Collection:
    """Write a FeatureCollection while reading, instead of holding it in RAM.

    Three million features as a Python list is gigabytes; as a stream it is a
    file handle.
    """

    def __init__(self, path):
        self.path = path
        self.tmp = path + ".tmp"
        self.count = 0
        self.fh = open(self.tmp, "w", encoding="utf-8")
        self.fh.write('{"type":"FeatureCollection","features":[')

    def add(self, geometry, props):
        if self.count:
            # One feature per line. Costs a few megabytes of newlines and lets
            # everything downstream read the file line by line instead of
            # parsing a gigabyte in one go - see compute_places.py.
            self.fh.write(",\n")
        json.dump({"type": "Feature", "geometry": geometry, "properties": props},
                  self.fh, ensure_ascii=False)
        self.count += 1

    def close(self):
        self.fh.write("]}")
        self.fh.close()
        os.replace(self.tmp, self.path)


def to_point(geometry):
    """One point per feature. A car park is an area in OSM; on the map it is
    a symbol, and a symbol needs a spot to sit on. `representative_point`
    always lands inside the shape, unlike the centroid of a horseshoe."""
    if geometry["type"] == "Point":
        return geometry
    try:
        p = shape(geometry).representative_point()
    except Exception:
        return None
    return {"type": "Point", "coordinates": [round(p.x, 6), round(p.y, 6)]}


def read_features(path):
    """Stream the filtered extract as GeoJSON text sequences."""
    cmd = ["osmium", "export", path, "-f", "geojsonseq", "-u", "type_id",
           "--geometry-types=point,linestring,polygon"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, bufsize=1 << 20)
    for line in proc.stdout:
        line = line.strip().lstrip("\x1e")
        if not line:
            continue
        try:
            yield json.loads(line)
        except json.JSONDecodeError:
            continue
    proc.stdout.close()
    err = proc.stderr.read()
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(f"osmium export failed: {err.strip()[:200]}")


def main():
    # Country codes as arguments limit what is downloaded again - handy when
    # one country was unreachable last time. Everything else still comes out of
    # its cached extract, so the output stays complete either way.
    only = {c.upper() for c in sys.argv[1:]}

    points = Collection(os.path.join(DATA, "pois.geojson"))
    lines = Collection(os.path.join(DATA, "qrm.geojson"))
    roads = Collection(os.path.join(DATA, "roads.geojson"))
    kinds = Counter()
    skipped = 0

    for code, geofabrik_path, osmfr_path in COUNTRIES:
        if only and code not in only:
            path = os.path.join(RAW_DIR, f"{code}.osm.pbf")
            if not os.path.exists(path):
                continue
            print(f"  {code}: from the cache, not refreshed", flush=True)
        else:
            try:
                path = filtered_extract(code, geofabrik_path, osmfr_path)
            except Exception as exc:
                # One country failing must not cost the other six. The run is
                # monthly and unattended; a partial map beats an empty one.
                print(f"  {code}: skipped after an error ({exc})", flush=True)
                continue
        if not path:
            continue
        before = points.count + lines.count + roads.count
        for feature in read_features(path):
            tags = feature.get("properties") or {}
            what = classify(tags)
            if not what:
                skipped += 1
                continue
            group, kind = what
            props = {"kind": kind, "group": group}
            name = tags.get("name")
            if name:
                props["name"] = name[:80]

            geometry = feature.get("geometry")
            if not geometry:
                continue
            if group == "noise":
                if geometry["type"] not in ("LineString", "MultiLineString"):
                    continue
                # No name and no kind detail: this file is only ever asked
                # "how far away is the nearest one".
                roads.add(geometry, {"kind": kind, "group": group})
            elif kind in LINE_KINDS:
                if geometry["type"] not in ("LineString", "MultiLineString"):
                    continue
                lines.add(geometry, props)
            else:
                geometry = to_point(geometry)
                if not geometry:
                    continue
                points.add(geometry, props)
            kinds[kind] += 1
        print(f"  {code}: {points.count + lines.count + roads.count - before} kept",
              flush=True)

    points.close()
    lines.close()
    roads.close()
    save(os.path.join(CACHE, "poi_counts.json"), dict(kinds))

    print(f"{points.count} points -> {points.path}")
    print(f"{lines.count} lines -> {lines.path}")
    print(f"{roads.count} roads -> {roads.path}")
    print(f"{skipped} objects came through the tag filter but fit no category")
    for kind, n in kinds.most_common():
        print(f"  {kind:12} {n}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
