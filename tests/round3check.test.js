// CalcCheck, Round 3 (edit structure): repeats vs the cumulative ⓘ text, reorder, duplicate, bulk edit, delete previews,
// archived terms. Made-up data only (DEMO-xxxx / TEST-xxxx codes). Expected values are worked out by hand in comments.
import { assert, near } from './helpers.js';
import { build } from '../scripts/build.mjs';
import { computeAll, needFor } from '../shared/calc.js';

build(); // structure.js imports ./calc.js (the generated copy of shared/calc.js)
globalThis.document ??= { getElementById: () => null }; // ui.js wires dialogs at import; no DOM in node
const { copyComponentsPlan, copyCourseBody, remapRefs, bulkText, parseBulk, previewDelta, dropFrom, liveDoc } = await import('../site/js/structure.js');
const { markText } = await import('../site/js/ui.js');

const clone = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- repeats and the cumulative ⓘ
/** Two years, one term each. Every course: 3 credits, one 100% component with one item (the course grade). */
function repeatDoc(policy, marks) {
  const [first, other1, retake, other2] = marks;
  const one = (id, term_id, code, mark) => ({
    course: { id, term_id, code, title: code, credits: 3, type: 'graded' },
    comp: { id: id + 100, course_id: id, name: 'Exam', weight: 100 },
    item: { id: id + 200, component_id: id + 100, name: 'Exam', mark, out_of: 1 },
  });
  const rows = [one(11, 1, 'DEMO-1010', first), one(12, 1, 'DEMO-1020', other1), one(21, 2, 'DEMO-1010', retake), one(22, 2, 'DEMO-2010', other2)];
  return {
    terms: [{ id: 1, name: 'Year 1 term', year_of_study: 1, sort_order: 1 }, { id: 2, name: 'Year 2 term', year_of_study: 2, sort_order: 2 }],
    courses: rows.map((r) => r.course), components: rows.map((r) => r.comp), assessments: rows.map((r) => r.item),
    repeats: [{ id: 1, course_ids: [11, 21], policy: null }], settings: { repeat_policy_default: policy },
  };
}

test('ⓘ best: cumulative above every year average (hand-worked)', () => {
  // Y1: DEMO-1010 90, DEMO-1020 50 → Y1 = 70.  Y2: DEMO-1010 retake 60, DEMO-2010 90 → Y2 = 75 (each year keeps its own attempt).
  // Best: the 60 retake is dropped → cumulative = (90 + 50 + 90) / 3 = 76.667 > 75 > 70.
  const r = computeAll(repeatDoc('best', [0.9, 0.5, 0.6, 0.9]));
  near(r.years.get(1).average, 0.7); near(r.years.get(2).average, 0.75);
  near(r.cumulative.average, 230 / 300);
  assert.ok(r.cumulative.average > r.years.get(1).average && r.cumulative.average > r.years.get(2).average);
  assert.equal(r.cumulative.credits, 9, 'repeated course counted once: 3 courses × 3 credits');
});

test('ⓘ best: the cumulative can also be BELOW every year average (hand-worked)', () => {
  // Y1: DEMO-1010 90, DEMO-1020 50 → 70.  Y2: DEMO-1010 retake 95, DEMO-2010 55 → 75.
  // Best keeps the 95 and drops the 90 (a high first attempt): cumulative = (50 + 95 + 55) / 3 = 66.667 < 70 < 75.
  const r = computeAll(repeatDoc('best', [0.9, 0.5, 0.95, 0.55]));
  near(r.years.get(1).average, 0.7); near(r.years.get(2).average, 0.75);
  near(r.cumulative.average, 200 / 300);
  assert.ok(r.cumulative.average < r.years.get(1).average && r.cumulative.average < r.years.get(2).average);
});

test('ⓘ latest: cumulative below every year average when the retake is lower (hand-worked)', () => {
  // Same marks as the first case. Latest keeps the 60 retake: (50 + 60 + 90) / 3 = 66.667 < 70 (Y1) < 75 (Y2).
  const r = computeAll(repeatDoc('latest', [0.9, 0.5, 0.6, 0.9]));
  near(r.years.get(1).average, 0.7); near(r.years.get(2).average, 0.75);
  near(r.cumulative.average, 200 / 300);
});

