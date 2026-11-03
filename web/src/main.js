import * as maplibregl from "/vendor/maplibre-gl.mjs";
import { Protocol } from "pmtiles";
import {
  namedTheme,
  noLabelsWithCustomTheme,
  labelsWithCustomTheme,
} from "protomaps-themes-base";
import { startTracking } from "./tracking.js";
import { t, applyStatic, currentLanguage, setLanguage, LANGUAGES } from "./i18n.js";
import { addPoiIcons } from "./poiicons.js";

/* PMTiles: MapLibre pulls single tiles out of one file over HTTP range requests. */
maplibregl.addProtocol("pmtiles", new Protocol().tile);

const PROGRAMS = ["DE", "AT", "CH", "LI", "CZ", "DK", "LU"];

const COLOR_PARK = "#e02424";
const COLOR_NEVER = "#9333ea";
const COLOR_POINT = "#0ea5e9";
const COLOR_TRAIL = "#1d4ed8";
const COLOR_PLAN = "#8b5cf6";
const COLOR_PLACE = "#059669";
const COLOR_SPOT = "#f59e0b";
const COLOR_HUNT = "#0d9488";

const TABS = ["map", "spots", "me", "outdoors"];

/* What is out there, from OpenStreetMap. The switch is per group, and so is
   the colour: a park has one bench and twenty kinds of thing around it, and
   twenty colours would be a code to look up, not a legend to read. Which kind
   it is stands in the popup. */
const POI_GROUPS = ["access", "comfort", "supply", "view", "orientation", "target", "qrm"];

/* Dots below, symbols above: at 13 and 14 a symbol would be a smudge and
   there can be a few thousand on screen at once, but where the switch belongs
   depends on the screen and on what you are after, so it is a setting. The
   tiles start at 13, which is the floor for both. */
const POI_ZOOM = { min: 13, max: 18, standard: 15 };
const POI_SIZE = { min: 60, max: 200, standard: 100 };

/* Which group a kind belongs to. The tiles carry the group as a property -
   this table is only here to colour the symbols, which are drawn once and
   cannot read a filter expression. `classify()` in fetch_osm_pois.py is the
   authority; if the two ever disagree, only the colour of a symbol is wrong. */
const POI_KIND_GROUP = {
  parking: "access", transit: "access",
  bench: "comfort", shelter: "comfort", hut: "comfort", picnic: "comfort",
  camp: "comfort", lounger: "comfort",
  toilets: "supply", water: "supply", food: "supply",
  viewpoint: "view", tower: "view", peak: "view",
  guidepost: "orientation", board: "orientation",
  bunker: "target", castle: "target", lighthouse: "target", mill: "target",
  powerline: "qrm", railway: "qrm", substation: "qrm", pylon: "qrm",
};

const POI_COLORS = {
  access: "#0369a1",
  comfort: "#15803d",
  supply: "#b45309",
  view: "#7c3aed",
  orientation: "#0f766e",
  target: "#be123c",
  qrm: "#dc2626",
};

/* Point value of a summit -> colour, the way SOTA usually shows it */
const SOTA_COLORS = ["step", ["coalesce", ["get", "pts"], 1],
  "#6DA536", 2, "#4D7A20", 4, "#AEA727", 6, "#EFA818", 8, "#DC5D04", 10, "#C8101E"];

// z/x/y instead of pmtiles://: otherwise the directory lookup inside the
// archive runs as a chain of dependent requests in the browser, and behind a
// proxy each of them costs about 150 ms.
const BASEMAP_TILES = "/t/basemap/{z}/{x}/{y}.mvt";
const PARKS_TILES = "/t/parks/{z}/{x}/{y}.mvt";
const POIS_TILES = "/t/pois/{z}/{x}/{y}.mvt";
const BOUNDS = [5.5, 45.4, 19.2, 58.1];

/* Two bases of foreign raster tiles next to our own vector one. Ours carries
   no path network, no forest tracks and no contours - which is exactly what
   is missing once you leave the road, and what every other POTA map shows.

   `osm` is the standard OpenStreetMap rendering, the same tiles pota-map.info
   uses. It is what the map starts with, and it is the one the button labelled
   "Hell" switches to. `topo` is OpenTopoMap: the same data drawn for walking,
   with contour lines and hillshade.

   Both are other people's servers, and their terms decide how we treat them:
   fetched for what is on the screen, never ahead of time. They are left out
   of both prefetchers and out of the offline store, and the worker keeps what
   was looked at - which is what the OSM tile policy asks for anyway ("keep a
   sufficient local cache"). Whoever adds one here adds its host to
   RASTER_HOSTS in sw.js, otherwise nothing of it is kept.

   The attribution is their wording, not ours: naming them this way is the
   licence condition, and it must not be shortened. */
const OSM_ATTRIBUTION =
  '© <a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';

const RASTER_BASES = {
  osm: {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    // Drawn up to 19; our map stops at 18 anyway.
    maxzoom: 19,
    attribution: OSM_ATTRIBUTION,
  },
  topo: {
    tiles: [
      "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
      "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
    ],
    // Their rendering ends here. MapLibre stretches the last level up to 18.
    maxzoom: 17,
    attribution:
      'Kartendaten: ' + OSM_ATTRIBUTION + ', SRTM | Kartendarstellung: '
      + '© <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)',
  },
};

/* Our own light vector base is switched off in the interface for the time
   being, but stays a valid value: it is still what the offline store holds,
   and a stored setting must not turn into nonsense. Whoever brings the button
   back adds it to index.html, nothing else is needed. */
/* How much colour the base map keeps, in percent. A base map is the ground,
   not the subject: at full strength a red park boundary on an orange road is
   hard to follow. Foreign maps are drawn to stand alone and start held back
   for that reason; ours are already muted by design and start as they were
   drawn. Both are one drag away from anything else, and each side remembers
   its own setting - what suits a topographic map is not what suits pastel. */
const DEFAULT_SATURATION = { own: 100, foreign: 55 };

const HIDDEN_BASES = ["light"];
const BASES = ["light", "dark", "pastel", ...Object.keys(RASTER_BASES)];

const params = new URLSearchParams(location.search);

const state = {
  // Germany only by default - anything else would be a very crowded map on
  // the first visit. The choice is remembered.
  programs: new Set(["DE"]),
  never: [],
  own: [],
  ownColor: normalizeColor(params.get("f")) || "#00a86b",
  call: (params.get("call") || "").toUpperCase(),
  showNever: true,
  showPoints: true,
  showSpots: true,
  showSota: false,
  // How you get there and where you can sit are the two questions everybody
  // has; the rest is on request.
  poiGroups: new Set(["access", "comfort"]),
  poiZoom: POI_ZOOM.standard,
  poiSize: POI_SIZE.standard,
  showPlans: false,
  onlyNfer: false,
  hideMine: false,
  // Hunted parks come from the pota.app CSV and stay in the browser.
  hunted: new Set(),
  huntedDate: "",
  huntedTotal: 0,
  hideHunted: false,
  appliedHunt: [],
  // `band` holds every band that is ticked; empty means all of them.
  spotFilter: { band: [], mode: "", fresh: false, hideQrt: false, hideHunted: false, sort: "age" },
  // The standard OpenStreetMap rendering: what a park looks for is the path
  // to it, and our own vector base does not draw one.
  base: "osm",
  saturation: { ...DEFAULT_SATURATION },
  tab: "map",
  hovered: null,
  appliedNever: [],
  appliedOwn: [],
};

const el = (id) => document.getElementById(id);

/* --------------------------------------------------- Remembered settings */

const SETTINGS_KEY = "pota-settings";
const QUALITY_KEY = "pota-quality";
const HUNTED_KEY = "pota-hunted";

/**
 * The choices survive the visit. Without this you would tick the countries
 * you want to see all over again on every call.
 *
 * Deliberately only in the visitor\'s browser - there are no accounts, and a
 * handful of switches does not need a server.
 */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;   // private mode, or storage blocked
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      programs: [...state.programs],
      base: state.base,
      saturation: state.saturation,
      tab: state.tab,
      spots: state.showSpots,
      sota: state.showSota,
      pois: [...state.poiGroups],
      poiZoom: state.poiZoom,
      poiSize: state.poiSize,
      never: state.showNever,
      points: state.showPoints,
      plans: state.showPlans,
      nfer: state.onlyNfer,
      hideMine: state.hideMine,
      hideHunted: state.hideHunted,
      spotFilter: state.spotFilter,
      call: state.call,
      colour: state.ownColor,
    }));
  } catch (err) { /* not important enough to care */ }
}

/* On the very first call there is nothing in storage. That - and only that -
   decides whether the panel starts open. */
let firstVisit = false;

function restoreSettings() {
  const g = loadSettings();
  if (!g) {
    firstVisit = true;
    return;
  }
  if (Array.isArray(g.programs) && g.programs.length) {
    state.programs = new Set(g.programs.filter((c) => PROGRAMS.includes(c)));
  }
  // "outdoor" was the name until 01.09.2026, and whoever is still on the
  // light vector base has no button to leave it with - both land on what the
  // interface offers instead.
  const base = g.base === "outdoor" ? "topo" : g.base;
  if (base && BASES.includes(base) && !HIDDEN_BASES.includes(base)) state.base = base;
  // Was a three way switch for foreign bases only until 04.09.2026.
  const OLD_SATURATION = { full: 100, muted: 55, grey: 0 };
  const stored = typeof g.saturation === "string"
    ? { foreign: OLD_SATURATION[g.saturation] }
    : g.saturation;
  if (stored && typeof stored === "object") {
    for (const key of ["own", "foreign"]) {
      if (Number.isFinite(stored[key])) state.saturation[key] = clampPercent(stored[key]);
    }
  }
  if (g.tab && TABS.includes(g.tab)) state.tab = g.tab;
  if (typeof g.spots === "boolean") state.showSpots = g.spots;
  if (typeof g.sota === "boolean") state.showSota = g.sota;
  if (Array.isArray(g.pois)) {
    state.poiGroups = new Set(g.pois.filter((x) => POI_GROUPS.includes(x)));
  }
  if (Number.isFinite(g.poiZoom)) state.poiZoom = clampRange(g.poiZoom, POI_ZOOM);
  if (Number.isFinite(g.poiSize)) state.poiSize = clampRange(g.poiSize, POI_SIZE);
  if (typeof g.never === "boolean") state.showNever = g.never;
  if (typeof g.points === "boolean") state.showPoints = g.points;
  if (typeof g.plans === "boolean") state.showPlans = g.plans;
  if (typeof g.nfer === "boolean") state.onlyNfer = g.nfer;
  if (typeof g.hideMine === "boolean") state.hideMine = g.hideMine;
  if (typeof g.hideHunted === "boolean") state.hideHunted = g.hideHunted;
  if (g.spotFilter && typeof g.spotFilter === "object") {
    Object.assign(state.spotFilter, g.spotFilter);
    // Until several bands could be watched at once this was a single name.
    if (!Array.isArray(state.spotFilter.band)) {
      state.spotFilter.band = state.spotFilter.band ? [state.spotFilter.band] : [];
    }
  }
  // The query string beats stored values - a shared link has to show what it
  // promises.
  if (g.call && !params.get("call")) state.call = g.call;
  if (g.colour && !params.get("f")) state.ownColor = g.colour;
}

/* -------------------------------------------------------------------- Map */

function emptyFC() {
  return { type: "FeatureCollection", features: [] };
}

