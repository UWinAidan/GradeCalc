// CalcCheck, Round 4 (files): every round trip keeps every grade and every mark. Made-up data only (DEMO-xxxx codes).
// JSON backup, Excel (incl. a real .xlsx through the vendored SheetJS), CSV, course templates, appendDoc, and the
// cumulative ⓘ wording. Expected values are worked out by hand in the comments where a number is asserted.
import { readFileSync } from 'node:fs';
import { assert, near } from './helpers.js';
import { build } from '../scripts/build.mjs';
import { computeAll } from '../shared/calc.js';

build();
globalThis.document ??= { getElementById: () => null };
const F = await import('../site/js/files.js');
const { normalize, ENTITIES } = await import('../site/js/store.js');
const { liveDoc, remapRefs } = await import('../site/js/structure.js');
const XLSX = {};
new Function('exports', readFileSync(new URL('../site/vendor/sheetjs-0.20.3/xlsx.mini.min.js', import.meta.url), 'utf8'))(XLSX);

const clone = (x) => JSON.parse(JSON.stringify(x));
/** What the page computes: deleted rows out, then liveDoc (hides rows under deleted parents), then calc. */
const pageView = (d) => liveDoc({ ...d, terms: d.terms.filter((r) => !r.deleted_at), courses: d.courses.filter((r) => !r.deleted_at),
  components: d.components.filter((r) => !r.deleted_at), assessments: d.assessments.filter((r) => !r.deleted_at),
  repeats: (d.repeats || []).filter((r) => !r.deleted_at) });
const calcOf = (d) => computeAll(pageView(d));

/** Every number a student sees, per course id: so far, average, projected, GPA, letters, repeat flags; plus terms,
 * years and the cumulative. `mapId` maps the original course / term ids to the ids in the other document. */
function sameGrades(a, b, { mapCourse = (id) => id, mapTerm = (id) => id, whole = true, only = null } = {}) {
  const x = calcOf(a), y = calcOf(b);
  for (const [id, r] of x.courses) {
    if (only && !only.includes(id)) continue;
    const s = y.courses.get(mapCourse(id));
    assert.ok(s, `course ${id} missing after the round trip`);
    for (const v of ['soFar', 'average']) near(s.result[v], r.result[v], `course ${id} ${v}`, 1e-12);
    near(s.projected, r.projected, `course ${id} projected`, 1e-12);
    assert.deepEqual(s.gpa, r.gpa, `course ${id} gpa`);
    assert.deepEqual(s.letter, r.letter, `course ${id} letter`);
    assert.equal(s.counts, r.counts, `course ${id} counts`);
    assert.deepEqual(s.repeat?.excluded ?? null, r.repeat?.excluded ?? null, `course ${id} repeat`);
    assert.equal(s.repeat?.policy ?? null, r.repeat?.policy ?? null, `course ${id} repeat policy`);
  }
  if (!whole) return;
  for (const [id, t] of x.terms) closeTo(y.terms.get(mapTerm(id)), t, `term ${id}`);
  closeTo([...y.years], [...x.years], 'years');
  closeTo([...y.cumulativeTo], [...x.cumulativeTo], 'cumulative to year');
  closeTo(y.cumulative, x.cumulative, 'cumulative');
}
/** Deep equal, numbers within 1e-12 (rows in another order add up in another order: last-bit differences only). */
function closeTo(a, b, msg) {
  if (typeof b === 'number' && typeof a === 'number') return near(a, b, msg, 1e-12);
  if (b === null || typeof b !== 'object') return assert.equal(a, b, msg);
  assert.ok(a && typeof a === 'object', `${msg}: missing`);
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), msg);
  for (const k of Object.keys(b)) closeTo(a[k], b[k], `${msg}.${k}`);
}

/** Write sheets to a real .xlsx and read them back exactly as the page does (readImport in app.js). */
function viaXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const back = XLSX.read(bytes, { type: 'array', cellDates: true, dense: true });
  return Object.fromEntries(back.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(back.Sheets[n], { header: 1, raw: true, defval: null })]));
}

