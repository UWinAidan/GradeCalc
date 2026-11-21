/* ui-check (Playwright): every page loads with no console/CSP errors and no requests to other origins, at desktop and
 * 360 px (no sideways scroll), in both themes; header, footer (with the University of Windsor disclaimer) and About links.
 * Then the calculator itself (guest mode): welcome, demo data (numbers checked against calc.js), marks as %, points and
 * letters, "what do I need", Edit structure, wizard, settings, graphs, print, Reset everything, at desktop and 360 px.
 * Round 3: the disclaimer on every screen, the cumulative ⓘ, reorder + undo / redo (Ctrl+Z, buttons), bulk add / edit
 * with a preview, the + Mark preview, delete previews, duplicate a course, archive a term.
 * Round 4: Files (Excel / CSV / JSON export, import replace / add + undo, course templates, a wrong file).
 * A save refused because another tab changed the data shows "Changed in another tab — Reload".
 * Round 5: accounts end to end (ui-accounts.mjs: the real Worker on SQLite + a fake Google / Microsoft).
 * Round 6: How to use (worked example, FAQ search finds each topic), links to it, and the PWA: manifest, service worker,
 * and the site opening with the server switched off (offline, from the service worker's cache).
 * `node tests/ui-check.mjs`. Uses the installed Edge or Chrome (playwright-core), so no browser download. */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { build } from '../scripts/build.mjs';
import { computeAll } from '../shared/calc.js';
import { demoDoc } from '../site/js/demo.js';
import { accountEnv, workerHandler, accountChecks } from './ui-accounts.mjs';

build(); // site/js/calc.js = shared/calc.js

const env = accountEnv();
const { server, url: BASE } = await serve({ api: workerHandler(env) });
// Accounts use http://localhost (a secure context, so the __Host- cookies work); everything else 127.0.0.1.
env.PUBLIC_ORIGIN = BASE.replace('127.0.0.1', 'localhost');
let browser;
for (const channel of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* try the next browser */ }
}
if (!browser) { console.error('No Edge/Chrome found for Playwright.'); process.exit(1); }

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

const PAGES = ['/help', '/about', '/privacy'];  // the calculator (/) is checked below
const SIZES = [['desktop', 1366, 768], ['phone 360', 360, 740]];

