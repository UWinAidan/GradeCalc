/* ui-check, accounts (Round 5): the real Worker (worker/index.js) on a SQLite D1 with the real migrations, and a fake
 * Google / Microsoft (fake-cloud.js) answering the browser's sign-in redirects. Guest mode never calls /api; sign in →
 * consent → "Save to my account" → autosave → another device's save → "Use that version" / "Keep mine" → offline and
 * back → reload → sign out (guest gradebook back) → sign in again → delete account; admin counts; Microsoft admin
 * approval message; 360 px. Called from ui-check.mjs with its browser and check(). Made-up people only. */
import worker from '../worker/index.js';
import { makeEnv, makeProviders } from './fake-cloud.js';
import { computeAll } from '../shared/calc.js';
import { demoDoc } from '../site/js/demo.js';

export const accountEnv = () => makeEnv();

/** The Worker as serve.mjs's /api + /auth handler. `origin()` is the address the browser uses (for PUBLIC_ORIGIN). */
export function workerHandler(env) {
  return async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const r = await worker.fetch(new Request(env.PUBLIC_ORIGIN + req.url, { method: req.method, headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    const out = {};
    r.headers.forEach((v, k) => { if (k !== 'set-cookie') out[k] = v; });
    const cookies = r.headers.getSetCookie();
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
  };
}

export async function accountChecks({ browser, check, env, base }) {
  const P = await makeProviders();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, i) => P.fetch(u, i); // the Worker's calls to the providers' token + key endpoints
  const db = env.gradecalc.raw;
  const pctText = (v) => `${(v * 100).toFixed(2)}%`;
  const demoCum = pctText(computeAll(demoDoc()).cumulative.average);
  try {
    for (const [label, width, height] of [['desktop', 1366, 768], ['phone 360', 360, 740]]) {
      const tag = `accounts ${label}`;
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = [], apiCalls = [], external = [];
      // 401 / 403 (consent needed) / 409 answers are expected in these flows; Chrome logs every non-2xx fetch as a console error.
      page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|409)|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('request', (r) => {
        const u = r.url();
        if (u.startsWith(`${base}/api/`) || u.startsWith(`${base}/auth/`)) apiCalls.push(u.slice(base.length));
        else if (!u.startsWith(base) && !/^(data|blob|about):/.test(u)) external.push(u);
      });
      // The providers' sign-in pages: the browser never reaches them. /auth/login's redirect is answered at once with the
      // provider's redirect back (as if the person picked their account). Playwright can't intercept followed redirects.
      await ctx.route(/\/auth\/login\/[a-z]+$/, async (route) => {
        const resp = await route.fetch({ maxRedirects: 0 });
        const loc = resp.headers().location || '';
        if (!/^https:\/\//.test(loc)) return route.fulfill({ response: resp });
        const { code, state, redirect } = P.authorize(loc);
        const back = P.deny ? `${redirect}?error=consent_required&error_description=AADSTS65001%3A+admin+approval+required` : `${redirect}?code=${code}&state=${state}`;
        await route.fulfill({ status: 302, headers: { Location: back, 'Set-Cookie': resp.headers()['set-cookie'] || '' } });
      });
      const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ...[...document.querySelectorAll('.pane, dialog[open]')].filter((p) => p.offsetParent || p.open).map((p) => p.scrollWidth - p.clientWidth)));
      const value = (sel) => page.textContent(sel);
      const serverDoc = () => { const r = db.prepare('SELECT doc, version FROM gradebooks').get(); return r ? { version: r.version, doc: JSON.parse(r.doc) } : null; };
      const synced = () => page.waitForFunction(() => document.getElementById('save-state').textContent === 'Saved to your account', null, { timeout: 8000 });
      const setCredits = async (n) => {
        await page.click('#open-settings');
        await page.fill('#dlg input[aria-label="Default credits"]', String(n));
        await page.click('#dlg .row .btn.primary');
      };
      const sub = `ui-student-${width}`;
      const ready = () => page.waitForSelector('#loading', { state: 'detached' });
      /** Click something that leaves the page (sign-in link, sign out, delete) and wait for the new page to be ready. */
      const nav = async (sel) => { await Promise.all([page.waitForEvent('load', { timeout: 15000 }), page.click(sel)]); await ready(); };

      // Guest: no server calls at all.
      await page.goto(`${base}/`);
      await page.waitForSelector('#quick-start');
      await page.click('#try-demo');
      await page.waitForSelector('#pane-overview .stat.big');
      check(`${tag}: guest mode makes no /api or /auth requests`, apiCalls.length === 0, apiCalls.join(' '));
      check(`${tag}: top bar has a Sign in button, no sideways scroll`, (await page.getAttribute('#account-btn', 'aria-label')) === 'Sign in' && (await overflow()) <= 0);

      // Everything below runs with the service worker in charge of the page, as for real visitors (it leaves /auth/* and
      // /api/* to the network, so the route above still answers /auth/login).
      const swOn = await page.evaluate(async () => {
        await navigator.serviceWorker.ready;
        for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
        return !!navigator.serviceWorker.controller;
      });
      check(`${tag}: service worker controls the page during the account flows`, swOn);

      // Sign in → consent.
      await page.click('#account-btn');
      check(`${tag}: sign-in dialog offers Google and Microsoft`, await page.isVisible('#signin-google') && await page.isVisible('#signin-microsoft'));
      check(`${tag}: sign-in dialog no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      P.as(P.google(sub, `${sub}@example.test`));
      await page.click('#signin-google');
      await page.waitForSelector('#consent-yes');
      check(`${tag}: consent shown before anything is saved`, (await value('#dlg')).includes('To sync, GradeCalc stores') && db.prepare('SELECT COUNT(*) n FROM gradebooks').get().n === 0);
      check(`${tag}: ?signin=ok removed from the address bar`, !page.url().includes('signin='));
      check(`${tag}: consent no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      await page.keyboard.press('Escape');
      check(`${tag}: Esc doesn't skip the consent`, await page.isVisible('#consent-yes'));
      await page.click('#consent-yes');

      // Empty account + guest data → "Save to my account".
      await page.waitForSelector('#save-guest');
      check(`${tag}: empty account offers to save the guest gradebook`, (await value('#dlg')).includes('Your account is empty'));
      await page.click('#save-guest');
      await synced();
      await page.waitForSelector('#pane-overview .stat.big');
      let s = serverDoc();
      check(`${tag}: guest gradebook saved to the account`, s && s.doc.terms.length === demoDoc().terms.length && (await value('#pane-overview .stat.big .value')) === demoCum);
      check(`${tag}: account button shows signed in`, (await page.getAttribute('#account-btn', 'aria-label')) === 'Account');
      check(`${tag}: guest gradebook untouched`, await page.evaluate(() => !!localStorage.getItem('gc-gradebook')));

      // Autosave.
      await setCredits(4);
      await synced();
      s = serverDoc();
      check(`${tag}: a change autosaves to the account`, s.doc.settings.default_credits === 4, `v${s.version}`);

      // Another device saves first → banner → Use that version.
      const other = (credits) => {
        const cur = serverDoc();
        cur.doc.settings.default_credits = credits;
        db.prepare('UPDATE gradebooks SET doc = ?, version = version + 1').run(JSON.stringify(cur.doc));
      };
      other(7);
      await setCredits(5);
      await page.waitForSelector('#sync-banner:not([hidden])', { timeout: 8000 });
      check(`${tag}: another device's save → "Updated on another device"`, (await value('#sync-banner')).includes('Updated on another device') && await page.isVisible('#sync-theirs') && await page.isVisible('#sync-mine'));
      check(`${tag}: conflict banner no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      check(`${tag}: nothing overwritten while in conflict`, serverDoc().doc.settings.default_credits === 7);
      await page.click('#sync-theirs');
      await page.waitForSelector('#sync-banner', { state: 'hidden' });
      check(`${tag}: Use that version takes the other device's`, (await page.evaluate(() => JSON.parse(localStorage.getItem('gc-cloud-doc')).settings.default_credits)) === 7);
      // … and Keep mine.
      other(8);
      await setCredits(6);
      await page.waitForSelector('#sync-banner:not([hidden])', { timeout: 8000 });
      await page.click('#sync-mine');
      await synced();
      check(`${tag}: Keep mine replaces the other device's`, serverDoc().doc.settings.default_credits === 6);

      // Offline, then back online.
      await ctx.setOffline(true);
      await setCredits(9);
      await page.waitForFunction(() => document.getElementById('save-state').textContent.startsWith('Offline'), null, { timeout: 8000 });
      check(`${tag}: offline → kept on this device`, serverDoc().doc.settings.default_credits === 6);
      await ctx.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await synced();
      check(`${tag}: back online → synced`, serverDoc().doc.settings.default_credits === 9);

      // Reload: still signed in, same data.
      await page.reload();
      await page.waitForSelector('#pane-overview .stat.big');
      await synced();
      check(`${tag}: reload stays signed in`, (await page.getAttribute('#account-btn', 'aria-label')) === 'Account' && (await value('#pane-overview .stat.big .value')) === demoCum);

      // Account page.
      await page.click('#account-btn');
      await page.waitForSelector('#sign-out');
      check(`${tag}: account page shows who and the downloads`, (await value('#dlg')).includes(`${sub}@example.test`) && (await page.getAttribute('#account-export', 'href')) === '/api/account/export');
      check(`${tag}: account page has no admin for a normal user`, !(await page.isVisible('#open-admin')));
      check(`${tag}: account page no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#account-export')]);
      const exported = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'));
      check(`${tag}: download everything`, exported.kind === 'account-export' && exported.gradebook.settings.default_credits === 9 && /^gradecalc-backup-account-/.test(dl.suggestedFilename()));

      // Sign out → the guest gradebook again, the account copy gone from this browser.
      await nav('#sign-out');
      check(`${tag}: sign out → guest gradebook, account copy removed`, (await page.getAttribute('#account-btn', 'aria-label')) === 'Sign in'
        && await page.evaluate(() => !localStorage.getItem('gc-cloud-doc') && !localStorage.getItem('gc-cloud-meta'))
        && (await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).settings.default_credits)) !== 9);

      // Sign in again: no consent question, the account's gradebook comes back from the server.
      P.as(P.google(sub, `${sub}@example.test`));
      await page.click('#account-btn');
      await nav('#signin-google');
      await synced();
      check(`${tag}: sign in again → account gradebook, no consent`, !(await page.isVisible('#consent-yes'))
        && (await page.evaluate(() => JSON.parse(localStorage.getItem('gc-cloud-doc')).settings.default_credits)) === 9);

      // Delete account.
      await page.click('#account-btn');
      await page.click('#delete-account');
      await nav('#dlg .btn.danger');
      await page.waitForFunction(() => document.getElementById('toasts').textContent.includes('were deleted'), null, { timeout: 5000 }).catch(() => {});
      check(`${tag}: delete account → everything gone on the server`, db.prepare('SELECT COUNT(*) n FROM users').get().n === 0
        && db.prepare('SELECT COUNT(*) n FROM gradebooks').get().n === 0 && db.prepare('SELECT COUNT(*) n FROM sessions').get().n === 0);
      check(`${tag}: delete account → guest mode with a message`, (await page.getAttribute('#account-btn', 'aria-label')) === 'Sign in'
        && (await value('#toasts')).includes('were deleted'));

      // Admin: counts only.
      P.as(P.google('admin-sub-1', 'admin@example.test'));
      await page.click('#account-btn');
      await page.click('#signin-google');
      await page.click('#consent-yes');
      await page.waitForSelector('#start-empty');
      await page.click('#start-empty');
      await page.click('#account-btn');
      await page.click('#open-admin');
      await page.waitForSelector('#admin-users');
      check(`${tag}: admin page shows counts only`, (await value('#admin-users')) === '1' && !(await value('#dlg')).includes('ui-student'));
      check(`${tag}: admin page no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      await page.click('#dlg .row .btn');
      await page.click('#account-btn');
      await page.click('#delete-account');
      await nav('#dlg .btn.danger');

      // AuthGuard: the session ends with unsynced changes (a shared computer): the account's copy can be removed from
      // this browser without signing in again.
      const shared = `${sub}-shared`;
      const cloudGone = () => page.evaluate(() => !localStorage.getItem('gc-cloud-doc') && !localStorage.getItem('gc-cloud-meta'));
      P.as(P.google(shared, `${shared}@example.test`));
      await page.click('#account-btn');
      await page.click('#signin-google');
      await page.click('#consent-yes');
      await page.click('#start-empty');
      await setCredits(11);
      await synced();
      db.prepare('DELETE FROM sessions').run(); // expired / revoked elsewhere
      await setCredits(12);
      await page.waitForSelector('#sync-discard', { timeout: 8000 });
      check(`${tag}: signed out with unsynced changes → "Remove from this browser" offered`, (await value('#sync-banner')).includes('Signed out'));
      check(`${tag}: signed-out banner no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
      await page.click('#sync-discard');
      await nav('#dlg .btn.danger');
      check(`${tag}: remove from this browser → account copy gone, guest mode, account untouched`, await cloudGone()
        && (await page.getAttribute('#account-btn', 'aria-label')) === 'Sign in' && serverDoc().doc.settings.default_credits === 11);

      // AuthGuard: consent needed again mid-session and declined → signed out, the account copy leaves this browser.
      P.as(P.google(shared, `${shared}@example.test`));
      await page.click('#account-btn');
      await nav('#signin-google');
      await synced();
      db.prepare('UPDATE users SET consent_version = NULL').run();
      await setCredits(13);
      await page.waitForSelector('#consent-no', { timeout: 8000 });
      await nav('#consent-no');
      check(`${tag}: consent declined mid-session → guest mode, account copy removed, nothing saved`, await cloudGone()
        && (await page.getAttribute('#account-btn', 'aria-label')) === 'Sign in' && serverDoc().doc.settings.default_credits === 11
        && db.prepare('SELECT COUNT(*) n FROM sessions').get().n === 0);
      db.prepare('DELETE FROM users').run(); // (cascades) the next viewport starts from no accounts

      // Microsoft school account that needs an administrator's approval.
      P.deny = true;
      P.as(P.microsoft('aaaaaaaa-bbbb-4ccc-8ddd-000000000001'));
      await page.click('#account-btn');
      await nav('#signin-microsoft');
      await page.waitForSelector('.toast');
      check(`${tag}: Microsoft admin approval → "use Google" message`, (await value('#toasts')).includes('administrator’s approval') && (await value('#toasts')).includes('Google'));
      P.deny = false;

      // Shared computer: after sign-in, sync, sign-out and account deletion the service worker's cache holds only the
      // site's own files (no /api answer, no /auth callback, no ?signin= page, no account data).
      const swCache = await page.evaluate(async () => {
        const out = [];
        for (const name of await caches.keys()) {
          const c = await caches.open(name);
          for (const r of await c.keys()) out.push({ path: new URL(r.url).pathname + new URL(r.url).search, body: await (await c.match(r)).text() });
        }
        return out;
      });
      const leaked = swCache.filter((e) => /^\/(api|auth)\b|\?/.test(e.path) || e.body.includes(sub) || e.body.includes('example.test'));
      check(`${tag}: service worker cache holds only site files, no account data`, swCache.length >= 25 && leaked.length === 0,
        leaked.map((e) => e.path).join(' ') || `${swCache.length} files`);

      check(`${tag}: no console / CSP errors`, errors.length === 0, errors.join(' | '));
      check(`${tag}: no requests to other origins`, external.length === 0, external.join(' | '));
      await ctx.close();
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}