function baseSources() {
  // One base at a time: whoever looks at a raster map should not pay for
  // vector tiles nobody draws.
  const raster = RASTER_BASES[state.base];
  const base = raster
    ? {
      raster: {
        type: "raster",
        tiles: raster.tiles,
        tileSize: 256,
        // No `bounds`: their rendering covers the world, and a grey area
        // outside DACH would look like a fault.
        maxzoom: raster.maxzoom,
        attribution: raster.attribution,
      },
    }
    : {
      basemap: {
        type: "vector",
        tiles: [BASEMAP_TILES],
        minzoom: 0,
        maxzoom: 14,
        bounds: BOUNDS,
        attribution:
          '<a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
      },
    };

  return {
    ...base,
    parks: {
      type: "vector",
      tiles: [PARKS_TILES],
      minzoom: 4,
      maxzoom: 14,
      bounds: BOUNDS,
      // Reference as the feature id: allows feature-state instead of long
      // list comparisons in the paint expression (saves work every frame).
      promoteId: { parks: "ref", points: "ref", sota: "ref", trails: "ref" },
    },
    // Own archive, not another layer of `parks`: the POIs are rebuilt on a
    // different schedule, and the offline store should only grow for someone
    // who switched them on.
    pois: {
      type: "vector",
      tiles: [POIS_TILES],
      minzoom: 13,
      maxzoom: 14,
      bounds: BOUNDS,
      attribution:
        '<a href="https://openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    },
    spots: { type: "geojson", data: emptyFC() },
    plans: { type: "geojson", data: emptyFC() },
    // The best places of the park that is open in the popup, nothing else.
    places: { type: "geojson", data: emptyFC() },
  };
}

function fillColorExpression() {
  // The order is deliberate: activated beats hunted beats "never activated".
  // Having stood there is more than having worked it from home.
  return [
    "case",
    ["boolean", ["feature-state", "own"], false], state.ownColor,
    ["boolean", ["feature-state", "hunt"], false], COLOR_HUNT,
    ["boolean", ["feature-state", "never"], false], COLOR_NEVER,
    COLOR_PARK,
  ];
}

/** Dim what is done: own activations and/or hunted parks. */
function doneExpression(normal, dimmed) {
  const cases = [];
  if (state.hideMine) cases.push(["boolean", ["feature-state", "own"], false], dimmed);
  if (state.hideHunted) cases.push(["boolean", ["feature-state", "hunt"], false], dimmed);
  return cases.length ? ["case", ...cases, normal] : normal;
}

/** Set the per-reference states once, not on every frame. */
function applyFeatureStates() {
  if (!map.getSource("parks")) return;
  for (const layer of ["parks", "points", "trails"]) {
    for (const ref of state.appliedNever) {
      map.removeFeatureState({ source: "parks", sourceLayer: layer, id: ref }, "never");
    }
    for (const ref of state.appliedOwn) {
      map.removeFeatureState({ source: "parks", sourceLayer: layer, id: ref }, "own");
    }
    for (const ref of state.appliedHunt) {
      map.removeFeatureState({ source: "parks", sourceLayer: layer, id: ref }, "hunt");
    }
    if (state.showNever) {
      for (const ref of state.never) {
        map.setFeatureState({ source: "parks", sourceLayer: layer, id: ref }, { never: true });
      }
    }
    for (const ref of state.own) {
      map.setFeatureState({ source: "parks", sourceLayer: layer, id: ref }, { own: true });
    }
    for (const ref of state.hunted) {
      map.setFeatureState({ source: "parks", sourceLayer: layer, id: ref }, { hunt: true });
    }
  }
  state.appliedNever = state.showNever ? state.never : [];
  state.appliedOwn = state.own;
  state.appliedHunt = [...state.hunted];
}

/** The fill stays restrained at high zoom so that paths underneath stay
 *  readable - the outline carries the information there. */
function fillOpacityExpression() {
  // Dim what is done instead of filtering it out - that way it stays visible
  // that there is a park, without covering the open ones.
  //
  // The branch sits in every stop of the curve, not around it: MapLibre only
  // accepts `interpolate` over `["zoom"]` at the very top. Nested, it drops
  // the property silently - which is exactly what broke "hide my activated
  // ones": the outlines dimmed, the fill did not.
  const stops = [[5, 0.20], [9, 0.26], [12, 0.14], [15, 0.07]];
  const curve = ["interpolate", ["linear"], ["zoom"]];
  for (const [z, value] of stops) curve.push(z, doneExpression(value, 0.02));
  return curve;
}

/**
 * Country selection only, without the overlap filter.
 *
 * For the SOTA summits: they carry no `nfer` property, and "only parks that
 * overlap" is a statement about parks - with the shared filter function
 * ticking that box would make every summit disappear at once.
 */
function countryFilter(extra) {
  const f = ["all", ["in", ["get", "prog"], ["literal", [...state.programs]]]];
  if (extra) f.push(extra);
  return f;
}

function programFilter(extra) {
  const f = ["all", ["in", ["get", "prog"], ["literal", [...state.programs]]]];
  // The number of overlaps sits in the tiles as a property, which makes this
  // a cheap filter instead of a list comparison.
  if (state.onlyNfer) f.push([">=", ["coalesce", ["get", "nfer"], 0], 1]);
  if (extra) f.push(extra);
  return f;
}

/**
 * Filter for the stand-in points of very small parks.
 *
 * A tile is 4096 units wide; at zoom 4 that is about 600 m per unit. A city
 * park collapses into a single point there and is missing from the tile - not
 * a bug, just the resolution of the grid. So that the map knows the same
 * parks at every zoom level, such parks get a point below their `minz`.
 *
 * In filters `["zoom"]` is only allowed as the input of an outermost `step` -
 * which is why the program filter sits in every branch, not around it.
 */
function smallPointFilter() {
  // Off entirely under the overlap filter: the point layer carries no `nfer`.
  if (state.onlyNfer) return false;
  const branch = (z) => [
    "all",
    ["in", ["get", "prog"], ["literal", [...state.programs]]],
    ["==", ["get", "area"], 1],
    [">", ["coalesce", ["get", "minz"], 4], z],
  ];
  return ["step", ["zoom"], branch(4), 5, branch(5), 6, branch(6), 7, branch(7), 8, false];
}

/** Only the groups that are ticked. An empty set hides the layers entirely. */
function poiFilter() {
  return ["in", ["get", "group"], ["literal", [...state.poiGroups]]];
}

function poiVisibility() {
  return state.poiGroups.size ? "visible" : "none";
}

function clampRange(value, range) {
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/* With the switch at the very bottom there is no room left for dots: the
   tiles start at 13, so a dot layer from 13 to 13 would be an empty band. */
function poiDotVisibility() {
  return state.poiGroups.size && state.poiZoom > POI_ZOOM.min ? "visible" : "none";
}

/* Drawn with as many pixels as the chosen size asks for: at 200 percent a
   symbol made for 100 would be a stretched bitmap. */
function poiIconRatio() {
  return Math.min(4, Math.max(2, Math.ceil(2 * state.poiSize / 100)));
}

/* The symbols grow over the first two zoom levels they are shown at, so the
   switch is not a step change in size. The chosen size scales both ends. */
function poiIconSize() {
  const factor = state.poiSize / 100;
  return [
    "interpolate", ["linear"], ["zoom"],
    state.poiZoom, 0.75 * factor,
    state.poiZoom + 2, 1 * factor,
  ];
}

function poiColorExpression() {
  const m = ["match", ["get", "group"]];
  for (const group of POI_GROUPS) m.push(group, POI_COLORS[group]);
  m.push("#64748b");
  return m;
}

function parkLayers() {
  const color = fillColorExpression();
  return [
    {
      id: "parks-fill",
      type: "fill",
      source: "parks",
      "source-layer": "parks",
      filter: programFilter(),
      paint: {
        "fill-color": color,
        "fill-opacity": fillOpacityExpression(),
      },
    },
    {
      id: "parks-line",
      type: "line",
      source: "parks",
      "source-layer": "parks",
      filter: programFilter(),
      paint: {
        "line-color": color,
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 10, 1.6, 15, 2.6],
        "line-opacity": 0.95,
      },
    },
    {
      // Trails are lines, not areas - their own layer, with a light casing so
      // they stay readable on any background.
      id: "trails-casing",
      type: "line",
      source: "parks",
      "source-layer": "trails",
      filter: programFilter(),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#ffffff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2.2, 10, 4.5, 15, 7],
        "line-opacity": 0.7,
      },
    },
    {
      id: "trails-line",
      type: "line",
      source: "parks",
      "source-layer": "trails",
      filter: programFilter(),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "own"], false], state.ownColor,
          ["boolean", ["feature-state", "hunt"], false], COLOR_HUNT,
          ["boolean", ["feature-state", "never"], false], COLOR_NEVER,
          COLOR_TRAIL,
        ],
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 1, 10, 2.2, 15, 3.5],
      },
    },
    {
      id: "parks-hover",
      type: "line",
      source: "parks",
      "source-layer": "parks",
      filter: ["==", ["get", "ref"], " "],
      paint: { "line-color": "#111827", "line-width": 3, "line-opacity": 0.85 },
    },
    {
      id: "parks-point",
      type: "circle",
      source: "parks",
      "source-layer": "points",
      filter: programFilter(["==", ["get", "area"], 0]),
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 2.4, 10, 4.5, 14, 7],
        "circle-color": [
          "case",
          ["boolean", ["feature-state", "own"], false], state.ownColor,
          ["boolean", ["feature-state", "hunt"], false], COLOR_HUNT,
          ["boolean", ["feature-state", "never"], false], COLOR_NEVER,
          COLOR_POINT,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
        "circle-opacity": 0.9,
      },
    },
    {
      // Stand-in point for parks whose area would be smaller than one tile
      // unit at this zoom level. Drawn smaller than the points of parks
      // without any area - it is a placeholder, not a kind of its own.
      id: "parks-point-klein",
      type: "circle",
      source: "parks",
      "source-layer": "points",
      filter: smallPointFilter(),
      maxzoom: 8,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, 1.8, 8, 3.2],
        "circle-color": [
          "case",
          ["boolean", ["feature-state", "own"], false], state.ownColor,
          ["boolean", ["feature-state", "hunt"], false], COLOR_HUNT,
          ["boolean", ["feature-state", "never"], false], COLOR_NEVER,
          COLOR_PARK,
        ],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 0.8,
      },
    },
    {
      // Power lines and electrified railways. Not a destination - a warning,
      // and dashed, because a solid red line reads as a boundary.
      id: "qrm-line",
      type: "line",
      source: "pois",
      "source-layer": "qrm",
      minzoom: 13,
      filter: poiFilter(),
      layout: { visibility: poiVisibility() },
      paint: {
        "line-color": POI_COLORS.qrm,
        "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 14, 2, 17, 3],
        "line-opacity": 0.5,
        "line-dasharray": [2, 2],
      },
    },
    {
      // The overview below the switch: a dot says "something is here", the
      // symbol above says what. Where the two meet is a setting, see POI_ZOOM.
      id: "poi-dot",
      type: "circle",
      source: "pois",
      "source-layer": "pois",
      minzoom: POI_ZOOM.min,
      maxzoom: state.poiZoom,
      filter: poiFilter(),
      layout: { visibility: poiDotVisibility() },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 2.2, 15, 4, 18, 7],
        "circle-color": poiColorExpression(),
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 13, 0.5, 16, 1.2],
        "circle-opacity": 0.95,
      },
    },
    {
      // From the switch on you should not have to click to know what is
      // there. The symbols are drawn at runtime, see poiicons.js.
      id: "poi-symbol",
      type: "symbol",
      source: "pois",
      "source-layer": "pois",
      minzoom: state.poiZoom,
      filter: poiFilter(),
      layout: {
        visibility: poiVisibility(),
        "icon-image": [
          "coalesce",
          ["image", ["concat", "poi-", ["get", "kind"]]],
          ["image", "poi-generic"],
        ],
        "icon-size": poiIconSize(),
        // Overlapping symbols make a wall of colour. Whoever is hidden here
        // is still in the tile and still answers a click.
        "icon-allow-overlap": false,
        "icon-padding": 1,
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        // The name is the extra, the symbol is the point: where the label does
        // not fit, the symbol stays.
        "text-optional": true,
      },
      paint: {
        "text-color": "#334155",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
      },
    },
    {
      id: "sota-dot",
      type: "circle",
      source: "parks",
      "source-layer": "sota",
      // All summits are in the tiles; the style controls the density. Below
      // zoom 8 the Alps alone would be tens of thousands of points, so only
      // the 10-point summits show there. In filters ["zoom"] is only allowed
      // as the input of an outermost step expression - exactly as used here.
      filter: countryFilter(["step", ["zoom"], [">=", ["get", "pts"], 10], 8, true]),
      layout: { visibility: "none" },
      paint: {
        // Green summit dots on green terrain disappear otherwise: bigger,
        // with a strong white outline.
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 2, 9, 4, 11, 6.5, 14, 10],
        "circle-color": SOTA_COLORS,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 6, 0.6, 9, 1.2, 11, 2, 14, 2.5],
      },
    },
    {
      id: "sota-label",
      type: "symbol",
      source: "parks",
      "source-layer": "sota",
      filter: countryFilter(),
      minzoom: 9,
      layout: {
        visibility: "none",
        "text-field": ["get", "name"],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#334155",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.4,
      },
    },
    {
      id: "plans-dot",
      type: "circle",
      source: "plans",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 4, 10, 7, 14, 10],
        "circle-color": COLOR_PLAN,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
        "circle-opacity": 0.9,
      },
    },
    {
      id: "plans-label",
      type: "symbol",
      source: "plans",
      minzoom: 7,
      layout: {
        visibility: "none",
        "text-field": ["get", "activator"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 11,
        "text-offset": [0, 1.3],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#5b21b6",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.6,
      },
    },
    {
      id: "spots-halo",
      type: "circle",
      source: "spots",
      paint: { "circle-radius": 13, "circle-color": COLOR_SPOT, "circle-opacity": 0.18 },
    },
    {
      id: "spots-dot",
      type: "circle",
      source: "spots",
      paint: {
        "circle-radius": 6,
        "circle-color": COLOR_SPOT,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1.5,
      },
    },
    {
      // Ranked places of the open park. Numbered, because the list beside
      // them is numbered too and a colour cannot say "third best".
      id: "places-halo",
      type: "circle",
      source: "places",
      paint: { "circle-radius": 15, "circle-color": COLOR_PLACE, "circle-opacity": 0.18 },
    },
    {
      id: "places-dot",
      type: "circle",
      source: "places",
      paint: {
        "circle-radius": 11,
        "circle-color": COLOR_PLACE,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    },
    {
      id: "places-rank",
      type: "symbol",
      source: "places",
      layout: {
        "text-field": ["get", "rank"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 12,
        "text-allow-overlap": true,
      },
      paint: { "text-color": "#ffffff" },
    },
    {
      id: "spots-label",
      type: "symbol",
      source: "spots",
      minzoom: 6,
      layout: {
        "text-field": ["get", "activator"],
        "text-font": ["Noto Sans Medium"],
        "text-size": 11,
        "text-offset": [0, 1.25],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#7c2d12",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.6,
      },
    },
  ];
}

/**
 * Show the ticked POI groups, hide the layers when nothing is ticked, and
 * apply where dots turn into symbols and how large those are drawn. Zoom
 * range and icon size are set on the live layers - rebuilding the style for
 * a slider would throw away every tile on screen.
 */
function refreshPois() {
  addPoiIcons(map, (kind) => POI_COLORS[POI_KIND_GROUP[kind]] || "#64748b", poiIconRatio());
  for (const id of ["qrm-line", "poi-dot", "poi-symbol"]) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, "visibility", id === "poi-dot" ? poiDotVisibility() : poiVisibility());
    map.setFilter(id, poiFilter());
  }
  if (map.getLayer("poi-dot")) {
    map.setLayerZoomRange("poi-dot", POI_ZOOM.min, Math.max(state.poiZoom, POI_ZOOM.min + 0.5));
  }
  if (map.getLayer("poi-symbol")) {
    map.setLayerZoomRange("poi-symbol", state.poiZoom, 24);
    map.setLayoutProperty("poi-symbol", "icon-size", poiIconSize());
  }
  const legend = el("legend-pois");
  if (legend) legend.hidden = !state.poiGroups.size;
}

