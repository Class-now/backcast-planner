# backcast-planner

LaunchPad Hacks 2026 (Devpost, Oct 16 – Nov 20, 2026) entry. Static web app: paste syllabus deadlines → parse (EN/JA dates) → size by type → plan backwards with load-balancing → workload heatmap with crunch collisions and verified one-click fixes → .ics / print. No build, no runtime deps, no network.

- Live: https://class-now.github.io/backcast-planner/ (GitHub Pages from `main` /)
- Repo: https://github.com/Class-now/backcast-planner (public, MIT)
- Contest PM: `C:\For Claude\contest-pm` (Devpost submission is done by the PM, not here). Brief: `contest-pm/docs/pm/student-hacks-1110-build-brief.md`.

## Layout

| Path | What |
|---|---|
| `index.html`, `styles.css`, `js/app.js` | UI (vanilla ES modules) |
| `js/parser.js` | text → deadlines (dates, course, type, hours) |
| `js/scheduler.js` | `schedule()`, `suggestFixes()`, `applyFix()` |
| `js/ics.js`, `js/dates.js` | .ics export, UTC date helpers on `YYYY-MM-DD` strings |
| `test/*.test.js` | `npm test` (node --test) |
| `scripts/` | `serve.mjs` (port 8731), `smoke.mjs` (Playwright e2e), `screenshots.mjs`, `record-demo.mjs` + `edit-demo.mjs` (video), `try-example.mjs`, `bench.mjs` |
| `submission/` | Devpost story, tagline, transcript, screenshots, thumb (demo.mp4 is gitignored, kept locally) |

## Resume

`npm install` (Playwright 1.64.1 matches the installed headless Chromium 1248) → `node scripts/serve.mjs` → `npm test` → `node scripts/smoke.mjs`. `?today=2026-11-10` pins the date for demo assets. Write scripts with the Write tool and run them with `node <file>` (contest-pm CLAUDE.md, 11-10).
