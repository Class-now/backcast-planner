// Headless end-to-end check of the main features.
// Usage: node scripts/smoke.mjs [base-url]
// Exits non-zero on the first failure.
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = (process.argv[2] ?? "http://127.0.0.1:8731/").replace(/\/?$/, "/");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("request", (r) => {
  if (!r.url().startsWith(base) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) errors.push("external request: " + r.url());
});

const step = (name) => console.log("✓", name);

await page.goto(base + "?today=2026-11-10");
await page.click("#example");
await page.waitForSelector(".task");
const count = await page.locator(".task").count();
assert.equal(count, 11, "11 example deadlines");
assert.match(await page.textContent("#parse-status"), /Found 11 deadlines .* 1 line without a date/);
step("example parsed: 11 deadlines, 1 skipped line");

const jp = page.locator(".task", { has: page.locator('input[value="レポート"]') });
assert.equal(await jp.locator('input[data-f="due"]').inputValue(), "2026-11-30");
step("Japanese date 11月30日 parsed");

const crunchCells = await page.locator("#heat .cell.over").count();
assert.ok(crunchCells >= 1, "has crunch days");
assert.ok(await page.locator(".alert:not(.calm)").count() >= 1);
const fixButtons = await page.locator(".alert .fix").count();
assert.ok(fixButtons >= 2, "fix buttons shown");
step(`heatmap shows ${crunchCells} crunch day(s) with ${fixButtons} fix buttons`);

const before = await page.locator("#heat .cell.over").count();
await page.locator(".alert .fix").first().click();
await page.waitForTimeout(200);
const after = await page.locator("#heat .cell.over").count();
assert.ok(after < before || (await page.locator(".alert.calm").count()) === 1, `fix reduced crunch days ${before} -> ${after}`);
step(`one-click fix: crunch days ${before} -> ${after}`);
await page.click("#undo");
await page.waitForTimeout(200);
assert.equal(await page.locator("#heat .cell.over").count(), before);
step("undo restores the plan");

// Edit hours -> plan reacts.
const totalBefore = await page.textContent("#stats .stat .v");
const hoursInput = page.locator(".task").first().locator('input[data-f="hours"]');
await hoursInput.fill("6");
await hoursInput.dispatchEvent("change");
await page.waitForTimeout(200);
assert.notEqual(await page.textContent("#stats .stat .v"), totalBefore);
step("editing hours updates the plan");

// Availability -> raise all days to 6h clears crunches.
for (let i = 0; i < 7; i++) {
  const inp = page.locator(`#week input[data-day="${i}"]`);
  await inp.fill("6");
  await inp.dispatchEvent("change");
}
await page.waitForTimeout(200);
assert.equal(await page.locator("#heat .cell.over").count(), 0);
assert.equal(await page.locator(".alert.calm").count(), 1);
step("more weekly hours clears all crunches");

// Keyboard: select a day with Enter, move with arrows.
await page.locator("#heat .cell[data-date='2026-11-20']").focus();
await page.keyboard.press("Enter");
assert.match(await page.textContent("#day h3"), /Fri, Nov 20/);
await page.keyboard.press("ArrowRight");
assert.equal(await page.evaluate(() => document.activeElement.dataset.date), "2026-11-21");
step("keyboard selection and arrow navigation work");

// Persistence.
await page.reload();
await page.waitForSelector(".task");
assert.equal(await page.locator(".task").count(), 11);
step("plan survives a reload (localStorage)");

// ICS export.
const [download] = await Promise.all([page.waitForEvent("download"), page.click("#ics")]);
const path = await download.path();
const { readFileSync } = await import("node:fs");
const ics = readFileSync(path, "utf8");
assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
assert.ok((ics.match(/BEGIN:VEVENT/g) || []).length > 20);
step(`.ics export: ${(ics.match(/BEGIN:VEVENT/g) || []).length} events (${download.suggestedFilename()})`);

// Print view renders the agenda.
await page.emulateMedia({ media: "print" });
assert.ok(await page.locator("#agenda").isVisible());
assert.equal(await page.locator(".inputs").isVisible(), false);
await page.emulateMedia({ media: "screen" });
step("print stylesheet shows only the day-by-day list");

// Small phone layout.
await page.setViewportSize({ width: 360, height: 740 });
const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
assert.equal(overflowX, false, "no horizontal page scroll on a 360px phone");
step("360px phone layout has no horizontal page scroll");

assert.deepEqual(errors, [], "no console errors or network requests");
step("no console errors, no external requests");
await browser.close();
console.log("SMOKE OK");
