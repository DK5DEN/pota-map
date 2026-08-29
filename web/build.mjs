import { build } from "esbuild";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

mkdirSync("dist", { recursive: true });

/**
 * File names carry a content hash. Without one you would have to choose
 * between "cache for a long time" and "changes actually arrive" - with one you
 * get both: the files are immutable, and a new build has a new name. The
 * index.html itself is never cached.
 */
const js = await build({
  entryPoints: { app: "src/main.js", reports: "src/reports.js" },
  bundle: true,
  minify: true,
  format: "esm",
  target: ["es2020"],
  outdir: "dist",
  entryNames: "[name]-[hash]",
  metafile: true,
  loader: { ".css": "css" },
  // MapLibre 6 loads its worker and shared chunk as separate files at
  // runtime; bundling them would lose those.
  external: ["/vendor/*"],
});

const css = await build({
  entryPoints: {
    style: "src/style.css",
    "maplibre-gl": "node_modules/maplibre-gl/dist/maplibre-gl.css",
  },
  bundle: true,
  minify: true,
  outdir: "dist",
  entryNames: "[name]-[hash]",
  metafile: true,
});

/** Build a source name -> output name mapping from the esbuild metafile. */
function mapping(...results) {
  const out = {};
  for (const r of results) {
    for (const [path, info] of Object.entries(r.metafile.outputs)) {
      const built = basename(path);                       // app-BQ4TZ7.js
      const source = Object.keys(info.inputs || {})[0]; // src/main.js
      const plain = built.replace(/-[A-Z0-9]{8}(\.\w+)$/, "$1");
      out[plain] = built;
      if (source) out[basename(source)] = built;
    }
  }
  return out;
}

const names = mapping(js, css);

mkdirSync("dist/vendor", { recursive: true });
for (const f of readdirSync("node_modules/maplibre-gl/dist")) {
  if (f.endsWith(".mjs")) cpSync(`node_modules/maplibre-gl/dist/${f}`, `dist/vendor/${f}`);
}

let html = readFileSync("index.html", "utf8");
for (const [plain, built] of Object.entries(names)) {
  if (plain === built) continue;
  html = html.replaceAll(`/${plain}`, `/${built}`);
}
writeFileSync("dist/index.html", html);

// The service worker keeps a fixed name - it is versioned through its
// contents, not through its file name.
cpSync("sw.js", "dist/sw.js");

console.log("built:", Object.entries(names)
  .filter(([r, a]) => r !== a)
  .map(([r, a]) => `${r} -> ${a}`)
  .join(", "));
