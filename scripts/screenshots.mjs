// Takes the submission screenshots (1280x800) and the 3:2 thumbnail headless.
// Usage: node scripts/screenshots.mjs [base-url] [out-dir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = (process.argv[2] ?? "http://127.0.0.1:8731/").replace(/\/?$/, "/");
const out = process.argv[3] ?? "submission/screenshots";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function fresh(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(base + "?today=2026-11-10");
  await page.click("#example");
  await page.waitForSelector("#heat .cell.over");
  return { ctx, page };
}

// 1. Overview: pasted syllabus on the left, heatmap with crunch collisions on the right.
{
  const { ctx, page } = await fresh({ width: 1280, height: 800 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(out, "1-overview.png") });
  await ctx.close();
}

// 2. Crunch collision selected, with the one-click fixes.
{
  const { ctx, page } = await fresh({ width: 1280, height: 800 });
  const first = await page.locator("#heat .cell.over").first().getAttribute("data-date");
  await page.click(`#heat .cell[data-date="${first}"]`);
  await page.locator("#alerts").evaluate((n) => n.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -16));
  await page.screenshot({ path: join(out, "2-crunch-fixes.png") });
  // 3. After one click: no crunch days, milestones by deadline.
  await page.locator(".alert .fix").first().click();
  await page.waitForTimeout(300);
  await page.click(`#heat .cell[data-date="2026-11-10"]`); // today: what to do now
  await page.locator("#stats").evaluate((n) => n.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -16));
  await page.waitForTimeout(6500); // let the toast fade
  await page.screenshot({ path: join(out, "3-after-fix.png") });
  await page.locator("#s5").evaluate((n) => n.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -16));
  await page.screenshot({ path: join(out, "4-milestones.png") });
  await ctx.close();
}

// Thumbnail 1200x800 (3:2): the plan column only.
{
  const { ctx, page } = await fresh({ width: 1200, height: 800 });
  await page.screenshot({ path: join(out, "..", "thumb.png") });
  await ctx.close();
}

// Phone view for the README.
{
  const { ctx, page } = await fresh({ width: 390, height: 844 });
  await page.locator("#s4").evaluate((n) => n.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: join(out, "5-phone.png") });
  await ctx.close();
}
await browser.close();
console.log("screenshots in", out);
