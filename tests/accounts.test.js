// Accounts (Round 5): sign-in, sessions, per-user isolation, CSRF, rate limits, consent, sync, export, delete, admin.
// Runs the real Worker against a real SQLite database (the migrations) and fake Google / Microsoft servers.
// Every person, email and id here is made up.
import assert from 'node:assert/strict';
import worker, { SESSION_COOKIE, CONSENT_VERSION, MAX_DOC_BYTES } from '../worker/index.js';
import { verifyIdToken, PROVIDERS, FLOW_COOKIE } from '../worker/oidc.js';
import { makeEnv, makeProviders, makeClient, makeLimiter, ORIGIN, CLIENT, TENANT } from './fake-cloud.js';
import { readFileSync } from 'node:fs';
import { sha256Hex } from '../worker/http.js';

const realFetch = globalThis.fetch;
let P; // fake providers
async function setup(envOverrides) {
  P ??= await makeProviders();
  globalThis.fetch = (u, i) => P.fetch(u, i);
  const env = makeEnv(envOverrides);
  return { env, client: () => makeClient(worker, env) };
}
const done = () => { globalThis.fetch = realFetch; };
const doc = (name = 'Made-up Term') => ({ schema: 1, next_id: 2, settings: {}, audit: [], terms: [{ id: 1, name }], courses: [], components: [], assessments: [], repeats: [] });
async function signedIn(t, sub = 'student-a', { consent = true, provider = 'google' } = {}) {
  const c = t.client();
  await c.signIn(P, provider, provider === 'google' ? P.google(sub) : P.microsoft(sub));
  if (consent) assert.equal((await c.req('/api/consent', { method: 'POST', body: { version: CONSENT_VERSION } })).status, 200);
  return c;
}
const put = (c, base, d = doc()) => c.req('/api/gradebook', { method: 'PUT', body: { base_version: base, doc: d } });
const T = (name, fn) => [name, async () => { try { await fn(); } finally { done(); } }];
const OID = (n) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`;

export const tests = [
  T('signed out: /api/me says so (200), data routes 401, unknown routes 404', async () => {
    const t = await setup();
    const c = t.client();
    const me = await c.req('/api/me');
    assert.equal(me.status, 200);
    assert.deepEqual((await me.json()).signedIn, false);
    for (const [p, m] of [['/api/gradebook', 'GET'], ['/api/gradebook', 'PUT'], ['/api/account/export', 'GET'], ['/api/account/delete', 'POST'], ['/api/consent', 'POST'], ['/api/admin', 'GET']]) {
      const r = await c.req(p, { method: m, body: m === 'GET' ? undefined : {} });
      assert.equal(r.status, 401, `${m} ${p}`);
      assert.equal(r.headers.get('Cache-Control'), 'no-store');
    }
    assert.equal((await c.req('/api/nothing')).status, 401);
    assert.equal((await c.req('/auth/nothing')).status, 404);
    assert.equal(await (await c.req('/about.html')).text(), 'asset');
  }),

  T('sign-in: PKCE + state + nonce, __Host- session cookie, only the token hash stored', async () => {
    const t = await setup();
    const c = t.client();
    const start = await c.req('/auth/login/google');
    assert.equal(start.status, 302);
    const loc = new URL(start.headers.get('Location'));
    assert.equal(loc.origin + loc.pathname, PROVIDERS.google.authorize);
    assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(loc.searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback/google`);
    for (const k of ['state', 'nonce', 'code_challenge']) assert.ok((loc.searchParams.get(k) || '').length >= 43, k);
    const flowCookie = start.headers.getSetCookie().find((x) => x.startsWith(`${FLOW_COOKIE}=`));
    assert.match(flowCookie, /; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=600$/);

    P.as(P.google('student-a'));
    const { code, state } = P.authorize(loc.href);
    const back = await c.req(`/auth/callback/google?code=${code}&state=${state}`);
    assert.equal(back.status, 302);
    assert.equal(back.headers.get('Location'), '/?signin=ok');
    const set = back.headers.getSetCookie();
    const sess = set.find((x) => x.startsWith(`${SESSION_COOKIE}=`));
    assert.match(sess, /^__Host-gc-session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    assert.ok(set.some((x) => x.startsWith(`${FLOW_COOKIE}=;`)), 'flow cookie cleared');
    const verifier = P.tokenRequests.at(-1).code_verifier;
    assert.ok(verifier.length >= 43 && P.tokenRequests.at(-1).client_secret === 'g-secret');

    const token = c.jar.get(SESSION_COOKIE);
    const rows = t.env.gradecalc.raw.prepare('SELECT * FROM sessions').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, await sha256Hex(token));
    assert.ok(!JSON.stringify(rows).includes(token), 'raw token never stored');
    assert.ok(rows[0].expires_at - rows[0].created_at === 30 * 86400);
    const me = await (await c.req('/api/me')).json();
    assert.equal(me.signedIn, true);
    assert.equal(me.account.email, 'student-a@example.test');
    assert.equal(me.account.consent_version, null);
    assert.equal(me.admin, false);
  }),

  T('OIDC rejects: wrong state, no flow cookie, replayed code, wrong nonce / aud / iss / expired / future iat / other key / alg none', async () => {
    const t = await setup();
    const now = Math.floor(Date.now() / 1000);
    const bad = async (claims, opts, label) => {
      const c = t.client();
      const loc = await c.signIn(P, 'google', claims, opts);
      assert.equal(loc, '/?signin=failed', label);
      assert.equal(c.jar.has(SESSION_COOKIE), false, label);
    };
    const g = () => P.google('student-x');
    await bad(g(), { state: 'not-the-state-0000000000000000000000000000000' }, 'state');
    await bad(g(), { nonce: 'another-nonce' }, 'nonce');
    await bad({ ...g(), aud: 'someone-elses-client' }, {}, 'aud');
    await bad({ ...g(), iss: 'https://evil.example.test' }, {}, 'iss');
    await bad({ ...g(), exp: now - 3600 }, {}, 'expired');
    await bad({ ...g(), iat: now + 3600 }, {}, 'iat in the future');
    await bad(g(), { sign: { key: P.other.privateKey } }, 'signed by another key');
    await bad(g(), { sign: { kid: 'unknown-kid' } }, 'unknown kid');
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    await bad(g(), { token: `${enc({ alg: 'none', kid: 'k1' })}.${enc(g())}.` }, 'alg none');
    await bad(g(), { token: 'not.a.jwt' }, 'garbage');
    // Callback with no flow cookie (e.g. a link sent by someone else) and a replayed code.
    const c = t.client();
    P.as(P.google('student-y'));
    const loc = (await c.req('/auth/login/google')).headers.get('Location');
    const { code, state } = P.authorize(loc);
    const stranger = t.client();
    assert.equal((await stranger.req(`/auth/callback/google?code=${code}&state=${state}`)).headers.get('Location'), '/?signin=failed');
    assert.equal(t.env.gradecalc.raw.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  }),

  T('Microsoft: issuer must match the token\'s tenant; identity = tid:oid; admin-approval error → "approval"', async () => {
    const t = await setup();
    const c = t.client();
    assert.equal(await c.signIn(P, 'microsoft', P.microsoft(OID(1))), '/?signin=ok');
    const u = t.env.gradecalc.raw.prepare('SELECT provider, subject, email FROM users').get();
    assert.deepEqual({ ...u }, { provider: 'microsoft', subject: `${TENANT}:${OID(1)}`, email: 'student@school.example.test' });
    const other = '99999999-2222-4333-8444-555555555555';
    assert.equal(await t.client().signIn(P, 'microsoft', { ...P.microsoft(OID(2)), tid: other }), '/?signin=failed', 'iss of another tenant');
    assert.equal(await t.client().signIn(P, 'microsoft', { ...P.microsoft(OID(2)), tid: 'not-a-guid', iss: 'https://login.microsoftonline.com/not-a-guid/v2.0' }), '/?signin=failed');
    const r = await t.client().req('/auth/callback/microsoft?error=consent_required&error_description=AADSTS65001%3A+The+user+or+administrator+has+not+consented');
    assert.equal(r.headers.get('Location'), '/?signin=approval');
    const r2 = await t.client().req('/auth/callback/microsoft?error=access_denied&error_description=AADSTS90094%3A+Admin+approval+required');
    assert.equal(r2.headers.get('Location'), '/?signin=approval');
    const r3 = await t.client().req('/auth/callback/google?error=access_denied');
    assert.equal(r3.headers.get('Location'), '/?signin=cancelled');
  }),

  T('no account linking by email: the same email on Google and Microsoft = two separate accounts', async () => {
    const t = await setup();
    const a = t.client();
    await a.signIn(P, 'google', P.google('student-a', 'same@example.test'));
    const b = t.client();
    await b.signIn(P, 'microsoft', { ...P.microsoft(OID(3)), email: 'same@example.test' });
    const users = t.env.gradecalc.raw.prepare('SELECT id, provider FROM users ORDER BY id').all();
    assert.equal(users.length, 2);
    assert.notEqual((await (await a.req('/api/me')).json()).uid, (await (await b.req('/api/me')).json()).uid);
  }),

  T('sign-in not configured → "unavailable"; unknown provider → 404; redirect URI comes from config, not the Host', async () => {
    const t = await setup({ MICROSOFT_CLIENT_SECRET: '' });
    const c = t.client();
    assert.equal((await c.req('/auth/login/microsoft')).headers.get('Location'), '/?signin=unavailable');
    assert.equal((await c.req('/auth/login/github')).status, 404);
    assert.deepEqual((await (await c.req('/api/me')).json()).providers, ['google']);
    const r = await worker.fetch(new Request('https://evil.example.test/auth/login/google', { headers: { Host: 'evil.example.test' } }), t.env);
    assert.equal(new URL(r.headers.get('Location')).searchParams.get('redirect_uri'), `${ORIGIN}/auth/callback/google`);
  }),

  T('consent: no cloud write before the current consent version; version + date stored', async () => {
    const t = await setup();
    const c = await signedIn(t, 'student-a', { consent: false });
    const r = await put(c, 0);
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error, 'consent_required');
    assert.equal((await c.req('/api/consent', { method: 'POST', body: { version: CONSENT_VERSION + 1 } })).status, 400);
    assert.equal((await c.req('/api/consent', { method: 'POST', body: { version: CONSENT_VERSION } })).status, 200);
    const me = await (await c.req('/api/me')).json();
    assert.equal(me.account.consent_version, CONSENT_VERSION);
    assert.match(me.account.consent_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((await put(c, 0)).status, 200);
  }),

  T('sync: versions, 409 on a stale base_version (with the current version), first save only once', async () => {
    const t = await setup();
    const c = await signedIn(t);
    assert.deepEqual(await (await c.req('/api/gradebook')).json(), { version: 0, updated_at: null, doc: null });
    assert.equal((await (await put(c, 0, doc('One'))).json()).version, 1);
    const again = await put(c, 0, doc('Clobber'));
    assert.equal(again.status, 409);
    assert.equal((await again.json()).version, 1);
    assert.equal((await (await put(c, 1, doc('Two'))).json()).version, 2);
    const stale = await put(c, 1, doc('Stale'));
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).version, 2);
    const g = await (await c.req('/api/gradebook')).json();
    assert.equal(g.version, 2);
    assert.equal(g.doc.terms[0].name, 'Two');
    assert.equal((await (await c.req('/api/me')).json()).gradebook.version, 2);
  }),

  T('isolation: user B can never read, write, export or delete user A\'s gradebook', async () => {
    const t = await setup();
    const a = await signedIn(t, 'student-a');
    await put(a, 0, doc('A-only term'));
    const b = await signedIn(t, 'student-b');
    const bg = await (await b.req('/api/gradebook')).json();
    assert.equal(bg.version, 0);
    assert.equal(bg.doc, null);
    // B saving with A's version number only creates/updates B's own row.
    assert.equal((await put(b, 1, doc('B'))).status, 409);
    assert.equal((await put(b, 0, doc('B term'))).status, 200);
    // Ids in the body / query / headers are ignored: the user comes from the cookie only.
    const aUid = (await (await a.req('/api/me')).json()).uid;
    await b.req(`/api/gradebook?user_id=${aUid}`, { method: 'PUT', body: { base_version: 1, user_id: aUid, doc: doc('B again') }, headers: { 'X-User-Id': String(aUid) } });
    assert.equal((await (await a.req('/api/gradebook')).json()).doc.terms[0].name, 'A-only term');
    const exp = await (await b.req('/api/account/export')).text();
    assert.ok(!exp.includes('A-only term') && !exp.includes('student-a'));
    assert.equal((await b.req('/api/account/delete', { method: 'POST', body: { confirm: 'delete' } })).status, 200);
    assert.equal((await (await a.req('/api/gradebook')).json()).doc.terms[0].name, 'A-only term');
    assert.equal((await a.req('/api/me').then((r) => r.json())).signedIn, true);
    // A's cookie value in B's jar doesn't help B unless it's A's actual token (no guessing a short id).
    const c = t.client();
    c.jar.set(SESSION_COOKIE, String(aUid));
    assert.equal((await c.req('/api/gradebook')).status, 401);
  }),

  T('sessions: tampered, expired and signed-out cookies → 401; sign-out deletes the row', async () => {
    const t = await setup();
    const a = await signedIn(t);
    const tok = a.jar.get(SESSION_COOKIE);
    const tampered = t.client();
    tampered.jar.set(SESSION_COOKIE, (tok[0] === 'A' ? 'B' : 'A') + tok.slice(1));
    assert.equal((await tampered.req('/api/gradebook')).status, 401);
    tampered.jar.set(SESSION_COOKIE, tok.slice(0, -1));
    assert.equal((await tampered.req('/api/gradebook')).status, 401);
    // Expired (server-side check, whatever the browser does with Max-Age).
    t.env.gradecalc.raw.prepare('UPDATE sessions SET expires_at = ?').run(Math.floor(Date.now() / 1000) - 1);
    assert.equal((await a.req('/api/gradebook')).status, 401);
    assert.equal(t.env.gradecalc.raw.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0, 'expired row removed');
    // Sign out.
    const b = await signedIn(t, 'student-b');
    const old = b.jar.get(SESSION_COOKIE);
    const out = await b.req('/auth/logout', { method: 'POST' });
    assert.equal(out.status, 200);
    assert.ok(out.headers.getSetCookie().some((x) => x.startsWith(`${SESSION_COOKIE}=;`) && x.includes('Max-Age=0')));
    const replay = t.client();
    replay.jar.set(SESSION_COOKIE, old);
    assert.equal((await replay.req('/api/gradebook')).status, 401);
    assert.equal(t.env.gradecalc.raw.prepare('SELECT COUNT(*) n FROM sessions').get().n, 0);
  }),

  T('CSRF: writes need the session\'s token, our Origin and same-origin fetch; GET never changes anything', async () => {
    const t = await setup();
    const a = await signedIn(t);
    await put(a, 0);
    const tries = [
      { 'X-CSRF-Token': 'wrong' },
      { 'X-CSRF-Token': '' },
      { Origin: 'https://evil.example.test' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
    ];
    for (const h of tries) {
      const r = await a.req('/api/gradebook', { method: 'PUT', body: { base_version: 1, doc: doc('csrf') }, headers: h });
      assert.equal(r.status, 403, JSON.stringify(h));
      assert.equal((await a.req('/api/account/delete', { method: 'POST', body: { confirm: 'delete' }, headers: h })).status, 403);
      assert.equal((await a.req('/auth/logout', { method: 'POST', headers: h })).status, 403);
    }
    // No Origin at all (non-browser or a stripped header) is refused too.
    const noOrigin = await worker.fetch(new Request(`${ORIGIN}/api/gradebook`, { method: 'PUT',
      headers: { Cookie: `${SESSION_COOKIE}=${a.jar.get(SESSION_COOKIE)}`, 'X-CSRF-Token': a.csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_version: 1, doc: doc('x') }) }), t.env);
    assert.equal(noOrigin.status, 403);
    // A form-style body is refused even with the right token.
    const form = await a.req('/api/gradebook', { method: 'PUT', body: 'base_version=1', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(form.status, 415);
    // GET with write-looking query strings changes nothing.
    await a.req('/api/account/delete?confirm=delete');
    await a.req('/auth/logout');
    assert.equal((await (await a.req('/api/gradebook')).json()).version, 1);
    assert.equal((await (await a.req('/api/me')).json()).signedIn, true);
    assert.equal((await (await a.req('/api/gradebook')).json()).doc.terms[0].name, 'Made-up Term');
  }),

  T('input: body size cap (413), JSON only (415), shape checks (400)', async () => {
    const t = await setup();
    const a = await signedIn(t);
    const big = { ...doc(), audit: [{ note: 'x'.repeat(MAX_DOC_BYTES) }] };
    assert.equal((await put(a, 0, big)).status, 413);
    assert.equal((await a.req('/api/gradebook', { method: 'PUT', body: '{"base_version":0,', headers: {} })).status, 400);
    for (const d of [null, [], { schema: 2 }, { schema: 1, terms: {} }, { schema: 1, settings: [] }, { schema: 1, audit: 'x' }]) {
      assert.equal((await put(a, 0, d)).status, 400, JSON.stringify(d));
    }
    for (const base of [-1, 1.5, '0', null]) assert.equal((await put(a, base)).status, 400);
    assert.equal((await a.req('/api/consent', { method: 'POST', body: { version: CONSENT_VERSION, pad: 'x'.repeat(5000) } })).status, 413);
    assert.equal(t.env.gradecalc.raw.prepare('SELECT COUNT(*) n FROM gradebooks').get().n, 0);
  }),

  T('rate limits: sign-in per IP, API per IP, writes per user → 429; a missing limiter fails closed', async () => {
    let t = await setup({ RL_AUTH: makeLimiter(2) });
    const c = t.client();
    assert.equal((await c.req('/auth/login/google')).status, 302);
    assert.equal((await c.req('/auth/login/google')).status, 302);
    const r = await c.req('/auth/login/google');
    assert.equal(r.status, 429);
    assert.equal(r.headers.get('Retry-After'), '60');
    t = await setup({ RL_API: makeLimiter(3) });
    const d = t.client();
    for (let i = 0; i < 3; i++) assert.equal((await d.req('/api/me')).status, 200);
    assert.equal((await d.req('/api/me')).status, 429);
    t = await setup({ RL_WRITE: makeLimiter(2) });
    const a = await signedIn(t); // consent = write 1
    assert.equal((await put(a, 0)).status, 200);
    assert.equal((await put(a, 1)).status, 429);
    assert.ok(t.env.RL_WRITE.counts.has(`user:${(await (await a.req('/api/me')).json()).uid}`));
    t = await setup({ RL_API: undefined });
    assert.equal((await t.client().req('/api/me')).status, 429);
  }),

  T('delete account: user, gradebook, consent and every session (other devices too) are gone; old cookies → 401', async () => {
    const t = await setup();
    const phone = await signedIn(t, 'student-a');
    await put(phone, 0);
    const laptop = t.client();
    await laptop.signIn(P, 'google', P.google('student-a'));
    const other = await signedIn(t, 'student-b');
    await put(other, 0);
    assert.equal((await phone.req('/api/account/delete', { method: 'POST', body: {} })).status, 400, 'needs confirm');
    const r = await phone.req('/api/account/delete', { method: 'POST', body: { confirm: 'delete' } });
    assert.equal(r.status, 200);
    assert.ok(r.headers.getSetCookie().some((x) => x.startsWith(`${SESSION_COOKIE}=;`)));
    const db = t.env.gradecalc.raw;
    assert.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE subject = 'student-a'").get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM gradebooks').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM sessions').get().n, 1);
    assert.equal((await laptop.req('/api/gradebook')).status, 401);
    const replay = t.client();
    replay.jar.set(SESSION_COOKIE, phone.jar.get(SESSION_COOKIE) || laptop.jar.get(SESSION_COOKIE));
    assert.equal((await replay.req('/api/gradebook')).status, 401);
    // Signing in again starts a brand-new, empty account that needs consent again.
    await phone.signIn(P, 'google', P.google('student-a'));
    const me = await (await phone.req('/api/me')).json();
    assert.equal(me.account.consent_version, null);
    assert.equal(me.gradebook, null);
  }),

  T('export: the account + gradebook as a download, own data only', async () => {
    const t = await setup();
    const a = await signedIn(t);
    await put(a, 0, doc('Exported term'));
    const r = await a.req('/api/account/export');
    assert.match(r.headers.get('Content-Disposition'), /^attachment; filename="gradecalc-backup-account-\d{4}-\d{2}-\d{2}\.json"$/);
    const body = await r.json();
    assert.equal(body.kind, 'account-export');
    assert.equal(body.account.provider, 'google');
    assert.equal(body.gradebook.terms[0].name, 'Exported term');
    assert.ok(!('subject' in body.account) && !('csrf' in body));
  }),

  T('admin: only a Google sign-in whose subject = ADMIN_SUB; counts + storage only (never grades or emails)', async () => {
    const t = await setup();
    const a = await signedIn(t, 'student-a');
    await put(a, 0, doc('Secret-ish term name'));
    assert.equal((await a.req('/api/admin')).status, 404);
    // A Microsoft account can never be admin, even with a matching-looking subject.
    const ms = await signedIn(t, OID(9), { provider: 'microsoft' });
    assert.equal((await ms.req('/api/admin')).status, 404);
    const admin = await signedIn(t, 'admin-sub-1');
    assert.equal((await (await admin.req('/api/me')).json()).admin, true);
    const r = await admin.req('/api/admin');
    assert.equal(r.status, 200);
    const text = await r.text();
    const s = JSON.parse(text);
    assert.equal(s.users, 3);
    assert.deepEqual(s.providers, { google: 2, microsoft: 1 });
    assert.equal(s.gradebooks, 1);
    assert.ok(s.bytes > 0);
    assert.ok(!text.includes('Secret-ish') && !text.includes('student-a') && !text.includes('school.example.test'));
    // Admin configured empty → nobody is admin.
    t.env.ADMIN_SUB = '';
    assert.equal((await admin.req('/api/admin')).status, 404);
    // Code check: the admin route never selects the doc column, an email or a subject.
    const src = readFileSync(new URL('../worker/index.js', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf("path === '/api/admin'"), src.indexOf('return error(404', src.indexOf("path === '/api/admin'") + 200));
    const sql = [...block.matchAll(/prepare\('([^']+)'\)/g)].map((m) => m[1]).join(' | ');
    assert.ok(sql.includes('FROM users') && !/\bdoc\b|email|subject/.test(sql), sql);
  }),

  T('error responses never echo secrets or tokens', async () => {
    const t = await setup();
    const c = t.client();
    await c.signIn(P, 'google', P.google('student-a'));
    const bodies = [];
    for (const [p, m, b] of [['/api/gradebook', 'PUT', '{bad'], ['/api/consent', 'POST', '{}'], ['/api/x', 'GET']]) {
      bodies.push(await (await c.req(p, { method: m, body: b })).text());
    }
    const all = bodies.join(' ');
    for (const secret of ['g-secret', 'm-secret', t.env.SESSION_SECRET, c.jar.get(SESSION_COOKIE), c.csrf]) assert.ok(!all.includes(secret));
    // A broken database never leaks its message.
    const broken = { ...t.env, gradecalc: { prepare() { throw new Error(`boom ${t.env.SESSION_SECRET}`); }, batch() { throw new Error('boom'); } } };
    const origErr = console.error; console.error = () => {};
    try {
      const r = await worker.fetch(new Request(`${ORIGIN}/api/me`, { headers: { Cookie: `${SESSION_COOKIE}=${c.jar.get(SESSION_COOKIE)}` } }), broken);
      assert.equal(r.status, 500);
      assert.deepEqual(await r.json(), { error: 'server_error' });
    } finally { console.error = origErr; }
  }),

  T('verifyIdToken unit: aud array needs azp; Google issuer without https accepted', async () => {
    await setup();
    const keys = async () => P.jwks.keys;
    const now = Math.floor(Date.now() / 1000);
    const base = { iss: 'accounts.google.com', sub: 's', iat: now, exp: now + 60 };
    assert.ok(await verifyIdToken(await P.sign({ ...base, aud: CLIENT.google }), PROVIDERS.google, CLIENT.google, keys));
    assert.equal(await verifyIdToken(await P.sign({ ...base, aud: [CLIENT.google, 'other'] }), PROVIDERS.google, CLIENT.google, keys), null);
    assert.ok(await verifyIdToken(await P.sign({ ...base, aud: [CLIENT.google, 'other'], azp: CLIENT.google }), PROVIDERS.google, CLIENT.google, keys));
    assert.equal(await verifyIdToken(await P.sign({ ...base, aud: CLIENT.google }), PROVIDERS.google, '', keys), null, 'no client id configured');
  }),

  T('AuthGuard: signing in again in the same browser deletes that browser\'s previous session (same or other account)', async () => {
    const t = await setup();
    const c = await signedIn(t, 'student-a');
    const first = c.jar.get(SESSION_COOKIE);
    await c.signIn(P, 'google', P.google('student-b'));
    const second = c.jar.get(SESSION_COOKIE);
    assert.notEqual(first, second);
    const rows = t.env.gradecalc.raw.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash);
    assert.deepEqual(rows, [await sha256Hex(second)], 'only the new session is left');
    const replay = t.client();
    replay.jar.set(SESSION_COOKIE, first);
    assert.equal((await replay.req('/api/gradebook')).status, 401, 'the replaced cookie no longer works');
    // Another browser's session for the same account is untouched.
    const laptop = await signedIn(t, 'student-b', { consent: false });
    await c.signIn(P, 'google', P.google('student-b'));
    assert.equal((await laptop.req('/api/gradebook')).status, 200);
  }),

  T('AuthGuard: /api/* is rate limited per user too (many IPs, one account → 429)', async () => {
    const t = await setup({ RL_API: makeLimiter(4) });
    const a = await signedIn(t, 'student-a', { consent: false }); // /api/me once in signIn
    let n = 0;
    const from = (ip) => worker.fetch(new Request(`${ORIGIN}/api/gradebook`, { headers: { Cookie: `${SESSION_COOKIE}=${a.jar.get(SESSION_COOKIE)}`, 'CF-Connecting-IP': ip } }), t.env);
    for (let i = 0; i < 3; i++) assert.equal((await from(`198.51.100.${++n}`)).status, 200);
    const r = await from(`198.51.100.${++n}`);
    assert.equal(r.status, 429);
    assert.ok(t.env.RL_API.counts.get(`user:${(await t.env.gradecalc.raw.prepare('SELECT id FROM users').get()).id}`) >= 5);
  }),

  T('AuthGuard: API answers carry a no-content CSP (a JSON answer opened as a page runs nothing) and HSTS', async () => {
    const t = await setup();
    const a = await signedIn(t);
    await put(a, 0);
    for (const p of ['/api/me', '/api/gradebook', '/api/account/export', '/api/nothing']) {
      const r = await a.req(p);
      const csp = r.headers.get('Content-Security-Policy') || '';
      assert.match(csp, /default-src 'none'/, p);
      assert.match(csp, /frame-ancestors 'none'/, p);
      assert.match(r.headers.get('Strict-Transport-Security') || '', /max-age=31536000/, p);
    }
    assert.match((await t.client().req('/auth/login/google')).headers.get('Strict-Transport-Security') || '', /max-age=31536000/, 'redirect');
  }),

  T('AuthGuard: verifyIdToken refuses nbf in the future and keys published for encryption or another alg', async () => {
    await setup();
    const now = Math.floor(Date.now() / 1000);
    const base = { iss: 'https://accounts.google.com', aud: CLIENT.google, sub: 's', iat: now, exp: now + 600 };
    const v = (claims, keys = P.jwks.keys) => verifyIdToken(claims, PROVIDERS.google, CLIENT.google, async () => keys);
    assert.ok(await v(await P.sign({ ...base, nbf: now })));
    assert.equal(await v(await P.sign({ ...base, nbf: now + 3600 })), null, 'nbf');
    assert.equal(await v(await P.sign({ ...base, nbf: 'soon' })), null, 'nbf type');
    const k = P.jwks.keys[0];
    assert.equal(await v(await P.sign(base), [{ ...k, use: 'enc' }]), null, 'use enc');
    assert.equal(await v(await P.sign(base), [{ ...k, alg: 'RS512' }]), null, 'jwk alg');
    assert.ok(await v(await P.sign(base), [{ ...k, alg: 'RS256' }]));
  }),

  T('sessions per user are capped (oldest go)', async () => {
    const t = await setup();
    for (let i = 0; i < 12; i++) await t.client().signIn(P, 'google', P.google('student-a'));
    assert.equal(t.env.gradecalc.raw.prepare('SELECT COUNT(*) n FROM sessions').get().n, 10);
  }),
];
