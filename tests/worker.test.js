// Worker basics: /api/* and /auth/* never fall through to the static site; everything else is the static site.
// (Accounts, sessions and isolation: accounts.test.js.)
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { makeEnv } from './fake-cloud.js';

const env = makeEnv();
const get = (p) => worker.fetch(new Request('https://gradecalc.example.test' + p), env);

export const tests = [
  ['unknown /api route without a session → 401 JSON, no-store', async () => {
    const r = await get('/api/anything');
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await r.json(), { error: 'signed_out' });
  }],
  ['unknown /auth route → 404 JSON', async () => assert.equal((await get('/auth/x')).status, 404)],
  ['other paths → static assets', async () => assert.equal(await (await get('/about.html')).text(), 'asset')],
];
