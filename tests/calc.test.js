// shared/calc.js unit tests. Made-up numbers only (no real grades).
import { assert, near, makeCourse, pointsScale, customSettings } from './helpers.js';
import { courseResult, courseProjected, needFor, gpaOf, computeAll, applyOverride, componentSoFar, componentAverage } from '../shared/calc.js';

const run = ({ course, comps, itemsByComp }) => courseResult(course, comps, itemsByComp);

test('item % uses out_of (points 45/50 = 90%)', () => {
  const r = run(makeCourse([{ name: 'A', weight: 100, items: [{ mark: 45, out_of: 50 }] }]));
  near(r.soFar, 0.9); near(r.average, 0.9);
});

test('drop-lowest-N: so far divides by rows−N, average keeps top count−N', () => {
  const c = makeCourse([
    { name: 'Tutorials', weight: 20, drop_so_far: 2, drop_average: 2, items: [1, 1, 0.8, 0.6, 1, 1, 0.9, 0.5, null, null] },
    { name: 'Midterm', weight: 30, items: [0.7] },
    { name: 'Final', weight: 50, items: [null] },
  ], { cap_100: 1 });
  const r = run(c);
  near(r.components.get(c.comps[0].id).soFar, 0.85);
  near(r.components.get(c.comps[0].id).average, 0.95);
  near(r.soFar, 0.38);
  near(r.average, 0.8);
});

test('drop more than marked keeps at least one item in the average', () => {
  const comp = { aggregation: 'mean', drop_so_far: 2, drop_average: 2 };
  const items = [{ mark: 0.6, out_of: 1 }, { mark: null, out_of: 1 }, { mark: null, out_of: 1 }];
  near(componentAverage(comp, items), 0.6);
  near(componentSoFar(comp, items), 0.6);
});

test('drop count ≥ rows gives 0 so far (like a spreadsheet IFERROR → 0)', () => {
  near(componentSoFar({ aggregation: 'mean', drop_so_far: 3 }, [{ mark: 1, out_of: 1 }]), 0);
});

test('so far and average can drop differently (drop only in the average)', () => {
  const c = makeCourse([{ name: 'T', weight: 100, drop_so_far: 0, drop_average: 1, items: [1, 0.8, 0.9] }]);
  const r = run(c);
  near(r.soFar, 0.9); near(r.average, 0.95);
});

test('counts_in: so_far-only and none items', () => {
  const c = makeCourse([{ name: 'T', weight: 100, drop_so_far: 1, drop_average: 1,
    items: [1, 1, 0.5, { mark: 0.8, counts_in: 'so_far' }, { mark: 0, counts_in: 'none' }] }]);
  const r = run(c);
  near(r.soFar, 2.8 / 3); near(r.average, 1);
});

test('bonus component is added on top, capped when cap_100', () => {
  const spec = [
    { name: 'A', weight: 10, items: [1] },
    { name: 'B', weight: 90, items: [null] },
    { name: 'Bonus', weight: 3, is_bonus: 1, items: [1] },
  ];
  const capped = run(makeCourse(spec, { cap_100: 1 }));
  near(capped.soFar, 0.13); near(capped.average, 1);
  const open = run(makeCourse(spec));
  near(open.average, 1.03);
});

test('unmarked bonus adds nothing; bonus alone does not make a course "marked"', () => {
  const r = run(makeCourse([{ name: 'A', weight: 100, items: [null] }, { name: 'Bonus', weight: 2, is_bonus: 1, items: [1] }]));
  assert.equal(r.hasMarks, false); assert.equal(r.soFar, null); assert.equal(r.average, null);
});

test('weighted items and items over 100%', () => {
  const c = makeCourse([
    { name: 'Labs', weight: 30, aggregation: 'weighted',
      items: [{ mark: 0.9, item_weight: 3 }, { mark: 1.5, item_weight: 1.5 }, { mark: null, item_weight: 1.5 }] },
    { name: 'Final', weight: 70, items: [0.8] },
  ]);
  const r = run(c);
  near(r.components.get(c.comps[0].id).soFar, 0.825);
  near(r.components.get(c.comps[0].id).average, 1.1);
  near(r.soFar, 0.8075); near(r.average, 0.89);
});

