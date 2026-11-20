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
- Edit structure: reorder terms, courses, components and items (↑/↓, or drag on a computer), duplicate a course (for a
  retake or next term) or a component, bulk add / edit marks ("Name: mark" lines), and archive old terms (they still
  count in your averages).
- Undo and redo (↶ ↷, or Ctrl+Z / Ctrl+Y) for this visit, and a preview of how your averages change before you save a
  mark or delete something.
- Graphs, light and dark themes, a change history (per course or all changes), Recently deleted (30 days), and a print
  view.
- Files (More → Files): download a full backup (.json), an Excel workbook you can edit and import again, or a CSV of
  your marks; import any of them to replace or add to your gradebook (with Undo). Save a course's structure as a
  template (no marks) to share with classmates. Files are made and read in your browser; nothing is uploaded.

- Optional sign-in with Google or Microsoft to sync one gradebook across your devices (works offline; changes made on
  two devices at once are never silently overwritten). Download or delete everything from Account at any time.

Made for students at the University of Windsor, but anyone can use it. *Not affiliated with or endorsed by the University
of Windsor.*

## Privacy in one paragraph
Without an account your grades stay in your browser (localStorage) and are never sent anywhere. Backup, Excel and CSV
files are made on your device. With an optional account (after you agree to what's stored), your gradebook, your
Google/Microsoft sign-in ID and email are kept in a Cloudflare D1 database and only you can see your gradebook (a copy also
stays in your browser for offline use until you sign out). No passwords are stored, and you can download or delete
everything at any time from **Account** (the person icon). There are no ads, trackers or analytics. Details:
[Privacy](https://gradecalc.aidanwbrown.com/privacy).

## Run it yourself
Requirements: Node 20+.

```sh
npm install
npm test                 # unit + Worker tests (accounts run on a real SQLite with a fake Google/Microsoft)
npm run test:ui          # Playwright check (uses your installed Edge or Chrome), incl. sign-in and sync end to end
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
2. **Database schema:** `npx wrangler d1 migrations apply gradecalc --remote`.
3. **Secrets** (never in git): `npx wrangler secret put <NAME>` for each value in `.dev.vars.example` except
   `PUBLIC_ORIGIN` (a var in `wrangler.jsonc`). Until they're set, sign-in says "isn't switched on yet" and guest mode
   works as before.

### Accounts setup (once)
**Google** (console.cloud.google.com):
1. Create a project "GradeCalc". Go to **Google Auth Platform** (APIs & Services → OAuth consent screen).
2. **Branding:** app name GradeCalc, your support email, home page `https://gradecalc.aidanwbrown.com`, privacy policy
   `https://gradecalc.aidanwbrown.com/privacy`, authorised domain `aidanwbrown.com`.
3. **Audience:** External, then **Publish app** (In production). Only `openid` and `email` are used, which don't need
   Google's verification; in "Testing" only listed test users could sign in.
4. **Clients → Create client → Web application**, name GradeCalc. Authorised redirect URI:
   `https://gradecalc.aidanwbrown.com/auth/callback/google` (for local testing also `http://localhost:8787/auth/callback/google`).
5. Copy the client ID and secret: `npx wrangler secret put GOOGLE_CLIENT_ID`, then `npx wrangler secret put GOOGLE_CLIENT_SECRET`.

**Microsoft** (entra.microsoft.com, signed in with a personal Microsoft account; a school account usually can't
register apps):
1. **App registrations → New registration**, name GradeCalc. Supported account types: **Accounts in any organizational
   directory and personal Microsoft accounts**. Redirect URI: platform **Web**,
   `https://gradecalc.aidanwbrown.com/auth/callback/microsoft`. Register.
2. Copy **Application (client) ID**: `npx wrangler secret put MICROSOFT_CLIENT_ID`.
3. **Certificates & secrets → New client secret** (24 months; note the expiry date), copy its **Value**:
   `npx wrangler secret put MICROSOFT_CLIENT_SECRET`.
4. **API permissions:** Microsoft Graph delegated `openid`, `email`, `profile` (User.Read can stay or go).
5. Some schools only allow apps an administrator approved. Then their students see "needs an administrator's approval"
   and GradeCalc tells them to use Google.

**The rest:**
1. `SESSION_SECRET` (signs the sign-in cookie): generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` and paste it into
   `npx wrangler secret put SESSION_SECRET`.
2. Admin page: sign in on the site with Google once, then read your subject id with
   `npx wrangler d1 execute gradecalc --remote --command "SELECT provider, subject, email FROM users WHERE provider = 'google'"`
   and `npx wrangler secret put ADMIN_SUB` with that `subject`. Sign out and in again; Account shows **Admin**.

## Contributing / development
See `CLAUDE.md` (layout, commands, rules). Excel support uses [SheetJS Community Edition](https://sheetjs.com) 0.20.3
(Apache-2.0), vendored unmodified in `site/vendor/` with its licence. Before pushing, run `npm run setup-hooks` once so the LeakGuard pre-push check runs.

Made by [Aidan Brown](https://aidanwbrown.com).
