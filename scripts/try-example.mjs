// Prints how the built-in example parses and plans (a quick check while tuning).
// Usage: node scripts/try-example.mjs
import { readFileSync } from "node:fs";
import { parseSyllabus } from "../js/parser.js";
import { schedule, suggestFixes } from "../js/scheduler.js";

const src = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const example = /export const EXAMPLE = `([\s\S]*?)`;/.exec(src)[1];
const today = "2026-11-10";
const { items, skipped } = parseSyllabus(example, { today });
for (const i of items) console.log(i.due, i.type.padEnd(12), String(i.hours).padStart(4), "|", i.course, "|", i.title);
console.log("skipped:", skipped.map((s) => s.line));
const input = { today, availability: [3, 3, 3, 3, 2, 4, 3], session: 1, overrides: {}, tasks: items.map((it, n) => ({ ...it, id: "t" + n, enabled: !it.past })) };
const t0 = performance.now();
const plan = schedule(input);
console.log("schedule ms", (performance.now() - t0).toFixed(1), "total", plan.totalHours, "over", plan.totalOver);
for (const d of plan.days) console.log(d.date, String(d.load).padStart(5), "/", d.capacity, d.over ? "OVER " + d.over : "", d.items.map((i) => i.taskId).join(","));
for (const c of plan.crunches) {
  const t1 = performance.now();
  const fixes = suggestFixes(input, c.date);
  console.log("crunch", c.date, c.taskIds, "fixes ms", (performance.now() - t1).toFixed(0));
  for (const f of fixes) console.log("   ", JSON.stringify(f));
}