test('course "add" curve adds flat points, then the cap applies', () => {
  const add = (value) => JSON.stringify({ type: 'add', value });
  near(run(makeCourse([{ name: 'A', weight: 100, items: [0.99] }], { curve: add(1.5), cap_100: 1 })).soFar, 1);
  near(run(makeCourse([{ name: 'A', weight: 100, items: [0.99] }], { curve: add(1.5) })).soFar, 1.005);
  near(run(makeCourse([{ name: 'A', weight: 100, items: [0.8] }], { curve: add(-2) })).average, 0.78);
  near(run(makeCourse([{ name: 'A', weight: 100, items: [0.8] }], { adjust_points: 5 })).average, 0.8, 'adjust_points is no longer read');
});

test('weight over 100 counts as bonus; average subtracts the excess', () => {
  const spec = (final) => [
    { name: 'HW', weight: 20, items: [0.9] }, { name: 'Mid', weight: 25, items: [0.8] },
    { name: 'Labs', weight: 25, items: [1] }, { name: 'Final', weight: 35, items: [final] },
  ];
  const done = run(makeCourse(spec(0.6)));
  near(done.soFar, 0.84); near(done.average, 0.84);
  const partial = run(makeCourse(spec(null)));
  near(partial.soFar, 0.63);
  near(partial.average, 63 / (70 - 5 * 70 / 105), 'excess is shared in proportion while the term is running');
});

test('weights under 100: so far still out of 100, average over marked weight', () => {
  const r = run(makeCourse([{ name: 'A', weight: 40, items: [1] }, { name: 'B', weight: 50, items: [1] }]));
  near(r.soFar, 0.9); near(r.average, 1);
});

test('absorb_if_higher rule: a midterm\'s weight moves to the final when the final is higher', () => {
  const build = (m1, m2, f) => {
    const c = makeCourse([
      { id: 1, name: 'M1', weight: 30, items: [m1] },
      { id: 2, name: 'M2', weight: 30, items: [m2] },
      { id: 3, name: 'Final', weight: 40, rule: JSON.stringify({ type: 'absorb_if_higher', from: [1, 2] }), items: [f] },
    ]);
    return run(c);
  };
  const r = build(0.8, 0.9, 0.85);
  near(r.soFar, 0.865); near(r.average, 0.865);
  assert.equal(r.components.get(1).weight, 0); assert.equal(r.components.get(3).weight, 70);
  const notYet = build(0.8, 0.9, null);
  near(notYet.soFar, 0.51); near(notYet.average, 0.85);
  const tie = build(0.85, 0.9, 0.85);
  assert.equal(tie.components.get(1).weight, 30, 'a tie keeps the midterm (>=)');
});

test('min_warning rule flags a component below its minimum (labs ≥ 50%)', () => {
  const rule = JSON.stringify({ type: 'min_warning', min: 0.5, label: 'Lab min' });
  const at = run(makeCourse([{ name: 'Labs', weight: 25, rule, items: [0.4, null] }, { name: 'F', weight: 75, items: [null] }]));
  assert.equal(at.warnings.length, 1); assert.equal(at.warnings[0].label, 'Lab min');
  assert.equal(run(makeCourse([{ name: 'Labs', weight: 25, rule, items: [0.6] }])).warnings.length, 0);
  assert.equal(run(makeCourse([{ name: 'Labs', weight: 25, rule, items: [null] }])).warnings.length, 0, 'no labs yet');
});

test('blank = not marked, 0 = a real zero that counts', () => {
  const r = run(makeCourse([{ name: 'A', weight: 50, items: [0, null] }, { name: 'B', weight: 50, items: [null] }]));
  assert.equal(r.hasMarks, true); near(r.soFar, 0); near(r.average, 0);
  const none = run(makeCourse([{ name: 'A', weight: 100, items: [null, null] }]));
  assert.equal(none.hasMarks, false); assert.equal(none.soFar, null); assert.equal(none.average, null);
});