test('ⓘ all: every attempt counts, cumulative between the year averages (hand-worked)', () => {
  // (90 + 50 + 60 + 90) / 4 = 72.5, between 70 and 75; credits 12 (both attempts).
  const r = computeAll(repeatDoc('all', [0.9, 0.5, 0.6, 0.9]));
  near(r.cumulative.average, 0.725);
  assert.equal(r.cumulative.credits, 12);
});

test('ⓘ caveat: both attempts in the same year → that year also counts only the best; terms show every attempt', () => {
  // Year 1, term A: DEMO-1010 50. Year 1, term B: DEMO-1010 retake 80, DEMO-1020 70.
  // Year 1 (best): (80 + 70) / 2 = 75 (not (50 + 80 + 70) / 3 = 66.7). Term A = 50 (its own attempt).
  const d = repeatDoc('best', [0.5, 0.7, 0.8, 0.9]);
  d.courses = d.courses.filter((c) => c.id !== 22);
  d.courses.find((c) => c.id === 12).term_id = 2;
  d.terms[1].year_of_study = 1;
  const r = computeAll(d);
  near(r.years.get(1).average, 0.75);
  near(r.terms.get(1).average, 0.5);
  near(r.cumulative.average, 0.75);
});

// ---------------------------------------------------------------- reorder
test('reorder terms: no average changes with best / all; latest follows the new order (term order = time order)', () => {
  const swap = (d) => { d.terms[0].sort_order = 2; d.terms[1].sort_order = 1; return d; };
  for (const policy of ['best', 'all']) {
    const a = computeAll(repeatDoc(policy, [0.9, 0.5, 0.6, 0.9])), b = computeAll(swap(repeatDoc(policy, [0.9, 0.5, 0.6, 0.9])));
    near(b.cumulative.average, a.cumulative.average, policy);
    for (const y of [1, 2]) near(b.years.get(y).average, a.years.get(y).average, `${policy} Y${y}`);
  }
  // latest, Year 2 term first: the Year 1 attempt (90) is now the latest → (90 + 50 + 90) / 3 = 76.667 instead of 66.667.
  near(computeAll(swap(repeatDoc('latest', [0.9, 0.5, 0.6, 0.9]))).cumulative.average, 230 / 300);
});

test('reorder components: absorb chains give the same grade in any order (was order-dependent)', () => {
  // Quiz 20% (60), Midterm 30% (70, takes Quiz's weight if higher), Final 50% (80, takes Midterm's weight if higher).
  // Midterm settles first: 70 > 60 → Midterm 50, Quiz 0. Then Final: 80 > 70 → Final 100, Midterm 0. Grade = 80%.
  // (Before the fix, listing Final first gave Final 80 + Midterm 20: 0.8·80 + 0.7·20 = 78%.)
  const doc = (orders) => ({
    terms: [{ id: 1, name: 'T', sort_order: 1 }],
    courses: [{ id: 1, term_id: 1, code: 'DEMO-1010', credits: 3, type: 'graded' }],
    components: [
      { id: 10, course_id: 1, name: 'Quiz', weight: 20, sort_order: orders[0] },
      { id: 11, course_id: 1, name: 'Midterm', weight: 30, sort_order: orders[1], rule: { type: 'absorb_if_higher', from: [10] } },
      { id: 12, course_id: 1, name: 'Final', weight: 50, sort_order: orders[2], rule: { type: 'absorb_if_higher', from: [11] } }],
    assessments: [{ id: 20, component_id: 10, mark: 0.6, out_of: 1 }, { id: 21, component_id: 11, mark: 0.7, out_of: 1 },
      { id: 22, component_id: 12, mark: 0.8, out_of: 1 }],
    repeats: [], settings: {},
  });
  for (const o of [[1, 2, 3], [3, 2, 1], [2, 3, 1], [1, 3, 2]]) {
    const r = computeAll(doc(o)).courses.get(1).result;
    near(r.average, 0.8, `order ${o}`); near(r.soFar, 0.8, `order ${o}`);
    near(r.components.get(12).weight, 100, `order ${o}: Final weight`);
  }
});