// ---------------------------------------------------------------- one made-up gradebook with every feature
function richDoc() {
  const del = '2026-10-01T00:00:00.000Z';
  const T = (id, name, yos, sort, extra = {}) => ({ id, name, season: null, year: null, year_of_study: yos, sort_order: sort, ...extra });
  const C = (id, term_id, code, extra = {}) => ({ id, term_id, code, title: `Made-up ${code}`, credits: 3, type: 'graded', sort_order: id, ...extra });
  const K = (id, course_id, name, weight, extra = {}) => ({ id, course_id, name, weight, sort_order: id, ...extra });
  const A = (id, component_id, mark, extra = {}) => ({ id, component_id, name: `Item ${id}`, mark, out_of: 1, sort_order: id, ...extra });
  return normalize({
    next_id: 9000,
    terms: [T(1, 'Made-up Fall 2024', 1, 1), T(2, 'Made-up Winter 2025', 1, 2, { archived: 1 }), T(3, 'Made-up Fall 2025', 2, 3),
      T(4, 'Made-up deleted term', 2, 4, { deleted_at: del }), T(5, 'Made-up no-year term', null, 5)],
    courses: [
      C(10, 1, 'DEMO-1010', { curve: { type: 'add', value: 2 }, cap_100: 1 }),
      C(11, 1, 'DEMO-1020', { credits: 6 }),
      C(12, 1, 'DEMO-1100', { type: 'pass_fail', pass_result: 'pass', credits: 1 }),
      C(13, 1, 'DEMO-1200', { type: 'transfer' }),
      C(14, 1, 'DEMO-1300', { type: 'withdrawn' }),
      C(20, 2, 'DEMO-1010', { final_override: 0.8125, status: 'complete', notes: 'made-up note, with a comma' }),
      C(21, 2, 'DEMO-2200', { final_letter: 'A-' }),
      C(22, 2, 'DEMO-2300'),
      C(30, 3, 'DEMO-2200'),
      C(31, 3, 'DEMO-3100'),
      C(32, 3, 'DEMO-3200', { curve: { type: 'set', value: 0.77 } }),
      C(33, 3, 'DEMO-1020', { credits: 6, curve: { type: 'mul', value: 1.1 } }),
      C(34, 3, 'DEMO-3400', { deleted_at: del }),
      C(40, 4, 'DEMO-9999'),
      C(50, 5, 'DEMO-5000', { credits: 0.5 }),
    ],
    components: [
      K(100, 10, 'Quizzes', 20, { drop_so_far: 1, drop_average: 1 }),
      K(101, 10, 'Midterm', 30),
      K(102, 10, 'Final', 50, { rule: { type: 'absorb_if_higher', from: [101] } }),
      K(103, 10, 'Bonus', 2, { is_bonus: 1 }),
      K(104, 10, 'Old group (deleted)', 0, { deleted_at: del }),
      K(105, 10, 'Part of the deleted group', 1, { parent_id: 104 }),
      K(110, 11, 'Labs', 40, { rule: { type: 'min_warning', min: 0.5, label: 'Labs min 50%' } }),
      K(111, 11, 'Reports', 2, { parent_id: 110, aggregation: 'weighted' }),
      K(112, 11, 'Lab quizzes', 1, { parent_id: 110 }),
      K(113, 11, 'Midterm', 25, { excused_to: { by_date: { pivot: 115, before: 114, after: 115 } } }),
      K(114, 11, 'Assignments', 15, { excused_to: { to: 115 } }),
      K(115, 11, 'Final exam', 20, { rule: { type: 'absorb_if_higher', from: [110] } }),
      K(200, 20, 'Exam', 100),
      K(210, 21, 'Exam', 100),
      K(220, 22, 'Work', 50, { projected: 0.7735 }),
      K(221, 22, 'Exam', 50),
      K(222, 22, 'Extra', 10),
      K(300, 30, 'Exam', 100),
      K(310, 31, 'Exam', 100),
      K(320, 32, 'Tests', 100, { drop_so_far: 1, drop_average: 1, aggregation: 'mean' }),
      K(330, 33, 'Exam', 100),
      K(340, 34, 'Exam', 100),
      K(400, 40, 'Exam', 100),
      K(500, 50, 'Exam', 100),
    ],
    assessments: [
      A(1000, 100, 0.7), A(1001, 100, 0), A(1002, 100, null), A(1003, 100, 0.123457),
      A(1004, 100, 0.5, { excused: 1 }), A(1005, 100, 0.01, { deleted_at: del }),
      A(1010, 101, 17.5, { out_of: 20, curve: { type: 'add', value: 1 } }),
      A(1020, 102, null, { letter: 'B+' }),
      A(1030, 103, 0.9),
      A(1050, 105, 0.1),
      A(1110, 111, 18, { out_of: 20 }), A(1111, 111, 0.835, { item_weight: 2 }), A(1112, 111, 0.1, { counts_in: 'none' }),
      A(1120, 112, 0.6, { counts_in: 'so_far' }), A(1121, 112, 0.9, { counts_in: 'average' }), A(1122, 112, null, { projected: 0.65 }),
      A(1130, 113, null, { excused: 1, date: '2025-02-10' }), A(1131, 113, 0.72, { date: '2025-03-01' }),
      A(1140, 114, 0.8, { date: '2025-01-20' }), A(1141, 114, 0.666667), A(1142, 114, null, { excused: 1, date: '2025-03-20' }),
      A(1150, 115, 0.75, { date: '2025-03-15' }), A(1151, 115, null, { projected: 0.8, item_weight: 0.5 }),
      A(2000, 200, 0.6),
      A(2100, 210, 0.5),
      A(2210, 221, 0.81, { curve: { type: 'mul', value: 1.05 } }), A(2220, 222, 0.07),
      A(3000, 300, 0.91),
      A(3100, 310, null),
      A(3200, 320, 0.5), A(3201, 320, 0.45), A(3202, 320, 0.999999),
      A(3300, 330, 0.55),
      A(3400, 340, 0.99),
      A(4000, 400, 0.99),
      A(5000, 500, 437, { out_of: 500 }),
    ],
    repeats: [{ id: 5001, course_ids: [10, 20], policy: null }, { id: 5002, course_ids: [21, 30], policy: 'best' },
      { id: 5003, course_ids: [11, 33], policy: 'latest' }, { id: 5004, course_ids: [13, 14], policy: 'all', deleted_at: del }],
    settings: { gpa_scale: 'custom', repeat_policy_default: 'latest', default_credits: 3,
      custom_scale: { name: 'Custom', kind: 'points', max: 4, bands: [{ min: 0.85, letter: 'A', points: 4 }, { min: 0.7, letter: 'B', points: 3 },
        { min: 0.5, letter: 'C', points: 2 }, { min: 0, letter: 'F', points: 0 }] } },
  });
}

