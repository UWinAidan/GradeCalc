# GradeCalc

A free grade calculator for university students: **https://gradecalc.aidanwbrown.com** (coming soon).

Set up your terms and courses, enter marks as you get them, and see your **grade so far**, your **current average**, what you
**need** on what's left (labelled as a projection), and your term and cumulative averages and GPA. It works fully in your
browser, with no account.

What it does now:
- A setup wizard for your first course (copy the weights from your syllabus), or demo data to try it out.
- Drop lowest, bonus marks, curves, excused items, final-replaces-midterm, pass/fail, transfer and withdrawn courses.
- Repeated courses: UWindsor counts your best attempt; you can pick latest or all attempts instead (Settings, or per course
  in Edit structure).
- Grade scales: UWindsor percentage, UWindsor 13-point, generic 4.0 and 12-point, or your own.
- Graphs, light and dark themes, a change history per course, Recently deleted (30 days), and a print view.

Coming later: Excel / CSV / JSON backup and course templates, then optional sign-in with Google or Microsoft to sync
across devices.

Made for students at the University of Windsor, but anyone can use it. *Not affiliated with or endorsed by the University
of Windsor.*

## Privacy in one paragraph
Right now there are no accounts: your grades stay in your browser (localStorage) and are never sent anywhere. When
optional accounts arrive, your gradebook will be stored in a Cloudflare D1 database and only you will be able to see it.
No passwords will be stored (sign-in via Google/Microsoft), and you will be able to download or delete everything at any
time. There are no ads, trackers or analytics. Details: [Privacy](https://gradecalc.aidanwbrown.com/privacy).

## Run it yourself
Requirements: Node 20+.

```sh
npm install
npm test                 # unit + Worker tests
npm run test:ui          # Playwright check (uses your installed Edge or Chrome)
npm run dev              # local Worker + site at http://localhost:8787
```

Guest mode needs nothing else. Sign-in needs your own Google/Microsoft OAuth apps and secrets in `.dev.vars` (see
`.dev.vars.example`).

## Hosting (Cloudflare)
The Worker `gradecalc` serves `site/` as static assets and runs only for `/api/*` and `/auth/*`. Its D1 database is
`gradecalc`. `wrangler.jsonc` sets the custom domain only (`workers_dev` and preview URLs off).

1. **Workers Builds:** Cloudflare dashboard → Workers & Pages → Create → *Import a repository* → `UWinAidan/GradeCalc`.
   Worker name `gradecalc`, production branch `main`, build command `node scripts/leakguard.mjs --ci`, deploy command
   `npx wrangler deploy`. A LeakGuard failure stops the deploy.
   Every push to `main` deploys. The first deploy creates the `gradecalc.aidanwbrown.com` custom domain.
2. **Database schema** (from Round 5 on): `npx wrangler d1 migrations apply gradecalc --remote`.
3. **Secrets** (from Round 5 on, never in git): `npx wrangler secret put <NAME>` for each value in `.dev.vars.example`.

## Contributing / development
See `CLAUDE.md` (layout, commands, rules). Before pushing, run `npm run setup-hooks` once so the LeakGuard pre-push check runs.

Made by [Aidan Brown](https://aidanwbrown.com).
