/*
 * Texts of the interface, in one place per language.
 *
 * The map is German first - that is who uses it - but nothing in the code
 * should depend on that. Every sentence a visitor reads goes through `t()`,
 * and the static ones sit in the HTML as `data-i18n` keys, so there is exactly
 * one place to add a language.
 *
 * Choice of language: `?lang=` beats what was chosen before, which beats what
 * the browser asks for, which falls back to German.
 *
 * Not in here: console warnings and log lines. Those are read by whoever
 * operates this, not by visitors, and they stay English like the rest of the
 * code.
 */

const LANG_KEY = "pota-lang";

export const LANGUAGES = [["de", "Deutsch"], ["en", "English"]];

const CATALOGUE = {
  de: {
    "app.title": "POTA-Map — Parks on the Air in DACH",
    "app.name": "POTA-Map",

    "menu.toggle": "Einstellungen ein-/ausblenden",
    "menu.hint": "Programme, Spots und Legende",
    "panel.aria": "Einstellungen",
    "tabs.aria": "Bereiche",
    "tabs.map": "Karte",
    "tabs.spots": "Spots",
    "tabs.me": "Ich",
    "tabs.outdoors": "Unterwegs",

    "search.placeholder": "Referenz oder Name suchen…",
    "search.aria": "Park suchen",
    "search.locator": "Locator-Mittelpunkt",
    "status.title": "Ladezustand",

    "programs.head": "Programme",
    "programs.hint": "Beim ersten Aufruf ist nur DE an. Die Auswahl wird im Browser gemerkt.",
    "programs.DE": "Deutschland",
    "programs.AT": "Österreich",
    "programs.CH": "Schweiz",
    "programs.LI": "Liechtenstein",
    "programs.CZ": "Tschechien",
    "programs.DK": "Dänemark",
    "programs.LU": "Luxemburg",

    "display.head": "Anzeige",
    "display.spots": "Live-Spots",
    "display.sota": "SOTA-Gipfel",
    "display.sotaHint": "Folgt der Länderauswahl oben. Ab Zoom 8 alle Gipfel, darunter nur die 10-Punkte-Gipfel.",
    "display.never": "Nie aktivierte hervorheben",
    "display.points": "Parks ohne Fläche als Punkt",
    "display.plans": "Angekündigte Aktivierungen",
    "display.nfer": "Nur Parks, die sich überlappen",
    "display.nferHint": "Wer im Überschneidungsbereich zweier Parks steht, aktiviert mit einem Aufbau mehrere Referenzen.",

    "look.head": "Darstellung",
    "look.language": "Sprache",
    "look.colours": "Farben",
    "look.light": "Hell",
    "look.dark": "Dunkel",
    "look.sharpness": "Schärfe",
    "look.auto": "Auto",
    "look.sharp": "Scharf",
    "look.smooth": "Flüssig",
    "look.qualityHint": "Auf hochauflösenden Bildschirmen zeichnet die Karte je Bild ein Vielfaches an Pixeln. „Auto“ senkt die Schärfe, wenn es ruckelt.",
    "look.lowered": "Die Karte lief mit {fps} Bildern je Sekunde, Schärfe automatisch gesenkt — mit „Scharf“ zurückstellen.",

    "legend.head": "Legende",
    "legend.park": "Park",
    "legend.never": "noch nie aktiviert",
    "legend.mine": "von mir aktiviert",
    "legend.hunted": "von mir gejagt",
    "legend.trail": "Wanderweg (Trail)",
    "legend.point": "Park ohne Fläche",
    "legend.spot": "Live-Spot",
    "legend.sota": "SOTA-Gipfel (Farbe = Punkte)",

    "spots.head": "Live-Spots",
    "spots.band": "Band",
    "spots.allBands": "alle Bänder",
    "spots.mode": "Betriebsart",
    "spots.allModes": "alle Arten",
    "spots.phone": "Fone",
    "spots.digital": "Digital",
    "spots.sort": "Sortierung",
    "spots.newest": "neueste zuerst",
    "spots.byFreq": "nach Frequenz",
    "spots.fresh": "nur frische (15 min)",
    "spots.hideQrt": "QRT ausblenden",
    "spots.hideHunted": "gejagte ausblenden",
    "spots.loading": "wird geladen …",
    "spots.plusHint": "Das Plus merkt sich den Park als gejagt.",
    "spots.none": "gerade niemand auf Sendung",
    "spots.noMatch": "kein Spot passt zum Filter",
    "spots.count": "{total} Spots",
    "spots.countFiltered": "{shown} von {total} Spots",
    "spots.mark": "als gejagt merken",
    "spots.marked": "gilt als gejagt",

    "call.head": "Mein Rufzeichen",
    "call.placeholder": "DL1XXX",
    "call.aria": "Rufzeichen",
    "call.colourAria": "Farbe für eigene Aktivierungen",
    "call.hint": "Färbt die Parks ein, die du schon aktiviert hast.",
    "call.hideMine": "Meine erledigten ausblenden",
    "call.loading": "wird geladen …",
    "call.activated": "{count} Parks von {call} aktiviert.",
    "call.none": "Für {call} sind keine Aktivierungen verzeichnet.",
    "call.failed": "Abruf fehlgeschlagen.",

    "hunted.head": "Gejagte Parks",
    "hunted.load": "hunter_parks.csv laden",
    "hunted.forget": "Liste vergessen",
    "hunted.hide": "Gejagte ausblenden",
    "hunted.empty": "Noch nichts geladen. Die Datei holst du dir bei pota.app unter „My Stats“ als hunter_parks.csv.",
    "hunted.state": "{total} gejagte Parks, davon {here} auf dieser Karte. Stand {date}.",
    "hunted.unknownDate": "unbekannt",
    "hunted.tooBig": "Die Datei ist zu groß (über 8 MB).",
    "hunted.reading": "wird gelesen …",
    "hunted.unreadable": "Datei nicht lesbar.",
    "hunted.noRefs": "Keine POTA-Referenzen in der Datei gefunden.",

    "position.head": "Wo stehe ich?",
    "position.track": "Live-Tracking",
    "position.checking": "Standort wird geprüft …",
    "position.none": "Du stehst in keinem erfassten Park.",
    "position.inside": "Du stehst in: ",
    "position.toEdge": "bis zur Grenze von {ref}: {distance}",
    "position.recenter": "Karte folgt wieder",
    "track.off": "Aus. Der Standort wird nur auf Knopfdruck geprüft.",
    "track.on": "Läuft. Die Ortung bleibt an, das kostet Akku.",
    "track.unsupported": "Dieser Browser kann den Standort nicht dauerhaft verfolgen.",
    "track.failed": "Ortung fehlgeschlagen: {reason}",
    "track.enter": "Im Park: {ref} {name}",
    "track.leave": "Park verlassen: {ref}",
    "track.none": "Live: in keinem erfassten Park",
    "track.here": "Live: ",

    "offline.head": "Offline",
    "offline.save": "Diesen Ausschnitt offline sichern",
    "offline.hint": "Parks haben oft keinen Empfang. Sichert die Karte des sichtbaren Bereichs bis drei Zoomstufen tiefer.",
    "offline.unsupported": "Dieser Browser kann nichts für unterwegs sichern.",
    "offline.nothing": "Hier gibt es nichts zu sichern.",
    "offline.saving": "wird gesichert …",
    "offline.progress": "{done} von {total} gesichert",
    "offline.done": "{total} Kacheln gesichert. Der Ausschnitt geht jetzt auch ohne Netz.",

    "popup.loading": "Parkdaten werden geladen …",
    "popup.trail": "Wegverlauf von pota-map.info",
    "popup.area": "Fläche von pota-map.info",
    "popup.pointOnly": "nur Punkt, keine Fläche hinterlegt",
    "popup.nferHere": "Hier zählt auch: ",
    "popup.andMore": " und {count} weitere",
    "popup.nferElsewhere": "überschneidet sich an anderer Stelle mit {count} Referenzen",
    "popup.nferElsewhereOne": "überschneidet sich an anderer Stelle mit einer Referenz",
    "popup.openPota": "bei POTA öffnen",
    "popup.route": "Route",
    "popup.website": "Park-Website",
    "popup.openSotlas": "bei SOTLAS öffnen",
    "popup.activations": "{count} Aktivierungen",
    "popup.qsos": "{count} QSOs",
    "popup.firstBy": "zuerst {call}",
    "popup.firstOn": "zuerst {call} am {date}",
    "popup.summit": "{alt} m - {points} Punkte - {activations} Aktivierungen",
    "hover.spot": "{call} auf {freq} {mode} in {ref}",
    "hover.summit": "{alt} m, {points} Punkte",
    "popup.spot": "Live-Spot",
    "popup.spotOn": "{call} auf {freq} {mode}",
    "popup.spotBy": "{ref} - gespottet von {spotter}",

    "stats.parks": "{parks} Parks, {areas} mit Fläche",
    "stats.build": "Datenstand {date} · Programm {build}",
    "stats.unknown": "unbekannt",
    "stats.incomplete": "Daten unvollständig",

    "report.head": "Melden",
    "report.button": "Fehler, Idee oder Frage",
    "report.hint": "Fehlt ein Park, liegt eine Fläche falsch, klemmt etwas? Jede Meldung bekommt eine Nummer, und die Antwort steht im selben Fenster.",
    "report.aria": "Melden",
    "report.close": "Schließen",
    "report.kindBug": "Fehler",
    "report.kindIdea": "Idee",
    "report.kindQuestion": "Frage",
    "report.subject": "Betreff",
    "report.contact": "Rufzeichen oder Mailadresse",
    "report.description": "Beschreibung",
    "report.images": "Bildschirmfotos (bis 3, je 5 MB)",
    "report.submit": "Absenden",
    "report.sending": "wird gesendet …",
    "report.needSubject": "Welcher Park, welche Stelle, was stimmt nicht? Bei einer Idee reicht die Idee.",
    "report.needContact": "Ohne Rufzeichen oder Mailadresse gibt es keinen Weg zurück.",
    "report.needText": "Ein, zwei Sätze mehr helfen sehr.",
    "report.technicalNote": "Mitgeschickt werden außerdem Kartenausschnitt, Zoom und Browser. Das steht in der Meldung und hilft beim Nachstellen.",
    "report.mine": "Meine Meldungen",
    "report.nothingYet": "Noch nichts gemeldet.",
    "report.back": "← alle Meldungen",
    "report.me": "Du",
    "report.team": "Team",
    "report.reply": "Antworten",
    "report.yourReply": "Deine Antwort",
    "report.imageFailed": "Bild „{name}“ ging nicht durch",
    "report.state.duplicate": "schon gemeldet",
    "report.imagesFailed": "Meldung {id} ist da, aber die Bilder nicht ({reason}).",
    "report.failed": "„{title}“ ging nicht durch: {reason}",
    "report.storageNote": "Deine Meldungen erkennt dieser Browser an einer zufälligen Kennung im lokalen Speicher. Löschst du die Websitedaten oder wechselst das Gerät, findest du sie hier nicht mehr wieder — die Meldung selbst bleibt.",
    "report.otherBrowser": "Diese Meldung gehört zu einem anderen Browser.",
    "report.emptyReply": "Die Antwort ist leer.",
    "report.imageTooBig": "Das Bild ist größer als 5 MB.",
    "report.imageMissing": "Bild nicht gefunden.",
    "api.potaDown": "POTA ist gerade nicht erreichbar.",
    "api.badReference": "Das ist keine POTA-Referenz.",
    "reports.badId": "Ungültige Melderkennung.",
    "reports.notConfigured": "Das Meldesystem ist auf diesem Server nicht eingerichtet.",
    "reports.unreachable": "Das Meldesystem antwortet gerade nicht.",
    "reports.unknown": "Diese Meldung gibt es nicht.",
    "reports.rateLimited": "Gerade wurde zu viel gemeldet. Bitte später noch einmal.",
    "reports.refusing": "Das Meldesystem nimmt gerade nichts an.",
    "reports.rejected": "Das Meldesystem hat abgelehnt.",
    "report.notLoadable": "Nicht abrufbar: {reason}",
    "report.state.open": "offen",
    "report.state.in_progress": "in Arbeit",
    "report.state.eingeplant": "eingeplant",
    "report.state.erledigt": "erledigt",
    "report.state.abgelehnt": "abgelehnt",
    "report.state.gelesen": "gelesen",

    "credits.head": "Quellen und Rechte",
    "credits.areas": "Flächen und Wegverläufe: © {source} (DK5UR), MIT-Lizenz, mit freundlicher Genehmigung. Die Zuordnung Referenz zu Fläche ist dort über Jahre von Hand gepflegt worden.",
    "credits.pota": "Referenzen und Spots: {source}. Diese Seite gehört nicht zu POTA und wird nicht von POTA betrieben.",
    "credits.sota": "Gipfel: {sota}. Basiskarte: {protomaps} aus OpenStreetMap-Daten (ODbL).",
    "credits.attribution": "Flächen: pota-map.info (DK5UR), MIT",
    "credits.osm": "OpenStreetMap",
  },

  en: {
    "app.title": "POTA map — Parks on the Air in central Europe",
    "app.name": "POTA map",

    "menu.toggle": "Show or hide the settings",
    "menu.hint": "Programs, spots and legend",
    "panel.aria": "Settings",
    "tabs.aria": "Sections",
    "tabs.map": "Map",
    "tabs.spots": "Spots",
    "tabs.me": "Me",
    "tabs.outdoors": "Outdoors",

    "search.placeholder": "Search reference or name…",
    "search.aria": "Search a park",
    "search.locator": "centre of the grid square",
    "status.title": "Loading state",

    "programs.head": "Programs",
    "programs.hint": "Only DE is on for a first visit. The choice is kept in your browser.",
    "programs.DE": "Germany",
    "programs.AT": "Austria",
    "programs.CH": "Switzerland",
    "programs.LI": "Liechtenstein",
    "programs.CZ": "Czechia",
    "programs.DK": "Denmark",
    "programs.LU": "Luxembourg",

    "display.head": "Show",
    "display.spots": "Live spots",
    "display.sota": "SOTA summits",
    "display.sotaHint": "Follows the country selection above. All summits from zoom 8 on, only the 10-point ones below that.",
    "display.never": "Highlight never activated",
    "display.points": "Parks without an area as a point",
    "display.plans": "Scheduled activations",
    "display.nfer": "Only parks that overlap",
    "display.nferHint": "Standing where two parks overlap activates several references from one setup.",

    "look.head": "Appearance",
    "look.language": "Language",
    "look.colours": "Colours",
    "look.light": "Light",
    "look.dark": "Dark",
    "look.sharpness": "Sharpness",
    "look.auto": "Auto",
    "look.sharp": "Sharp",
    "look.smooth": "Smooth",
    "look.qualityHint": "On high resolution screens the map draws several times as many pixels per frame. \"Auto\" lowers the sharpness when it stutters.",
    "look.lowered": "The map ran at {fps} frames per second, sharpness lowered automatically — pick \"Sharp\" to undo.",

    "legend.head": "Legend",
    "legend.park": "Park",
    "legend.never": "never activated",
    "legend.mine": "activated by me",
    "legend.hunted": "hunted by me",
    "legend.trail": "Trail",
    "legend.point": "Park without an area",
    "legend.spot": "Live spot",
    "legend.sota": "SOTA summit (colour = points)",

    "spots.head": "Live spots",
    "spots.band": "Band",
    "spots.allBands": "all bands",
    "spots.mode": "Mode",
    "spots.allModes": "all modes",
    "spots.phone": "Phone",
    "spots.digital": "Digital",
    "spots.sort": "Sorting",
    "spots.newest": "newest first",
    "spots.byFreq": "by frequency",
    "spots.fresh": "fresh only (15 min)",
    "spots.hideQrt": "hide QRT",
    "spots.hideHunted": "hide hunted",
    "spots.loading": "loading …",
    "spots.plusHint": "The plus remembers the park as hunted.",
    "spots.none": "nobody on the air right now",
    "spots.noMatch": "no spot matches the filter",
    "spots.count": "{total} spots",
    "spots.countFiltered": "{shown} of {total} spots",
    "spots.mark": "remember as hunted",
    "spots.marked": "counts as hunted",

    "call.head": "My callsign",
    "call.placeholder": "M0ABC",
    "call.aria": "Callsign",
    "call.colourAria": "Colour for my own activations",
    "call.hint": "Colours the parks you have activated.",
    "call.hideMine": "Dim the ones I did",
    "call.loading": "loading …",
    "call.activated": "{count} parks activated by {call}.",
    "call.none": "No activations on record for {call}.",
    "call.failed": "Request failed.",

    "hunted.head": "Hunted parks",
    "hunted.load": "load hunter_parks.csv",
    "hunted.forget": "Forget the list",
    "hunted.hide": "Dim the hunted ones",
    "hunted.empty": "Nothing loaded yet. Get the file from pota.app under \"My Stats\" as hunter_parks.csv.",
    "hunted.state": "{total} hunted parks, {here} of them on this map. As of {date}.",
    "hunted.unknownDate": "unknown",
    "hunted.tooBig": "The file is too large (over 8 MB).",
    "hunted.reading": "reading …",
    "hunted.unreadable": "Cannot read that file.",
    "hunted.noRefs": "No POTA references found in the file.",

    "position.head": "Which park am I in?",
    "position.track": "Live tracking",
    "position.checking": "Checking your position …",
    "position.none": "You are not in any park on this map.",
    "position.inside": "You are in: ",
    "position.toEdge": "to the boundary of {ref}: {distance}",
    "position.recenter": "Follow me again",
    "track.off": "Off. Your position is only checked on request.",
    "track.on": "Running. Positioning stays on, which costs battery.",
    "track.unsupported": "This browser cannot follow your position continuously.",
    "track.failed": "Positioning failed: {reason}",
    "track.enter": "In the park: {ref} {name}",
    "track.leave": "Left the park: {ref}",
    "track.none": "Live: in no park on this map",
    "track.here": "Live: ",

    "offline.head": "Offline",
    "offline.save": "Save this area for offline use",
    "offline.hint": "Parks often have no reception. Saves the visible area down three zoom levels.",
    "offline.unsupported": "This browser cannot save anything for offline use.",
    "offline.nothing": "Nothing to save here.",
    "offline.saving": "saving …",
    "offline.progress": "{done} of {total} saved",
    "offline.done": "{total} tiles saved. This area now works without a network.",

    "popup.loading": "loading park details …",
    "popup.trail": "Trail from pota-map.info",
    "popup.area": "Area from pota-map.info",
    "popup.pointOnly": "point only, no area on record",
    "popup.nferHere": "Counts here too: ",
    "popup.andMore": " and {count} more",
    "popup.nferElsewhere": "overlaps {count} references somewhere else",
    "popup.nferElsewhereOne": "overlaps one reference somewhere else",
    "popup.openPota": "open at POTA",
    "popup.route": "Route",
    "popup.website": "Park website",
    "popup.openSotlas": "open at SOTLAS",
    "popup.activations": "{count} activations",
    "popup.qsos": "{count} QSOs",
    "popup.firstBy": "first by {call}",
    "popup.firstOn": "first by {call} on {date}",
    "popup.summit": "{alt} m - {points} points - {activations} activations",
    "hover.spot": "{call} on {freq} {mode} in {ref}",
    "hover.summit": "{alt} m, {points} points",
    "popup.spot": "Live spot",
    "popup.spotOn": "{call} on {freq} {mode}",
    "popup.spotBy": "{ref} - spotted by {spotter}",

    "stats.parks": "{parks} parks, {areas} with an area",
    "stats.build": "Data of {date} · build {build}",
    "stats.unknown": "unknown",
    "stats.incomplete": "Data incomplete",

    "report.head": "Report",
    "report.button": "Bug, idea or question",
    "report.hint": "A park missing, an area in the wrong place, something stuck? Every report gets a number, and the answer appears in the same window.",
    "report.aria": "Report",
    "report.close": "Close",
    "report.kindBug": "Bug",
    "report.kindIdea": "Idea",
    "report.kindQuestion": "Question",
    "report.subject": "Subject",
    "report.contact": "Callsign or mail address",
    "report.description": "Description",
    "report.images": "Screenshots (up to 3, 5 MB each)",
    "report.submit": "Send",
    "report.sending": "sending …",
    "report.needSubject": "Which park, which spot, what is wrong? For an idea, the idea is enough.",
    "report.needContact": "Without a callsign or a mail address there is no way back to you.",
    "report.needText": "One or two more sentences help a lot.",
    "report.technicalNote": "Map extent, zoom level and browser are sent along. That is part of the report and helps to reproduce it.",
    "report.mine": "My reports",
    "report.nothingYet": "Nothing reported yet.",
    "report.back": "← all reports",
    "report.me": "You",
    "report.team": "Team",
    "report.reply": "Reply",
    "report.yourReply": "Your reply",
    "report.imageFailed": "Image \"{name}\" did not go through",
    "report.state.duplicate": "already reported",
    "report.imagesFailed": "Report {id} arrived, but the images did not ({reason}).",
    "report.failed": "\"{title}\" did not go through: {reason}",
    "report.storageNote": "This browser recognises your reports by a random id in local storage. Clear the site data or switch device and you will not find them here again — the report itself stays.",
    "report.otherBrowser": "That report belongs to another browser.",
    "report.emptyReply": "The reply is empty.",
    "report.imageTooBig": "The image is larger than 5 MB.",
    "report.imageMissing": "Image not found.",
    "api.potaDown": "POTA is not reachable right now.",
    "api.badReference": "Not a POTA reference.",
    "reports.badId": "Invalid reporter id.",
    "reports.notConfigured": "Reporting is not set up on this server.",
    "reports.unreachable": "The tracker does not answer right now.",
    "reports.unknown": "No such report.",
    "reports.rateLimited": "Too many reports just now. Please try again later.",
    "reports.refusing": "Reporting is not accepting anything right now.",
    "reports.rejected": "The tracker refused.",
    "report.notLoadable": "Cannot load: {reason}",
    "report.state.open": "open",
    "report.state.in_progress": "in progress",
    "report.state.eingeplant": "planned",
    "report.state.erledigt": "done",
    "report.state.abgelehnt": "declined",
    "report.state.gelesen": "read",

    "credits.head": "Sources and rights",
    "credits.areas": "Areas and trails: © {source} (DK5UR), MIT licensed, used with permission. The reference-to-area mapping there has been curated by hand for years.",
    "credits.pota": "References and spots: {source}. This site is not run by POTA and does not belong to it.",
    "credits.sota": "Summits: {sota}. Basemap: {protomaps} from OpenStreetMap data (ODbL).",
    "credits.attribution": "Areas: pota-map.info (DK5UR), MIT",
    "credits.osm": "OpenStreetMap",
  },
};