/** The fields of every live (visible) row that matter, by id. */
const ROW_KEYS = {
  terms: ['name', 'year_of_study', 'archived'],
  courses: ['term_id', 'code', 'title', 'credits', 'type', 'pass_result', 'status', 'curve', 'cap_100', 'final_override', 'final_letter', 'notes'],
  components: ['course_id', 'parent_id', 'name', 'weight', 'is_bonus', 'drop_so_far', 'drop_average', 'aggregation', 'projected', 'rule', 'excused_to'],
  assessments: ['component_id', 'name', 'mark', 'out_of', 'letter', 'item_weight', 'counts_in', 'excused', 'curve', 'projected', 'date'],
};
const rowsOf = (d) => {
  const v = pageView(d);
  return Object.fromEntries(Object.entries(ROW_KEYS).map(([e, keys]) => [e,
    Object.fromEntries(v[e].map((r) => [r.id, Object.fromEntries(keys.map((k) => [k, r[k] ?? null]))]))]));
};

test('anchor: hand-worked grades of the made-up gradebook', () => {
  const c = calcOf(richDoc());
  // DEMO-1010 (id 10) average, marked items only:
  //   Quizzes 20%: 0.7, 0 (a real zero), blank, 0.123457, excused 0.5 (left out); drop lowest (0) → (0.7 + 0.123457)/2 = 0.4117285
  //   Midterm 30%: (17.5 + 1 curve) / 20 = 0.925.  Final 50%: B+ only = 0.78 (estimate); 0.78 < 0.925 → no absorb.
  //   (20×0.4117285 + 30×0.925 + 50×0.78)/100 = (8.23457 + 27.75 + 39)/100 = 0.7498457
  //   + bonus 2% × 0.9 = 0.018 → 0.7678457; course curve +2 points → 0.7878457 (cap 100% not reached)
  near(c.courses.get(10).result.average, 0.7878457, 'DEMO-1010', 1e-12);
  near(c.courses.get(20).result.average, 0.8125, 'final grade set: 81.25%');
  near(c.courses.get(30).result.average, 0.91, 'DEMO-2200 retake');
  // DEMO-5000: 437 / 500 = 0.874 (points)
  near(c.courses.get(50).result.average, 0.874, 'points');
  // The deleted group's live part (105) and the course under the deleted term (40) don't show anywhere.
  assert.ok(!c.courses.has(40) && !c.courses.has(34));
  assert.ok(!c.compsByCourse.get(10).some((k) => k.id === 105));
});

// ---------------------------------------------------------------- JSON backup
test('JSON backup → restore: the same document (deleted rows, history, settings) and the same grades', () => {
  const d = richDoc();
  d.audit.push({ at: '2026-01-01T00:00:00.000Z', action: 'update', entity: 'assessments', entity_id: 1000, course_id: 10,
    before: { id: 1000, mark: 0.6 }, after: { id: 1000, mark: 0.7 } });
  const text = JSON.stringify(F.backupFile(d), null, 1);
  const back = F.readJson(JSON.parse(text)).doc;
  assert.deepEqual(back, normalize(d));
  sameGrades(d, back);
  // A restored backup restores again to the same thing (idempotent).
  assert.deepEqual(F.readJson(JSON.parse(JSON.stringify(F.backupFile(back)))).doc, back);
});

// ---------------------------------------------------------------- Excel
test('Excel → real .xlsx → import: every visible row, mark and grade identical (ids kept)', () => {
  const d = richDoc();
  const back = F.fromSheets(viaXlsx(F.toSheets(d)));
  assert.deepEqual(rowsOf(back), rowsOf(d));
  assert.deepEqual(back.settings, d.settings, 'settings incl. custom_scale');
  assert.deepEqual(pageView(back).repeats.map((g) => [g.id, g.course_ids, g.policy]), pageView(d).repeats.map((g) => [g.id, g.course_ids, g.policy]));
  sameGrades(d, back);
  // And a second trip changes nothing more.
  assert.deepEqual(rowsOf(F.fromSheets(viaXlsx(F.toSheets(back)))), rowsOf(back));
});

test('Excel: an item counted in neither view ("none") stays "none" (regression)', () => {
  // Reports (weighted by item weight): 18/20 = 0.9 (weight 1), 0.835 (item weight 2), 0.1 counted nowhere.
  // Reports average = (0.9 + 2×0.835)/3 = 2.57/3 = 0.856667; with the 0.1 counted it would be (0.9+1.67+0.1)/4 = 0.6675.
  const d = richDoc();
  const back = F.fromSheets(F.toSheets(d));
  assert.equal(back.assessments.find((a) => a.id === 1112).counts_in, 'none');
  near(calcOf(back).courses.get(11).result.components.get(111).average, 2.57 / 3, 'Reports', 1e-12);
});