test('reorder items: averages unchanged (drops pick by value, not position)', () => {
  // Quizzes 40% (70, 90, 50; drop lowest in average → (70 + 90) / 2 = 80), Exam 60% (60). Average = 0.4·0.8 + 0.6·0.6 = 68%.
  const doc = (orders) => ({
    terms: [{ id: 1, name: 'T' }], courses: [{ id: 1, term_id: 1, code: 'TEST-2200', credits: 3, type: 'graded' }],
    components: [{ id: 10, course_id: 1, name: 'Quizzes', weight: 40, drop_average: 1 }, { id: 11, course_id: 1, name: 'Exam', weight: 60 }],
    assessments: [0.7, 0.9, 0.5].map((m, i) => ({ id: 20 + i, component_id: 10, mark: m, out_of: 1, sort_order: orders[i] }))
      .concat([{ id: 30, component_id: 11, mark: 0.6, out_of: 1 }]),
    repeats: [], settings: {},
  });
  near(computeAll(doc([1, 2, 3])).courses.get(1).result.average, 0.68);
  near(computeAll(doc([3, 1, 2])).courses.get(1).result.average, 0.68);
});

// ---------------------------------------------------------------- duplicate (mirrors app.js copyComponents)
function copyLikeApp(doc, fromCourseId, comps, toCourseId, { withMarks = false, sameCourse = false } = {}) {
  let next = Math.max(...['courses', 'components', 'assessments'].flatMap((e) => doc[e].map((r) => r.id))) + 1;
  const all = doc.components.filter((k) => k.course_id === fromCourseId);
  const allIds = new Set(all.map((k) => k.id));
  const plan = copyComponentsPlan(comps, all, doc.assessments.filter((a) => allIds.has(a.component_id)), { withMarks });
  const idMap = new Map(), made = [];
  let order = sameCourse ? Math.max(0, ...all.map((x) => x.sort_order ?? 0)) : 0;
  for (const p of plan) {
    const body = { ...p.body, course_id: toCourseId };
    const orig = all.find((x) => x.id === p.old);
    body.parent_id = p.parentOld != null ? idMap.get(p.parentOld) ?? null : sameCourse ? orig.parent_id ?? null : null;
    if (sameCourse && p.parentOld == null) {
      body.name = `${p.body.name} (copy)`;
      body.sort_order = ++order;
      const r = typeof body.rule === 'string' ? JSON.parse(body.rule) : body.rule;
      if (r && r.type === 'absorb_if_higher') body.rule = null;
    }
    const row = { ...clone(body), id: next++ };
    doc.components.push(row);
    idMap.set(p.old, row.id);
    made.push({ row, body });
    for (const it of p.items) doc.assessments.push({ ...clone(it), id: next++, component_id: row.id });
  }
  for (const { row, body } of made) Object.assign(row, remapRefs(body, idMap, { keepUnmapped: sameCourse, dropUnmappedAbsorb: sameCourse }));
  return idMap;
}

