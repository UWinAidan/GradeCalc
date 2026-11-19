// Guest-mode store (site/js/store.js) and demo data (site/js/demo.js), with an in-memory localStorage.
import assert from 'node:assert/strict';
import { computeAll } from '../shared/calc.js';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (globalThis.__full) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } mem.set(k, String(v)); },
  removeItem: (k) => mem.delete(k),
};
const { api, normalize, emptyDoc, FIELDS } = await import('../site/js/store.js');
const { demoDoc } = await import('../site/js/demo.js');
const saved = () => JSON.parse(mem.get('gc-gradebook'));

test('store: create → patch → delete → restore, with history', async () => {
  await api.replace(emptyDoc());
  const t = await api.create('terms', { name: 'Term A', bogus: 'dropped' });
  assert.equal(t.name, 'Term A'); assert.equal('bogus' in t, false, 'unknown fields are dropped');
  const c = await api.create('courses', { term_id: t.id, title: 'Course A' });
  assert.equal(c.credits, 3, 'defaults filled in'); assert.equal(c.type, 'graded');
  const k = await api.create('components', { course_id: c.id, name: 'Exam', weight: 100 });
  const a = await api.create('assessments', { component_id: k.id, name: 'Exam', mark: null, out_of: 1 });
  const p = await api.patch('assessments', a.id, { mark: 0.8 });
  assert.equal(p.mark, 0.8); assert.equal(p.version, 2);
  assert.equal(saved().assessments[0].mark, 0.8, 'written to localStorage');
  await api.remove('courses', c.id);
  assert.equal((await api.all()).courses.length, 0, 'deleted rows are hidden');
  assert.equal((await api.deleted()).courses.length, 1, 'and listed in Recently deleted');
  await api.restore('courses', c.id);
  assert.equal((await api.all()).courses.length, 1);
  const { entries } = await api.audit({ course_id: c.id });
  assert.deepEqual(entries.map((e) => `${e.action} ${e.entity}`),
    ['restore courses', 'delete courses', 'update assessments', 'create assessments', 'create components', 'create courses']);
});

test('store: ids keep counting after a reload; settings saved', async () => {
  await api.replace(emptyDoc());
  const t1 = await api.create('terms', { name: 'X' });
  const raw = saved();
  const again = normalize(raw);
  assert.ok(again.next_id > t1.id);
  const st = await api.settings({ gpa_scale: 'gpa4' });
  assert.equal(st.gpa_scale, 'gpa4'); assert.equal(st.repeat_policy_default, 'best', 'default repeat policy is best');
});

test('store: a full browser storage gives a clear error, nothing silently lost', async () => {
  await api.replace(emptyDoc());
  globalThis.__full = true;
  try {
    await assert.rejects(api.create('terms', { name: 'Y' }), /storage is full/);
  } finally { globalThis.__full = false; }
});

test('store: normalize survives garbage', () => {
  assert.deepEqual(normalize(null).terms, []);
  assert.deepEqual(normalize({ terms: 'x', courses: [null, 5, { id: 'nope' }] }).courses, []);
  assert.equal(normalize({ settings: { gpa_scale: 'gpa12' } }).settings.default_credits, 3);
});

test('demo: only made-up DEMO-xxxx codes, and every field is a known one', () => {
  const d = demoDoc();
  for (const c of d.courses) assert.match(c.code, /^DEMO-\d{4}$/);
  for (const e of Object.keys(FIELDS)) {
    for (const r of d[e]) for (const k of Object.keys(r)) assert.ok(k === 'id' || k in FIELDS[e], `${e}.${k}`);
  }
});

test('demo: computes cleanly (weights 100, no nesting warnings) and shows the features', () => {
  const r = computeAll(normalize(demoDoc()));
  for (const [, cr] of r.courses) {
    assert.ok(cr.result.warnings.every((w) => w.type === 'min'), `${cr.course.code}: ${JSON.stringify(cr.result.warnings)}`);
  }
  assert.ok([...r.courses.values()].some((cr) => cr.repeat), 'a repeated course');
  assert.ok([...r.courses.values()].some((cr) => cr.course.type === 'pass_fail'), 'pass/fail');
  assert.ok([...r.courses.values()].some((cr) => cr.result.overridden), 'a set final grade');
  assert.ok([...r.itemsByComp.values()].flat().some((a) => a.estimated), 'a letter-only mark');
  assert.deepEqual(r.yearList, [1, 2]);
  assert.ok(r.cumulative.average > 0.5 && r.cumulative.average < 1);
});

