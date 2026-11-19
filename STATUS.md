# Status — 2026-11-18

| Item | State |
|---|---|
| Plan approved (rounds 0–6) | ✅ 2026-11-18 |
| Repo scaffold: CLAUDE/TODO/DECISIONS/STATUS/README, 4 agents, ContextKeeper, LeakGuard + pre-push hook | ✅ Round 0 |
| D1 database `gradecalc` | ✅ created (empty; schema comes in Round 5) |
| Coming-soon page, About, Privacy (current state), footer disclaimer, theme | ✅ Round 0 |
| Workers Builds → gradecalc.aidanwbrown.com | ⏳ Aidan connects the repo (README "Hosting") |
| Tests | ✅ run-tests 3/0 · ui-check 96/0 · LeakGuard PASS |
| Math (Round 1) · Guest app (2) · Edit structure (3) · Files (4) · Accounts (5) · Guide + PWA (6) | ⏳ |

## Session handoff (ContextKeeper)
Updated: 2026-11-18 21:53 · branch `main` · latest commit bceae35 (Initial commit); Round 0 committed + pushed this session

**Goal:** build GradeCalc (public grade calculator, gradecalc.aidanwbrown.com) in rounds 0–6 per the approved plan
(TODO.md). Current: finish Round 0 (scaffold + coming-soon page live).

**Done this session:** plan approved (Aidan's answers are recorded in DECISIONS.md). Created D1 `gradecalc`
(id 3c304d47-db95-46d4-80ab-c55ccd9facc1, empty). Wrote: wrangler.jsonc, worker/index.js (404 JSON for /api, /auth),
site/ (index coming-soon, about, privacy, css/app.css, js/theme.js, js/site.js, _headers CSP, robots.txt, favicon.svg),
scripts/leakguard.mjs + .githooks/pre-push (core.hooksPath set locally), tests/ (run-tests.js, worker.test.js, serve.mjs,
ui-check.mjs), 4 agents in .claude/agents/, ContextKeeper copied from Gradebook, CLAUDE/TODO/DECISIONS/STATUS/README, .dev.vars.example.

**State (observed):** run-tests 3/0 · ui-check 96/0 · LeakGuard PASS (and it FAILS correctly on planted secret /
tracker / real course code). Screenshots at 360 px and desktop look right.

**In progress:** none. LeakGuard agent review of Round 0: all 8 items PASS (no .leakguard.local.txt yet; optional).

**Next steps**
1. Re-run `node scripts/leakguard.mjs --staged` (and optionally the LeakGuard agent), fix anything found.
2. Commit Round 0 (with Co-Authored-By line) and push to main (pre-push hook runs LeakGuard).
3. `npx wrangler deploy` once so the coming-soon page goes live (approved: "go live in Round 0"); check https://gradecalc.aidanwbrown.com.
4. Ask Aidan to connect Workers Builds (README "Hosting" step 1).
5. Start Round 1: port ../Gradebook/shared/calc.js → shared/calc.js (rewrite comments that describe his real courses),
   research the official UWindsor GPA/grade scale and cite it in DECISIONS.md, or name the scale generically.

**Gotchas**
- `gh repo clone` / plain `git clone` of private repos hangs here; use `GIT_TERMINAL_PROMPT=0 git -c credential.helper='!gh auth git-credential' clone --depth 1`. For EconSolver (20 MB) fetch single files with `gh api -H "Accept: application/vnd.github.raw" repos/UWinAidan/EconSolver/contents/<path>`.
- Local private Gradebook checkout is at ../Gradebook (LeakGuard reads its program.json for fingerprints). Never copy data from it.
- CSP has no 'unsafe-inline': no style="" attributes or inline scripts in HTML.
- D1 binding name is `gradecalc` (env.gradecalc), as Aidan specified.
- ui-check uses installed Edge via playwright-core (channel msedge).

**Read first:** CLAUDE.md, TODO.md, DECISIONS.md, scripts/leakguard.mjs, tests/ui-check.mjs.