const LAB = 10, REP = 11, QZ = 12, TST = 13, MID = 14, FIN = 15, BON = 16;
function richDoc() {
  const it = (id, component_id, mark, extra = {}) => ({ id, component_id, name: `Item ${id}`, mark, out_of: 1, letter: null, sort_order: id, ...extra });
  return {
    terms: [{ id: 1, name: 'Term A', year_of_study: 1, sort_order: 1 }, { id: 2, name: 'Term B', year_of_study: 2, sort_order: 2 }],
    courses: [{ id: 1, term_id: 1, code: 'DEMO-3030', title: 'Demo', credits: 3, type: 'graded', curve: { type: 'add', value: 2 }, cap_100: 1, status: 'active' }],
    components: [
      { id: LAB, course_id: 1, name: 'Labs', weight: 30, sort_order: 1 },
      { id: REP, course_id: 1, parent_id: LAB, name: 'Reports', weight: 2, sort_order: 1 },
      { id: QZ, course_id: 1, parent_id: LAB, name: 'Quizzes', weight: 1, drop_average: 1, drop_so_far: 1, sort_order: 2 },
      { id: TST, course_id: 1, name: 'Tests', weight: 20, sort_order: 2, excused_to: { by_date: { pivot: MID, before: MID, after: FIN } } },
      { id: MID, course_id: 1, name: 'Midterm', weight: 20, sort_order: 3 },
      { id: FIN, course_id: 1, name: 'Final', weight: 30, sort_order: 4, rule: JSON.stringify({ type: 'absorb_if_higher', from: [MID] }) },
      { id: BON, course_id: 1, name: 'Bonus', weight: 2, is_bonus: 1, sort_order: 5 }],
    assessments: [
      it(100, REP, 18, { out_of: 20, curve: { type: 'add', value: 1 } }), it(101, REP, null, { out_of: 20, letter: 'B+' }), it(102, REP, 16, { out_of: 20 }),
      it(110, QZ, 0.7), it(111, QZ, 0.9),
      it(120, TST, 0.8, { date: '2026-01-10' }), it(121, TST, null, { excused: 1, date: '2026-01-20' }),
      it(122, TST, null, { excused: 1, date: '2026-03-10' }), it(123, TST, null, { date: '2026-03-20', projected: 0.6 }),
      it(130, MID, 0.65, { date: '2026-02-15' }), it(140, FIN, 0.72, { date: '2026-04-20' }), it(150, BON, 1)],
    repeats: [], settings: {},
  };
}

test('duplicate a course with marks: identical results (absorb, by-date excused, parts, item curves, letters, course curve)', () => {
  const doc = richDoc();
  const src = doc.courses[0];
  doc.courses.push({ ...copyCourseBody(src, { withMarks: true }), id: 2, term_id: 2, sort_order: 1 });
  copyLikeApp(doc, 1, doc.components.filter((k) => k.course_id === 1 && k.parent_id == null), 2, { withMarks: true });
  const r = computeAll(doc);
  const a = r.courses.get(1), b = r.courses.get(2);
  for (const v of ['soFar', 'average']) near(b.result[v], a.result[v], v, 1e-12);
  near(b.projected, a.projected, 'projected', 1e-12);
  // Hand-worked weights in the copy: Tests has 4 items (sw 4), 2 excused → 20/4 = 5 each. Item dated 01-20 is before the
  // Midterm's first date (02-15) → Midterm +5; 03-10 → Final +5. Tests 10, Midterm 25, Final 35. Final 72 > Midterm 65 →
  // Final takes Midterm: Final 60, Midterm 0. Labs 30 split 2:1 → Reports 20, Quizzes 10.
  const w = (id) => b.result.components.get(id).weight;
  const leaf = (name) => doc.components.find((k) => k.course_id === 2 && k.name === name).id;
  assert.deepEqual(['Tests', 'Midterm', 'Final', 'Reports', 'Quizzes'].map((n) => Math.round(w(leaf(n)) * 1e9) / 1e9), [10, 0, 60, 20, 10]);
  const leaves = r.compsByCourse.get(1), leaves2 = r.compsByCourse.get(2);
  for (const target of [0.7, 0.8, 0.95]) {
    assert.deepEqual(needFor(b.course, leaves2, r.itemsByComp, target), needFor(a.course, leaves, r.itemsByComp, target), `need ${target}`);
  }
  // Year 1 / Year 2 averages agree too (one copy each).
  near(r.years.get(2).average, r.years.get(1).average, 'years', 1e-12);
});