test('Excel: ×100 / ÷100 is exact for every mark with up to 6 decimals (0% to 500%)', () => {
  // Marks typed in the page are rounded to 6 decimals (parseMark); final grades and projections to 6 (pctField).
  // export: r10(m × 100); import: r10(cell ÷ 100). Checked for every k/1e6, k = 0 … 5,000,000.
  const r10 = (x) => Math.round(x * 1e10) / 1e10;
  let bad = 0;
  for (let k = 0; k <= 5e6; k++) { const m = k / 1e6; if (r10(r10(m * 100) / 100) !== m) bad++; }
  assert.equal(bad, 0);
  // Through the real functions and a real .xlsx with awkward values (0.07 × 100 = 7.000000000000001 in floating point).
  const marks = [0.07, 0.29, 0.57, 0.123457, 0.999999, 1.15, 0.000001, 4.999999];
  const d = normalize({ terms: [{ id: 1, name: 'T' }], courses: [{ id: 2, term_id: 1, code: 'DEMO-7000', title: 'P', final_override: 0.070001 }],
    components: [{ id: 3, course_id: 2, name: 'K', weight: 100, projected: 0.29 }],
    assessments: marks.map((m, i) => ({ id: 10 + i, component_id: 3, name: `Q${i}`, mark: m, out_of: 1, projected: m, sort_order: i })) });
  const back = F.fromSheets(viaXlsx(F.toSheets(d)));
  assert.deepEqual(back.assessments.map((a) => [a.mark, a.projected]), marks.map((m) => [m, m]));
  assert.equal(back.courses[0].final_override, 0.070001);
  assert.equal(back.components[0].projected, 0.29);
  // The sheet shows people-friendly percents: 7, not 7.000000000000001.
  assert.equal(F.toSheets(d).Items[1][5], 7);
});

test('Excel: units — Mark/Final grade %/Projected % are percents, points marks stay points', () => {
  const s = F.toSheets(richDoc());
  const col = (sheet, name) => s[sheet][0].indexOf(name);
  const item = (id) => s.Items.find((r) => r[0] === id);
  assert.deepEqual([item(1000)[col('Items', 'Mark')], item(1000)[col('Items', 'Out of')]], [70, '%']); // 0.7 → 70 %
  assert.deepEqual([item(1001)[col('Items', 'Mark')], item(1001)[col('Items', 'Out of')]], [0, '%'], 'a real zero is 0, not blank');
  assert.deepEqual([item(1002)[col('Items', 'Mark')], item(1002)[col('Items', 'Out of')]], ['', '%'], 'blank stays blank');
  assert.deepEqual([item(1010)[col('Items', 'Mark')], item(1010)[col('Items', 'Out of')]], [17.5, 20]); // points
  assert.deepEqual([item(1020)[col('Items', 'Mark')], item(1020)[col('Items', 'Letter')]], ['', 'B+'], 'letter only');
  assert.equal(item(1151)[col('Items', 'Projected %')], 80); // 0.8 → 80
  assert.equal(item(1151)[col('Items', 'Item weight')], 0.5);
  assert.equal(s.Courses.find((r) => r[0] === 20)[col('Courses', 'Final grade %')], 81.25); // 0.8125 → 81.25
  assert.equal(s.Components.find((r) => r[0] === 220)[col('Components', 'Projected %')], 77.35); // 0.7735 → 77.35
  // A real zero and a blank are different after import: the zero counts, the blank doesn't.
  const back = F.fromSheets(s);
  assert.equal(back.assessments.find((a) => a.id === 1001).mark, 0);
  assert.equal(back.assessments.find((a) => a.id === 1002).mark, null);
});

test('Excel: rows under a deleted parent and deleted rows are left out; ids that stay are unique', () => {
  const s = F.toSheets(richDoc());
  const ids = (sheet) => s[sheet].slice(1).map((r) => r[0]);
  assert.ok(!ids('Courses').includes(40) && !ids('Courses').includes(34));
  assert.ok(!ids('Components').includes(104) && !ids('Components').includes(105));
  assert.ok(!ids('Items').includes(1005) && !ids('Items').includes(1050) && !ids('Items').includes(4000));
  assert.ok(!ids('Repeats').includes(5004));
});

test('Excel: a component whose Parent id makes a loop is refused (it would vanish on the next export)', () => {
  const s = F.toSheets(richDoc());
  const pc = s.Components[0].indexOf('Parent id');
  const row = s.Components.find((r) => r[0] === 111);
  row[pc] = 111; // itself
  assert.throws(() => F.fromSheets(clone(s)), /Components row \d+: .*loop|own group|itself/i);
  row[pc] = 112; s.Components.find((r) => r[0] === 112)[pc] = 111; // 111 → 112 → 111
  assert.throws(() => F.fromSheets(s), /loop/i);
});

test('Excel: a loop already in a backup is exported as top-level (as calc counts it), not left out', () => {
  // Two parts pointing at each other: calc warns and counts both as top-level (weights 30 + 70, marks 0.6 and 0.8):
  // (30×0.6 + 70×0.8)/100 = (18 + 56)/100 = 0.74. Before the fix both vanished from the sheet (no grade at all).
  const d = normalize({ terms: [{ id: 1, name: 'T' }], courses: [{ id: 2, term_id: 1, code: 'DEMO-7100', title: 'L' }],
    components: [{ id: 3, course_id: 2, name: 'A', weight: 30, parent_id: 4 }, { id: 4, course_id: 2, name: 'B', weight: 70, parent_id: 3 }],
    assessments: [{ id: 5, component_id: 3, name: 'a', mark: 0.6 }, { id: 6, component_id: 4, name: 'b', mark: 0.8 }] });
  near(calcOf(d).courses.get(2).result.average, 0.74, 'before');
  const back = F.fromSheets(viaXlsx(F.toSheets(d)));
  near(calcOf(back).courses.get(2).result.average, 0.74, 'after');
  assert.deepEqual(back.components.map((k) => k.parent_id), [null, null]);
});

