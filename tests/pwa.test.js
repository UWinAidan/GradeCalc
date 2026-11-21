// Round 6: the PWA (manifest + service worker) and the How to use page's worked example.
// The service worker may cache only this site's own files: every page, script, style and icon, and nothing else.
// The worked example's numbers must be what shared/calc.js computes for the demo course, so the guide can't drift.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert } from './helpers.js';
import { computeAll, needFor, courseResult } from '../shared/calc.js';
import { demoDoc } from '../site/js/demo.js';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
const sw = readFileSync(path.join(SITE, 'sw.js'), 'utf8');
const precache = JSON.parse(`[${/const PRECACHE = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '')}]`);

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else out.push('/' + path.relative(SITE, p).split(path.sep).join('/'));
  }
  return out;
}
// What the site serves: pages by their clean URL (Cloudflare serves /help from help.html), everything else as is.
const NOT_CACHED = new Set(['/_headers', '/robots.txt', '/sw.js']);
const served = walk(SITE)
  .filter((f) => !NOT_CACHED.has(f) && !/\/(LICENSE|README\.md)$/.test(f))
  .map((f) => (f === '/index.html' ? '/' : f.endsWith('.html') ? f.slice(0, -5) : f));

test('service worker: precaches every page, script, style and icon of the site', () => {
  const missing = served.filter((f) => !precache.includes(f));
  assert.deepEqual(missing, [], `add to PRECACHE in site/sw.js: ${missing.join(', ')}`);
});

test('service worker: precaches nothing that is not a file of this site (never /api, /auth or other origins)', () => {
  const extra = precache.filter((f) => !served.includes(f));
  assert.deepEqual(extra, [], `not a site file: ${extra.join(', ')}`);
  for (const f of precache) {
    assert.ok(f.startsWith('/') && !f.startsWith('//'), `${f} is same-origin`);
    assert.ok(!/^\/(api|auth)(\/|$)/.test(f), `${f} must not be cached`);
  }
  assert.equal(new Set(precache).size, precache.length, 'no duplicates');
});