test('duplicate a course without marks: structure only (no grade, rules kept and re-pointed)', () => {
  const doc = richDoc();
  doc.courses.push({ ...copyCourseBody(doc.courses[0]), id: 2, term_id: 2 });
  const idMap = copyLikeApp(doc, 1, doc.components.filter((k) => k.course_id === 1 && k.parent_id == null), 2);
  const r = computeAll(doc).courses.get(2);
  assert.equal(r.result.hasMarks, false); assert.equal(r.result.average, null); assert.equal(r.counts, false);
  assert.equal(r.course.curve, undefined, 'course curve not copied');
  const items = doc.assessments.filter((a) => [...idMap.values()].includes(a.component_id));
  assert.equal(items.length, 12);
  for (const a of items) for (const k of ['mark', 'letter', 'excused', 'curve', 'projected', 'date']) assert.equal(a[k], undefined, `${a.name}.${k}`);
  const fin = doc.components.find((k) => k.id === idMap.get(FIN)), tst = doc.components.find((k) => k.id === idMap.get(TST));
  assert.deepEqual(fin.rule, { type: 'absorb_if_higher', from: [idMap.get(MID)] });
  assert.deepEqual(tst.excused_to, { by_date: { pivot: idMap.get(MID), before: idMap.get(MID), after: idMap.get(FIN) } });
  assert.equal(doc.components.find((k) => k.id === idMap.get(REP)).parent_id, idMap.get(LAB), 'parts under the copied group');
});

test('duplicate a component in its course: absorb rules that point outside the copy are dropped, inside kept', () => {
  // Group G (parts P1 "takes P2 and the Midterm if higher", P2) and a Final that takes the Midterm. Duplicating G:
  // P1 copy keeps P2 copy only. Duplicating Final: the copy has no rule. excused_to (to the Midterm) is kept.
  const doc = {
    terms: [{ id: 1, name: 'T' }], courses: [{ id: 1, term_id: 1, code: 'DEMO-4040', credits: 3, type: 'graded' }],
    components: [
      { id: 1, course_id: 1, name: 'Midterm', weight: 30, sort_order: 1 },
      { id: 2, course_id: 1, name: 'G', weight: 30, sort_order: 2, excused_to: { to: 1 } },
      { id: 3, course_id: 1, parent_id: 2, name: 'P1', weight: 1, sort_order: 1, rule: { type: 'absorb_if_higher', from: [4, 1] } },
      { id: 4, course_id: 1, parent_id: 2, name: 'P2', weight: 1, sort_order: 2 },
      { id: 5, course_id: 1, name: 'Final', weight: 40, sort_order: 3, rule: { type: 'absorb_if_higher', from: [1] }, excused_to: { to: 1 } }],
    assessments: [], repeats: [], settings: {},
  };
  const g = copyLikeApp(doc, 1, [doc.components[1]], 1, { sameCourse: true });
  const row = (id) => doc.components.find((k) => k.id === id);
  assert.equal(row(g.get(2)).name, 'G (copy)');
  assert.deepEqual(row(g.get(2)).excused_to, { to: 1 }, 'excused_to inside the course: kept');
  assert.deepEqual(row(g.get(3)).rule, { type: 'absorb_if_higher', from: [g.get(4)] }, 'part rule: sibling copy only');
  assert.equal(row(g.get(3)).parent_id, g.get(2));
  const f = copyLikeApp(doc, 1, [doc.components.find((k) => k.id === 5)], 1, { sameCourse: true });
  assert.equal(row(f.get(5)).rule, null);
  assert.deepEqual(row(f.get(5)).excused_to, { to: 1 });
});

// ---------------------------------------------------------------- bulk edit
test('bulk: saving the box unchanged never rounds a stored mark (was: 83.33% came back as 83.3%)', () => {
  const items = [
    { id: 1, name: 'Quiz 1', mark: 0.8333, out_of: 1, sort_order: 1 },        // markText: 83.3% → would save 0.833
    { id: 2, name: 'Lab 1', mark: 17.1234, out_of: 20, sort_order: 2 },       // markText: 17.123 / 20
    { id: 3, name: 'Quiz 2', mark: 0.8, out_of: 1, sort_order: 3 },
    { id: 4, name: 'Essay', mark: null, letter: 'B+', out_of: 1, sort_order: 4 },
    { id: 5, name: 'Lab 2', mark: 2 / 3, out_of: 1, sort_order: 5 }];         // 66.666667%: more digits than parseMark keeps
  const text = bulkText(items, markText);
  assert.equal(text, 'Quiz 1: 83.33%\nLab 1: 17.1234 / 20\nQuiz 2: 80.0%\nEssay: B+\nLab 2: 66.666667%');
  const r = parseBulk(text, items);
  assert.deepEqual([r.updates, r.creates, r.errors], [[], [], []]);
});

