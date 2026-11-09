// Turns pasted syllabus text into deadline items.
// Handles English month names ("Nov 28", "28 November 2026"), numeric dates
// ("12/3", "2026-12-03"), and Japanese dates ("11月28日", "2026年12月3日（木）").
import { addDays, diffDays, isValidYMD, toISO } from "./dates.js";

/**
 * Task types: default hours, how many days before the deadline work may start,
 * and the milestones (name, share of the hours) the work is split into.
 */
export const TYPES = {
  essay: {
    label: "Essay / paper",
    hours: 8,
    lead: 14,
    milestones: [
      ["Research & outline", 0.25],
      ["Write the draft", 0.45],
      ["Revise & cite", 0.25],
      ["Final read-through", 0.05],
    ],
  },
  exam: {
    label: "Exam",
    hours: 10,
    lead: 12,
    milestones: [
      ["Summarize notes", 0.3],
      ["Practice problems", 0.4],
      ["Mock exam", 0.2],
      ["Light review", 0.1],
    ],
  },
  quiz: {
    label: "Quiz",
    hours: 2,
    lead: 4,
    milestones: [
      ["Review", 0.6],
      ["Self-test", 0.4],
    ],
  },
  pset: {
    label: "Problem set / homework",
    hours: 4,
    lead: 6,
    milestones: [
      ["Read & attempt", 0.3],
      ["Solve", 0.5],
      ["Check & write up", 0.2],
    ],
  },
  presentation: {
    label: "Presentation",
    hours: 6,
    lead: 10,
    milestones: [
      ["Outline the story", 0.25],
      ["Build slides", 0.45],
      ["Rehearse", 0.3],
    ],
  },
  project: {
    label: "Project",
    hours: 12,
    lead: 21,
    milestones: [
      ["Plan & scope", 0.15],
      ["Build", 0.55],
      ["Test & fix", 0.15],
      ["Write-up", 0.15],
    ],
  },
  reading: {
    label: "Reading / response",
    hours: 2,
    lead: 5,
    milestones: [
      ["Read", 0.75],
      ["Notes & response", 0.25],
    ],
  },
  other: {
    label: "Other",
    hours: 3,
    lead: 7,
    milestones: [
      ["Work", 0.8],
      ["Finish & submit", 0.2],
    ],
  },
};

// Checked in order: the first match wins ("group project presentation" is a presentation).
const TYPE_RULES = [
  ["quiz", /\bquiz(?:zes)?\b|小テスト|確認テスト|ミニテスト/i],
  ["presentation", /\bpresentations?\b|\bslides?\b|\bpitch\b|\bposter\b|\bdemo day\b|プレゼン|発表/i],
  ["exam", /\bmid-?terms?\b|\bfinal exams?\b|\bfinals\b|\bexams?\b|\btests?\b|\bexamination\b|試験|テスト|期末|中間/i],
  ["essay", /\bessays?\b|\bpapers?\b|\breports?\b|\bthesis\b|\bdissertation\b|\bwrite-?up\b|\breflection\b|\breview article\b|レポート|論文|作文|小論|エッセイ|感想文|書評/i],
  ["project", /\bprojects?\b|\bcapstone\b|\bprototype\b|プロジェクト|制作|作品/i],
  ["pset", /\bproblem sets?\b|\bp-?sets?\b|\bhomework\b|\bhw\s?\d*\b|\bassignments?\b|\bworksheets?\b|\bexercises?\b|\blabs?\b|\bcoding\b|課題|宿題|演習|ワーク/i],
  ["reading", /\breadings?\b|\bread\b|\bchapters?\b|\bch\.\s?\d|\bresponse\b|読書|輪読|講読|予習/i],
];

export function detectType(text) {
  for (const [type, re] of TYPE_RULES) if (re.test(text)) return type;
  return "other";
}

const MONTH_INDEX = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const ORD = "(?:st|nd|rd|th)?";