test('Excel: new rows without ids matched by name; a blank course name is an error, not a guess', () => {
  const base = () => ({
    Terms: [['Id', 'Name'], [1, 'Made-up Term']],
    Courses: [['Id', 'Term id', 'Term', 'Code', 'Title'], [2, 1, '', '', 'Made-up no-code course'], [3, 1, '', 'DEMO-8100', 'Made-up coded']],
    Components: [['Id', 'Course id', 'Course', 'Name', 'Weight %'], [4, 2, '', 'Exam', 100], [5, 3, '', 'Exam', 100]],
    Items: [['Id', 'Component id', 'Course', 'Component', 'Name', 'Mark', 'Out of'], [6, 4, '', '', 'E1', 70, '%']],
  });
  // An item named by course + component, no ids.
  let s = base(); s.Items.push([null, null, 'demo-8100', 'exam', 'E2', 17, 20]);
  let d = F.fromSheets(s);
  const e2 = d.assessments.find((a) => a.name === 'E2');
  assert.equal(e2.component_id, 5);
  assert.deepEqual([e2.mark, e2.out_of], [17, 20]);
  assert.ok(e2.id > 6, 'a new id after every given id');
  // Blank Course and blank Component id: must not land in the course that has no code.
  s = base(); s.Items.push([null, null, '', 'Exam', 'E3', 50, '%']);
  assert.throws(() => F.fromSheets(s), /Items row 3: .*course/i);
  s = base(); s.Components.push([null, null, '', 'Quiz', 10]);
  assert.throws(() => F.fromSheets(s), /Components row 4: .*course/i);
  // Two terms with the same name and a new course naming that term: ambiguous → error.
  s = base(); s.Terms.push([9, 'made-up term']); s.Courses.push([null, null, 'Made-up Term', 'DEMO-8200', 'X']);
  assert.throws(() => F.fromSheets(s), /more than one term/i);
  // Ids that collide across sheets are refused.
  s = base(); s.Items[1][0] = 2;
  assert.throws(() => F.fromSheets(s), /Id 2 is used twice/);
});

test('Excel: letters must be ones the math knows (E is not a grade); Final letter checked too', () => {
  const s = { Terms: [['Id', 'Name'], [1, 'T']], Courses: [['Id', 'Term id', 'Title', 'Final letter'], [2, 1, 'C', '']],
    Components: [['Id', 'Course id', 'Name', 'Weight %'], [3, 2, 'K', 100]], Items: [['Id', 'Component id', 'Name', 'Mark', 'Out of', 'Letter'], [4, 3, 'I', null, '%', 'b+']] };
  assert.equal(F.fromSheets(s).assessments[0].letter, 'B+');
  for (const bad of ['E', 'F+', 'F-', 'A++']) {
    const x = clone(s); x.Items[1][5] = bad;
    assert.throws(() => F.fromSheets(x), /Items row 2: letters are A\+ to D-, or F/, bad);
  }
  const y = clone(s); y.Courses[1][3] = 'Q';
  assert.throws(() => F.fromSheets(y), /Courses row 2: .*letter/i);
  y.Courses[1][3] = 'a-';
  assert.equal(F.fromSheets(y).courses[0].final_letter, 'A-');
});

test('Excel: a date Excel turned into a date cell keeps its day in every time zone', () => {
  // SheetJS gives a date cell as local midnight. East of UTC that is the day before in UTC; the import must use the
  // local calendar day (the same day the student typed). A time a moment before midnight is that midnight.
  const tz = process.env.TZ;
  for (const zone of ['Asia/Tokyo', 'America/Toronto', 'Pacific/Kiritimati', 'UTC']) {
    process.env.TZ = zone;
    const s = { Terms: [['Id', 'Name'], [1, 'T']], Courses: [['Id', 'Term id', 'Title'], [2, 1, 'C']],
    Components: [['Id', 'Course id', 'Name', 'Weight %'], [3, 2, 'K', 100]],
    Items: [['Id', 'Component id', 'Name', 'Mark', 'Out of', 'Date'], [4, 3, 'I', 50, '%', new Date(2025, 1, 10)], [5, 3, 'J', 50, '%', new Date(2025, 1, 10, 23, 59, 59, 600)]] };
    const d = F.fromSheets(s);
    assert.deepEqual(d.assessments.map((a) => a.date), ['2025-02-10', '2025-02-11'], zone);
  }
  if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
});

test('Excel: sort orders with gaps come back in the same order (grades of "latest" and drop ties unchanged)', () => {
  const d = richDoc();
  for (const e of ['terms', 'courses', 'components', 'assessments']) d[e].forEach((r, i) => { r.sort_order = (d[e].length - i) * 7; });
  const back = F.fromSheets(viaXlsx(F.toSheets(d)));
  sameGrades(d, back);
  const order = (doc, e, key, parent) => pageView(doc)[e].filter((r) => r[key] === parent).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).map((r) => r.id);
  assert.deepEqual(order(back, 'courses', 'term_id', 3), order(d, 'courses', 'term_id', 3));
  assert.deepEqual(order(back, 'assessments', 'component_id', 100), order(d, 'assessments', 'component_id', 100));
});

