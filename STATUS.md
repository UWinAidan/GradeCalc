# Status — 2026-11-19

| Item | State |
|---|---|
| Plan approved (rounds 0–6) | ✅ 2026-11-18 |
| Repo scaffold: CLAUDE/TODO/DECISIONS/STATUS/README, 4 agents, ContextKeeper, LeakGuard + pre-push hook | ✅ Round 0 |
| D1 database `gradecalc` | ✅ created (empty; schema comes in Round 5) |
| About, Privacy, footer disclaimer, theme (coming-soon page replaced by the calculator in Round 2) | ✅ Round 0 |
| Workers Builds → gradecalc.aidanwbrown.com | ✅ connected (build command `node scripts/leakguard.mjs --ci`) |
| Tests | ✅ run-tests 246/0 · ui-check 392/0 · LeakGuard PASS (2026-11-20, Round 5) |
| Math (Round 1) | ✅ shared/calc.js; run-tests 115/0 (CalcCheck found 7 edge-case bugs, fixed); UWindsor scale cited |
| Guest app (Round 2) | ✅ / is the calculator (localStorage); reviewed by CalcCheck (8 page bugs fixed), AuthGuard (hardened), GuideWriter, LeakGuard |
| Edit structure (Round 3) | ✅ undo/redo, reorder, duplicate, bulk edit, previews, archive; ⓘ + footer fixes; CalcCheck (3 bugs + 1 preview mismatch fixed), AuthGuard (stale-tab writes refused, drag/paste hardened), GuideWriter, LeakGuard |
| Files (Round 4) | ✅ Excel/CSV/JSON export + import (replace/add, undo), course templates, SheetJS CE vendored; conflict banner; ⓘ "higher or lower". CalcCheck 9 bugs fixed, AuthGuard 4 fixed (xlsx range DoS, deep nesting, n² import, undo-import overwrite), GuideWriter, LeakGuard |
| Accounts (5) | ✅ Google + Microsoft OIDC, consent, sync + conflicts, account + admin dialogs (2026-11-20). AuthGuard 7 fixed, CalcCheck 3 bugs fixed, GuideWriter, LeakGuard. Needs Aidan's setup (OAuth apps, secrets, migration) |
| Guide + PWA (6) | ⏳ |

## Session handoff (ContextKeeper)
Updated: 2026-11-20 · branch `main` · Round 5 committed + pushed (see git log)

**Done:** Round 5 accounts. Server: migrations/0001_accounts.sql, worker/index.js (routes), worker/oidc.js, worker/http.js,
wrangler.jsonc (PUBLIC_ORIGIN, ratelimits RL_AUTH/RL_API/RL_WRITE). Page: site/js/sync.js, store.js (useKey/onWrite),
app.js "accounts (Round 5)", index.html (#account-btn, #sync-banner), privacy.html. Tests: fake-cloud.js (node:sqlite D1 +
fake providers), accounts.test.js (23), round5check.test.js (8), ui-accounts.mjs (+ ui-accounts-run.mjs).
Agents: AuthGuard (all 10 PASS; fixed hard-coded test secret that failed LeakGuard --ci, old session left valid on
re-sign-in, per-user API read limit, CSP+HSTS on API answers, nbf / JWKS use+alg, decline-consent mid-session, "Remove
from this browser" on the signed-out banner); CalcCheck (custom scale max null→0 churn, every pull looked "remote",
view choices keyed by course id leaking between guest and account → gc-acct-* keys); GuideWriter (Privacy, TODO Round 6
list, README).

**State (observed):** run-tests 246/0, ui-check 392/0, LeakGuard PASS. Live site: accounts unverified (secrets not set →
sign-in says "isn't switched on yet").

**Open:** observability logs callback URLs (single-use codes); Privacy says D1 recovery history "up to 30 days"
(7 on the free plan; unverified against Cloudflare docs). Aidan's answers applied (2026-11-20): rate limits 600/min per
IP + 120/min per user (RL_USER), consent stays v1 until launch, email label → ADMIN_LABEL "GradeCalc admin" (no history
rewrite), ADMIN_SUB secret only. Remote migration NOT run (Aidan's call).

**Next steps**
1. Aidan: TODO.md "Accounts go-live (Aidan)" steps 1–6 (migration, OAuth apps, secrets, ADMIN_SUB, UWindsor test).
2. After go-live: live check of sign-in with both providers, sync between two devices, delete account.
3. Round 6 (How to use + PWA): TODO.md lists for Rounds 2–5.

**Gotchas**
- Bash heredocs with backticks/template literals fail: write scripts with the Write tool, run with python.
- Playwright doesn't intercept followed redirects: ui-accounts routes `/auth/login/*` itself.
- Accounts UI tests use http://localhost (secure context for `__Host-` cookies); guest checks use 127.0.0.1.
- Chrome logs non-2xx fetches as console errors: guest mode never calls /api; /api/me returns 200 signedIn:false.
- Consent dialog shows while #loading is present; full run-tests takes ~3 min (files-security is slow).

**Read first:** DECISIONS "Data model and sync (Round 5)" + "Accounts (Round 5)", site/js/sync.js, worker/index.js.
