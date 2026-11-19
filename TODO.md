# TODO

## Round 0 — scaffold (this round)
- [x] Repo files, agents, ContextKeeper, LeakGuard + pre-push hook, wrangler.jsonc, D1 `gradecalc` created
- [x] Coming-soon page, About, Privacy (current state), footer with disclaimer, theme toggle
- [x] ui-check (Playwright) + Worker tests
- [x] Workers Builds connected (Aidan, 2026-11-18; build command `node scripts/leakguard.mjs --ci`)

## Round 1 — math
- [x] Port Gradebook `calc.js` (rewrite comments generically) + tests with made-up numbers (CalcCheck: 7 bugs found and fixed)
- [x] Points / letter input, pass-fail / transfer / withdrawn, repeated courses (default: best counts, per UWindsor), nested components
- [x] "What do I need" per course and per remaining item
- [x] GPA scales: UWindsor source cited (DECISIONS.md); UWindsor %, UWindsor 13-pt, generic 4.0 / 12-pt, custom
- [x] Repeat default switched to "best" (Aidan, 2026-11-18; APC minutes 2017-09-20 cited)

## Round 2 — guest app
- [x] localStorage store (hardened by AuthGuard), quick start + setup wizard, courses/components/items, demo data, reset
- [x] All graphs, dark/light, 360 px, print view; letters, course types, repeats, one-level nesting, per-item "what do I need"

## Round 3 — edit structure
- [ ] Drag-and-drop + ↑/↓, duplicate, bulk add/edit, average-change preview, delete warnings, undo/redo, history,
      Recently deleted, move courses, archive terms, live weight check, empty states

## Round 4 — files
- [ ] SheetJS CE vendored (pinned, licence file), Excel export/import, CSV, JSON backup/restore, course templates

## Round 5 — accounts
- [ ] Google + Microsoft OIDC, sessions, CSRF, rate limits, consent screen, Save to cloud, autosave/offline/conflict
- [ ] Account page (download JSON/Excel, delete), admin page (count + storage only), AuthGuard isolation tests
- [ ] **Aidan:** create OAuth apps + `wrangler secret put` (walkthrough then)
- [ ] Test Microsoft sign-in with a UWindsor account; if admin approval is required → note on sign-in screen + How to use

## Round 6 — guide + PWA
- [ ] How to use (5 steps, every field, worked example, searchable FAQ; note that other schools may count the "latest attempt" and how to change the repeat policy), Privacy page final, manifest + service worker, launch
- [ ] How to use must also cover (noted by GuideWriter, Round 2):
  - Repeats: UWindsor counts the best attempt; many schools count the latest. Change the default in **Settings** →
    "Repeated courses: which attempt counts", or for one course: **Edit structure** → "Repeat of an earlier attempt?" →
    then "Which attempt counts". Each attempt stays in its own term; only year/cumulative averages change.
  - The repeat link only appears once you have another graded course to link to.
  - Welcome screen: **Set up my first course**, **Try it with demo data**, **Start with a term**.
  - **+ Mark** (desktop button and phone button), **Edit structure**, **History**, **Print**, **Graphs**, **Recently deleted** (30 days).
  - Course types: Graded, Pass/fail, Transfer credit, Withdrawn (what counts in averages and credits).
  - Course fields: Title, Code, Short name, Credits, Type, curve, Cap at 100%, final grade override, Notes; moving a course to another term.
  - Component fields: weight, **Bonus (on top of 100)**, drop lowest (so far vs average), excused items and where their weight goes,
    final-replaces-midterm rule, nested components; the live "Weights = 100" check (over 100 counts as bonus).
  - Item fields: mark / out of, letter marks, item weight, counts in, excused, curve, projected mark, date.
  - "What do I need?" target + "on which marks", and the term graph target: both are projections, never saved as marks.
  - Grade scales: UWindsor percentage (letter beside), UWindsor 13-point (courses before Fall 2013), generic 4.0 / 12-point
    (not official anywhere), Custom ("minimum% letter points", points optional but all-or-none). Credits for a new course.
  - Your data: **Load demo data** replaces everything; **Reset everything** clears the gradebook, history and Recently deleted
    but not theme/view choices (clear site data for those). No backup file until Round 4.
  - FAQ: data lost after clearing browser data / private mode; using two tabs at once (they sync); phone vs laptop (separate until accounts).
