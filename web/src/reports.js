/* Reporting: bug, idea or question - and the state of your own reports.
 *
 * The reports do not live here but in an issue tracker. This file talks to our
 * own backend (/api/report, /api/reports); the token stays over there.
 *
 * The map has no accounts. So that a reporter still finds their answer, the
 * browser creates a random id on the first report. It is the only thing
 * protecting someone\'s own reports, so it comes from crypto.getRandomValues
 * and not from Math.random. In the query string it is called `reporter`: as
 * `ref`, content blockers stripped it from the URL as referral tracking and
 * the request arrived without an id - visible only to the people running a
 * blocker.
 *
 * Everything sits in a <dialog>: the map should not have to give up space.
 */

const REPORTER_KEY = "pota-map:reporter";
const KIND_KEYS = { bug: "report.kindBug", feature: "report.kindIdea", question: "report.kindQuestion" };
// The values come from the tracker. Anything added there and missing here is
// shown untranslated instead of not at all.
const STATE_KEYS = {
  new: "report.state.open", seen: "report.state.gelesen",
  in_progress: "report.state.in_progress", ticket: "report.state.eingeplant",
  done: "report.state.erledigt", rejected: "report.state.abgelehnt",
  duplicate: "report.state.duplicate",
};
const IMAGES_MAX = 3;

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const nodes = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") {
      nodes.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === "class") nodes.className = value;
    else nodes.setAttribute(name, value === true ? "" : String(value));
  }
  for (const kind of children.flat()) {
    if (kind === null || kind === undefined || kind === false) continue;
    nodes.append(kind.nodeType ? kind : document.createTextNode(String(kind)));
  }
  return nodes;
}

const time = (iso) => (iso
  ? new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })
  : "");

function reporterId(create = false) {
  let value = null;
  try {
    value = localStorage.getItem(REPORTER_KEY);
    // The key was renamed once. Everything else a visitor stores is set again
    // in two clicks, but this id is the only link to reports already filed -
    // lose it and the answers to them become unreachable.
    if (!value) {
      value = localStorage.getItem("pota-map:melder");
      if (value) {
        localStorage.setItem(REPORTER_KEY, value);
        localStorage.removeItem("pota-map:melder");
      }
    }
  } catch { value = null; }
  if (value || !create) return value;
  const raw = new Uint8Array(16);
  crypto.getRandomValues(raw);
  value = btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_")
    .replace(/=+$/, "");
  try { localStorage.setItem(REPORTER_KEY, value); } catch { /* private mode */ }
  return value;
}

/**
 * A message from the server, in the language of this browser.
 *
 * The backend sends a catalogue key next to an English text. Known keys are
 * translated here, everything else falls back to what the server said - a
 * server that learns a new message must not leave the browser speechless.
 */
function serverMessage(payload, status) {
  const detail = payload && payload.detail;
  if (detail && typeof detail === "object" && detail.key) {
    const text = t(detail.key);
    return text === detail.key ? (detail.text || detail.key) : text;
  }
  if (typeof detail === "string") return detail;
  return (payload && payload.error) || `HTTP ${status}`;
}

async function fetchOne(path, options) {
  const answer = await fetch(path, options);
  const payload = await answer.json().catch(() => ({}));
  if (!answer.ok) throw new Error(serverMessage(payload, answer.status));
  return payload;
}

/** What the reporter cannot type but we know: on a map, extent and zoom are
 *  half the bug report. */
function technical(map) {
  const rows = [`Seite: ${location.href}`, `Browser: ${navigator.userAgent}`,
    `Fenster: ${window.innerWidth}x${window.innerHeight}`];
  try {
    const centre = map.getCenter();
    rows.push(`Kartenmitte: ${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)}`,
      `Zoom: ${map.getZoom().toFixed(2)}`);
  } catch { /* map not ready yet */ }
  return rows.join("\n");
}

