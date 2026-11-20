// CalcCheck, Round 5 (accounts + sync): every number on screen stays identical to calc.js when the gradebook goes through
// the server, when the guest gradebook is saved to / added to an account, and when the page switches documents.
// Runs the real store.js + sync.js (fresh copies per "browser") against the real Worker (tests/fake-cloud.js).
// Made-up data only: TEST-xxxx / DEMO-xxxx codes, made-up marks. Hand-worked expected values are in the comments.
import { mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assert, near } from './helpers.js';
import { build } from '../scripts/build.mjs';
import { computeAll } from '../shared/calc.js';
import worker, { CONSENT_VERSION } from '../worker/index.js';
import { makeEnv, makeProviders, makeClient, ORIGIN } from './fake-cloud.js';

build();
const SITE = fileURLToPath(new URL('../site/js/', import.meta.url));
const { appendDoc } = await import('../site/js/files.js');
const { demoDoc } = await import('../site/js/demo.js');
const { liveDoc } = await import('../site/js/structure.js');

// ---------------------------------------------------------------- the numbers a student sees
const pageView = (d) => liveDoc({ ...d, terms: d.terms.filter((r) => !r.deleted_at), courses: d.courses.filter((r) => !r.deleted_at),
  components: d.components.filter((r) => !r.deleted_at), assessments: d.assessments.filter((r) => !r.deleted_at),
  repeats: (d.repeats || []).filter((r) => !r.deleted_at) });
const calcOf = (d) => computeAll(pageView(d));
const plain = (x) => JSON.parse(JSON.stringify(x, (k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v)));
/** Everything computeAll shows, minus the row objects themselves (they carry timestamps). Exact, not "close". */
function screen(d) {
  const r = calcOf(d);
  return plain({
    courses: [...r.courses].map(([id, x]) => [id, { result: x.result, projected: x.projected, gpa: x.gpa, letter: x.letter, counts: x.counts, repeat: x.repeat ?? null }]),
    terms: r.terms, years: r.years, cumulativeTo: r.cumulativeTo, cumulative: r.cumulative, scale: r.scale,
  });
}
/** Per-course headline numbers keyed by "term name / course code" (for documents whose ids differ). */
function headline(d) {
  const r = calcOf(d);
  const out = {};
  for (const [, x] of r.courses) {
    const t = d.terms.find((tt) => tt.id === x.course.term_id);
    out[`${t.name} / ${x.course.code}`] = plain({ soFar: x.result.soFar, average: x.result.average, projected: x.projected, gpa: x.gpa,
      letter: x.letter, counts: x.counts, excluded: x.repeat?.excluded ?? null, policy: x.repeat?.policy ?? null });
  }
  return out;
}

// ---------------------------------------------------------------- a fake browser per "device"
let P;
let cur = null; // the device whose page is running right now
const pages = [];
function use(dev) { cur = dev; return dev; }
const fakeLs = {
  getItem: (k) => (cur.mem.has(k) ? cur.mem.get(k) : null),
  setItem: (k, v) => { cur.mem.set(k, String(v)); },
  removeItem: (k) => { cur.mem.delete(k); },
  key: (i) => [...cur.mem.keys()][i] ?? null,
  get length() { return cur.mem.size; },
};
const on = (where) => (type, fn) => { (cur[where][type] ||= []).push(fn); };
const GLOBALS = ['localStorage', 'window', 'document', 'location', 'history', 'fetch', 'setTimeout', 'clearTimeout'];

