import { chromium } from "playwright-core";
const exe = (await import("fs")).readdirSync("/ms-playwright").filter(d => d.startsWith("chromium-") && !d.includes("headless"))[0];
const browser = await chromium.launch({ executablePath: `/ms-playwright/${exe}/chrome-linux/chrome`, args: ["--no-sandbox"] });
const url = "file:///h/pota.html";
const jobs = [
  ["desktop", { width: 1440, height: 900 }, false, async () => {}],
  ["desktop-popup", { width: 1440, height: 900 }, false, async (p) => { await p.evaluate(() => { const s = document.querySelector("#suche"); s.value = "DE-0032"; s.dispatchEvent(new Event("input")); }); await p.waitForTimeout(300); await p.click("#treffer li"); await p.waitForTimeout(1200); }],
  ["desktop-konto", { width: 1440, height: 900 }, false, async (p) => { await p.click("#konto-knopf"); await p.click('.pota-tab[data-tab="ich"]'); await p.waitForTimeout(400); await p.click("#konto-knopf"); await p.waitForTimeout(300); }],
  ["desktop-spots", { width: 1440, height: 900 }, false, async (p) => { await p.click('.pota-tab[data-tab="spots"]'); await p.click("#knopf-standort"); await p.waitForTimeout(800); }],
  ["desktop-unterwegs-dark", { width: 1440, height: 900 }, false, async (p) => { await p.click('#basiskarten [data-base="dark"]'); await p.click('.pota-tab[data-tab="unterwegs"]'); for (const g of ["access","comfort","view","qrm"]) await p.check(`[data-poi="${g}"]`); await p.click("#knopf-standort"); await p.waitForTimeout(1200); }],
  ["phone", { width: 390, height: 844 }, true, async () => {}],
  ["phone-panel", { width: 390, height: 844 }, true, async (p) => { await p.click("#knopf-panel"); await p.waitForTimeout(400); }],
  ["phone-spots", { width: 390, height: 844 }, true, async (p) => { await p.click("#knopf-panel"); await p.click(".pota-tab[data-tab=\"spots\"]"); await p.waitForTimeout(400); }],
  ["phone-ich-konto", { width: 390, height: 844 }, true, async (p) => { await p.click("#konto-knopf"); await p.click("#knopf-panel"); await p.click(".pota-tab[data-tab=\"ich\"]"); await p.waitForTimeout(400); }],
  ["phone-popup", { width: 390, height: 844 }, true, async (p) => { await p.evaluate(() => { const s = document.querySelector("#suche"); s.value = "Hohe Wann"; s.dispatchEvent(new Event("input")); }); await p.waitForTimeout(300); await p.click("#treffer li"); await p.waitForTimeout(1200); }],
  ["tablet", { width: 1024, height: 768 }, false, async () => {}],
];
for (const [name, vp, mobile, act] of jobs) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, colorScheme: "dark" });
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log(name, "PAGEERROR", e.message));
  p.on("console", m => { if (m.type() === "error") console.log(name, "CONSOLE", m.text()); });
  await p.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(e => console.log(name, "goto", e.message));
  await p.waitForTimeout(1500);
  await act(p);
  await p.waitForTimeout(800);
  await p.screenshot({ path: `/h/shot-${name}.png` });
  const m = await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const hoehen = [...document.querySelectorAll(".bar-actions > button")].filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().height));
    return { kopfknoepfe: hoehen, map: r(".pota-map"), zahnrad: r(".pota-zahnrad"), suche: r(".pota-suche"), panel: r(".pota-panel"), attrib: r(".leaflet-control-attribution"), knoepfe: r(".pota-knoepfe"), knopf: r(".pota-knopf"), zoom: r("#knopf-plus") };
  });
  console.log(name, JSON.stringify(m));
  await ctx.close();
}
await browser.close();
