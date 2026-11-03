/* POTA map on afu.tools, mockup. Leaflet on the site's own tile proxy, real
   park areas around the Hassberge from the pipeline output, everything else
   (spots, activations, places, POIs) made up on the spot so the page shows
   what each control does. Nothing here talks to a server. */
(function () {
  "use strict";
  const D = window.POTA_DATEN;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // ---------------------------------------------------------------- state
  const st = {
    progs: new Set(["DE"]),
    spots: true, sota: true, never: true, points: true, plans: true, nfer: false,
    base: "osm", call: "", mine: new Set(), hideMine: false,
    hunted: new Set(), hideHunted: false, pois: new Set(), tracking: false,
  };
  const NEVER = new Set(["DE-1263"]);                 // never activated (fake)
  const MINE_BY_CALL = { DL1ABC: ["DE-0032", "DE-1130", "DE-0589"] };
  const PLANS = [
    { ref: "DE-1161", when: "Sa 27.09. 09:00 UTC", call: "DL4ABC" },
    { ref: "DE-1130", when: "So 28.09. 07:30 UTC", call: "DL8XYZ" },
  ];
  const now = Date.now();
  const SPOTS = [
    { call: "DL2ABC", freq: 14.062, mode: "CW", ref: "DE-0581", age: 3, by: "DK9XYZ" },
    { call: "DL7XYZ", freq: 7.155, mode: "SSB", ref: "DE-0032", age: 7, by: "DL7XYZ" },
    { call: "OE5ABC/P", freq: 14.074, mode: "FT8", ref: "DE-1160", age: 12, by: "RBN" },
    { call: "DL1QRZ", freq: 145.5, mode: "FM", ref: "DE-0589", age: 22, by: "DL1QRZ", qrt: true },
    { call: "DL3ABC", freq: 10.118, mode: "CW", ref: "DE-1158", age: 41, by: "DL3ABC" },
    { call: "DL5XYZ", freq: 7.032, mode: "CW", ref: "DE-0160", age: 58, by: "DM1XYZ" },
  ];
  const PLACES = {
    "DE-0032": [
      { ll: [50.112, 10.640], pts: 82, ele: 471, dir: 4, park: 180, qrm: 2100 },
      { ll: [50.098, 10.625], pts: 74, ele: 455, dir: 6, park: 320, qrm: 1400 },
      { ll: [50.121, 10.662], pts: 61, ele: 438, dir: 2, park: 90, qrm: 900 },
    ],
  };
  const POIS = [
    { g: "access", k: "Parkplatz", ll: [50.1105, 10.6285] },
    { g: "access", k: "Haltestelle", ll: [50.1023, 10.6421] },
    { g: "comfort", k: "Schutzhütte", ll: [50.1132, 10.6362] },
    { g: "comfort", k: "Bank", ll: [50.1090, 10.6340] },
    { g: "supply", k: "Einkehr", ll: [50.1050, 10.6180] },
    { g: "view", k: "Aussichtsturm", ll: [50.1083, 10.6348] },
    { g: "orientation", k: "Wegweiser", ll: [50.1120, 10.6420] },
    { g: "target", k: "Burg oder Ruine", ll: [50.0930, 10.6510] },
    { g: "qrm", k: "Hochspannungsleitung", ll: [[50.090, 10.600], [50.130, 10.700]] },
  ];
  const POI_COL = { access: "#0369a1", comfort: "#15803d", supply: "#b45309", view: "#7c3aed", orientation: "#0f766e", target: "#be123c", qrm: "#dc2626" };
  const BASE_HINT = {
    osm: "Die Standardkarte von OpenStreetMap, mit Wegen, Gebäuden und Flurnamen. Braucht Netz. Wer offline unterwegs ist, nimmt „Dunkel“: das ist unsere eigene Karte, die sich sichern lässt.",
    pastel: "Unsere eigene Karte in gedeckten Farben, mit Feld- und Waldwegen. Braucht kein Netz und lässt sich für unterwegs sichern. Reicht von Frankreich bis Polen und von den Alpen bis zur Ostsee.",
    dark: "Unsere eigene Karte, dunkel. Das ist die Karte, die „Diesen Ausschnitt offline sichern“ auf dem Gerät ablegt.",
    topo: "Wanderwege, Waldwege und Höhenlinien von OpenTopoMap. Braucht Netz. Wer offline unterwegs ist, nimmt „Dunkel“.",
  };
  const parkByRef = {};
  D.parks.forEach((f) => { parkByRef[f.properties.ref] = f; });
  const pointByRef = {};
  D.points.forEach((f) => { pointByRef[f.properties.ref] = f; });

  // ------------------------------------------------------------------ map
  const map = L.map("karte", { zoomControl: false, attributionControl: true });
  map.attributionControl.setPrefix("");
  map.setView([50.12, 10.62], 10);

  const bases = {
    osm: L.tileLayer("https://afu.tools/kacheln/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap · Flächen: pota-map.info (DK5UR), MIT" }),
    pastel: L.tileLayer("https://afu.tools/kacheln/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© Protomaps, OpenStreetMap · Flächen: pota-map.info (DK5UR), MIT" }),
    dark: L.tileLayer("https://afu.tools/kacheln/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© Protomaps, OpenStreetMap · Flächen: pota-map.info (DK5UR), MIT" }),
    topo: L.tileLayer("https://a.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, attribution: "© OpenTopoMap (CC-BY-SA), OpenStreetMap · Flächen: pota-map.info (DK5UR), MIT" }),
  };
  bases.osm.addTo(map);

  const layers = {
    parks: L.geoJSON(null, { style: parkStyle, onEachFeature: parkFeature }).addTo(map),
    trails: L.geoJSON(null, { style: { color: "#1d4ed8", weight: 2, opacity: 0.7 } }).addTo(map),
    points: L.layerGroup().addTo(map),
    sota: L.layerGroup().addTo(map),
    spots: L.layerGroup().addTo(map),
    plans: L.layerGroup().addTo(map),
    pois: L.layerGroup().addTo(map),
    me: L.layerGroup().addTo(map),
  };

  function parkColour(ref) {
    if (st.mine.has(ref)) return $("#callfarbe").value;
    if (st.hunted.has(ref)) return "#0d9488";
    if (st.never && NEVER.has(ref)) return "#9333ea";
    return "#e02424";
  }
  function parkStyle(f) {
    const c = parkColour(f.properties.ref);
    return { color: c, weight: 2, opacity: 0.9, fillColor: c, fillOpacity: 0.18 };
  }
  function parkVisible(p) {
    if (!st.progs.has(p.prog)) return false;
    if (st.nfer && !p.nfer) return false;
    if (st.hideMine && st.mine.has(p.ref)) return false;
    if (st.hideHunted && st.hunted.has(p.ref)) return false;
    return true;
  }
  function parkFeature(f, layer) {
    layer.on("click", () => openPark(f.properties.ref, layer));
    layer.on("mouseover", () => layer.setStyle({ weight: 3.5, fillOpacity: 0.3 }));
    layer.on("mouseout", () => layer.setStyle(parkStyle(f)));
  }

  const fmtN = (n) => n.toLocaleString("de-DE");
  const DIRS = ["Norden", "Nordosten", "Osten", "Südosten", "Süden", "Südwesten", "Westen", "Nordwesten"];
  function parkPopup(ref) {
    const p = (parkByRef[ref] || pointByRef[ref]).properties;
    const hasArea = !!parkByRef[ref];
    const nfer = p.nfer ? `<p class="nfer">Hier zählt auch: <a href="#" data-ref="${ref === "DE-0032" ? "DE-0581" : "DE-0032"}">${ref === "DE-0032" ? "DE-0581" : "DE-0032"}</a>${p.nfer > 1 ? ` und ${p.nfer - 1} weitere` : ""}</p>` : "";
    const acts = 40 + (ref.charCodeAt(5) * 7) % 300;
    const places = PLACES[ref];
    const placesHtml = places ? `
      <details>
        <summary>Beste Plätze im Park (${places.length})</summary>
        <ul class="plaetze">${places.map((pl, i) => `
          <li><span class="punkte">${pl.pts}</span> ${pl.ele} m hoch, frei nach ${DIRS[pl.dir]}, ${pl.park} m zum Parkplatz, ${pl.qrm >= 1000 ? (pl.qrm / 1000).toLocaleString("de-DE") + " km" : pl.qrm + " m"} zur nächsten Störquelle<br>
            <a class="btn-sm" href="https://www.google.com/maps/dir/?api=1&destination=${pl.ll[0]},${pl.ll[1]}" target="_blank" rel="noopener">Route zu diesem Platz</a></li>`).join("")}
        </ul>
        <p class="plaetze-hint">Punkte aus Prominenz, Ruhe, Horizont, Ausstattung und Zugang. Im Wald misst das Modell teils die Baumkronen, und ob du dort aufbauen darfst, sagt es nicht.</p>
      </details>` : "";
    return `<div class="pota-popup">
      <h4><span class="ref">${ref}</span> ${p.name}</h4>
      <p class="quelle">${hasArea ? "Fläche von pota-map.info" : "nur Punkt, keine Fläche hinterlegt"}</p>
      <p class="zahlen">${fmtN(acts)} Aktivierungen · ${fmtN(acts * 31)} QSOs · zuerst DL1ABC am 12.03.2021</p>
      ${nfer}
      <div class="knoepfe">
        <a class="btn-sm" href="https://pota.app/#/park/${ref}" target="_blank" rel="noopener">bei POTA öffnen</a>
        <a class="btn-sm" href="#" onclick="return false">Route</a>
        ${hasArea ? `<a class="btn-sm" href="#" onclick="return false">GeoJSON</a><a class="btn-sm" href="#" onclick="return false">GPX</a>` : ""}
        <a class="btn-sm" href="#" onclick="return false">Park-Website</a>
        <button class="btn-sm" type="button" data-hunt="${ref}" aria-pressed="${st.hunted.has(ref)}">${st.hunted.has(ref) ? "gilt als gejagt" : "als gejagt merken"}</button>
      </div>
      ${placesHtml}
    </div>`;
  }
  function openPark(ref, layer) {
    const target = layer || layers.parks.getLayers().find((l) => l.feature.properties.ref === ref);
    const at = target ? target.getBounds().getCenter() : null;
    const ll = at || L.latLng(pointByRef[ref].geometry.coordinates[1], pointByRef[ref].geometry.coordinates[0]);
    const pop = L.popup({ maxWidth: 360, autoPanPaddingTopLeft: [12, 64], autoPanPaddingBottomRight: [12, 72] }).setLatLng(ll).setContent(parkPopup(ref)).openOn(map);
    const el = pop.getElement();
    $$("[data-hunt]", el).forEach((b) => b.addEventListener("click", () => { toggleHunted(b.dataset.hunt); pop.setContent(parkPopup(ref)); }));
    $$("[data-ref]", el).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); flyTo(a.dataset.ref); }));
  }
  function flyTo(ref) {
    const l = layers.parks.getLayers().find((x) => x.feature.properties.ref === ref);
    if (l) { map.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 13 }); setTimeout(() => openPark(ref, l), 350); return; }
    const p = pointByRef[ref]; if (!p) return;
    map.setView([p.geometry.coordinates[1], p.geometry.coordinates[0]], 12);
    setTimeout(() => openPark(ref), 350);
  }

  function drawParks() {
    layers.parks.clearLayers();
    layers.points.clearLayers();
    layers.trails.clearLayers();
    D.parks.filter((f) => parkVisible(f.properties)).forEach((f) => layers.parks.addData(f));
    D.trails.filter((f) => parkVisible(f.properties)).forEach((f) => layers.trails.addData(f));
    if (st.points) D.points.filter((f) => !parkByRef[f.properties.ref] && parkVisible(f.properties)).forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      L.marker([lat, lon], { icon: L.divIcon({ className: "pota-punkt", iconSize: [10, 10] }) })
        .bindTooltip(`${f.properties.ref} ${f.properties.name}`).on("click", () => openPark(f.properties.ref)).addTo(layers.points);
    });
  }
  const SOTA_COL = { 1: "#4d7c0f", 2: "#4d7c0f", 4: "#6DA536", 6: "#ca8a04", 8: "#ea580c", 10: "#dc2626" };
  function drawSota() {
    layers.sota.clearLayers();
    if (!st.sota) return;
    D.sota.filter((f) => st.progs.has(f.properties.prog)).forEach((f) => {
      const p = f.properties; const [lon, lat] = f.geometry.coordinates;
      L.marker([lat, lon], { icon: L.divIcon({ className: "pota-sota", iconSize: [14, 13], html: `<span style="--c:${SOTA_COL[p.pts] || "#6DA536"}"></span>` }) })
        .bindTooltip(`${p.ref} ${p.name}: ${p.alt} m, ${p.pts} Punkte`)
        .bindPopup(`<div class="pota-popup"><h4><span class="ref">${p.ref}</span> ${p.name}</h4><p class="zahlen">${p.alt} m - ${p.pts} Punkte - ${p.acts} Aktivierungen</p><div class="knoepfe"><a class="btn-sm" href="https://sotl.as/summits/${p.ref}" target="_blank" rel="noopener">bei SOTLAS öffnen</a><a class="btn-sm" href="#" onclick="return false">Route</a></div></div>`)
        .addTo(layers.sota);
    });
  }
  function spotLL(s) {
    const l = D.parks.find((f) => f.properties.ref === s.ref);
    if (!l) return null;
    const b = L.geoJSON(l).getBounds().getCenter();
    return [b.lat + 0.004, b.lng + 0.004];
  }
  function drawSpots() {
    layers.spots.clearLayers();
    if (!st.spots) return;
    spotsFiltered().forEach((s) => {
      const ll = spotLL(s); if (!ll) return;
      L.marker(ll, { icon: L.divIcon({ className: "pota-spot" + (s.age < 15 ? " puls" : ""), iconSize: [12, 12] }), zIndexOffset: 500 })
        .bindTooltip(`${s.call} auf ${s.freq.toFixed(3)} ${s.mode} in ${s.ref}`)
        .bindPopup(`<div class="pota-popup"><h4>Live-Spot</h4><p><strong>${s.call}</strong> auf ${s.freq.toFixed(3)} ${s.mode}</p><p class="zahlen">${s.ref} - gespottet von ${s.by}, vor ${s.age} min</p></div>`)
        .addTo(layers.spots);
    });
  }
  /* Angekündigte Aktivierungen sehen aus wie Live-Spots, nur in einer
     anderen Farbe: gleiche Form, gleiche Größe. Wer die Karte liest, sieht
     damit sofort "da ist jemand" gegen "da kommt jemand", ohne dass ein
     zweiter Zeichensatz dazukommt. Den Puls bekommen sie nicht, der gehört
     dem, was gerade läuft. */
  function drawPlans() {
    layers.plans.clearLayers();
    if (!st.plans) return;
    PLANS.forEach((p) => {
      const ll = spotLL({ ref: p.ref }); if (!ll) return;
      const name = (parkByRef[p.ref] || pointByRef[p.ref] || { properties: { name: "" } }).properties.name;
      L.marker([ll[0] - 0.012, ll[1] - 0.012], { icon: L.divIcon({ className: "pota-spot geplant", iconSize: [12, 12] }), zIndexOffset: 400 })
        .bindTooltip(`${p.call} angekündigt in ${p.ref}, ${p.when}`)
        .bindPopup(`<div class="pota-popup"><h4>Angekündigte Aktivierung</h4><p><strong>${p.call}</strong> am ${p.when}</p><p class="zahlen">${p.ref} ${name}</p></div>`)
        .addTo(layers.plans);
    });
  }
  function drawPois() {
    layers.pois.clearLayers();
    $("#legende-pois").hidden = st.pois.size === 0;
    POIS.filter((p) => st.pois.has(p.g)).forEach((p) => {
      if (p.g === "qrm") { L.polyline(p.ll, { color: POI_COL.qrm, weight: 3, dashArray: "6 4" }).bindTooltip(p.k + " (aus OpenStreetMap)").addTo(layers.pois); return; }
      L.marker(p.ll, { icon: L.divIcon({ className: "pota-poi", html: `<span style="--c:${POI_COL[p.g]}"></span>`, iconSize: [9, 9] }) }).bindTooltip(p.k + " (aus OpenStreetMap)").addTo(layers.pois);
    });
  }
  function drawAll() { drawParks(); drawSota(); drawSpots(); drawPlans(); drawPois(); }

  // ---------------------------------------------------------------- spots
  function band(f) {
    if (f < 2.1) return "160m"; if (f < 4) return "80m"; if (f < 5.5) return "60m"; if (f < 7.3) return "40m";
    if (f < 10.2) return "30m"; if (f < 14.4) return "20m"; if (f < 18.2) return "17m"; if (f < 21.5) return "15m";
    if (f < 25) return "12m"; if (f < 30) return "10m"; if (f < 55) return "6m"; if (f < 150) return "2m"; return "70cm";
  }
  const isDigi = (m) => /FT8|FT4|JS8|PSK|RTTY|DIGI/.test(m);
  function spotsFiltered() {
    const bands = new Set($$("#spot-band input:checked").map((i) => i.value));
    const mode = $("#spot-mode").value;
    let list = SPOTS.filter((s) => st.progs.has(s.ref.slice(0, 2)));
    if (bands.size) list = list.filter((s) => bands.has(band(s.freq)));
    if (mode === "CW") list = list.filter((s) => s.mode === "CW");
    if (mode === "SSB") list = list.filter((s) => /SSB|FM|AM/.test(s.mode));
    if (mode === "DIGI") list = list.filter((s) => isDigi(s.mode));
    if ($("#spot-fresh").checked) list = list.filter((s) => s.age <= 15);
    if ($("#spot-qrt").checked) list = list.filter((s) => !s.qrt);
    if ($("#spot-hunted").checked) list = list.filter((s) => !st.hunted.has(s.ref));
    list.sort($("#spot-sort").value === "freq" ? (a, b) => a.freq - b.freq : (a, b) => a.age - b.age);
    return list;
  }
  function renderSpots() {
    const list = spotsFiltered();
    const ol = $("#spotliste");
    $("#spot-zaehler").textContent = SPOTS.length;
    $("#spot-stand").textContent = list.length === SPOTS.length ? `${SPOTS.length} Spots` : `${list.length} von ${SPOTS.length} Spots`;
    const bands = $$("#spot-band input:checked").length;
    $("#spot-band summary").textContent = bands ? `${bands} Bänder` : "alle Bänder";
    ol.innerHTML = list.length ? "" : `<li class="field-hint">${SPOTS.length ? "kein Spot passt zum Filter" : "gerade niemand auf Sendung"}</li>`;
    list.forEach((s) => {
      const name = (parkByRef[s.ref] || pointByRef[s.ref] || { properties: { name: "" } }).properties.name;
      const li = document.createElement("li");
      li.className = s.qrt ? "qrt" : "";
      li.innerHTML = `<div><span class="rufz">${s.call}</span> <span class="freq">${s.freq.toFixed(3)} ${s.mode}</span>${s.qrt ? '<span class="qrt-mark">QRT</span>' : ""}</div>
        <button class="plus" type="button" aria-pressed="${st.hunted.has(s.ref)}" title="${st.hunted.has(s.ref) ? "gilt als gejagt" : "als gejagt merken"}">${st.hunted.has(s.ref) ? "✓" : "+"}</button>
        <span class="park">${s.ref} ${name}</span>
        <span class="alter">vor ${s.age} min · von ${s.by}</span>`;
      li.addEventListener("click", () => flyTo(s.ref));
      $(".plus", li).addEventListener("click", (e) => { e.stopPropagation(); toggleHunted(s.ref); });
      ol.appendChild(li);
    });
  }
  function toggleHunted(ref) {
    if (st.hunted.has(ref)) st.hunted.delete(ref); else st.hunted.add(ref);
    huntedChanged();
  }
  function huntedChanged() {
    $("#hunted-clear").hidden = st.hunted.size === 0;
    $("#hunted-hint").textContent = st.hunted.size
      ? `${st.hunted.size} gejagte Parks, davon ${[...st.hunted].filter((r) => parkByRef[r]).length} auf dieser Karte. Stand ${new Date().toLocaleDateString("de-DE")}.`
      : "Noch nichts geladen. Die Datei holst du dir bei pota.app unter „My Stats“ als hunter_parks.csv. Sie bleibt im Browser, nichts davon geht zu uns.";
    drawAll(); renderSpots();
  }

  // ------------------------------------------------------------ controls
  const panel = $("#panel");
  function zeige(tab) {
    $$(".pota-tab").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === tab));
    $$(".pota-seite").forEach((s) => { s.hidden = s.dataset.tab !== tab; });
    $(".pota-panel-inhalt").scrollTop = 0;
  }
  /* Schmal ist das Panel ein Blatt über der Karte, aufgemacht mit dem
     Zahnrad neben der Suche. Breit steht es ohnehin daneben. */
  function blatt(auf) {
    panel.toggleAttribute("data-offen", auf);
    $("#knopf-panel").setAttribute("aria-expanded", String(auf));
  }
  $$(".pota-tab").forEach((b) => b.addEventListener("click", () => zeige(b.dataset.tab)));
  $("#knopf-panel").addEventListener("click", () => blatt(!panel.hasAttribute("data-offen")));
  $("#panel-zu").addEventListener("click", () => blatt(false));
  map.on("click", () => blatt(false));
  zeige("karte");

  $$("#programme input").forEach((i) => i.addEventListener("change", () => { i.checked ? st.progs.add(i.dataset.prog) : st.progs.delete(i.dataset.prog); drawAll(); renderSpots(); }));
  const bind = (id, key, after) => $(id).addEventListener("change", (e) => { st[key] = e.target.checked; (after || drawAll)(); });
  bind("#opt-spots", "spots", () => drawSpots());
  bind("#opt-sota", "sota", () => { drawSota(); $("#sota-hint").hidden = !st.sota; });
  bind("#opt-never", "never"); bind("#opt-points", "points"); bind("#opt-plans", "plans", () => drawPlans());
  bind("#opt-nfer", "nfer"); bind("#opt-todo", "hideMine"); bind("#opt-hide-hunted", "hideHunted");

  $$("#basiskarten button").forEach((b) => b.addEventListener("click", () => {
    $$("#basiskarten button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    map.removeLayer(bases[st.base]); st.base = b.dataset.base; bases[st.base].addTo(map);
    $("#karte-rahmen").dataset.base = st.base; $("#base-hint").textContent = BASE_HINT[st.base];
  }));
  $$("#schaerfe button").forEach((b) => b.addEventListener("click", () => $$("#schaerfe button").forEach((x) => x.setAttribute("aria-pressed", x === b))));
  $("#saettigung").addEventListener("input", (e) => { $("#saettigung-wert").textContent = `${e.target.value} %`; $("#karte-rahmen").style.setProperty("--sat", e.target.value / 100); });
  $("#poi-zoom").addEventListener("input", (e) => { $("#poi-zoom-wert").textContent = `Zoom ${e.target.value}`; });
  $("#poi-size").addEventListener("input", (e) => { $("#poi-size-wert").textContent = `${e.target.value} %`; });
  $$("[data-poi]").forEach((i) => i.addEventListener("change", () => { i.checked ? st.pois.add(i.dataset.poi) : st.pois.delete(i.dataset.poi); drawPois(); }));

  $$("#spot-band input, #spot-mode, #spot-sort, #spot-fresh, #spot-qrt, #spot-hunted").forEach((el) => el.addEventListener("change", () => { renderSpots(); drawSpots(); }));
  document.addEventListener("click", (e) => { const d = $("#spot-band"); if (d.open && !d.contains(e.target)) d.open = false; });

  // callsign: fake lookup, one call has activations
  $("#call").addEventListener("input", (e) => {
    const c = e.target.value.trim().toUpperCase(); st.call = c;
    st.mine = new Set(MINE_BY_CALL[c] || []);
    $("#call-hint").innerHTML = !c ? 'Färbt die Parks ein, die du schon aktiviert hast. <a href="#" id="call-anmelden">Anmelden</a>, dann kommt es aus deinem Konto.'
      : c.length < 3 ? "wird geladen …"
      : st.mine.size ? `${st.mine.size} Parks von ${c} aktiviert.` : `Für ${c} sind keine Aktivierungen verzeichnet.`;
    drawParks();
  });
  $$("#callfarbe, #callfarbe-konto").forEach((el) => el.addEventListener("input", (e) => {
    $$("#callfarbe, #callfarbe-konto").forEach((x) => { x.value = e.target.value; });
    $("#legende-eigen").style.setProperty("--c", e.target.value); drawParks();
  }));

  /* Konto. Angemeldet kommt das Rufzeichen aus den Einstellungen des Nutzers,
     abgemeldet tippt man es in die Karte. Hier ist beides nachgestellt, ein
     Klick auf den Knopf schaltet um; echt wäre es eine Sitzung am Server. */
  const KONTO = { call: "DL1ABC", hunted: ["DE-1160", "DE-0512"] };
  let angemeldet = false, dateiGeladen = false;
  function kontoZeigen() {
    const k = $("#konto-knopf");
    k.toggleAttribute("data-an", angemeldet);
    k.setAttribute("aria-label", angemeldet ? `Konto ${KONTO.call}` : "Anmelden");
    $("#konto-text").textContent = angemeldet ? KONTO.call : "Anmelden";
    $("#konto-call").textContent = KONTO.call;
    $("#konto-call-anzeige").textContent = KONTO.call;
    $("#konto-zeile").hidden = !angemeldet;
    $("#call-zeile").hidden = angemeldet;
    $("#hunted-konto").hidden = !angemeldet;
    $("#hunted-konto").textContent = `${KONTO.hunted.length} gejagte Parks aus deinem Konto, auf jedem Gerät dieselben. Eine geladene Datei ergänzt sie.`;
    /* Angemeldet steht die Liste schon da, der Satz über die Datei wäre dann
       eine Aufforderung zu etwas, das keiner mehr braucht. */
    $("#hunted-hint").hidden = angemeldet && !dateiGeladen;
    if (angemeldet) {
      st.call = KONTO.call;
      st.mine = new Set(MINE_BY_CALL[KONTO.call] || []);
      $("#call-hint").textContent = `${st.mine.size} Parks von ${KONTO.call} aktiviert. Zum Ändern in die Einstellungen deines Kontos.`;
    } else {
      st.call = $("#call").value.trim().toUpperCase();
      st.mine = new Set(MINE_BY_CALL[st.call] || []);
      $("#call-hint").innerHTML = 'Färbt die Parks ein, die du schon aktiviert hast. <a href="#" id="call-anmelden">Anmelden</a>, dann kommt es aus deinem Konto.';
    }
    drawParks();
  }
  function anmelden() {
    angemeldet = true;
    KONTO.hunted.forEach((r) => st.hunted.add(r));
    kontoZeigen(); huntedChanged();
  }
  $("#konto-knopf").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!angemeldet) { anmelden(); return; }          // real: off to the login page
    const m = $("#konto-menu"); m.hidden = !m.hidden;
    $("#konto-knopf").setAttribute("aria-expanded", String(!m.hidden));
  });
  $("#konto-abmelden").addEventListener("click", () => {
    angemeldet = false; $("#konto-menu").hidden = true;
    $("#konto-knopf").setAttribute("aria-expanded", "false");
    KONTO.hunted.forEach((r) => st.hunted.delete(r));
    kontoZeigen(); huntedChanged();
  });
  document.addEventListener("click", (e) => {
    if (!$("#konto-menu").hidden && !e.target.closest("#konto-menu, #konto-knopf")) {
      $("#konto-menu").hidden = true; $("#konto-knopf").setAttribute("aria-expanded", "false");
    }
    const a = e.target.closest("#call-anmelden");
    if (a) { e.preventDefault(); anmelden(); }
  });
  kontoZeigen();
  $("#hunted-file").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    $("#hunted-hint").textContent = "wird gelesen …";
    f.text().then((t) => {
      (t.match(/\b[A-Z]{2}-\d{4}\b/g) || []).forEach((r) => st.hunted.add(r));
      dateiGeladen = true; $("#hunted-hint").hidden = false; huntedChanged();
    });
  });
  $("#hunted-clear").addEventListener("click", () => { st.hunted.clear(); huntedChanged(); });

  // position: made up, inside DE-0032 near the Bramberg
  const ME = [50.105, 10.63];
  function showMe() {
    layers.me.clearLayers();
    L.marker(ME, { icon: L.divIcon({ className: "pota-ich", iconSize: [16, 16] }), zIndexOffset: 900 }).addTo(layers.me);
    L.circle(ME, { radius: 35, color: "#2563eb", weight: 1, fillOpacity: 0.12 }).addTo(layers.me);
    const box = $("#position-box");
    box.hidden = false;
    box.innerHTML = `${st.tracking ? "Live: " : "Du stehst in: "}<strong>DE-0032</strong> Hassberge Nature Park · bis zur Grenze von DE-0032: 1,4 km`;
    map.setView(ME, Math.max(map.getZoom(), 13));
    $("#knopf-standort").setAttribute("aria-pressed", "true");
  }
  $("#knopf-plus").addEventListener("click", () => map.zoomIn());
  $("#knopf-minus").addEventListener("click", () => map.zoomOut());
  $("#knopf-standort").addEventListener("click", showMe);
  $("#opt-track").addEventListener("change", (e) => {
    st.tracking = e.target.checked;
    $("#track-hint").textContent = st.tracking ? "Läuft. Die Ortung bleibt an, das kostet Akku. Beim Betreten und Verlassen eines Parks gibt es eine Meldung." : "Aus. Der Standort wird nur auf Knopfdruck geprüft (Knopf auf der Karte).";
    if (st.tracking) showMe(); else { layers.me.clearLayers(); $("#position-box").hidden = true; $("#knopf-standort").removeAttribute("aria-pressed"); }
  });

  $("#knopf-vollbild").addEventListener("click", () => {
    const app = $("#pota-app");
    if (document.fullscreenElement) document.exitFullscreen(); else app.requestFullscreen && app.requestFullscreen();
  });
  document.addEventListener("fullscreenchange", () => setTimeout(() => map.invalidateSize(), 60));

  // offline and storage: pretend
  $("#offline-btn").addEventListener("click", () => {
    const b = $("#offline-btn"), h = $("#offline-hint"); let n = 0; const total = 312; b.disabled = true;
    const t = setInterval(() => { n = Math.min(total, n + 23); h.textContent = `${n} von ${total} gesichert`; if (n >= total) { clearInterval(t); b.disabled = false; h.textContent = `${total} Kacheln gesichert. Der Ausschnitt geht jetzt auch ohne Netz.`; $("#storage-size").textContent = "Auf diesem Gerät belegt: 52,1 MB"; } }, 90);
  });
  $("#storage-btn").addEventListener("click", () => { $("#storage-size").textContent = "wird geleert …"; setTimeout(() => { $("#storage-size").textContent = "Auf diesem Gerät belegt: 0 B"; }, 600); });

  // search over refs, names and locators
  const suche = $("#suche"), treffer = $("#treffer");
  const all = D.parks.map((f) => f.properties).concat(D.points.filter((f) => !parkByRef[f.properties.ref]).map((f) => f.properties)).concat(D.sota.map((f) => f.properties));
  suche.addEventListener("input", () => {
    const q = suche.value.trim().toLowerCase();
    treffer.innerHTML = ""; treffer.hidden = !q;
    if (!q) return;
    if (/^[a-r]{2}\d{2}([a-x]{2})?$/i.test(q)) { treffer.innerHTML = `<li data-loc="${q}"><span class="ref">${q.toUpperCase()}</span><span class="name">Locator-Mittelpunkt</span></li>`; }
    all.filter((p) => p.ref.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 12).forEach((p) => {
      const li = document.createElement("li"); li.innerHTML = `<span class="ref">${p.ref}</span><span class="name">${p.name}</span>`;
      li.addEventListener("click", () => { treffer.hidden = true; suche.value = p.ref; if (p.pts) { map.setView([D.sota.find((f) => f.properties.ref === p.ref).geometry.coordinates[1], D.sota.find((f) => f.properties.ref === p.ref).geometry.coordinates[0]], 13); } else flyTo(p.ref); });
      treffer.appendChild(li);
    });
    if (!treffer.children.length) treffer.hidden = true;
  });
  document.addEventListener("click", (e) => { if (!$("#suche-wrap").contains(e.target)) treffer.hidden = true; });

  // readout: locator under the pointer
  function locator(lat, lon) {
    lon += 180; lat += 90;
    const A = "ABCDEFGHIJKLMNOPQRSTUVWX";
    return A[Math.floor(lon / 20)] + A[Math.floor(lat / 10)] + Math.floor((lon % 20) / 2) + Math.floor(lat % 10)
      + A[Math.floor(((lon % 2) * 60) / 5)].toLowerCase() + A[Math.floor(((lat % 1) * 60) / 2.5)].toLowerCase();
  }
  const readout = (ll) => { $("#locator").textContent = locator(ll.lat, ll.lng); $("#koord").textContent = `${ll.lat.toFixed(4)} N · ${ll.lng.toFixed(4)} E`; };
  map.on("mousemove", (e) => readout(e.latlng));
  map.on("moveend", () => readout(map.getCenter()));
  readout(map.getCenter());

  // loading state dot
  const status = $("#status");
  map.on("dataloading", () => status.classList.add("laden"));
  map.on("dataload", () => status.classList.remove("laden"));
  bases.osm.on("loading", () => status.classList.add("laden"));
  bases.osm.on("load", () => status.classList.remove("laden"));
  window.addEventListener("offline", () => status.classList.add("offline"));
  window.addEventListener("online", () => status.classList.remove("offline"));

  drawAll(); renderSpots();
  // keeps the hash in sync like the old map, so a link carries the view
  map.on("moveend", () => { const c = map.getCenter(); history.replaceState(null, "", `#${map.getZoom()}/${c.lat.toFixed(4)}/${c.lng.toFixed(4)}`); });
  const m = location.hash.match(/^#(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  if (m) map.setView([+m[2], +m[3]], +m[1]);
})();
