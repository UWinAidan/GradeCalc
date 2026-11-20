// Test doubles for the Worker: a D1 database on node:sqlite (the real migrations run on it), rate limiters, and a fake
// Google / Microsoft (RSA keys, JWKS, token endpoint) served through a replaced globalThis.fetch. Made-up data only.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { b64url } from '../worker/http.js';
import { _clearKeyCache } from '../worker/oidc.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- D1
class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...params) { return new Stmt(this.db, this.sql, params); }
  _s() { return this.db.prepare(this.sql); }
  async first(col) { const r = this._s().get(...this.params); return r === undefined ? null : col ? r[col] : { ...r }; }
  async all() { return { results: this._s().all(...this.params).map((r) => ({ ...r })), meta: {} }; }
  async run() {
    const s = this._s();
    if (s.columns().length) { const results = s.all(...this.params).map((r) => ({ ...r })); return { results, meta: { changes: results.length } }; }
    const r = s.run(...this.params);
    return { results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}
export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(path.join(ROOT, 'migrations')).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(path.join(ROOT, 'migrations', f), 'utf8'));
  }
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

// ---------------------------------------------------------------- rate limiter
export function makeLimiter(limit = 1e9) {
  const counts = new Map();
  return { counts, async limit({ key }) { const n = (counts.get(key) || 0) + 1; counts.set(key, n); return { success: n <= limit }; } };
}

// ---------------------------------------------------------------- fake identity providers
export const ORIGIN = 'https://gradecalc.example.test';
export const CLIENT = { google: 'google-client-id-test', microsoft: '00000000-0000-4000-8000-000000000001' };
export const TENANT = '11111111-2222-4333-8444-555555555555';

