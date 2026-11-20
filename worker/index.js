// GradeCalc Worker. The site is static (served from ./site without running this code); only /api/* and /auth/* reach
// the Worker: sign-in (oidc.js), sessions, and one synced gradebook per user in D1 (binding `gradecalc`).
//
// Every /api/* route: the user comes from the session cookie only and touches only that user's rows; writes need the
// session's CSRF token and a same-origin request; everything is rate limited and bodies are size-capped.
import { json, rawJson, error, redirect, withCookies, readCookie, cookie, clearCookie, readBody, nowSec, isoNow, randomToken, sha256Hex, safeEqual } from './http.js';
import { PROVIDERS, configured, startLogin, finishLogin, clearFlow } from './oidc.js';

export { json };

export const SESSION_COOKIE = '__Host-gc-session';
export const SESSION_DAYS = 30;
export const MAX_SESSIONS_PER_USER = 10;
/** Bump when the consent text on the page changes (site/js/sync.js CONSENT_VERSION must match). */
export const CONSENT_VERSION = 1;
export const MAX_DOC_BYTES = 1_500_000; // D1 rows hold up to 2 MB
const MAX_SMALL_BODY = 4096;
const ENTITIES = ['terms', 'courses', 'components', 'assessments', 'repeats'];

// ---------------------------------------------------------------- rate limits (Workers Rate Limiting bindings)
/** True when allowed. A missing binding fails closed. */
async function allowed(env, binding, key) {
  const rl = env[binding];
  if (!rl || typeof rl.limit !== 'function') return false;
  try { return (await rl.limit({ key })).success === true; } catch { return false; }
}
const ipOf = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';
const tooMany = () => error(429, 'rate_limited', { 'Retry-After': '60' });

// ---------------------------------------------------------------- sessions
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** A new session for `userId`. The session this browser had before (any account) is deleted, not just replaced. */
async function newSession(env, userId, oldToken) {
  const token = randomToken(32);
  const now = nowSec();
  const db = env.gradecalc;
  const old = oldToken && TOKEN_RE.test(oldToken) ? await sha256Hex(oldToken) : '';
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ? OR token_hash = ?').bind(now, old),
    db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token), userId, randomToken(32), now, now + SESSION_DAYS * 86400),
    // Oldest sessions beyond the cap go (sign-ins on many devices).
    db.prepare(`DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN
      (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, token_hash LIMIT ?)`).bind(userId, userId, MAX_SESSIONS_PER_USER),
  ]);
  return cookie(SESSION_COOKIE, token, SESSION_DAYS * 86400);
}

