// Sign-in with Google or Microsoft (OpenID Connect, authorization code flow + PKCE S256).
// /auth/login/<provider> → provider → /auth/callback/<provider>. The flow's state, nonce and PKCE verifier live in a
// short-lived signed __Host- cookie (no database row for abandoned sign-ins). The id_token from the token endpoint is
// still verified in full: RS256 signature against the provider's published keys, iss, aud, exp, iat, nbf, nonce.
// Identity = provider + Google `sub` / Microsoft `tid:oid`. Emails are a label only: no linking accounts by email.
import { b64url, b64urlBytes, randomToken, sha256b64url, hmac, safeEqual, readCookie, cookie, clearCookie, nowSec } from './http.js';

export const FLOW_COOKIE = '__Host-gc-signin';
const FLOW_SECONDS = 600;
const SKEW = 300; // seconds of clock difference allowed on exp / iat
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const PROVIDERS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    scope: 'openid email',
    clientId: (env) => env.GOOGLE_CLIENT_ID,
    clientSecret: (env) => env.GOOGLE_CLIENT_SECRET,
    extra: { prompt: 'select_account' },
    issuerOk: (iss) => iss === 'https://accounts.google.com' || iss === 'accounts.google.com',
    identity(c) {
      if (typeof c.sub !== 'string' || !/^[0-9A-Za-z_-]{1,255}$/.test(c.sub)) return null;
      const email = c.email_verified === true || c.email_verified === 'true' ? c.email : null;
      return { subject: c.sub, email };
    },
  },
  microsoft: {
    // "common": work/school accounts from any tenant and personal Microsoft accounts. The issuer is per tenant.
    authorize: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwks: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    scope: 'openid email profile',
    clientId: (env) => env.MICROSOFT_CLIENT_ID,
    clientSecret: (env) => env.MICROSOFT_CLIENT_SECRET,
    extra: { prompt: 'select_account', response_mode: 'query' },
    issuerOk: (iss, c) => typeof c.tid === 'string' && GUID.test(c.tid) && iss === `https://login.microsoftonline.com/${c.tid}/v2.0`,
    identity(c) {
      if (typeof c.oid !== 'string' || !GUID.test(c.oid)) return null;
      const email = typeof c.email === 'string' ? c.email : typeof c.preferred_username === 'string' ? c.preferred_username : null;
      return { subject: `${c.tid}:${c.oid}`, email };
    },
  },
};

export const configured = (env, name) => {
  const p = PROVIDERS[name];
  return !!(p && p.clientId(env) && p.clientSecret(env) && env.SESSION_SECRET && env.PUBLIC_ORIGIN);
};
/** Fixed, from configuration only (never from the request). */
export const redirectUri = (env, name) => `${env.PUBLIC_ORIGIN}/auth/callback/${name}`;

// ---------------------------------------------------------------- the flow cookie
async function sealFlow(env, flow) {
  const body = b64url(new TextEncoder().encode(JSON.stringify(flow)));
  return `${body}.${await hmac(env.SESSION_SECRET, `flow.${body}`)}`;
}
async function openFlow(env, value) {
  if (!value || value.length > 1024) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig || !safeEqual(sig, await hmac(env.SESSION_SECRET, `flow.${body}`))) return null;
  try {
    const f = JSON.parse(new TextDecoder().decode(b64urlBytes(body)));
    return f && typeof f === 'object' && nowSec() - f.t <= FLOW_SECONDS && f.t <= nowSec() + 5 ? f : null;
  } catch { return null; }
}

/** Start: a 302 to the provider, and the flow cookie. */
export async function startLogin(env, name) {
  const p = PROVIDERS[name];
  const flow = { p: name, s: randomToken(), n: randomToken(), v: randomToken(48), t: nowSec() };
  const q = new URLSearchParams({
    client_id: p.clientId(env), redirect_uri: redirectUri(env, name), response_type: 'code', scope: p.scope,
    state: flow.s, nonce: flow.n, code_challenge: await sha256b64url(flow.v), code_challenge_method: 'S256', ...p.extra,
  });
  return { location: `${p.authorize}?${q}`, cookie: cookie(FLOW_COOKIE, await sealFlow(env, flow), FLOW_SECONDS) };
}