const DATE_PATTERNS = [
  // 2026-12-03, 2026/12/3, 2026.12.3
  { re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, get: (m) => ({ y: +m[1], mo: +m[2], d: +m[3] }) },
  // 2026年12月3日, 12月3日
  { re: /(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日/, get: (m) => ({ y: m[1] ? +m[1] : null, mo: +m[2], d: +m[3] }) },
  // Nov 28, November 28th, 2026
  {
    re: new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})${ORD}\\b(?:,?\\s+(\\d{4})\\b)?`, "i"),
    get: (m) => ({ y: m[3] ? +m[3] : null, mo: MONTH_INDEX[m[1].slice(0, 3).toLowerCase()], d: +m[2] }),
  },
  // 28 Nov, 28th of November 2026
  {
    re: new RegExp(`\\b(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4})\\b)?`, "i"),
    get: (m) => ({ y: m[3] ? +m[3] : null, mo: MONTH_INDEX[m[2].slice(0, 3).toLowerCase()], d: +m[1] }),
  },
  // 12/3, 12/3/26, 12/3/2026 (month first unless the first number cannot be a month)
  {
    // (No lookbehind: older Safari cannot parse it, so the leading character is captured.)
    re: /(^|[^\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/,
    lead: true,
    get: (m, opts) => {
      let a = +m[2];
      let b = +m[3];
      if (opts.dayFirst ? b <= 12 : a > 12) [a, b] = [b, a];
      let y = m[4] ? +m[4] : null;
      if (y !== null && y < 100) y += 2000;
      return { y, mo: a, d: b };
    },
  },
];

/**
 * Finds the first date in a line.
 * Without a year, picks the nearest sensible year: this year, or next year if
 * that date is more than 60 days in the past (a January final pasted in November).
 * Returns { due, index, length } or null.
 */
export function findDate(text, today, opts = {}) {
  // Patterns are tried in priority order, so "Essay 2 Nov 28" reads as Nov 28,
  // not "2 Nov".
  for (const p of DATE_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const { y, mo, d } = p.get(m, opts);
    const baseYear = Number(today.slice(0, 4));
    let year = y ?? baseYear;
    if (!isValidYMD(year, mo, d)) {
      if (y !== null || !isValidYMD(year + 1, mo, d)) continue; // e.g. 13/45 or Feb 30
      year += 1;
    }
    let due = toISO(year, mo, d);
    if (y === null && diffDays(due, today) > 60) {
      if (!isValidYMD(year + 1, mo, d)) continue;
      due = toISO(year + 1, mo, d);
    }
    const skip = p.lead ? m[1].length : 0;
    return { due, index: m.index + skip, length: m[0].length - skip, yearGiven: y !== null };
  }
  return null;
}

function roundHalf(n) {
  return Math.max(0.5, Math.round(n * 2) / 2);
}

/** Estimates work hours from the type and any size hints in the line. */
export function estimateHours(type, text) {
  const base = TYPES[type].hours;
  const words = /(\d[\d,]*)\s*(?:-\s*)?words?\b/i.exec(text);
  const chars = /(\d[\d,]*)\s*(?:字|文字)/.exec(text);
  const pages = /(\d+)\s*(?:-\s*)?(?:pages?|pp\b|枚)/i.exec(text);
  const minutes = /(\d+)\s*(?:-\s*)?(?:min(?:ute)?s?\b|分)/i.exec(text);
  if (type === "essay" || type === "other" || type === "reading" || type === "project") {
    if (words) return roundHalf(2 + Number(words[1].replace(/,/g, "")) / 250);
    if (chars) return roundHalf(2 + Number(chars[1].replace(/,/g, "")) / 600);
    if (pages && type !== "reading") return roundHalf(2 + Number(pages[1]) * 1.5);
    if (pages && type === "reading") return roundHalf(Number(pages[1]) / 20);
  }
  if (type === "presentation" && minutes) return roundHalf(3 + Number(minutes[1]) * 0.5);
  if (type === "exam") {
    const weight = /(\d{1,2})\s*%/.exec(text);
    let h = base;
    if (/\bfinal\b|期末/i.test(text)) h = 14;
    if (weight && Number(weight[1]) >= 30) h *= 1.25;
    return roundHalf(h);
  }
  return base;
}

const COURSE_CODE = /^\s*([A-Z]{2,5}\s?-?\d{2,4}[A-Z]?)\b\s*[:\-–—|]?\s*/;

// Words that are about the deadline, not the task.
const NOISE = [
  // Size and weight hints are used for the hours estimate, not the title.
  /[(（]\s*(?:\d[\d,]*\s*(?:-\s*)?(?:words?|字|文字|pages?|pp|枚|min(?:ute)?s?|分)|\d{1,3}\s*%)[^)）]*[)）]/gi,
  /,?\s*\d[\d,]*\s*(?:-\s*)?(?:words?\b|字|文字|pages?\b|枚|min(?:ute)?s?\b)/gi,
  /,?\s*\d{1,3}\s*%(?:\s*of\s*(?:the\s*)?grade)?/gi,
  /\b(?:is\s+)?due(?:\s+(?:on|by|at|date))?\b/gi,
  /\bdeadline\b/gi,
  /\bsubmit(?:ted)?(?:\s+by)?\b/gi,
  /\bby\b(?=\s*$)/gi,
  /\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi,
  /\b\d{1,2}:\d{2}\b/g,
  /\b(?:at\s+)?(?:midnight|noon)\b/gi,
  /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|sday|urday|rsday)?\b\.?/gi,
  /[（(]\s*[月火水木金土日]\s*(?:曜日?)?\s*[)）]/g,
  /[月火水木金土日]曜日?/g,
  /提出期限|締め?切り?|〆切|期限|提出日?|まで(?:に)?|〆/g,
  /\bweek\s+\d+\b/gi,
];

export function cleanTitle(text) {
  let t = text;
  for (const re of NOISE) t = t.replace(re, " ");
  t = t
    .replace(/^[\s\-–—•*·・:：|,，、。.#>]+/, "")
    .replace(/[\s\-–—•*·・:：|,，、。(（[【]+$/, "")
    .replace(/\(\s*\)|（\s*）|\[\s*\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.:;])/g, "$1")
    .trim();
  t = t.replace(/^[\-–—:：|,，、]+\s*/, "").replace(/\s*[\-–—:：|,，、(（]+$/, "").trim();
  return t;
}

function looksLikeHeader(line) {
  const t = line.trim();
  if (!t || t.length > 70) return null;
  if (/^#{1,6}\s+/.test(t)) return t.replace(/^#{1,6}\s+/, "").replace(/[:：]\s*$/, "").trim();
  if (/^【.+】$/.test(t)) return t.slice(1, -1).trim();
  if (/[:：]\s*$/.test(t)) return t.replace(/[:：]\s*$/, "").trim();
  if (/^[A-Z]{2,5}\s?-?\d{2,4}[A-Z]?\b/.test(t) && t.split(/\s+/).length <= 8) return t;
  return null;
}

/**
 * Parses free text, one deadline per line.
 * @param {string} text
 * @param {{today: string, dayFirst?: boolean}} opts
 * @returns {{items: object[], skipped: {line: string, reason: string}[]}}
 */
export function parseSyllabus(text, opts) {
  const { today } = opts;
  const items = [];
  const skipped = [];
  let course = "";
  const lines = String(text ?? "")
    .normalize("NFKC")
    .split(/\r?\n|;|；/);
  for (const raw of lines) {
    const line = raw.replace(/\t/g, " ").trim();
    if (!line) continue;
    const found = findDate(line, today, opts);
    if (!found) {
      const header = looksLikeHeader(line);
      if (header) course = header;
      else skipped.push({ line, reason: "No date found" });
      continue;
    }
    let rest = line.slice(0, found.index) + " " + line.slice(found.index + found.length);
    let lineCourse = course;
    const code = COURSE_CODE.exec(rest);
    if (code) {
      lineCourse = code[1].replace(/\s+/, " ");
      rest = rest.slice(code[0].length);
    }
    const type = detectType(rest);
    let title = cleanTitle(rest);
    if (!title) title = TYPES[type].label;
    const past = found.due < today;
    items.push({
      title,
      course: lineCourse,
      type,
      due: found.due,
      hours: estimateHours(type, rest),
      source: line,
      past,
    });
  }
  return { items, skipped };
}

/** Earliest day work on a task may start by default. */
export function defaultStart(type, due) {
  return addDays(due, -TYPES[type].lead);
}
