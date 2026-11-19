# Status — 2026-11-18

| Item | State |
|---|---|
| Plan approved (rounds 0–6) | ✅ 2026-11-18 |
| Repo scaffold: CLAUDE/TODO/DECISIONS/STATUS/README, 4 agents, ContextKeeper, LeakGuard + pre-push hook | ✅ Round 0 |
| D1 database `gradecalc` | ✅ created (empty; schema comes in Round 5) |
| About, Privacy, footer disclaimer, theme (coming-soon page replaced by the calculator in Round 2) | ✅ Round 0 |
| Workers Builds → gradecalc.aidanwbrown.com | ✅ connected (build command `node scripts/leakguard.mjs --ci`) |
| Tests | ✅ run-tests 139/0 · ui-check 189/0 · LeakGuard PASS (2026-11-18, Round 2) |
| Math (Round 1) | ✅ shared/calc.js; run-tests 115/0 (CalcCheck found 7 edge-case bugs, fixed); UWindsor scale cited |
| Guest app (Round 2) | ✅ / is the calculator (localStorage); reviewed by CalcCheck (8 page bugs fixed), AuthGuard (hardened), GuideWriter, LeakGuard |
| Edit structure (3) · Files (4) · Accounts (5) · Guide + PWA (6) | ⏳ |

## Session handoff (ContextKeeper)
Updated: 2026-11-18 22:45 · branch `main` · latest commit 49dc12e (STATUS: Round 1 handoff) · Round 2 committed + pushed (see git log)

**Goal:** Round 2 (guest app) per TODO.md; Aidan confirmed repeat default = "best" and asked to commit STATUS then start Round 2.

**Done this session**
- Repeat default switched to 'best' (`DEFAULT_REPEAT_POLICY` in shared/calc.js), tests updated; source verified by reading
  the PDF (APC minutes 2017-09-20, Motion 2 + friendly amendment) and cited in DECISIONS.md. CLAUDE.md `npm run setup-hooks` fixed.
- Round 2 (all staged via `git add -A`): scripts/build.mjs (copies shared/calc.js → site/js/calc.js, gitignored; wrangler.jsonc
  `build.command`; `npm run build`); CSS split tokens.css / site.css / app.css; site/index.html = calculator;
  site/js/app.js (ported Gradebook page), ui.js (letters in parseMark), wizard.js (new-term option, free codes),
  charts.js (copied, gc- keys), store.js (localStorage doc, Gradebook-shaped api), demo.js (DEMO-xxxx data);
  privacy.html rewritten for guest mode; about/privacy nav "Calculator"; tests/store.test.js; ui-check app flows.
- DECISIONS.md "Guest app (Round 2)" section; CLAUDE.md Layout updated.

**State (observed):** run-tests 123/0, ui-check 189/0 (after AuthGuard + GuideWriter fixes, before the last
clearViewChoices edit: rerun). LeakGuard agent: clean.

**Review agents:** AuthGuard done (fixed: store.js normalize/cleanRow/cleanSettings type checks, own-key pick, settings
whitelist; calc.js resolveScale hasOwn; app.js no decodeURIComponent; tests in store.test.js). LeakGuard done (clean;
renamed 3 demo titles anyway). GuideWriter done (edited privacy.html, README.md, TODO.md Round 6 How-to list; I applied
its app.js wording + clearViewChoices() on reset/demo). CalcCheck done: 8 page bugs fixed (year candles from calc, scoped need wording, repeat credits once, letters from shown value, set-letter band, final-vs-midterm match, curved letter marks, badge text); tests/page.test.js.

**Next steps**
1. Check the live site after Workers Builds deploys Round 2 (wrangler build runs scripts/build.mjs; verify /js/calc.js is served).
4. Round 3 (edit structure: drag/drop, duplicate, bulk, preview, undo/redo Ctrl+Z, archive terms…).

**Gotchas**
- Bash heredocs with complex JS quoting can fail ("unexpected EOF"); write patch scripts with Write or use Edit.
- Scratch scripts in $CLAUDE_JOB_DIR/tmp must import playwright-core via file:///…/node_modules/playwright-core/index.mjs.
- calc.js returns copies of components/items: page patches by id (`patch()` in app.js).
- PDF text: python pypdf. Private repo clones: see Round 1 gotchas in git history of this file.

**Read first:** CLAUDE.md, DECISIONS.md (Guest app, Math), site/js/app.js, site/js/store.js, tests/ui-check.mjs.