/**
 * Finish: checks the state against the flow cookie, swaps the code (with the PKCE verifier) for tokens, verifies the
 * id_token. Returns { identity } or { error } (a short code for the page; never token contents).
 */
export async function finishLogin(env, name, url, request, fetcher = fetch) {
  const p = PROVIDERS[name];
  const flow = await openFlow(env, readCookie(request, FLOW_COOKIE));
  const err = url.searchParams.get('error');
  if (err) {
    const desc = `${err} ${url.searchParams.get('error_description') || ''}`;
    // Microsoft: a school tenant that requires an administrator to approve new apps.
    if (/AADSTS(90094|90095|65001|900941)|admin(istrator)?[ _-]?(approval|consent)/i.test(desc)) return { error: 'approval' };
    if (err === 'access_denied') return { error: 'cancelled' };
    return { error: 'failed' };
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!flow || flow.p !== name || !state || !safeEqual(state, flow.s) || !code || code.length > 4096) return { error: 'failed' };

  let tokens;
  try {
    const res = await fetcher(p.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, name),
        client_id: p.clientId(env), client_secret: p.clientSecret(env), code_verifier: flow.v,
      }),
    });
    if (!res.ok) return { error: 'failed' };
    tokens = await res.json();
  } catch { return { error: 'failed' }; }

  const claims = await verifyIdToken(tokens && tokens.id_token, p, p.clientId(env), (force) => getKeys(p.jwks, fetcher, force));
  if (!claims || typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, flow.n)) return { error: 'failed' };
  const identity = p.identity(claims);
  if (!identity) return { error: 'failed' };
  const email = typeof identity.email === 'string' && identity.email.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(identity.email) ? identity.email : null;
  return { identity: { provider: name, subject: identity.subject, email } };
}

export const clearFlow = () => clearCookie(FLOW_COOKIE);

// ---------------------------------------------------------------- id_token
const keyCache = new Map(); // jwks url → { keys, at }
async function getKeys(jwksUrl, fetcher, force = false) {
  const hit = keyCache.get(jwksUrl);
  if (!force && hit && Date.now() - hit.at < 3600e3) return hit.keys;
  const res = await fetcher(jwksUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('jwks');
  const body = await res.json();
  const keys = Array.isArray(body && body.keys) ? body.keys : [];
  keyCache.set(jwksUrl, { keys, at: Date.now() });
  return keys;
}
export const _clearKeyCache = () => keyCache.clear(); // tests

/** The claims of a valid id_token for this provider and client, or null. Never throws. */
export async function verifyIdToken(token, p, clientId, keys, now = nowSec()) {
  try {
    if (typeof token !== 'string' || token.length > 16384) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, b, s] = parts;
    const header = JSON.parse(new TextDecoder().decode(b64urlBytes(h)));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    let jwk = (await keys(false)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await keys(true)).find((k) => k.kid === header.kid); // keys rotated: fetch once more
    if (!jwk || jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') return null;
    if ((jwk.use !== undefined && jwk.use !== 'sig') || (jwk.alg !== undefined && jwk.alg !== 'RS256')) return null;
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), new TextEncoder().encode(`${h}.${b}`));
    if (!ok) return null;
    const c = JSON.parse(new TextDecoder().decode(b64urlBytes(b)));
    if (!c || typeof c !== 'object') return null;
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!clientId || !aud.includes(clientId) || (aud.length > 1 && c.azp !== clientId)) return null;
    if (!p.issuerOk(c.iss, c)) return null;
    if (typeof c.exp !== 'number' || c.exp < now - SKEW) return null;
    if (typeof c.iat !== 'number' || c.iat > now + SKEW) return null;
    if (c.nbf !== undefined && (typeof c.nbf !== 'number' || c.nbf > now + SKEW)) return null;
    return c;
  } catch { return null; }
}
