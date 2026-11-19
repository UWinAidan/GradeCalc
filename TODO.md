# TODO

## Round 0 — scaffold (this round)
- [x] Repo files, agents, ContextKeeper, LeakGuard + pre-push hook, wrangler.jsonc, D1 `gradecalc` created
- [x] Coming-soon page, About, Privacy (current state), footer with disclaimer, theme toggle
- [x] ui-check (Playwright) + Worker tests
- [ ] **Aidan:** connect Workers Builds to this repo (README "Hosting" step 1) and check https://gradecalc.aidanwbrown.com

## Round 1 — math
- [ ] Port Gradebook `calc.js` (rewrite comments generically) + CalcCheck tests with made-up numbers
- [ ] Points / letter input, pass-fail / transfer / withdrawn, repeated courses (default: latest counts), nested components
- [ ] "What do I need" per course and per remaining item
- [ ] GPA scales: find the official UWindsor source (cite in DECISIONS.md) or name it generically; 4.0, 12-point, custom

## Round 2 — guest app
- [ ] localStorage store, quick start + setup wizard, courses/components/items, demo data, reset
- [ ] All graphs, dark/light, 360 px, print view

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
- [ ] How to use (5 steps, every field, worked example, searchable FAQ), Privacy page final, manifest + service worker, launch
