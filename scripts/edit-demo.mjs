// Turns raw.webm + marks.json from record-demo.mjs into demo.mp4 (marked spans
// sped up) and writes transcript.md from captions.json with edited timestamps.
// Usage: node scripts/edit-demo.mjs [demo-dir] [submission-dir]
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "demo-out";
const sub = process.argv[3] ?? "submission";
const { marks, total } = JSON.parse(readFileSync(join(dir, "marks.json"), "utf8"));
const captions = JSON.parse(readFileSync(join(dir, "captions.json"), "utf8"));
const spans = [...marks].sort((a, b) => a.start - b.start);
const segs = [];
let t = 0;
for (const s of spans) {
  if (s.start > t) segs.push({ a: t, b: s.start, speed: 1 });
  segs.push({ a: s.start, b: s.end, speed: s.speed });
  t = s.end;
}
segs.push({ a: t, b: total, speed: 1 });
const parts = segs.map((s, i) => `[0:v]trim=start=${s.a.toFixed(3)}:end=${s.b.toFixed(3)},setpts=(PTS-STARTPTS)/${s.speed}[v${i}]`);
const filter = `${parts.join(";")};${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,fps=30,format=yuv420p[out]`;
const mapTime = (x) => {
  let acc = 0;
  for (const s of segs) {
    if (x <= s.b) return acc + (Math.max(x, s.a) - s.a) / s.speed;
    acc += (s.b - s.a) / s.speed;
  }
  return acc;
};
const length = mapTime(total);
console.log("segments", segs.length, "→ length", length.toFixed(1), "s");
const mp4 = join(dir, "demo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(dir, "raw.webm"), "-filter_complex", filter, "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "24", "-movflags", "+faststart", mp4], { stdio: "inherit" });
copyFileSync(mp4, join(sub, "demo.mp4"));
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const lines = captions.map((c) => `- **${mmss(mapTime(c.at))}** ${c.text}`);
writeFileSync(
  join(sub, "transcript.md"),
  `# Backcast demo video — caption transcript\n\nSilent screen recording (no audio). These are the on-screen captions, in order, with timestamps.\nLength: ${mmss(length)} · Recorded headless with Playwright on the live app (today pinned to 2026-11-10 with \`?today=2026-11-10\`).\n\n${lines.join("\n")}\n`,
);
console.log("wrote", mp4, (statSync(mp4).size / 1e6).toFixed(2), "MB, transcript.md");