// ---------------------------------------------------------------- CSV
test('CSV → import: marks, letters, dates, excused, weights, credits and years come back; plain courses same grade', () => {
  const d = richDoc();
  const back = F.fromMarksTable(F.parseCsv(F.toCsv(F.marksTable(d))));
  const key = (doc, a) => {
    const v = pageView(doc);
    let k = v.components.find((x) => x.id === a.component_id);
    const c = v.courses.find((x) => x.id === k.course_id);
    const t = v.terms.find((x) => x.id === c.term_id);
    const names = [k.name];
    while (k.parent_id) { k = v.components.find((x) => x.id === k.parent_id); names.unshift(k.name); }
    return `${t.name}|${c.code}|${names.join('›')}|${a.name}`;
  };
  const marks = (doc) => Object.fromEntries(pageView(doc).assessments.map((a) => [key(doc, a), [a.mark, a.out_of, a.letter, a.date, a.excused]]));
  assert.deepEqual(marks(back), marks(d));
  const twin = (c) => back.courses.find((x) => x.code === c.code && back.terms.find((t) => t.id === x.term_id).name === d.terms.find((t) => t.id === c.term_id).name);
  for (const c of pageView(d).courses) {
    const b = twin(c);
    assert.equal(b.credits, c.credits, `${c.code} credits`);
    assert.equal(back.terms.find((t) => t.id === b.term_id).year_of_study, d.terms.find((t) => t.id === c.term_id).year_of_study);
  }
  // What a CSV carries is enough for courses without rules, drops, curves, groups, bonus, item weights or a set grade.
  // DEMO-3100 (no marks), DEMO-2300 has a curve: not plain. DEMO-5000: 437/500 = 0.874.
  const cb = calcOf(back);
  near(cb.courses.get(twin(d.courses.find((c) => c.id === 50)).id).result.average, 0.874, 'DEMO-5000 via CSV');
  assert.equal(cb.courses.get(twin(d.courses.find((c) => c.id === 31)).id).result.average, null, 'no marks yet → none');
});

// ---------------------------------------------------------------- course templates
/** What app.js createFromPlan does for a template (sameCourse = false): new ids, parents, then rules re-pointed. */
function applyTemplate(doc, { course, plan }, termId) {
  const d = clone(doc);
  let id = d.next_id;
  const row = { ...course, id: id++, term_id: termId, status: 'active', sort_order: 99 };
  d.courses.push(row);
  const idMap = new Map(), made = [];
  for (const p of plan) {
    const body = { ...p.body, course_id: row.id, parent_id: p.parentOld != null ? idMap.get(p.parentOld) ?? null : null };
    const k = { id: id++, ...body };
    d.components.push(k);
    idMap.set(p.old, k.id);
    made.push(k);
    for (const it of p.items) d.assessments.push({ ...it, id: id++, component_id: k.id });
  }
  for (const k of made) Object.assign(k, remapRefs(k, idMap));
  d.next_id = id;
  return { doc: normalize(d), courseId: row.id, idMap };
}

test('Template → import: structure only (no marks), rules and excused targets point at the new components', () => {
  const d = richDoc();
  const comps = d.components.filter((k) => k.course_id === 11);
  const items = d.assessments.filter((a) => comps.some((k) => k.id === a.component_id));
  const file = JSON.parse(JSON.stringify(F.courseTemplate(d.courses.find((c) => c.id === 11), comps, items)));
  const { template } = F.readJson(file);
  const { doc: out, courseId, idMap } = applyTemplate(d, template, 3);
  const mine = out.components.filter((k) => k.course_id === courseId);
  assert.equal(mine.length, comps.length);
  const newItems = out.assessments.filter((a) => mine.some((k) => k.id === a.component_id));
  assert.equal(newItems.length, items.length);
  assert.ok(newItems.every((a) => a.mark === null && a.letter === null && a.excused === 0 && a.projected === null && a.date === null && a.curve === null), 'no marks');
  // Structure carried: item weights, counts in (incl. "none"), out of.
  const shape = (list) => list.map((a) => [a.name, a.out_of, a.item_weight, a.counts_in]).sort((p, q) => p[0].localeCompare(q[0]));
  assert.deepEqual(shape(newItems), shape(items));
  const by = (name) => mine.find((k) => k.name === name);
  assert.equal(by('Reports').parent_id, by('Labs').id);
  assert.deepEqual(by('Final exam').rule, { type: 'absorb_if_higher', from: [by('Labs').id] });
  assert.deepEqual(by('Assignments').excused_to, { to: by('Final exam').id });
  assert.deepEqual(by('Midterm').excused_to, { by_date: { pivot: by('Final exam').id, before: by('Assignments').id, after: by('Final exam').id } });
  assert.deepEqual(by('Labs').rule, { type: 'min_warning', min: 0.5, label: 'Labs min 50%' });
  // Nothing points back into the original course.
  const refs = (k) => [...(k.rule?.from || []), ...(k.excused_to?.to ? [k.excused_to.to] : []), ...Object.values(k.excused_to?.by_date || {})];
  for (const k of mine) for (const ref of refs(k)) assert.ok(mine.some((x) => x.id === ref), `${k.name} → ${ref}`);
  // Put the same marks back (item by item): the new course gets exactly the original grade.
  const back = clone(out);
  const oldToNew = new Map(items.map((a) => [a.id, newItems.find((x) => x.name === a.name).id]));
  for (const a of items) Object.assign(back.assessments.find((x) => x.id === oldToNew.get(a.id)), { mark: a.mark, letter: a.letter, excused: a.excused, projected: a.projected, date: a.date, curve: a.curve });
  const x = calcOf(d).courses.get(11), y = calcOf(back).courses.get(courseId);
  for (const v of ['soFar', 'average']) near(y.result[v], x.result[v], v, 1e-12);
  near(y.projected, x.projected, 'projected', 1e-12);
  assert.ok(idMap.size === comps.length);
});

