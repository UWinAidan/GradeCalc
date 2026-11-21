# Decisions

Why GradeCalc is the way it is. Newest at the bottom of each section.

## Product
- **Separate product from Aidan's private Gradebook** (2026-11-18). GradeCalc reuses Gradebook's *code* (math, wizard,
  editing, graphs) and EconSolver's *setup* (Workers Builds, Sage Classic, About, footer, ui-check). It starts blank and
  never contains Gradebook data. Separate Worker (`gradecalc`), separate D1 database (`gradecalc`), public repo.
- **Guest mode first, accounts optional.** Everything works with localStorage only; signing in just adds sync.
- **Went live in Round 0 with a "coming soon" page** (Aidan, 2026-11-18) so the deploy pipeline is proven early.
- **Footer + About disclaimer:** "Not affiliated with or endorsed by the University of Windsor." (Aidan, 2026-11-18).

## Guest app (Round 2)
- **The calculator is the home page (`/`).** First visit shows a welcome screen with one clear next step (set up a course
  with the wizard), plus demo data and "start with a term". The coming-soon page is gone.
- **Guest storage = one JSON document in localStorage** (`gc-gradebook`, `site/js/store.js`): terms, courses,
  components, assessments, repeats, settings, plus an audit list (history, capped at 1000) and soft-deleted rows
  (Recently deleted, purged after 30 days). `store.api` has the same shape as Gradebook's server API
  (create / patch / remove / restore / deleted / audit), so the ported page code barely changed, and Round 5 can sync
  the same document. `normalize()` drops unknown fields and fills defaults for anything stored or imported.
  Other tabs reload on the `storage` event.
- **The page never patches calc.js's copies:** calc returns copies of components/items (nesting, letter estimates), so
  `patch()` looks the stored row up by id.
- **Course codes are free text** (any school), max 20 characters; Gradebook's UWindsor code pattern is gone. Terms are
  free-named; "Fall 2026" style names fill season + year automatically. Year of study 1–10, optional.
- **Letter on a percentage scale, GPA on a points scale** everywhere a GPA used to be (overview, terms, courses).
- **Graphs:** the cumulative line re-runs `computeAll` on the terms up to each point, so the repeat policy applies to the
  attempts made so far (same rule as cumulative-to-year).
- **Nesting in the page: one level.** "Split into parts" turns a component into a group; its items move into part 1.
  Parts have a "share of group" number, shown as "% of course".
- **"What do I need" per remaining item** shows under each open item once a target is typed, labelled est.
- **CSS split** into tokens.css (shared), site.css (content pages), app.css (calculator, from Gradebook) because the
  calculator's full-height pane layout and the content pages' prose layout conflict.
- **Print:** the course pane only (Print button on a course; `@media print` hides everything else).

## Edit structure (Round 3)
- **Disclaimer on every screen** (Aidan, 2026-11-19): phones show one pane at a time, so the term, graphs and course
  panes end with a small footer (disclaimer + About + Privacy). Desktop already shows the Overview footer at all times,
  so the small one is phone-only (and on printouts).
- **ⓘ next to the cumulative average** (Aidan, 2026-11-19), text as given: repeats count the best attempt in the
  cumulative while each year keeps that year's grade, so the cumulative can beat every year average.
  Changed to "can be higher or lower than every year average" (Aidan, 2026-11-20; CalcCheck: a retake raises one course
  while other courses pull the cumulative down), same for the latest-attempt text.
- **Undo / redo = a step list in the page, this visit only.** Every saved change is an operation (patch with before/after,
  create, delete, restore, settings); multi-row actions (duplicate, bulk edit, reorder, the wizard, split into parts)
  are one step. Undo writes the inverse through the store, so it shows in History and syncs like any change. A create is
  undone by a soft delete (redo restores the same row id). Cleared by demo data, Reset everything and changes from
  another tab (ids could clash). Capped at 100 steps. Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z work outside text boxes; inside a
  box the browser's own undo runs. History (all changes, last 1000) and Recently deleted (30 days) stay the long-term
  safety net.
