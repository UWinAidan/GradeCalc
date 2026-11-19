# Decisions

Why GradeCalc is the way it is. Newest at the bottom of each section.

## Product
- **Separate product from Aidan's private Gradebook** (2026-11-18). GradeCalc reuses Gradebook's *code* (math, wizard,
  editing, graphs) and EconSolver's *setup* (Workers Builds, Sage Classic, About, footer, ui-check). It starts blank and
  never contains Gradebook data. Separate Worker (`gradecalc`), separate D1 database (`gradecalc`), public repo.
- **Guest mode first, accounts optional.** Everything works with localStorage only; signing in just adds sync.
- **Went live in Round 0 with a "coming soon" page** (Aidan, 2026-11-18) so the deploy pipeline is proven early.
- **Footer + About disclaimer:** "Not affiliated with or endorsed by the University of Windsor." (Aidan, 2026-11-18).

## Data model and sync (planned, Round 5)
- **One row per user** in `gradebooks`: the whole gradebook as versioned JSON + `version` + `updated_at`. Inside the JSON
  the shape mirrors Gradebook's tables (`terms`, `courses`, `components`, `assessments`), so `calc.js` carries over.
- **Optimistic concurrency:** saves send `base_version`; a mismatch returns 409 → "Updated on another device — Reload /
  Keep mine". Autosave ~2 s after the last edit; queued offline and retried.
- Undo / history / Recently deleted live inside the document (capped), so guest mode and accounts behave the same.

## Accounts (planned, Round 5)
- **Google + Microsoft OIDC**, no passwords stored. Microsoft uses the multi-tenant `common` endpoint so UWindsor accounts
  can try; issuer validated per tenant (`tid`).
- **Two separate accounts if the same person uses both providers; no auto-linking by email** (Aidan, 2026-11-18).
  Linking by email across providers is a known account-takeover route.
- **UWindsor Microsoft accounts may need tenant admin approval** for an unverified multi-tenant app. If so it's a known
  limitation: a note on the sign-in screen ("If your school account needs admin approval, use Google"), How to use, TODO.
- **Admin page** only for a Google sign-in whose verified email is `ADMIN_EMAIL` (4aidanbrown@gmail.com); shows user count
  and storage size only, never grades.

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
- **Repeated courses.** ⚠ The policy says *only the highest mark* counts in cumulative and major averages (except
  Nursing clinical courses, where the final attempt counts). Aidan chose the default "latest attempt counts"
  (2026-11-18) before this was found. **The default is still "latest" until he confirms**; "best" matches the policy.
  It's one constant (`settings.repeat_policy_default`, fallback in `computeAll`). Term averages show every attempt in
  its own term. Year, cumulative-to-year and cumulative averages apply the policy **among the attempts inside that
  scope** (CalcCheck, Round 1), so "cumulative to year 1" uses the year-1 attempt even if year 2 has a retake. "Latest" means the latest attempt *that has a grade*, so
  a retake in progress doesn't hide the earlier mark.
- **Rounding:** the policy rounds averages to 2 decimals (88.985 → 88.99). The math keeps full precision; the page
  shows 2 decimals.
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
