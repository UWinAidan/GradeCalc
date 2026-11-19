// Excused items and their weight transfer (shared/calc.js excusedWeights). Synthetic marks on a made-up
// syllabus with 8 quizzes × 5%, 12 activities × 0.5%, Midterm 27%, Final 27% and a 0% component.
import { assert, near, makeCourse } from './helpers.js';
import { courseResult, needFor } from '../shared/calc.js';

const QUIZ_DATES = ['2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08', '2026-10-22', '2026-11-05', '2026-11-12', '2026-11-19'];
const ACT_DATES = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09',
  '2026-11-16', '2026-11-23', '2026-11-30', '2026-12-03'];
const MID = 1, FIN = 2, QZ = 3, ACT = 4, ASG = 5;
const byDate = JSON.stringify({ by_date: { pivot: MID, before: MID, after: FIN } });

// excused = {quiz: [indexes], act: [indexes], mid: bool, fin: bool}; marks: quizzes 0.8, activities 1, midterm 0.7, final 0.9.
function build({ quiz = [], act = [], mid = false, fin = false, quizTo = byDate, marks = true, midDate = '2026-10-29', patch = {} } = {}) {
  const m = (v) => (marks ? v : null);
  return makeCourse([
    { id: MID, name: 'Midterm', weight: 27, excused_to: JSON.stringify({ to: FIN }), items: [{ mark: m(0.7), date: midDate, excused: mid ? 1 : 0 }] },
    { id: FIN, name: 'Final', weight: 27, items: [{ mark: m(0.9), date: '2026-12-10', excused: fin ? 1 : 0 }] },
    { id: QZ, name: 'Quizzes', weight: 40, excused_to: quizTo,
      items: QUIZ_DATES.map((date, i) => ({ mark: m(0.8), date, excused: quiz.includes(i) ? 1 : 0, ...(patch[i] || {}) })) },
    { id: ACT, name: 'Class activities', weight: 6, excused_to: byDate,
      items: ACT_DATES.map((date, i) => ({ mark: m(1), date, excused: act.includes(i) ? 1 : 0 })) },
    { id: ASG, name: 'Assignments', weight: 0, items: [{ mark: m(0.5) }] },
  ]);
}
const run = (c) => courseResult(c.course, c.comps, c.itemsByComp);
const weights = (r) => [MID, FIN, QZ, ACT, ASG].map((id) => Math.round(r.components.get(id).weight * 1e9) / 1e9);

test('nothing excused: syllabus weights, 0% component counts for nothing', () => {
  const r = run(build());
  assert.deepEqual(weights(r), [27, 27, 40, 6, 0]);
  near(r.soFar, (27 * 0.7 + 27 * 0.9 + 40 * 0.8 + 6) / 100);
  near(r.average, r.soFar);
  assert.deepEqual(r.moves, []);
});

test('quiz before the midterm date → its 5% moves to the Midterm', () => {
  const r = run(build({ quiz: [1] }));
  assert.deepEqual(weights(r), [32, 27, 35, 6, 0]);
  near(r.soFar, (32 * 0.7 + 27 * 0.9 + 35 * 0.8 + 6) / 100);
  assert.deepEqual(r.moves.map((x) => [x.from, x.to, x.weight]), [[QZ, MID, 5]]);
});

test('quiz after the midterm date → its 5% moves to the Final', () => {
  const r = run(build({ quiz: [5] }));
  assert.deepEqual(weights(r), [27, 32, 35, 6, 0]);
  near(r.soFar, (27 * 0.7 + 32 * 0.9 + 35 * 0.8 + 6) / 100);
});

test('item on the midterm date itself counts as "on/after" → Final', () => {
  const r = run(build({ quiz: [0], patch: { 0: { date: '2026-10-29' } } }));
  assert.deepEqual(weights(r), [27, 32, 35, 6, 0]);
});

test('excused item with no date → Final', () => {
  const r = run(build({ quiz: [0], patch: { 0: { date: null } } }));
  assert.deepEqual(weights(r), [27, 32, 35, 6, 0]);
});

test('midterm with no date: everything excused goes to the Final', () => {
  const r = run(build({ quiz: [0], midDate: null }));
  assert.deepEqual(weights(r), [27, 32, 35, 6, 0]);
});

