import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSyllabus, findDate, detectType, estimateHours, cleanTitle } from "../js/parser.js";

const today = "2026-11-10";

test("English month names, with and without year", () => {
  assert.equal(findDate("Essay 2 due Nov 28", today).due, "2026-11-28");
  assert.equal(findDate("Final paper: December 9th, 2026", today).due, "2026-12-09");
  assert.equal(findDate("Quiz on 3 Dec", today).due, "2026-12-03");
  assert.equal(findDate("Lab report due 28th of November", today).due, "2026-11-28");
  assert.equal(findDate("Sept. 4 reading", "2026-08-20").due, "2026-09-04");
});

test("a number before the month name is not taken as the day", () => {
  assert.equal(findDate("Essay 2 Nov 28", today).due, "2026-11-28");
  assert.equal(findDate("Problem Set 5 due Dec 1", today).due, "2026-12-01");
});

test("numeric dates: M/D by default, D/M when asked or when unambiguous", () => {
  assert.equal(findDate("Midterm 12/3", today).due, "2026-12-03");
  assert.equal(findDate("Midterm 12/3", today, { dayFirst: true }).due, "2027-03-12");
  assert.equal(findDate("Exam 25/11", today).due, "2026-11-25");
  assert.equal(findDate("HW 12/3/27", today).due, "2027-12-03");
  assert.equal(findDate("2026-12-03 project", today).due, "2026-12-03");
  assert.equal(findDate("2026/12/3 project", today).due, "2026-12-03");
});

test("Japanese dates, including full-width digits and weekday marks", () => {
  const { items } = parseSyllabus("レポート 11月28日（金）締切\n期末試験 2027年1月20日\n小テスト　１２月３日", { today });
  assert.deepEqual(
    items.map((i) => [i.due, i.type]),
    [
      ["2026-11-28", "essay"],
      ["2027-01-20", "exam"],
      ["2026-12-03", "quiz"],
    ],
  );
  assert.equal(items[0].title, "レポート");
});

test("year rolls over for dates far in the past (a January final pasted in November)", () => {
  assert.equal(findDate("Final exam Jan 20", today).due, "2027-01-20");
  // A recent date stays in this year and is marked as past.
  const { items } = parseSyllabus("Quiz 1 Nov 3", { today });
  assert.equal(items[0].due, "2026-11-03");
  assert.equal(items[0].past, true);
});

test("invalid dates are not accepted", () => {
  assert.equal(findDate("Room 13/45", today), null);
  assert.equal(findDate("Feb 30", today), null);
  assert.equal(findDate("Version 1/2/3/4", today), null);
});

test("types are detected from keywords", () => {
  assert.equal(detectType("Essay 2"), "essay");
  assert.equal(detectType("Midterm"), "exam");
  assert.equal(detectType("Problem Set 5"), "pset");
  assert.equal(detectType("Group project presentation"), "presentation");
  assert.equal(detectType("Final project"), "project");
  assert.equal(detectType("Final paper"), "essay");
  assert.equal(detectType("Quiz 4"), "quiz");
  assert.equal(detectType("Read chapters 4-6"), "reading");
  assert.equal(detectType("中間試験"), "exam");
  assert.equal(detectType("発表"), "presentation");
  assert.equal(detectType("課題3"), "pset");
  assert.equal(detectType("Club meeting"), "other");
});

test("hours are sized from words, characters, pages and minutes", () => {
  assert.equal(estimateHours("essay", "Essay 2 (2,000 words)"), 10);
  assert.equal(estimateHours("essay", "レポート 2000字"), 5.5);
  assert.equal(estimateHours("essay", "Paper, 4 pages"), 8);
  assert.equal(estimateHours("presentation", "10-minute presentation"), 8);
  assert.equal(estimateHours("exam", "Final exam (40%)"), 17.5);
  assert.equal(estimateHours("pset", "Problem set 5"), 4);
});

test("titles drop deadline words, times and weekdays", () => {
  assert.equal(cleanTitle("Essay 2 due  "), "Essay 2");
  assert.equal(cleanTitle("Problem Set 5 due Friday at 11:59pm"), "Problem Set 5");
  assert.equal(cleanTitle("- Midterm (Thu)"), "Midterm");
  assert.equal(cleanTitle("レポート (金) 締切"), "レポート");
});

test("course headers and course codes are attached to items", () => {
  const text = [
    "PSYC 101 — Intro to Psychology",
    "Essay 2 due Nov 28 (1500 words)",
    "Midterm 12/3",
    "",
    "## 日本文学史",
    "レポート 12月10日",
    "HIST 210: Response paper Dec 1",
    "Office hours are on Tuesdays",
  ].join("\n");
  const { items, skipped } = parseSyllabus(text, { today });
  assert.deepEqual(
    items.map((i) => [i.course, i.title, i.due]),
    [
      ["PSYC 101 — Intro to Psychology", "Essay 2", "2026-11-28"],
      ["PSYC 101 — Intro to Psychology", "Midterm", "2026-12-03"],
      ["日本文学史", "レポート", "2026-12-10"],
      ["HIST 210", "Response paper", "2026-12-01"],
    ],
  );
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].line, /Office hours/);
});

test("semicolons split several deadlines on one line", () => {
  const { items } = parseSyllabus("Quiz 3 Nov 20; Quiz 4 Dec 4", { today });
  assert.deepEqual(items.map((i) => i.due), ["2026-11-20", "2026-12-04"]);
});

test("empty input gives nothing", () => {
  assert.deepEqual(parseSyllabus("", { today }), { items: [], skipped: [] });
  assert.deepEqual(parseSyllabus(undefined, { today }), { items: [], skipped: [] });
});