- **Reorder = `sort_order` renumbered 1..n** for the rows that move (one undo step). ↑/↓ buttons everywhere; drag (⠿)
  only with a mouse (HTML drag and drop doesn't work on touch). Drags stay inside one list (same term, course or group).
  Term order is time order: it decides which attempt is "latest" (repeat policy `latest`) and the cumulative-after-each-
  term graph, so moving a term can change those. Component and item order never change a grade (absorb chains are
  settled in dependency order, CalcCheck 2026-11-19); only the class candle's open (undated items replay in list order).
- **Duplicate course** copies components, parts, items and rules into any term (rules re-pointed at the copies).
  Marks, the final grade, curve and pass/fail result only when "copy marks" is ticked; otherwise the copy is active
  and blank. Repeat links aren't copied (link the attempts yourself). **Duplicate component** stays in the course, has no
  marks, and drops a "takes weight of… if higher" rule (the original still takes that weight; two rules competing for
  one component's weight would make the grade depend on list order). Its parts keep absorb rules only between copied
  parts (`remapRefs` `dropUnmappedAbsorb`).
- **Bulk add / edit** = "Name: mark" lines. Names match items case-insensitively; a match changes the mark, a new name
  adds an item, a missing line changes nothing (bulk edit never deletes). Same mark syntax as everywhere (85, 85%,
  17/20, B+). Max 300 lines.
- **Previews ("how would my average change")** re-run `computeAll` on a copy of the gradebook; labelled "preview",
  never saved. Shown in the + Mark sheet, bulk edit and delete warnings (term, course, component, marked item).
  Unmarked items delete without a question (Undo in the toast); marked ones ask.
- **Archived terms** fold under "Archived terms" in the list (all terms in Edit structure) and + Mark skips their
  courses, but they still count in every average and graph: archiving tidies the list, it doesn't change grades.
- The pure parts live in `site/js/structure.js` (tests: `tests/structure.test.js`).
- **A save refused because another tab changed the data shows a banner** "Changed in another tab — Reload" (Aidan,
  2026-11-20) under the top bar, on top of the error toast, and stays until Reload. Toasts disappear; a refused change
  must never look like it was quietly dropped. Any store 409 (edit, undo, settings, import) triggers it (`track()`).

## Files (Round 4)
- **SheetJS CE 0.20.3, "mini" build, vendored** in `site/vendor/sheetjs-0.20.3/` (Apache-2.0 licence + README with
  source URL and SHA-256), unmodified. Loaded with a `<script>` tag only when an Excel file is written or read, so the
  page itself stays small and nothing comes from a CDN. Mini = xlsx + CSV, no legacy codepages (old .xls may not import).
  0.20.3 has the fixes for the prototype-pollution and ReDoS advisories in older versions.
- **Three downloads, made in the browser** (nothing uploaded): **Backup (.json)** = the whole stored document
  (history and Recently deleted included) in `{ app, kind: "backup", format, gradebook }`; **Excel** = one sheet per row
  kind (Terms, Courses, Components, Items, Repeats, Settings) + Read me, with "(calculated)" averages beside them that
  import ignores; **CSV** = one row per item (term, course, component, item, mark), Excel-friendly (BOM, formula guard).
  Download names start `gradecalc-backup-` so LeakGuard blocks one that gets committed by mistake.
- **Excel marks are readable:** a percent item has "%" in Out of (85 = 85%), a points item a number (17 out of 20).
  Rules, curves and excused targets are JSON text (advanced). Ids keep rows linked; a new row may leave Id blank and
  name its parent instead (Term; Course code or title; Course + Component). Errors name the sheet and row.
- **Import = Replace or Add**, asked every time (just "Import" when the gradebook is empty). Replace swaps the whole
  document (a backup brings its settings and history); Add gives every imported row a new id and puts its terms after
  yours (`appendDoc`). Both are one `api.replace(…, { ifUnchanged: true })`, refused (409 → banner) if another tab
  saved meanwhile. The toast offers Undo (puts the previous document back); the step history is cleared because ids
  change. Everything goes through `normalize()`; files over 5 MB or 20,000 rows are refused.
- **CSV import** builds terms, courses, components and items by name in the order they appear; "Group › Part"
  component names become a group with parts. It also accepts any spreadsheet's first sheet with at least Course code
  (or title) and Component columns. Rules, drops and curves aren't in a CSV.
- **Course templates are files, not a list in the app**: Edit structure → "Save as template" downloads the structure
  (course title/code/credits/type/cap, components, parts, items, rules) with no marks, letters, curves, dates, notes or
  term. Importing one asks for the term and creates the course as one undo step (same code path as Duplicate course:
  `createFromPlan`). Sharing a file needs no accounts and can't leak anyone's marks.
- The pure parts live in `site/js/files.js` (tests: `tests/files.test.js`, including a real .xlsx round trip).

## Data model and sync (Round 5)
- **One row per user** in `gradebooks`: the whole gradebook as JSON (the same document guest mode keeps in localStorage)
  + `version` + `bytes` + `updated_at`. Max 1.5 MB per gradebook (D1 rows hold 2 MB); bigger → 413 and "too big".
- **The page still works on a copy in this browser.** Signed in, store.js uses localStorage `gc-cloud-doc` instead of
  `gc-gradebook`, so every screen, undo, history and file feature works unchanged and offline. The guest gradebook is never
  touched by signing in or out: signing out shows it again. `sync.js` marks the copy unsynced on every write
  (`onWrite`) and ~2 s later sends the whole document to `PUT /api/gradebook` with `base_version`. Sync state
  (`gc-cloud-meta`: uid, version, dirty) is shared by tabs; Web Locks keep tabs from sending at the same time.
- **Optimistic concurrency:** the server updates only `WHERE version = base_version`; otherwise 409. The page then fetches
  the server's copy: identical (another tab already sent it) → fine; different → banner **"Updated on another device —
  Use that version / Keep mine"** (Keep mine re-sends with the server's version). Never a silent overwrite either way.
- **When the page fetches:** on load, when the tab becomes visible again (if 30 s since the last fetch), and on `online`.
  Unsynced changes are sent when the tab is hidden, on `online`, and retried every 30 s when offline. A newer server
  copy with nothing unsynced here replaces the local copy and re-renders ("Updated from your other device").
- **Save to cloud:** an empty account + a guest gradebook in this browser → "Save this browser's gradebook to your
  account?" (a copy). Later, Account → "Add it to my account" (appendDoc, like importing a file) or "Replace".
- **Session ended with unsynced changes** → the copy stays and a banner says "Signed out — Sign in again", with "Remove
  from this browser" (AuthGuard: a shared computer must be able to drop the copy without signing in). Consent declined
  mid-session (consent text changed) → signed out and the page reloads in guest mode, so the copy leaves at once. Another
  account signing in on the same browser with someone's unsynced copy → offered as a .json download, then dropped.
- **The server only shallow-checks the document** (object, schema 1, arrays); the page normalizes everything it loads.
  A full server-side normalize would cost CPU on every save, and the document is only ever read by its own owner.

## Accounts (Round 5)
- **Google + Microsoft OIDC, authorization code + PKCE (S256), no passwords.** state, nonce and the PKCE verifier live in
  a 10-minute signed (HMAC with `SESSION_SECRET`) `__Host-gc-signin` cookie, so abandoned sign-ins leave no rows. The
  id_token is verified in full even though it comes straight from the token endpoint: RS256 signature against the
  provider's JWKS (cached 1 h, refetched once for an unknown `kid`), `iss`, `aud` (+ `azp` when several), `exp`, `iat`
  (5 min skew), `nbf` when present, `nonce`; the JWKS key must be RSA and not marked for another `use` / `alg`. Redirect URIs come from `PUBLIC_ORIGIN` (wrangler var), never from the request.
- **Microsoft uses the multi-tenant `common` endpoint**; the issuer must be `https://login.microsoftonline.com/<tid>/v2.0`
  for the token's own `tid`. Identity = `tid:oid` (Google: `sub`).
- **Two separate accounts if the same person uses both providers; no auto-linking by email** (Aidan, 2026-11-18).
  Linking by email across providers is a known account-takeover route. Email is stored only as a label.
- **UWindsor Microsoft accounts may need tenant admin approval** for an unverified multi-tenant app. The callback maps
  AADSTS65001/90094/90095 (and "admin approval/consent") to `?signin=approval` → "Your school's Microsoft account needs an
  administrator's approval for GradeCalc. Sign in with Google instead". Not tested with a real UWindsor account yet.
- **Sessions:** 256-bit random token in `__Host-gc-session` (HttpOnly, Secure, SameSite=Lax, Path=/, 30 days); D1 stores
  only its SHA-256 and the expiry, checked on every request (expired rows deleted when seen and at each sign-in). At most
  10 sessions per user (oldest go). Sign-out deletes the row. Signing in again in a browser deletes that browser's
  previous session row (any account) instead of leaving it valid.
- **CSRF:** every write needs `Origin` = `PUBLIC_ORIGIN` (required, not just checked when present), `Sec-Fetch-Site`
  same-origin when sent, `Content-Type: application/json`, and the session's own random `X-CSRF-Token` (from `/api/me`).
  GETs never change anything.
- **Rate limits = Workers Rate Limiting bindings** (per Cloudflare location, 60 s): `/auth/*` 20 per IP (`RL_AUTH`),
  `/api/*` 600 per IP (`RL_API`; many students share one campus WiFi IP) and 120 per signed-in user (`RL_USER`), writes
  60 per user (`RL_WRITE`) (Aidan, 2026-11-20). A missing binding fails closed (429). No D1 write per request for counting.
- **Guest mode never calls the server.** The page asks `/api/me` only when this browser has an account copy or just came
  back from a sign-in (`?signin=ok`). `/api/me` answers 200 `{signedIn:false}` rather than 401 (it's the one probe route);
  every other `/api/*` route without a session is 401.
- **Consent before any cloud write:** `consent_version` + `consent_at` on the user row; `PUT /api/gradebook` is 403
  `consent_required` until the current `CONSENT_VERSION` (worker/index.js and site/js/sync.js, bump both together) is
  accepted. Stays at 1 until launch; after launch, bump on every change to the consent text (Aidan, 2026-11-20).
  "No thanks" deletes a brand-new sign-in that has nothing saved, otherwise just signs out.
- **Account page = a dialog** (person icon in the top bar, More, Settings): who you are, sync state, guest-gradebook copy,
  download everything (`/api/account/export`: account details + the stored gradebook, a download named
  `gradecalc-backup-account-…` so LeakGuard blocks committing one) or Excel, sign out, delete account (sessions,
  gradebook and user in one batch; the guest gradebook in the browser stays).
- **Admin = a Google sign-in whose subject equals the `ADMIN_SUB` secret** (Aidan's brief, 2026-11-20: not by email,
  which can change hands or be unverified). `ADMIN_SUB` is a wrangler secret, never in wrangler.jsonc; the admin page heading is the generic var `ADMIN_LABEL` ("GradeCalc admin"; the owner's email label was removed from wrangler.jsonc on 2026-11-20, history not rewritten). `/api/admin` returns
  account counts (per provider), gradebook count, total bytes and active sessions; it never selects `doc`, email or
  subject (tests grep the route's SQL). Anyone else gets 404.
- **Errors never echo details:** the Worker catches everything into `{"error":"server_error"}` and logs only the error's
  name.
- **Tests run the real Worker on a real SQLite** (`node:sqlite` running the migrations, `tests/fake-cloud.js`) with a fake
  Google/Microsoft (real RSA keys, JWKS, PKCE-checking token endpoint). ui-check drives the same Worker from the browser
  (`tests/ui-accounts.mjs`; `node tests/ui-accounts-run.mjs` runs only that part).

## Math (Round 1)
**Source for everything labelled "UWindsor":** University of Windsor, *Senate Policy: Policy on Grading and Calculation
of Averages* (last amended April 13, 2018), sections I–III.
<https://www.uwindsor.ca/law/student-resources/sites/uwindsor.ca.law.student-resources/files/grading_policy.pdf>
(retrieved 2026-11-18; a copy hosted on uwindsor.ca. I couldn't find a newer version on the Secretariat site. If one
appears, re-check the tables below against it.)

What the policy says, and what GradeCalc does with it:
- **Since Fall 2013 UWindsor grades are percentages (integers), not grade points.** The transcript back carries a
  percentage → letter table (A+ 90–100, A 85–89.9, A- 80–84.9, B+ 77–79.9, B 73–76.9, B- 70–72.9, C+ 67–69.9,
  C 63–66.9, C- 60–62.9, D+ 57–59.9, D 53–56.9, D- 50–52.9, F 0–49.9). So the default scale **"UWindsor (percentage,
  with letter)"** has **no GPA points**: the average *is* the percentage, and the letter is shown beside it.
- **"UWindsor 13-point (courses before Fall 2013)"** is the policy's pre-Fall-2013 conversion table, verbatim.
- **"Percentage → 4.0 (generic)" and "Percentage → 12-point (generic)"** are not official UWindsor scales. They use
  the UWindsor letter cut-offs with the common 4.0 / 12-point values (A+ and A = 4.0, A- 3.7 … D- 0.7, F 0;
  A+ 12 … D- 1, F 0), and they're labelled generic in the picker. Custom scales: any bands {min, letter, points}.
- **Averages are credit-weighted** (policy III: a 6-credit course weighs double a 3-credit one). The policy's two
  worked examples are unit tests (`tests/features.test.js`).
- **GPA on a points scale = credit-weighted mean of each course's points**, not the points of the mean percentage.
  That's how grade-point averages work. Gradebook mapped the mean percentage; GradeCalc doesn't.
- **Pass/fail, transfer and withdrawn courses never count in averages** (P/NP has "no numeric grade equivalent").
  Passed pass/fail credits and transfer credits are reported separately; withdrawn credits nowhere.
- **Repeated courses: default "best attempt counts"** (Aidan, 2026-11-18). Since the 2017 change, UWindsor uses only
  the highest mark in cumulative and major averages; Nursing clinical courses are the exception (the final attempt
  supersedes). Source: Academic Policy Committee minutes, 20 September 2017, item 5.3 Motion 2 and its friendly amendment
  (verified by reading the PDF on 2026-11-18):
  <https://www.uwindsor.ca/secretariat/sites/uwindsor.ca.secretariat/files/apc170920m.pdf>. The Senate grading
  policy above (policy III) says the same. Per course group the policy can be changed to "latest attempt counts" (what
  many other schools, and Nursing clinical courses, use) or "all attempts count". Default = `DEFAULT_REPEAT_POLICY` in
  `calc.js`, overridable by `settings.repeat_policy_default`. Term averages show every attempt in its own term. Year,
  cumulative-to-year and cumulative averages apply the policy **among the attempts inside that scope** (CalcCheck,
  Round 1), so "cumulative to year 1" uses the year-1 attempt even if year 2 has a retake. "Latest" means the latest
  attempt *that has a grade*, so a retake in progress doesn't hide the earlier mark.
- **Rounding:** the policy rounds averages to 2 decimals (88.985 → 88.99). The math keeps full precision; the page
  shows 2 decimals.
  Letters and grade points come from the percentage **as shown** (rounded to 2 decimals), so "80.00%" is never shown next
  to a B+ (CalcCheck, Round 2).
- **A repeated course's credits count once** in year/cumulative course and credit counts: only the attempt(s) the policy
  keeps (CalcCheck, Round 2). Term counts still show every attempt in its own term.
- **A final grade set as a letter keeps that letter** (and its points) on the chosen scale when the scale has it, rather
  than going through the UWindsor midpoint (e.g. F on the 13-point scale = 1 point, not F- = 0).
- **Letter-only marks** (a letter, no number): the middle of the letter's integer range (A+ 95, A 87, B 74.5 …
  F 24.5), flagged *estimated* in results. The stored document keeps the letter, and a number always beats a letter.

Carried over from Gradebook (code only, comments rewritten without his course names):
- **Two views:** grade so far (unmarked = 0) and current average (marked only). Projections never stored as marks.
- Drop lowest (separately for so-far / average), bonus components, weights over 100 act as bonus (excess shared in
  proportion to the marked weight), 100% cap, item curves (in the item's points) and course curves (add/mul/set, after
  bonus, before the cap), excused items moving weight (to a component, or by date around a pivot), final-grade override,
  absorb-if-higher and minimum-warning rules, candles for the graphs.
- **Nested components:** the page offers one level, but the math is safe at any depth. Children share the parent's
  course weight in proportion to their own weights (equal shares if all are 0). A parent with children ignores items
  put directly on it (and warns). Bonus is inherited. A missing parent, a self-parent or a loop makes the component
  top-level with a warning: nothing is silently dropped (CalcCheck, Round 1). A parent's `min_warning` is checked on
  its roll-up; `absorb_if_higher` "from" a parent means all its leaves; "what do I need" can target a parent.
  Other rules on a parent (drop, absorb *into* it, excused_to) are ignored: they belong on the leaves.
- **Credits:** blank or invalid credits count as 0 and negative credits are clamped to 0, never negative weight.
- **Live weight check:** top-level non-bonus weights vs 100. A warning, never blocking; the grade is still out of 100.
- **Years come from the terms that exist** (any `year_of_study` number, optional). Terms without one count in the
  cumulative average only. Gradebook had a fixed Year 1–4.

## Hosting and security
- **Worker runs first only for `/api/*` and `/auth/*`**; the page is plain static assets (fast, cacheable, no Worker cost).
- **D1 binding is named `gradecalc`** (as specified), so Worker code reads `env.gradecalc`.
- **CSP `default-src 'none'`, only `'self'` sources, no `'unsafe-inline'`.** No inline scripts/styles anywhere; the theme
  is set by `/js/theme.js` in `<head>` before first paint.
- **Theme default:** the visitor's saved choice → their system setting → dark (brand default). Public visitors mostly
  expect their system theme; Aidan's own repos default to dark.
- **Indexable** (public product): `robots.txt` only disallows `/api/` and `/auth/`. Gradebook is noindex; GradeCalc isn't.
- `Cache-Control: no-cache` on static files (revalidate every load, so a push shows up immediately).
- **LeakGuard reads real-data fingerprints at run time** from the local `../Gradebook` checkout (course codes, its D1 id)
  and an untracked `.leakguard.local.txt`. The list of what must not leak can't itself be committed to a public repo.
  It also scans the added lines of every commit being pushed, so data that was committed and then deleted is still caught.
- **LeakGuard fails closed** (Aidan, 2026-11-18): no `../Gradebook/program/program.json` (or `LEAKGUARD_GRADEBOOK`) →
  exit 2, push blocked. `.leakguard.local.txt` stays optional (extra strings); the Gradebook checkout is the required source.
  `--ci` is the Workers Builds build command, so every deploy is checked even from a machine without the private
  checkout: it skips only the personal fingerprints and commit-history scan.