test('projected: your projections where entered, otherwise the current average', () => {
  const spec = (final, compProj = null) => [{ name: 'Mid', weight: 40, items: [0.7] }, { name: 'Final', weight: 60, projected: compProj, items: [final] }];
  const p = (s) => { const c = makeCourse(s); return courseProjected(c.course, c.comps, c.itemsByComp); };
  near(p(spec(null)), 0.7);
  near(p(spec({ mark: null, projected: 0.9 })), 0.82);
  near(p(spec(null, 0.5)), 0.58);
  assert.equal(p([{ name: 'A', weight: 100, items: [null] }]), null, 'nothing marked or projected → no projection');
});

test('what do I need: possible, guaranteed, over 100%, impossible, nothing left', () => {
  const c = makeCourse([{ name: 'Mid', weight: 40, items: [0.7] }, { name: 'Final', weight: 60, items: [null] }]);
  const need = (t, cap) => needFor({ ...c.course, cap_100: cap ? 1 : 0 }, c.comps, c.itemsByComp, t);
  const ok = need(0.8); assert.equal(ok.status, 'possible'); near(ok.need, 0.52 / 0.6, '', 1e-6);
  assert.equal(need(0.2).status, 'guaranteed');
  const hard = need(0.95); assert.equal(hard.status, 'over_100'); near(hard.need, 0.67 / 0.6, '', 1e-6);
  assert.equal(need(1.2).status, 'impossible');
  assert.equal(need(1.01, true).status, 'impossible', 'capped course cannot pass 100%');
  const done = makeCourse([{ name: 'A', weight: 100, items: [0.9] }]);
  assert.equal(needFor(done.course, done.comps, done.itemsByComp, 0.8).status, 'nothing_left');
});

test('what do I need on just the final: other open items use their projection', () => {
  const c = makeCourse([
    { name: 'Quizzes', weight: 20, items: [1, null] }, { name: 'Mid', weight: 30, items: [0.7] },
    { id: 77, name: 'Final', weight: 50, items: [null] },
  ]);
  near(needFor(c.course, c.comps, c.itemsByComp, 0.8, [77]).need, 0.78, '', 1e-6);
  near(needFor(c.course, c.comps, c.itemsByComp, 0.8).need, 49 / 60, 'all open items', 1e-6);
});

test('GPA lookup uses lower bounds; below the lowest band is Fail', () => {
  const scale = pointsScale([[0.93, 4], [0.86, 3.9], [0.8, 3.7], [0.5, 0.7]]);
  assert.equal(gpaOf(0.93, scale), 4);
  assert.equal(gpaOf(0.9299, scale), 3.9);
  assert.equal(gpaOf(0.5, scale), 0.7);
  assert.equal(gpaOf(0.49, scale), 'Fail');
  assert.equal(gpaOf(null, scale), null);
});

test('term/year/cumulative: credit-weighted, skip unmarked and pass/fail courses', () => {
  let id = 1;
  const terms = [
    { id: 1, year_of_study: 1 }, { id: 2, year_of_study: 1 }, { id: 3, year_of_study: 2 },
  ];
  const courses = [], components = [], assessments = [];
  const add = (term_id, credits, mark, extra = {}) => {
    const c = { id: id++, term_id, credits, adjust_points: 0, cap_100: 0, pass_fail: 0, ...extra };
    const comp = { id: id++, course_id: c.id, name: 'All', weight: 100, is_bonus: 0, drop_so_far: 0, drop_average: 0, aggregation: 'mean' };
    courses.push(c); components.push(comp);
    assessments.push({ id: id++, component_id: comp.id, name: 'x', mark, out_of: 1, counts_in: 'both' });
    return c;
  };
  add(1, 3, 0.8); add(1, 6, 0.5); add(1, 3, null);
  add(2, 3, 0.9); add(2, 3, 1, { pass_fail: 1 });
  add(3, 3, 1, { pass_fail: 1 });
  const settings = customSettings([[0.93, 4], [0.5, 0.7]]);
  const all = computeAll({ terms, courses, components, assessments, settings });
  near(all.terms.get(1).soFar, 0.6); near(all.terms.get(1).average, 0.6);
  near(all.terms.get(2).soFar, 0.9);
  assert.equal(all.terms.get(3).soFar, null, 'a term with only a pass/fail course has no average');
  near(all.years.get(1).soFar, 8.1 / 12);
  near(all.cumulative.soFar, 8.1 / 12);
  assert.equal(all.cumulative.courses, 3);
  near(all.terms.get(1).gpa.soFar, 0.7, 'term GPA = credit-weighted mean of course points', 1e-12);
});

