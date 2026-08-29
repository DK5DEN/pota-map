/**
 * Live tracking: the map follows the position, and entering or leaving a park
 * raises a notification.
 *
 * The point of it is outdoors: you park the car, walk off and want to know
 * from where on you are inside. Staring at the screen while doing that is
 * awkward, hence a notification plus a short vibration instead of a readout
 * you have to go looking for.
 *
 * Two things cost battery and are therefore announced beforehand and released
 * again: the continuous positioning (`watchPosition`) and the screen wake
 * lock.
 */



export function startTracking({ map, maplibregl, parksAtPoint, el, esc, t }) {
  const toggle = el("opt-track");
  const hint = el("track-hint");
  const box = el("position-box");
  if (!toggle) return null;

  let watchId = null;
  let wakeLock = null;
  let following = true;
  let previous = new Set();
  let marker = null;
  let running = false;

  const setHint = (text) => { if (hint) hint.textContent = text; };

  setHint(t("track.off"));

  function notify(text) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(t("app.name"), { body: text, tag: "pota-park" });
      }
    } catch (err) { /* some browsers refuse this outside a user gesture */ }
    try {
      if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    } catch (err) { /* not important */ }
  }

  async function takeWakeLock() {
    try {
      if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) { wakeLock = null; }
  }

  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (err) { /* never mind */ }
    wakeLock = null;
  }

  // The wake lock is lost as soon as the tab goes to the background. When it
  // comes back, it has to be requested again.
  document.addEventListener("visibilitychange", () => {
    if (running && document.visibilityState === "visible" && !wakeLock) takeWakeLock();
  });

  // Whoever drags the map wants to look at something - then the following
  // stops until they press the button. A map that pulls back against the
  // user\'s hand is the most annoying thing a map can do.
  map.on("dragstart", () => {
    if (running && following) {
      following = false;
      showRecenter(true);
    }
  });

  let recenterButton = null;

  function showRecenter(enable) {
    if (!recenterButton) {
      recenterButton = document.createElement("button");
      recenterButton.id = "track-recenter";
      recenterButton.type = "button";
      recenterButton.textContent = t("position.recenter");
      recenterButton.addEventListener("click", () => {
        following = true;
        showRecenter(false);
        if (marker) map.easeTo({ center: marker.getLngLat(), duration: 400 });
      });
      document.body.appendChild(recenterButton);
    }
    recenterButton.hidden = !enable;
  }

  function setMarker(lat, lon) {
    if (!marker) {
      const dot = document.createElement("div");
      dot.className = "track-dot";
      marker = new maplibregl.Marker({ element: dot });
    }
    marker.setLngLat([lon, lat]).addTo(map);
  }

  async function onPosition(pos) {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    setMarker(lat, lon);
    if (following) map.easeTo({ center: [lon, lat], duration: 600 });

    const inside = await parksAtPoint(lat, lon);
    const now = new Set(inside.map((p) => p.ref));

    for (const p of inside) {
      if (!previous.has(p.ref)) notify(t("track.enter", { ref: p.ref, name: p.name || "" }));
    }
    for (const ref of previous) {
      if (!now.has(ref)) notify(t("track.leave", { ref }));
    }
    previous = now;

    const exact = accuracy ? " (±" + Math.round(accuracy) + " m)" : "";
    if (!inside.length) {
      box.innerHTML = t("track.none") + esc(exact);
    } else {
      box.innerHTML = t("track.here") + inside
        .slice(0, 4)
        .map((p) => "<b>" + esc(p.ref) + "</b> " + esc(p.name || ""))
        .join(" · ") + esc(exact);
      const nearest = inside[0];
      if (Number.isFinite(nearest.edge)) {
        const d = nearest.edge;
        box.innerHTML += '<div class="edge-info">' + esc(t("position.toEdge", {
          ref: nearest.ref,
          distance: d < 1000 ? Math.round(d) + " m" : (d / 1000).toFixed(1) + " km",
        })) + "</div>";
      }
    }
    box.hidden = false;
  }

  async function enable() {
    if (!navigator.geolocation) {
      setHint(t("track.unsupported"));
      toggle.checked = false;
      return;
    }
    try {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch (err) { /* permission refused, then the readout has to do */ }

    running = true;
    following = true;
    previous = new Set();
    await takeWakeLock();
    watchId = navigator.geolocation.watchPosition(
      (pos) => { onPosition(pos).catch(() => {}); },
      (err) => {
        setHint(t("track.failed", { reason: err.message }));
        disable();
        toggle.checked = false;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    setHint(t("track.on"));
  }

  function disable() {
    running = false;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    releaseWakeLock();
    showRecenter(false);
    if (marker) marker.remove();
    previous = new Set();
    setHint(t("track.off"));
  }

  toggle.addEventListener("change", () => {
    if (toggle.checked) enable();
    else disable();
  });

  return { enable, disable, running: () => running };
}