/** Match the interface to the chosen basemap. */
function applyTheme() {
  document.documentElement.dataset.theme = state.base === "dark" ? "dark" : "light";
}

/* A warm, low saturation reading of our own vector base: cream where people
   live, sage for the woods, pale blue water. Two things it does that the
   plain light theme does not - it keeps the colours far enough apart to tell
   a meadow from a forest at a glance, and it draws the path network. How you
   get in is the question a park raises, and a footpath in near white on near
   white answers nothing. Like the dark base it needs no network. */
const PASTEL_THEME = {
  ...namedTheme("light"),
  background: "#e6dfd3",
  earth: "#f3ede5",
  park_a: "#e4ead6",
  park_b: "#cfdcbc",
  wood_a: "#dbe3cc",
  wood_b: "#c8d3bd",
  scrub_a: "#e2e6cf",
  scrub_b: "#d3dcbb",
  hospital: "#f0e4e0",
  school: "#efe8dc",
  industrial: "#e6e3dd",
  military: "#e5e1d8",
  zoo: "#dfe6d6",
  pedestrian: "#ece5d9",
  sand: "#f0e9d8",
  beach: "#f2ead4",
  glacier: "#f2f2f0",
  aerodrome: "#e6e3dd",
  runway: "#f2efe9",
  water: "#cfdce8",
  buildings: "#d8d1c4",
  // Roads keep the usual reading: white surface, one warm grey casing.
  minor_service_casing: "#d5cdbb",
  minor_casing: "#d5cdbb",
  link_casing: "#cbc2ae",
  major_casing_late: "#c9bfa9",
  highway_casing_late: "#bdb29a",
  major_casing_early: "#c9bfa9",
  highway_casing_early: "#bdb29a",
  bridges_other_casing: "#d5cdbb",
  bridges_minor_casing: "#d5cdbb",
  bridges_link_casing: "#cbc2ae",
  bridges_major_casing: "#c9bfa9",
  bridges_highway_casing: "#bdb29a",
  tunnel_other_casing: "#e4ded2",
  tunnel_minor_casing: "#e4ded2",
  tunnel_link_casing: "#e4ded2",
  tunnel_major_casing: "#e4ded2",
  tunnel_highway_casing: "#e4ded2",
  pier: "#d5cdbb",
  tunnel_other: "#e8e2d8",
  tunnel_minor: "#e8e2d8",
  tunnel_link: "#e8e2d8",
  tunnel_major: "#e8e2d8",
  tunnel_highway: "#e8e2d8",
  minor_service: "#f6f2ea",
  minor_a: "#f6f2ea",
  minor_b: "#ffffff",
  bridges_other: "#f6f2ea",
  bridges_major: "#fbf8f3",
  // `other` carries the tracks and footpaths, see PATH_LAYERS below.
  other: "#b6a488",
  railway: "#a99f8f",
  boundaries: "#b9ab99",
  roads_label_minor: "#8a8175",
  roads_label_major: "#7d7568",
  city_label: "#4f4a42",
  city_label_halo: "#f3ede5",
  subplace_label: "#8b8377",
  subplace_label_halo: "#f3ede5",
  state_label: "#a49b8c",
  state_label_halo: "#f3ede5",
  country_label: "#9c9384",
  peak_label: "#7d8a70",
  ocean_label: "#7f9ab0",
  address_label: "#918878",
  landcover: {
    grassland: "rgba(224, 233, 203, 1)",
    barren: "rgba(240, 234, 216, 1)",
    urban_area: "rgba(236, 231, 222, 1)",
    farmland: "rgba(230, 236, 208, 1)",
    glacier: "rgba(250, 250, 248, 1)",
    scrub: "rgba(234, 236, 208, 1)",
    forest: "rgba(200, 211, 189, 1)",
  },
};

/* The theme paints tracks and paths but leaves them hairline thin until
   zoom 20, which on this map means invisible. Same line, drawn early enough
   to be read as a way in. */
const PATH_LAYERS = new Set(["roads_other", "roads_bridges_other", "roads_tunnels_other"]);
const PATH_WIDTH = [
  "interpolate", ["exponential", 1.6], ["zoom"],
  12, 0.4,
  14, 0.9,
  16, 1.8,
  20, 6,
];

/* Taking colour out of a vector base is not `raster-saturation` - there is no
   picture to filter, and filtering the canvas would drain our own park
   colours with it. So the theme is faded before the layers are built: every
   colour is mixed towards its own brightness, which is what the raster
   filter does to a tile. Only the base map is touched; the outlines, spots
   and POIs on top keep their colour, and that is the whole point. */
function fadeColour(value, factor) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
  let parts;
  let alpha = null;
  if (hex) {
    const n = parseInt(hex[1], 16);
    parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else if (rgb) {
    const nums = rgb[1].split(",").map((x) => parseFloat(x));
    if (nums.length < 3 || nums.some((x) => !Number.isFinite(x))) return value;
    parts = nums.slice(0, 3);
    if (nums.length > 3) alpha = nums[3];
  } else {
    return value;   // named colours and expressions stay as they are
  }
  const grey = 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  const mixed = parts.map((c) =>
    Math.max(0, Math.min(255, Math.round(grey + (c - grey) * factor))));
  return alpha === null
    ? `rgb(${mixed.join(", ")})`
    : `rgba(${mixed.join(", ")}, ${alpha})`;
}

/** A theme with every colour faded. Nested groups (POIs, land cover) too. */
function fadeTheme(theme, percent) {
  if (percent >= 100) return theme;
  const factor = Math.max(0, percent) / 100;
  const out = {};
  for (const [key, value] of Object.entries(theme)) {
    if (typeof value === "string") out[key] = fadeColour(value, factor);
    else if (value && typeof value === "object") out[key] = fadeTheme(value, percent);
    else out[key] = value;
  }
  return out;
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Which of the two settings the base on screen is governed by. */
function saturationKey() {
  return RASTER_BASES[state.base] ? "foreign" : "own";
}

function currentSaturation() {
  return state.saturation[saturationKey()];
}

/** Same strength for a raster base, in the units the filter takes: 0 to -1. */
function rasterSaturation() {
  return currentSaturation() / 100 - 1;
}

/** The theme the current base is drawn with, faded to the chosen strength. */
function baseTheme() {
  const theme = state.base === "pastel"
    ? PASTEL_THEME
    : namedTheme(state.base === "dark" ? "dark" : "light");
  return fadeTheme(theme, currentSaturation());
}

/** Base layers of a vector base. The library objects are copied, never changed. */
function vectorLayers() {
  const widenPaths = state.base === "pastel";
  return noLabelsWithCustomTheme("basemap", baseTheme()).map((layer) =>
    (widenPaths && PATH_LAYERS.has(layer.id)
      ? { ...layer, paint: { ...layer.paint, "line-width": PATH_WIDTH } }
      : layer));
}

function buildStyle() {
  const sources = baseSources();
  // Areas and lines first. Labels are added after the first frame - they pull
  // in 650 KB of glyphs and are not the first thing needed to get your
  // bearings. The raster base needs neither: its labels are in the picture.
  const layers = RASTER_BASES[state.base]
    ? [{
      id: "raster",
      type: "raster",
      source: "raster",
      paint: { "raster-saturation": rasterSaturation() },
    }]
    : vectorLayers();
  const sprites = state.base === "dark" ? "dark" : "light";

  return {
    version: 8,
    glyphs: "/fonts/{fontstack}/{range}.pbf",
    sprite: location.origin + "/sprites/" + sprites,
    sources,
    layers: [...layers, ...parkLayers()],
  };
}

restoreSettings();
applyTheme();

/* Register before the map is built, not once it has loaded: until the worker
   is in charge, every tile passes it by and is not kept. It claims the open
   page as soon as it is active (see sw.js) - measured, that is early enough
   for our own tiles on the very first visit. Foreign raster tiles are
   requested before that and are only kept from the second visit on; nothing
   can be done about that from here. */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("service worker:", err);
  });
}

const start = readHash() || { center: [10.2, 50.71], zoom: 5.4 };

/* On high resolution screens MapLibre draws devicePixelRatio^2 as many pixels
   per frame. At dpr 2 that turns 2 megapixels into 8 - measured 133 ms per
   frame instead of 50. A mild cap costs hardly any sharpness and halves the
   work. */
const QUALITY_LEVELS = { sharp: 4, auto: 1.5, smooth: 1 };
let qualityChoice = "auto";
try {
  const stored = localStorage.getItem(QUALITY_KEY);
  if (stored && QUALITY_LEVELS[stored]) qualityChoice = stored;
} catch (err) { /* private mode */ }

function pixelCap(choice) {
  return Math.min(window.devicePixelRatio || 1, QUALITY_LEVELS[choice]);
}

const map = new maplibregl.Map({
  container: "map",
  pixelRatio: pixelCap(qualityChoice),
  style: buildStyle(),
  center: start.center,
  zoom: start.zoom,
  minZoom: 3,
  maxZoom: 18,
  attributionControl: false,
});

map.addControl(new maplibregl.NavigationControl(), "top-right");
const locate = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
});
locate.on("geolocate", (e) => {
  if (e && e.coords) checkPosition(e.coords.latitude, e.coords.longitude);
});
map.addControl(locate, "top-right");

map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "metric" }), "bottom-left");
map.addControl(
  new maplibregl.AttributionControl({
    compact: true,
    customAttribution: t("credits.attribution"),
  }),
  "bottom-left",
);

/* ------------------------------------------------------------------ State */

function refreshParkPaint() {
  if (!map.getLayer("parks-fill")) return;
  const color = fillColorExpression();
  map.setPaintProperty("parks-fill", "fill-color", color);
  map.setPaintProperty("parks-fill", "fill-opacity", fillOpacityExpression());
  map.setPaintProperty("parks-line", "line-opacity", doneExpression(0.95, 0.15));
  for (const id of ["plans-dot", "plans-label"]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", state.showPlans ? "visible" : "none");
    }
  }
  map.setPaintProperty("parks-line", "line-color", color);
  applyFeatureStates();
  map.setFilter("parks-fill", programFilter());
  map.setFilter("parks-line", programFilter());
  map.setFilter("parks-point", programFilter(["==", ["get", "area"], 0]));
  if (map.getLayer("parks-point-klein")) {
    map.setFilter("parks-point-klein", smallPointFilter());
  }
  for (const id of ["trails-casing", "trails-line"]) {
    if (map.getLayer(id)) map.setFilter(id, programFilter());
  }
  refreshPois();
  if (map.getLayer("trails-line")) {
    map.setPaintProperty("trails-line", "line-color", [
      "case",
      ["boolean", ["feature-state", "own"], false], state.ownColor,
      ["boolean", ["feature-state", "hunt"], false], COLOR_HUNT,
      ["boolean", ["feature-state", "never"], false], COLOR_NEVER,
      COLOR_TRAIL,
    ]);
  }
  map.setPaintProperty("parks-point", "circle-color", [
    "case",
    ["boolean", ["feature-state", "own"], false], state.ownColor,
    ["boolean", ["feature-state", "hunt"], false], COLOR_HUNT,
    ["boolean", ["feature-state", "never"], false], COLOR_NEVER,
    COLOR_POINT,
  ]);
  map.setLayoutProperty("parks-point", "visibility", state.showPoints ? "visible" : "none");
  for (const id of ["sota-dot", "sota-label"]) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, "visibility", state.showSota ? "visible" : "none");
    map.setFilter(id, id === "sota-dot"
      ? countryFilter(["step", ["zoom"], [">=", ["get", "pts"], 10], 8, true])
      : countryFilter());
  }
  for (const id of ["spots-halo", "spots-dot", "spots-label"]) {
    if (map.getLayer(id)) {
      map.setLayoutProperty(id, "visibility", state.showSpots ? "visible" : "none");
    }
  }
}

function restyle() {
  labelsAdded = false;
  map.setStyle(buildStyle());
  map.once("styledata", () => {
    state.appliedNever = [];
    state.appliedOwn = [];
    state.appliedHunt = [];
    refreshParkPaint();
    if (spotData && map.getSource("spots")) map.getSource("spots").setData(spotData);
    // The popup survives a change of base map, so its markers have to as well.
    if (placesOnMap) showPlacesOnMap(placesOnMap);
    scheduleLabels();
  });
}

/* ------------------------------------------------------ Labels, added later */

let labelsAdded = false;

/** Add the place and street labels of the basemap after the first frame. */
function addBasemapLabels() {
  // A raster base brings its own names - a second set on top would be a
  // duplicate in a different font.
  if (RASTER_BASES[state.base]) return;
  if (labelsAdded || !map.isStyleLoaded()) return;
  labelsAdded = true;
  // Insert below our own layers so the order stays intact
  const anchor = map.getLayer("parks-fill") ? "parks-fill" : undefined;
  const labelLayers = labelsWithCustomTheme("basemap", baseTheme(), "de");
  for (const layer of labelLayers) {
    if (!map.getLayer(layer.id)) {
      try {
        map.addLayer(layer, anchor);
      } catch (err) {
        console.warn("labels:", layer.id, err);
      }
    }
  }
}

function scheduleLabels() {
  const go = () => {
    if (window.requestIdleCallback) {
      requestIdleCallback(addBasemapLabels, { timeout: 800 });
    } else {
      setTimeout(addBasemapLabels, 120);
    }
  };
  if (map.loaded()) go();
  else map.once("idle", go);
}

/* ------------------------------------------------------------------- Data */

let parkIndex = [];
let spotData = null;