export function startReporting(map, t) {
  const button = $("#report-btn");
  const dialog = $("#report-dialog");
  const content = $("#report-content");
  if (!button || !dialog) return;

  let kind = "bug";
  let mine = [];
  let open = null;

  $("#report-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });

  // main.js only loads this module when the server has reporting, so the
  // button can come out right away.
  button.hidden = false;
  $("#report-hint").hidden = false;

  button.addEventListener("click", async () => {
    await draw();
    dialog.showModal();
  });

  function stateLabel(status) {
    return el("span", { class: `report-state state-${status}` },
      STATE_KEYS[status] ? t(STATE_KEYS[status]) : status);
  }

  async function loadMine() {
    const ref = reporterId();
    if (!ref) { mine = []; return; }
    try {
      mine = (await fetchOne(`/api/reports?reporter=${encodeURIComponent(ref)}`)).reports || [];
    } catch { mine = []; }
  }

  function form() {
    const title = el("input", { type: "text", maxlength: "120",
      placeholder: "Kurz: worum geht es?" });
    const contact = el("input", { type: "text", maxlength: "120",
      placeholder: t("report.contact") });
    const text = el("textarea", { rows: "6", maxlength: "4000",
      placeholder: t("report.needText") });
    const images = el("input", { type: "file", accept: "image/*", multiple: true });
    const state = el("p", { class: "hint", role: "status", "aria-live": "polite" });
    const submit = el("button", { class: "wide-btn", type: "submit" }, t("report.submit"));

    const kindButtons = Object.entries(KIND_KEYS).map(([key, label]) =>
      el("button", { type: "button", class: key === kind ? "on" : "",
        onclick: (e) => {
          kind = key;
          [...e.target.parentElement.children].forEach((k) =>
            k.classList.toggle("on", k === e.target));
        } }, t(label)));

    return el("form", {
      onsubmit: async (e) => {
        e.preventDefault();
        if (title.value.trim().length < 3) { state.textContent = t("report.needSubject"); return; }
        if (contact.value.trim().length < 2) {
          state.textContent = t("report.needContact");
          return;
        }
        if (text.value.trim().length < 10) {
          state.textContent = t("report.needText"); return;
        }
        submit.disabled = true;
        state.textContent = t("report.sending");
        try {
          const ref = reporterId(true);
          const answer = await fetchOne("/api/report", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ref, contact: contact.value.trim(),
              title: title.value.trim(), details: text.value.trim(), kind: kind,
              technical: technical(map) }),
          });
          if (images.files.length) {
            try {
              await uploadImages(answer.id, null, images.files);
            } catch (err) {
              // The report went through, only the images did not. No reason
              // to let the reporter believe nothing arrived.
              state.textContent = t("report.imagesFailed",
                { id: answer.number, reason: err.message });
              await loadMine();
              return;
            }
          }
          await loadMine();
          await draw(answer.id);
        } catch (err) {
          state.textContent = err.message;
        } finally {
          submit.disabled = false;
        }
      },
    },
      el("div", { class: "seg report-kind" }, ...kindButtons),
      el("label", { class: "report-field" }, t("report.subject"), title),
      el("label", { class: "report-field" }, t("report.contact"), contact),
      el("label", { class: "report-field" }, t("report.description"), text),
      el("label", { class: "report-field" }, t("report.images"), images),
      submit, state,
      el("p", { class: "hint" }, t("report.technicalNote")));
  }

  async function uploadImages(reportId, postId, files) {
    for (const file of [...files].slice(0, IMAGES_MAX)) {
      const payload = new FormData();
      payload.append("file", file);
      const question = new URLSearchParams({ reporter: reporterId() || "" });
      if (postId) question.set("post", String(postId));
      const answer = await fetch(`/api/reports/${reportId}/images?${question}`,
        { method: "POST", body: payload });
      if (!answer.ok) throw new Error(t("report.imageFailed", { name: file.name }));
    }
  }

  function image(b) {
    // The id has to come along: the backend uses it to check that the image
    // belongs to a report of this reporter.
    const url = `/api/reports/images/${b.id}?reporter=${encodeURIComponent(reporterId() || "")}`;
    return el("a", { href: url, target: "_blank", rel: "noopener" },
      el("img", { src: url, alt: b.filename || "Bild", loading: "lazy" }));
  }

  // Do not ask for `mine`: the tracker only sets that in the response to a
  // freshly written post; in the thread view it is always false. `team` is
  // reliable - true for everything written over there, false for everything
  // that came from here. And from here only the reporter can write.
  function post(p) {
    return el("article", { class: `report-post ${p.team ? "team" : ""}`.trim() },
      el("header", {}, el("strong", {}, p.team ? (p.author || t("report.team")) : t("report.me")),
        el("span", {}, time(p.created_at))),
      el("p", {}, p.body),
      p.images && p.images.length
        ? el("div", { class: "report-images" }, ...p.images.map(image)) : null);
  }

  async function thread(id) {
    let m;
    try {
      m = await fetchOne(`/api/reports/${id}?reporter=${encodeURIComponent(reporterId() || "")}`);
    } catch (err) {
      return el("p", { class: "hint" }, t("report.notLoadable", { reason: err.message }));
    }
    const field = el("textarea", { rows: "3", maxlength: "4000",
      placeholder: "Antworten, nachreichen, nachfragen …" });
    const state = el("p", { class: "hint", role: "status", "aria-live": "polite" });
    const submit = el("button", { class: "wide-btn", type: "submit" }, "Antwort schicken");
    return el("div", {},
      el("button", { type: "button", class: "report-back",
        onclick: () => draw() }, t("report.back")),
      el("div", { class: "report-title" }, el("h3", {}, m.title), stateLabel(m.status)),
      el("p", { class: "hint" },
        `BUG-${m.id} · ${KIND_KEYS[m.kind] ? t(KIND_KEYS[m.kind]) : m.kind} · ${time(m.created_at)}`),
      el("article", { class: "report-post" },
        el("header", {}, el("strong", {}, t("report.me")), el("span", {}, time(m.created_at))),
        el("p", {}, m.details),
        m.images && m.images.length
          ? el("div", { class: "report-images" }, ...m.images.map(image)) : null),
      ...(m.posts || []).map(post),
      el("form", {
        onsubmit: async (e) => {
          e.preventDefault();
          if (!field.value.trim()) return;
          submit.disabled = true;
          state.textContent = t("report.sending");
          try {
            await fetchOne(`/api/reports/${id}/replies`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ref: reporterId(), body: field.value.trim() }),
            });
            await loadMine();
            await draw(id);
          } catch (err) {
            state.textContent = err.message;
          } finally {
            submit.disabled = false;
          }
        },
      }, el("label", { class: "report-field" }, t("report.yourReply"), field), submit, state));
  }

  function list() {
    if (!mine.length) return el("p", { class: "hint" }, t("report.nothingYet"));
    return el("div", { class: "report-list" }, ...mine.map((m) =>
      el("button", { type: "button", class: "report-entry", onclick: () => draw(m.id) },
        el("span", { class: "report-row" }, el("strong", {}, m.title), stateLabel(m.status)),
        el("span", { class: "hint" },
          `BUG-${m.id} · ${KIND_KEYS[m.kind] ? t(KIND_KEYS[m.kind]) : m.kind} · ${time(m.created_at)}`
          + (m.posts && m.posts.length ? ` · ${m.posts.length} Antworten` : "")))));
  }

  async function draw(threadId = null) {
    open = threadId;
    if (!mine.length && reporterId()) await loadMine();
    if (open) {
      content.replaceChildren(await thread(open));
      return;
    }
    content.replaceChildren(
      form(),
      el("h3", { class: "report-heading" }, t("report.mine")),
      list(),
      reporterId()
        ? el("p", { class: "hint" },
          t("report.storageNote"))
        : null);
  }
}
