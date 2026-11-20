// Accounts on the page (Round 5). Signing in is optional; guest mode never calls the server.
// Signed in, the gradebook is still kept in this browser (localStorage gc-cloud-doc, separate from the guest
// gradebook, which stays untouched), so the page works the same and keeps working offline. Each saved change marks
// the copy unsynced, and about 2 s later the whole document goes to PUT /api/gradebook with the version it was based on.
// The server answers 409 when another device saved first: "Updated on another device — Use that version / Keep mine".
// Sync state lives in localStorage gc-cloud-meta { uid, provider, email, version, dirty, synced_at }, shared by tabs.
import { useKey, onWrite, api, readDoc, normalize, GUEST_KEY } from './store.js';

/** Must match CONSENT_VERSION in worker/index.js. Bump both when the consent text changes. */
export const CONSENT_VERSION = 1;
export const CLOUD_KEY = 'gc-cloud-doc';
export const META_KEY = 'gc-cloud-meta';
const PUSH_DELAY = 2000;
const RETRY_DELAY = 30000;
const PULL_EVERY = 30000; // when the tab comes back into view

const S = {
  mode: 'guest',      // 'guest' | 'account'
  me: null,           // GET /api/me
  status: '',         // last status shown
  conflict: null,     // { version } when another device saved first
  signedOut: false,   // the session ended while this browser still has unsynced changes
  timer: null,
  pushing: null,
  again: false,
  lastPull: 0,
  on: {},             // handlers from the page: status(kind, text), remote(), conflict(), signedOut(), consent()
};

// ---------------------------------------------------------------- local state
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
export function readMeta() {
  try { const m = JSON.parse(ls.get(META_KEY)); return m && typeof m === 'object' && Number.isSafeInteger(m.uid) ? m : null; } catch { return null; }
}
const writeMeta = (m) => ls.set(META_KEY, JSON.stringify(m));
function updateMeta(changes) { const m = { ...readMeta(), ...changes }; writeMeta(m); return m; }
/** Per-course view choices made on the account's copy ("what do I need" targets, recent courses) start with this, so
 * they never follow a course id into the guest gradebook (ids there are a different course) or into another account. */
export const VIEW_PREFIX = 'gc-acct-';
/** Forget the account copy in this browser (sign-out, account deleted, another account signed in). */
function clearLocal() {
  ls.del(CLOUD_KEY); ls.del(META_KEY);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(VIEW_PREFIX)) localStorage.removeItem(k); }
  } catch { /* blocked */ }
}

// ---------------------------------------------------------------- server calls
class NetError extends Error {}
async function call(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    if (S.me && S.me.csrf) headers['X-CSRF-Token'] = S.me.csrf;
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
  } catch { throw new NetError('offline'); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data: data || {} };
}

// ---------------------------------------------------------------- status
const TEXT = {
  saved: 'Saved to your account',
  pending: 'Saving to your account…',
  saving: 'Saving to your account…',
  offline: 'Offline: saved on this device, will sync',
  conflict: 'Not synced: changed on another device',
  'signed-out': 'Signed out: changes kept on this device',
  big: 'Not synced: too big for an account (see Account)',
  error: 'Not synced yet: will try again',
};
const KIND = { saved: 'ok', pending: '', saving: '', offline: 'err', conflict: 'err', 'signed-out': 'err', big: 'err', error: 'err' };
function setStatus(s) {
  S.status = s;
  if (S.on.status) S.on.status(KIND[s] ?? '', TEXT[s] || '');
}
export const statusText = () => (S.mode === 'account' ? TEXT[S.status] || TEXT.saved : 'Saved in this browser');
export const statusKind = () => (S.mode === 'account' ? KIND[S.status] ?? 'ok' : 'ok');

// ---------------------------------------------------------------- start
/** The "?signin=…" result of a sign-in redirect, removed from the address bar. */
function takeSigninParam() {
  const u = new URL(location.href);
  const v = u.searchParams.get('signin');
  if (v === null) return null;
  u.searchParams.delete('signin');
  history.replaceState(history.state, '', u.pathname + u.search + u.hash);
  return /^[a-z]{1,20}$/.test(v) ? v : 'failed';
}

/**
 * Before the page reads any data. Returns { mode: 'guest' | 'account' | 'consent', notice, stray, me }.
 * `stray`: unsynced text from a different account that used this browser before (the page offers it as a download).
 */