test('store hardening (AuthGuard): no prototype keys, types coerced, ids safe, settings whitelisted', async () => {
  await api.replace(emptyDoc());
  const t = await api.create('terms', JSON.parse('{"name":"T","__proto__":{"polluted":1},"constructor":"x"}'));
  assert.equal(Object.getPrototypeOf(t), Object.prototype); assert.equal(({}).polluted, undefined);
  const p = await api.patch('terms', t.id, JSON.parse('{"__proto__":{"bad":1},"name":{"x":1}}'));
  assert.equal(Object.getPrototypeOf(p), Object.prototype); assert.equal(p.name, '', 'an object name becomes the default text');
  const d = normalize({ next_id: 1e300, terms: [{ id: 1.5, name: 'a' }, { id: -1, name: 'b' }, { id: 7, name: 5 }, { id: 7, name: 'dup' }],
    settings: { gpa_scale: 'constructor', junk: 1, default_credits: 'lots' }, audit: [{ action: 'evil', before: { name: 'x', zzz: 1 }, entity: 'terms' }] });
  assert.deepEqual(d.terms.map((x) => [x.id, x.name]), [[7, '5']]);
  assert.equal(d.next_id, 8);
  assert.equal('junk' in d.settings, false); assert.equal(d.settings.default_credits, 3);
  assert.equal(computeAll({ ...d, settings: d.settings }).scale.id, 'uwindsor', 'an inherited key never picks a scale');
  assert.equal(d.audit[0].action, 'update'); assert.equal('zzz' in d.audit[0].before, false);
  await api.settings({ gpa_scale: 'gpa4', evil: true });
  assert.equal('evil' in saved().settings, false);
});

// ---------------------------------------------------------------- AuthGuard, Round 3: another tab, undo replays
const otherTab = (fn) => { const d = JSON.parse(mem.get('gc-gradebook')); fn(d); mem.set('gc-gradebook', JSON.stringify(d)); };

test('store (AuthGuard): a write from a stale copy never overwrites another tab’s save (missed storage event)', async () => {
  const { onExternalChange } = await import('../site/js/store.js');
  await api.replace(emptyDoc());
  const t = await api.create('terms', { name: 'Made-up term' });
  let told = 0;
  onExternalChange(() => { told++; });
  for (const write of [() => api.patch('terms', t.id, { name: 'Stale edit' }), () => api.create('terms', { name: 'Z' }),
    () => api.remove('terms', t.id), () => api.restore('terms', t.id), () => api.settings({ default_credits: 5 })]) {
    otherTab((d) => { d.terms[0].name = 'Renamed in the other tab'; d.audit.push({ action: 'update', entity: 'terms' }); });
    await assert.rejects(write(), (e) => e.status === 409 && /another tab/.test(e.message));
    assert.equal(saved().terms[0].name, 'Renamed in the other tab', 'the other tab’s save is kept');
    assert.equal(saved().terms.length, 1); assert.equal(saved().terms[0].deleted_at, null); assert.equal(saved().settings.default_credits, 3);
  }
  assert.ok(told >= 5, 'the page is told to reload (and drop its undo history)');
  assert.equal((await api.all()).terms[0].name, 'Renamed in the other tab', 'this tab now shows the other tab’s version');
  const p = await api.patch('terms', t.id, { name: 'Now fine' });
  assert.equal(p.name, 'Now fine', 'the next write (from the fresh copy) works');
});

test('store (AuthGuard): undo / redo replays on missing, deleted or purged rows fail cleanly, never invent rows', async () => {
  await api.replace(emptyDoc());
  const t = await api.create('terms', { name: 'T' });
  await api.remove('terms', t.id);
  const again = await api.patch('terms', t.id, { name: 'patched while deleted' }); // undo of an edit after a delete: allowed, stays deleted
  assert.ok(again.deleted_at, 'a patch never un-deletes');
  const before = JSON.stringify(saved());
  for (const op of [() => api.patch('terms', 999, { name: 'x' }), () => api.remove('courses', 999), () => api.restore('assessments', 999),
    () => api.patch('nope', t.id, {}), () => api.patch('__proto__', t.id, {}), () => api.restore('constructor', 1)]) {
    await assert.rejects(op(), (e) => e.status === 404);
  }
  assert.equal(JSON.stringify(saved()), before, 'a failed replay writes nothing');
  // Purged (gone for good after 30 days) behaves the same as missing.
  otherTab((d) => { d.terms = []; });
  await assert.rejects(api.restore('terms', t.id), (e) => e.status === 409);
  await assert.rejects(api.restore('terms', t.id), (e) => e.status === 404);
  assert.equal(saved().terms.length, 0);
});

test('store (AuthGuard): history entries keep only known kinds; settings entries are whitelisted settings', () => {
  const d = normalize({ audit: [
    { action: 'update', entity: 'constructor', before: { name: 'x' } },
    { action: 'update', entity: '<img src=x onerror=alert(1)>', after: { name: 'y' } },
    { action: 'update', entity: 'settings', before: { gpa_scale: 'gpa4', evil: 1 }, after: { gpa_scale: '<b>', default_credits: 1e9 } },
  ] });
  assert.deepEqual(d.audit.map((a) => a.entity), ['', '', 'settings']);
  assert.equal(d.audit[0].before, null); assert.equal(d.audit[1].after, null);
  assert.equal('evil' in d.audit[2].before, false);
  assert.equal(d.audit[2].after.gpa_scale, 'uwindsor'); assert.equal(d.audit[2].after.default_credits, 3);
});
