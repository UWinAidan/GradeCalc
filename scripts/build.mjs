// Copies shared/calc.js into ./site before `wrangler dev` / `wrangler deploy` (wrangler.jsonc "build") and before
// ui-check, so the page and the tests run the very same math. The copy is generated (gitignored): edit the original.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const copies = [['shared/calc.js', 'site/js/calc.js']];
export function build() {
  for (const [from, to] of copies) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    copyFileSync(join(root, from), join(root, to));
  }
  return copies.map((c) => c[1]);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(`build: copied ${build().join(', ')}`);