export async function init(handlers = {}) {
  S.on = handlers;
  const notice = takeSigninParam();
  const meta = readMeta();
  if (!meta && notice !== 'ok') return { mode: 'guest', notice };
  let r;
  try { r = await call('GET', '/api/me'); } catch {
    if (meta) { enter(); setStatus('offline'); return { mode: 'account', notice: 'offline' }; }
    return { mode: 'guest', notice: notice === 'ok' ? 'offline' : notice };
  }
  if (r.status !== 200) {
    if (meta) { enter(); setStatus('offline'); return { mode: 'account', notice: 'offline' }; }
    return { mode: 'guest', notice: notice === 'ok' ? 'failed' : notice };
  }
  const me = r.data;
  if (!me.signedIn) {
    if (meta && meta.dirty) { enter(); S.signedOut = true; setStatus('signed-out'); return { mode: 'account', notice: 'expired' }; }
    if (meta) clearLocal();
    return { mode: 'guest', notice: meta ? 'expired' : notice === 'ok' ? 'failed' : notice };
  }
  S.me = me;
  let stray = null;
  if (meta && meta.uid !== me.uid) {
    if (meta.dirty) stray = { email: meta.email || null, doc: readDoc(CLOUD_KEY) };
    clearLocal();
  }
  if (me.account.consent_version !== CONSENT_VERSION) return { mode: 'consent', me, notice, stray };
  const first = await start();
  return { mode: 'account', me, notice, stray, ...first };
}

/** Switch the page to the account copy and fetch the server's version. Returns { emptyAccount } for "Save to cloud". */
async function start() {
  const m = readMeta();
  writeMeta({ uid: S.me.uid, provider: S.me.account.provider, email: S.me.account.email, version: m ? m.version : 0, dirty: m ? !!m.dirty : false, synced_at: m ? m.synced_at : null });
  enter();
  return pull({ initial: true });
}

let entered = false;
function enter() {
  S.mode = 'account';
  useKey(CLOUD_KEY);
  if (entered) return;
  entered = true;
  onWrite(() => {
    if (S.mode !== 'account') return;
    updateMeta({ dirty: true });
    if (!S.conflict && !S.signedOut) { setStatus('pending'); schedulePush(PUSH_DELAY); }
  });
  window.addEventListener('online', () => { if (readMeta()?.dirty) schedulePush(0); else pull(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (readMeta()?.dirty) schedulePush(0); return; }
    if (readMeta()?.dirty) schedulePush(0); else if (Date.now() - S.lastPull > PULL_EVERY) pull();
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== META_KEY && e.key !== null) return;
    const m = readMeta();
    if (!m) { location.replace('/'); return; } // signed out (or deleted) in another tab
    if (S.conflict && m.version >= S.conflict.version && !m.dirty) { S.conflict = null; setStatus('saved'); }
    else if (m.dirty) schedulePush(PUSH_DELAY);
  });
}

// ---------------------------------------------------------------- pull / push
/** The same gradebook once both are normalized. Raw text isn't enough: History entries made by edits here keep whole
 * rows, a copy loaded from the account has them trimmed, so the same gradebook would look "changed" on every fetch. */
const sameDoc = (a, b) => {
  try {
    const n = (x) => JSON.stringify(normalize(typeof x === 'string' ? JSON.parse(x) : x));
    return n(a) === n(b);
  } catch { return false; }
};

/** Fetch the account's version. Takes it when nothing here is unsynced; pushes when only this device changed. */
export async function pull({ initial = false } = {}) {
  if (S.mode !== 'account' || S.signedOut) return {};
  S.lastPull = Date.now();
  let r;
  try { r = await call('GET', '/api/gradebook'); } catch { setStatus('offline'); return {}; }
  if (r.status === 401) { signedOutNow(); return {}; }
  if (r.status !== 200) { setStatus('error'); return {}; }
  const server = r.data;
  const m = readMeta();
  if (!m) return {};
  if (server.version === 0) {
    if (m.dirty) { schedulePush(0); return {}; }
    updateMeta({ version: 0 });
    setStatus('saved');
    return { emptyAccount: true };
  }
  const local = ls.get(CLOUD_KEY);
  if (!m.dirty || !local) {
    // Same version as the copy here: nothing new (replacing would re-render and wipe Undo for nothing).
    if (!local || (server.version !== m.version && !sameDoc(local, server.doc))) {
      await api.replace(server.doc, { fromAccount: true });
      if (!initial && S.on.remote) S.on.remote();
    }
    updateMeta({ version: server.version, dirty: false, synced_at: server.updated_at });
    setStatus('saved');
    return {};
  }
  if (m.version === server.version) { schedulePush(0); return {}; }
  if (sameDoc(local, server.doc)) { updateMeta({ version: server.version, dirty: false, synced_at: server.updated_at }); setStatus('saved'); return {}; }
  showConflict(server.version);
  return {};
}

function schedulePush(delay) {
  clearTimeout(S.timer);
  S.timer = setTimeout(push, delay);
}
const withLock = (fn) => (navigator.locks ? navigator.locks.request('gc-sync', fn) : fn());