async function loadJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(url + " -> " + r.status);
  return r.json();
}

/** Small and needed at once: which parks were never activated, plus counts. */
async function loadBasics() {
  try {
    const [never, stats, places] = await Promise.all([
      loadJSON("/data/never_activated.json"),
      loadJSON("/data/stats.json").catch(() => null),
      // Count and best score per park. Knowing this before the popup opens
      // saves a request for every park that has nothing to show.
      loadJSON("/data/places_index.json").catch(() => null),
    ]);
    state.never = never;
    placesIndex = places || {};
    refreshParkPaint();
    if (stats && stats.total) {
      setStatus(t("stats.parks", { parks: stats.total.parks, areas: stats.total.areas }));
      // Show the build: on a report like "data is missing" this tells at once
      // whether the data set is stale or the browser is.
      const bundle = (import.meta.url.match(/app-([A-Z0-9]+)\.js/) || [])[1] || "?";
      el("build-info").textContent =
        t("stats.build", { date: stats.date || t("stats.unknown"), build: bundle });
    }
  } catch (err) {
    console.warn("base data not loaded", err);
    setStatus(t("stats.incomplete"));
  }
}

/** The search index is 230 KB and only needed for search - so load on demand. */
let indexPromise = null;

function ensureIndex() {
  if (!indexPromise) {
    indexPromise = loadJSON("/data/park_index.json")
      .then((list) => {
        parkIndex = list;
        return list;
      })
      .catch((err) => {
        console.warn("search index not loaded", err);
        indexPromise = null;
        return [];
      });
  }
  return indexPromise;
}

let overlaps = {};

async function loadOverlaps() {
  try {
    overlaps = await loadJSON("/data/overlaps.json");
  } catch (err) {
    overlaps = {};
  }
}

async function loadPlans() {
  if (!state.showPlans) return;
  try {
    const [plans, list] = await Promise.all([loadJSON("/api/scheduled"), ensureIndex()]);
    const nachRef = new Map(list.map((p) => [p.r, p]));
    const features = [];
    for (const p of plans) {
      const park = nachRef.get(p.reference);
      if (!park) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [park.x, park.y] },
        properties: p,
      });
    }
    if (map.getSource("plans")) {
      map.getSource("plans").setData({ type: "FeatureCollection", features });
    }
  } catch (err) {
    console.warn("scheduled activations not loaded", err);
  }
}

let spotsRaw = null;
let tracking = null;

async function loadSpots() {
  if (!state.showSpots) return;
  try {
    spotsRaw = await loadJSON("/api/spots");
    renderSpots();
  } catch (err) {
    console.warn("spots not reachable", err);
  }
}

/**
 * Band edges in kHz, deliberately cut generously around the amateur bands:
 * spots carry the frequency the way the spotter typed it, and a few kHz off
 * is the rule, not the exception.
 */
const BANDS = [
  ["160m", 1700, 2100], ["80m", 3300, 4100], ["60m", 5200, 5500],
  ["40m", 6800, 7400], ["30m", 10000, 10250], ["20m", 13900, 14500],
  ["17m", 18000, 18250], ["15m", 20900, 21600], ["12m", 24800, 25100],
  ["10m", 27900, 29900], ["6m", 50000, 54000], ["4m", 70000, 71000],
  ["2m", 143000, 149000], ["70cm", 430000, 440000],
];

function bandOf(khz) {
  const f = Number(khz);
  if (!Number.isFinite(f)) return "";
  for (const [name, low, high] of BANDS) {
    if (f >= low && f <= high) return name;
  }
  return "";
}

/**
 * The band chooser: a summary that says what is picked, and the bands as
 * checkboxes underneath.
 *
 * A `<select multiple>` would be the smaller change, but it renders as a list
 * box that is either too short to use or takes half the panel, and on a phone
 * it is barely operable. `<details>` opens and closes by itself, keeps keyboard
 * control, and needs no library.
 */
function buildBandMenu() {
  const menu = el("spot-band-menu");
  if (!menu || menu.childElementCount) return;
  for (const [name] of BANDS) {
    const row = document.createElement("label");
    row.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = name;
    box.checked = state.spotFilter.band.includes(name);
    box.addEventListener("change", () => {
      const picked = new Set(state.spotFilter.band);
      if (box.checked) picked.add(name);
      else picked.delete(name);
      // In the order of the band table, not the order they were clicked.
      state.spotFilter.band = BANDS.map(([b]) => b).filter((b) => picked.has(b));
      showBandChoice();
      saveSettings();
      renderSpots();
    });
    row.appendChild(box);
    row.appendChild(Object.assign(document.createElement("span"), { textContent: name }));
    menu.appendChild(row);
  }
}

/** What the closed chooser says. */
function showBandChoice() {
  const label = el("spot-band-label");
  if (!label) return;
  const picked = state.spotFilter.band;
  label.textContent = picked.length === 0
    ? t("spots.allBands")
    : picked.length <= 3 ? picked.join(", ")
    : t("spots.bandCount", { count: picked.length });
  for (const box of el("spot-band-menu").querySelectorAll("input")) {
    box.checked = picked.includes(box.value);
  }
}

/* Clicking anywhere else closes the chooser - the same thing a select does. */
document.addEventListener("click", (e) => {
  const chooser = el("spot-band");
  if (chooser && chooser.open && !chooser.contains(e.target)) chooser.open = false;
});

/** CW, phone and digital - anything finer would be a filter nobody uses. */
function modeOf(mode) {
  const m = String(mode || "").toUpperCase();
  if (m.includes("CW")) return "CW";
  if (["SSB", "USB", "LSB", "PHONE", "FM", "AM"].some((x) => m.includes(x))) return "SSB";
  if (m) return "DIGI";
  return "";
}

function isQrt(s) {
  return /\bQRT\b/i.test(s.comments || "");
}

function spotAgeMin(s) {
  const t = Date.parse(s.spotTime || "");
  if (!Number.isFinite(t)) return 999;
  return (Date.now() - t) / 60000;
}

/** Apply the filter row to the loaded spots. */
function filteredSpots() {
  const f = state.spotFilter;
  let list = (spotsRaw || []).filter((s) => {
    if (f.band.length && !f.band.includes(bandOf(s.frequency))) return false;
    if (f.mode && modeOf(s.mode) !== f.mode) return false;
    if (f.hideQrt && isQrt(s)) return false;
    if (f.fresh && spotAgeMin(s) > 15) return false;
    if (f.hideHunted && state.hunted.has(s.reference)) return false;
    return true;
  });
  list = list.slice().sort((a, b) =>
    f.sort === "freq"
      ? (Number(a.frequency) || 0) - (Number(b.frequency) || 0)
      : spotAgeMin(a) - spotAgeMin(b));
  return list;
}

/** Map and list always show the same selection - anything else confuses. */
function renderSpots() {
  const spots = filteredSpots();
  spotData = {
    type: "FeatureCollection",
    features: spots.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [s.lon, s.lat] },
      properties: s,
    })),
  };
  if (map.getSource("spots")) map.getSource("spots").setData(spotData);
  renderSpotList(spots);
  const counter = el("spotcount");
  if (counter) {
    const total = (spotsRaw || []).length;
    counter.textContent = spots.length === total
      ? t("spots.count", { total })
      : t("spots.countFiltered", { shown: spots.length, total });
  }
}

/** The spots as a list as well - on the map you only find them if you happen
 *  to be looking there. */
function renderSpotList(spots) {
  const box = el("spotlist");
  if (!spots.length) {
    box.innerHTML = (spotsRaw && spotsRaw.length)
      ? '<p class="hint">' + t("spots.noMatch") + "</p>"
      : '<p class="hint">' + t("spots.none") + "</p>";
    return;
  }
  box.innerHTML = spots
    .slice(0, 40)
    .map((s) => {
      const band = bandOf(s.frequency);
      const hunted = state.hunted.has(s.reference);
      return '<div class="spot' + (hunted ? " is-hunted" : "") + '">' +
        '<button class="jump" data-lat="' + s.lat + '" data-lon="' + s.lon + '">' +
        "<b>" + esc(s.activator) + "</b> " + fmtFreq(s.frequency) +
        (band ? ' <i class="band">' + esc(band) + "</i>" : "") + " " +
        esc(s.mode || "") + "<br><span>" + esc(s.reference) + " · " +
        esc(s.age || "") + (isQrt(s) ? " · QRT" : "") + "</span></button>" +
        '<button class="mark" data-hunt="' + esc(s.reference) + '" title="' +
        esc(hunted ? t("spots.marked") : t("spots.mark")) + '">' +
        (hunted ? "✓" : "+") + "</button></div>";
    })
    .join("");
}

/** Mark a park as hunted by hand, straight from the spot list. */
function toggleHunted(ref) {
  if (state.hunted.has(ref)) state.hunted.delete(ref);
  else state.hunted.add(ref);
  state.huntedTotal = Math.max(state.huntedTotal, state.hunted.size);
  saveHunted();
  refreshParkPaint();
  showHuntedState();
  renderSpots();
}

async function loadOwn(call) {
  state.call = call;
  if (!call) {
    state.own = [];
    refreshParkPaint();
    el("callhint").textContent = t("call.hint");
    return;
  }
  el("callhint").textContent = t("call.loading");
  try {
    const refs = await loadJSON("/api/activations?call=" + encodeURIComponent(call));
    state.own = refs;
    refreshParkPaint();
    saveSettings();
    el("callhint").textContent = refs.length
      ? t("call.activated", { count: refs.length, call })
      : t("call.none", { call });
  } catch (err) {
    el("callhint").textContent = t("call.failed");
  }
}

function setStatus(text) {
  el("status").textContent = text;
}

/* --------------------------------------------------------------- Hunted parks */

/**
 * Which parks someone has hunted is known to POTA - but only for the logged in
 * user themselves. The API does not hand it out for a foreign callsign, so the
 * only way in is the file pota.app offers as "hunter_parks.csv".
 *
 * The file stays in the browser. No upload, no account, no list on our server -
 * for colouring areas that is entirely enough.
 */
const REF_PATTERN = /\b([A-Z0-9]{1,4}-\d{4,5})\b/g;

function loadHunted() {
  try {
    const raw = localStorage.getItem(HUNTED_KEY);
    if (!raw) return;
    const g = JSON.parse(raw);
    if (Array.isArray(g.refs)) state.hunted = new Set(g.refs);
    state.huntedDate = g.date || "";
    state.huntedTotal = g.total || state.hunted.size;
  } catch (err) { /* private mode, or a broken entry */ }
}

function saveHunted() {
  try {
    localStorage.setItem(HUNTED_KEY, JSON.stringify({
      refs: [...state.hunted],
      date: state.huntedDate,
      total: state.huntedTotal,
    }));
  } catch (err) { /* then it only lasts for this visit */ }
}

/**
 * Read references out of the CSV without relying on column names.
 *
 * POTA has changed the format several times over the years; matching a pattern
 * across the whole text is more robust than a fixed column, and it works with
 * a hand-assembled list as well.
 */
function refsFromText(text) {
  const found = new Set();
  for (const hits of String(text).toUpperCase().matchAll(REF_PATTERN)) {
    found.add(hits[1]);
  }
  return found;
}

async function importHunted(file) {
  const hint = el("hunted-hint");
  if (file.size > 8 * 1024 * 1024) {
    hint.textContent = t("hunted.tooBig");
    return;
  }
  hint.textContent = t("hunted.reading");
  let text = "";
  try {
    text = await file.text();
  } catch (err) {
    hint.textContent = t("hunted.unreadable");
    return;
  }
  const all = refsFromText(text);
  if (!all.size) {
    hint.textContent = t("hunted.noRefs");
    return;
  }
  // Keep only what this map knows - otherwise 1600 references sit in storage
  // of which 1200 are never drawn.
  const list = await ensureIndex();
  const known = new Set(list.map((p) => p.r));
  state.hunted = new Set([...all].filter((r) => known.has(r)));
  state.huntedTotal = all.size;
  state.huntedDate = new Date().toISOString().slice(0, 10);
  saveHunted();
  refreshParkPaint();
  showHuntedState();
  if (spotsRaw) renderSpots();
}

function showHuntedState() {
  const hint = el("hunted-hint");
  if (!hint) return;
  if (!state.hunted.size && !state.huntedTotal) {
    hint.textContent = t("hunted.empty");
    el("hunted-clear").hidden = true;
    return;
  }
  hint.textContent = t("hunted.state", {
    total: state.huntedTotal,
    here: state.hunted.size,
    date: state.huntedDate || t("hunted.unknownDate"),
  });
  el("hunted-clear").hidden = false;
}

function forgetHunted() {
  state.hunted = new Set();
  state.huntedTotal = 0;
  state.huntedDate = "";
  try { localStorage.removeItem(HUNTED_KEY); } catch (err) { /* never mind */ }
  refreshParkPaint();
  showHuntedState();
  if (spotsRaw) renderSpots();
}

/* ------------------------------------------- Which park am I in? (candidates) */

/**
 * Bounding boxes of all parks, about 140 KB.
 *
 * Without that list the browser can only test what is currently drawn -
 * `queryRenderedFeatures` sees the screen and nothing else. While live
 * tracking you walk out of the viewport, and the answer would simply be wrong.
 * With the boxes it finds the candidates anywhere and loads only their
 * per-park file.
 */
let bboxRequest = null;

function ensureBbox() {
  if (!bboxRequest) {
    bboxRequest = loadJSON("/data/park_bbox.json").catch((err) => {
      console.warn("bounding boxes not loaded", err);
      bboxRequest = null;
      return [];
    });
  }
  return bboxRequest;
}