export async function makeProviders() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const jwks = { keys: [{ kty: 'RSA', kid: 'k1', use: 'sig', n: pub.n, e: pub.e }] };
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  async function sign(claims, { kid = 'k1', alg = 'RS256', key = pair.privateKey } = {}) {
    const head = enc({ alg, kid, typ: 'JWT' });
    const body = enc(claims);
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`)));
    return `${head}.${body}.${b64url(sig)}`;
  }
  const codes = new Map(); // code → { provider, claims (nonce filled in at /authorize), challenge, override }
  const tokenRequests = [];
  /** Who the next sign-in is: claims for the id_token (nonce comes from the authorize URL). */
  let next = null;
  const now = () => Math.floor(Date.now() / 1000);
  const p = {
    jwks, sign, other, codes, tokenRequests,
    as(claims, opts = {}) { next = { claims, opts }; },
    google(sub, email = `${sub}@example.test`) {
      return { iss: 'https://accounts.google.com', aud: CLIENT.google, sub, email, email_verified: true, iat: now(), exp: now() + 3600 };
    },
    microsoft(oid, tid = TENANT) {
      return { iss: `https://login.microsoftonline.com/${tid}/v2.0`, aud: CLIENT.microsoft, tid, oid, sub: `pairwise-${oid}`,
        preferred_username: `student@school.example.test`, iat: now(), exp: now() + 3600 };
    },
    /** What the provider does at /authorize: returns the code it would send back (and remembers the nonce). */
    authorize(authorizeUrl) {
      const u = new URL(authorizeUrl);
      const code = `code-${Math.random().toString(36).slice(2)}`;
      const provider = u.hostname.includes('google') ? 'google' : 'microsoft';
      codes.set(code, { provider, claims: { ...next.claims, nonce: next.opts.nonce ?? u.searchParams.get('nonce') }, opts: next.opts,
        challenge: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri') });
      return { code, state: u.searchParams.get('state'), redirect: u.searchParams.get('redirect_uri') };
    },
    async fetch(input, init = {}) {
      const url = String(input);
      if (url === 'https://www.googleapis.com/oauth2/v3/certs' || url === 'https://login.microsoftonline.com/common/discovery/v2.0/keys') {
        return new Response(JSON.stringify(jwks), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://oauth2.googleapis.com/token' || url === 'https://login.microsoftonline.com/common/oauth2/v2.0/token') {
        const f = new URLSearchParams(String(init.body));
        tokenRequests.push(Object.fromEntries(f));
        const c = codes.get(f.get('code'));
        if (!c) return new Response('{"error":"invalid_grant"}', { status: 400 });
        codes.delete(f.get('code'));
        // PKCE: the verifier must hash to the challenge sent at /authorize.
        const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(f.get('code_verifier') || '')));
        if (b64url(d) !== c.challenge || f.get('redirect_uri') !== c.redirect) return new Response('{"error":"invalid_grant"}', { status: 400 });
        const id = c.opts.token ?? await sign(c.claims, c.opts.sign || {});
        return new Response(JSON.stringify({ id_token: id, access_token: 'x', token_type: 'Bearer' }), { headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`fake-cloud: unexpected fetch ${url}`);
    },
  };
  return p;
}

/** A complete Worker env (D1 + limiters + config). */
export function makeEnv(overrides = {}) {
  _clearKeyCache();
  return {
    gradecalc: makeD1(),
    ASSETS: { fetch: async () => new Response('asset', { status: 200 }) },
    RL_AUTH: makeLimiter(), RL_API: makeLimiter(), RL_WRITE: makeLimiter(),
    // A fresh random key per test env (no fixed secret-looking value in the repo: LeakGuard flags those).
    PUBLIC_ORIGIN: ORIGIN, SESSION_SECRET: b64url(crypto.getRandomValues(new Uint8Array(32))),
    GOOGLE_CLIENT_ID: CLIENT.google, GOOGLE_CLIENT_SECRET: 'g-secret', MICROSOFT_CLIENT_ID: CLIENT.microsoft, MICROSOFT_CLIENT_SECRET: 'm-secret',
    ADMIN_SUB: 'admin-sub-1', ADMIN_EMAIL: 'admin@example.test',
    ...overrides,
  };
}

/** A tiny browser: keeps cookies (by name) between requests to the Worker, sends same-origin headers on writes. */
export function makeClient(worker, env) {
  const jar = new Map();
  const c = {
    jar, csrf: null,
    async req(pathname, { method = 'GET', body, headers = {}, raw = false } = {}) {
      const h = new Headers(headers);
      if (jar.size) h.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
      if (method !== 'GET' && !raw) {
        if (!h.has('Origin')) h.set('Origin', ORIGIN);
        if (!h.has('Sec-Fetch-Site')) h.set('Sec-Fetch-Site', 'same-origin');
        if (c.csrf && !h.has('X-CSRF-Token')) h.set('X-CSRF-Token', c.csrf);
        if (body !== undefined && !h.has('Content-Type')) h.set('Content-Type', 'application/json');
      }
      const res = await worker.fetch(new Request(ORIGIN + pathname, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env);
      for (const line of res.headers.getSetCookie()) {
        const [pair, ...attrs] = line.split(';');
        const i = pair.indexOf('=');
        const name = pair.slice(0, i), value = pair.slice(i + 1);
        if (attrs.some((a) => /max-age=0$/i.test(a.trim()))) jar.delete(name); else jar.set(name, value);
      }
      return res;
    },
    /** Full sign-in through the fake provider. Returns the final redirect's Location. */
    async signIn(providers, provider, claims, opts = {}) {
      providers.as(claims, opts);
      const start = await c.req(`/auth/login/${provider}`);
      const loc = start.headers.get('Location');
      if (start.status !== 302 || !/^https:\/\//.test(loc) || loc.startsWith(ORIGIN)) return loc;
      const { code, state } = providers.authorize(loc);
      const back = await c.req(`/auth/callback/${provider}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(opts.state ?? state)}`);
      const me = await (await c.req('/api/me')).json();
      c.csrf = me.csrf || null;
      return back.headers.get('Location');
    },
  };
  return c;
}