test('Template file never contains marks, letters, excused, curves, dates, notes, final grade or term', () => {
  const d = richDoc();
  for (const id of [10, 11, 20, 21, 22]) {
    const comps = d.components.filter((k) => k.course_id === id);
    const items = d.assessments.filter((a) => comps.some((k) => k.id === a.component_id));
    const s = JSON.stringify(F.courseTemplate(d.courses.find((c) => c.id === id), comps, items));
    for (const k of ['"mark"', '"letter"', '"excused"', '"curve"', '"date"', '"notes"', '"final_override"', '"final_letter"', '"term_id"', '"projected"', '"pass_result"']) {
      assert.ok(!s.includes(k), `course ${id}: ${k}`);
    }
  }
});

// ---------------------------------------------------------------- appendDoc
/** Map the incoming document's live course / term ids to their copies in the merged document, by position. */
function copyMap(merged, base, incoming) {
  const key = (doc, c) => `${doc.terms.find((t) => t.id === c.term_id).name}|${c.code}|${c.title}`;
  const baseIds = new Set(base.courses.map((c) => c.id));
  const added = pageView(merged).courses.filter((c) => !baseIds.has(c.id));
  const courses = new Map(pageView(incoming).courses.map((c) => [c.id, added.find((x) => key(merged, x) === key(incoming, c)).id]));
  const baseT = new Set(base.terms.map((t) => t.id));
  const terms = new Map(pageView(incoming).terms.map((t) => [t.id, merged.terms.find((x) => !baseT.has(x.id) && x.name === t.name).id]));
  return { courses, terms };
}

