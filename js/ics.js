// iCalendar (RFC 5545) export: one all-day event per task per work day, plus
// one all-day event for each deadline.
import { addDays } from "./dates.js";

export function escapeText(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Folds a content line to 75 octets (UTF-8), continuation lines start with a space. */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines carry a leading space
    if (curBytes + b > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.map((l, i) => (i === 0 ? l : " " + l)).join("\r\n");
}

const compact = (iso) => iso.replace(/-/g, "");
const fmtHours = (h) => `${Math.round(h * 100) / 100}h`;

/**
 * @param {ReturnType<import("./scheduler.js").schedule>} plan
 * @param {{stamp?: string}} opts  stamp: UTC timestamp "YYYYMMDDTHHMMSSZ" (for tests)
 */
export function toICS(plan, opts = {}) {
  const stamp = opts.stamp ?? new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Backcast//Deadline Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Backcast study plan",
  ];
  const event = (uid, date, summary, description) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}@backcast.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(date, 1))}`,
      `SUMMARY:${escapeText(summary)}`,
      `DESCRIPTION:${escapeText(description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  };
  for (const t of plan.tasks) {
    const name = t.course ? `${t.course}: ${t.title}` : t.title;
    const byDate = new Map();
    for (const s of t.sessions) {
      if (!byDate.has(s.date)) byDate.set(s.date, []);
      byDate.get(s.date).push(s);
    }
    for (const [date, ss] of byDate) {
      const h = ss.reduce((n, s) => n + s.hours, 0);
      const steps = ss.map((s) => `${s.milestone} (${fmtHours(s.hours)})`).join(", ");
      event(`${t.id}-${compact(date)}`, date, `${name} — ${ss.map((s) => s.milestone).join(" + ")} (${fmtHours(h)})`, `${steps}\nDue ${t.due}. Planned with Backcast.`);
    }
    event(`${t.id}-due`, t.due, `DUE: ${name}`, `Deadline. ${t.hours}h of work planned before this day.`);
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
