## Inspiration

Every syllabus says *when* things are due. None of them says *when to start*. We kept living the same week: "Essay 2 — Nov 28" sits on one course page, "Midterm — Dec 3" on another, a lab report and a problem set on a third and fourth — and nobody notices until Nov 26 that all of them need the same weekend. Calendars show deadlines as dots; to-do apps show lists. Neither shows the **load in the days before** the deadlines, which is where the trouble actually is.

It's not just us. The *planning fallacy* (Buehler, Griffin & Ross, 1994) shows people reliably underestimate how long their own tasks take, and Steel's 2007 meta-analysis on procrastination reports estimates that 80–95% of college students procrastinate. We wanted a tool that makes both problems visible weeks ahead — while "start earlier" is still an option.

## What it does

**Backcast** turns pasted syllabus text into a backwards plan:

1. **Paste deadlines** straight from your syllabi — `Essay 2 due Nov 28 (2,000 words)`, `Midterm 12/3`, `2026-12-03`, even Japanese `レポート 11月30日（月）締切 2000字`. Course headers (`PSYC 101:` / `## 日本語 III`) carry down to the lines below; lines without a date are listed, not silently dropped.
2. **Sizes each one** by type (essay, exam, quiz, problem set, presentation, project, reading) and size hints (words, 字, pages, minutes, % weight). Every estimate is editable.
3. **Plans backwards**: each deadline is split into milestones (e.g. research & outline → draft → revise & cite → final read-through) and its hours are load-balanced across the days before it, within the hours you said you have each weekday.
4. **Workload heatmap** shows every day from today to the last deadline. Red striped days are **crunch collisions** — more work than time — with **one-click fixes**: *start earlier*, *move* hours to a lighter day, or *shrink* a task. Every fix is verified by re-running the planner before it is offered, and every change can be undone.
5. **Export** an `.ics` file for Google / Apple / Outlook Calendar or print a day-by-day checklist.

No account, no server, no network: everything stays in your browser's localStorage.

## How we built it

Plain HTML, CSS and vanilla JavaScript modules — no framework, no build step, no runtime dependencies — so it loads instantly on old phones and is hosted for free on GitHub Pages.

- **Parser:** NFKC normalisation (full-width digits), a priority list of date patterns (ISO, Japanese 年月日, month names, day-month, numeric with a day/month switch), year inference (a January final pasted in November goes to next year), bilingual keyword rules for task types, and size-hint extraction for hours.
- **Scheduler:** deadline-ordered placement where each session goes to the day that ends up least full *relative to its capacity*; a repair pass that moves another task's session out of the way when that frees room; leftover hours are reported as overload instead of silently dropped. Milestones are cut from the time-ordered sessions and snapped to half-hours.
- **Fix finder:** for each task on a crunch day, try start-date shifts, cuts and extra hours on a lighter day; re-run the full plan for each; keep only fixes that reduce overload both on that day and overall. We moved the scheduler to typed arrays over day indexes so ~100 re-plans per click stay under ~0.1 s.
- **Accessibility:** the heatmap is a real `<table>` of buttons with full spoken labels ("Saturday, November 28, 2026: 5h planned of 4h available, over by 1h, crunch collision"), arrow-key navigation, and colour + stripes + "!" so meaning never depends on colour alone.
- **Quality:** 28 unit tests with `node --test` (parser, scheduler, .ics), plus a headless Playwright end-to-end check (parse → heatmap → fix → undo → keyboard → reload → .ics → print → 360 px phone, no console errors, no external requests).

## Challenges we ran into

- **Dates are messy.** "Essay 2 Nov 28" first parsed as *2 Nov*; we switched from "earliest match" to a priority order of patterns. Lookbehind regexes broke older Safari, so we rewrote them. "12/3" is December 3 in the US and March 12 elsewhere — hence the explicit switch.
- **Fair load-balancing without an optimiser.** A greedy planner can let an early deadline take the days a later, tighter one needed. The repair pass fixed the cases we found in tests.
- **Fixes you can trust.** Our first fixes sometimes "cleared" one day by pushing the crunch to the next. Now every fix is checked against the total overload, not just the clicked day.
- **Speed.** The first version took ~1 s to compute fixes on a laptop; typed arrays and a smaller search brought it to ~0.1 s.

## Accomplishments that we're proud of

- A real one-click "what if": each suggested fix is an actual re-plan, not a guess.
- Works with English *and* Japanese syllabi in the same paste.
- Zero dependencies, zero network requests, works offline after loading, keyboard- and screen-reader-friendly, and fits a 360 px phone.

## What we learned

- Making effort *visible* (hours per day) changes decisions more than reminders do: the crunch is obvious weeks ahead.
- Small heuristics plus a verification loop (re-run and check) beat a clever algorithm we can't explain to users.
- Accessibility constraints (no colour-only meaning, real table semantics) made the heatmap clearer for everyone.

## What's next

- Import directly from Canvas / Moodle / Google Calendar feeds (still optional and local).
- Learn your personal "planning fallacy factor" from what you actually logged, and scale estimates.
- Time-of-day blocks around your class timetable.
- A small user study with students during finals.

## Limitations

- Hour estimates are rules of thumb (e.g. essay ≈ 2 h + 1 h per 250 words) — a starting point to edit, not a prediction.
- One date per line; relative dates ("next Friday", "week 9") and ranges aren't understood.
- The scheduler is a greedy heuristic with one repair pass, not an optimal solver, and plans whole days, not time blocks.
- Data lives in one browser (no sync); clearing site data loses it — export the .ics to keep a copy.
- Not user-tested yet: the evidence of need is from published research and our own experience.

## Credits & AI disclosure

- **Built during LaunchPad Hacks:** everything — code, tests, design, screenshots, video — was created from scratch on 2026-11-10, within the Oct 16 – Nov 20, 2026 hackathon period. The git history shows every commit.
- **AI assistance:** we used **Claude Code** (Anthropic) as a coding assistant; it wrote most of the code, tests and docs under our direction, and we reviewed and tested the results.
- **Research cited:** Buehler, Griffin & Ross (1994), *Exploring the "planning fallacy"*, JPSP 67(3); Steel (2007), *The nature of procrastination*, Psychological Bulletin 133(1).
- No third-party code or assets ship with the app. All example courses and deadlines are fictional. MIT license.