for (const theme of ['dark', 'light']) {
  for (const [label, width, height] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [], external = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob|about):/.test(r.url())) external.push(r.url()); });
    for (const p of PAGES) {
      const tag = `${p} ${label} ${theme}`;
      const res = await page.goto(BASE + p);
      check(`${tag}: loads`, res.status() === 200);
      check(`${tag}: theme follows system`, (await page.getAttribute('html', 'data-theme')) === theme);
      check(`${tag}: header + nav`, await page.isVisible('header.top a.home') && (await page.$$('header.top nav a')).length === 4);
      check(`${tag}: footer disclaimer`, (await page.textContent('footer.site')).includes('Not affiliated with or endorsed by the University of Windsor.'));
      check(`${tag}: footer links About + Privacy`, await page.isVisible('footer.site a[href="/about"]') && await page.isVisible('footer.site a[href="/privacy"]'));
      check(`${tag}: footer links How to use`, await page.isVisible('footer.site a[href="/help"]'));
      check(`${tag}: manifest linked`, (await page.getAttribute('link[rel="manifest"]', 'href')) === '/manifest.webmanifest');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${tag}: no sideways scroll`, overflow <= 0, `overflow ${overflow}px`);
    }
    check(`${label} ${theme}: no console / CSP errors`, errors.length === 0, errors.join(' | '));
    check(`${label} ${theme}: no requests to other origins`, external.length === 0, external.join(' | '));
    await ctx.close();
  }
}

// Theme toggle persists; About page links and copy button.
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
await page.goto(BASE + '/about');
await page.click('#theme-btn');
check('theme toggle → light', (await page.getAttribute('html', 'data-theme')) === 'light');
await page.reload();
check('theme choice remembered after reload', (await page.getAttribute('html', 'data-theme')) === 'light');
const links = {
  '#about-email': 'mailto:contact@aidanwbrown.com', '#about-linkedin': 'https://www.linkedin.com/in/aidanbrown5',
  '#about-github': 'https://github.com/UWinAidan', '#about-web': 'https://aidanwbrown.com',
  '#about-star': 'https://github.com/UWinAidan/aidanwbrown-website', '#about-coffee': 'https://buymeacoffee.com/aidanwbrown',
};
for (const [sel, href] of Object.entries(links)) check(`About ${sel} → ${href}`, (await page.getAttribute(sel, 'href')) === href);
for (const sel of ['#about-linkedin', '#about-github', '#about-web', '#about-star', '#about-coffee']) {
  check(`About ${sel} opens a new tab safely`, (await page.getAttribute(sel, 'target')) === '_blank' && (await page.getAttribute(sel, 'rel')).includes('noopener'));
}
check('About shows the disclaimer', (await page.textContent('main')).includes('Not affiliated with or endorsed by the University of Windsor.'));
await page.click('#about-copy');
await page.waitForTimeout(100);
check('Copy button copies the email', (await page.textContent('#about-copy')) === 'Copied ✓');

// How to use: the worked example shows calc.js's numbers (tests/pwa.test.js checks the values); the FAQ search finds
// each topic by its words, and says so when nothing matches.
await page.goto(BASE + '/help');
check('How to use: 5 getting-started steps', (await page.locator('ol.steps > li').count()) === 5);
check('How to use: worked example numbers shown', (await page.locator('[data-calc]').count()) === 5);
const faqTotal = await page.locator('#faq-list .faq-item').count();
const FAQ = { 'where stored': 'q-storage', backup: 'q-backup', curve: 'q-curve', retake: 'q-repeat', 'latest attempt': 'q-repeat',
  'grade so far current average': 'q-sofar', projection: 'q-projection', 'coming soon': 'q-account', offline: 'q-offline',
  template: 'q-template', 'admin approval': 'q-school', 'delete account': 'q-delete', 'gpa scale': 'q-gpa', 'private incognito': 'q-cleared' };
for (const [words, id] of Object.entries(FAQ)) {
  await page.fill('#faq-search', words);
  const shown = await page.locator('#faq-list .faq-item:not([hidden])').evaluateAll((els) => els.map((e) => e.id));
  check(`FAQ search "${words}" finds ${id}`, shown.includes(id) && shown.length < faqTotal, shown.join(','));
}
await page.fill('#faq-search', 'zzqx');
check('FAQ search with no match says so', (await page.locator('#faq-list .faq-item:not([hidden])').count()) === 0 && await page.isVisible('#faq-none'));
await page.fill('#faq-search', '');
check('FAQ search cleared shows every question', (await page.locator('#faq-list .faq-item:not([hidden])').count()) === faqTotal);
await page.goto(BASE + '/help?q=backup#q-backup');
check('FAQ link opens the question', await page.evaluate(() => document.getElementById('q-backup').open) && (await page.inputValue('#faq-search')) === 'backup');
await ctx.close();

// ---------------------------------------------------------------- the calculator (/)
const pctText = (v) => `${(v * 100).toFixed(2)}%`;
const demo = computeAll(demoDoc());

for (const theme of ['dark', 'light']) {
  for (const [label, width, height] of SIZES) {
    const tag = `app ${label} ${theme}`;
    const phone = width < 900;
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [], external = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', (r) => { if (!r.url().startsWith(BASE) && !/^(data|blob|about):/.test(r.url())) external.push(r.url()); });
    const overflow = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ...[...document.querySelectorAll('.pane')].filter((p) => p.offsetParent).map((p) => p.scrollWidth - p.clientWidth)));
    const value = (sel) => page.textContent(sel);
    const disclaimerShown = () => page.evaluate(() => [...document.querySelectorAll('footer.site')]
      .some((f) => f.getClientRects().length > 0 && f.textContent.includes('Not affiliated with or endorsed by the University of Windsor.')));
    const compNames = () => page.locator('#pane-course .comp-head .name .ed').allTextContents();
    const live = (e) => page.evaluate((e) => JSON.parse(localStorage.getItem('gc-gradebook'))[e].filter((r) => !r.deleted_at).length, e);

    const res = await page.goto(BASE + '/');
    check(`${tag}: loads`, res.status() === 200);
    check(`${tag}: theme follows system`, (await page.getAttribute('html', 'data-theme')) === theme);
    await page.waitForSelector('#quick-start');
    check(`${tag}: welcome shows one clear next step`, await page.isVisible('#quick-start') && await page.isVisible('#try-demo'));
    check(`${tag}: footer disclaimer`, (await value('footer.site')).includes('Not affiliated with or endorsed by the University of Windsor.'));
    check(`${tag}: footer links About + Privacy`, await page.isVisible('footer.site a[href="/about"]') && await page.isVisible('footer.site a[href="/privacy"]'));
    check(`${tag}: welcome links How to use`, await page.isVisible('#welcome-help') && await page.isVisible('footer.site a[href="/help"]'));
    check(`${tag}: welcome no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);

    // Demo data: the page shows exactly what calc.js computes.
    await page.click('#try-demo');
    await page.waitForSelector('#pane-overview .stat.big');
    const cum = await value('#pane-overview .stat.big .value');
    check(`${tag}: demo cumulative = calc.js`, cum === pctText(demo.cumulative.average), `${cum} vs ${pctText(demo.cumulative.average)}`);
    check(`${tag}: footer on the overview`, (await value('#pane-overview footer.site')).includes('University of Windsor'));
    await page.click('#pane-overview .info-btn');
    check(`${tag}: cumulative ⓘ explains repeats`, await page.isVisible('#pane-overview .info-note')
      && (await value('#pane-overview .info-note')).includes('Repeated courses count only your best attempt in the cumulative')
      && (await value('#pane-overview .info-note')).includes('can be higher or lower than every year average'));
    check(`${tag}: ⓘ no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
    check(`${tag}: overview no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);

    // A course in progress (DEMO-2300).
    const stats = demoDoc().courses.find((c) => c.code === 'DEMO-2300');
    await page.goto(`${BASE}/#/t${stats.term_id}/c${stats.id}`);
    await page.waitForSelector('#pane-course .stat.big');
    check(`${tag}: course average = calc.js`, (await value('#pane-course .stat.big .value')) === pctText(demo.courses.get(stats.id).result.average));
    check(`${tag}: course no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
    check(`${tag}: disclaimer on the course view`, await disclaimerShown());
    await page.goto(`${BASE}/#/t${stats.term_id}`);
    await page.waitForSelector('#pane-term .stat');
    check(`${tag}: disclaimer on the term view`, await disclaimerShown());
    await page.goto(`${BASE}/#/t${stats.term_id}/c${stats.id}`);
    await page.waitForSelector('#pane-course .stat.big');
    // + Mark: preview of the averages while typing (never saved until Save).
    await page.click(phone ? '#fab-mark' : '#add-mark');
    await page.fill('#sheet-pct', '90');
    check(`${tag}: + Mark shows an average preview`, (await value('#sheet .preview')).includes('Course average'));
    await page.click('#sheet .row .btn:not(.primary)');
    // Type a mark into the first unmarked item.
    const before = await value('#pane-course .stat.big .value');
    await page.locator('#pane-course tr.unmarked .mark-ed').first().click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const after = await value('#pane-course .stat.big .value');
    check(`${tag}: typing a mark updates the average`, after !== before, `${before} → ${after}`);
    await page.reload();
    await page.waitForSelector('#pane-course .stat.big');
    check(`${tag}: mark kept after reload (localStorage)`, (await value('#pane-course .stat.big .value')) === after);
    // Another tab saved (no storage event reached this one): typing a mark is refused, and a banner says so until Reload.
    check(`${tag}: no conflict banner normally`, !(await page.isVisible('#conflict')));
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('gc-gradebook'));
      d.settings.default_credits = 5;
      localStorage.setItem('gc-gradebook', JSON.stringify(d));
    });
    const marked0 = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).assessments.filter((a) => a.mark !== null).length);
    await page.locator('#pane-course tr.unmarked .mark-ed').first().click();
    await page.keyboard.type('77');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const banner = await page.isVisible('#conflict') ? await value('#conflict') : '';
    check(`${tag}: refused save shows "Changed in another tab — Reload"`, banner.includes('Changed in another tab —') && await page.isVisible('#conflict-reload')
      && (await page.textContent('#conflict-reload')) === 'Reload', banner.replace(/\s+/g, ' ').trim());
    check(`${tag}: refused mark not written over the other tab`, (await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).settings.default_credits)) === 5
      && (await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).assessments.filter((a) => a.mark !== null).length)) === marked0);
    check(`${tag}: conflict banner no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
    await Promise.all([page.waitForEvent('load'), page.click('#conflict-reload')]);
    await page.waitForSelector('#pane-course .stat.big');
    check(`${tag}: Reload clears the banner`, !(await page.isVisible('#conflict')) && (await value('#pane-course .stat.big .value')) === after);
    // Letter-only mark: counts as an estimate.
    await page.locator('#pane-course tr.unmarked .mark-ed').first().click();
    await page.keyboard.type('B+');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check(`${tag}: letter mark shown with an estimate`, (await value('#pane-course .items')).includes('B+') && (await value('#pane-course .items')).includes('est.'));
    // What do I need (a projection).
    await page.fill('#pane-course .need input', '75');
    await page.waitForTimeout(50);
    const answer = await value('#pane-course .need .answer');
    check(`${tag}: what do I need answers`, /need|already there|not reachable/.test(answer), answer);
    check(`${tag}: per-item need shown`, (await page.locator('#pane-course .need-item:not(:empty)').count()) > 0);
    check(`${tag}: need labelled as a projection`, (await value('#pane-course .need')).includes('est.'));

    // Edit structure: live weight check.
    await page.click('#toggle-structure');
    check(`${tag}: edit structure shows the weight check`, (await value('#pane-course .wcheck')).startsWith('Weights = 100'));
    check(`${tag}: edit structure no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
    // Reorder a component, then Ctrl+Z / redo / undo.
    const order0 = await compNames();
    await page.locator('#pane-course .comp-head .order button[title="Move down"]').first().click();
    await page.waitForTimeout(150);
    const order1 = await compNames();
    check(`${tag}: ↓ moves a component`, order1[0] === order0[1] && order1[1] === order0[0], order1.join(','));
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
    check(`${tag}: Ctrl+Z undoes the move`, (await compNames()).join() === order0.join());
    await page.click('#redo');
    await page.waitForTimeout(150);
    check(`${tag}: redo moves it again`, (await compNames()).join() === order1.join());
    await page.click('#undo');
    await page.waitForTimeout(150);
    check(`${tag}: undo button`, (await compNames()).join() === order0.join());
    // Bulk add / edit with a preview; one undo step removes what it added.
    const items0 = await live('assessments');
    await page.locator('#pane-course .struct button', { hasText: 'Bulk add / edit' }).first().click();
    await page.fill('#dlg textarea.bulk', (await page.inputValue('#dlg textarea.bulk')) + '\nMade-up extra A: 90\nMade-up extra B: 17/20');
    await page.dispatchEvent('#dlg textarea.bulk', 'input');
    check(`${tag}: bulk edit preview`, (await value('#dlg')).includes('2 new items') && (await value('#dlg .preview')).includes('Course average'));
    await page.click('#bulk-go');
    await page.waitForTimeout(150);
    check(`${tag}: bulk edit adds items`, (await live('assessments')) === items0 + 2);
    await page.click('#undo');
    await page.waitForTimeout(150);
    check(`${tag}: one undo removes the bulk add`, (await live('assessments')) === items0);
    // AuthGuard: a drop that didn't start on this page (another tab / app, any text) changes nothing.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '1');
      const spot = document.querySelectorAll('#pane-course .comp-head')[1] || document.querySelector('#pane-course .comp-head');
      for (const type of ['dragover', 'drop']) spot.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await page.waitForTimeout(100);
    check(`${tag}: a drop from outside the page is ignored`, (await compNames()).join() === order0.join());
    // AuthGuard: another tab saved and this tab never got the storage event (back/forward cache, or it was late).
    // Undo must not write this tab's stale copy over it.
    await page.locator('#pane-course .comp-head .order button[title="Move down"]').first().click();
    await page.waitForTimeout(150);
    await page.evaluate(() => {
      const d = JSON.parse(localStorage.getItem('gc-gradebook'));
      d.settings.default_credits = 4; // setItem in this page fires no storage event here: same as a missed one
      localStorage.setItem('gc-gradebook', JSON.stringify(d));
    });
    await page.click('#undo');
    await page.waitForTimeout(150);
    const other = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).settings.default_credits);
    check(`${tag}: undo after another tab's save keeps that save`, other === 4 && (await compNames()).join() === order1.join()
      && await page.isDisabled('#undo'), `credits ${other}, ${(await compNames()).join()}`);
    check(`${tag}: refused undo shows the conflict banner`, await page.isVisible('#conflict'));
    await Promise.all([page.waitForEvent('load'), page.click('#conflict-reload')]);
    await page.waitForSelector('#pane-course .stat.big');
    await page.click('#toggle-structure');
    await page.locator('#pane-course .comp-head .order button[title="Move up"]:not([disabled])').first().click(); // back to order0
    await page.waitForTimeout(150);
    // Delete a component with marks: the warning lists the marks and previews the average.
    await page.locator('#pane-course .struct button', { hasText: 'Delete component' }).first().click();
    check(`${tag}: delete warning previews the average`, (await value('#dlg')).includes('deleted with it') && (await value('#dlg .preview')).includes('Course average'));
    await page.click('#dlg .row .btn:not(.danger)');
    check(`${tag}: structure tools no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
    if (!phone) {
      // Duplicate the course (structure only), then undo it in one step.
      const courses0 = await live('courses'), comps0 = (await compNames()).length;
      await page.locator('#pane-course .struct button', { hasText: 'Duplicate course' }).click();
      await page.click('#dup-go');
      await page.waitForFunction(() => document.querySelector('#pane-course h2')?.textContent.includes('(copy)'));
      check(`${tag}: duplicate course`, (await live('courses')) === courses0 + 1 && (await compNames()).length === comps0
        && (await value('#pane-course .stat.big .value')) === '—');
      await page.click('#undo');
      await page.waitForTimeout(150);
      check(`${tag}: undo removes the duplicate`, (await live('courses')) === courses0);
      // Archive a term: it folds away (still counts), and undo brings it back.
      await page.goto(`${BASE}/#/t${stats.term_id}/c${stats.id}`);
      await page.waitForSelector('#pane-term .struct');
      const cumBefore = await value('#pane-overview .stat.big .value');
      await page.locator('#pane-term .struct label.check', { hasText: 'Archived' }).locator('input').check();
      await page.click('#toggle-structure');
      await page.waitForTimeout(100);
      check(`${tag}: archived term folds away`, (await page.locator('#pane-overview details.archived li').count()) === 1
        && (await value('#pane-overview .stat.big .value')) === cumBefore);
      await page.keyboard.press('Control+z');
      await page.waitForTimeout(150);
      check(`${tag}: undo un-archives`, (await page.locator('#pane-overview details.archived').count()) === 0);
      await page.click('#toggle-structure');
    }
    await page.click('#toggle-structure');

    // Graphs.
    await page.goto(BASE + '/#/');
    await page.waitForSelector('.chart');
    check(`${tag}: graphs (bell, terms, cumulative)`, (await page.locator('.chart').count()) >= 3);
    check(`${tag}: graphs no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
    check(`${tag}: disclaimer on the graphs view`, await disclaimerShown());

    if (!phone) {
      // Print view: only the course.
      await page.goto(`${BASE}/#/t${stats.term_id}/c${stats.id}`);
      await page.waitForSelector('#pane-course .stat.big');
      await page.emulateMedia({ media: 'print' });
      check(`${tag}: print shows only the course`, !(await page.isVisible('header.topbar')) && !(await page.isVisible('#pane-overview')) && await page.isVisible('#pane-course .stat.big'));
      await page.emulateMedia({ media: 'screen' });

      // Settings: repeat default is "best"; the generic 4.0 scale shows a GPA.
      await page.click('#open-settings');
      check(`${tag}: repeat default is best attempt`, (await page.inputValue('select[aria-label="Repeated courses"]')) === 'best');
      await page.selectOption('select[aria-label="Grade scale"]', 'gpa4');
      await page.click('#dlg .row .btn.primary');
      await page.waitForTimeout(100);
      check(`${tag}: 4.0 scale shows GPA`, (await value('#pane-overview .stat.big .foot')).startsWith('GPA '));
    }

    // Files (Round 4): downloads made in the page; imports read in the page (nothing uploaded).
    await page.goto(BASE + '/#/overview');
    await page.waitForSelector('#open-files');
    await page.click('#open-files');
    check(`${tag}: files dialog no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
    const grab = async (sel) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
      const file = await dl.path();
      return { name: dl.suggestedFilename(), file, bytes: readFileSync(file) };
    };
    const xlsx = await grab('#export-xlsx');
    check(`${tag}: Excel export (.xlsx, zip)`, /^gradecalc-backup-\d{4}-\d{2}-\d{2}\.xlsx$/.test(xlsx.name) && xlsx.bytes.subarray(0, 2).toString() === 'PK', xlsx.name);
    const csv = await grab('#export-csv');
    check(`${tag}: CSV export`, csv.name.endsWith('.csv') && csv.bytes.toString('utf8').startsWith('﻿Term,Year of study,Course code'));
    const json = await grab('#export-json');
    const backup = JSON.parse(json.bytes.toString('utf8'));
    check(`${tag}: JSON backup export`, backup.app === 'GradeCalc' && backup.kind === 'backup' && backup.gradebook.courses.filter((c) => !c.deleted_at).length === (await live('courses')));
    if (!phone && theme === 'dark') {
      const cum0 = await value('#pane-overview .stat.big .value');
      const terms0 = await live('terms');
      // Excel back in, replacing: same averages.
      await page.setInputFiles('#import-file', { name: xlsx.name, mimeType: 'application/octet-stream', buffer: xlsx.bytes });
      await page.waitForSelector('#import-replace');
      check(`${tag}: import asks replace or add`, await page.isVisible('#import-add') && (await value('#dlg')).includes('Excel workbook'));
      await page.click('#import-replace');
      await page.waitForTimeout(150);
      check(`${tag}: Excel import → same cumulative`, (await value('#pane-overview .stat.big .value')) === cum0 && (await live('terms')) === terms0);
      // JSON added to it: twice the terms; Undo in the toast takes it back.
      await page.click('#open-files');
      await page.setInputFiles('#import-file', { name: json.name, mimeType: 'application/json', buffer: json.bytes });
      await page.click('#import-add');
      await page.waitForTimeout(150);
      check(`${tag}: JSON import (add) doubles the terms`, (await live('terms')) === terms0 * 2);
      await page.locator('.toast button', { hasText: 'Undo' }).last().click();
      await page.waitForTimeout(150);
      check(`${tag}: Undo the import`, (await live('terms')) === terms0 && (await value('#pane-overview .stat.big .value')) === cum0);
      // Undo of an import after another tab saved (and this tab already reloaded it): refused, the other tab's save kept.
      await page.click('#open-files');
      await page.setInputFiles('#import-file', { name: json.name, mimeType: 'application/json', buffer: json.bytes });
      await page.click('#import-add');
      await page.waitForTimeout(150);
      const tab2 = await ctx.newPage();
      await tab2.goto(`${BASE}/`);
      await tab2.evaluate(() => {
        const d = JSON.parse(localStorage.getItem('gc-gradebook'));
        d.settings.default_credits = 6;
        localStorage.setItem('gc-gradebook', JSON.stringify(d));
      });
      await tab2.close();
      await page.waitForTimeout(200); // the storage event reloads this tab
      await page.locator('.toast button', { hasText: 'Undo' }).last().click();
      await page.waitForTimeout(150);
      check(`${tag}: Undo import after another tab's save is refused (no overwrite)`, (await live('terms')) === terms0 * 2
        && (await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).settings.default_credits)) === 6
        && (await page.locator('.toast.err', { hasText: 'Couldn’t undo the import' }).count()) === 1);
      // Back to the exported state for the checks below.
      await page.click('#open-files');
      await page.setInputFiles('#import-file', { name: json.name, mimeType: 'application/json', buffer: json.bytes });
      await page.click('#import-replace');
      await page.waitForTimeout(150);
      check(`${tag}: backup import (replace) restores the gradebook`, (await live('terms')) === terms0 && (await value('#pane-overview .stat.big .value')) === cum0);
      // Course template: save from Edit structure, import into a term → a new course with no marks.
      await page.goto(`${BASE}/#/t${stats.term_id}/c${stats.id}`);
      await page.waitForSelector('#pane-course h2');
      await page.click('#toggle-structure');
      const tpl = await grab('#save-template');
      const tplText = tpl.bytes.toString('utf8');
      check(`${tag}: template has no marks`, tpl.name.startsWith('gradecalc-template-') && JSON.parse(tplText).kind === 'course-template' && !tplText.includes('"mark"'));
      await page.click('#toggle-structure');
      const courses1 = await live('courses'), marks1 = await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).assessments.filter((a) => a.mark !== null && !a.deleted_at).length);
      await page.click('#open-files');
      await page.setInputFiles('#import-file', { name: tpl.name, mimeType: 'application/json', buffer: tpl.bytes });
      await page.click('#template-go');
      await page.waitForTimeout(200);
      check(`${tag}: course from a template (no marks)`, (await live('courses')) === courses1 + 1
        && (await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).assessments.filter((a) => a.mark !== null && !a.deleted_at).length)) === marks1
        && (await value('#pane-course .stat.big .value')) === '—');
      await page.click('#undo');
      await page.waitForTimeout(150);
      check(`${tag}: one undo removes the template course`, (await live('courses')) === courses1);
      // CSV in, replacing.
      await page.click('#open-files');
      await page.setInputFiles('#import-file', { name: csv.name, mimeType: 'text/csv', buffer: csv.bytes });
      await page.click('#import-replace');
      await page.waitForTimeout(150);
      check(`${tag}: CSV import`, (await live('courses')) === backup.gradebook.courses.filter((c) => !c.deleted_at).length);
      // A file that isn't ours: a clear message, nothing changed.
      await page.click('#open-files');
      await page.setInputFiles('#import-file', { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": 1}') });
      await page.waitForSelector('#import-err:not(:empty)');
      check(`${tag}: wrong file → message`, (await value('#import-err')).includes('isn’t a GradeCalc file'));
      await page.click('#dlg .row .btn');
    } else {
      await page.click('#dlg .row .btn');
    }

    // Reset everything → welcome again.
    await page.click('#open-settings');
    await page.click('#settings-reset');
    await page.click('#dlg .btn.danger');
    await page.waitForSelector('#quick-start');
    check(`${tag}: reset everything → welcome`, await page.isVisible('#quick-start')
      && (await page.evaluate(() => JSON.parse(localStorage.getItem('gc-gradebook')).courses.length)) === 0);

    // Setup wizard from the welcome screen (quick start: names a new term).
    await page.click('#quick-start');
    await page.fill('#dlg input[aria-label="Title"]', 'Made-up Course');
    await page.fill('#dlg input[aria-label="Code"]', 'DEMO-9999');
    for (let i = 0; i < 5; i++) await page.click('#dlg .row .btn.primary');
    check(`${tag}: wizard review step`, (await value('#dlg')).includes('Weights = 100'));
    await page.click('#dlg .row .btn.primary');
    await page.waitForSelector('#pane-course h2');
    check(`${tag}: wizard created the course`, (await value('#pane-course h2')).includes('Made-up Course') && (await page.locator('#pane-course .comp').count()) === 3);
    check(`${tag}: wizard course no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);

    // Theme toggle on the calculator.
    await page.click('#toggle-theme');
    check(`${tag}: theme toggle`, (await page.getAttribute('html', 'data-theme')) !== theme);

    check(`${tag}: no console / CSP errors`, errors.length === 0, errors.join(' | '));
    check(`${tag}: no requests to other origins`, external.length === 0, external.join(' | '));
    await ctx.close();
  }
}

await accountChecks({ browser, check, env, base: env.PUBLIC_ORIGIN });

// PWA: the service worker caches the site; with the server switched off the calculator and the guide still open.
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + '/');
  await page.waitForSelector('#quick-start');
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100));
    return { scope: reg.scope, controlled: !!navigator.serviceWorker.controller, cached: (await (await caches.open('gradecalc-v1')).keys()).length };
  });
  check('PWA: service worker active and controls the page', sw.controlled && sw.scope === BASE + '/', JSON.stringify(sw));
  check('PWA: site files cached', sw.cached >= 25, `${sw.cached} files`);
  const manifest = await (await page.request.get(BASE + '/manifest.webmanifest')).json();
  check('PWA: manifest', manifest.start_url === '/' && manifest.display === 'standalone' && manifest.icons.length >= 3);
  await page.click('#try-demo');
  await page.waitForSelector('#pane-overview .stat.big');
  const cum = await page.textContent('#pane-overview .stat.big .value');
  // Switch the server off: every request now fails unless the service worker answers it.
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  const down = await page.request.get(BASE + '/').then(() => false, () => true);
  check('PWA: server is off', down);
  await page.reload();
  await page.waitForSelector('#pane-overview .stat.big');
  check('PWA offline: calculator opens with the marks', (await page.textContent('#pane-overview .stat.big .value')) === cum);
  await page.goto(BASE + '/help');
  check('PWA offline: How to use opens', (await page.textContent('h1')) === 'How to use GradeCalc');
  await page.fill('#faq-search', 'backup');
  check('PWA offline: FAQ search works', await page.isVisible('#q-backup'));
  await page.goto(BASE + '/privacy');
  check('PWA offline: Privacy opens', (await page.textContent('h1')) === 'Privacy');
  check('PWA: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(`\nui-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