test('service worker: only GETs for listed paths are answered; network first, cache when offline', () => {
  assert.match(sw, /if \(req\.method !== 'GET'\) return;/);
  assert.match(sw, /url\.origin !== self\.location\.origin \|\| !OURS\.has\(url\.pathname\)\) return;/);
  assert.ok(sw.indexOf('await fetch(req)') < sw.indexOf('caches.match('), 'network before cache');
  assert.match(sw, /res\.status === 200 && res\.type === 'basic' && !res\.redirected/, 'only plain complete answers are stored');
  assert.ok(!/localStorage|indexedDB|gradebook/i.test(sw.replace(/\/\*[\s\S]*?\*\//, '')), 'the worker never reads grades');
});

// ---------------------------------------------------------------- the worker itself, run in a fake service worker scope
const ORIGIN = 'https://gradecalc.example';
function fakeWorker({ online = true, putFails = false, answer } = {}) {
  const store = new Map(); // cache name -> Map(path -> Response)
  const net = [];
  const handlers = {};
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      const key = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname + (typeof r === 'string' ? '' : new URL(r.url).search);
      return {
        async put(r, res) { if (putFails) throw new Error('QuotaExceededError'); m.set(key(r), res); },
        async match(r) { return m.get(key(r)); },
        async addAll(reqs) { for (const r of reqs) m.set(key(r), new Response(`cached ${key(r)}`)); },
        async keys() { return [...m.keys()].map((p) => new Request(ORIGIN + p)); },
        async delete(r) { return m.delete(key(r)); },
      };
    },
    async keys() { return [...store.keys()]; },
    async delete(n) { return store.delete(n); },
    async match(r, { cacheName }) { return (await caches.open(cacheName)).match(r); },
  };
  const self = {
    location: new URL(ORIGIN + '/sw.js'),
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {}, clients: { claim: async () => {} },
  };
  const fetch = async (req) => {
    net.push(`${req.method} ${req.url}`);
    if (!online) throw new TypeError('Failed to fetch');
    const res = answer ? answer(req) : new Response(`fresh ${new URL(req.url).pathname}`, { status: 200 });
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  const SwRequest = class extends Request { constructor(u, i) { super(new URL(u, ORIGIN), i); } }; // relative to the site
  new Function('self', 'caches', 'fetch', 'Request', sw)(self, caches, fetch, SwRequest);
  /** Dispatches a fetch event; returns the worker's answer, or 'network' if it left the request alone. */
  async function request(url, init = {}) {
    let answered = null; const waits = [];
    handlers.fetch({ request: new Request(url, init), respondWith: (p) => { answered = p; }, waitUntil: (p) => waits.push(p) });
    if (!answered) return 'network';
    const res = await answered;
    await Promise.all(waits);
    return res;
  }
  const lifecycle = async (type) => { const w = []; handlers[type]({ waitUntil: (p) => w.push(p) }); await Promise.all(w); };
  return { request, lifecycle, store, net, setOnline: (v) => { online = v; } };
}

test('service worker (run): /api, /auth, sign-in callbacks, other origins and non-GET are never answered or stored', async () => {
  const w = fakeWorker();
  await w.lifecycle('install');
  await w.lifecycle('activate');
  for (const u of ['/api/gradebook', '/api/account/export', '/api/me', '/auth/login/google', '/auth/callback/google?code=c&state=s',
    '/auth/callback/microsoft?code=c&state=s', '/auth/logout', '/admin', '/sw.js', '/js/unknown.js']) {
    assert.equal(await w.request(ORIGIN + u), 'network', u);
  }
  assert.equal(await w.request('https://accounts.google.com/o/oauth2/v2/auth'), 'network', 'other origin');
  assert.equal(await w.request(ORIGIN + '/', { method: 'POST', body: 'x' }), 'network', 'POST');
  assert.equal(await w.request(ORIGIN + '/', { method: 'HEAD' }), 'network', 'HEAD');
  const keys = [...w.store.get('gradecalc-v1').keys()];
  assert.ok(keys.every((k) => !/^\/(api|auth)\b|\?/.test(k)), `cache keys: ${keys.join(', ')}`);
});

test('service worker (run): network first; /?signin=ok is stored as plain /; offline gives the last copy', async () => {
  const w = fakeWorker();
  await w.lifecycle('install');
  const res = await w.request(ORIGIN + '/?signin=ok');
  assert.equal(await res.text(), 'fresh /');
  assert.ok(w.net.includes(`GET ${ORIGIN}/?signin=ok`), 'went to the network first');
  const keys = [...w.store.get('gradecalc-v1').keys()];
  assert.ok(!keys.some((k) => k.includes('?')), 'no query (sign-in result) in any cache key');
  w.setOnline(false);
  assert.equal(await (await w.request(ORIGIN + '/js/app.js')).text(), 'cached /js/app.js');
  assert.equal(await (await w.request(ORIGIN + '/?signin=ok')).text(), 'fresh /', 'offline: the last plain copy of /');
});

test('service worker (run): errors, partial and redirected answers are passed through, never stored', async () => {
  for (const [status, redirected] of [[404, false], [500, false], [206, false], [200, true]]) {
    const w = fakeWorker({ answer: () => {
      const r = new Response(status === 206 ? 'part' : 'bad', { status });
      if (redirected) Object.defineProperty(r, 'redirected', { value: true });
      return r;
    } });
    await w.lifecycle('install');
    const res = await w.request(ORIGIN + '/help');
    assert.equal(res.status, status);
    assert.equal(await (await w.store.get('gradecalc-v1').get('/help')).text(), 'cached /help', `${status} not stored`);
  }
});

test('service worker (run): a failing cache write (storage full) still returns the fresh answer, not the old copy', async () => {
  const w = fakeWorker({ putFails: true });
  await w.lifecycle('install');
  assert.equal(await (await w.request(ORIGIN + '/js/app.js')).text(), 'fresh /js/app.js');
});

test('service worker (run): activate drops old caches and anything no longer listed', async () => {
  const w = fakeWorker();
  w.store.set('gradecalc-v0', new Map([['/js/app.js', new Response('old')]]));
  await w.lifecycle('install');
  w.store.get('gradecalc-v1').set('/js/removed.js', new Response('old'));
  await w.lifecycle('activate');
  assert.deepEqual([...w.store.keys()], ['gradecalc-v1']);
  assert.ok(!w.store.get('gradecalc-v1').has('/js/removed.js'));
});

test('manifest: valid, same-origin, icons exist', () => {
  const m = JSON.parse(readFileSync(path.join(SITE, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.display, 'standalone');
  assert.ok(m.name && m.short_name);
  for (const i of m.icons) {
    assert.ok(i.src.startsWith('/') && existsSync(path.join(SITE, i.src)), `icon ${i.src}`);
  }
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'), '192 + 512 icons');
  assert.ok(m.icons.some((i) => i.purpose === 'maskable'), 'a maskable icon');
});

test('every page links the manifest and registers the service worker', () => {
  for (const f of ['index.html', 'help.html', 'about.html', 'privacy.html']) {
    const html = readFileSync(path.join(SITE, f), 'utf8');
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/, f);
  }
  assert.match(readFileSync(path.join(SITE, 'js/app.js'), 'utf8'), /import '\.\/pwa\.js';/);
  assert.match(readFileSync(path.join(SITE, 'js/site.js'), 'utf8'), /import '\.\/pwa\.js';/);
  assert.match(readFileSync(path.join(SITE, 'js/pwa.js'), 'utf8'), /register\('\/sw\.js'\)/);
});

test('_headers: CSP allows the manifest and the worker from this site only', () => {
  const h = readFileSync(path.join(SITE, '_headers'), 'utf8');
  assert.match(h, /manifest-src 'self'/);
  assert.match(h, /worker-src 'self'/);
});

// ---------------------------------------------------------------- How to use: worked example = calc.js
test('How to use: worked example numbers come from calc.js (demo DEMO-2300)', () => {
  const html = readFileSync(path.join(SITE, 'help.html'), 'utf8');
  const shown = Object.fromEntries([...html.matchAll(/data-calc="([a-z-]+)">([^<]+)</g)].map((m) => [m[1], m[2]]));
  const doc = demoDoc();
  const all = computeAll(doc);
  const course = doc.courses.find((c) => c.code === 'DEMO-2300');
  const r = all.courses.get(course.id);
  const comps = all.compsByCourse.get(course.id);
  const final = comps.find((k) => k.name === 'Final exam');
  const p = (v, d = 2) => `${(v * 100).toFixed(d)}%`; // the page's pct()
  const needAll = needFor(course, comps, all.itemsByComp, 0.8);
  const needFinal = needFor(course, comps, all.itemsByComp, 0.8, [final.id]);
  assert.equal(shown['so-far'], p(r.result.soFar), 'so far');
  assert.equal(shown.average, p(r.result.average), 'current average');
  assert.equal(shown.letter, r.letter.average, 'letter');
  assert.equal(needAll.status, 'possible');
  assert.equal(shown['need-all'], p(needAll.need, 1), 'need on everything left');
  assert.equal(needFinal.status, 'possible');
  assert.equal(shown['need-final'], p(needFinal.need, 1), 'need on the final');
  // The marks listed in the table are the demo's.
  const marks = (name) => doc.assessments.filter((a) => a.component_id === comps.find((k) => k.name === name).id)
    .map((a) => (a.mark === null ? '—' : String(Math.round(a.mark * 100)))).join(', ');
  assert.ok(html.includes(`${marks('Homework')} (4 items)`), `homework ${marks('Homework')}`);
  assert.ok(html.includes(`${marks('Tests')} (2 tests)`), `tests ${marks('Tests')}`);
});

// The rules the guide explains in words, checked with made-up numbers.
test('How to use: explained rules hold in calc.js (weights, curves, cap, need labels)', () => {
  const run = (course, comps, items) => courseResult(course, comps,
    new Map(comps.map((k) => [k.id, items.filter((a) => a.cid === k.id)])));
  const it = (id, cid, mark, extra = {}) => ({ id, cid, mark, out_of: 1, ...extra });
  // Weights under 100 (40 + 50 = 90), everything at 100%: so far = (40 + 50) / 100 = 90%; average = 90 / 90 = 100%.
  let r = run({}, [{ id: 1, weight: 40 }, { id: 2, weight: 50 }], [it(1, 1, 1), it(2, 2, 1)]);
  assert.ok(Math.abs(r.soFar - 0.9) < 1e-9 && Math.abs(r.average - 1) < 1e-9, 'under 100: so far out of 100, average out of marked');
  // Over 100 (60 + 60), everything at 80%: so far = 120 × 0.8 / 100 = 96%, the extra 20 acts as bonus; average the same.
  r = run({}, [{ id: 1, weight: 60 }, { id: 2, weight: 60 }], [it(1, 1, 0.8), it(2, 2, 0.8)]);
  assert.ok(Math.abs(r.soFar - 0.96) < 1e-9 && Math.abs(r.average - 0.96) < 1e-9, 'over 100: extra is bonus');
  // Course 95% + bonus 5 at 100% = 100%; curve +3 after bonus = 103%; with the cap = 100%.
  const comps = [{ id: 1, weight: 100 }, { id: 2, weight: 5, is_bonus: 1 }];
  const marks = [it(1, 1, 0.95), it(2, 2, 1)];
  assert.ok(Math.abs(run({ curve: { type: 'add', value: 3 } }, comps, marks).soFar - 1.03) < 1e-9, 'curve after bonus');
  assert.equal(run({ curve: { type: 'add', value: 3 }, cap_100: 1 }, comps, marks).soFar, 1, 'cap after curve');
  // Item curve in its own points: 40/50 +2 = 42/50 = 84%; =45 → 45/50 = 90%.
  const one = [{ id: 1, weight: 100 }];
  assert.ok(Math.abs(run({}, one, [{ id: 1, cid: 1, mark: 40, out_of: 50, curve: { type: 'add', value: 2 } }]).soFar - 0.84) < 1e-9);
  assert.ok(Math.abs(run({}, one, [{ id: 1, cid: 1, mark: 45, out_of: 50, curve: { type: 'set', value: 45 } }]).soFar - 0.9) < 1e-9);
  // Everything marked, same drops: so far = average. Drop lowest only on the average (80, 60): so far 70%, average 80%.
  r = run({}, [{ id: 1, weight: 100, drop_average: 1 }], [it(1, 1, 0.8), it(2, 1, 0.6)]);
  assert.ok(Math.abs(r.soFar - 0.7) < 1e-9 && Math.abs(r.average - 0.8) < 1e-9, 'drops differ → so far ≠ average');
  // "What do I need": 1 item marked 50% of weight 50, the other 50 open. Target 60 → (60 − 25) / 50 = 70%;
  // target 20 → already there (25 ≥ 20); target 80 → (80 − 25) / 50 = 110% (over 100%); target 99 → 148% ≤ 150%;
  // target 101 → 152% > 150% → not reachable.
  const nc = [{ id: 1, weight: 50 }, { id: 2, weight: 50 }];
  const nm = new Map([[1, [it(1, 1, 0.5)]], [2, [it(2, 2, null)]]]);
  const nd = (t) => needFor({}, nc, nm, t);
  assert.equal(nd(0.6).status, 'possible'); assert.ok(Math.abs(nd(0.6).need - 0.7) < 1e-6);
  assert.equal(nd(0.2).status, 'guaranteed');
  assert.equal(nd(0.8).status, 'over_100'); assert.ok(Math.abs(nd(0.8).need - 1.1) < 1e-6);
  assert.equal(nd(0.99).status, 'over_100');
  assert.equal(nd(1.01).status, 'impossible');
  const help = readFileSync(path.join(SITE, 'help.html'), 'utf8');
  assert.match(help, /even 150% wouldn't do it/);
});

test('How to use: every FAQ entry has an id, a question and keywords', () => {
  const html = readFileSync(path.join(SITE, 'help.html'), 'utf8');
  const items = [...html.matchAll(/<details class="faq-item" id="(q-[a-z-]+)" data-keywords="([^"]+)">\s*<summary>([^<]+)<\/summary>/g)];
  const all = (html.match(/class="faq-item"/g) || []).length;
  assert.equal(items.length, all, 'every faq-item has id + keywords + summary');
  assert.ok(all >= 20, `${all} questions`);
  assert.equal(new Set(items.map((m) => m[1])).size, items.length, 'unique ids');
});
