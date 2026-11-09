import { test } from "node:test";
import assert from "node:assert/strict";
import { schedule, suggestFixes, applyFix, taskWindow, capacityOf } from "../js/scheduler.js";
import { weekday } from "../js/dates.js";

const today = "2026-11-10"; // a Tuesday
const flat = [3, 3, 3, 3, 3, 3, 3];
const sum = (xs) => Math.round(xs.reduce((n, x) => n + x, 0) * 100) / 100;

function task(id, due, hours, type = "essay", extra = {}) {
  return { id, title: id, type, due, hours, ...extra };
}

test("every hour is planned, before the deadline, inside the window", () => {
  const plan = schedule({ today, availability: flat, tasks: [task("a", "2026-11-28", 8)] });
  const t = plan.tasks[0];
  assert.equal(sum(t.sessions.map((s) => s.hours)), 8);
  for (const s of t.sessions) {
    assert.ok(s.date >= t.window.start && s.date < "2026-11-28", s.date);
  }
  assert.equal(plan.crunches.length, 0);
});

test("the window starts lead-time days before the deadline and never before today", () => {
  assert.deepEqual(taskWindow(task("a", "2026-11-28", 8), today), { start: "2026-11-14", end: "2026-11-27" });
  assert.deepEqual(taskWindow(task("b", "2026-11-12", 8), today), { start: "2026-11-10", end: "2026-11-11" });
  assert.deepEqual(taskWindow(task("c", "2026-11-10", 1), today), { start: "2026-11-10", end: "2026-11-10" });
  assert.deepEqual(taskWindow(task("d", "2026-11-28", 8, "essay", { start: "2026-11-01" }), today), { start: "2026-11-10", end: "2026-11-27" });
});

test("no day is filled past its capacity when everything fits", () => {
  const tasks = [task("a", "2026-11-20", 9, "exam"), task("b", "2026-11-21", 6, "essay"), task("c", "2026-11-19", 4, "pset")];
  const plan = schedule({ today, availability: flat, tasks });
  for (const d of plan.days) assert.ok(d.load <= d.capacity + 1e-9, `${d.date} ${d.load}/${d.capacity}`);
  assert.equal(plan.totalOver, 0);
  for (const t of plan.tasks) assert.equal(sum(t.sessions.map((s) => s.hours)), t.hours);
});

test("weekly availability is respected: no work on days with 0 hours", () => {
  const avail = [2, 2, 2, 2, 2, 0, 0]; // weekends off
  const plan = schedule({ today, availability: avail, tasks: [task("a", "2026-11-30", 10)] });
  for (const s of plan.tasks[0].sessions) assert.ok(weekday(s.date) < 5, s.date);
});

test("date overrides change a single day's capacity", () => {
  const input = { today, availability: flat, overrides: { "2026-11-12": 0 }, tasks: [task("a", "2026-11-14", 6, "pset")] };
  assert.equal(capacityOf(input, "2026-11-12"), 0);
  const plan = schedule(input);
  assert.ok(!plan.tasks[0].sessions.some((s) => s.date === "2026-11-12"));
});

test("load is spread rather than piled on the last days", () => {
  const plan = schedule({ today, availability: flat, tasks: [task("a", "2026-11-24", 6, "pset")] });
  const days = new Set(plan.tasks[0].sessions.map((s) => s.date));
  assert.ok(days.size >= 3, `only ${days.size} days used`);
  assert.ok(!days.has("2026-11-23") || days.size === 6);
});

test("milestones come in order and add up to the task's hours", () => {
  const plan = schedule({ today, availability: flat, tasks: [task("a", "2026-11-28", 8)] });
  const t = plan.tasks[0];
  assert.deepEqual(
    t.milestones.map((m) => m.name),
    ["Research & outline", "Write the draft", "Revise & cite", "Final read-through"],
  );
  assert.equal(sum(t.milestones.map((m) => m.hours)), 8);
  assert.deepEqual(t.milestones.map((m) => m.hours), [2, 3.5, 2, 0.5]);
  for (let i = 1; i < t.milestones.length; i++) assert.ok(t.milestones[i].start >= t.milestones[i - 1].finish);
});

