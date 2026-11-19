// Round 1 (CalcCheck): letters, GPA scales, grade input modes, course types, nested components, weight check,
// repeated courses, per-item "what do I need". Made-up numbers and fake course codes only. Every expected value is
// worked out by hand in the comment beside it.
import { assert, near, makeCourse } from './helpers.js';
import {
  SCALES, resolveScale, bandOf, letterOf, gpaOf, letterToPct, LETTER_PCT, computeAll, needFor, needPerItem,
  flattenComponents, weightCheck, courseResult, creditMean,
} from '../shared/calc.js';

// Tiny document builder: courses = [{id, term, credits, items: [mark fraction | item fields], ...fields}], one 100% component each.
function doc({ terms = [{ id: 1, name: 'Term 1' }], courses = [], repeats = [], settings = {} } = {}) {
  const components = [], assessments = [];
  let id = 10000;
  const cs = courses.map((c) => {
    const { items = [], term = 1, ...rest } = c;
    const comp = { id: id++, course_id: c.id, name: 'All', weight: 100, aggregation: 'mean' };
    components.push(comp);
    items.forEach((it, i) => assessments.push({ id: id++, component_id: comp.id, name: `i${i}`, out_of: 1, counts_in: 'both',
      ...(typeof it === 'object' && it !== null ? it : { mark: it }) }));
    return { term_id: term, credits: 3, code: `DEMO-${c.id}`, ...rest };
  });
  return { terms, courses: cs, components, assessments, repeats, settings };
}

// ---------------------------------------------------------------- letters and scales

test('UWindsor letter table: lower bounds inclusive, boundaries exact', () => {
  const s = SCALES.uwindsor;
  assert.equal(letterOf(0.90, s), 'A+'); assert.equal(letterOf(0.8999, s), 'A');
  assert.equal(letterOf(0.85, s), 'A'); assert.equal(letterOf(0.8499, s), 'A-');
  assert.equal(letterOf(0.77, s), 'B+'); assert.equal(letterOf(0.73, s), 'B'); assert.equal(letterOf(0.70, s), 'B-');
  assert.equal(letterOf(0.5, s), 'D-'); assert.equal(letterOf(0.4999, s), 'F'); assert.equal(letterOf(0, s), 'F');
  assert.equal(letterOf(null, s), null);
  assert.equal(letterOf(0.85 - 1e-12, s), 'A', 'float noise just under a cut-off still lands in the band');
});

test('UWindsor is a percent scale: no grade points, a letter only', () => {
  assert.equal(SCALES.uwindsor.kind, 'percent');
  assert.equal(gpaOf(0.95, SCALES.uwindsor), null);
});

test('letter-only marks = middle of the integer range (A+ 95, A 87, B 74.5, F 24.5)', () => {
  near(LETTER_PCT['A+'], 0.95); // (90+100)/2
  near(LETTER_PCT.A, 0.87);     // (85+89)/2
  near(LETTER_PCT['A-'], 0.82); // (80+84)/2
  near(LETTER_PCT.B, 0.745);    // (73+76)/2
  near(LETTER_PCT.F, 0.245);    // (0+49)/2
  near(letterToPct(' b+ '), 0.78); // (77+79)/2, case and spaces ignored
  assert.equal(letterToPct('Z'), null); assert.equal(letterToPct(null), null);
});

test('generic 4.0 and 12-point scales use the UWindsor letter cut-offs', () => {
  assert.equal(gpaOf(0.85, SCALES.gpa4), 4.0); assert.equal(gpaOf(0.84, SCALES.gpa4), 3.7);
  assert.equal(gpaOf(0.70, SCALES.gpa4), 2.7); assert.equal(gpaOf(0.49, SCALES.gpa4), 0);
  assert.equal(gpaOf(0.90, SCALES.gpa12), 12); assert.equal(gpaOf(0.73, SCALES.gpa12), 8); assert.equal(gpaOf(0.5, SCALES.gpa12), 1);
  assert.equal(SCALES.gpa4.official, false); assert.equal(SCALES.gpa12.official, false);
});

test('UWindsor 13-point (pre-Fall 2013) table', () => {
  const s = SCALES.uwindsor13;
  assert.equal(gpaOf(0.93, s), 13); assert.equal(gpaOf(0.929, s), 12); assert.equal(gpaOf(0.86, s), 12);
  assert.equal(gpaOf(0.80, s), 11); assert.equal(gpaOf(0.35, s), 1); assert.equal(letterOf(0.35, s), 'F');
  assert.equal(gpaOf(0.3499, s), 0); assert.equal(letterOf(0.3499, s), 'F-');
});

