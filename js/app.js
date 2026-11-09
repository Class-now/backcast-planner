// Backcast UI. All state lives in localStorage; nothing leaves the browser.
import { addDays, diffDays, fmt, fmtLong, fmtShort, isISODate, todayISO, weekday, WEEKDAYS_SHORT, WEEKDAYS_LONG } from "./dates.js";
import { parseSyllabus, TYPES, estimateHours } from "./parser.js";
import { schedule, suggestFixes, applyFix, taskWindow, capacityOf } from "./scheduler.js";
import { toICS } from "./ics.js";

const KEY = "backcast:v1";
const $ = (sel) => document.querySelector(sel);

// ?today=YYYY-MM-DD pins "today" (used for the recorded demo and screenshots).
const params = new URLSearchParams(location.search);
const TODAY = isISODate(params.get("today")) ? params.get("today") : todayISO();

export const EXAMPLE = `PSYC 101 — Intro to Psychology
Essay 2 due Nov 28 (2,000 words)
Quiz 4 Nov 20
Midterm 12/3 (30%)

HIST 210: Response paper Dec 1, 1,200 words
HIST 210: Group presentation 12/4 (10 min)

## 日本語 III
レポート 11月30日（月）締切 2000字
小テスト 12月2日

MATH 220 Problem Set 7 due Friday Nov 27 at 11:59pm
MATH 220 Problem Set 8 due Dec 4
CHEM 110 Lab report due Dec 2 (4 pages)
CS 150 Final project Dec 11
Office hours moved to Thursdays`;

const DEFAULT_WEEK = [3, 3, 3, 3, 2, 4, 3];

let state = load();
let history = [];
let plan = null;
let selected = null;
let lastSkipped = [];

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && Array.isArray(s.tasks)) {
      return { text: "", availability: DEFAULT_WEEK, session: 1, overrides: {}, dayFirst: false, nextId: 1, ...s };
    }
  } catch (e) {
    /* ignore broken storage */
  }
  return { text: "", tasks: [], availability: [...DEFAULT_WEEK], session: 1, overrides: {}, dayFirst: false, nextId: 1 };
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* storage full or blocked: the app still works for this visit */
  }
}

function snapshot() {
  history.push(JSON.stringify({ tasks: state.tasks, overrides: state.overrides, availability: state.availability, session: state.session }));
  if (history.length > 30) history.shift();
  $("#undo").disabled = false;
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  Object.assign(state, JSON.parse(prev));
  $("#undo").disabled = history.length === 0;
  save();
  renderAll();
  toast("Undone.");
}

