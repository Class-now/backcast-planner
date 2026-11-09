// Times the planner and the fix finder on the built-in example.
// Usage: node scripts/bench.mjs
import { readFileSync } from "node:fs";
import { parseSyllabus } from "../js/parser.js";
import { schedule, suggestFixes } from "../js/scheduler.js";

const src = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const example = /export const EXAMPLE = `([\s\S]*?)`;/.exec(src)[1];
const today = "2026-11-10";
const { items } = parseSyllabus(example, { today });
const input = { today, availability: [3, 3, 3, 3, 2, 4, 3], session: 1, overrides: {}, tasks: items.map((it, n) => ({ ...it, id: "t" + n, enabled: !it.past })) };
for (let i = 0; i < 20; i++) schedule(input);
let t = performance.now();
for (let i = 0; i < 200; i++) schedule(input);
console.log("schedule avg ms", ((performance.now() - t) / 200).toFixed(2));
const plan = schedule(input);
t = performance.now();
for (const c of plan.crunches) suggestFixes(input, c.date);
console.log("fixes for", plan.crunches.length, "days ms", (performance.now() - t).toFixed(0));
