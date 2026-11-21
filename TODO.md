# TODO

## Round 0 — scaffold (this round)
- [x] Repo files, agents, ContextKeeper, LeakGuard + pre-push hook, wrangler.jsonc, D1 `gradecalc` created
- [x] Coming-soon page, About, Privacy (current state), footer with disclaimer, theme toggle
- [x] ui-check (Playwright) + Worker tests
- [x] Workers Builds connected (Aidan, 2026-11-18; build command `node scripts/leakguard.mjs --ci`)

## Round 1 — math
- [x] Port Gradebook `calc.js` (rewrite comments generically) + tests with made-up numbers (CalcCheck: 7 bugs found and fixed)
- [x] Points / letter input, pass-fail / transfer / withdrawn, repeated courses (default: best counts, per UWindsor), nested components
- [x] "What do I need" per course and per remaining item
- [x] GPA scales: UWindsor source cited (DECISIONS.md); UWindsor %, UWindsor 13-pt, generic 4.0 / 12-pt, custom
- [x] Repeat default switched to "best" (Aidan, 2026-11-18; APC minutes 2017-09-20 cited)

## Round 2 — guest app
- [x] localStorage store (hardened by AuthGuard), quick start + setup wizard, courses/components/items, demo data, reset
- [x] All graphs, dark/light, 360 px, print view; letters, course types, repeats, one-level nesting, per-item "what do I need"

## Round 3 — edit structure
- [x] Drag-and-drop + ↑/↓, duplicate, bulk add/edit, average-change preview, delete warnings, undo/redo, history,
      Recently deleted, move courses, archive terms, live weight check, empty states (2026-11-19; reviewed by all four agents)
- [x] Cumulative ⓘ (repeats) and the disclaimer footer on every screen incl. phone term/course views (Aidan, 2026-11-19)

## Round 4 — files
- [x] SheetJS CE vendored (pinned, licence file), Excel export/import, CSV, JSON backup/restore, course templates (2026-11-20)
- [x] ⓘ says "higher or lower"; refused saves show "Changed in another tab — Reload" (Aidan, 2026-11-20)

## Round 5 — accounts
- [x] Google + Microsoft OIDC, sessions, CSRF, rate limits, consent screen, Save to cloud, autosave/offline/conflict (2026-11-20)
- [x] Account page (download JSON/Excel, delete), admin page (count + storage only), AuthGuard isolation tests
- [x] Rate limits 600/min per IP + 120/min per signed-in user; email label removed from wrangler.jsonc (Aidan, 2026-11-20)
- [ ] Go-live steps: see "Accounts go-live (Aidan)" below
- [ ] Test Microsoft sign-in with a UWindsor account; if admin approval is required → keep the "use Google" message
      (already shown on that error) and add a line to the sign-in dialog + How to use
- [ ] Check the live site after deploy: sign in with both providers, sync between two devices, delete account

## Accounts go-live (Aidan)
Until these are done the live site says sign-in "isn't switched on yet"; guest mode works. Details: README "Accounts setup".
1. [ ] `npx wrangler d1 migrations apply gradecalc --remote`
2. [ ] Google OAuth app (console.cloud.google.com → Google Auth Platform): Audience **External**, then **Publish app**
       ("In production"). Client type **Web application**, Authorised redirect URI exactly:
       `https://gradecalc.aidanwbrown.com/auth/callback/google`
3. [ ] Microsoft app registration (entra.microsoft.com → App registrations → New registration): Supported account types
       **Accounts in any organizational directory (any Microsoft Entra ID tenant) and personal Microsoft accounts**.
       Redirect URI, platform **Web**, exactly: `https://gradecalc.aidanwbrown.com/auth/callback/microsoft`.
       Certificates & secrets → New client secret → copy its **Value** (not the Secret ID).
       Secret expiry date: ____________ (renew before then, then `wrangler secret put MICROSOFT_CLIENT_SECRET` again)
4. [ ] Secrets (each command asks for the value; type/paste it in the terminal):
       `npx wrangler secret put SESSION_SECRET` (make one with
       `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`)
       `npx wrangler secret put GOOGLE_CLIENT_ID` · `npx wrangler secret put GOOGLE_CLIENT_SECRET`
       `npx wrangler secret put MICROSOFT_CLIENT_ID` (Application (client) ID) · `npx wrangler secret put MICROSOFT_CLIENT_SECRET`