test("the repair step moves a flexible task out of the way of a tight one", () => {
  // "long" can use any day from today; "tight" only has Nov 11-12.
  const tasks = [task("long", "2026-11-13", 6, "pset", { start: "2026-11-10" }), task("tight", "2026-11-13", 6, "pset", { start: "2026-11-11" })];
  const plan = schedule({ today, availability: [3, 3, 3, 3, 3, 3, 3], tasks });
  // 12 hours fit exactly into Nov 10-12 (3 days x 3h) only if long takes the 10th... it cannot: 9h capacity < 12h.
  assert.equal(plan.totalOver, 3);
  const plan2 = schedule({ today, availability: [4, 4, 4, 4, 4, 4, 4], tasks });
  assert.equal(plan2.totalOver, 0, JSON.stringify(plan2.days));
});

test("too much work in too few days becomes a crunch collision", () => {
  const tasks = [task("essay", "2026-11-13", 6, "essay"), task("exam", "2026-11-13", 6, "exam")];
  const plan = schedule({ today, availability: flat, tasks });
  assert.ok(plan.totalOver > 0);
  assert.ok(plan.crunches.some((c) => c.collision && c.taskIds.length === 2));
  // Every hour is still planned somewhere.
  for (const t of plan.tasks) assert.equal(sum(t.sessions.map((s) => s.hours)), t.hours);
});

test("past, disabled and zero-hour tasks are left out", () => {
  const plan = schedule({
    today,
    availability: flat,
    tasks: [task("past", "2026-11-01", 4), task("off", "2026-11-20", 4, "essay", { enabled: false }), task("zero", "2026-11-20", 0), task("ok", "2026-11-20", 2)],
  });
  assert.deepEqual(plan.tasks.map((t) => t.id), ["ok"]);
});

test("fixes are verified: each one lowers the overload on that day", () => {
  const input = {
    today,
    availability: flat,
    tasks: [task("essay", "2026-11-26", 20, "essay"), task("exam", "2026-11-26", 20, "exam"), task("ps", "2026-11-25", 6, "pset")],
  };
  const plan = schedule(input);
  assert.ok(plan.crunches.length > 0, "expected a crunch");
  const day = plan.crunches[0].date;
  const fixes = suggestFixes(input, day);
  assert.ok(fixes.length > 0);
  const kinds = new Set(fixes.map((f) => f.kind));
  assert.ok(kinds.has("start-earlier") || kinds.has("move"));
  for (const f of fixes) {
    const after = schedule(applyFix(input, f));
    const before = plan.days.find((d) => d.date === day).over;
    const now = after.days.find((d) => d.date === day)?.over ?? 0;
    assert.ok(now < before, `${f.kind} did not help`);
    assert.ok(after.totalOver < plan.totalOver);
  }
});

test("start-earlier fix sets an earlier start; shrink cuts hours; move adds a day override", () => {
  const input = { today, availability: flat, tasks: [task("e", "2026-11-26", 14, "pset"), task("f", "2026-11-26", 10, "pset")] };
  const plan = schedule(input);
  const fixes = suggestFixes(input, plan.crunches[0].date);
  const start = fixes.find((f) => f.kind === "start-earlier");
  assert.ok(start && start.start < taskWindow(input.tasks.find((t) => t.id === start.taskId), today).start);
  const shrink = fixes.find((f) => f.kind === "shrink");
  if (shrink) assert.ok(applyFix(input, shrink).tasks.find((t) => t.id === shrink.taskId).hours < 14);
  const move = fixes.find((f) => f.kind === "move");
  if (move) assert.ok(applyFix(input, move).overrides[move.to] > capacityOf(input, move.to));
});

test("no crunch means no fixes", () => {
  const input = { today, availability: flat, tasks: [task("a", "2026-11-28", 4)] };
  assert.deepEqual(suggestFixes(input, "2026-11-20"), []);
});