const planInput = () => ({ tasks: state.tasks, availability: state.availability, overrides: state.overrides, session: Number(state.session), today: TODAY });
const taskById = (id) => state.tasks.find((t) => t.id === id);
const nameOf = (t) => (t.course ? `${shortCourse(t.course)}: ${t.title}` : t.title);
const hrs = (h) => `${Math.round(h * 10) / 10}h`;
function shortCourse(c) {
  const code = /^[A-Z]{2,5}\s?-?\d{2,4}[A-Z]?/.exec(c);
  return code ? code[0] : c.split(/\s+[—–-]\s+/)[0];
}
/** One line per task per day: total hours and the milestones touched. */
function byTask(items) {
  const m = new Map();
  for (const i of items) {
    if (!m.has(i.taskId)) m.set(i.taskId, { taskId: i.taskId, hours: 0, steps: [] });
    const g = m.get(i.taskId);
    g.hours += i.hours;
    if (!g.steps.includes(i.milestone)) g.steps.push(i.milestone);
  }
  return [...m.values()];
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/* ---------- Step 1: parse ---------- */

function parseNow() {
  const text = $("#paste").value;
  state.text = text;
  const { items, skipped } = parseSyllabus(text, { today: TODAY, dayFirst: state.dayFirst });
  lastSkipped = skipped;
  if (!items.length) {
    setStatus(text.trim() ? "No dates found. Try formats like “Essay due Nov 28”, “Midterm 12/3” or “11月28日”." : "Paste some deadlines first.");
    renderSkipped();
    return;
  }
  snapshot();
  state.tasks = items.map((it) => ({
    id: `t${state.nextId++}`,
    title: it.title,
    course: it.course,
    type: it.type,
    due: it.due,
    hours: it.hours,
    hoursAuto: true,
    source: it.source,
    enabled: !it.past,
    past: it.past,
  }));
  state.overrides = {};
  selected = null;
  save();
  const past = items.filter((i) => i.past).length;
  setStatus(`Found ${items.length} deadline${items.length === 1 ? "" : "s"}${past ? ` (${past} already passed, left out)` : ""}${skipped.length ? ` · ${skipped.length} line${skipped.length === 1 ? "" : "s"} without a date` : ""}.`, true);
  renderSkipped();
  renderAll();
}

function setStatus(msg, good = false) {
  const el = $("#parse-status");
  el.textContent = msg;
  el.className = "status" + (good ? " good" : "");
}

function renderSkipped() {
  const box = $("#skipped");
  box.hidden = lastSkipped.length === 0;
  $("#skipped-list").innerHTML = lastSkipped.map((s) => `<li>${esc(s.line)}</li>`).join("");
}

/* ---------- Step 2: task editor ---------- */

function typeOptions(sel) {
  return Object.entries(TYPES)
    .map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${esc(v.label)}</option>`)
    .join("");
}

function renderTasks() {
  const box = $("#tasks");
  $("#no-tasks").hidden = state.tasks.length > 0;
  const sorted = [...state.tasks].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  box.innerHTML = sorted
    .map((t) => {
      const w = taskWindow(t, TODAY);
      const id = esc(t.id);
      const past = t.due < TODAY;
      return `<div class="task${t.enabled === false ? " off" : ""}${past ? " past" : ""}" data-id="${id}">
        <input class="on" type="checkbox" data-f="enabled" ${t.enabled === false ? "" : "checked"} aria-label="Include ${esc(t.title)} in the plan">
        <div class="top">
          <input class="title" type="text" data-f="title" value="${esc(t.title)}" aria-label="Title">
          <button class="del" type="button" data-act="del" aria-label="Remove ${esc(t.title)}">×</button>
          ${t.course ? `<span class="course">${esc(t.course)}</span>` : ""}
        </div>
        <div class="fields">
          <label>Type<select data-f="type">${typeOptions(t.type)}</select></label>
          <label>Due<input type="date" data-f="due" value="${esc(t.due)}"></label>
          <label>Hours<input type="number" data-f="hours" min="0" max="200" step="0.5" value="${esc(t.hours)}" inputmode="decimal"></label>
        </div>
        ${past ? `<p class="note">This date has passed, so it is not planned.</p>` : ""}
        <details class="more">
          <summary>More: course, earliest start</summary>
          <div class="fields">
            <label>Course<input type="text" data-f="course" value="${esc(t.course || "")}"></label>
            <label>Start no earlier than<input type="date" data-f="start" value="${esc(t.start || "")}" placeholder="${esc(w.start)}"></label>
          </div>
          <p class="small muted">Default start: ${esc(fmt(addDays(t.due, -(TYPES[t.type]?.lead ?? 7))))} (${TYPES[t.type]?.lead ?? 7} days before).${t.source ? ` From: “${esc(t.source)}”` : ""}</p>
        </details>
      </div>`;
    })
    .join("");
}

let editTimer = null;
function onTaskInput(e) {
  const el = e.target;
  const f = el.dataset.f;
  const row = el.closest(".task");
  if (!f || !row) return;
  const t = taskById(row.dataset.id);
  if (!t) return;
  if (!editTimer) snapshot();
  clearTimeout(editTimer);
  if (f === "enabled") t.enabled = el.checked;
  else if (f === "hours") {
    const v = Number(el.value);
    if (!Number.isFinite(v) || v < 0) return;
    t.hours = v;
    t.hoursAuto = false;
  } else if (f === "type") {
    t.type = el.value;
    if (t.hoursAuto) t.hours = estimateHours(t.type, t.source || t.title);
  } else if (f === "due" || f === "start") {
    if (el.value && !isISODate(el.value)) return;
    t[f] = el.value || undefined;
    if (f === "due") t.past = t.due < TODAY;
  } else t[f] = el.value;
  save();
  const structural = f === "type" || f === "enabled" || f === "due";
  editTimer = setTimeout(() => {
    editTimer = null;
    if (structural) renderTasks();
  }, 600);
  if (structural && e.type === "change") renderTasks();
  renderPlan();
}

function onTaskClick(e) {
  const btn = e.target.closest("[data-act='del']");
  if (!btn) return;
  const id = btn.closest(".task").dataset.id;
  const t = taskById(id);
  snapshot();
  state.tasks = state.tasks.filter((x) => x.id !== id);
  save();
  renderAll();
  toast(`Removed “${t.title}”.`, true);
}

function addTask() {
  snapshot();
  const t = { id: `t${state.nextId++}`, title: "New deadline", course: "", type: "pset", due: addDays(TODAY, 7), hours: TYPES.pset.hours, hoursAuto: true, enabled: true };
  state.tasks.push(t);
  save();
  renderAll();
  const input = document.querySelector(`.task[data-id="${t.id}"] .title`);
  if (input) {
    input.focus();
    input.select();
  }
}

/* ---------- Step 3: week ---------- */

function renderWeek() {
  $("#week").innerHTML = WEEKDAYS_SHORT.map(
    (d, i) => `<label>${d}<input type="number" min="0" max="16" step="0.5" value="${esc(state.availability[i])}" data-day="${i}" aria-label="${WEEKDAYS_LONG[i]} study hours" inputmode="decimal"></label>`,
  ).join("");
  $("#session").value = String(state.session);
  const entries = Object.entries(state.overrides).sort();
  $("#overrides-box").hidden = entries.length === 0;
  $("#overrides").innerHTML = entries
    .map(([d, h]) => `<li><span>${esc(fmt(d))}: ${hrs(h)} <span class="muted">(usually ${hrs(state.availability[weekday(d)])})</span></span><button type="button" class="link" data-ov="${esc(d)}">Remove</button></li>`)
    .join("");
}

/* ---------- Step 4: plan ---------- */

function level(d) {
  if (d.over > 0) return "over";
  if (d.load <= 0) return "l0";
  const r = d.capacity > 0 ? d.load / d.capacity : 1;
  if (r <= 0.25) return "l1";
  if (r <= 0.5) return "l2";
  if (r <= 0.85) return "l3";
  return "l4";
}

function renderPlan() {
  plan = schedule(planInput());
  renderStats();
  renderAlerts();
  renderHeat();
  renderDay();
  renderTimeline();
  renderAgenda();
}

function renderStats() {
  const active = plan.tasks.length;
  const workDays = plan.days.filter((d) => d.load > 0).length;
  const busiest = plan.days.reduce((m, d) => (!m || d.load > m.load ? d : m), null);
  const crunch = plan.crunches.length;
  $("#stats").innerHTML = active
    ? `<div class="stat"><div class="v">${hrs(plan.totalHours)}</div><div class="k">of work across ${active} deadline${active === 1 ? "" : "s"}</div></div>
       <div class="stat"><div class="v">${workDays}</div><div class="k">study days until ${esc(fmtShort(plan.days[plan.days.length - 1].date))}</div></div>
       <div class="stat ${crunch ? "bad" : "ok"}"><div class="v">${crunch ? `<span aria-hidden="true">⚠ </span>${crunch}` : "0"}</div><div class="k">crunch day${crunch === 1 ? "" : "s"}${crunch ? ` (+${hrs(plan.totalOver)} over)` : " — it all fits"}</div></div>
       <div class="stat"><div class="v">${busiest && busiest.load ? hrs(busiest.load) : "–"}</div><div class="k">busiest day${busiest && busiest.load ? `: ${esc(fmtShort(busiest.date))}` : ""}</div></div>`
    : "";
}

function fixLabel(f) {
  const t = taskById(f.taskId);
  const n = esc(t ? t.title : "task");
  const res = `<span class="res${f.cleared ? "" : " partial"}">${f.cleared ? "clears this day" : `leaves +${hrs(f.overAfter)} overall`}</span>`;
  if (f.kind === "start-earlier") return `<span class="kind">Start earlier</span><span>Start “${n}” on ${esc(fmtShort(f.start))} (${f.days} day${f.days === 1 ? "" : "s"} sooner)</span>${res}`;
  if (f.kind === "shrink") return `<span class="kind">Shrink</span><span>Cut “${n}” to ${hrs(f.hours)} (−${hrs(f.from - f.hours)})</span>${res}`;
  return `<span class="kind">Move</span><span>Move ${hrs(f.hours)} of “${n}” to ${esc(fmt(f.to))} (study ${hrs(f.capacity)} that day, not ${hrs(f.from)})</span>${res}`;
}

function fixText(f) {
  const t = taskById(f.taskId);
  const n = t ? t.title : "task";
  if (f.kind === "start-earlier") return `Started “${n}” on ${fmtShort(f.start)}.`;
  if (f.kind === "shrink") return `Cut “${n}” to ${hrs(f.hours)}.`;
  return `Moved work to ${fmt(f.to)} (${hrs(f.capacity)} that day).`;
}

let fixCache = new Map();
function fixesFor(date) {
  const key = JSON.stringify([date, planInput()]);
  if (!fixCache.has(key)) {
    if (fixCache.size > 50) fixCache = new Map();
    fixCache.set(key, suggestFixes(planInput(), date));
  }
  return fixCache.get(key);
}

function fixButtons(date) {
  const fixes = fixesFor(date);
  if (!fixes.length) return `<p class="small muted">No single change clears this day. Try raising your hours for the week or dropping something.</p>`;
  return `<div class="fixes">${fixes
    .slice(0, 3)
    .map((f, i) => `<button type="button" class="fix" data-fix-date="${esc(date)}" data-fix="${i}">${fixLabel(f)}</button>`)
    .join("")}</div>`;
}

function crunchText(c) {
  const names = c.taskIds.map((id) => taskById(id)).filter(Boolean).map((t) => `“${esc(t.title)}”`);
  return `${hrs(c.load)} planned, ${hrs(c.capacity)} available. ${names.join(" and ").replace(/” and “(?=.*” and “)/g, "”, “")} ${c.collision ? "collide here" : "can’t fit before its deadline"}.`;
}

function renderAlerts() {
  const box = $("#alerts");
  if (!plan.tasks.length) {
    box.innerHTML = "";
    return;
  }
  if (!plan.crunches.length) {
    box.innerHTML = `<div class="alert calm"><h3><span aria-hidden="true">✓</span> No crunch days</h3><p>Every deadline fits into your week with the hours you set. Export it to your calendar and start with today’s list.</p></div>`;
    return;
  }
  // One alert: the selected crunch day (or the first one) with its fixes, plus
  // links to the other crunch days.
  const c = plan.crunches.find((x) => x.date === selected) || plan.crunches[0];
  const others = plan.crunches.filter((x) => x !== c);
  const n = plan.crunches.length;
  box.innerHTML = `<div class="alert${c.collision ? "" : " single"}">
      <h3><span aria-hidden="true">⚠</span> ${c.collision ? "Crunch collision" : "Over capacity"} · ${esc(fmt(c.date))} <span class="small">(+${hrs(c.over)})</span></h3>
      <p>${crunchText(c)} One click to fix it:</p>
      ${fixButtons(c.date)}
      ${others.length ? `<p class="others small">${n} crunch days in total. Also: ${others.map((o) => `<button type="button" class="link" data-goto="${o.date}">${esc(fmtShort(o.date))} (+${hrs(o.over)})</button>`).join(" ")}</p>` : ""}
    </div>`;
}

function renderHeat() {
  const body = $("#heat tbody");
  if (!plan.days.length || !plan.tasks.length) {
    body.innerHTML = `<tr><td colspan="8" class="muted small" style="padding:1rem">Your workload calendar appears here.</td></tr>`;
    return;
  }
  const first = addDays(plan.days[0].date, -weekday(plan.days[0].date));
  const last = plan.days[plan.days.length - 1].date;
  const byDate = new Map(plan.days.map((d) => [d.date, d]));
  let html = "";
  for (let wk = first; wk <= last; wk = addDays(wk, 7)) {
    html += `<tr><th scope="row">${esc(fmtShort(wk))}</th>`;
    for (let i = 0; i < 7; i++) {
      const date = addDays(wk, i);
      const d = byDate.get(date);
      if (!d) {
        html += `<td><button type="button" class="cell pad" disabled aria-label="${esc(fmtLong(date))}: outside the plan"><span class="d">${Number(date.slice(8))}</span></button></td>`;
        continue;
      }
      const lv = level(d);
      const dues = d.dues.map((id) => taskById(id)).filter(Boolean);
      const label = `${fmtLong(date)}${date === TODAY ? " (today)" : ""}: ${hrs(d.load)} planned of ${hrs(d.capacity)} available${d.over ? `, over by ${hrs(d.over)}${new Set(d.items.map((x) => x.taskId)).size > 1 ? ", crunch collision" : ""}` : ""}${dues.length ? `. Due: ${dues.map((t) => t.title).join(", ")}` : ""}`;
      html += `<td><button type="button" class="cell ${lv}${date === TODAY ? " today" : ""}${date === selected ? " sel" : ""}" data-date="${date}" aria-label="${esc(label)}" aria-pressed="${date === selected}" title="${esc(label)}">
        <span class="d"><span>${Number(date.slice(8))}${d.over ? ' <span class="warn" aria-hidden="true">!</span>' : ""}</span>${dues.length ? `<span class="due" aria-hidden="true">◆${dues.length > 1 ? dues.length : ""}</span>` : ""}</span>
        <span class="h" aria-hidden="true">${d.load ? `${hrs(d.load)}/${hrs(d.capacity)}` : d.capacity ? "" : "off"}</span>
      </button></td>`;
    }
    html += "</tr>";
  }
  body.innerHTML = html;
}

function renderDay() {
  const box = $("#day");
  const d = plan.days.find((x) => x.date === selected);
  if (!d || !plan.tasks.length) {
    box.innerHTML = plan.tasks.length ? `<p class="small muted">Select a day in the calendar to see what to do and how to fix a crunch.</p>` : "";
    return;
  }
  const dues = d.dues.map(taskById).filter(Boolean);
  const items = byTask(d.items)
    .map((i) => {
      const t = taskById(i.taskId);
      return `<li><span class="hrs">${hrs(i.hours)}</span><span><b>${esc(t ? nameOf(t) : "")}</b> — ${esc(i.steps.join(" → "))} <span class="muted small">(due ${esc(t ? fmtShort(t.due) : "")})</span></span></li>`;
    })
    .join("");
  const cap = capacityOf(planInput(), d.date);
  box.innerHTML = `<h3>${esc(fmt(d.date))}${d.date === TODAY ? " · today" : ""}</h3>
    <p class="small ${d.over ? "" : "muted"}">${hrs(d.load)} planned · ${hrs(cap)} available${d.over ? ` · <b class="tag-over">over by ${hrs(d.over)}</b>` : ""}${state.overrides[d.date] !== undefined ? " (changed for this day)" : ""}</p>
    ${items ? `<ul>${items}</ul>` : `<p class="small muted">Nothing planned.</p>`}
    ${dues.length ? `<p class="small"><b class="due-dot" aria-hidden="true">◆</b> Due today: ${dues.map((t) => esc(nameOf(t))).join(", ")}</p>` : ""}
    <div class="row"><label for="day-cap" class="small">Hours available this day</label><input id="day-cap" type="number" min="0" max="16" step="0.5" value="${esc(cap)}" style="width:5.5rem" data-cap-date="${d.date}" inputmode="decimal"></div>`;
}

function renderTimeline() {
  const ol = $("#timeline");
  if (!plan.tasks.length) {
    ol.innerHTML = `<li class="muted small">Milestones appear here once you add deadlines.</li>`;
    return;
  }
  ol.innerHTML = plan.tasks
    .map((t) => {
      const total = t.milestones.reduce((n, m) => n + m.hours, 0) || 1;
      const span = (m) => {
        if (!m.start) return "—";
        if (m.start === m.finish) return fmtShort(m.start);
        const sameMonth = m.start.slice(0, 7) === m.finish.slice(0, 7);
        return `${fmtShort(m.start)}–${sameMonth ? Number(m.finish.slice(8)) : fmtShort(m.finish)}`;
      };
      const left = diffDays(TODAY, t.due);
      return `<li>
        <div class="tt"><span class="name">${esc(nameOf(t))}</span><span class="meta">${esc(TYPES[t.type]?.label || t.type)} · ${hrs(t.hours)} · due ${esc(fmt(t.due))} (${left === 0 ? "today" : `in ${left} day${left === 1 ? "" : "s"}`})</span></div>
        <div class="bar" aria-hidden="true">${t.milestones.map((m) => `<span style="width:${(m.hours / total) * 100}%"></span>`).join("")}</div>
        <ul class="ms">${t.milestones.map((m) => `<li><b>${esc(m.name)}</b> · ${hrs(m.hours)} · ${esc(span(m))}</li>`).join("")}</ul>
        ${t.overflow > 0 ? `<p class="tag-over"><span aria-hidden="true">⚠ </span>${hrs(t.overflow)} doesn’t fit in your available hours before the deadline.</p>` : ""}
      </li>`;
    })
    .join("");
}

function renderAgenda() {
  const box = $("#agenda");
  $("#printed").textContent = fmt(TODAY);
  const days = plan.days.filter((d) => d.items.length || d.dues.length);
  if (!days.length) {
    box.innerHTML = `<p class="muted small">Your day-by-day checklist appears here.</p>`;
    return;
  }
  box.innerHTML = days
    .map((d) => {
      const lines = byTask(d.items).map((i) => {
        const t = taskById(i.taskId);
        return `<li><span class="box" aria-hidden="true"></span><span>${hrs(i.hours)} · ${esc(t ? nameOf(t) : "")} — ${esc(i.steps.join(" → "))}</span></li>`;
      });
      for (const id of d.dues) {
        const t = taskById(id);
        if (t) lines.push(`<li class="duel"><span aria-hidden="true">◆</span><span>Due: ${esc(nameOf(t))}</span></li>`);
      }
      return `<div class="ad${d.over ? " over" : ""}"><div class="when">${esc(fmt(d.date))}${d.over ? ` <span class="small">(+${hrs(d.over)})</span>` : ""}</div><ul>${lines.join("")}</ul></div>`;
    })
    .join("");
}

function renderAll() {
  renderTasks();
  renderWeek();
  renderPlan();
}

/* ---------- actions ---------- */

function applyFixAt(date, i) {
  const f = fixesFor(date)[i];
  if (!f) return;
  snapshot();
  const next = applyFix(planInput(), f);
  state.tasks = next.tasks;
  state.overrides = next.overrides;
  save();
  renderAll();
  toast(fixText(f), true);
  const stillOver = plan.days.find((d) => d.date === date)?.over > 0;
  if (!stillOver && selected === date) selected = date;
}

let toastTimer = null;
function toast(msg, withUndo = false) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${withUndo ? '<button type="button" data-undo>Undo</button>' : ""}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 6000);
}

function exportICS() {
  if (!plan || !plan.tasks.length) return toast("Add some deadlines first.");
  const blob = new Blob([toICS(plan)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backcast-plan-${TODAY}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast("Calendar file downloaded. Open it to add the plan to Google, Apple or Outlook Calendar.");
}

function moveFocus(from, delta) {
  const cells = [...document.querySelectorAll("#heat .cell[data-date]")];
  const date = addDays(from, delta);
  const target = cells.find((c) => c.dataset.date === date);
  if (target) target.focus();
}

function wire() {
  $("#paste").value = state.text || "";
  $("#dayfirst").checked = !!state.dayFirst;
  $("#parse").addEventListener("click", parseNow);
  $("#example").addEventListener("click", () => {
    $("#paste").value = EXAMPLE;
    parseNow();
  });
  $("#dayfirst").addEventListener("change", (e) => {
    state.dayFirst = e.target.checked;
    save();
  });
  $("#tasks").addEventListener("input", onTaskInput);
  $("#tasks").addEventListener("change", onTaskInput);
  $("#tasks").addEventListener("click", onTaskClick);
  $("#add-task").addEventListener("click", addTask);
  $("#week").addEventListener("change", (e) => {
    const i = Number(e.target.dataset.day);
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0 || state.availability[i] === v) return;
    snapshot();
    state.availability = state.availability.map((x, j) => (j === i ? v : x));
    save();
    renderPlan();
  });
  $("#session").addEventListener("change", (e) => {
    snapshot();
    state.session = Number(e.target.value);
    save();
    renderPlan();
  });
  $("#overrides").addEventListener("click", (e) => {
    const d = e.target.dataset.ov;
    if (!d) return;
    snapshot();
    const o = { ...state.overrides };
    delete o[d];
    state.overrides = o;
    save();
    renderAll();
  });
  $("#plan").addEventListener("click", (e) => {
    const cell = e.target.closest(".cell[data-date]");
    if (cell) {
      selected = selected === cell.dataset.date ? null : cell.dataset.date;
      renderAlerts();
      renderHeat();
      renderDay();
      const again = document.querySelector(`#heat .cell[data-date="${cell.dataset.date}"]`);
      if (again) again.focus();
      return;
    }
    const go = e.target.closest("[data-goto]");
    if (go) {
      selected = go.dataset.goto;
      renderAlerts();
      renderHeat();
      renderDay();
      return;
    }
    const fix = e.target.closest("[data-fix]");
    if (fix) applyFixAt(fix.dataset.fixDate, Number(fix.dataset.fix));
  });
  $("#plan").addEventListener("change", (e) => {
    const d = e.target.dataset.capDate;
    if (!d) return;
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0) return;
    snapshot();
    state.overrides = { ...state.overrides, [d]: v };
    if (v === state.availability[weekday(d)]) delete state.overrides[d];
    save();
    renderAll();
  });
  $("#heat").addEventListener("keydown", (e) => {
    const cell = e.target.closest(".cell[data-date]");
    if (!cell) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      moveFocus(cell.dataset.date, step);
    }
  });
  $("#undo").addEventListener("click", undo);
  $("#toast").addEventListener("click", (e) => {
    if (e.target.closest("[data-undo]")) {
      $("#toast").hidden = true;
      undo();
    }
  });
  $("#ics").addEventListener("click", exportICS);
  $("#print").addEventListener("click", () => window.print());
  $("#reset").addEventListener("click", () => {
    if (!confirm("Clear all deadlines and settings saved in this browser?")) return;
    localStorage.removeItem(KEY);
    state = load();
    history = [];
    selected = null;
    $("#paste").value = "";
    $("#undo").disabled = true;
    setStatus("");
    lastSkipped = [];
    renderSkipped();
    renderAll();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "z" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) {
      e.preventDefault();
      undo();
    }
  });
}

wire();
renderAll();
