// Response, cookie and request helpers shared by the Worker modules.

export const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex',
  // A JSON answer opened as a page (or framed) can't run or load anything.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains', // same as site/_headers
};

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
/** A JSON body that is already text (a stored gradebook): sent as-is, never parsed again. */
export const rawJson = (text, status = 200, extra = {}) => new Response(text, { status, headers: { ...HEADERS, ...extra } });
export const error = (status, code, extra = {}) => json({ error: code }, status, extra);

/** A redirect that sets cookies (Headers allows several Set-Cookie lines). */
export function redirect(location, cookies = []) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Strict-Transport-Security': HEADERS['Strict-Transport-Security'] });
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
}

export function withCookies(res, cookies) {
  for (const c of cookies) res.headers.append('Set-Cookie', c);
  return res;
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** `__Host-` cookie: Secure, Path=/, no Domain, so only this exact origin over HTTPS can set or read it. */
export const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
export const clearCookie = (name) => cookie(name, '', 0);

/** The request body as text, refused (null) over `max` bytes, without trusting Content-Length alone. */
export async function readBody(request, max) {
  const len = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(len) && len > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}

export const nowSec = () => Math.floor(Date.now() / 1000);
export const isoNow = () => new Date().toISOString();

export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function b64urlBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('bad base64url');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256b64url(text) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
/** Constant-time string compare (lengths are not secret here: tokens have fixed lengths). */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
export async function hmac(secret, text) {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(text))));
}
