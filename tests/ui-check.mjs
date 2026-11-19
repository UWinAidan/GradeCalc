/* ui-check (Playwright): every page loads with no console/CSP errors and no requests to other origins, at desktop and
 * 360 px (no sideways scroll), in both themes; header, footer (with the University of Windsor disclaimer) and About links.
 * Then the calculator itself (guest mode): welcome, demo data (numbers checked against calc.js), marks as %, points and
 * letters, "what do I need", Edit structure, wizard, settings, graphs, print, Reset everything, at desktop and 360 px.
 * `node tests/ui-check.mjs`. Uses the installed Edge or Chrome (playwright-core), so no browser download. */
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { build } from '../scripts/build.mjs';
import { computeAll } from '../shared/calc.js';
import { demoDoc } from '../site/js/demo.js';

build(); // site/js/calc.js = shared/calc.js

const { server, url: BASE } = await serve();
let browser;
for (const channel of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* try the next browser */ }
}
if (!browser) { console.error('No Edge/Chrome found for Playwright.'); process.exit(1); }

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

const PAGES = ['/about', '/privacy'];  // the calculator (/) is checked below
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
      check(`${tag}: header + nav`, await page.isVisible('header.top a.home') && (await page.$$('header.top nav a')).length === 3);
      check(`${tag}: footer disclaimer`, (await page.textContent('footer.site')).includes('Not affiliated with or endorsed by the University of Windsor.'));
      check(`${tag}: footer links About + Privacy`, await page.isVisible('footer.site a[href="/about"]') && await page.isVisible('footer.site a[href="/privacy"]'));
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

    const res = await page.goto(BASE + '/');
    check(`${tag}: loads`, res.status() === 200);
    check(`${tag}: theme follows system`, (await page.getAttribute('html', 'data-theme')) === theme);
    await page.waitForSelector('#quick-start');
    check(`${tag}: welcome shows one clear next step`, await page.isVisible('#quick-start') && await page.isVisible('#try-demo'));
    check(`${tag}: footer disclaimer`, (await value('footer.site')).includes('Not affiliated with or endorsed by the University of Windsor.'));
    check(`${tag}: footer links About + Privacy`, await page.isVisible('footer.site a[href="/about"]') && await page.isVisible('footer.site a[href="/privacy"]'));
    check(`${tag}: welcome no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);

    // Demo data: the page shows exactly what calc.js computes.
    await page.click('#try-demo');
    await page.waitForSelector('#pane-overview .stat.big');
    const cum = await value('#pane-overview .stat.big .value');
    check(`${tag}: demo cumulative = calc.js`, cum === pctText(demo.cumulative.average), `${cum} vs ${pctText(demo.cumulative.average)}`);
    check(`${tag}: footer on the overview`, (await value('#pane-overview footer.site')).includes('University of Windsor'));
    check(`${tag}: overview no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);

    // A course in progress (DEMO-2300).
    const stats = demoDoc().courses.find((c) => c.code === 'DEMO-2300');
    await page.goto(`${BASE}/#/t${stats.term_id}/c${stats.id}`);
    await page.waitForSelector('#pane-course .stat.big');
    check(`${tag}: course average = calc.js`, (await value('#pane-course .stat.big .value')) === pctText(demo.courses.get(stats.id).result.average));
    check(`${tag}: course no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);
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
    await page.click('#toggle-structure');

    // Graphs.
    await page.goto(BASE + '/#/');
    await page.waitForSelector('.chart');
    check(`${tag}: graphs (bell, terms, cumulative)`, (await page.locator('.chart').count()) >= 3);
    check(`${tag}: graphs no sideways scroll`, (await overflow()) <= 0, `${await overflow()}px`);

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

await browser.close();
server.close();
console.log(`\nui-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
