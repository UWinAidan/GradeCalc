/* Unit + Worker tests (no dependencies): `node tests/run-tests.js`. Each *.test.js file exports test cases. */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.test.js')).sort()) {
  const mod = await import(pathToFileURL(path.join(dir, f)).href);
  for (const [name, fn] of mod.tests) {
    try { await fn(); pass++; } catch (e) { fail++; console.log(`FAIL ${f} › ${name}\n     ${e.message}`); }
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
