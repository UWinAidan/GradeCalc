# Status — 2026-11-20

| Item | State |
|---|---|
| Plan approved (rounds 0–6) | ✅ 2026-11-18 |
| Repo scaffold: CLAUDE/TODO/DECISIONS/STATUS/README, 4 agents, ContextKeeper, LeakGuard + pre-push hook | ✅ Round 0 |
| D1 database `gradecalc` | ✅ created (empty; schema comes in Round 5) |
| About, Privacy, footer disclaimer, theme (coming-soon page replaced by the calculator in Round 2) | ✅ Round 0 |
| Workers Builds → gradecalc.aidanwbrown.com | ✅ connected (build command `node scripts/leakguard.mjs --ci`) |
| Tests | ✅ run-tests 260/0 · ui-check 476/0 · LeakGuard PASS (2026-11-20, Round 6) |
| Math (Round 1) | ✅ shared/calc.js; run-tests 115/0 (CalcCheck found 7 edge-case bugs, fixed); UWindsor scale cited |
| Guest app (Round 2) | ✅ / is the calculator (localStorage); reviewed by CalcCheck (8 page bugs fixed), AuthGuard (hardened), GuideWriter, LeakGuard |
| Edit structure (Round 3) | ✅ undo/redo, reorder, duplicate, bulk edit, previews, archive; ⓘ + footer fixes; CalcCheck (3 bugs + 1 preview mismatch fixed), AuthGuard (stale-tab writes refused, drag/paste hardened), GuideWriter, LeakGuard |
| Files (Round 4) | ✅ Excel/CSV/JSON export + import (replace/add, undo), course templates, SheetJS CE vendored; conflict banner; ⓘ "higher or lower". CalcCheck 9 bugs fixed, AuthGuard 4 fixed (xlsx range DoS, deep nesting, n² import, undo-import overwrite), GuideWriter, LeakGuard |
| Accounts (5) | ✅ Google + Microsoft OIDC, consent, sync + conflicts, account + admin dialogs (2026-11-20). AuthGuard 7 fixed, CalcCheck 3 bugs fixed, GuideWriter, LeakGuard. Needs Aidan's setup (OAuth apps, secrets, migration) |
| Guide + PWA (6) | ✅ /help (5 steps, worked example checked against calc.js, every field, searchable FAQ), Privacy final, manifest + network-first service worker (offline), polish (2026-11-20). CalcCheck 7 claims fixed, GuideWriter labels/fields, AuthGuard 1 SW bug fixed + SW tests, LeakGuard PASS |

## Session handoff (ContextKeeper)
Updated: 2026-11-20 · branch `main` · Round 6 committed + pushed (see git log)

**Done:** Round 6. site/help.html + js/help.js (FAQ search), privacy.html final ("coming soon" sign-in note, offline-copy
bullet), PWA: sw.js (network-first; only PRECACHE paths, GET, same origin; cache write in waitUntil, 200 only),
manifest.webmanifest, js/pwa.js, icons/ (scripts/make-icons.mjs). How-to-use links in nav/footers/welcome/More.
Reset dialog now says Need targets + recent courses are cleared. Tests: pwa.test.js (precache = site files, SW run in a
fake worker env, worked example = calc.js, explained rules hold), ui-check (help pages, FAQ search per topic, offline
with server off), ui-accounts (SW controls page; cache holds no account data).

**State (observed):** run-tests 260/0, ui-check 476/0 (incl. /help at 360 px, no sideways scroll), LeakGuard PASS
(local + --ci). Live site: accounts still not switched on (unverified since Round 5).

**Next steps**
1. Aidan: TODO "Accounts go-live (Aidan)" steps 1–6.
2. After go-live: update /help Accounts section, FAQ q-account and the Privacy "coming soon" note; live sign-in check.
3. Check the live site once deployed: /help loads, install prompt, offline after one visit (unverified live).

**Gotchas**
- Bash heredocs with backticks fail: write Python edit scripts with the Write tool into $CLAUDE_JOB_DIR/tmp.
- Some files are CRLF (privacy.html): normalise newlines in edit scripts.
- New site file → add it to PRECACHE in site/sw.js or tests/pwa.test.js fails.
- ui-check's PWA block closes the server, so it must stay last.
- Scripts outside the repo import playwright-core via file:///…/node_modules/playwright-core/index.mjs.

**Read first:** DECISIONS "Guide + PWA (Round 6)", site/sw.js, site/help.html, tests/pwa.test.js.