test('bulk: % vs points items, letters, x/y changes out of, clearing, duplicate names', () => {
  const items = [
    { id: 1, name: 'Lab', mark: 15, out_of: 20, sort_order: 1 },
    { id: 2, name: 'Quiz', mark: 0.5, out_of: 1, sort_order: 2 },
    { id: 3, name: 'Quiz', mark: null, out_of: 1, sort_order: 3 },
    { id: 4, name: 'Essay', mark: null, letter: 'A-', out_of: 1, sort_order: 4 }];
  const r = parseBulk('Lab: 85%\nQUIZ: 70\nquiz: 45/50\nQuiz: B\nEssay:', items, { outOf: 1 });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.updates.map((u) => [u.item.id, u.changes]), [
    [1, { mark: 17 }],                 // 85% of 20 = 17 points, out of stays 20
    [2, { mark: 0.7 }],                // first "Quiz" = first in order; bare 70 on a % item = 70%
    [3, { mark: 45, out_of: 50 }],     // second "Quiz": 45/50 → now out of 50 (90%)
    [4, { letter: null }]]);           // cleared letter
  assert.deepEqual(r.creates, [{ name: 'Quiz', mark: null, letter: 'B', out_of: 1 }], 'a third "Quiz" line = a new item');
  const p = parseBulk('Lab: B+\nLab: 18', [{ id: 1, name: 'Lab', mark: 15, out_of: 20 }], { outOf: 20 });
  assert.deepEqual(p.updates[0].changes, { mark: null, letter: 'B+' }, 'letter on a points item: mark cleared, out of kept');
  assert.deepEqual(p.creates, [{ name: 'Lab', mark: 18, letter: null, out_of: 20 }], 'new item: 18 points of the default 20');
});

test('bulk preview = the grade after saving (hand-worked)', () => {
  // Quizzes 40% (Quiz 1 80%, Quiz 2 unmarked), Exam 60% (unmarked). Bulk: "Quiz 2: 9/10", "Quiz 3: 60".
  // Quizzes = (0.8 + 0.9 + 0.6) / 3 = 76.667%; only Quizzes marked → average 76.667%.
  const live = {
    terms: [{ id: 1, name: 'T' }], courses: [{ id: 1, term_id: 1, code: 'DEMO-1010', credits: 3, type: 'graded' }],
    components: [{ id: 10, course_id: 1, name: 'Quizzes', weight: 40 }, { id: 11, course_id: 1, name: 'Exam', weight: 60 }],
    assessments: [{ id: 20, component_id: 10, name: 'Quiz 1', mark: 0.8, out_of: 1, sort_order: 1 },
      { id: 21, component_id: 10, name: 'Quiz 2', mark: null, out_of: 1, sort_order: 2 },
      { id: 30, component_id: 11, name: 'Exam', mark: null, out_of: 1 }],
    repeats: [], settings: {},
  };
  const r = parseBulk('Quiz 2: 9/10\nQuiz 3: 60', live.assessments.filter((a) => a.component_id === 10));
  const apply = (d) => {
    for (const u of r.updates) Object.assign(d.assessments.find((x) => x.id === u.item.id), u.changes);
    r.creates.forEach((c, i) => d.assessments.push({ id: 1e12 + i, component_id: 10, ...c }));
  };
  const d = previewDelta(live, apply, { courseId: 1 });
  near(d.course[0], 0.8); near(d.course[1], 2.3 / 3);
  const saved = clone(live); apply(saved);
  near(computeAll(saved).courses.get(1).result.average, d.course[1]);
});

