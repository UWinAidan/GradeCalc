# Status — 2026-11-19

| Item | State |
|---|---|
| Plan approved (rounds 0–6) | ✅ 2026-11-18 |
| Repo scaffold: CLAUDE/TODO/DECISIONS/STATUS/README, 4 agents, ContextKeeper, LeakGuard + pre-push hook | ✅ Round 0 |
| D1 database `gradecalc` | ✅ created (empty; schema comes in Round 5) |
| About, Privacy, footer disclaimer, theme (coming-soon page replaced by the calculator in Round 2) | ✅ Round 0 |
| Workers Builds → gradecalc.aidanwbrown.com | ✅ connected (build command `node scripts/leakguard.mjs --ci`) |
| Tests | ✅ run-tests 170/0 · ui-check 265/0 · LeakGuard PASS (2026-11-19, Round 3) |
| Math (Round 1) | ✅ shared/calc.js; run-tests 115/0 (CalcCheck found 7 edge-case bugs, fixed); UWindsor scale cited |
| Guest app (Round 2) | ✅ / is the calculator (localStorage); reviewed by CalcCheck (8 page bugs fixed), AuthGuard (hardened), GuideWriter, LeakGuard |
| Edit structure (Round 3) | ✅ undo/redo, reorder, duplicate, bulk edit, previews, archive; ⓘ + footer fixes; CalcCheck (3 bugs + 1 preview mismatch fixed), AuthGuard (stale-tab writes refused, drag/paste hardened), GuideWriter, LeakGuard |
| Files (4) · Accounts (5) · Guide + PWA (6) | ⏳ |

## Session handoff (ContextKeeper)
Updated: 2026-11-19 · branch `main` · Round 3 committed + pushed (see git log)

**Goal:** Aidan's 2 fixes (cumulative ⓘ; disclaimer footer on every screen) + Round 3 (edit structure), all four agents.

**Done:** ⓘ (`infoTip`, text follows the repeat policy; "best" = Aidan's wording), `miniFooter()` on term/graphs/course
panes (phones + print). Round 3: site/js/structure.js (pure helpers incl. dropFrom/liveDoc), undo/redo (`H`, `batch()`,
Ctrl+Z/Y, ↶ ↷), reorder (↑/↓ + drag), duplicate course/component, bulk add/edit, previews, archived terms, History (all
changes). Agents: CalcCheck fixed calc.js absorb-chain order dependence, bulkText rounding, part absorb remap, preview vs
page mismatch (tests/round3check.test.js); AuthGuard made store.js refuse writes from a stale copy (409, `lastRaw`,
`loadForWrite`), drag by row id, parseMark length/finite limits; GuideWriter: wording, privacy, README, TODO Round 6 list.

**State (observed):** run-tests 170/0, ui-check 265/0, LeakGuard PASS (script + agent, new files included).

**Open:** CalcCheck notes the "best" ⓘ text says "can be higher"; the cumulative can also be lower than every year
average (retake higher, other courses lower). Kept Aidan's wording; ask him whether to say "higher or lower".

**Next steps**
1. Check the live site after Workers Builds deploys (undo/redo, footer on phone).
2. Round 4 (files): vendor SheetJS CE (pinned + licence), Excel/CSV/JSON export/import, course templates.

**Gotchas**
- Bash heredocs with JS template literals fail; write patch scripts with Write into $CLAUDE_JOB_DIR/tmp and run with node.
- LeakGuard scans tracked files only: stage new files before running it.
- Key handlers inside `.order` must only stop Enter/space (else Ctrl+Z breaks).
- Scratch Playwright scripts import file:///…/GradeCalc/node_modules/playwright-core/index.mjs.

**Read first:** CLAUDE.md, DECISIONS.md (Edit structure), site/js/structure.js, site/js/app.js, site/js/store.js.
