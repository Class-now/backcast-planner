// Records the demo video headless with Playwright, with an English caption bar
// drawn into the page. Writes <out>/raw.webm, <out>/marks.json (spans to speed
// up) and <out>/captions.json (for transcript.md).
// Usage: node scripts/record-demo.mjs [base-url] [out-dir]
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://127.0.0.1:8731/").replace(/\/?$/, "/");
const out = process.argv[3] ?? "demo-out";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: out, size: { width: 1280, height: 720 } },
  colorScheme: "light",
});
const page = await context.newPage();
const t0 = Date.now();
const marks = [];
const captions = [];
const now = () => (Date.now() - t0) / 1000;
const pause = (ms) => page.waitForTimeout(ms);
async function fast(fn, speed = 6) {
  const start = now();
  await fn();
  marks.push({ start, end: now(), speed });
}

async function caption(text) {
  captions.push({ at: now(), text });
  await page.evaluate((t) => {
    let c = document.getElementById("demo-caption");
    if (!c) {
      c = document.createElement("div");
      c.id = "demo-caption";
      c.style.cssText =
        "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1120px;width:max-content;background:rgba(11,22,40,.93);color:#fff;font:600 22px/1.35 system-ui,'Segoe UI',sans-serif;padding:12px 22px;border-radius:12px;z-index:99999;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.35)";
      document.body.appendChild(c);
    }
    c.textContent = t;
  }, text);
}
async function scrollTo(selector, offset = 12) {
  await page.locator(selector).first().evaluate((n, off) => {
    const y = n.getBoundingClientRect().top + window.scrollY - off;
    window.scrollTo({ top: y, behavior: "smooth" });
  }, offset);
  await pause(900);
}

const SYLLABUS = await (async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  return /export const EXAMPLE = `([\s\S]*?)`;/.exec(src)[1];
})();

await page.goto(base + "?today=2026-11-10");
await page.evaluate(() => localStorage.clear());
await page.reload();
await caption("Backcast: paste your syllabus deadlines, get a plan that works backwards from each one.");
await pause(4000);

await caption("Paste deadlines straight from your syllabi. Nov 28, 12/3, 2026-12-03 or 11月28日 all work.");
await page.click("#paste");
await fast(() => page.locator("#paste").pressSequentially(SYLLABUS, { delay: 12 }), 10);
await pause(2500);
await page.click("#parse");
await pause(600);
await caption("It finds 11 deadlines, the course for each, and skips the line with no date.");
await scrollTo("#parse-status", 260);
await pause(3500);

await scrollTo("#s2");
await caption("Each one is sized by type and length: a 2,000-word essay ≈ 10h, a quiz ≈ 2h. Edit anything.");
await pause(3500);
const hours = page.locator(".task", { has: page.locator('input[value="Essay 2"]') }).locator('input[data-f="hours"]');
await hours.click();
await hours.fill("9");
await hours.press("Tab");
await pause(2000);

await scrollTo("#s4");
await caption("Then it plans backwards: every task is split into milestones and spread over the days before it.");
await pause(4500);
await caption("Your week: 2–4 hours a day. Darker = fuller. Red stripes = more work than time: a crunch collision.");
await pause(5000);

await scrollTo("#alerts", 140);
await caption("Nov 28: work for four deadlines piles up on one Saturday. Backcast offers one-click fixes.");
await pause(4500);
await caption("Each fix is checked by re-running the planner: start earlier, move hours, or shrink a task.");
await page.locator(".alert .fix").first().hover();
await pause(3500);
await page.locator(".alert .fix").first().click();
await pause(800);
await scrollTo("#stats", 16);
await caption("One click and the crunch is gone: the fix is a real re-plan, and Undo is always one click away.");
await pause(5000);

await page.click('#heat .cell[data-date="2026-11-10"]');
await scrollTo("#day", 200);
await caption("Select any day to see exactly what to work on, and change that day's hours if your plans change.");
await pause(4500);

await scrollTo("#s5");
await caption("Every deadline gets dated milestones: research, draft, revise… finished with slack before it's due.");
await pause(4500);
await page.mouse.wheel(0, 500);
await pause(1500);

await scrollTo("#s6");
await caption("A printable day-by-day checklist, and an .ics file for Google, Apple or Outlook Calendar.");
await pause(2500);
await scrollTo("#s4");
const dl = page.waitForEvent("download");
await page.click("#ics");
await dl;
await pause(3000);

await caption("No account, no server: everything stays in your browser. Backcast — see the crunch before it hits.");
await pause(4500);

await context.close();
await browser.close();
const vid = readdirSync(out).find((f) => f.endsWith(".webm") && f !== "raw.webm");
if (vid) renameSync(join(out, vid), join(out, "raw.webm"));
writeFileSync(join(out, "marks.json"), JSON.stringify({ marks, total: now() }, null, 2));
writeFileSync(join(out, "captions.json"), JSON.stringify(captions, null, 2));
console.log("recorded", now().toFixed(1), "s");