// --- more cases (synthetic numbers only) ---

test('mixed out_of in one component: points and fractions average as percentages', () => {
  const c = makeCourse([{ name: 'HW', weight: 100, items: [{ mark: 18, out_of: 20 }, { mark: 0.5, out_of: 1 }, { mark: 7, out_of: 7 }, null] }]);
  const r = run(c);
  near(r.soFar, (0.9 + 0.5 + 1) / 4); near(r.average, (0.9 + 0.5 + 1) / 3);
});

test('what do I need with drop-lowest: the open items take part in the drop', () => {
  const c = makeCourse([
    { name: 'Quizzes', weight: 20, drop_so_far: 1, drop_average: 1, items: [1, 0.5, null] },
    { name: 'Final', weight: 80, items: [null] },
  ]);
  // x ≥ 0.5: quizzes keep {1, x} → 0.2·(1+x)/2 + 0.8x = 0.9 → x = 8/9
  const r = needFor(c.course, c.comps, c.itemsByComp, 0.9);
  assert.equal(r.status, 'possible'); near(r.need, 8 / 9, '', 1e-6);
});

test('what do I need: bonus already banked can make a target guaranteed', () => {
  const c = makeCourse([
    { name: 'Mid', weight: 50, items: [1] }, { name: 'Final', weight: 50, items: [null] },
    { name: 'Bonus', weight: 5, is_bonus: 1, items: [1] },
  ]);
  const r = needFor(c.course, c.comps, c.itemsByComp, 0.55);
  assert.equal(r.status, 'guaranteed'); assert.equal(r.need, 0);
  assert.equal(needFor(c.course, c.comps, c.itemsByComp, 0.56).status, 'possible');
});

test('what do I need: exactly 100% is still possible, a hair over is over_100', () => {
  const c = makeCourse([{ name: 'Mid', weight: 40, items: [0.5] }, { name: 'Final', weight: 60, items: [null] }]);
  const exact = needFor(c.course, c.comps, c.itemsByComp, 0.8);
  assert.equal(exact.status, 'possible'); near(exact.need, 1, '', 1e-6);
  assert.equal(needFor(c.course, c.comps, c.itemsByComp, 0.81).status, 'over_100');
});

test('what do I need when weights sum under 100: grade stays out of 100', () => {
  const c = makeCourse([{ name: 'A', weight: 40, items: [1] }, { name: 'B', weight: 50, items: [null] }]);
  const r = needFor(c.course, c.comps, c.itemsByComp, 0.85);
  assert.equal(r.status, 'possible'); near(r.need, 0.9, '', 1e-6);
  assert.equal(needFor(c.course, c.comps, c.itemsByComp, 0.95).status, 'over_100');
  assert.equal(needFor(c.course, c.comps, c.itemsByComp, 1.2).status, 'impossible');
});