/** Ray casting: is the point inside the area? Holes count. */
function pointInArea(lat, lon, geometry) {
  const ringHit = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) &&
          lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };
  const polys = [];
  const collect = (g) => {
    if (!g) return;
    // A park that is area and trail at once arrives as a collection; only its
    // area parts can answer "am I standing inside?".
    if (g.type === "GeometryCollection") g.geometries.forEach(collect);
    else if (g.type === "MultiPolygon") polys.push(...g.coordinates);
    else if (g.type === "Polygon") polys.push(g.coordinates);
  };
  collect(geometry);
  for (const poly of polys) {
    if (!poly.length || !ringHit(poly[0])) continue;
    // Inside the outer ring, but possibly in a hole
    let inHole = false;
    for (let k = 1; k < poly.length; k++) {
      if (ringHit(poly[k])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

// You are never "inside" a trail - a few metres of tolerance have to do.
const TRAIL_TOLERANCE_M = 60;

/**
 * Which parks does this point sit in? Answers outside the visible viewport as
 * well, because it works off the bounding boxes and not off the rendered map.
 */
async function parksAtPoint(lat, lon) {
  const boxes = await ensureBbox();
  const toleranceDeg = TRAIL_TOLERANCE_M / 111320;
  const candidates = [];
  for (const [ref, minx, miny, maxx, maxy, kind] of boxes) {
    // 0 area, 1 trail, 2 both. Anything with a line needs the tolerance,
    // you are never exactly on a trail.
    const s = kind === 0 ? 0 : toleranceDeg;
    if (lon >= minx - s && lon <= maxx + s && lat >= miny - s && lat <= maxy + s) {
      candidates.push({ ref, kind });
    }
  }
  if (!candidates.length) return [];

  const names = new Map((await ensureIndex()).map((p) => [p.r, p.n]));
  const hits = [];
  for (const a of candidates.slice(0, 25)) {
    const geom = await parkGeometry(a.ref);
    if (!geom) continue;
    const edge = distanceToEdge(lat, lon, geom);
    const inside = a.kind !== 1 && pointInArea(lat, lon, geom);
    const alongTrail = a.kind !== 0 &&
      distanceToEdge(lat, lon, geom, true) <= TRAIL_TOLERANCE_M;
    if (inside || alongTrail) {
      hits.push({ ref: a.ref, name: names.get(a.ref), edge });
    }
  }
  // Whoever stands farthest from an edge stands inside most clearly.
  hits.sort((x, y) => (y.edge || 0) - (x.edge || 0));
  return hits;
}

/* -------------------------------------------------------------- Interaction */

const popup = new maplibregl.Popup({
  closeButton: true,
  // Never wider than the screen. MapLibre writes this onto the content, so a
  // CSS function is allowed here.
  maxWidth: "min(340px, calc(100vw - 24px))",
});

/**
 * Pan the map until the whole popup is visible.
 *
 * MapLibre anchors a popup to its coordinate and picks the side with more
 * room, but it does not keep it inside the viewport: click near an edge on a
 * phone and half the popup hangs outside. Panning the map by the overflow
 * moves the popup with it, which is exactly what someone would do by hand.
 *
 * Called again after the details arrive - they make the popup taller.
 */
function keepPopupInView() {
  const node = popup.getElement();
  if (!node) return;
  const margin = 10;
  const box = node.getBoundingClientRect();
  const view = map.getContainer().getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (box.left < view.left + margin) dx = box.left - view.left - margin;
  else if (box.right > view.right - margin) dx = box.right - view.right + margin;
  if (box.top < view.top + margin) dy = box.top - view.top - margin;
  else if (box.bottom > view.bottom - margin) dy = box.bottom - view.bottom + margin;
  if (dx || dy) map.panBy([dx, dy], { duration: 220 });
}

function summitAt(point) {
  if (!map.getLayer("sota-dot") || !state.showSota) return null;
  return map.queryRenderedFeatures(point, { layers: ["sota-dot"] })[0] || null;
}

function featuresAt(point) {
  const layers = ["parks-fill", "trails-line", "parks-point", "parks-point-klein"].filter((id) => map.getLayer(id));
  if (!layers.length) return [];
  const box = [
    [point.x - 3, point.y - 3],
    [point.x + 3, point.y + 3],
  ];
  const seen = new Set();
  const out = [];
  for (const f of map.queryRenderedFeatures(box, { layers })) {
    const ref = f.properties.ref;
    if (ref && !seen.has(ref)) {
      seen.add(ref);
      out.push(f.properties);
    }
  }
  return out;
}

/**
 * POI under the pointer. Deliberately not part of `featuresAt()`: a bench is
 * not a park hit and must not push a reference out of the popup.
 */
function poiAt(point) {
  if (!state.poiGroups.size) return null;
  const layers = ["poi-symbol", "poi-dot", "qrm-line"].filter((id) => map.getLayer(id));
  if (!layers.length) return null;
  const box = [
    [point.x - 5, point.y - 5],
    [point.x + 5, point.y + 5],
  ];
  return map.queryRenderedFeatures(box, { layers })[0] || null;
}

function spotAt(point) {
  if (!map.getLayer("spots-dot") || !state.showSpots) return null;
  return map.queryRenderedFeatures(point, { layers: ["spots-dot"] })[0] || null;
}

/*
 * Pointer movement: throttled, and suspended while the map moves.
 *
 * Evaluating every single event costs half the frame rate - three
 * `queryRenderedFeatures` plus two DOM writes, and while dragging MapLibre
 * fires that at mouse rate. While dragging, the hit readout is useless
 * anyway.
 */
let pointerEvent = null;
let pointerFrame = null;

function evaluatePointer() {
  pointerFrame = null;
  const e = pointerEvent;
  pointerEvent = null;
  if (!e) return;

  el("grid").textContent = maidenhead(e.lngLat.lat, e.lngLat.lng, 6);
  el("coords").textContent = e.lngLat.lat.toFixed(5) + ", " + e.lngLat.lng.toFixed(5);

  // Query nothing while dragging, zooming or rotating
  if (map.isMoving() || map.isZooming() || map.isRotating()) {
    el("hoverinfo").hidden = true;
    setHover(null);
    return;
  }

  const spot = spotAt(e.point);
  const summit = summitAt(e.point);
  const hits = featuresAt(e.point);
  const box = el("hoverinfo");

  if (!hits.length && !spot && !summit) {
    box.hidden = true;
    setHover(null);
    return;
  }
  setHover(hits.length ? hits[0].ref : null);

  const rows = [];
  if (spot) {
    const p = spot.properties;
    rows.push(
      "<div>" + esc(t("hover.spot", { call: p.activator, freq: fmtFreq(p.frequency),
                                      mode: p.mode || "", ref: p.reference })) + "</div>",
    );
  }
  if (summit) {
    const p = summit.properties;
    rows.push("<div><b>" + esc(p.ref) + "</b> " + esc(p.name) + " - " +
      esc(t("hover.summit", { alt: p.alt, points: p.pts })) + "</div>");
  }
  for (const p of hits.slice(0, 6)) {
    rows.push("<div><b>" + esc(p.ref) + "</b> " + esc(p.name) + "</div>");
  }
  box.innerHTML = rows.join("");
  box.hidden = false;
}

map.on("mousemove", (e) => {
  pointerEvent = e;
  // At most one evaluation per frame
  if (pointerFrame === null) pointerFrame = requestAnimationFrame(evaluatePointer);
});

// Clear immediately when a movement starts, not on the next frame
map.on("movestart", () => {
  el("hoverinfo").hidden = true;
  setHover(null);
});

map.on("mouseout", () => {
  el("hoverinfo").hidden = true;
  setHover(null);
});

function setHover(ref) {
  if (state.hovered === ref) return;
  state.hovered = ref;
  if (map.getLayer("parks-hover")) {
    map.setFilter("parks-hover", ["==", ["get", "ref"], ref || " "]);
  }
  map.getCanvas().style.cursor = ref ? "pointer" : "";
}

map.on("click", (e) => {
  const spot = spotAt(e.point);
  const summit = summitAt(e.point);
  const poi = poiAt(e.point);
  const hits = featuresAt(e.point);
  if (!hits.length && !spot && !summit && !poi) {
    popup.remove();
    return;
  }

  const parts = [];
  if (spot) {
    const p = spot.properties;
    parts.push(
      '<div class="pop"><h3>' + t("popup.spot") + "</h3><div>" +
        esc(t("popup.spotOn", { call: p.activator, freq: fmtFreq(p.frequency),
                               mode: p.mode || "" })) + '</div><p class="meta">' +
        esc(t("popup.spotBy", { ref: p.reference, spotter: p.spotter || "?" })) +
        (p.age ? " - " + esc(p.age) : "") + "</p>" +
        (p.comments ? '<p class="meta">' + esc(p.comments) + "</p>" : "") +
        "</div>",
    );
  }
  if (summit) {
    const p = summit.properties;
    parts.push(
      '<div class="pop"><h3><span class="ref">' + esc(p.ref) + "</span> " + esc(p.name) +
        '</h3><p class="meta">' +
        esc(t("popup.summit", { alt: p.alt, points: p.pts, activations: p.acts })) +
        '</p><nav><a href="https://sotl.as/summits/' +
        encodePath(p.ref) + '" target="_blank" rel="noopener">' + t("popup.openSotlas") + "</a></nav></div>",
    );
  }
  if (poi) {
    const p = poi.properties;
    const kind = t("poi.kind." + p.kind);
    parts.push(
      '<div class="pop"><h3>' + esc(p.name || kind) + "</h3>" +
        '<p class="meta">' + esc(p.name ? kind : t("poi.group." + p.group)) +
        " - " + t("poi.source") + "</p>" +
        '<nav><a href="https://www.google.com/maps/dir/?api=1&destination=' +
        e.lngLat.lat.toFixed(6) + "," + e.lngLat.lng.toFixed(6) +
        '" target="_blank" rel="noopener">' + t("popup.route") + "</a></nav></div>",
    );
  }
  for (const p of hits.slice(0, 4)) {
    const origin =
      p.src === "trail" ? t("popup.trail")
      : p.src === "both" ? t("popup.areaTrail")
      : p.src ? t("popup.area")
      : t("popup.pointOnly");
    // The partners are filled in for the clicked point afterwards, see
    // fillNfer(). Until then the line stays empty instead of wrong.
    const nfer = '<p class="acts nfer" data-ref="' + esc(p.ref) + '"></p>';
    const target = parkPoint(p.ref) || { lat: e.lngLat.lat, lon: e.lngLat.lng };
    parts.push(
      '<div class="pop"><h3><span class="ref">' + esc(p.ref) + "</span> " + esc(p.name) +
        '</h3><p class="meta">' + origin + "</p>" + nfer +
        '<div class="parkinfo" data-ref="' + esc(p.ref) + '">' + t("popup.loading") + "</div>" +
        (hasPlaces(p.ref)
          ? '<div class="places" data-ref="' + esc(p.ref) + '">' + t("popup.loading") + "</div>"
          : "") +
        '<nav><a href="https://pota.app/#/park/' +
        encodeURIComponent(p.ref) + '" target="_blank" rel="noopener">' + t("popup.openPota") + "</a>" +
        '<a href="https://www.google.com/maps/dir/?api=1&destination=' +
        target.lat.toFixed(6) + "," + target.lon.toFixed(6) +
        '" target="_blank" rel="noopener">' + t("popup.route") + "</a>" +
        (p.src
          ? '<a href="/data/parks/' + encodeURIComponent(p.ref) + '.geojson" download>GeoJSON</a>' +
            '<a href="#" data-gpx="' + esc(p.ref) + '">GPX</a>'
          : "") +
        "</nav></div>",
    );
  }
  parts.push(
    '<p class="meta">' + maidenhead(e.lngLat.lat, e.lngLat.lng, 6) + " - " +
      e.lngLat.lat.toFixed(5) + ", " + e.lngLat.lng.toFixed(5) + "</p>",
  );

  popup.setLngLat(e.lngLat).setHTML(parts.join("")).addTo(map);
  keepPopupInView();
  fillParkDetails();
  fillPlaces();
  fillNfer(e.lngLat.lat, e.lngLat.lng);
});

// The markers belong to the open popup. Closing it takes them off the map.
popup.on("close", () => showPlacesOnMap(null));

/* The search index carries the POTA point of every reference. For routing
   that beats the click position - you want to get to the park, not its edge. */
function parkPoint(ref) {
  const p = parkIndex.find((x) => x.r === ref);
  return p ? { lat: p.y, lon: p.x } : null;
}

/**
 * Park details: website, first activator, activations, QSOs.
 *
 * They come from POTA through our backend, which caches them for half a day.
 * They are added after the fact rather than preloaded - the popup should be
 * there at once, even when POTA is slow.
 */
const parkinfoCache = new Map();

async function parkInfo(ref) {
  if (parkinfoCache.has(ref)) return parkinfoCache.get(ref);
  const p = loadJSON("/api/park/" + encodeURIComponent(ref)).catch(() => null);
  parkinfoCache.set(ref, p);
  return p;
}

function fillParkDetails() {
  const root = popup.getElement();
  if (!root) return;
  for (const box of root.querySelectorAll(".parkinfo[data-ref]")) {
    const ref = box.dataset.ref;
    parkInfo(ref).then((d) => {
      if (!box.isConnected) return;
      if (!d) { box.remove(); return; }
      const rows = [];
      if (d.kind) rows.push(esc(d.kind) + (d.region ? ", " + esc(d.region) : ""));
      if (Number.isFinite(d.activations)) {
        rows.push(t("popup.activations", { count: d.activations }) +
          (Number.isFinite(d.qsos) ? " · " + t("popup.qsos", { count: d.qsos }) : ""));
      }
      if (d.first_activator) {
        rows.push(esc(d.first_activation
          ? t("popup.firstOn", { call: d.first_activator,
                                 date: prettyDate(d.first_activation) })
          : t("popup.firstBy", { call: d.first_activator })));
      }
      if (d.website) {
        rows.push('<a href="' + esc(d.website) +
          '" target="_blank" rel="noopener">' + t("popup.website") + "</a>");
      }
      if (!rows.length) { box.remove(); return; }
      box.innerHTML = rows.join("<br>");
      keepPopupInView();
    });
  }
}

/**
 * The best places inside a park: where a bench, a picnic table or a shelter
 * stands, ranked by what makes a spot worth carrying a station to.
 *
 * The ranking is not computed here. It is precomputed for every park in the
 * pipeline (compute_places.py) and served as a plain file, which is why the
 * map can show it without asking Overpass or an elevation service - and why
 * it still works out in the field, where the file is in the browser cache.
 *
 * The model is the one from POTASpotFinder by DA6MAX, weights and all.
 */
let placesIndex = {};
const placesCache = new Map();

// How many of them the popup shows before "all of them".
const PLACES_IN_POPUP = 3;

/** Whether asking for this park's places is worth a request at all. */
function hasPlaces(ref) {
  const entry = placesIndex[ref];
  return Array.isArray(entry) && entry[0] > 0;
}

function parkPlaces(ref) {
  if (!placesCache.has(ref)) {
    placesCache.set(ref, loadJSON("/data/places/" + encodeURIComponent(ref) + ".json")
      .catch(() => null));
  }
  return placesCache.get(ref);
}

/** The compass point a place is most open towards, from the eight angles. */
function bestDirection(angles) {
  if (!Array.isArray(angles) || angles.length !== 8) return null;
  let best = 0;
  for (let i = 1; i < angles.length; i += 1) {
    if (angles[i] < angles[best]) best = i;
  }
  return t("places.dir." + best);
}

function placeLine(place, rank) {
  const bits = [];
  if (Number.isFinite(place.d && place.d.ele)) {
    bits.push(t("places.ele", { m: place.d.ele }));
  }
  const open = bestDirection(place.hz);
  if (open) bits.push(t("places.open", { dir: open }));
  if (Number.isFinite(place.d && place.d.park)) {
    bits.push(t("places.toPark", { m: place.d.park }));
  }
  // The route goes to the place, not to the park: knowing that the good bench
  // is on the far side is only half an answer if the navigation drops you at
  // the entrance.
  const route = 'https://www.google.com/maps/dir/?api=1&destination=' +
    place.y.toFixed(6) + "," + place.x.toFixed(6);
  return '<div class="place"><button class="jump" data-lat="' + place.y +
    '" data-lon="' + place.x + '"><i class="rank">' + rank + "</i><span><b>" +
    esc(t("poi.kind." + place.k)) + "</b>" +
    (place.n ? " · " + esc(place.n) : "") + '<br><span class="meta">' +
    esc(bits.join(" · ")) + "</span></span></button>" +
    '<a class="route" href="' + route + '" target="_blank" rel="noopener" title="' +
    esc(t("places.route")) + '">↗</a>' +
    '<i class="score" title="' + esc(t("places.score")) + '">' + place.s + "</i></div>";
}

function renderPlaces(box, data, all) {
  const list = all ? data.places : data.places.slice(0, PLACES_IN_POPUP);
  const rows = list.map((place, i) => placeLine(place, i + 1)).join("");
  const more = !all && data.places.length > PLACES_IN_POPUP
    ? '<button class="linkish" data-places-all="' + esc(data.ref) + '">' +
      t("places.showAll", { count: data.places.length }) + "</button>"
    : "";
  box.innerHTML = '<p class="seghead">' + t("places.head") + "</p>" + rows + more +
    '<p class="meta">' + t("places.hint") + "</p>";
}

/** Put the places of the open park on the map, numbered like the list. */
let placesOnMap = null;

function showPlacesOnMap(data) {
  placesOnMap = data && data.places ? data : null;
  const source = map.getSource("places");
  if (!source) return;
  if (!placesOnMap) {
    source.setData(emptyFC());
    return;
  }
  source.setData({
    type: "FeatureCollection",
    features: data.places.map((place, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [place.x, place.y] },
      properties: { rank: String(i + 1), score: place.s },
    })),
  });
}

function fillPlaces() {
  const root = popup.getElement();
  if (!root) return;
  // Whatever was on the map belonged to the popup before this one.
  showPlacesOnMap(null);
  let first = true;
  for (const box of root.querySelectorAll(".places[data-ref]")) {
    const ref = box.dataset.ref;
    const mine = first;
    first = false;
    parkPlaces(ref).then((data) => {
      if (!box.isConnected) return;
      if (!data || !data.places || !data.places.length) { box.remove(); return; }
      renderPlaces(box, data, false);
      if (mine) showPlacesOnMap(data);
      keepPopupInView();
    });
  }
}

/* Both live inside the popup, so they are delegated on the document like the
   GPX link is. */
document.addEventListener("click", (e) => {
  const all = e.target.closest("[data-places-all]");
  if (all) {
    e.preventDefault();
    const box = all.closest(".places[data-ref]");
    parkPlaces(all.dataset.placesAll).then((data) => {
      if (data && box && box.isConnected) {
        renderPlaces(box, data, true);
        keepPopupInView();
      }
    });
    return;
  }
  const jump = e.target.closest(".place .jump[data-lat]");
  if (jump) {
    e.preventDefault();
    map.flyTo({
      center: [Number(jump.dataset.lon), Number(jump.dataset.lat)],
      zoom: Math.max(map.getZoom(), 16),
    });
  }
});

/**
 * "Counts here too" has to mean here, not somewhere in this park.
 *
 * `overlaps.json` lists the partners of a whole reference. In a nature park of
 * several hundred square kilometres those are a dozen, and almost none of them
 * is where you are standing - the line read like a promise of eleven
 * references and delivered one. So the partners are recomputed for the clicked
 * point, with the same exact test the position check uses. What only overlaps
 * elsewhere is still worth knowing when planning, but it is said as that.
 */
async function fillNfer(lat, lon) {
  const root = popup.getElement();
  if (!root) return;
  const boxes = root.querySelectorAll(".nfer[data-ref]");
  if (!boxes.length) return;
  let here = [];
  try {
    here = await parksAtPoint(lat, lon);
  } catch (err) {
    return;
  }
  const refsHere = new Set(here.map((h) => h.ref));
  for (const box of boxes) {
    if (!box.isConnected) continue;
    const ref = box.dataset.ref;
    const partners = [...refsHere].filter((r) => r !== ref);
    if (partners.length) {
      box.innerHTML = t("popup.nferHere") +
        partners.slice(0, 6).map((r) => "<b>" + esc(r) + "</b>").join(", ") +
        (partners.length > 6 ? t("popup.andMore", { count: partners.length - 6 }) : "");
      continue;
    }
    const elsewhere = (overlaps[ref] || []).length;
    box.innerHTML = elsewhere
      ? '<span class="muted">' +
        t(elsewhere === 1 ? "popup.nferElsewhereOne" : "popup.nferElsewhere",
          { count: elsewhere }) + "</span>"
      : "";
    keepPopupInView();
  }
}

/** POTA sends dates as 20220829 or as an ISO string. */
function prettyDate(raw) {
  const t = String(raw);
  const m = t.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  return m ? m[3] + "." + m[2] + "." + m[1] : t;
}

/* ------------------------------------------------------------ GPX export */

/**
 * Boundary or trail as GPX. Hardly any handheld understands GeoJSON, but they
 * all take GPX - OsmAnd, Garmin and Locus accept it directly. Areas are
 * written as a closed track; GPX has no area type.
 */
function toGpx(ref, name, geometry, places) {
  const tracks = [];
  const collect = (g) => {
    if (!g) return;
    if (g.type === "GeometryCollection") g.geometries.forEach(collect);
    else if (g.type === "Polygon") tracks.push(...g.coordinates);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates) tracks.push(...p);
    else if (g.type === "LineString") tracks.push(g.coordinates);
    else if (g.type === "MultiLineString") tracks.push(...g.coordinates);
  };
  collect(geometry);

  const segments = tracks
    .map(
      (line) =>
        "  <trkseg>\n" +
        line
          .map((c) => '   <trkpt lat="' + c[1].toFixed(6) + '" lon="' + c[0].toFixed(6) + '" />')
          .join("\n") +
        "\n  </trkseg>",
    )
    .join("\n");

  // The places as waypoints. GPX 1.1 wants them before the track, and every
  // handheld shows them without being asked - that is the whole point: the
  // planning ends up on the device, not in a browser tab.
  const waypoints = (places || []).map((place, i) => {
    const facts = [];
    if (Number.isFinite(place.d && place.d.ele)) facts.push(place.d.ele + " m");
    if (Number.isFinite(place.d && place.d.park)) {
      facts.push(t("places.toPark", { m: place.d.park }));
    }
    if (Number.isFinite(place.d && place.d.qrm)) {
      facts.push(t("places.toQrm", { m: place.d.qrm }));
    }
    return " <wpt lat=\"" + place.y.toFixed(6) + "\" lon=\"" + place.x.toFixed(6) + "\">\n" +
      "  <name>" + esc((i + 1) + " " + t("poi.kind." + place.k) + " (" + place.s + ")") +
      "</name>\n" +
      (facts.length ? "  <desc>" + esc(facts.join(" · ")) + "</desc>\n" : "") +
      (Number.isFinite(place.d && place.d.ele) ? "  <ele>" + place.d.ele + "</ele>\n" : "") +
      " </wpt>";
  }).join("\n");

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx version="1.1" creator="' + esc(location.host) + '" xmlns="http://www.topografix.com/GPX/1/1">\n' +
    (waypoints ? waypoints + "\n" : "") +
    " <trk>\n  <name>" + esc(ref + " " + name) + "</name>\n" +
    segments +
    "\n </trk>\n</gpx>\n"
  );
}