function pick() {
  const asked = new URLSearchParams(location.search).get("lang");
  if (asked && CATALOGUE[asked]) return asked;
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && CATALOGUE[stored]) return stored;
  } catch (err) { /* private mode */ }
  for (const tag of navigator.languages || [navigator.language || ""]) {
    const code = String(tag).slice(0, 2).toLowerCase();
    if (CATALOGUE[code]) return code;
  }
  return "de";
}

let lang = pick();

export function currentLanguage() {
  return lang;
}

export function setLanguage(code) {
  if (!CATALOGUE[code]) return;
  lang = code;
  try { localStorage.setItem(LANG_KEY, code); } catch (err) { /* private mode */ }
}

/**
 * One text. Unknown keys come back as the key itself - that is louder than an
 * empty string and points straight at what is missing.
 */
export function t(key, vars) {
  const text = CATALOGUE[lang][key] ?? CATALOGUE.de[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    (name in vars ? String(vars[name]) : whole));
}

/**
 * Fill the static parts of the page: `data-i18n` sets the text, the attribute
 * variants set an attribute. Called again after a language switch.
 */
export function applyStatic(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const [attr, name] of [["i18nPlaceholder", "placeholder"],
                              ["i18nTitle", "title"],
                              ["i18nLabel", "aria-label"]]) {
    for (const node of root.querySelectorAll(`[data-${name === "aria-label" ? "i18n-label" : "i18n-" + name}]`)) {
      node.setAttribute(name, t(node.dataset[attr]));
    }
  }
  document.documentElement.lang = lang;
  const title = document.querySelector("title");
  if (title) title.textContent = t("app.title");
}