/** Runs fn with browser globals pointing at the current device; puts Node's back afterwards (other test files share them). */
async function browser(fn) {
  P ??= await makeProviders();
  const saved = Object.fromEntries(GLOBALS.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const set = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  set('localStorage', fakeLs);
  set('window', { addEventListener: on('win') });
  set('document', { addEventListener: on('doc'), visibilityState: 'visible' });
  set('location', { get href() { return `${ORIGIN}/${cur.signin ? `?signin=${cur.signin}` : ''}`; }, replace(u) { cur.replaced = u; } });
  set('history', { state: null, replaceState() { cur.signin = null; } });
  set('fetch', async (u, init = {}) => {
    const url = String(u);
    if (url.startsWith('/')) {
      const headers = { ...(init.headers || {}) };
      return cur.client.req(url, { method: init.method || 'GET', body: init.body, headers });
    }
    return P.fetch(url, init); // the Worker talking to the fake Google / Microsoft
  });
  // Push timers: kept per device, run only when a test says so (no stray pushes after the test).
  set('setTimeout', (f, ms) => { const t = { f, ms }; cur.timers.add(t); return t; });
  set('clearTimeout', (t) => { if (cur) cur.timers.delete(t); });
  try { return await fn(); } finally {
    for (const k of GLOBALS) { if (saved[k]) Object.defineProperty(globalThis, k, saved[k]); else delete globalThis[k]; }
    cur = null;
  }
}

/** A cloud: the real Worker on a fresh SQLite D1. */
const cloud = () => { const env = makeEnv(); return { env, client: () => makeClient(worker, env) }; };

/** One page load in one browser: fresh store.js + sync.js module copies (module state is per page), shared localStorage
 * (`mem`) and cookies (`client`) per browser. */
async function page(browserState, name = 'page') {
  const dir = mkdtempSync(path.join(os.tmpdir(), `gc-r5-${name}-`));
  for (const f of ['store.js', 'sync.js']) copyFileSync(path.join(SITE, f), path.join(dir, f));
  const dev = use({ ...browserState, win: {}, doc: {}, timers: new Set(), remote: 0, conflicts: 0, signedOutCalls: 0 });
  dev.store = await import(pathToFileURL(path.join(dir, 'store.js')).href);
  dev.sync = await import(pathToFileURL(path.join(dir, 'sync.js')).href);
  dev.start = async () => {
    use(dev);
    return dev.sync.init({ status: () => {}, remote: () => { dev.remote++; }, conflict: () => { dev.conflicts++; }, signedOut: () => { dev.signedOutCalls++; }, consent: () => {} });
  };
  pages.push(dev);
  return dev;
}
/** A browser: its localStorage and its cookie jar. */
const newBrowser = (c) => ({ mem: new Map(), client: c.client(), signin: null });
async function signIn(b, sub) {
  await b.client.signIn(P, 'google', P.google(sub));
  assert.equal((await b.client.req('/api/consent', { method: 'POST', body: { version: CONSENT_VERSION } })).status, 200);
  b.signin = 'ok';
}
const serverDoc = async (b) => (await (await b.client.req('/api/gradebook')).json());
const localDoc = (dev, key) => JSON.parse(dev.mem.get(key));

/** Edits that leave full rows in the history (audit) and exercise the math: curves, an excused component, a custom scale. */
async function editDemo(api) {
  const all = await api.all();
  const byCode = (code, n = 0) => all.courses.filter((c) => c.code === code)[n];
  const quiz = all.assessments.find((a) => a.mark === 0.8 && all.components.find((k) => k.id === a.component_id)?.name === 'Quizzes');
  await api.patch('assessments', quiz.id, { curve: { type: 'add', value: 0.05 } }); // 80% quiz +5 points
  await api.patch('courses', byCode('DEMO-1400').id, { curve: { type: 'mul', value: 1.05 } });
  await api.patch('courses', byCode('DEMO-1100').id, { cap_100: 1, curve: { type: 'add', value: 0.1 } });
  // DEMO-2300: Tests excused as a whole (its 35% moves to the Final exam)
  const tests = all.components.find((k) => k.course_id === byCode('DEMO-2300').id && k.name === 'Tests');
  const fin = all.components.find((k) => k.course_id === byCode('DEMO-2300').id && k.name === 'Final exam');
  await api.patch('components', tests.id, { excused_to: { to: fin.id } });
  for (const a of all.assessments.filter((x) => x.component_id === tests.id)) await api.patch('assessments', a.id, { excused: 1 });
  // A deleted course: hidden, in Recently deleted, must stay hidden after the trip.
  await api.remove('courses', byCode('DEMO-1300').id);
  await api.settings({ gpa_scale: 'custom', repeat_policy_default: 'latest',
    custom_scale: { kind: 'points', bands: [{ min: 0.85, letter: 'A', points: 4 }, { min: 0.7, letter: 'B', points: 3 }, { min: 0.6, letter: 'C', points: 2 }, { min: 0.5, letter: 'D', points: 1 }] } });
}

const T = (name, fn) => [name, () => browser(fn)];

export const tests = [
  T('server round trip: every number identical after PUT → D1 → GET → normalize (other device and this one)', async () => {
    const c = cloud();
    const A = newBrowser(c), B = newBrowser(c);
    await signIn(A, 'r5-student-1');
    const a = await page(A, 'a');
    let r = await a.start();
    assert.equal(r.mode, 'account');
    assert.equal(r.emptyAccount, true, 'new account: empty');
    await a.store.api.replace(demoDoc());
    await editDemo(a.store.api);
    // A small course worked by hand: Labs 40% (18/20 = 90%, 7/10 = 70% → mean 80%), Exam 60% not marked.
    //   so far  = 0.40 × 0.80            = 0.32  (unmarked exam counts as 0)
    //   average = 0.40 × 0.80 / 0.40     = 0.80  (marked work only)
    const t = (await a.store.api.all()).terms.at(-1);
    const course = await a.store.api.create('courses', { term_id: t.id, code: 'TEST-2200', title: 'Made-up Optics', credits: 3 });
    const labs = await a.store.api.create('components', { course_id: course.id, name: 'Labs', weight: 40 });
    await a.store.api.create('components', { course_id: course.id, name: 'Exam', weight: 60 });
    await a.store.api.create('assessments', { component_id: labs.id, name: 'Lab 1', mark: 18, out_of: 20 });
    await a.store.api.create('assessments', { component_id: labs.id, name: 'Lab 2', mark: 7, out_of: 10 });
    assert.equal(JSON.parse(A.mem.get('gc-cloud-meta')).dirty, true, 'edits mark the copy unsynced');
    await a.sync.push();
    const meta = JSON.parse(A.mem.get('gc-cloud-meta'));
    assert.equal(meta.dirty, false);
    const local = localDoc(a, 'gc-cloud-doc');
    const before = screen(local);

    // The server holds exactly the text this browser sent.
    const s = await serverDoc(A);
    assert.equal(s.version, meta.version);
    assert.deepEqual(screen(s.doc), before, 'server copy: same numbers');

    // Another device signs in to the same account and pulls it.
    await signIn(B, 'r5-student-1');
    const b = await page(B, 'b');
    r = await b.start();
    assert.equal(r.mode, 'account');
    assert.ok(!r.emptyAccount);
    const there = localDoc(b, 'gc-cloud-doc');
    assert.deepEqual(screen(there), before, 'other device: every course, term, year and cumulative number identical');
    const shown = calcOf(there).courses.get(course.id).result;
    near(shown.soFar, 0.32, 'TEST-2200 so far', 1e-12);
    near(shown.average, 0.8, 'TEST-2200 average', 1e-12);
    // Data the student sees besides grades: settings, repeats, Recently deleted.
    assert.deepEqual(there.settings, local.settings);
    assert.deepEqual(there.repeats, local.repeats);
    assert.equal(there.courses.filter((x) => x.deleted_at).length, 1, 'the deleted course is still only in Recently deleted');
    assert.equal((await b.store.api.all()).courses.some((x) => x.code === 'DEMO-1300'), false);
    // normalize is a fixed point: a second trip changes nothing.
    assert.deepEqual(b.store.normalize(JSON.parse(JSON.stringify(there))), there);
  }),

  T('pulling again with nothing new changes nothing: no "Updated from your other device", undo kept', async () => {
    const c = cloud();
    const A = newBrowser(c), B = newBrowser(c);
    await signIn(A, 'r5-student-2');
    await signIn(B, 'r5-student-2');
    const a = await page(A, 'a');
    await a.start();
    await a.store.api.replace(demoDoc());
    await editDemo(a.store.api); // history now holds whole rows (before/after)
    await a.sync.push();
    const b = await page(B, 'b');
    await b.start();
    const first = B.mem.get('gc-cloud-doc');
    b.remote = 0;
    await b.sync.pull();
    await b.sync.pull();
    assert.equal(b.remote, 0, 'no new version on the server: the page must not reload (it would wipe Undo)');
    assert.equal(B.mem.get('gc-cloud-doc'), first, 'local copy untouched');
    // A real change on A arrives once.
    use(a);
    const it = (await a.store.api.all()).assessments.find((x) => x.mark === null);
    await a.store.api.patch('assessments', it.id, { mark: 0.66 });
    await a.sync.push();
    use(b);
    await b.sync.pull();
    assert.equal(b.remote, 1, 'a new version: shown once');
    await b.sync.pull();
    assert.equal(b.remote, 1, '…and not again');
    assert.deepEqual(screen(localDoc(b, 'gc-cloud-doc')), screen(localDoc(a, 'gc-cloud-doc')));
  }),

  T('"Save to my account": the guest gradebook copied as is (numbers, repeats, rules, settings); guest copy untouched', async () => {
    const c = cloud();
    const A = newBrowser(c);
    const g = await page(A, 'guest');
    assert.equal((await g.start()).mode, 'guest');
    await g.store.api.replace(demoDoc());
    await editDemo(g.store.api);
    const guestText = A.mem.get('gc-gradebook');
    const guestScreen = screen(JSON.parse(guestText));
    assert.equal(A.mem.has('gc-cloud-doc'), false, 'guest mode never writes the account copy');

    await signIn(A, 'r5-student-3');
    const a = await page(A, 'acct');
    const r = await a.start();
    assert.equal(r.emptyAccount, true, 'empty account + guest gradebook → the offer');
    assert.equal(a.store.currentKey(), 'gc-cloud-doc');
    assert.equal((await a.store.api.all()).terms.length, 0, 'the account copy starts empty, not the guest one');
    // copyGuest('replace') in app.js
    const gd = a.sync.guestDoc();
    assert.ok(gd);
    await a.store.api.replace(gd, { ifUnchanged: true });
    await a.sync.push();
    assert.equal(A.mem.get('gc-gradebook'), guestText, 'guest gradebook byte-identical');
    assert.deepEqual(screen(localDoc(a, 'gc-cloud-doc')), guestScreen, 'account copy: same numbers');
    const s = await serverDoc(A);
    assert.deepEqual(screen(s.doc), guestScreen, 'server: same numbers');
    assert.deepEqual(s.doc.settings, JSON.parse(guestText).settings, 'settings (custom scale, repeat default) came along');
    assert.deepEqual(s.doc.repeats, JSON.parse(guestText).repeats, 'repeat links came along');
  }),

  T('"Add it to my account": guest courses keep their numbers (rules and repeats re-pointed); account keeps its own', async () => {
    const c = cloud();
    const A = newBrowser(c);
    // Account (built first on this browser): Term A (year 1), TEST-1000, 3 cr, Exam 100% = 80%.
    await signIn(A, 'r5-student-4');
    const a = await page(A, 'acct');
    await a.start();
    const api = a.store.api;
    const ta = await api.create('terms', { name: 'Term A', year_of_study: 1, sort_order: 1 });
    const c1 = await api.create('courses', { term_id: ta.id, code: 'TEST-1000', title: 'Made-up Statics', credits: 3 });
    const k1 = await api.create('components', { course_id: c1.id, name: 'Exam', weight: 100 });
    await api.create('assessments', { component_id: k1.id, name: 'Exam', mark: 0.8 });
    await api.settings({ repeat_policy_default: 'best' });
    await a.sync.push();
    const acctBefore = headline(localDoc(a, 'gc-cloud-doc'));

    // Guest gradebook, written straight into this browser's guest key (same ids 1.. as the account: they must be re-numbered).
    //   Term G1 (year 1): TEST-2000, 3 cr, 60%.
    //   Term G2 (year 2): TEST-2000 retake, 3 cr, 40% (repeat link, no policy of its own; guest default = latest)
    //                     TEST-2100, 3 cr: Midterm 40% = 50%, Final 60% = 90%, final replaces the midterm if higher
    //                     → final carries 100%: 0.90 (without the rule: 0.4×0.5 + 0.6×0.9 = 0.74)
    const now = new Date().toISOString();
    const row = (x) => ({ version: 1, created_at: now, updated_at: now, deleted_at: null, ...x });
    const guest = {
      schema: 1, next_id: 20, audit: [], settings: { gpa_scale: 'uwindsor', custom_scale: null, repeat_policy_default: 'latest', default_credits: 3 },
      terms: [row({ id: 1, name: 'Term G1', year_of_study: 1, sort_order: 1 }), row({ id: 2, name: 'Term G2', year_of_study: 2, sort_order: 2 })],
      courses: [row({ id: 3, term_id: 1, code: 'TEST-2000', title: 'Made-up Dynamics', credits: 3 }),
        row({ id: 4, term_id: 2, code: 'TEST-2000', title: 'Made-up Dynamics (again)', credits: 3 }),
        row({ id: 5, term_id: 2, code: 'TEST-2100', title: 'Made-up Fluids', credits: 3 })],
      components: [row({ id: 6, course_id: 3, name: 'Exam', weight: 100 }), row({ id: 7, course_id: 4, name: 'Exam', weight: 100 }),
        row({ id: 8, course_id: 5, name: 'Midterm', weight: 40 }), row({ id: 9, course_id: 5, name: 'Final', weight: 60, rule: { type: 'absorb_if_higher', from: [8] } })],
      assessments: [row({ id: 10, component_id: 6, name: 'Exam', mark: 0.6 }), row({ id: 11, component_id: 7, name: 'Exam', mark: 0.4 }),
        row({ id: 12, component_id: 8, name: 'Midterm', mark: 0.5 }), row({ id: 13, component_id: 9, name: 'Final', mark: 0.9 })],
      repeats: [row({ id: 14, course_ids: [3, 4], policy: null })],
    };
    A.mem.set('gc-gradebook', JSON.stringify(guest));
    const guestHead = headline(a.store.normalize(guest));
    near(guestHead['Term G2 / TEST-2100'].average, 0.9, 'guest TEST-2100 (rule)', 1e-12);

    // copyGuest('add') in app.js
    await api.replace(appendDoc(api.snapshot(), a.sync.guestDoc()), { ifUnchanged: true });
    await a.sync.push();
    const B = newBrowser(c);
    await signIn(B, 'r5-student-4');
    const b = await page(B, 'b');
    await b.start();
    const merged = localDoc(b, 'gc-cloud-doc');
    const head = headline(merged);
    assert.deepEqual(head['Term A / TEST-1000'], acctBefore['Term A / TEST-1000'], 'account course unchanged');
    for (const k of Object.keys(guestHead)) assert.deepEqual(head[k], guestHead[k], `${k}: same as in guest mode`);
    near(head['Term G2 / TEST-2100'].average, 0.9, 'rule still points at the (re-numbered) midterm', 1e-12);
    assert.equal(head['Term G2 / TEST-2000'].policy, 'latest', 'guest repeat default pinned on its repeat link');
    assert.equal(merged.settings.repeat_policy_default, 'best', 'account settings stay');
    const r = calcOf(merged);
    // Cumulative (latest attempt of TEST-2000 counts): (0.80×3 + 0.40×3 + 0.90×3) / 9 = 2.1×3/9 = 0.70
    near(r.cumulative.average, 0.7, 'cumulative', 1e-12);
    assert.equal(r.cumulative.credits, 9);
    // Cumulative to year 1: TEST-1000 0.80 and TEST-2000 (first attempt, the only one in scope) 0.60 → 0.70
    near(r.cumulativeTo.get(1).average, 0.7, 'cumulative to year 1', 1e-12);
    // Year 2: retake 0.40, TEST-2100 0.90 → 0.65
    near(r.years.get(2).average, 0.65, 'year 2', 1e-12);
    // Ids: every guest row got a new id above the account's; next_id past all of them.
    const ids = ['terms', 'courses', 'components', 'assessments', 'repeats'].flatMap((e) => merged[e].map((x) => x.id));
    assert.equal(new Set(ids).size, ids.length, 'no id used twice');
    assert.ok(merged.next_id > Math.max(...ids));
  }),

  T('Load demo / Reset everything in account mode: sent to the account; the guest gradebook is never touched', async () => {
    const c = cloud();
    const A = newBrowser(c);
    A.mem.set('gc-gradebook', JSON.stringify(demoDoc()));
    const guestText = A.mem.get('gc-gradebook');
    await signIn(A, 'r5-student-5');
    const a = await page(A, 'acct');
    await a.start();
    await a.store.api.replace(demoDoc());
    await a.sync.push();
    const s1 = await serverDoc(A);
    assert.deepEqual(screen(s1.doc), screen(localDoc(a, 'gc-cloud-doc')), 'demo data: same numbers on the server');
    await a.store.api.replace(a.store.emptyDoc());
    await a.sync.push();
    const s2 = await serverDoc(A);
    assert.equal(s2.version, s1.version + 1);
    assert.equal(s2.doc.terms.length + s2.doc.courses.length, 0, 'Reset everything: the account is empty');
    assert.equal(A.mem.get('gc-gradebook'), guestText, 'guest gradebook untouched by demo / reset in account mode');
    // Signing out shows the guest gradebook again, unchanged.
    use(a);
    assert.deepEqual(await a.sync.signOut(), { ok: true });
    assert.equal(A.mem.has('gc-cloud-doc'), false);
    const g = await page(A, 'guest-again');
    assert.equal((await g.start()).mode, 'guest');
    assert.deepEqual(screen((await g.store.api.snapshot())), screen(JSON.parse(guestText)));
  }),

  T('conflict: "Use that version" shows exactly the other device\'s numbers; "Keep mine" sends this one\'s', async () => {
    const c = cloud();
    const A = newBrowser(c), B = newBrowser(c);
    await signIn(A, 'r5-student-6');
    await signIn(B, 'r5-student-6');
    const a = await page(A, 'a');
    await a.start();
    await a.store.api.replace(demoDoc());
    await a.sync.push();
    const b = await page(B, 'b');
    await b.start();
    // Both edit the same unmarked item offline-ish: A sends first.
    use(a);
    const open = (await a.store.api.all()).assessments.find((x) => x.mark === null);
    await a.store.api.patch('assessments', open.id, { mark: 0.95 });
    await a.sync.push();
    use(b);
    await b.store.api.patch('assessments', open.id, { mark: 0.55 });
    await b.sync.push();
    assert.equal(b.sync.hasConflict(), true);
    assert.equal(b.conflicts, 1);
    assert.equal(localDoc(b, 'gc-cloud-doc').assessments.find((x) => x.id === open.id).mark, 0.55, 'nothing overwritten silently');
    assert.equal(await b.sync.useTheirs(), true);
    assert.deepEqual(screen(localDoc(b, 'gc-cloud-doc')), screen(localDoc(a, 'gc-cloud-doc')), 'Use that version: A\'s numbers');
    // Now B edits again and A conflicts; A keeps its own.
    await b.store.api.patch('assessments', open.id, { mark: 0.7 });
    await b.sync.push();
    use(a);
    await a.store.api.patch('assessments', open.id, { mark: 0.3 });
    await a.sync.push();
    assert.equal(a.sync.hasConflict(), true);
    await a.sync.keepMine();
    const s = await serverDoc(A);
    assert.equal(s.doc.assessments.find((x) => x.id === open.id).mark, 0.3);
    assert.deepEqual(screen(s.doc), screen(localDoc(a, 'gc-cloud-doc')));
  }),

  T('another account on the same browser: unsynced copy offered, then dropped; account view choices go with it', async () => {
    const c = cloud();
    const A = newBrowser(c);
    await signIn(A, 'r5-student-7');
    const a = await page(A, 'one');
    await a.start();
    await a.store.api.replace(demoDoc());
    await a.sync.push();
    await a.store.api.patch('assessments', (await a.store.api.all()).assessments[0].id, { mark: 0.42 });
    assert.equal(a.sync.unsynced(), true);
    // "What do I need" targets / recent courses: guest ones and this account's ones are kept apart.
    A.mem.set('gc-need-3', JSON.stringify({ target: '70' }));
    A.mem.set('gc-acct-need-3', JSON.stringify({ target: '90' }));
    A.mem.set('gc-acct-recent-courses', '[3]');
    // Session cookie gone (signed out elsewhere), and someone else signs in here.
    A.client.jar.clear();
    A.client.csrf = null;
    await signIn(A, 'r5-student-8');
    const b = await page(A, 'two');
    const r = await b.start();
    assert.ok(r.stray && r.stray.doc, 'the other account\'s unsynced copy is offered as a download');
    assert.equal(r.stray.doc.assessments[0].mark, 0.42);
    assert.equal(r.emptyAccount, true, 'the new account starts empty: none of the first account\'s data');
    assert.equal((await b.store.api.all()).courses.length, 0);
    assert.equal(A.mem.has('gc-acct-need-3'), false, 'first account\'s targets are not applied to the second account\'s course 3');
    assert.equal(A.mem.has('gc-acct-recent-courses'), false);
    assert.equal(A.mem.get('gc-need-3'), JSON.stringify({ target: '70' }), 'guest targets stay');
  }),

  T('page: per-course view choices are per document (guest vs account) and checked against the course', () => {
    const src = readFileSync(new URL('../site/js/app.js', import.meta.url), 'utf8');
    // Read and written through viewKey only: a fixed key would follow course ids into the other document.
    assert.ok(!/store\.(get|set)\(\s*['`]gc-(need|recent)/.test(src), 'no fixed gc-need-<id> / gc-recent-courses key');
    assert.ok(!/`gc-need-\$\{/.test(src));
    assert.match(src, /store\.get\(viewKey\('recent-courses'\)/);
    assert.match(src, /const key = viewKey\(`need-\$\{course\.id\}`\)/);
    assert.match(src, /c: course\.created_at/, 'a target remembers which course it was for (ids can be reused after a replace)');
    // "Save to my account" (same ids) brings the guest targets along; "Add" keeps the account's.
    assert.match(src, /if \(how !== 'add'\) \{ clearViewChoices\(\); copyGuestViewChoices\(\); \}/);
    const sync = readFileSync(new URL('../site/js/sync.js', import.meta.url), 'utf8');
    assert.match(sync, /VIEW_PREFIX/);
  }),
];