// ---------------------------------------------------------------- delete previews and archived terms
/** Stored rows (as the store's all() returns them: children of a deleted row are still there). */
function storedDoc() {
  const doc = repeatDoc('best', [0.9, 0.5, 0.6, 0.9]);
  doc.terms[0].archived = 1;
  // A course with a group, a part, and a part of a part (imports can nest deeper than the page offers).
  doc.courses.push({ id: 31, term_id: 2, code: 'TEST-2200', credits: 3, type: 'graded' });
  doc.components.push(
    { id: 40, course_id: 31, name: 'Labs', weight: 50, sort_order: 1 },
    { id: 41, course_id: 31, parent_id: 40, name: 'Part A', weight: 1, sort_order: 1 },
    { id: 42, course_id: 31, parent_id: 41, name: 'Part A1', weight: 1, sort_order: 1 },
    { id: 43, course_id: 31, parent_id: 40, name: 'Part B', weight: 1, sort_order: 2 },
    { id: 44, course_id: 31, name: 'Exam', weight: 50, sort_order: 2 });
  doc.assessments.push({ id: 50, component_id: 42, mark: 0.4, out_of: 1 }, { id: 51, component_id: 43, mark: 0.8, out_of: 1 },
    { id: 52, component_id: 44, mark: 0.7, out_of: 1 });
  return doc;
}

test('delete preview = what the page computes after the delete, for every row (repeats, nesting, archived term)', () => {
  const stored = storedDoc();
  const live = liveDoc(stored);
  for (const entity of ['terms', 'courses', 'components', 'assessments']) {
    for (const row of stored[entity]) {
      const courseId = entity === 'courses' ? row.id : null;
      const termId = entity === 'courses' ? row.term_id : null;
      const p = previewDelta(live, (d) => dropFrom(d, entity, row.id), { courseId, termId });
      const after = clone(stored);
      after[entity] = after[entity].filter((r) => r.id !== row.id); // soft delete: only that row disappears
      const page = computeAll(liveDoc(after));
      const what = `${entity} ${row.id}`;
      near(p.cumulative[1], page.cumulative.average, `${what}: cumulative`);
      if (termId != null) near(p.term[1], page.terms.get(termId).average, `${what}: term`);
      for (const [id, c] of page.courses) near(computeAll((() => { const d = clone(live); dropFrom(d, entity, row.id); return d; })()).courses.get(id).result.average, c.result.average, `${what}: course ${id}`);
    }
  }
});

test('delete preview, hand-worked: deleting the best attempt makes the other attempt count', () => {
  // Best counts 90 (Y1 DEMO-1010). Delete it: the repeat link has one attempt left, the 60 retake counts.
  // Before: (90 + 50 + 90 + TEST-2200) / 4. TEST-2200: Labs 50% = Part A (Part A1 40%) and Part B (80%) 1:1 → 60%;
  // Exam 70% → 0.5·0.6 + 0.5·0.7 = 65%. Before = (0.9 + 0.5 + 0.9 + 0.65) / 4 = 73.75%. After = (0.5 + 0.6 + 0.9 + 0.65) / 4 = 66.25%.
  const live = liveDoc(storedDoc());
  const d = previewDelta(live, (x) => dropFrom(x, 'courses', 11), { courseId: 11, termId: 1 });
  near(d.cumulative[0], 0.7375); near(d.cumulative[1], 0.6625);
  near(d.term[0], 0.7); near(d.term[1], 0.5); assert.equal(d.course[1], null);
  // Deleting Part A (a part with its own part): Labs = Part B alone = 80% → 0.5·0.8 + 0.5·0.7 = 75%.
  const p = previewDelta(live, (x) => dropFrom(x, 'components', 41), { courseId: 31 });
  near(p.course[0], 0.65); near(p.course[1], 0.75);
});

test('archiving a term changes no average (terms, years, cumulative, cumulative-to-year, courses, GPA)', () => {
  const on = storedDoc(), off = storedDoc();
  off.terms[0].archived = 0;
  const a = computeAll(liveDoc(on)), b = computeAll(liveDoc(off));
  const pick = (r) => JSON.stringify({ cum: r.cumulative, terms: [...r.terms], years: [...r.years], to: [...r.cumulativeTo],
    courses: [...r.courses].map(([id, c]) => [id, c.result.soFar, c.result.average, c.projected, c.gpa]) });
  assert.equal(pick(a), pick(b));
});