test('appendDoc(base, file): both copies keep every grade; repeats, rules and excused_to by_date re-pointed', () => {
  const base = richDoc();
  const incoming = richDoc();
  for (const t of incoming.terms) t.name = `${t.name} (file)`;
  const m = F.appendDoc(base, incoming);
  // The base copy is untouched (same ids).
  sameGrades(base, m, { whole: false });
  const { courses } = copyMap(m, base, incoming);
  sameGrades(incoming, m, { mapCourse: (id) => courses.get(id), whole: false });
  // Ids unique, next_id above all.
  const ids = ENTITIES.flatMap((e) => m[e].map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(m.next_id > Math.max(...ids));
  // References inside the copy point inside the copy.
  const newComp = (old) => {
    const c = m.components.find((k) => k.course_id === courses.get(incoming.components.find((x) => x.id === old).course_id) && k.name === incoming.components.find((x) => x.id === old).name);
    return c.id;
  };
  const midterm = m.components.find((k) => k.id === newComp(113));
  assert.deepEqual(midterm.excused_to, { by_date: { pivot: newComp(115), before: newComp(114), after: newComp(115) } });
  assert.deepEqual(m.components.find((k) => k.id === newComp(115)).rule.from, [newComp(110)]);
  assert.deepEqual(m.components.find((k) => k.id === newComp(102)).rule.from, [newComp(101)]);
  const reps = m.repeats.filter((g) => !base.repeats.some((x) => x.id === g.id));
  assert.deepEqual(reps.map((g) => g.course_ids), [[courses.get(10), courses.get(20)], [courses.get(21), courses.get(30)], [courses.get(11), courses.get(33)]]);
});

test('appendDoc: a part of a deleted group stays hidden (it must not pop up as a top-level component)', () => {
  // Original DEMO-1010 average = 0.7878457 (hand-worked in the anchor test). If part 105 (0.1, weight 1) became a
  // top-level component, the course would weigh 101 and drop.
  const base = normalize({ terms: [{ id: 1, name: 'Mine' }] });
  const incoming = richDoc();
  const m = F.appendDoc(base, incoming);
  const { courses } = copyMap(m, base, incoming);
  near(calcOf(m).courses.get(courses.get(10)).result.average, 0.7878457, 'DEMO-1010 copy', 1e-12);
  assert.ok(!pageView(m).components.some((k) => k.name === 'Part of the deleted group'));
  // Nothing from under a deleted term either, and no row is left without a parent.
  assert.ok(!m.courses.some((c) => c.code === 'DEMO-9999'));
  for (const c of m.courses) assert.ok(m.terms.some((t) => t.id === c.term_id));
  for (const k of m.components) assert.ok(m.courses.some((c) => c.id === k.course_id));
  for (const a of m.assessments) assert.ok(m.components.some((k) => k.id === a.component_id));
});

test('appendDoc: the file\'s default repeat policy is kept for its own repeats when yours differs', () => {
  // File default: latest. Group 5001 (DEMO-1010: 20 has 81.25% set, 10 has 78.78%) has no policy of its own.
  // latest → attempt 20 counts, 10 doesn't. With the base default "best", 20 (0.8125) > 10 (0.7878) → the same here,
  // so make the first attempt higher to tell them apart: course 10 set to 90%.
  const incoming = richDoc();
  incoming.courses.find((c) => c.id === 10).final_override = 0.9;
  const base = normalize({ terms: [{ id: 1, name: 'Mine' }], settings: { repeat_policy_default: 'best' } });
  const m = F.appendDoc(base, incoming);
  const { courses } = copyMap(m, base, incoming);
  const cm = calcOf(m);
  assert.equal(cm.courses.get(courses.get(10)).repeat.excluded.average, true, 'latest: the first attempt (90%) does not count');
  assert.equal(cm.courses.get(courses.get(20)).repeat.excluded.average, false, 'latest: the retake (81.25%) counts');
  assert.equal(m.settings.repeat_policy_default, 'best', 'your settings stay yours');
});

test('appendDoc: ids that collide with yours are all renumbered; excused_to stored as JSON text is re-pointed too', () => {
  const mk = (code) => normalize({
    terms: [{ id: 1, name: `Term ${code}` }], courses: [{ id: 2, term_id: 1, code, title: code }],
    components: [{ id: 3, course_id: 2, name: 'Quizzes', weight: 40, excused_to: JSON.stringify({ to: 4 }) },
      { id: 4, course_id: 2, name: 'Final', weight: 60, rule: JSON.stringify({ type: 'absorb_if_higher', from: [3] }) }],
    // Quizzes: 0.6 and an excused one → excused share = 40 × 1/2 = 20 moves to Final.
    assessments: [{ id: 5, component_id: 3, name: 'Q1', mark: 0.6 }, { id: 6, component_id: 3, name: 'Q2', excused: 1 },
      { id: 7, component_id: 4, name: 'F', mark: 0.9 }],
  });
  const a = mk('DEMO-4100'), b = mk('DEMO-4200');
  // By hand: weights Quizzes 20, Final 80; Final 0.9 > Quizzes 0.6 → absorbs → Final 100 → 0.9.
  near(calcOf(a).courses.get(2).result.average, 0.9, 'hand-worked');
  const m = F.appendDoc(a, b);
  const course = m.courses.find((c) => c.code === 'DEMO-4200');
  const comps = m.components.filter((k) => k.course_id === course.id);
  const q = comps.find((k) => k.name === 'Quizzes'), f = comps.find((k) => k.name === 'Final');
  const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  assert.equal(parse(q.excused_to).to, f.id, 'excused_to re-pointed');
  assert.deepEqual(parse(f.rule).from, [q.id], 'rule re-pointed');
  near(calcOf(m).courses.get(course.id).result.average, 0.9, 'copy');
  near(calcOf(m).courses.get(2).result.average, 0.9, 'base');
});

test('appendDoc of the same document twice: both copies keep every grade (demo-sized)', () => {
  const d = richDoc();
  const m = F.appendDoc(d, d);
  sameGrades(d, m, { whole: false });
  const ids = ENTITIES.flatMap((e) => m[e].map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length);
  // Merged terms: the file's come after mine, in the file's order.
  const order = pageView(m).terms.map((t) => t.name);
  const one = pageView(d).terms.map((t) => t.name);
  assert.deepEqual(order, [...one, ...one]);
});

// ---------------------------------------------------------------- the cumulative ⓘ wording
test('ⓘ latest: the cumulative can be ABOVE every year average too (hand-worked)', () => {
  // Year 1: DEMO-1010 40%, DEMO-1020 100% → 70.  Year 2: DEMO-1010 retake 90%, DEMO-2010 60% → 75.
  // latest: the retake (90) counts, the first attempt doesn't → cumulative (100 + 90 + 60)/3 = 83.33 > 75 > 70.
  const one = (id, term_id, code, mark) => ({ course: { id, term_id, code, title: code, credits: 3 },
    comp: { id: id + 100, course_id: id, name: 'Exam', weight: 100 }, item: { id: id + 200, component_id: id + 100, name: 'Exam', mark } });
  const rows = [one(11, 1, 'DEMO-1010', 0.4), one(12, 1, 'DEMO-1020', 1), one(21, 2, 'DEMO-1010', 0.9), one(22, 2, 'DEMO-2010', 0.6)];
  const c = computeAll({ terms: [{ id: 1, name: 'Y1', year_of_study: 1, sort_order: 1 }, { id: 2, name: 'Y2', year_of_study: 2, sort_order: 2 }],
    courses: rows.map((r) => r.course), components: rows.map((r) => r.comp), assessments: rows.map((r) => r.item),
    repeats: [{ id: 1, course_ids: [11, 21], policy: null }], settings: { repeat_policy_default: 'latest' } });
  near(c.years.get(1).average, 0.7, 'year 1');
  near(c.years.get(2).average, 0.75, 'year 2');
  near(c.cumulative.average, 2.5 / 3, 'cumulative');
  // The page's ⓘ text claims exactly this for best and latest, and "every attempt" for all.
  const app = readFileSync(new URL('../site/js/app.js', import.meta.url), 'utf8');
  for (const p of ['best', 'latest']) assert.match(app, new RegExp(`${p}: 'Repeated courses count only your ${p} attempt in the cumulative, .*can be higher or lower than every year average\\.'`));
  assert.match(app, /all: 'Repeated courses count every attempt, in the cumulative and in each year’s average\.'/);
});
