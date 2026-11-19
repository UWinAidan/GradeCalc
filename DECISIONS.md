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

## Math (planned, Round 1)
- **Repeated courses:** default "latest attempt counts", changeable per course (latest / best / all) (Aidan, 2026-11-18).
- **GPA scales:** a scale is only labelled "UWindsor" if it matches the university's official published scale, with the
  source cited here. Otherwise it's named generically (e.g. "Percentage → 4.0"). (Aidan, 2026-11-18.) Source: TBD in Round 1.

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