async function downloadGpx(ref) {
  // The places are a bonus: a park without them still exports its outline.
  const [feature, places] = await Promise.all([
    loadJSON("/data/parks/" + encodeURIComponent(ref) + ".geojson"),
    hasPlaces(ref) ? parkPlaces(ref) : Promise.resolve(null),
  ]);
  const text = toGpx(ref, feature.properties.name || "", feature.geometry,
                     places && places.places);
  const url = URL.createObjectURL(new Blob([text], { type: "application/gpx+xml" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = ref + ".gpx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-gpx]");
  if (!a) return;
  e.preventDefault();
  downloadGpx(a.dataset.gpx).catch((err) => console.warn("GPX:", err));
});

/* --------------------------------------------------- Which park am I in? */

/**
 * Distance from a point to the edge of an area, in metres.
 *
 * Deliberately a flat approximation instead of spherical geometry: over the
 * few hundred metres this is about, the error is far below the accuracy of the
 * position itself. Longitude is compressed by the latitude.
 */
function distanceToEdge(lat, lon, geometry, linesOnly = false) {
  const mLat = 111320;
  const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
  const px = lon * mLon;
  const py = lat * mLat;

  const segmentDistance = (ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx;
    const qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  };

  let best = Infinity;
  const rings = [];
  const collect = (g) => {
    if (!g) return;
    if (g.type === "GeometryCollection") g.geometries.forEach(collect);
    else if (g.type === "LineString") rings.push(g.coordinates);
    else if (g.type === "MultiLineString") rings.push(...g.coordinates);
    // The trail tolerance may only measure against the trail. Against the
    // boundary as well and every park with both would report a hit from
    // sixty metres outside its own area.
    else if (linesOnly) return;
    else if (g.type === "Polygon") rings.push(...g.coordinates);
    else if (g.type === "MultiPolygon") for (const p of g.coordinates) rings.push(...p);
  };
  collect(geometry);

  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = [ring[i - 1][0] * mLon, ring[i - 1][1] * mLat];
      const [bx, by] = [ring[i][0] * mLon, ring[i][1] * mLat];
      best = Math.min(best, segmentDistance(ax, ay, bx, by));
    }
  }
  return best;
}

const geometryCache = new Map();

async function parkGeometry(ref) {
  if (geometryCache.has(ref)) return geometryCache.get(ref);
  try {
    const f = await loadJSON("/data/parks/" + encodeURIComponent(ref) + ".geojson");
    geometryCache.set(ref, f.geometry);
    return f.geometry;
  } catch (err) {
    geometryCache.set(ref, null);
    return null;
  }
}

/** After a position fix, say which park you are standing in. */
async function checkPosition(lat, lon) {
  const box = el("position-box");
  box.innerHTML = t("position.checking");
  box.hidden = false;

  const inside = await parksAtPoint(lat, lon);
  if (!inside.length) {
    box.innerHTML = t("position.none");
    return;
  }

  const rows = inside.slice(0, 4).map((p) => "<b>" + esc(p.ref) + "</b> " + esc(p.name || ""));
  box.innerHTML = t("position.inside") + rows.join(" · ");

  const d = inside[0].edge;
  if (Number.isFinite(d)) {
    const text = d < 1000 ? Math.round(d) + " m" : (d / 1000).toFixed(1) + " km";
    box.innerHTML += '<div class="edge-info">' +
      esc(t("position.toEdge", { ref: inside[0].ref, distance: text })) + "</div>";
  }
}

/* ------------------------------------------------------------------- Search */

const search = el("search");
const results = el("results");

search.addEventListener("focus", () => { ensureIndex(); }, { once: true });

