// Round 3 (edit structure): reorder, duplicate, bulk edit and average previews (site/js/structure.js). Made-up data only.
import { assert, near } from './helpers.js';
import { build } from '../scripts/build.mjs';
import { computeAll } from '../shared/calc.js';
import { demoDoc } from '../site/js/demo.js';

build(); // structure.js imports ./calc.js (the generated copy of shared/calc.js)
globalThis.document ??= { getElementById: () => null }; // ui.js wires dialogs at import; no DOM in node
const { moveId, sortPatches, copyComponentsPlan, copyCourseBody, remapRefs, bulkText, parseBulk, previewDelta } = await import('../site/js/structure.js');
const { markText } = await import('../site/js/ui.js');

// ---------------------------------------------------------------- reorder
test('moveId: up, down, to the ends, out of range is clamped', () => {
  assert.deepEqual(moveId([1, 2, 3, 4], 2, 1), [1, 3, 2, 4]);
  assert.deepEqual(moveId([1, 2, 3, 4], 0, 3), [2, 3, 4, 1]);
  assert.deepEqual(moveId([1, 2, 3, 4], 3, 0), [4, 1, 2, 3]);
  assert.deepEqual(moveId([1, 2, 3], 1, 99), [1, 3, 2]);
  assert.deepEqual(moveId([1, 2, 3], 5, 0), [1, 2, 3], 'bad index: unchanged');
});

test('sortPatches: renumbers 1..n, only rows that change (ties and gaps fixed)', () => {
  const rows = [{ id: 7, sort_order: 1 }, { id: 8, sort_order: 1 }, { id: 9, sort_order: 5 }];
  assert.deepEqual(sortPatches(rows, [7, 8, 9]), [{ id: 8, sort_order: 2 }, { id: 9, sort_order: 3 }]);
  assert.deepEqual(sortPatches(rows, [9, 7, 8]), [{ id: 9, sort_order: 1 }, { id: 7, sort_order: 2 }, { id: 8, sort_order: 3 }]);
  assert.deepEqual(sortPatches([{ id: 1, sort_order: 1 }, { id: 2, sort_order: 2 }], [1, 2]), [], 'already in order');
});

// ---------------------------------------------------------------- duplicate
/** Run a copy plan the way the page does (create rows with new ids, then point rules at the copies). */
function runCopy(doc, fromCourseId, toCourseId, comps, opts = {}) {
  let next = Math.max(...['courses', 'components', 'assessments'].flatMap((e) => doc[e].map((r) => r.id))) + 1;
  const all = doc.components.filter((k) => k.course_id === fromCourseId);
  const ids = new Set(all.map((k) => k.id));
  const plan = copyComponentsPlan(comps, all, doc.assessments.filter((a) => ids.has(a.component_id)), opts);
  const idMap = new Map(), made = [];
  for (const p of plan) {
    const row = { ...p.body, id: next++, course_id: toCourseId, parent_id: p.parentOld != null ? idMap.get(p.parentOld) : null };
    doc.components.push(row);
    idMap.set(p.old, row.id);
    made.push(row);
    for (const it of p.items) doc.assessments.push({ ...it, id: next++, component_id: row.id });
  }
  for (const row of made) Object.assign(row, remapRefs(row, idMap));
  return { plan, idMap };
}

test('duplicate a course with marks: the copy computes exactly the same (rules point at the copies)', () => {
  const doc = demoDoc();
  for (const src of doc.courses.filter((c) => c.type === 'graded')) {
    const before = computeAll(doc).courses.get(src.id).result;
    const copy = { ...copyCourseBody(src, { withMarks: true }), id: 9e6 + src.id, term_id: src.term_id };
    doc.courses.push(copy);
    const tops = doc.components.filter((k) => k.course_id === src.id && k.parent_id == null);
    const { idMap } = runCopy(doc, src.id, copy.id, tops, { withMarks: true });
    const after = computeAll(doc).courses.get(copy.id).result;
    near(after.average, before.average, `${src.code} average`, 1e-12);
    near(after.soFar, before.soFar, `${src.code} so far`, 1e-12);
    for (const k of doc.components.filter((x) => x.course_id === copy.id)) {
      const r = typeof k.rule === 'string' ? JSON.parse(k.rule) : k.rule;
      if (r && r.from) for (const id of r.from) assert.ok([...idMap.values()].includes(id), `${src.code}: rule points at a copied component`);
    }
  }
});