test('multi-year structure: year = mean of semester means, cumulative = mean of all, not-started terms skipped', () => {
  // Y1 = 5 + 5 courses, Y2 = 6 + 6, Y3 = 6 started + 6 not started, Y4 empty.
  let id = 1;
  const terms = [
    { id: 1, year_of_study: 1 }, { id: 2, year_of_study: 1 },
    { id: 3, year_of_study: 2 }, { id: 4, year_of_study: 2 },
    { id: 6, year_of_study: 3 }, { id: 7, year_of_study: 3 },
  ];
  const courses = [], components = [], assessments = [];
  const add = (term_id, mark, extra = {}) => {
    const c = { id: id++, term_id, credits: 3, adjust_points: 0, cap_100: 0, pass_fail: 0, ...extra };
    const comp = { id: id++, course_id: c.id, name: 'All', weight: 100, is_bonus: 0, drop_so_far: 0, drop_average: 0, aggregation: 'mean' };
    courses.push(c); components.push(comp);
    assessments.push({ id: id++, component_id: comp.id, name: 'x', mark, out_of: 1, counts_in: 'both' });
  };
  const marks = {
    // Made-up values (round numbers on purpose, not anyone's marks).
    1: [0.5, 0.6, 0.7, 0.8, 0.9], 2: [0.55, 0.6, 0.65, 0.7, 0.75],
    3: [0.6, 0.6, 0.7, 0.7, 0.8, 0.8], 4: [0.5, 0.55, 0.6, 0.65, 0.7, 0.75],
    6: [0.2, 0.4, 0.6, 0.2, 0.4, 0.5], 7: [null, null, null, null, null, null],
  };
  for (const [t, ms] of Object.entries(marks)) for (const m of ms) add(Number(t), m);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const settings = customSettings([[0.93, 4], [0.86, 3.9], [0.8, 3.7], [0.77, 3.3], [0.73, 3], [0.5, 0.7]]);
  const all = computeAll({ terms, courses, components, assessments, settings });
  for (const t of [1, 2, 3, 4, 6]) near(all.terms.get(t).soFar, mean(marks[t]), `term ${t}`);
  near(all.years.get(1).soFar, (mean(marks[1]) + mean(marks[2])) / 2, 'Y1 = (Sem1 + Sem2)/2');
  near(all.years.get(2).soFar, (mean(marks[3]) + mean(marks[4])) / 2, 'Y2 = (Sem3 + Sem4)/2');
  const y12 = [...marks[1], ...marks[2], ...marks[3], ...marks[4]];
  near(all.cumulativeTo.get(2).soFar, mean(y12), 'cumulative Y1-2 = AVERAGE of all 22 rows');
  // A spreadsheet SUM/ROWS would count the 6 not-started rows as 0; we skip them.
  near(all.years.get(3).soFar, mean(marks[6]), 'Y3 skips the not-started term');
  near(all.cumulativeTo.get(3).soFar, mean([...y12, ...marks[6]]));
  const zeroCounting = mean([...y12, ...marks[6], 0, 0, 0, 0, 0, 0]);
  assert.ok(Math.abs(all.cumulativeTo.get(3).soFar - zeroCounting) > 0.01, 'differs from counting not-started courses as 0');
  assert.equal(all.cumulativeTo.get(4), undefined, 'years come from the terms that exist: no year 4 here');
  assert.deepEqual(all.yearList, [1, 2, 3]);
  assert.equal(all.terms.get(7).soFar, null);
  assert.equal(all.cumulative.courses, 28);
  // GPA = credit-weighted mean of each course's points (all 3 credits here; below every band = 0)
  const pts = (m) => { const p = gpaOf(m, all.scale); return p === 'Fail' ? 0 : p; };
  near(all.years.get(1).gpa.soFar, mean([...marks[1], ...marks[2]].map(pts)), 'year GPA = mean of course points');
});