test('resolveScale: default UWindsor, unknown id falls back, custom scale', () => {
  assert.equal(resolveScale().id, 'uwindsor'); assert.equal(resolveScale({ gpa_scale: 'nope' }).id, 'uwindsor');
  assert.equal(resolveScale({ gpa_scale: 'gpa12' }).id, 'gpa12');
  const c = resolveScale({ gpa_scale: 'custom', custom_scale: { name: 'Mine', kind: 'points', bands: [{ min: 0.8, letter: 'H', points: 3 }, { min: 0.6, letter: 'P', points: 1 }] } });
  assert.equal(c.name, 'Mine'); assert.equal(gpaOf(0.81, c), 3); assert.equal(letterOf(0.6, c), 'P');
  assert.equal(gpaOf(0.59, c), 'Fail', 'below every band'); assert.equal(bandOf(0.59, c), null);
  assert.equal(resolveScale({ gpa_scale: 'custom' }).id, 'uwindsor', 'custom without bands → default');
});

// ---------------------------------------------------------------- Senate policy worked examples (cited in DECISIONS.md)

test('Senate policy example #1: credit-weighted average 2160 / 24.25 = 89.07 (the policy prints 89.1)', () => {
  const rows = [[0.96, 3.75], [0.86, 4], [0.97, 4], [0.86, 4], [0.73, 4], [0.96, 4.5]]
    .map(([v, credits]) => ({ course: { credits }, result: { soFar: v } }));
  near(creditMean(rows, 'soFar'), 21.60 / 24.25, '', 1e-12); // = 0.890721…
  assert.equal(Math.round(creditMean(rows, 'soFar') * 1000) / 10, 89.1);
});

test('Senate policy example #2: five 3-credit courses → 1314 / 15 = 87.6', () => {
  const d = doc({ courses: [0.96, 0.86, 0.97, 0.86, 0.73].map((m, i) => ({ id: i + 1, items: [m] })) });
  near(computeAll(d).cumulative.soFar, 13.14 / 15, '', 1e-12); // 0.876
});

// ---------------------------------------------------------------- grade input modes

test('grade input: percentage (85/100), points (437/500) and letter only give the same math', () => {
  const c = makeCourse([{ name: 'A', weight: 50, items: [{ mark: 85, out_of: 100 }] }, { name: 'B', weight: 50, items: [{ mark: 437, out_of: 500 }] }]);
  const r = courseResult(c.course, c.comps, c.itemsByComp);
  near(r.soFar, 0.5 * 0.85 + 0.5 * 0.874); // 0.8620
  const d = doc({ courses: [{ id: 1, items: [{ mark: null, letter: 'A', out_of: 10 }, { mark: 9, out_of: 10 }] }] });
  const all = computeAll(d);
  near(all.courses.get(1).result.soFar, (0.87 + 0.9) / 2); // letter A → 87% of /10, plus 9/10
  assert.equal(all.itemsByComp.get(d.components[0].id)[0].estimated, true, 'letter-only marks are flagged as estimates');
  assert.equal(d.assessments[0].mark, null, 'the stored document is not changed');
});

test('course final grade as a letter only → middle of the range, flagged estimated', () => {
  const d = doc({ courses: [{ id: 1, items: [null], final_letter: 'B+' }, { id: 2, items: [0.6] }] });
  const all = computeAll(d);
  const c = all.courses.get(1);
  near(c.result.average, 0.78); assert.equal(c.result.overridden, true); assert.equal(c.result.estimated, true);
  near(all.cumulative.average, (0.78 + 0.6) / 2);
  near(computeAll(doc({ courses: [{ id: 1, items: [null], final_letter: 'B+', final_override: 0.8 }] })).courses.get(1).result.average, 0.8,
    'a number beats a letter');
});

// ---------------------------------------------------------------- course types

test('pass/fail, transfer and withdrawn never count in averages; their credits are reported separately', () => {
  const d = doc({ courses: [
    { id: 1, items: [0.8] },                                                          // graded 3 cr
    { id: 2, items: [0.2], type: 'pass_fail', pass_result: 'pass', credits: 1.5 },    // marks ignored for averages
    { id: 3, items: [], type: 'transfer', credits: 6, final_override: 0.99 },         // override ignored
    { id: 4, items: [0.1], type: 'withdrawn', credits: 3 },
    { id: 5, items: [0.5], type: 'pass_fail', pass_result: 'fail' },
  ] });
  const all = computeAll(d);
  near(all.cumulative.soFar, 0.8); near(all.terms.get(1).average, 0.8);
  assert.equal(all.cumulative.courses, 1); assert.equal(all.cumulative.credits, 3);
  assert.equal(all.cumulative.passCredits, 1.5, 'only passed pass/fail courses');
  assert.equal(all.cumulative.transferCredits, 6);
  assert.equal(all.courses.get(3).result.overridden, undefined);
  assert.equal(all.courses.get(2).gpa.average, null); assert.equal(all.courses.get(2).letter, null);
  assert.equal(computeAll(doc({ courses: [{ id: 1, items: [0.7], pass_fail: 1 }] })).cumulative.courses, 0, 'old pass_fail flag still works');
});

