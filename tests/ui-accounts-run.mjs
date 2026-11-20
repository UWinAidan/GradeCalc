/* Only the accounts part of ui-check (faster while working on sign-in / sync): `node tests/ui-accounts-run.mjs`. */
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { build } from '../scripts/build.mjs';
import { accountEnv, workerHandler, accountChecks } from './ui-accounts.mjs';

build();
const env = accountEnv();
const { server, url } = await serve({ api: workerHandler(env) });
env.PUBLIC_ORIGIN = url.replace('127.0.0.1', 'localhost');
let browser;
for (const channel of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* next */ }
}
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };
try { await accountChecks({ browser, check, env, base: env.PUBLIC_ORIGIN }); } catch (e) { fail++; console.log('FAIL (threw)', e.message); }
await browser.close();
server.close();
console.log(`\nui-accounts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