test('duplicate without marks: structure only (no marks, letters, excused, curves, projections, dates; course reopened)', () => {
  const course = { id: 1, code: 'DEMO-1010', title: 'Course', credits: 3, type: 'graded', status: 'complete', final_override: 0.9, curve: { type: 'add', value: 2 }, notes: 'n' };
  const body = copyCourseBody(course);
  assert.deepEqual(body, { code: 'DEMO-1010', title: 'Course', credits: 3, type: 'graded', notes: 'n', status: 'active' });
  const comps = [{ id: 10, course_id: 1, name: 'Labs', weight: 40, projected: 0.8, sort_order: 1 }];
  const items = [{ id: 20, component_id: 10, name: 'Lab 1', mark: 8, out_of: 10, letter: null, excused: 1, curve: { type: 'add', value: 1 }, projected: 0.9, date: '2026-01-05', sort_order: 1 },
    { id: 21, component_id: 10, name: 'Lab 2', mark: null, out_of: 10, letter: 'B', sort_order: 2 }];
  const plan = copyComponentsPlan(comps, comps, items);
  assert.equal(plan.length, 1);
  assert.equal('projected' in plan[0].body, false, 'component projection not copied');
  assert.deepEqual(plan[0].items, [{ name: 'Lab 1', out_of: 10, sort_order: 1 }, { name: 'Lab 2', out_of: 10, sort_order: 2 }]);
});

test('copyComponentsPlan: a group brings its parts, parents first; a lone part keeps no parent in the plan', () => {
  const all = [{ id: 1, name: 'Part B', parent_id: 3, sort_order: 2 }, { id: 2, name: 'Part A', parent_id: 3, sort_order: 1 },
    { id: 3, name: 'Labs', parent_id: null, sort_order: 1 }, { id: 4, name: 'Final', parent_id: null, sort_order: 2 }];
  const plan = copyComponentsPlan([all[2]], all, []);
  assert.deepEqual(plan.map((p) => [p.old, p.parentOld]), [[3, null], [2, 3], [1, 3]]);
  assert.deepEqual(copyComponentsPlan([all[0]], all, []).map((p) => [p.old, p.parentOld]), [[1, null]], 'part alone: page keeps its parent');
});

test('remapRefs: absorb / excused_to / by_date mapped; across courses unmapped ids are dropped, in one course kept', () => {
  const m = new Map([[1, 101], [2, 102]]);
  assert.deepEqual(remapRefs({ rule: { type: 'absorb_if_higher', from: [1, 9] } }, m), { rule: { type: 'absorb_if_higher', from: [101] } });
  assert.deepEqual(remapRefs({ rule: { type: 'absorb_if_higher', from: [9] } }, m), { rule: null }, 'nothing left: rule removed');
  assert.deepEqual(remapRefs({ rule: { type: 'absorb_if_higher', from: [9] } }, m, { keepUnmapped: true }), {}, 'same course: unchanged');
  assert.deepEqual(remapRefs({ rule: JSON.stringify({ type: 'min_warning', min: 0.5 }) }, m), {}, 'min warning has no ids');
  assert.deepEqual(remapRefs({ excused_to: { to: 2 } }, m), { excused_to: { to: 102 } });
  assert.deepEqual(remapRefs({ excused_to: { to: 9 } }, m), { excused_to: null });
  assert.deepEqual(remapRefs({ excused_to: { by_date: { pivot: 1, before: 1, after: 2 } } }, m), { excused_to: { by_date: { pivot: 101, before: 101, after: 102 } } });
  assert.deepEqual(remapRefs({ excused_to: { by_date: { pivot: 1, before: 1, after: 9 } } }, m), { excused_to: null }, 'by date needs all three');
});

// ---------------------------------------------------------------- bulk edit
const ITEMS = [
  { id: 1, name: 'Quiz 1', mark: 0.8, out_of: 1, letter: null, sort_order: 1 },
  { id: 2, name: 'Quiz 2', mark: null, out_of: 1, letter: null, sort_order: 2 },
  { id: 3, name: 'Lab report', mark: 17, out_of: 20, letter: null, sort_order: 3 },
];

test('bulkText → parseBulk round trip changes nothing', () => {
  const text = bulkText(ITEMS, markText);
  assert.equal(text, 'Quiz 1: 80.0%\nQuiz 2:\nLab report: 17 / 20');
  const r = parseBulk(text, ITEMS);
  assert.deepEqual([r.updates, r.creates, r.errors], [[], [], []]);
});

