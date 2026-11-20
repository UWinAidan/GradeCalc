# Status — 2026-11-19

| Item | State |
|---|---|
| Plan approved (rounds 0–6) | ✅ 2026-11-18 |
| Repo scaffold: CLAUDE/TODO/DECISIONS/STATUS/README, 4 agents, ContextKeeper, LeakGuard + pre-push hook | ✅ Round 0 |
| D1 database `gradecalc` | ✅ created (empty; schema comes in Round 5) |
| About, Privacy, footer disclaimer, theme (coming-soon page replaced by the calculator in Round 2) | ✅ Round 0 |
| Workers Builds → gradecalc.aidanwbrown.com | ✅ connected (build command `node scripts/leakguard.mjs --ci`) |
| Tests | ✅ run-tests 215/0 · ui-check 316/0 · LeakGuard PASS (2026-11-20, Round 4) |
| Math (Round 1) | ✅ shared/calc.js; run-tests 115/0 (CalcCheck found 7 edge-case bugs, fixed); UWindsor scale cited |
| Guest app (Round 2) | ✅ / is the calculator (localStorage); reviewed by CalcCheck (8 page bugs fixed), AuthGuard (hardened), GuideWriter, LeakGuard |
| Edit structure (Round 3) | ✅ undo/redo, reorder, duplicate, bulk edit, previews, archive; ⓘ + footer fixes; CalcCheck (3 bugs + 1 preview mismatch fixed), AuthGuard (stale-tab writes refused, drag/paste hardened), GuideWriter, LeakGuard |
| Files (Round 4) | ✅ Excel/CSV/JSON export + import (replace/add, undo), course templates, SheetJS CE vendored; conflict banner; ⓘ "higher or lower". CalcCheck 9 bugs fixed, AuthGuard 4 fixed (xlsx range DoS, deep nesting, n² import, undo-import overwrite), GuideWriter, LeakGuard |
| Accounts (5) · Guide + PWA (6) | ⏳ |

## Session handoff (ContextKeeper)
Updated: 2026-11-20 · branch `main` · Round 4 committed + pushed (see git log)

**Done:** ⓘ "higher or lower" (best + latest); "Changed in another tab — Reload" banner (`#conflict`, `track()` on 409);
Round 4 files: site/js/files.js, Files dialog in app.js, store `replace(…, { ifUnchanged })`, SheetJS CE 0.20.3 mini in
site/vendor (`-text` in .gitattributes, SHA in its README). Agents: CalcCheck (9 fixes, tests/round4check.test.js),
AuthGuard (4 fixes, tests/files-security.test.js, Undo-import only if unchanged), GuideWriter (privacy, README, TODO
Round 6 notes), LeakGuard.

**State (observed):** run-tests 215/0, ui-check 316/0, LeakGuard PASS.

**Open (low, not fixed):** zip-bomb .xlsx still fully inflated by SheetJS (user's own tab only); numeric sheet names
sort first for the "first sheet" CSV-style fallback; Demo/Reset replace doesn't catch 507 (shows only in save-state);
deep-chain math safety relies on the import guard (MAX_DEPTH 10), not calc.js; Excel r10 rounding of >10-decimal marks.

**Next steps**
1. Check the live site after Workers Builds deploys (Files dialog, Excel download/import, banner).
2. Round 5 (accounts): see TODO.md Round 5 and DECISIONS "Data model and sync" / "Accounts".

**Gotchas**
- Root package is `"type": "module"`: UMD SheetJS can't be require()d; tests run it via `new Function('exports', code)`.
- Python patches: `﻿` in a non-raw string becomes a literal BOM; use the Edit tool for escapes.
- Download names start `gradecalc-backup-` on purpose (LeakGuard blocks committing one).
- Heredocs with JS template literals fail; stage new files before LeakGuard.

**Read first:** DECISIONS.md "Files (Round 4)", site/js/files.js, site/js/app.js ("files: export / import").
