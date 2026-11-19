# GradeCalc — instructions for Claude

A free, public grade calculator anyone can use at **https://gradecalc.aidanwbrown.com**. Guest mode (browser only) needs no
account; signing in with Google or Microsoft syncs one gradebook per user to Cloudflare D1.

**This is NOT Aidan's private Gradebook** (`UWinAidan/Gradebook`, grades.aidanwbrown.com). GradeCalc copies its *code*
(math, wizard, editing, graphs) but **never its data**: no grades, course codes, program.json, transcripts or anything from
its D1 database. GradeCalc starts completely blank. **The GitHub repo is public.**

## Layout
- `site/` — the static page (plain ES modules, no frameworks, no CDNs). `site/_headers` = CSP + security headers.
  `site/vendor/` = pinned third-party libraries with their licence files (SheetJS CE, Round 4).
- `shared/calc.js` — all grade math (Round 1), used by the page and the tests. Copied into `site/js/` by the build.
- `worker/` — Cloudflare Worker: `/api/*` (gradebook sync, account, admin) and `/auth/*` (Google/Microsoft OIDC).
  Static files are served without running the Worker.
- `migrations/` — D1 schema for database `gradecalc` (binding `gradecalc`).
- `tests/` — `run-tests.js` (unit + Worker tests, `*.test.js`), `ui-check.mjs` (Playwright, installed Edge/Chrome), `serve.mjs`.
- `scripts/leakguard.mjs` — pre-push leak check (`.githooks/pre-push`; enable with `npm run hooks`).

## Commands
- `node tests/run-tests.js` — must stay all-pass.
- `node tests/ui-check.mjs` — Playwright check of every page (desktop + 360 px, both themes, no console/CSP errors, no
  outside requests). Must stay all-pass.
- `node scripts/leakguard.mjs` — must PASS before every push.
- `npm run dev` — the Worker locally (`.dev.vars` from `.dev.vars.example`).
- `npx wrangler d1 migrations apply gradecalc --remote` — schema changes.
- Deploy = commit + push to `main`; Cloudflare Workers Builds runs `npx wrangler deploy`.

## Rules
- **No real data, ever.** Demo data, tests and docs use made-up students, marks and course codes (`DEMO-1010` style).
  LeakGuard fingerprints Aidan's real course codes from `../Gradebook` at run time and fails the push.
- No grades, names or emails in commit messages, logs, STATUS/TODO/DECISIONS.
- Every `/api/*` route: session from the cookie only → that user's row only; CSRF check on writes; rate limited; body size
  capped. AuthGuard's isolation tests must pass (A can never touch B; no session → 401).
- OAuth client secrets and session keys only via `wrangler secret put`. Never in git.
- Never turn on `workers_dev` or preview URLs; the only route is gradecalc.aidanwbrown.com. No Cloudflare Access (public site).
- Page: no third-party scripts, fonts, analytics or trackers; it requests only its own files and `/api/*` / `/auth/*`.
  CSP has no `'unsafe-inline'`: no inline `<script>`, `<style>` or `style="…"` attributes in HTML.
- Projections ("what do I need", projected grade) are labelled as projections and never stored as marks.
- Only call a GPA scale "UWindsor" if it matches the university's official published scale, cited in DECISIONS.md.
- Footer and About say: "Not affiliated with or endorsed by the University of Windsor."
- Look: "Sage Classic" (tokens in `site/css/app.css`, same as EconSolver/Gradebook), dark by default with a light theme,
  AB monogram favicon. Works at 360 px; print-friendly course view.
- Named agents in `.claude/agents/`: **CalcCheck** (math), **AuthGuard** (accounts/isolation), **LeakGuard** (before every
  push), **GuideWriter** (How to use + Privacy in sync). Each round: run all four + ui-check, then commit and push.

## Management files (Aidan's standard)
Update at the end of every session: `TODO.md` (what's left), `DECISIONS.md` (why things are the way they are),
`STATUS.md` (where the big items stand). ContextKeeper (`.claude/hooks/`) writes session handoffs into STATUS.md.
