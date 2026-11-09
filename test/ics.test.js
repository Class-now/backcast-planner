import { test } from "node:test";
import assert from "node:assert/strict";
import { toICS, foldLine, escapeText } from "../js/ics.js";
import { schedule } from "../js/scheduler.js";

const today = "2026-11-10";

test("escapes commas, semicolons, backslashes and newlines", () => {
  assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

test("folds long lines at 75 octets without splitting characters", () => {
  const line = "SUMMARY:" + "日本語のレポート".repeat(10);
  const folded = foldLine(line);
  const enc = new TextEncoder();
  for (const part of folded.split("\r\n")) assert.ok(enc.encode(part).length <= 75);
  assert.equal(folded.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join(""), line);
  assert.equal(foldLine("SHORT:x"), "SHORT:x");
});

test("exports work days and deadlines as all-day events", () => {
  const plan = schedule({ today, availability: [3, 3, 3, 3, 3, 3, 3], tasks: [{ id: "t1", title: "Essay 2", course: "PSYC 101", type: "essay", due: "2026-11-28", hours: 8 }] });
  const ics = toICS(plan, { stamp: "20261110T000000Z" });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  const events = ics.split("BEGIN:VEVENT").length - 1;
  const workDays = new Set(plan.tasks[0].sessions.map((s) => s.date)).size;
  assert.equal(events, workDays + 1);
  assert.match(ics, /UID:t1-due@backcast\.local/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261128\r\nDTEND;VALUE=DATE:20261129/);
  assert.match(ics, /SUMMARY:DUE: PSYC 101: Essay 2/);
  assert.ok(!/\n(?<!\r\n)/.test(ics.replace(/\r\n/g, "")), "only CRLF line endings");
});
