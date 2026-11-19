// Worker basics: /api/* and /auth/* never fall through to the static site; everything else is the static site.
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

const env = { ASSETS: { fetch: async () => new Response('asset', { status: 200 }) } };
const get = (p) => worker.fetch(new Request('https://gradecalc.aidanwbrown.com' + p), env);

export const tests = [
  ['unknown /api route → 404 JSON, no-store', async () => {
    const r = await get('/api/anything');
    assert.equal(r.status, 404);
    assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await r.json(), { error: 'not_found' });
  }],
  ['unknown /auth route → 404 JSON', async () => assert.equal((await get('/auth/x')).status, 404)],
  ['other paths → static assets', async () => assert.equal(await (await get('/about.html')).text(), 'asset')],
];