5. [ ] Sign in on the site with Google once, then read your subject ID:
       `npx wrangler d1 execute gradecalc --remote --command "SELECT provider, subject FROM users WHERE provider = 'google'"`
       → `npx wrangler secret put ADMIN_SUB` (that `subject`). Sign out and in again: Account shows **Admin**.
6. [ ] Test sign-in with your UWindsor Microsoft account: admin approval needed or not? If needed, add a line to the
       sign-in dialog + How to use (the "use Google" message on that error already exists).

## Round 6 — guide + PWA
- [x] How to use (/help), Privacy final, manifest + service worker (offline), polish (2026-11-20; the GuideWriter notes below are
      covered in /help; reviewed by all four agents)
- [ ] When accounts go live: update /help "Accounts (optional, coming soon)", FAQ q-account and the Privacy note
- [x] (done, kept for reference) How to use (5 steps, every field, worked example, searchable FAQ; note that other schools may count the "latest attempt" and how to change the repeat policy), Privacy page final, manifest + service worker, launch
- [ ] How to use must also cover (noted by GuideWriter, Round 2):
  - Repeats: UWindsor counts the best attempt; many schools count the latest. Change the default in **Settings** →
    "Repeated courses: which attempt counts", or for one course: **Edit structure** → "Repeat of an earlier attempt?" →
    then "Which attempt counts". Each attempt stays in its own term; only year/cumulative averages change.
  - The repeat link only appears once you have another graded course to link to.
  - Welcome screen: **Set up my first course**, **Try it with demo data**, **Start with a term**.
  - **+ Mark** (desktop button and phone button), **Edit structure**, **History**, **Print**, **Graphs**, **Recently deleted** (30 days).
  - Course types: Graded, Pass/fail, Transfer credit, Withdrawn (what counts in averages and credits).
  - Course fields: Title, Code, Short name, Credits, Type, curve, Cap at 100%, final grade override, Notes; moving a course to another term.
  - Component fields: weight, **Bonus (on top of 100)**, drop lowest (so far vs average), excused items and where their weight goes,
    final-replaces-midterm rule, nested components; the live "Weights = 100" check (over 100 counts as bonus).
  - Item fields: mark / out of, letter marks, item weight, counts in, excused, curve, projected mark, date.
  - "What do I need?" target + "on which marks", and the term graph target: both are projections, never saved as marks.
  - Grade scales: UWindsor percentage (letter beside), UWindsor 13-point (courses before Fall 2013), generic 4.0 / 12-point
    (not official anywhere), Custom ("minimum% letter points", points optional but all-or-none). Credits for a new course.
  - Your data: **Load demo data** replaces everything; **Reset everything** clears the gradebook, history and Recently deleted
    but not theme/view choices (clear site data for those). Backups: see the Round 4 note (**Files**).
  - FAQ: data lost after clearing browser data / private mode; using two tabs at once (they sync); phone vs laptop (separate until accounts).