search.addEventListener("input", async () => {
  const q = search.value.trim().toLowerCase();
  if (q.length < 2) {
    results.hidden = true;
    return;
  }
  const rows = [];

  // A grid locator is neither a reference nor a name - whoever types one
  // wants to jump there. Four characters hit a field of roughly 110 x 150 km,
  // six one of 4.6 x 9.3 km; the zoom level follows from that.
  const centre = locatorCentre(q);
  if (centre) {
    rows.push('<li data-lat="' + centre.lat + '" data-lon="' + centre.lon +
      '" data-zoom="' + (q.length > 4 ? 11 : 8) + '"><b>' + esc(q.toUpperCase()) +
      "</b><span>" + t("search.locator") + "</span></li>");
  }

  await ensureIndex();
  const hits = [];
  for (const p of parkIndex) {
    if (p.r.toLowerCase().includes(q) || p.n.toLowerCase().includes(q)) {
      hits.push(p);
      if (hits.length >= 40) break;
    }
  }
  for (const p of hits) {
    rows.push('<li data-lat="' + p.y + '" data-lon="' + p.x + '"><b>' + esc(p.r) +
      "</b><span>" + esc(p.n) + "</span></li>");
  }
  results.innerHTML = rows.join("");
  results.hidden = rows.length === 0;
});

results.addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (!li) return;
  map.flyTo({ center: [+li.dataset.lon, +li.dataset.lat], zoom: +li.dataset.zoom || 12 });
  results.hidden = true;
  search.blur();
});

document.addEventListener("click", (e) => {
  if (!el("search-wrap").contains(e.target)) results.hidden = true;
});

el("spotlist").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if (b.dataset.hunt) {
    toggleHunted(b.dataset.hunt);
    return;
  }
  map.flyTo({ center: [+b.dataset.lon, +b.dataset.lat], zoom: 12 });
});

/* ---------------------------------------------------------------- Controls */

function renderPrograms() {
  el("programs").innerHTML = PROGRAMS.map(
    (code) =>
      '<label title="' + esc(t("programs." + code)) + '"><input type="checkbox" data-prog="' +
      code + '"' + (state.programs.has(code) ? " checked" : "") + "><span>" +
      code + "</span></label>",
  ).join("");
}

renderPrograms();

/* -------------------------------------------------------------------- Tabs */

/**
 * Four tabs instead of one long column. The split follows the question you
 * have right now: what does the map show, who is on the air, what have I done
 * already, what do I need outdoors. The choice is remembered - whoever uses
 * the map for hunting lands on the spots again next time.
 */
/**
 * Everything the catalogue feeds: the static keys, the credits (their
 * sentences carry links, so they cannot be plain text nodes), the country
 * checkboxes and the two hints that carry state.
 */
function applyLanguage() {
  applyStatic();
  const link = (href, text) =>
    '<a href="' + href + '" target="_blank" rel="noopener">' + esc(text) + "</a>";
  el("credits-areas").innerHTML =
    t("credits.areas", { source: link("https://pota-map.info", "pota-map.info") });
  el("credits-pota").innerHTML =
    t("credits.pota", { source: link("https://parksontheair.com", "Parks on the Air®") });
  el("credits-sota").innerHTML = t("credits.sota", {
    sota: link("https://www.sota.org.uk", "Summits on the Air"),
    protomaps: link("https://protomaps.com", "Protomaps"),
  });
  el("credits-pois").innerHTML = t("credits.pois", {
    osm: link("https://www.openstreetmap.org/copyright", t("credits.osm")),
  });
  el("credits-places").innerHTML = t("credits.places", {
    finder: link("https://github.com/mooxle/POTASpotFinder", "POTASpotFinder"),
  });
  el("credits-raster").innerHTML = t("credits.raster", {
    osm: link("https://www.openstreetmap.org", t("credits.osm")),
    otm: link("https://opentopomap.org", "OpenTopoMap"),
  });
  renderPrograms();
  showBaseHint();
  showHuntedState();
  if (!state.call) el("callhint").textContent = t("call.hint");
  if (spotsRaw) renderSpots();
}

function showTab(name) {
  if (!TABS.includes(name)) return;
  state.tab = name;
  for (const button of document.querySelectorAll(".tabs button")) {
    const enable = button.dataset.tab === name;
    button.setAttribute("aria-selected", String(enable));
    button.tabIndex = enable ? 0 : -1;
  }
  for (const t of TABS) el("tab-" + t).hidden = t !== name;
  el("panel").scrollTop = 0;
  saveSettings();
}

document.querySelector(".tabs").addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (button) showTab(button.dataset.tab);
});

// Arrow keys along the tab strip, the way a tab list is supposed to behave.
document.querySelector(".tabs").addEventListener("keydown", (e) => {
  const direction = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
  if (!direction) return;
  e.preventDefault();
  const i = TABS.indexOf(state.tab);
  const target = TABS[(i + direction + TABS.length) % TABS.length];
  showTab(target);
  el("tabbtn-" + target).focus();
});

showTab(state.tab);

/** Bring every switch in line with the loaded state. */
function syncControls() {
  const pairs = [
    ["opt-spots", state.showSpots],
    ["opt-sota", state.showSota],
    ["opt-never", state.showNever],
    ["opt-points", state.showPoints],
    ["opt-plans", state.showPlans],
    ["opt-nfer", state.onlyNfer],
    ["opt-todo", state.hideMine],
    ["opt-hide-hunted", state.hideHunted],
    ["spot-fresh", state.spotFilter.fresh],
    ["spot-qrt", state.spotFilter.hideQrt],
    ["spot-hunted", state.spotFilter.hideHunted],
    ...POI_GROUPS.map((group) => ["opt-poi-" + group, state.poiGroups.has(group)]),
  ];
  for (const [id, enable] of pairs) {
    const e = el(id);
    if (e) e.checked = enable;
  }
  el("sotahint").hidden = !state.showSota;
  buildBandMenu();
  showBandChoice();
  for (const [id, value] of [["spot-mode", state.spotFilter.mode],
                            ["spot-sort", state.spotFilter.sort]]) {
    const e = el(id);
    if (e) e.value = value;
  }
  for (const b of el("basemaps").children) {
    b.classList.toggle("on", b.dataset.base === state.base);
  }
  showSaturation();
  showPoiSliders();
  showBaseHint();
}

/* Worth the space for a foreign base - it says where the tiles come from and
   why that one needs a network - and for pastel, which is the other way
   round: no network, but only as far as our own extract reaches. */
function showBaseHint() {
  const hint = el("base-hint");
  if (!hint) return;
  hint.hidden = !RASTER_BASES[state.base] && state.base !== "pastel";
  if (!hint.hidden) hint.textContent = t("look.hint." + state.base);
}

/** Both POI sliders and their readings. */
function showPoiSliders() {
  const pairs = [
    ["poi-zoom", "poi-zoom-value", state.poiZoom, t("poi.zoomValue", { zoom: state.poiZoom })],
    ["poi-size", "poi-size-value", state.poiSize, t("poi.sizeValue", { percent: state.poiSize })],
  ];
  for (const [id, outId, value, text] of pairs) {
    const slider = el(id);
    const out = el(outId);
    if (slider) slider.value = String(value);
    if (out) out.textContent = text;
  }
}

/** Slider and reading, for whichever setting the base on screen uses. */
function showSaturation() {
  const slider = el("saturation");
  const out = el("saturation-value");
  if (slider) slider.value = String(currentSaturation());
  if (out) out.textContent = t("look.satValue", { percent: currentSaturation() });
}

syncControls();

el("programs").addEventListener("change", (e) => {
  const code = e.target.dataset.prog;
  if (!code) return;
  if (e.target.checked) state.programs.add(code);
  else state.programs.delete(code);
  refreshParkPaint();
  saveSettings();
});

/* A raster base only changes one paint property, so it follows the handle
   live. A vector base has to be built again - eighty odd colours across
   sixty layers - and doing that on every step of the drag would stutter, so
   it lands shortly after the handle comes to rest. */
let saturationTimer = null;

el("saturation").addEventListener("input", (e) => {
  const value = Number(e.target.value);
  if (!Number.isFinite(value)) return;
  state.saturation[saturationKey()] = clampPercent(value);
  showSaturation();
  if (map.getLayer("raster")) {
    map.setPaintProperty("raster", "raster-saturation", rasterSaturation());
    return;
  }
  clearTimeout(saturationTimer);
  saturationTimer = setTimeout(restyle, 200);
});

el("saturation").addEventListener("change", () => saveSettings());

/* Both go straight onto the live layers, so they follow the handle. */
for (const [id, key, range] of [["poi-zoom", "poiZoom", POI_ZOOM],
                                ["poi-size", "poiSize", POI_SIZE]]) {
  el(id).addEventListener("input", (e) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) return;
    state[key] = clampRange(value, range);
    showPoiSliders();
    refreshPois();
  });
  el(id).addEventListener("change", () => saveSettings());
}

el("basemaps").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  for (const b of el("basemaps").children) b.classList.toggle("on", b === btn);
  state.base = btn.dataset.base;
  applyTheme();
  showSaturation();
  showBaseHint();
  restyle();
  saveSettings();
});

/**
 * On the very first call the panel stands open - show once what is in there.
 * After that it starts closed: the map is the content, the switches are
 * accessory, and on a phone the open panel covered half the map.
 *
 * Instead, every later visit gets the small pointer under the menu button. It
 * goes away as soon as the map is touched or the panel is opened - it should
 * not stay, but it should be back next time: a map like this gets opened again
 * after weeks, and then the switches are looked for again.
 */
function togglePanel(show) {
  const panelBox = el("panel");
  panelBox.hidden = show === undefined ? !panelBox.hidden : !show;
  el("menu-toggle").setAttribute("aria-expanded", String(!panelBox.hidden));
  if (!panelBox.hidden) el("menu-hint").hidden = true;
}

el("menu-toggle").addEventListener("click", () => togglePanel());
el("menu-hint").addEventListener("click", () => togglePanel(true));

if (firstVisit) {
  togglePanel(true);
} else {
  el("menu-hint").hidden = false;
  // As soon as the map is used, the pointer is in the way.
  const dismiss = () => { el("menu-hint").hidden = true; };
  map.once("movestart", dismiss);
  map.once("click", dismiss);
}

for (const group of POI_GROUPS) {
  const box = el("opt-poi-" + group);
  if (!box) continue;
  box.addEventListener("change", (e) => {
    if (e.target.checked) state.poiGroups.add(group);
    else state.poiGroups.delete(group);
    refreshPois();
    saveSettings();
  });
}

el("opt-spots").addEventListener("change", (e) => {
  state.showSpots = e.target.checked;
  refreshParkPaint();
  saveSettings();
  if (state.showSpots) loadSpots();
});
el("opt-nfer").addEventListener("change", (e) => {
  state.onlyNfer = e.target.checked;
  refreshParkPaint();
  saveSettings();
});
el("opt-todo").addEventListener("change", (e) => {
  state.hideMine = e.target.checked;
  refreshParkPaint();
  saveSettings();
});
el("opt-plans").addEventListener("change", (e) => {
  state.showPlans = e.target.checked;
  refreshParkPaint();
  saveSettings();
  if (state.showPlans) loadPlans();
});
el("opt-sota").addEventListener("change", (e) => {
  state.showSota = e.target.checked;
  el("sotahint").hidden = !state.showSota;
  refreshParkPaint();
  saveSettings();
});
el("opt-never").addEventListener("change", (e) => {
  state.showNever = e.target.checked;
  refreshParkPaint();
  saveSettings();
});
el("opt-points").addEventListener("change", (e) => {
  state.showPoints = e.target.checked;
  refreshParkPaint();
  saveSettings();
});

const languageSelect = el("language");
languageSelect.innerHTML = LANGUAGES.map(
  ([code, name]) => '<option value="' + code + '">' + esc(name) + "</option>").join("");
languageSelect.value = currentLanguage();
languageSelect.addEventListener("change", (e) => {
  setLanguage(e.target.value);
  applyLanguage();
  // The tracking hint says whether it is running; only its own module knows.
  el("track-hint").textContent = t(tracking && tracking.running() ? "track.on" : "track.off");
});

el("opt-hide-hunted").addEventListener("change", (e) => {
  state.hideHunted = e.target.checked;
  refreshParkPaint();
  saveSettings();
});

el("hunted-file").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) importHunted(file);
  e.target.value = "";
});

el("hunted-clear").addEventListener("click", forgetHunted);

for (const id of ["spot-mode", "spot-sort"]) {
  el(id).addEventListener("change", (e) => {
    const key = id === "spot-mode" ? "mode" : "sort";
    state.spotFilter[key] = e.target.value;
    saveSettings();
    renderSpots();
  });
}

for (const [id, key] of [["spot-fresh", "fresh"], ["spot-qrt", "hideQrt"],
                         ["spot-hunted", "hideHunted"]]) {
  el(id).addEventListener("change", (e) => {
    state.spotFilter[key] = e.target.checked;
    saveSettings();
    renderSpots();
  });
}

const callInput = el("call");
callInput.value = state.call;
let callTimer;
callInput.addEventListener("input", () => {
  clearTimeout(callTimer);
  const call = callInput.value.trim().toUpperCase();
  callTimer = setTimeout(() => loadOwn(call), 450);
});

const colorInput = el("callcolor");
colorInput.value = state.ownColor;
colorInput.addEventListener("input", () => {
  state.ownColor = colorInput.value;
  el("legend-own").style.setProperty("--c", state.ownColor);
  refreshParkPaint();
  saveSettings();
});
el("legend-own").style.setProperty("--c", state.ownColor);

/* ----------------------------------------------------------------- Helpers */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/* Encode a path with slashes kept as separators (SOTA refs are "DL/BW-123"). */
function encodePath(s) {
  return String(s == null ? "" : s).split("/").map(encodeURIComponent).join("/");
}

function fmtFreq(khz) {
  const n = parseFloat(khz);
  return Number.isFinite(n) ? (n / 1000).toFixed(3) + " MHz" : String(khz == null ? "" : khz);
}

function normalizeColor(v) {
  if (!v) return null;
  const hex = v.replace(/^#/, "");
  return /^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex) ? "#" + hex : null;
}

