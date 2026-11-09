// Backward planner: fits each deadline's work hours into the days before it,
// respecting daily capacity, then names the work by milestone.
import { addDays, diffDays, range, weekday } from "./dates.js";
import { TYPES } from "./parser.js";

const EPS = 1e-9;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @typedef {{id: string, title: string, course?: string, type: string, due: string,
 *            hours: number, start?: string, enabled?: boolean}} Task
 * @typedef {{tasks: Task[], availability: number[], today: string,
 *            overrides?: Record<string, number>, session?: number}} PlanInput
 */

export function capacityOf(input, date) {
  const o = input.overrides?.[date];
  if (typeof o === "number" && o >= 0) return o;
  return Math.max(0, Number(input.availability[weekday(date)]) || 0);
}

/** The days a task may be worked on: [start, end], both inclusive. */
export function taskWindow(task, today) {
  const lead = TYPES[task.type]?.lead ?? TYPES.other.lead;
  let start = task.start || addDays(task.due, -lead);
  if (start < today) start = today;
  // Work stops the day before the deadline; something due today can still use today.
  let end = addDays(task.due, -1);
  if (end < today) end = today;
  if (start > end) start = end;
  return { start, end };
}

/** Is a task part of the plan (enabled, not past, has hours)? */
export function isActive(task, today) {
  return task.enabled !== false && task.due >= today && Number(task.hours) > 0;
}

/**
 * Builds the plan.
 * 1. Tasks are placed in deadline order. Each work session goes to the day in
 *    the task's window that ends up least full (relative to its capacity), so
 *    the load is spread out and the days right before the deadline stay free.
 * 2. Hours that do not fit are repaired by moving another task's session out of
 *    the way when that task has room elsewhere.
 * 3. Whatever still does not fit lands on the least-full day anyway: that day is
 *    over capacity, which the UI reports as a crunch.
 */