test('class activity: 0.5% each, split by date', () => {
  const r = run(build({ act: [0, 7] })); // Sep 14 → Midterm, Nov 9 → Final
  assert.deepEqual(weights(r), [27.5, 27.5, 40, 5, 0]);
  near(r.soFar, (27.5 * 0.7 + 27.5 * 0.9 + 40 * 0.8 + 5 * 1) / 100);
});

test('excused midterm → Final takes 54%', () => {
  const r = run(build({ mid: true }));
  assert.deepEqual(weights(r), [0, 54, 40, 6, 0]);
  near(r.soFar, (54 * 0.9 + 40 * 0.8 + 6) / 100);
  near(r.average, r.soFar);
});

test('excused midterm + a quiz before it: the quiz weight passes through to the Final', () => {
  const r = run(build({ mid: true, quiz: [1] }));
  assert.deepEqual(weights(r), [0, 59, 35, 6, 0]);
  near(r.soFar, (59 * 0.9 + 35 * 0.8 + 6) / 100);
});

test('total weight is always kept at 100', () => {
  for (const ex of [{ quiz: [0, 1, 2, 3, 4, 5, 6, 7] }, { act: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, { mid: true, quiz: [3, 6], act: [2] }]) {
    const w = weights(run(build(ex)));
    near(w.reduce((s, x) => s + x, 0), 100);
  }
});

test('all quizzes excused: their 40% splits 25/15 by date (5 before the midterm, 3 after)', () => {
  const r = run(build({ quiz: [0, 1, 2, 3, 4, 5, 6, 7] }));
  assert.deepEqual(weights(r), [52, 42, 0, 6, 0]);
});

test('excused with no target: left out, the other items share the weight (no zero)', () => {
  const r = run(build({ quiz: [2], quizTo: null, patch: { 2: { mark: 0 } } }));
  assert.deepEqual(weights(r), [27, 27, 40, 6, 0]);
  near(r.components.get(QZ).soFar, 0.8, 'excused 0 is not counted');
  near(r.components.get(QZ).average, 0.8);
});

test('so far: an excused unmarked item is not a 0', () => {
  const c = build({ marks: false, quiz: [1] });
  c.itemsByComp.get(QZ).forEach((a, i) => { if (i === 0) a.mark = 1; });
  const r = run(c);
  near(r.components.get(QZ).soFar, 1 / 7);
  near(r.soFar, (35 / 7) / 100);
});

test('what do I need: excused items are not "left to mark"', () => {
  const c = build({ marks: false, mid: true, fin: false });
  const r = needFor(c.course, c.comps, c.itemsByComp, 0.5);
  assert.equal(r.status, 'possible');
  near(r.need, 0.5, '', 1e-6);
  const onlyMid = needFor(c.course, c.comps, c.itemsByComp, 0.5, [MID]);
  assert.equal(onlyMid.status, 'nothing_left');
});

test('weighted items: the excused share follows the item weight', () => {
  const c = makeCourse([
    { id: 11, name: 'Labs', weight: 30, aggregation: 'weighted', excused_to: JSON.stringify({ to: 12 }),
      items: [{ mark: 1, item_weight: 2 }, { mark: 0.5, item_weight: 1, excused: 1 }] },
    { id: 12, name: 'Final', weight: 70, items: [0.8] },
  ]);
  const r = run(c);
  near(r.components.get(11).weight, 20); near(r.components.get(12).weight, 80);
  near(r.soFar, (20 + 80 * 0.8) / 100);
});

test('excused target in another course or itself is ignored', () => {
  const c = makeCourse([
    { id: 21, name: 'A', weight: 50, excused_to: JSON.stringify({ to: 999 }), items: [1, { mark: 0, excused: 1 }] },
    { id: 22, name: 'B', weight: 50, excused_to: JSON.stringify({ to: 22 }), items: [1] },
  ]);
  const r = run(c);
  near(r.components.get(21).weight, 50); near(r.soFar, 1);
});

test('absorb_if_higher still works on top of excused weights', () => {
  const c = build({ quiz: [1] });
  c.comps.find((k) => k.id === FIN).rule = JSON.stringify({ type: 'absorb_if_higher', from: [MID] });
  const r = run(c);
  assert.deepEqual(weights(r), [0, 59, 35, 6, 0], 'the final (0.9) beats the midterm (0.7) and takes its 27 + 5');
});