/** The signed-in user for this request (from the cookie only), or null. */
async function getSession(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || !TOKEN_RE.test(token)) return null;
  const hash = await sha256Hex(token);
  const row = await env.gradecalc.prepare(
    `SELECT s.token_hash, s.csrf, s.expires_at, u.id, u.provider, u.subject, u.email, u.created_at, u.consent_version, u.consent_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(hash).first();
  if (!row) return null;
  if (row.expires_at <= nowSec()) {
    await env.gradecalc.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    return null;
  }
  return row;
}

const isAdmin = (env, s) => !!(s && s.provider === 'google' && env.ADMIN_SUB && safeEqual(s.subject, String(env.ADMIN_SUB)));

/** Writes: same origin (Origin must be ours, Sec-Fetch-Site same-origin if sent) and the session's CSRF token. */
function writeAllowed(request, env, session) {
  const origin = request.headers.get('Origin');
  if (!origin || !env.PUBLIC_ORIGIN || origin !== env.PUBLIC_ORIGIN) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return false;
  return !!session && safeEqual(request.headers.get('X-CSRF-Token') || '', session.csrf);
}
const isJson = (request) => /^application\/json(;|$)/i.test(request.headers.get('Content-Type') || '');

async function smallJson(request) {
  if (!isJson(request)) return { bad: error(415, 'json_only') };
  const text = await readBody(request, MAX_SMALL_BODY);
  if (text === null) return { bad: error(413, 'too_large') };
  try { const v = JSON.parse(text || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? { body: v } : { bad: error(400, 'bad_json') }; }
  catch { return { bad: error(400, 'bad_json') }; }
}

// ---------------------------------------------------------------- /auth/*
const SIGNIN_RESULT = (code) => `/?signin=${code}`;

async function auth(request, env, url) {
  if (!(await allowed(env, 'RL_AUTH', `ip:${ipOf(request)}`))) return tooMany();
  const m = /^\/auth\/(login|callback)\/([a-z]+)$/.exec(url.pathname);
  if (m && request.method === 'GET') {
    const [, step, name] = m;
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, name)) return error(404, 'not_found');
    if (!configured(env, name)) return redirect(SIGNIN_RESULT('unavailable'), [clearFlow()]);
    if (step === 'login') {
      const { location, cookie: c } = await startLogin(env, name);
      return redirect(location, [c]);
    }
    const r = await finishLogin(env, name, url, request);
    if (r.error) return redirect(SIGNIN_RESULT(r.error), [clearFlow()]);
    const userId = await upsertUser(env, r.identity);
    return redirect(SIGNIN_RESULT('ok'), [clearFlow(), await newSession(env, userId, readCookie(request, SESSION_COOKIE))]);
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    const s = await getSession(request, env);
    if (s && !writeAllowed(request, env, s)) return error(403, 'csrf');
    if (s) await env.gradecalc.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(s.token_hash).run();
    return withCookies(json({ ok: true }), [clearCookie(SESSION_COOKIE)]);
  }
  return error(404, 'not_found');
}

async function upsertUser(env, { provider, subject, email }) {
  const t = isoNow();
  const row = await env.gradecalc.prepare(
    `INSERT INTO users (provider, subject, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (provider, subject) DO UPDATE SET email = excluded.email, last_seen_at = excluded.last_seen_at
     RETURNING id`).bind(provider, subject, email, t, t).first();
  return row.id;
}

// ---------------------------------------------------------------- /api/*
/** Shallow check of a gradebook document; the page normalizes it fully whenever it loads one. */
function docOk(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.schema !== 1) return false;
  if (d.settings !== undefined && (d.settings === null || typeof d.settings !== 'object' || Array.isArray(d.settings))) return false;
  if (d.audit !== undefined && !Array.isArray(d.audit)) return false;
  return ENTITIES.every((e) => d[e] === undefined || Array.isArray(d[e]));
}

async function api(request, env, url) {
  if (!(await allowed(env, 'RL_API', `ip:${ipOf(request)}`))) return tooMany();
  const path = url.pathname;
  const method = request.method;
  const db = env.gradecalc;
  const s = await getSession(request, env);
  // Per user as well as per IP (one account used from many addresses).
  if (s && !(await allowed(env, 'RL_API', `user:${s.id}`))) return tooMany();

  // The only route that answers without a session: "am I signed in?" (never an error, so the page can just ask).
  if (path === '/api/me' && method === 'GET') {
    const providers = Object.keys(PROVIDERS).filter((n) => configured(env, n));
    if (!s) return json({ signedIn: false, providers });
    const g = await db.prepare('SELECT version, bytes, updated_at FROM gradebooks WHERE user_id = ?').bind(s.id).first();
    return json({
      signedIn: true, providers, uid: s.id, csrf: s.csrf, admin: isAdmin(env, s), consent_current: CONSENT_VERSION,
      account: { provider: s.provider, email: s.email, created_at: s.created_at, consent_version: s.consent_version, consent_at: s.consent_at },
      gradebook: g ? { version: g.version, bytes: g.bytes, updated_at: g.updated_at } : null,
    });
  }
  if (!s) return error(401, 'signed_out');
  const write = !(method === 'GET' || method === 'HEAD');
  if (write) {
    if (!writeAllowed(request, env, s)) return error(403, 'csrf');
    if (!(await allowed(env, 'RL_WRITE', `user:${s.id}`))) return tooMany();
  }

  if (path === '/api/consent' && method === 'POST') {
    const { body, bad } = await smallJson(request);
    if (bad) return bad;
    if (body.version !== CONSENT_VERSION) return error(400, 'wrong_version');
    const at = isoNow();
    await db.prepare('UPDATE users SET consent_version = ?, consent_at = ? WHERE id = ?').bind(CONSENT_VERSION, at, s.id).run();
    return json({ ok: true, consent_version: CONSENT_VERSION, consent_at: at });
  }

  if (path === '/api/gradebook' && method === 'GET') {
    const g = await db.prepare('SELECT doc, version, updated_at FROM gradebooks WHERE user_id = ?').bind(s.id).first();
    if (!g) return json({ version: 0, updated_at: null, doc: null });
    return rawJson(`{"version":${Number(g.version)},"updated_at":${JSON.stringify(g.updated_at)},"doc":${g.doc}}`);
  }

  if (path === '/api/gradebook' && method === 'PUT') {
    if (s.consent_version !== CONSENT_VERSION) return error(403, 'consent_required');
    if (!isJson(request)) return error(415, 'json_only');
    const text = await readBody(request, MAX_DOC_BYTES + 1024);
    if (text === null) return error(413, 'too_large');
    let body;
    try { body = JSON.parse(text); } catch { return error(400, 'bad_json'); }
    const base = body && body.base_version;
    if (!Number.isSafeInteger(base) || base < 0 || !docOk(body.doc)) return error(400, 'bad_gradebook');
    const doc = JSON.stringify(body.doc);
    const bytes = new TextEncoder().encode(doc).byteLength;
    if (bytes > MAX_DOC_BYTES) return error(413, 'too_large');
    const at = isoNow();
    const r = base === 0
      ? await db.prepare('INSERT INTO gradebooks (user_id, doc, version, bytes, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT (user_id) DO NOTHING')
        .bind(s.id, doc, bytes, at).run()
      : await db.prepare('UPDATE gradebooks SET doc = ?, version = version + 1, bytes = ?, updated_at = ? WHERE user_id = ? AND version = ?')
        .bind(doc, bytes, at, s.id, base).run();
    if (!r.meta || r.meta.changes !== 1) {
      const cur = await db.prepare('SELECT version, updated_at FROM gradebooks WHERE user_id = ?').bind(s.id).first();
      return json({ error: 'conflict', version: cur ? cur.version : 0, updated_at: cur ? cur.updated_at : null }, 409);
    }
    return json({ version: base + 1, updated_at: at });
  }

  if (path === '/api/account/export' && method === 'GET') {
    const g = await db.prepare('SELECT doc, version, updated_at FROM gradebooks WHERE user_id = ?').bind(s.id).first();
    const account = { provider: s.provider, email: s.email, created_at: s.created_at, consent_version: s.consent_version, consent_at: s.consent_at };
    const head = JSON.stringify({ app: 'GradeCalc', kind: 'account-export', format: 1, exported_at: isoNow(), account,
      gradebook_version: g ? g.version : 0, gradebook_updated_at: g ? g.updated_at : null });
    const text = `${head.slice(0, -1)},"gradebook":${g ? g.doc : 'null'}}`;
    return rawJson(text, 200, { 'Content-Disposition': `attachment; filename="gradecalc-backup-account-${isoNow().slice(0, 10)}.json"` });
  }

  if (path === '/api/account/delete' && method === 'POST') {
    const { body, bad } = await smallJson(request);
    if (bad) return bad;
    if (body.confirm !== 'delete') return error(400, 'confirm_required');
    await db.batch([
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(s.id),
      db.prepare('DELETE FROM gradebooks WHERE user_id = ?').bind(s.id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(s.id),
    ]);
    return withCookies(json({ ok: true }), [clearCookie(SESSION_COOKIE)]);
  }

  // Admin: counts and storage only. Never selects a gradebook's contents, an email or a subject.
  if (path === '/api/admin' && method === 'GET') {
    if (!isAdmin(env, s)) return error(404, 'not_found');
    const [users, byProvider, books, sessions] = await db.batch([
      db.prepare('SELECT COUNT(*) AS n FROM users'),
      db.prepare('SELECT provider, COUNT(*) AS n FROM users GROUP BY provider'),
      db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM gradebooks'),
      db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?').bind(nowSec()),
    ]);
    const providers = { google: 0, microsoft: 0 };
    for (const r of byProvider.results) providers[r.provider] = r.n;
    return json({ users: users.results[0].n, providers, gradebooks: books.results[0].n, bytes: books.results[0].bytes,
      active_sessions: sessions.results[0].n, label: env.ADMIN_EMAIL || null });
  }

  return error(404, 'not_found');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/auth/')) return await auth(request, env, url);
      if (url.pathname.startsWith('/api/')) return await api(request, env, url);
    } catch (e) {
      console.error('server_error', e && e.name); // the kind only: messages could hold data
      return error(500, 'server_error'); // never echo details (could include tokens or data)
    }
    return env.ASSETS.fetch(request);
  },
};