export function schedule(input) {
  const { today } = input;
  const session = input.session > 0 ? input.session : 1;
  const tasks = input.tasks.filter((t) => isActive(t, today));
  const order = [...tasks].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));

  // Work on day indexes (0 = today) with typed arrays: the fix finder re-runs
  // this function dozens of times per click, so it has to be fast.
  const lastDue = order.reduce((m, t) => (t.due > m ? t.due : m), today);
  const dates = range(today, lastDue);
  const N = dates.length;
  const capArr = new Float64Array(N);
  for (let i = 0; i < N; i++) capArr[i] = capacityOf(input, dates[i]);
  const load = new Float64Array(N);
  const alloc = order.map(() => new Float64Array(N));
  const win = order.map((t) => {
    const w = taskWindow(t, today);
    return { start: w.start, end: w.end, s: diffDays(today, w.start), e: diffDays(today, w.end) };
  });
  const unplaced = new Float64Array(order.length);
  const add = (k, i, h) => {
    load[i] += h;
    alloc[k][i] += h;
    if (Math.abs(alloc[k][i]) < EPS) alloc[k][i] = 0;
  };

  for (let k = 0; k < order.length; k++) {
    const { s, e } = win[k];
    let remaining = Number(order[k].hours);
    while (remaining > EPS) {
      const want = Math.min(session, remaining);
      let bi = -1;
      let bput = 0;
      let bratio = Infinity;
      for (let i = s; i <= e; i++) {
        const c = capArr[i];
        if (c <= 0) continue;
        const put = Math.min(want, c - load[i]);
        if (put < Math.min(want, 0.5) - EPS) continue;
        const ratio = (load[i] + put) / c;
        if (ratio < bratio - EPS) {
          bi = i;
          bput = put;
          bratio = ratio;
        }
      }
      if (bi < 0) break;
      add(k, bi, bput);
      remaining -= bput;
    }
    unplaced[k] = remaining > EPS ? remaining : 0;
  }

  // Repair: free up room for overflowing tasks by moving other tasks' sessions.
  for (let k = 0; k < order.length; k++) {
    let need = unplaced[k];
    if (need <= EPS) continue;
    const { s, e } = win[k];
    let progress = true;
    while (need > EPS && progress) {
      progress = false;
      for (let d = s; d <= e && need > EPS; d++) {
        if (capArr[d] <= 0) continue;
        for (let o = 0; o < order.length && need > EPS; o++) {
          if (o === k || alloc[o][d] <= EPS) continue;
          for (let x = win[o].s; x <= win[o].e && need > EPS; x++) {
            if (x === d) continue;
            const mv = Math.min(alloc[o][d], capArr[x] - load[x], need);
            if (mv < 0.25 - EPS) continue;
            add(o, d, -mv);
            add(o, x, mv);
            add(k, d, mv);
            need -= mv;
            progress = true;
          }
        }
      }
    }
    unplaced[k] = need > EPS ? need : 0;
  }

  // Overflow: put what is left where it hurts least.
  const overflow = new Map();
  for (let k = 0; k < order.length; k++) {
    let need = unplaced[k];
    overflow.set(order[k].id, round2(need));
    if (need <= EPS) continue;
    const { s, e } = win[k];
    let days = [];
    for (let i = s; i <= e; i++) if (capArr[i] > 0) days.push(i);
    if (!days.length) days = [e];
    while (need > EPS) {
      const put = Math.min(session, need);
      let bi = days[0];
      let bratio = Infinity;
      for (const i of days) {
        const ratio = (load[i] + put) / Math.max(capArr[i], 0.5);
        if (ratio < bratio - EPS) {
          bi = i;
          bratio = ratio;
        }
      }
      add(k, bi, put);
      need -= put;
    }
  }

  const windows = new Map(order.map((t, k) => [t.id, { start: win[k].start, end: win[k].end }]));
  const allocByDate = new Map(order.map((t, k) => [t.id, [...alloc[k]].map((h, i) => [dates[i], h]).filter(([, h]) => h > EPS)]));
  const loadOf = (date) => load[diffDays(today, date)] ?? 0;
  const cap = (date) => capacityOf(input, date);

  // Name the work: split each task's hours, in date order, into its milestones.
  const planned = order.map((t) => {
    const def = TYPES[t.type] ?? TYPES.other;
    const total = Number(t.hours);
    const bounds = [];
    let acc = 0;
    // Milestone boundaries snap to half hours so sessions read as 1h, 0.5h... not 0.7h.
    const ms = def.milestones;
    for (let i = 0; i < ms.length; i++) {
      acc += ms[i][1] * total;
      const prev = bounds.length ? bounds[bounds.length - 1].end : 0;
      const roomLeft = (ms.length - 1 - i) * 0.5;
      let end = Math.round(acc * 2) / 2;
      if (total >= ms.length * 0.5) end = Math.min(Math.max(end, prev + 0.5), total - roomLeft);
      bounds.push({ name: ms[i][0], end: Math.max(end, prev) });
    }
    bounds[bounds.length - 1].end = total;
    const sessions = [];
    let done = 0;
    let mi = 0;
    for (const [date, h] of allocByDate.get(t.id)) {
      let left = h;
      while (left > EPS) {
        while (mi < bounds.length - 1 && done >= bounds[mi].end - EPS) mi++;
        const room = mi < bounds.length - 1 ? bounds[mi].end - done : left;
        const piece = Math.min(left, room);
        const last = sessions[sessions.length - 1];
        if (last && last.date === date && last.milestone === bounds[mi].name) last.hours += piece;
        else sessions.push({ date, hours: piece, milestone: bounds[mi].name });
        done += piece;
        left -= piece;
      }
    }
    for (const s of sessions) s.hours = round2(s.hours);
    const milestones = bounds.map((b) => {
      const mine = sessions.filter((s) => s.milestone === b.name);
      return {
        name: b.name,
        hours: round2(mine.reduce((n, s) => n + s.hours, 0)),
        start: mine[0]?.date ?? null,
        finish: mine[mine.length - 1]?.date ?? null,
      };
    });
    return { ...t, window: windows.get(t.id), sessions, milestones, overflow: overflow.get(t.id) };
  });

  // Day table, from today to the last deadline.
  const days = dates.map((date) => {
    const items = [];
    for (const t of planned) for (const s of t.sessions) if (s.date === date) items.push({ taskId: t.id, hours: s.hours, milestone: s.milestone });
    const l = round2(loadOf(date)); // exact load, not the sum of rounded pieces
    const c = cap(date);
    const dues = planned.filter((t) => t.due === date).map((t) => t.id);
    return { date, capacity: c, load: l, over: round2(Math.max(0, l - c)), items, dues };
  });

  const crunches = days
    .filter((d) => d.over > EPS)
    .map((d) => {
      const taskIds = [...new Set(d.items.map((i) => i.taskId))];
      return { date: d.date, capacity: d.capacity, load: d.load, over: d.over, taskIds, collision: taskIds.length >= 2 };
    });

  return {
    today,
    tasks: planned,
    days,
    crunches,
    totalHours: round2(planned.reduce((n, t) => n + Number(t.hours), 0)),
    totalOver: round2(crunches.reduce((n, c) => n + c.over, 0)),
  };
}