- [ ] How to use must also cover (noted by GuideWriter, Round 3):
  - **Undo** ↶ / **Redo** ↷ in the top bar, and Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (⌘ on a Mac). Not while typing in a box
    (the box's own undo runs) or with a dialog open. Only for this visit: cleared by a reload, **Load demo data**,
    **Reset everything** or a change in another tab. Toasts offer **Undo** / **Redo**. A whole setup, duplicate or bulk edit
    is one step.
  - **Edit structure** (shows as **Edit** on phones; **Done editing** / **Done** to leave): reorder terms, courses,
    components, parts and items with **↑** / **↓**; drag the **⠿** handle on a computer.
  - **Duplicate course…**: pick **Into term**; tick **Copy marks, the final grade and the curve too** or get the structure
    only. Same term adds "(copy)" to the title. Repeat links aren't copied. Use it for a retake or the same course next term.
  - **Duplicate** on a component: copies its parts and items with no marks, named "(copy)"; a "final replaces midterm"
    style rule is dropped from the copy (two components can't take the same weight).
  - **Bulk add / edit** on a component: one "Name: mark" line each (85, 85%, 17/20 or B+); a blank mark clears it; matching
    names change marks, new names add items, removed lines delete nothing; **+ 5 numbered lines**; shows the counts and a
    preview before **Save**.
  - Previews (labelled "preview") of how the course, term and cumulative averages change: in the **+ Mark** sheet, bulk edit,
    and the delete warnings for terms, courses, components and marked items. Previews are never saved.
  - Deleting an item with no mark happens at once (Undo in the toast); everything else asks first. All go to
    **Recently deleted** for 30 days.
  - **Archived** checkbox on a term (Edit structure): folds the term under "Archived terms" in the list, **+ Mark** skips its
    courses, but it still counts in every average and graph.
  - **History (all changes)** under **More** (last 1000 changes) vs the per-course **History**.
  - The ⓘ next to **Cumulative average**: why the cumulative can be higher or lower than every year average with repeats
    (it follows the repeat setting; see the Round 4 note).
  - FAQ: "I pressed Ctrl+Z and nothing happened" (click outside the text box first; undo doesn't survive a reload);
    "Does archiving remove a term from my GPA?" (no).
- [ ] How to use must also cover (noted by GuideWriter, Round 4):
  - Where **Files** is: **More** → **Files: Excel, CSV, backup, templates**; also **Settings** → **Export / import…**, and
    **Import a file** on the welcome screen ("Have a backup or a spreadsheet?").
  - **Download** buttons: **Excel (.xlsx)** (one sheet per kind of row + a "Read me" sheet, averages beside them),
    **CSV (marks)** (one row per mark: term, course, component, item), **Backup (.json)** (everything, including History and
    Recently deleted; the one to keep). Made on the device; nothing is uploaded.
  - What CSV loses: rules (final replaces midterm), drop lowest, curves, excused targets, settings, History and Recently
    deleted. Excel keeps rules and curves but not History or Recently deleted. Only the backup keeps everything.
  - **Import** → **Choose a file…** (.xlsx, .csv or .json; up to 5 MB / 20,000 rows). It shows what's in the file, then
    **Add to my gradebook** (file's terms go after yours, your settings stay) or **Replace my gradebook** (the whole
    gradebook becomes the file: a backup brings its settings and history; Excel brings its settings; CSV uses default
    settings; History and Recently deleted start empty except from a backup). Just **Import** when the gradebook is empty.
  - **Undo** in the toast right after an import puts the previous gradebook back. The ↶ / ↷ steps from before the import
    are cleared.
  - Editing the Excel file: keep the **Id** columns as they are; leave **Id** blank for a new row and name its parent instead
    (Courses → Term; Components → Course code or title; Items → Course + Component). Marks: a percent item has "%" in
    **Out of** (85 = 85%), a points item a number (17 out of 20); Letter A+ to F when there's no number. Columns marked
    "(calculated)" are ignored on import. Rule / Curve / Excused columns are advanced (JSON text). Errors name the sheet
    and row. Any spreadsheet's first sheet works if it has Course code (or title) and Component columns. Old .xls may not
    import (save as .xlsx).
  - Course templates: **Edit structure** → **Save as template** on a course downloads its structure (title, code,
    credits, type, cap, components, parts, items, rules) with no marks, letters, curves, dates or notes. To use one:
    **Files** → **Choose a file…** → pick the template → **Into term** → **Add course** (one undo step). Needs a term
    first. Good for sharing a syllabus setup with classmates.
  - The banner under the top bar: **Changed in another tab —** **Reload** "Your last change wasn't saved." It stays until
    you press **Reload**; then redo the last change. Also shown when an import is refused for the same reason.
  - The ⓘ next to **Cumulative average** now says the cumulative "can be higher or lower than every year average"
    (best and latest policies).
  - FAQ: "I got 'Changed in another tab'" (another tab saved first; press Reload, then make the change again; keep one
    tab open to avoid it); "How do I move my grades to another browser or computer?" (Backup (.json) → Import → Replace);
    "Is my file uploaded anywhere?" (no); "Can I share my course setup without my marks?" (Save as template);
    "Why did my rules / curves disappear after a CSV import?" (CSV doesn't hold them; use Excel or the backup).
- [ ] How to use must also cover (noted by GuideWriter, Round 5):
  - Signing in is optional. Where to find it: the person icon in the top bar (label **Sign in**, then **Account** once
    signed in); the welcome screen link **Sign in (optional)**; **More** → **Sign in to sync across devices (optional)**
    (signed in: **Account: sync, download, sign out**); **Settings** → **Sign in…** (signed in: **Account…**).
  - Sign-in dialog **Sign in to sync (optional)**: **Continue with Google**, **Continue with Microsoft**, **Not now**.
    Notes on it: no password is stored; Google and Microsoft are separate accounts here, even with the same email; the
    guest gradebook stays in this browser.
  - Consent screen **Save your gradebook to your account?** lists what's stored (gradebook; sign-in ID and email; a
    30-day sign-in session). **I agree** or **No thanks, sign out** (Esc doesn't skip it). Toasts: "Signed in. Your
    gradebook now syncs to your account." / "Signed out. Nothing was saved to an account."
  - First sign-in with an empty account and a guest gradebook here: **Save this browser’s gradebook to your account?** →
    **Save to my account** (a copy; the guest one stays) or **Start empty**. Later from **Account** → "Guest gradebook in
    this browser": **Add it to my account** (its terms go after yours) or **Replace my account’s gradebook with it**
    (asks first; no Undo after).
  - The save note in the top bar: "Saved in this browser" (guest); signed in: "Saved to your account", "Saving to your
    account…", "Offline: saved on this device, will sync", "Not synced: changed on another device", "Signed out: changes
    kept on this device", "Not synced: too big for an account (see Account)" (about 1.5 MB), "Not synced yet: will try again".
  - Changes save about 2 seconds after you make them and work offline (sent when you're back online). Changes from your
    other device show up when you come back to the tab: toast "Updated from your other device."
  - Banner **Updated on another device —** **Use that version** (drops this device's unsynced changes) / **Keep mine**
    (replaces the other device's version). "Your changes here weren’t synced." Not the same as the Round 4 banner
    **Changed in another tab — Reload** (two tabs in one browser).
  - Banner **Signed out —** **Sign in again**: "Changes on this device aren’t in your account yet. They’re kept here until
    you sign in."
  - **Account** dialog: "Signed in with Google/Microsoft as …", sync state, "Last synced", size in KB, "Account since",
    "Agreed to storage on"; **Download everything**: **Account + gradebook (.json)** (account details + whole gradebook
    from the server; for keeping, not for Import) and **Excel (.xlsx)**; **Sign out**; **Delete my account…**; **Close**.
    Admin only: **Accounts and storage** (counts only).
  - **Sign out**: syncs first, then removes the account's copy from this browser and shows the guest gradebook again. If
    it can't sync: **Sign out without syncing?** → **Sign out anyway** deletes those changes here (download a Backup first).
  - **Delete my account…** → **Delete your account and everything in it?** → **Delete my account**: account, gradebook
    (every device) and sign-in sessions go from the server at once; can't be undone; the guest gradebook stays. Toast "Your
    account and everything in it were deleted." **Reset everything** while signed in empties the account's gradebook but
    keeps the account.
  - Dialog **Unsynced changes from another account** (someone else's unsynced changes on a shared browser): **Download them
    (.json)** or **Discard them**.
  - Sign-in messages (toasts): "Sign-in didn’t work. Try again, or keep using GradeCalc without an account."; "Sign-in
    cancelled. Nothing changed."; "Your school’s Microsoft account needs an administrator’s approval for GradeCalc. Sign
    in with Google instead, or keep using guest mode."; "Sign-in isn’t switched on yet. Everything still works without an
    account."; "Couldn’t reach your account (offline?). …"; "You were signed out. Sign in again to sync." (sessions last 30
    days).
  - FAQ: "Do I need an account?" (no; guest mode does everything, an account only syncs devices); "Where is my data when
    I'm signed in?" (Cloudflare D1 + a copy in this browser; only you can see it; see Privacy); "My school Microsoft
    account asks for admin approval" (your school blocks new apps; use Google or guest mode); "I signed in with Google on my
    phone and Microsoft on my laptop and my marks are missing" (separate accounts, never joined by email; use the same
    one); "Updated on another device — which do I pick?" (Use that version if the other device has the newer work; Keep
    mine if this one does; or download a Backup first, pick one, then re-enter the few missing marks); "What happens to my
    guest gradebook when I sign in / out?" (it stays in this browser untouched; you can copy it to your account; signing out
    shows it again); "Does my phone see my marks without internet?" (yes, the last synced copy; changes sync later); "Why
    does it say Signed out?" (30-day session ended; Sign in again, nothing here is lost); "How do I delete everything?"
    (Account → Delete my account… for the server and this browser's account copy; Settings → Reset everything for the
    guest gradebook; clear site data for theme and view choices; Cloudflare's own recovery copies go within 30 days);
    "How do I get a copy of my data?" (Account → Account + gradebook (.json), or Files → Backup (.json) to import later);
    "Can the site owner see my grades?" (no; the admin page has counts only).
