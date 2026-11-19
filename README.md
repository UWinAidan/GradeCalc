# GradeCalc

A free grade calculator for university students: **https://gradecalc.aidanwbrown.com** (coming soon).

Set up your terms and courses, enter marks as you get them, and see your **grade so far**, your **current average**, what you
**need** on what's left, and your term and cumulative averages and GPA. It works fully in your browser without an
account. If you want sync across devices, you can sign in with Google or Microsoft.

Made for students at the University of Windsor, but anyone can use it. *Not affiliated with or endorsed by the University
of Windsor.*

## Privacy in one paragraph
Without an account, your grades never leave your browser. With an account, your gradebook is stored in a Cloudflare D1
database and only you can see it. No passwords are stored (sign-in is via Google/Microsoft), and there are no ads,
trackers or analytics. You can download or delete everything at any time. Details: [Privacy](https://gradecalc.aidanwbrown.com/privacy.html).

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
   Worker name `gradecalc`, production branch `main`, build command *(empty)*, deploy command `npx wrangler deploy`.
   Every push to `main` deploys. The first deploy creates the `gradecalc.aidanwbrown.com` custom domain.
2. **Database schema** (from Round 5 on): `npx wrangler d1 migrations apply gradecalc --remote`.
3. **Secrets** (from Round 5 on, never in git): `npx wrangler secret put <NAME>` for each value in `.dev.vars.example`.

## Contributing / development
See `CLAUDE.md` (layout, commands, rules). Before pushing, run `npm run hooks` once so the LeakGuard pre-push check runs.

Made by [Aidan Brown](https://aidanwbrown.com).
