// LeakGuard fails closed without its fingerprint source, and --ci (Workers Builds) runs without it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (args, env = {}) => spawnSync(process.execPath, ['scripts/leakguard.mjs', ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });

export const tests = [
  ['missing Gradebook checkout → exit 2 (fails closed)', () => {
    const r = run([], { LEAKGUARD_GRADEBOOK: path.join(ROOT, 'no-such-folder') });
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stdout, /fingerprint source not found/);
  }],
  ['--ci without Gradebook checkout → still runs the other checks and passes on this repo', () => {
    const r = run(['--ci'], { LEAKGUARD_GRADEBOOK: path.join(ROOT, 'no-such-folder') });
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /LeakGuard --ci: .*personal fingerprints skipped/);
  }],
];