/** Maidenhead grid locator from geographic coordinates. */
function maidenhead(lat, lon, length) {
  let x = lon + 180;
  let y = lat + 90;
  const A = 65;
  const a = 97;
  const fieldX = Math.floor(x / 20);
  const fieldY = Math.floor(y / 10);
  let qth = String.fromCharCode(A + fieldX) + String.fromCharCode(A + fieldY);
  x -= fieldX * 20;
  y -= fieldY * 10;
  const sqX = Math.floor(x / 2);
  const sqY = Math.floor(y);
  qth += String(sqX) + String(sqY);
  if (length <= 4) return qth;
  x = (x - sqX * 2) * 60;
  y = (y - sqY) * 60;
  qth += String.fromCharCode(a + Math.floor(x / 5)) + String.fromCharCode(a + Math.floor(y / 2.5));
  return qth;
}

/**
 * Centre of a Maidenhead locator, the counterpart to `maidenhead()`. Takes
 * four or six characters, anything else returns null.
 */
function locatorCentre(text) {
  const g = String(text || "").trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
  if (g.length === 6) {
    lon += (g.charCodeAt(4) - 65) * (2 / 24) + 1 / 24;
    lat += (g.charCodeAt(5) - 65) * (1 / 24) + 0.5 / 24;
  } else {
    lon += 1;
    lat += 0.5;
  }
  return { lat, lon };
}

function readHash() {
  const m = location.hash.match(/^#(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  return m ? { zoom: +m[1], center: [+m[3], +m[2]] } : null;
}

function writeHash() {
  const c = map.getCenter();
  const h = "#" + map.getZoom().toFixed(2) + "/" + c.lat.toFixed(5) + "/" + c.lng.toFixed(5);
  history.replaceState(null, "", h);
}

map.on("moveend", writeHash);

// Timestamp for measurements: when is the map first idle?
map.once("idle", () => {
  window.__mapReady = Math.round(performance.now());
});

// Exposed for debugging: on a report like "layer X is missing from zoom Y"
// this allows counting in the browser console what is really rendered.
window.__map = map;
// Also for the console: "which park am I in" could otherwise only be tested
// outdoors, which is a poor test track.
window.__parksAnPunkt = parksAtPoint;

/* ------------------------------------------------------- Prefetch while idle */

/* Once the map is idle, the browser quietly fetches the neighbourhood: a ring
 * around the view. When panning, those tiles are already in the cache.
 *
 * Deliberately restrained: low priority, capped, and not at all when the
 * visitor asked to save data. */
const prefetched = new Set();
const PREFETCH_MAX = 4000;      // insgesamt gemerkte Adressen
const PREFETCH_PER_RUN = 16;    // per idle moment - prefetching costs real bytes

function tileX(lon, n) {
  return ((lon + 180) / 360) * n;
}

function tileY(lat, n) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
}

/** MapLibre never requests tiles outside the map bounds. */
function tileInBounds(z, x, y) {
  const n = Math.pow(2, z);
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const latOf = (t) => {
    const s = Math.PI * (1 - (2 * t) / n);
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(s) - Math.exp(-s)));
  };
  return east > BOUNDS[0] && west < BOUNDS[2]
      && latOf(y) > BOUNDS[1] && latOf(y + 1) < BOUNDS[3];
}

/**
 * Fetches the ring of tiles just outside the view - that is what is missing
 * when panning. When zooming in, MapLibre scales the tile it already has,
 * which looks instant anyway; prefetching is not worth it there.
 *
 * Sorted by distance from the centre, capped, low priority, and skipped
 * entirely when the visitor asked to save data.
 */
function prefetchAround() {
  const conn = navigator.connection;
  if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ""))) return;
  if (prefetched.size > PREFETCH_MAX) return;

  const z = Math.max(0, Math.min(14, Math.floor(map.getZoom())));
  const n = Math.pow(2, z);
  const b = map.getBounds();
  const c = map.getCenter();

  const vx0 = Math.floor(tileX(b.getWest(), n));
  const vx1 = Math.floor(tileX(b.getEast(), n));
  const vy0 = Math.floor(tileY(b.getNorth(), n));
  const vy1 = Math.floor(tileY(b.getSouth(), n));
  const cx = tileX(c.lng, n);
  const cy = tileY(c.lat, n);

  const candidateList = [];
  for (let x = vx0 - 1; x <= vx1 + 1; x++) {
    for (let y = vy0 - 1; y <= vy1 + 1; y++) {
      // What is visible is already loaded - only the ring around it counts
      const visible = x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1;
      if (visible) continue;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      if (!tileInBounds(z, x, y)) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      candidateList.push([d, x, y]);
    }
  }

  candidateList.sort((a, b2) => a[0] - b2[0]);

  const urls = [];
  // Only our own archives belong in here. Fetching foreign tiles that nobody
  // is looking at yet is exactly what the OSM tile policy calls bulk
  // downloading, and the raster bases are somebody else's servers.
  const layers = RASTER_BASES[state.base] ? ["parks"] : ["basemap", "parks"];
  for (const [, x, y] of candidateList) {
    for (const layer of layers) {
      const u = `/t/${layer}/${z}/${x}/${y}.mvt`;
      if (!prefetched.has(u)) {
        prefetched.add(u);
        urls.push(u);
      }
    }
    if (urls.length >= PREFETCH_PER_RUN) break;
  }

  for (const u of urls) {
    fetch(u, { priority: "low" }).catch(() => {});
  }
}

function startPrefetch() {
  if (params.get("prefetch") === "off") return;
  let timer;
  map.on("idle", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.requestIdleCallback) {
        requestIdleCallback(prefetchAround, { timeout: 2000 });
      } else {
        prefetchAround();
      }
    }, 400);
  });
}

/* ------------------------------------------------------- Rendering quality */

/**
 * Measures the frame intervals during a movement. If the map stays sluggish,
 * the pixel density drops one step - once, without going back and forth.
 *
 * Only in "auto" mode. Whoever explicitly picks "sharp" gets sharp, even if
 * it stutters.
 */
let frameSamples = [];
let frameCheckRunning = false;
let alreadyLowered = false;

function startFrameCheck() {
  if (qualityChoice !== "auto" || alreadyLowered || frameCheckRunning) return;
  frameSamples = [];
  frameCheckRunning = true;
  let before = performance.now();
  const tick = (t) => {
    if (!frameCheckRunning) return;
    frameSamples.push(t - before);
    before = t;
    if (frameSamples.length < 90) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopFrameCheck() {
  if (!frameCheckRunning) return;
  frameCheckRunning = false;
  if (frameSamples.length < 12) return;

  const sorted = frameSamples.slice(2).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Over 28 ms is less than 36 frames per second - that is visible
  if (median > 28 && (window.devicePixelRatio || 1) > 1) {
    alreadyLowered = true;
    map.setPixelRatio(1);
    el("quality-hint").textContent =
      t("look.lowered", { fps: Math.round(1000 / median) });
  }
}

function setQuality(choice) {
  qualityChoice = choice;
  alreadyLowered = false;
  try {
    localStorage.setItem(QUALITY_KEY, choice);
  } catch (err) { /* private mode */ }
  map.setPixelRatio(pixelCap(choice));
  for (const b of el("quality").children) b.classList.toggle("on", b.dataset.q === choice);
}

el("quality").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) setQuality(b.dataset.q);
});

for (const b of el("quality").children) b.classList.toggle("on", b.dataset.q === qualityChoice);

map.on("movestart", startFrameCheck);
map.on("moveend", stopFrameCheck);

/* ------------------------------------------------------------ Offline */

/**
 * Collect the tile URLs for the visible area, from the current zoom level down
 * three levels. Deeper gets out of hand quickly: every level multiplies the
 * number of tiles by four.
 *
 * Our own archives only. The outdoor base is not in here on purpose - putting
 * a stock of someone else's tiles aside is what their terms rule out. Our own
 * base is saved even while the outdoor one is on: whoever ends up without a
 * network can switch over and still has a map.
 */
function offlineUrls() {
  const urls = [];
  const b = map.getBounds();
  const zStart = Math.max(0, Math.min(14, Math.floor(map.getZoom())));

  for (let z = zStart; z <= Math.min(14, zStart + 3); z++) {
    const n = Math.pow(2, z);
    const x0 = Math.floor(tileX(b.getWest(), n));
    const x1 = Math.floor(tileX(b.getEast(), n));
    const y0 = Math.floor(tileY(b.getNorth(), n));
    const y1 = Math.floor(tileY(b.getSouth(), n));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        if (!tileInBounds(z, x, y)) continue;
        urls.push(`/t/basemap/${z}/${x}/${y}.mvt`);
        if (z >= 4) urls.push(`/t/parks/${z}/${x}/${y}.mvt`);
        // Only for whoever switched them on - otherwise the store grows for
        // people who never see a bench.
        if (z >= 13 && state.poiGroups.size) urls.push(`/t/pois/${z}/${x}/${y}.mvt`);
      }
    }
  }
  return urls;
}

function startOffline() {
  const button = el("offline-btn");
  const hint = el("offline-hint");

  if (!("serviceWorker" in navigator)) {
    button.disabled = true;
    hint.textContent = t("offline.unsupported");
    return;
  }

  navigator.serviceWorker.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.kind !== "progress") return;
    const p = Math.round((m.done / m.total) * 100);
    hint.textContent = t("offline.progress", { done: m.done, total: m.total });
    if (m.done >= m.total) {
      button.disabled = false;
      button.textContent = t("offline.save");
      hint.textContent = t("offline.done", { total: m.total });
    }
  });

  button.addEventListener("click", async () => {
    const reg = await navigator.serviceWorker.ready;
    const urls = offlineUrls();
    if (!urls.length) {
      hint.textContent = t("offline.nothing");
      return;
    }
    // A browser short of room throws out whatever it likes. Asking here and
    // not on the first visit is deliberate: this click is the moment somebody
    // says the map matters to them, and a prompt has a reason.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => { /* denied is not a fault */ });
    }
    button.disabled = true;
    button.textContent = t("offline.saving");
    hint.textContent = t("offline.saving");
    reg.active.postMessage({ kind: "prefetch", urls });
  });
}

/* --------------------------------------------------- Storage on the device */

/* The app itself (pota-shell) is not in here: it is the program, not map
   data, and without it there is nothing left to clear anything from. */
const MAP_CACHES = ["pota-tiles", "pota-raster", "pota-data"];

/** Readable rather than exact - nobody needs the byte. */
function humanSize(bytes) {
  const mb = (bytes || 0) / 1048576;
  if (mb < 1) return "< 1 MB";
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

async function showStorageSize() {
  const line = el("storage-size");
  if (!line) return;
  if (!navigator.storage || !navigator.storage.estimate) {
    line.textContent = t("storage.unknown");
    return;
  }
  try {
    const { usage } = await navigator.storage.estimate();
    line.textContent = t("storage.size", { size: humanSize(usage) });
  } catch (err) {
    line.textContent = t("storage.unknown");
  }
}

function startStorage() {
  const button = el("storage-btn");
  if (!button) return;
  if (!window.caches) {
    button.disabled = true;
    el("storage-size").textContent = t("storage.unknown");
    return;
  }
  showStorageSize();

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = t("storage.clearing");
    try {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => MAP_CACHES.some((prefix) => n.startsWith(prefix)))
          .map((n) => caches.delete(n)),
      );
    } catch (err) {
      console.warn("storage:", err);
    }
    // MapLibre keeps its own copies in memory, so emptying the stores alone
    // would not fetch a single tile again. The position is in the hash: the
    // map comes back where it was, with everything freshly loaded.
    location.reload();
  });
}

/* ------------------------------------------------------------------- Start */

map.on("load", async () => {
  loadHunted();
  applyLanguage();
  showHuntedState();
  refreshParkPaint();
  await loadBasics();
  if (state.call) {
    callInput.value = state.call;
    loadOwn(state.call);
  }

  const focus = (params.get("p") || "").toUpperCase();
  if (focus) {
    const list = await ensureIndex();
    const park = list.find((p) => p.r === focus);
    if (park) map.flyTo({ center: [park.x, park.y], zoom: 12 });
  }

  scheduleLabels();
  loadOverlaps();
  loadSpots();
  setInterval(loadSpots, 60000);
  startPrefetch();
  startOffline();
  startStorage();
  // The report panel is optional and most installations will not have it, so
  // ask the server first and only then fetch the module. It is built as its
  // own file; the hashed name is in a meta tag, which keeps this out of the
  // main bundle without giving up long-term caching.
  fetch("/api/health")
    .then((r) => (r.ok ? r.json() : {}))
    .then((d) => {
      const src = document.querySelector('meta[name="reports-src"]');
      if (!d.reports || !src) return null;
      return import(src.content);
    })
    .then((mod) => { if (mod) mod.startReporting(map, t); })
    .catch(() => { /* no reporting here, the button stays hidden */ });
  tracking = startTracking({ map, maplibregl, parksAtPoint, el, esc, t });

  // Every position question needs the bounding boxes. Fetching 140 KB while
  // idle beats making someone wait on their first tap of the locate button -
  // outdoors that is exactly the moment that counts.
  map.once("idle", () => {
    if (window.requestIdleCallback) requestIdleCallback(() => ensureBbox(), { timeout: 8000 });
    else setTimeout(ensureBbox, 3000);
  });

  // Do not load the search index on the critical path, but not only when
  // someone starts typing either: fetch it quietly once the map is idle.
  map.once("idle", () => {
    if (window.requestIdleCallback) {
      requestIdleCallback(() => ensureIndex(), { timeout: 4000 });
    } else {
      setTimeout(ensureIndex, 1500);
    }
  });
});

map.on("error", (e) => console.warn("map:", (e.error && e.error.message) || e));
