// Renders the PWA icons (site/icons/*.png) from site/favicon.svg with the installed Edge/Chrome (playwright-core).
// Run once after changing the favicon: `node scripts/make-icons.mjs`. The PNGs are committed.
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'site/favicon.svg'), 'utf8');
const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const BG = '#1a1c1d'; // Sage Classic dark background (--bg)
// [file, size, monogram size as a share of the icon, background]
const icons = [
  ['icon-192.png', 192, 1, 'transparent'],
  ['icon-512.png', 512, 1, 'transparent'],
  ['icon-maskable-512.png', 512, 0.72, BG], // maskable: keep the circle inside the 80% safe zone
  ['apple-touch-icon.png', 180, 0.86, BG],  // iOS fills transparency with black and rounds the corners itself
];

let browser;
for (const channel of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* try the next browser */ }
}
if (!browser) { console.error('No Edge/Chrome found.'); process.exit(1); }
mkdirSync(join(root, 'site/icons'), { recursive: true });
for (const [file, size, share, bg] of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const inner = Math.round(size * share);
  await page.setContent(`<html><body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${bg}">
    <img src="${src}" width="${inner}" height="${inner}"></body></html>`);
  await page.screenshot({ path: join(root, 'site/icons', file), omitBackground: bg === 'transparent' });
  await page.close();
  console.log(`icons: ${file} (${size}px)`);
}
await browser.close();