test('absorb_if_higher also applies to a hypothetical final ("what do I need" and projections)', () => {
  const rule = JSON.stringify({ type: 'absorb_if_higher', from: [501, 502] });
  const c = makeCourse([
    { id: 501, name: 'M1', weight: 30, items: [0.6] },
    { id: 502, name: 'M2', weight: 30, items: [0.9] },
    { id: 503, name: 'Final', weight: 40, rule, items: [null] },
  ]);
  const n = needFor(c.course, c.comps, c.itemsByComp, 0.8);
  assert.equal(n.status, 'possible'); near(n.need, 0.53 / 0.7, '', 1e-6);
  near(courseProjected(c.course, c.comps, c.itemsByComp), 0.795, 'final projected at the 75% average beats M1');
  const real = courseResult(c.course, c.comps, c.itemsByComp);
  near(real.soFar, 0.45, 'no fill: the unmarked final moves nothing');
});

// --- final-grade override (synthetic numbers only) ---

test('final override replaces so far, average, projected and GPA; the calculated values stay beside it', () => {
  const terms = [{ id: 1, year_of_study: 1 }];
  const courses = [
    { id: 1, term_id: 1, credits: 3, curve: '{"type":"add","value":2}', cap_100: 1, pass_fail: 0, final_override: 0.9 },
    { id: 2, term_id: 1, credits: 3, adjust_points: 0, cap_100: 0, pass_fail: 0, final_override: null },
  ];
  const components = [{ id: 11, course_id: 1, weight: 100, is_bonus: 0, drop_so_far: 0, drop_average: 0, aggregation: 'mean' },
    { id: 21, course_id: 2, weight: 100, is_bonus: 0, drop_so_far: 0, drop_average: 0, aggregation: 'mean' }];
  const assessments = [{ id: 1, component_id: 11, mark: 0.6, out_of: 1, counts_in: 'both' }, { id: 2, component_id: 11, mark: null, out_of: 1, counts_in: 'both' },
    { id: 3, component_id: 21, mark: 0.7, out_of: 1, counts_in: 'both' }];
  const settings = customSettings([[0.9, 4.0], [0.6, 2.0]]);
  const all = computeAll({ terms, courses, components, assessments, settings });
  const c1 = all.courses.get(1);
  assert.equal(c1.result.overridden, true);
  near(c1.result.soFar, 0.9); near(c1.result.average, 0.9); near(c1.projected, 0.9);
  assert.equal(c1.gpa.average, 4.0); assert.equal(c1.gpa.soFar, 4.0);
  near(c1.result.calculated.average, 0.62, 'calculated = raw + adjust, capped'); near(c1.result.calculated.soFar, 0.32);
  near(c1.result.calculated.projected, 0.62);
  near(all.terms.get(1).average, (0.9 + 0.7) / 2); near(all.terms.get(1).soFar, (0.9 + 0.7) / 2);
  near(all.terms.get(1).projected, (0.9 + 0.7) / 2); near(all.cumulative.average, (0.9 + 0.7) / 2);
  assert.equal(all.courses.get(2).result.overridden, undefined);
});

test('final override counts a course with no marks; 0 is a real override; null and pass/fail are ignored', () => {
  const base = { soFar: null, average: null, hasMarks: false };
  let o = applyOverride({ final_override: 0.75, pass_fail: 0 }, base, null);
  assert.equal(o.result.hasMarks, true); near(o.result.average, 0.75); near(o.projected, 0.75);
  assert.equal(o.result.calculated.average, null);
  o = applyOverride({ final_override: 0, pass_fail: 0 }, base, null);
  assert.equal(o.result.overridden, true); near(o.result.average, 0);
  o = applyOverride({ final_override: null, pass_fail: 0 }, base, null);
  assert.equal(o.result, base);
  o = applyOverride({ final_override: 0.8, pass_fail: 1 }, base, null);
  assert.equal(o.result, base);
  const terms = [{ id: 1, year_of_study: 1 }];
  const all = computeAll({ terms, courses: [{ id: 1, term_id: 1, credits: 2, pass_fail: 0, final_override: 0.8 }], components: [], assessments: [], settings: [] });
  near(all.terms.get(1).average, 0.8); assert.equal(all.terms.get(1).courses, 1); assert.equal(all.terms.get(1).credits, 2);
});
