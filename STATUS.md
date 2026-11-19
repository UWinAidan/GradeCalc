# Status — 2026-11-18

| Item | State |
|---|---|
| Plan approved (rounds 0–6) | ✅ 2026-11-18 |
| Repo scaffold: CLAUDE/TODO/DECISIONS/STATUS/README, 4 agents, ContextKeeper, LeakGuard + pre-push hook | ✅ Round 0 |
| D1 database `gradecalc` | ✅ created (empty; schema comes in Round 5) |
| Coming-soon page, About, Privacy (current state), footer disclaimer, theme | ✅ Round 0 |
| Workers Builds → gradecalc.aidanwbrown.com | ⏳ Aidan connects the repo (README "Hosting") |
| Tests | ✅ run-tests 115/0 · ui-check 96/0 · LeakGuard PASS (2026-11-18, Round 1) |
| Math (Round 1) | ✅ shared/calc.js; run-tests 115/0 (CalcCheck found 7 edge-case bugs, fixed); UWindsor scale cited |
| Guest app (2) · Edit structure (3) · Files (4) · Accounts (5) · Guide + PWA (6) | ⏳ |

## Session handoff (ContextKeeper)
Updated: 2026-11-18 22:19 · branch `main` · latest commit (see `git log -1`; LeakGuard hardening pushed) · Round 1 committed + pushed

**Goal:** build GradeCalc in rounds 0-6 (TODO.md). Now: finish Round 1 (grade math) and commit + push it.

**Done this session**
- Round 0 committed + pushed + deployed (site live; Workers Builds connected by Aidan, build cmd `node scripts/leakguard.mjs --ci`).
- LeakGuard hardened + pushed: fails closed (exit 2) without ../Gradebook/program/program.json; `--ci` mode; `npm run setup-hooks`;
  tests/leakguard.test.js; CLAUDE.md "Fresh clone" section.
- Round 1 (uncommitted): `shared/calc.js` (Gradebook core + UWindsor letters/scales, letter-only marks, course types,
  nested components, weight check, repeats, needPerItem, credit-weighted points GPA, dynamic years);
  tests ported from Gradebook with real-course names removed (calc/curves/excused/candle.test.js, helpers.js) +
  tests/features.test.js; tests/run-tests.js supports global test() and exported `tests`; DECISIONS.md "Math" section with cited source.

**State (observed):** run-tests 115/0 (incl. CalcCheck's tests/calccheck.test.js), ui-check 96/0, LeakGuard PASS.

**In progress:** none. CalcCheck found 7 bugs (negative credits, repeats per scope, orphan/self/loop/deep nesting, parent rules, needFor on a parent); all fixed.

**Open question for Aidan:** UWindsor Senate policy says repeated courses count the HIGHEST mark (policy III);
Aidan chose default "latest" before this was found. Default kept "latest" until he confirms (DECISIONS.md).

**Next steps**
1. Wait for Aidan's answer on the repeat default (policy = highest). Then Round 2 (guest app): add scripts/build.mjs copying
   shared/calc.js → site/js/ (wrangler "build" or Workers Builds command), localStorage store, wizard, demo data, graphs.

**Gotchas**
- Private repo clones hang: `GIT_TERMINAL_PROMPT=0 git -c credential.helper='!gh auth git-credential' clone --depth 1 ...`;
  EconSolver files via `gh api -H "Accept: application/vnd.github.raw" repos/UWinAidan/EconSolver/contents/<path>`.
- Local Gradebook at ../Gradebook (read-only reference; never copy data). Its test names referenced real courses — sanitized.
- CSP has no 'unsafe-inline'. Cloudflare serves /about for about.html (links use extensionless URLs; tests/serve.mjs mimics).
- D1 binding `gradecalc` (env.gradecalc). Deploy manually: `npx wrangler deploy`; now Workers Builds deploys on push.
- PDF text: `python -c "import pypdf"` works (no poppler for Read tool).

**Read first:** CLAUDE.md, DECISIONS.md (Math), shared/calc.js, tests/features.test.js, TODO.md.
