import { chromium } from "playwright-core";
const exe = (await import("fs")).readdirSync("/ms-playwright").filter(d => d.startsWith("chromium-") && !d.includes("headless"))[0];
const browser = await chromium.launch({ executablePath: `/ms-playwright/${exe}/chrome-linux/chrome`, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
const p = await ctx.newPage();
await p.goto("file:///h/pota.html", { waitUntil: "networkidle", timeout: 60000 }).catch(e => console.log("goto", e.message));
await p.waitForTimeout(1200);
await p.click("#menu-knopf");
await p.waitForTimeout(400);
await p.screenshot({ path: "/h/shot-phone-menu.png" });
await p.click('details.untermenu summary >> nth=1');
await p.waitForTimeout(400);
await p.screenshot({ path: "/h/shot-phone-menu-offen.png", fullPage: false });
console.log(await p.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); const c = getComputedStyle(e); return { h: Math.round(b.height), bg: c.backgroundColor, border: c.borderTopWidth + " " + c.borderTopColor, radius: c.borderRadius }; };
  return JSON.stringify({ schnell: r(".schnellzugriff a"), untermenuA: r(".untermenu-inhalt a"), navA: r("#hauptnav > a") });
}));
await browser.close();