/** Send this device's copy (only while it has unsynced changes). One at a time across tabs (Web Locks). */
export function push() {
  clearTimeout(S.timer);
  if (S.pushing) { S.again = true; return S.pushing; }
  S.pushing = withLock(pushNow).finally(() => {
    S.pushing = null;
    if (S.again) { S.again = false; schedulePush(0); }
  });
  return S.pushing;
}
async function pushNow() {
  const m = readMeta();
  if (S.mode !== 'account' || !m || !m.dirty || S.conflict || S.signedOut) return;
  const text = ls.get(CLOUD_KEY);
  if (!text) return;
  setStatus('saving');
  let r;
  try { r = await call('PUT', '/api/gradebook', `{"base_version":${Number(m.version) || 0},"doc":${text}}`); } catch {
    setStatus('offline'); schedulePush(RETRY_DELAY); return;
  }
  if (r.status === 200) {
    const still = ls.get(CLOUD_KEY) !== text; // changed again while this was on its way
    updateMeta({ version: r.data.version, dirty: still, synced_at: r.data.updated_at });
    setStatus(still ? 'pending' : 'saved');
    if (still) schedulePush(PUSH_DELAY);
    return;
  }
  if (r.status === 409) {
    let g;
    try { g = await call('GET', '/api/gradebook'); } catch { setStatus('offline'); schedulePush(RETRY_DELAY); return; }
    if (g.status === 200 && sameDoc(text, g.data.doc)) { // the same change arrived from another tab of this browser
      updateMeta({ version: g.data.version, dirty: ls.get(CLOUD_KEY) !== text, synced_at: g.data.updated_at });
      setStatus('saved');
      return;
    }
    showConflict(g.status === 200 ? g.data.version : r.data.version);
    return;
  }
  if (r.status === 401) { signedOutNow(); return; }
  if (r.status === 403 && r.data.error === 'consent_required') { if (S.on.consent) S.on.consent(); setStatus('error'); return; }
  if (r.status === 413) { setStatus('big'); return; }
  setStatus('error');
  schedulePush(r.status === 429 ? 60000 : RETRY_DELAY);
}

function showConflict(version) {
  S.conflict = { version };
  setStatus('conflict');
  if (S.on.conflict) S.on.conflict();
}
function signedOutNow() {
  S.signedOut = true;
  setStatus('signed-out');
  if (S.on.signedOut) S.on.signedOut();
}

/** Conflict: take the other device's version (this device's unsynced changes are dropped). */
export async function useTheirs() {
  let g;
  try { g = await call('GET', '/api/gradebook'); } catch { setStatus('offline'); return false; }
  if (g.status !== 200) return false;
  await api.replace(g.data.doc || {}, { fromAccount: true });
  updateMeta({ version: g.data.version, dirty: false, synced_at: g.data.updated_at });
  S.conflict = null;
  setStatus('saved');
  return true;
}
/** Conflict: keep this device's version (it replaces the other device's on the server). */
export function keepMine() {
  if (!S.conflict) return Promise.resolve();
  updateMeta({ version: S.conflict.version, dirty: true });
  S.conflict = null;
  return push();
}

// ---------------------------------------------------------------- account actions
export const mode = () => S.mode;
export const me = () => S.me;
export const isSignedOut = () => S.signedOut;
export const hasConflict = () => !!S.conflict;
export const unsynced = () => !!readMeta()?.dirty;
/** The guest gradebook in this browser (kept apart while signed in), or null when empty. */
export function guestDoc() {
  const d = readDoc(GUEST_KEY);
  return d && d.terms.some((t) => !t.deleted_at) ? d : null;
}

export async function acceptConsent() {
  const r = await call('POST', '/api/consent', { version: CONSENT_VERSION });
  if (r.status !== 200) throw new Error(r.status === 429 ? 'Too many tries: wait a minute' : 'Couldn’t save your answer');
  S.me.account.consent_version = CONSENT_VERSION;
  S.me.account.consent_at = r.data.consent_at;
  return start();
}
/** "No thanks": a brand-new sign-in with nothing stored is deleted outright; otherwise just signed out. */
export async function declineConsent() {
  if (!S.me.gradebook) await call('POST', '/api/account/delete', { confirm: 'delete' }).catch(() => null);
  else await call('POST', '/auth/logout').catch(() => null);
  clearLocal();
}

/** Sign out. With unsynced changes, tries to send them first; `{ unsynced: true }` if that failed (page asks). */
export async function signOut({ force = false } = {}) {
  if (!force && unsynced() && !S.signedOut) {
    await push();
    if (unsynced()) return { unsynced: true };
  }
  await call('POST', '/auth/logout').catch(() => null);
  clearLocal();
  return { ok: true };
}

export async function deleteAccount() {
  const r = await call('POST', '/api/account/delete', { confirm: 'delete' });
  if (r.status !== 200) throw new Error(r.status === 429 ? 'Too many tries: wait a minute' : 'The account wasn’t deleted. Try again.');
  clearLocal();
}

export async function adminStats() {
  const r = await call('GET', '/api/admin');
  if (r.status !== 200) throw new Error('Not available');
  return r.data;
}

/** Fresh account details (for the Account dialog). */
export async function refreshMe() {
  try {
    const r = await call('GET', '/api/me');
    if (r.status === 200 && r.data.signedIn) S.me = r.data;
  } catch { /* offline: keep what we have */ }
  return S.me;
}