function overOn(plan, date) {
  return plan.days.find((d) => d.date === date)?.over ?? 0;
}

/**
 * One-click fixes for a crunch day. Every suggestion is verified by re-running
 * the planner, and only kept if it lowers the overload on that day without
 * adding overload elsewhere.
 * Kinds:
 *  - "start-earlier": move the task's start date back.
 *  - "shrink": cut the task's hours by the overload.
 *  - "move": move the overload to another day by giving that day more hours.
 */
export function suggestFixes(input, date) {
  const base = schedule(input);
  const day = base.days.find((d) => d.date === date);
  if (!day || day.over <= EPS) return [];
  const fixes = [];
  const baseOver = day.over;
  const accept = (plan) => overOn(plan, date) < baseOver - EPS && plan.totalOver < base.totalOver - EPS;
  const contributors = [...new Set(day.items.map((i) => i.taskId))]
    .map((id) => ({ task: input.tasks.find((t) => t.id === id), share: day.items.filter((i) => i.taskId === id).reduce((n, i) => n + i.hours, 0) }))
    .filter((c) => c.task)
    .sort((a, b) => b.share - a.share);

  for (const { task } of contributors.slice(0, 3)) {
    const w = taskWindow(task, input.today);
    // Start earlier: smallest shift that clears the day (or the best one tried).
    let bestStart = null;
    // A handful of shifts instead of every day keeps a click fast on old phones.
    const shifts = [1, 2, 3, 5, 7, 10, 14, 21, 28];
    const maxShift = diffDays(input.today, w.start);
    if (maxShift > 0 && !shifts.includes(maxShift) && maxShift < 28) shifts.push(maxShift);
    shifts.sort((a, b) => a - b);
    for (const k of shifts) {
      if (k > maxShift) break;
      const start = addDays(w.start, -k);
      const plan = schedule({ ...input, tasks: input.tasks.map((t) => (t.id === task.id ? { ...t, start } : t)) });
      if (accept(plan) && (!bestStart || plan.totalOver < bestStart.after - EPS)) {
        bestStart = { start, after: plan.totalOver, cleared: overOn(plan, date) <= EPS };
        if (bestStart.cleared && plan.totalOver <= EPS) break;
        if (bestStart.cleared) break;
      }
    }
    if (bestStart) {
      fixes.push({
        kind: "start-earlier",
        taskId: task.id,
        start: bestStart.start,
        days: diffDays(bestStart.start, w.start),
        cleared: bestStart.cleared,
        overAfter: bestStart.after,
      });
    }

    // Shrink: trim the task by the day's overload (at least half an hour left).
    // Try cutting by this day's overload, then by the whole overload; never below half the task.
    const cuts = [...new Set([baseOver, base.totalOver].map((c) => Math.ceil(c * 2) / 2))].sort((a, b) => a - b);
    for (const cut of cuts) {
      const hours = Math.max(0.5, Number(task.hours) - cut);
      if (hours >= Number(task.hours) || hours < Number(task.hours) / 2) continue;
      const plan = schedule({ ...input, tasks: input.tasks.map((t) => (t.id === task.id ? { ...t, hours } : t)) });
      if (accept(plan)) {
        fixes.push({ kind: "shrink", taskId: task.id, hours, from: Number(task.hours), cleared: overOn(plan, date) <= EPS, overAfter: plan.totalOver });
        break;
      }
    }

    // Move: pick another day in reach of this task (from today) and make room there.
    // Try the six lightest days this task could reach.
    const candidates = range(input.today, w.end)
      .filter((d) => d !== date)
      .map((d) => {
        const info = base.days.find((x) => x.date === d);
        const c = capacityOf(input, d);
        return { d, r: (info?.load ?? 0) - c };
      })
      .sort((a, b) => a.r - b.r)
      .slice(0, 6)
      .map((x) => x.d);
    let bestMove = null;
    for (const d of candidates) {
      const c = capacityOf(input, d);
      const dayInfo = base.days.find((x) => x.date === d);
      const free = Math.max(0, c - (dayInfo?.load ?? 0));
      const extra = Math.max(0.5, Math.ceil((baseOver - free) * 2) / 2);
      const newCap = c + extra;
      const t2 = d < w.start ? input.tasks.map((t) => (t.id === task.id ? { ...t, start: d } : t)) : input.tasks;
      const plan = schedule({ ...input, tasks: t2, overrides: { ...(input.overrides ?? {}), [d]: newCap } });
      if (!accept(plan)) continue;
      // Prefer: clears the crunch, fewest added hours, a day that is usually light, closest in time.
      const score = (overOn(plan, date) <= EPS ? 0 : 1000) + plan.totalOver * 100 + extra * 10 + (dayInfo?.load ?? 0) + Math.abs(diffDays(d, date)) * 0.1;
      if (!bestMove || score < bestMove.score) {
        bestMove = { score, to: d, capacity: newCap, from: c, hours: baseOver, start: d < w.start ? d : null, cleared: overOn(plan, date) <= EPS, overAfter: plan.totalOver };
      }
    }
    if (bestMove) {
      const { score, ...rest } = bestMove;
      fixes.push({ kind: "move", taskId: task.id, ...rest });
    }
  }

  // Keep the best few: cleared first, then by remaining overload.
  const ranked = fixes.sort((a, b) => Number(b.cleared) - Number(a.cleared) || a.overAfter - b.overAfter);
  // Lead with the best fix of each kind, so the user sees all three options.
  const firsts = ["start-earlier", "move", "shrink"].map((k) => ranked.find((f) => f.kind === k)).filter(Boolean);
  const leading = firsts.sort((a, b) => ranked.indexOf(a) - ranked.indexOf(b));
  return [...leading, ...ranked.filter((f) => !leading.includes(f))].slice(0, 6);
}

/** Applies a fix returned by suggestFixes to the plan input (returns a new input). */
export function applyFix(input, fix) {
  const tasks = input.tasks.map((t) => {
    if (t.id !== fix.taskId) return t;
    if (fix.kind === "start-earlier") return { ...t, start: fix.start };
    if (fix.kind === "shrink") return { ...t, hours: fix.hours };
    if (fix.kind === "move" && fix.start) return { ...t, start: fix.start };
    return t;
  });
  const overrides = { ...(input.overrides ?? {}) };
  if (fix.kind === "move") overrides[fix.to] = fix.capacity;
  return { ...input, tasks, overrides };
}