// ---------------------------------------------------------------- GPA on a points scale

test('term GPA = credit-weighted mean of course points (not the points of the mean)', () => {
  const d = doc({ courses: [{ id: 1, items: [0.84] }, { id: 2, items: [0.91], credits: 6 }], settings: { gpa_scale: 'gpa4' } });
  const t = computeAll(d).terms.get(1);
  near(t.gpa.average, (3 * 3.7 + 6 * 4.0) / 9); // 0.84 → A- 3.7; 0.91 → A+ 4.0 → 35.1/9 = 3.9
  near(t.average, (3 * 0.84 + 6 * 0.91) / 9);   // 0.88667
  assert.equal(t.letter.average, 'A');
  const pct = computeAll({ ...d, settings: {} }).terms.get(1);
  assert.equal(pct.gpa.average, null, 'UWindsor scale: no points'); assert.equal(pct.letter.average, 'A');
});

test('a course below every band of a custom scale counts as 0 points in the GPA', () => {
  const settings = { gpa_scale: 'custom', custom_scale: { kind: 'points', bands: [{ min: 0.5, points: 4 }] } };
  const d = doc({ courses: [{ id: 1, items: [0.9] }, { id: 2, items: [0.3] }], settings });
  const all = computeAll(d);
  assert.equal(all.courses.get(2).gpa.average, 'Fail');
  near(all.cumulative.gpa.average, 2); // (4 + 0) / 2
});

// ---------------------------------------------------------------- nested components

test('nested components: children share the parent weight by their own weights', () => {
  const comps = [
    { id: 1, course_id: 9, name: 'Labs', weight: 30 },
    { id: 2, course_id: 9, parent_id: 1, name: 'Reports', weight: 2, aggregation: 'mean' },
    { id: 3, course_id: 9, parent_id: 1, name: 'Lab quizzes', weight: 1, aggregation: 'mean' },
    { id: 4, course_id: 9, name: 'Final', weight: 70, aggregation: 'mean' },
  ];
  const items = [
    { id: 21, component_id: 2, mark: 0.9, out_of: 1 }, { id: 31, component_id: 3, mark: 0.6, out_of: 1 },
    { id: 41, component_id: 4, mark: 0.8, out_of: 1 },
  ];
  const all = computeAll({ terms: [{ id: 1 }], courses: [{ id: 9, term_id: 1, credits: 3 }], components: comps, assessments: items });
  const r = all.courses.get(9).result;
  near(r.components.get(2).weight, 20); near(r.components.get(3).weight, 10); // 30·2/3, 30·1/3
  near(r.soFar, 0.2 * 0.9 + 0.1 * 0.6 + 0.7 * 0.8);                           // 0.18 + 0.06 + 0.56 = 0.80
  near(r.components.get(1).weight, 30); near(r.components.get(1).soFar, (20 * 0.9 + 10 * 0.6) / 30); // parent roll-up 0.8
  assert.ok(r.weightCheck.ok, 'top level adds to 100; child weights are shares, not course weight');
  // what do I need on the final with nested labs: 0.24 + 0.7x = 0.85 → x = 0.871428…
  const c = all.courses.get(9).course;
  const lv = all.compsByCourse.get(9);
  const ibc = new Map([[2, [items[0]]], [3, [items[1]]], [4, [{ ...items[2], mark: null }]]]);
  near(needFor(c, lv, ibc, 0.85).need, 0.61 / 0.7, '', 1e-6);
});

test('nested components: all-zero child weights split equally; bonus inherited; parent items warned', () => {
  const comps = [
    { id: 1, name: 'Bonus', weight: 4, is_bonus: 1 }, { id: 2, parent_id: 1, name: 'b1', weight: 0 }, { id: 3, parent_id: 1, name: 'b2', weight: 0 },
    { id: 5, name: 'All', weight: 100 },
  ];
  const ibc = new Map([[1, [{ id: 9, mark: 1, out_of: 1 }]]]);
  const { leaves, parents, warnings } = flattenComponents(comps, ibc);
  assert.deepEqual(leaves.map((l) => [l.id, l.weight, !!l.is_bonus]), [[2, 2, true], [3, 2, true], [5, 100, false]]);
  assert.equal(parents.size, 1);
  assert.deepEqual(warnings, [{ type: 'parent_items', component_id: 1 }]);
});

// ---------------------------------------------------------------- live weight check

