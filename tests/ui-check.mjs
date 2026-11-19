/* ui-check (Playwright): every page loads with no console/CSP errors and no requests to other origins, at desktop and
 * 360 px (no sideways scroll), in both themes; header, footer (with the University of Windsor disclaimer) and About links.
 * `node tests/ui-check.mjs`. Uses the installed Edge or Chrome (playwright-core), so no browser download. */
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const { server, url: BASE } = await serve();
let browser;
for (const channel of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* try the next browser */ }
}
if (!browser) { console.error('No Edge/Chrome found for Playwright.'); process.exit(1); }

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

const PAGES = ['/', '/about', '/privacy'];
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
await page.goto(BASE + '/');
check('home says coming soon', await page.isVisible('#coming-soon'));
await ctx.close();

await browser.close();
server.close();
console.log(`\nui-check: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
