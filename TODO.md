# TODO

## Round 0 — scaffold (this round)
- [x] Repo files, agents, ContextKeeper, LeakGuard + pre-push hook, wrangler.jsonc, D1 `gradecalc` created
- [x] Coming-soon page, About, Privacy (current state), footer with disclaimer, theme toggle
- [x] ui-check (Playwright) + Worker tests
- [x] Workers Builds connected (Aidan, 2026-11-18; build command `node scripts/leakguard.mjs --ci`)

## Round 1 — math
- [x] Port Gradebook `calc.js` (rewrite comments generically) + tests with made-up numbers (CalcCheck: 7 bugs found and fixed)
- [x] Points / letter input, pass-fail / transfer / withdrawn, repeated courses (default: latest counts), nested components
- [x] "What do I need" per course and per remaining item
- [x] GPA scales: UWindsor source cited (DECISIONS.md); UWindsor %, UWindsor 13-pt, generic 4.0 / 12-pt, custom
- [ ] **Aidan:** confirm repeat default — policy says highest mark counts; current default "latest"

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