test('weight check: non-blocking, counts top-level non-bonus weights only', () => {
  assert.deepEqual(weightCheck([{ weight: 40 }, { weight: 50 }]), { total: 90, ok: false });
  assert.deepEqual(weightCheck([{ id: 1, weight: 60 }, { id: 2, weight: 40 }, { id: 3, weight: 5, is_bonus: 1 }, { id: 4, weight: 99, parent_id: 1 }]), { total: 100, ok: true });
  assert.deepEqual(weightCheck([{ id: 1, weight: 60 }, { id: 4, weight: 40, parent_id: 999 }]), { total: 100, ok: true }, 'an orphan counts as top-level');
  assert.equal(weightCheck([]).ok, true, 'a course with no components yet is not an error');
  const all = computeAll(doc({ courses: [{ id: 1, items: [0.8] }] }));
  assert.equal(all.courses.get(1).result.weightCheck.ok, true);
  const d = doc({ courses: [{ id: 1, items: [0.8] }] }); d.components[0].weight = 90;
  const r = computeAll(d).courses.get(1).result;
  assert.deepEqual(r.warnings.find((w) => w.type === 'weights'), { type: 'weights', total: 90 });
  near(r.soFar, 0.72, 'the grade is still computed (out of 100)');
});

// ---------------------------------------------------------------- repeated courses

const twoTerms = [{ id: 1, name: 'T1', year_of_study: 1 }, { id: 2, name: 'T2', year_of_study: 2 }];
const repeatDoc = (first, second, policy, settings = {}) => doc({
  terms: twoTerms, settings,
  courses: [{ id: 1, term: 1, items: [first] }, { id: 2, term: 2, items: [second] }, { id: 3, term: 2, items: [0.9] }],
  repeats: [{ id: 'r1', course_ids: [1, 2], ...(policy ? { policy } : {}) }],
});

test('repeat policy best is the default (UWindsor): the higher attempt counts', () => {
  const all = computeAll(repeatDoc(0.8, 0.7));
  near(all.cumulative.soFar, (0.8 + 0.9) / 2, 'best attempt 0.8 + other course 0.9');
  assert.equal(all.courses.get(1).repeat.policy, 'best');
  assert.equal(all.courses.get(2).repeat.excluded.soFar, true);
});

test('repeat policy latest: only the latest attempt counts in year/cumulative; terms show both', () => {
  const all = computeAll(repeatDoc(0.8, 0.7, 'latest'));
  near(all.cumulative.soFar, (0.7 + 0.9) / 2, 'latest attempt 0.7 + other course 0.9');
  near(all.terms.get(1).soFar, 0.8, 'the first attempt still shows in its own term');
  near(all.years.get(1).soFar, 0.8, 'year 1 decides among its own attempts: only the first one is in it');
  assert.equal(all.courses.get(1).repeat.excluded.soFar, true); assert.equal(all.courses.get(2).repeat.excluded.soFar, false);
  assert.equal(all.courses.get(1).repeat.policy, 'latest');
});

test('repeat policy best and all', () => {
  near(computeAll(repeatDoc(0.8, 0.7, 'best')).cumulative.soFar, (0.8 + 0.9) / 2);
  near(computeAll(repeatDoc(0.8, 0.7, 'all')).cumulative.soFar, (0.8 + 0.7 + 0.9) / 3);
  near(computeAll(repeatDoc(0.8, 0.7, undefined, { repeat_policy_default: 'latest' })).cumulative.soFar, (0.7 + 0.9) / 2, 'default from settings');
});

test('repeat latest: a retake with no marks yet does not hide the earlier grade', () => {
  near(computeAll(repeatDoc(0.6, null, 'latest')).cumulative.soFar, (0.6 + 0.9) / 2);
});

// ---------------------------------------------------------------- per-item "what do I need"

test('what do I need per remaining item: each solved alone, the others at their projection', () => {
  const c = makeCourse([
    { name: 'Mid', weight: 40, items: [0.7] },
    { name: 'Quiz', weight: 10, items: [{ id: 501, mark: null }] },
    { name: 'Final', weight: 50, items: [{ id: 502, mark: null }] },
  ]);
  const per = needPerItem(c.course, c.comps, c.itemsByComp, 0.8);
  // Final alone: quiz projected at the course average 0.7 → 0.28 + 0.07 + 0.5x = 0.8 → x = 0.9
  near(per.get(502).need, 0.9, '', 1e-6); assert.equal(per.get(502).status, 'possible'); assert.equal(per.get(502).projection, true);
  // Quiz alone: final projected at 0.7 → 0.28 + 0.35 + 0.1x = 0.8 → x = 1.7 > 1.5 → impossible
  assert.equal(per.get(501).status, 'impossible');
  assert.equal(per.size, 2, 'marked items are not listed');
});
