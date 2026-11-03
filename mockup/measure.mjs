import { chromium } from "playwright-core";
const exe = (await import("fs")).readdirSync("/ms-playwright").filter(d => d.startsWith("chromium-") && !d.includes("headless"))[0];
const b = await chromium.launch({ executablePath: `/ms-playwright/${exe}/chrome-linux/chrome`, args: ["--no-sandbox"] });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, colorScheme: "dark", isMobile: vp.width < 500, hasTouch: vp.width < 500 });
  const p = await ctx.newPage();
  await p.goto("file:///h/pota.html", { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await p.waitForTimeout(800);
  console.log(vp.width, await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const x = e.getBoundingClientRect(); return [Math.round(x.height), Math.round(x.y)]; };
    return JSON.stringify({ suchen: r(".search-open"), melden: r(".melden-open"), menu: r(".menu-open") });
  }));
  await ctx.close();
}
await b.close();
