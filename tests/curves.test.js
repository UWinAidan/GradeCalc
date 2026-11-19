// Curves per item and per course (synthetic numbers only).
import { assert, near, makeCourse } from './helpers.js';
import { courseResult, courseProjected, needFor, computeAll, itemPct, rawPct, curvedMark, parseCurve } from '../shared/calc.js';

const run = ({ course, comps, itemsByComp }) => courseResult(course, comps, itemsByComp);
const C = (type, value) => JSON.stringify({ type, value });
const item = (mark, out_of, curve) => ({ mark, out_of, curve: curve ?? null });

test('item curve "add" is in the item\'s own points: +2 on a /50 mark = +4%', () => {
  const a = item(40, 50, C('add', 2));
  near(curvedMark(a), 42); near(itemPct(a), 0.84); near(rawPct(a), 0.8);
});

test('item curve "mul" multiplies the mark; "set" replaces it with the adjusted mark', () => {
  near(itemPct(item(40, 50, C('mul', 1.1))), 0.88);
  near(itemPct(item(40, 50, C('set', 45))), 0.9);
  near(rawPct(item(40, 50, C('set', 45))), 0.8);
});

test('item curve: unmarked stays unmarked, never below 0, can go over 100%, bad JSON = none', () => {
  assert.equal(itemPct(item(null, 50, C('add', 5))), null);
  assert.equal(curvedMark(item(null, 50, C('set', 45))), null);
  near(itemPct(item(1, 50, C('add', -5))), 0);
  near(itemPct(item(49, 50, C('add', 3))), 1.04);
  near(itemPct(item(40, 50, '{not json')), 0.8);
  near(itemPct(item(40, 50, C('pow', 2))), 0.8);
  assert.equal(parseCurve(C('pow', 2)), null);
});

test('item curves feed component so far, average and drop-lowest', () => {
  // Quizzes /10: 5, 8, 9 with the 5 curved to 9.5 → the 8 is now the lowest and gets dropped.
  const c = makeCourse([{ name: 'Q', weight: 100, drop_so_far: 1, drop_average: 1,
    items: [item(5, 10, C('set', 9.5)), item(8, 10), item(9, 10)] }]);
  const r = run(c);
  near(r.average, (0.95 + 0.9) / 2); near(r.soFar, (0.95 + 0.9) / 2);
});

test('course curve "mul" and "set"; raw is kept; order is raw → curve → cap', () => {
  const base = [{ name: 'A', weight: 100, items: [0.8, null] }];
  let r = run(makeCourse(base, { curve: C('mul', 1.1) }));
  near(r.average, 0.88); near(r.soFar, 0.44); near(r.raw.average, 0.8); near(r.raw.soFar, 0.4);
  r = run(makeCourse(base, { curve: C('mul', 1.3), cap_100: 1 }));
  near(r.average, 1, 'capped after the curve'); near(r.raw.average, 0.8);
  r = run(makeCourse(base, { curve: C('set', 0.85) }));
  near(r.average, 0.85); near(r.soFar, 0.85); near(r.raw.average, 0.8);
  r = run(makeCourse(base, { curve: C('set', 1.2), cap_100: 1 }));
  near(r.average, 1);
});

test('no curve: raw equals the grade; no marks: curve gives null, not a grade', () => {
  const r = run(makeCourse([{ name: 'A', weight: 100, items: [0.7] }]));
  near(r.raw.average, r.average); near(r.raw.soFar, r.soFar);
  const e = run(makeCourse([{ name: 'A', weight: 100, items: [null] }], { curve: C('set', 0.9) }));
  assert.equal(e.average, null); assert.equal(e.soFar, null);
});

test('course curve applies after the bonus and excess, like adjust_points did', () => {
  const c = makeCourse([{ name: 'A', weight: 100, items: [0.9] }, { name: 'B', weight: 5, is_bonus: 1, items: [1] }],
    { curve: C('add', 1) });
  const r = run(c);
  near(r.raw.average, 0.95); near(r.average, 0.96);
});

test('projection and "what do I need" go through both curves', () => {
  const c = makeCourse([{ name: 'Mid', weight: 50, items: [item(30, 50, C('add', 5))] }, { name: 'Final', weight: 50, items: [item(null, 100)] }],
    { curve: C('add', 2) });
  const r = run(c);
  near(r.average, 0.72); // mid 35/50 = 70% → +2 points
  near(courseProjected(c.course, c.comps, c.itemsByComp), 0.72);
  // 0.5·0.7 + 0.5·x + 0.02 = 0.8 → x = 0.86
  const n = needFor(c.course, c.comps, c.itemsByComp, 0.8);
  assert.equal(n.status, 'possible'); near(n.need, 0.86, '', 1e-6);
});

test('final override still wins over a curved grade; the curved and raw grades stay beside it', () => {
  const all = computeAll({ terms: [{ id: 1, year_of_study: 1 }], settings: [],
    courses: [{ id: 1, term_id: 1, credits: 3, pass_fail: 0, curve: C('add', 3), final_override: 0.9 }],
    components: [{ id: 1, course_id: 1, weight: 100, is_bonus: 0, drop_so_far: 0, drop_average: 0, aggregation: 'mean' }],
    assessments: [{ id: 1, component_id: 1, mark: 0.7, out_of: 1, counts_in: 'both' }] });
  const r = all.courses.get(1).result;
  near(r.average, 0.9); near(r.calculated.average, 0.73); near(r.calculated.raw.average, 0.7);
});

test('a course curve never takes the grade below 0; item curves may go over 100% (like bonus marks)', () => {
  const r = run(makeCourse([{ name: 'A', weight: 100, items: [0.3] }], { curve: C('add', -100) }));
  near(r.average, 0); near(r.raw.average, 0.3);
  near(itemPct(item(48, 50, C('mul', 1.1))), 1.056);
});