test('parseBulk: edit by name (any case), clear with "Name:", name alone = no change, new names = new items', () => {
  const r = parseBulk('quiz 2: 9/10\nQuiz 1:\nLab report\nLab report: 18\nQuiz 3: B+\nQuiz 4', ITEMS, { outOf: 1 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.updates.map((u) => [u.item.id, u.changes]), [
    [2, { mark: 9, out_of: 10 }],            // 9/10 on a % item: now out of 10
    [1, { mark: null }],                     // cleared
  ]);
  // "Lab report" was used by the first line (name alone: nothing), so the second "Lab report: 18" is a new item, % (18%).
  assert.deepEqual(r.creates, [
    { name: 'Lab report', mark: 0.18, letter: null, out_of: 1 },
    { name: 'Quiz 3', mark: null, letter: 'B+', out_of: 1 },
    { name: 'Quiz 4', mark: null, letter: null, out_of: 1 }]);
});

test('parseBulk: a bare number on a points item is points; names with ":" use the last ":"; errors and warnings', () => {
  const r = parseBulk('Lab report: 19\nPart 1: intro: 70', ITEMS, { outOf: 1 });
  assert.deepEqual(r.updates.map((u) => u.changes), [{ mark: 19 }], '19 = 19/20 points');
  assert.deepEqual(r.creates, [{ name: 'Part 1: intro', mark: 0.7, letter: null, out_of: 1 }]);
  const bad = parseBulk('Quiz 1: abc\n: 50\nQuiz 2: -3', ITEMS);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /Line 1 \(Quiz 1\)/);
  assert.match(parseBulk('Quiz 2: 130', ITEMS).warnings[0], /Quiz 2: That’s 130\.0%/);
  assert.equal(parseBulk('x\n'.repeat(301), ITEMS).errors.length, 1, 'line limit');
});

// ---------------------------------------------------------------- preview
test('previewDelta: course / term / cumulative before → after, nothing saved', () => {
  // One 3-credit course: A 50% (one item 80%), B 50% (unmarked). Current average = 80% (marked only).
  // Preview B = 60%: 0.5·0.8 + 0.5·0.6 = 70%. Term and cumulative follow (only course). Original untouched.
  const live = {
    terms: [{ id: 1, name: 'Term A', sort_order: 1 }],
    courses: [{ id: 10, term_id: 1, code: 'DEMO-1010', credits: 3, type: 'graded' }],
    components: [{ id: 20, course_id: 10, name: 'A', weight: 50 }, { id: 21, course_id: 10, name: 'B', weight: 50 }],
    assessments: [{ id: 30, component_id: 20, mark: 0.8, out_of: 1 }, { id: 31, component_id: 21, mark: null, out_of: 1 }],
    repeats: [], settings: {},
  };
  const d = previewDelta(live, (x) => { x.assessments[1].mark = 0.6; }, { courseId: 10, termId: 1 });
  near(d.course[0], 0.8); near(d.course[1], 0.7); near(d.term[1], 0.7); near(d.cumulative[0], 0.8); near(d.cumulative[1], 0.7);
  assert.equal(live.assessments[1].mark, null, 'the real gradebook is not changed');
  const gone = previewDelta(live, (x) => { x.courses = []; }, { courseId: 10 });
  assert.equal(gone.course[1], null, 'deleted course: no grade');
  assert.equal(gone.cumulative[1], null);
});

// ---------------------------------------------------------------- AuthGuard, Round 3: bulk input limits
test('parseBulk / parseMark (AuthGuard): line, length and number limits; text stays text', async () => {
  const { parseMark } = await import('../site/js/ui.js');
  const items = [{ id: 1, name: 'Quiz 1', out_of: 10, mark: null, letter: null, sort_order: 1 }];
  assert.deepEqual(parseBulk(Array(301).fill('A').join('\n'), items).errors, ['At most 300 lines at once']);
  assert.equal(parseBulk(Array(300).fill('A: 50').join('\n'), items).creates.length, 300);
  assert.match(parseBulk(`${'x'.repeat(201)}: 5`, items).errors[0], /too long/);
  // A huge pasted line is refused before any pattern runs (those patterns backtrack on long digit runs).
  const t0 = Date.now();
  const huge = parseBulk(`Quiz 1: ${'1'.repeat(200000)}x`, items);
  assert.ok(Date.now() - t0 < 500, 'fast'); assert.match(huge.errors[0], /too long/);
  for (const s of [`${'9'.repeat(39)}`, `1/${'9'.repeat(38)}`, '5/2000000']) assert.ok(parseMark(s, 10).error, `${s} refused`);
  assert.ok(parseMark('9'.repeat(41)).error);
  const r = parseMark('17/20', 10); assert.equal(r.mark, 17); assert.equal(r.out_of, 20);
  // Names are kept as typed (rendered as text, never HTML); "__proto__" is just a name.
  const odd = parseBulk('<img src=x onerror=alert(1)>: 50\n__proto__: 40\nconstructor', []);
  assert.deepEqual(odd.creates.map((c) => c.name), ['<img src=x onerror=alert(1)>', '__proto__', 'constructor']);
  assert.equal(({}).mark, undefined);
  for (const c of odd.creates) assert.ok(c.mark === null || (Number.isFinite(c.mark) && c.mark >= 0 && c.mark <= 5 * c.out_of));
});
