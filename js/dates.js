// Date helpers that work on plain "YYYY-MM-DD" strings.
// All arithmetic is done in UTC so a plan never shifts by a day because of the
// user's time zone or daylight-saving changes.

const DAY_MS = 86400000;

export function toISO(y, m, d) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function isValidYMD(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return isValidYMD(y, m, d);
}

function toMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromMs(ms) {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(iso, n) {
  return fromMs(toMs(iso) + n * DAY_MS);
}

/** Whole days from a to b (b - a). */
export function diffDays(a, b) {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekday(iso) {
  return (new Date(toMs(iso)).getUTCDay() + 6) % 7;
}

/** Inclusive list of ISO dates from a to b. */
export function range(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu, Nov 27" */
export function fmt(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS_SHORT[weekday(iso)]}, ${MONTHS_SHORT[m - 1]} ${d}`;
}

/** "Nov 27" */
export function fmtShort(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

/** "Thursday, November 27, 2026" (for screen readers) */
export function fmtLong(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${WEEKDAYS_LONG[weekday(iso)]}, ${months[m - 1]} ${d}, ${y}`;
}
