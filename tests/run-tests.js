/* Unit + Worker tests (no dependencies): `node tests/run-tests.js [filter]`. Runs every tests/*.test.js file.
 * A file registers cases with the global test(name, fn) or exports `tests = [[name, fn], ...]`. Made-up data only. */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2];
const cases = [];
let current = '';
globalThis.test = (name, fn) => cases.push({ file: current, name, fn });

for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort()) {
  current = f;
  const mod = await import(pathToFileURL(path.join(dir, f)).href);
  for (const [name, fn] of mod.tests || []) cases.push({ file: f, name, fn });
}

let pass = 0, fail = 0;
for (const t of cases) {
  const label = `${t.file.replace('.test.js', '')} › ${t.name}`;
  if (filter && !label.includes(filter)) continue;
  try { await t.fn(); pass++; } catch (e) {
    fail++;
    console.log(`FAIL ${label}\n     ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n     ') : e}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
