// CalcCheck (Round 1): extra edge-case tests for shared/calc.js. Made-up numbers and fake codes (DEMO-xxxx) only.
// Every expected value is worked out by hand beside it.
import { assert, near } from './helpers.js';
import { UWINDSOR_LETTERS, computeAll, needFor, needPerItem, weightCheck, letterToPct } from '../shared/calc.js';

// doc builder: courses [{id, term, credits, ...}], comps [{id, course, weight, parent, ...}], items [{comp, mark, ...}]
function mk({ terms = [{ id: 1, name: 'T1' }], courses, comps, items = [], repeats = [], settings = {} }) {
  let n = 50000;
  return {
    terms, repeats, settings,
    courses: courses.map((c) => ({ term_id: c.term ?? 1, credits: 3, code: `DEMO-${c.id}`, ...c })),
    components: comps.map((c, i) => ({ name: `c${c.id}`, aggregation: 'mean', sort_order: i, ...c, course_id: c.course, parent_id: c.parent ?? null })),
    assessments: items.map((a, i) => ({ id: n++, out_of: 1, counts_in: 'both', sort_order: i, ...a, component_id: a.comp })),
  };
}
// One 100% component per course, one item: course id -> mark fraction.
const simple = (specs, extra = {}) => mk({
  courses: specs.map((s) => ({ id: s.id, ...s.f })),
  comps: specs.map((s) => ({ id: s.id * 10, course: s.id, weight: 100 })),
  items: specs.filter((s) => s.m !== undefined).map((s) => ({ comp: s.id * 10, mark: s.m })),
  ...extra,
});

test('empty document and missing settings do not throw', () => {
  const r = computeAll({});
  assert.equal(r.cumulative.soFar, null); assert.equal(r.cumulative.courses, 0);
  assert.equal(r.scale.id, 'uwindsor');
  const r2 = computeAll({ courses: [{ id: 1, term_id: 9, credits: 3 }] }); // no terms/components
  assert.equal(r2.courses.get(1).counts, false); assert.equal(r2.cumulative.soFar, null);
});

test('unknown scale id and custom without custom_scale fall back to UWindsor', () => {
  assert.equal(computeAll({ settings: { gpa_scale: 'nope' } }).scale.id, 'uwindsor');
  assert.equal(computeAll({ settings: { gpa_scale: 'custom' } }).scale.id, 'uwindsor');
});

test('zero-credit course carries no weight; only zero-credit courses give a null mean', () => {
  // A: 0 credits at 0.8, B: 3 credits at 0.6 -> (0*.8 + 3*.6)/3 = 0.6
  const r = computeAll(simple([{ id: 1, f: { credits: 0 }, m: 0.8 }, { id: 2, m: 0.6 }]));
  near(r.cumulative.soFar, 0.6); assert.equal(r.cumulative.courses, 2); assert.equal(r.cumulative.credits, 3);
  assert.equal(computeAll(simple([{ id: 1, f: { credits: 0 }, m: 0.8 }])).cumulative.soFar, null); // 0 credits total
});

test('NaN / blank credits count as 0', () => {
  const r = computeAll(simple([{ id: 1, f: { credits: 'abc' }, m: 0.9 }, { id: 2, f: { credits: 3 }, m: 0.5 }]));
  near(r.cumulative.soFar, 0.5); // only B has credit: 0.5
});

test('negative credits are treated as 0, not as negative weight', () => {
  // A: -3 credits at 0.9, B: 3 at 0.5. Treated as 0 -> mean 0.5. (Raw: (-2.7+1.5)/0 -> null.)
  const r = computeAll(simple([{ id: 1, f: { credits: -3 }, m: 0.9 }, { id: 2, f: { credits: 3 }, m: 0.5 }]));
  near(r.cumulative.soFar, 0.5);
  // A: -1 at 0.9, B: 3 at 0.5 -> still 0.5, never (-0.9+1.5)/2 = 0.3
  const r2 = computeAll(simple([{ id: 1, f: { credits: -1 }, m: 0.9 }, { id: 2, f: { credits: 3 }, m: 0.5 }]));
  near(r2.cumulative.soFar, 0.5);
});

test('course whose term does not exist: in cumulative, in no term or year', () => {
  const r = computeAll(simple([{ id: 1, f: { term: 99 }, m: 0.7 }, { id: 2, f: { term: 1 }, m: 0.5 }],
    { terms: [{ id: 1, name: 'T1', year_of_study: 1 }] }));
  near(r.terms.get(1).soFar, 0.5);                // only B
  near(r.years.get(1).soFar, 0.5);
  near(r.cumulativeTo.get(1).soFar, 0.5);
  near(r.cumulative.soFar, 0.6);                  // (0.7+0.5)/2, equal credits
});

test('empty term summarises to null / 0 credits', () => {
  const r = computeAll(simple([{ id: 1, m: 0.7 }], { terms: [{ id: 1 }, { id: 2 }] }));
  assert.equal(r.terms.get(2).soFar, null); assert.equal(r.terms.get(2).credits, 0);
});

test('letters on items: a mark wins over a letter; letter-only scales by out_of; case/space tolerant', () => {
  const d = mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 100 }],
    items: [{ comp: 10, mark: 0.5, letter: 'A+' }] });
  near(computeAll(d).courses.get(1).result.soFar, 0.5);           // mark 0.5 wins over A+ (95)
  assert.equal(computeAll(d).itemsByComp.get(10)[0].estimated, undefined);
  const d2 = mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 100 }],
    items: [{ comp: 10, letter: ' b ', out_of: 20 }] });
  // B -> (73+76)/2 = 74.5% -> 14.9 of 20 -> 0.745
  near(computeAll(d2).courses.get(1).result.soFar, 0.745); assert.equal(computeAll(d2).itemsByComp.get(10)[0].estimated, true);
  assert.equal(letterToPct('Z'), null); assert.equal(letterToPct(null), null);
  // a real zero with a letter present stays a zero (0 is a mark)
  const d3 = mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 100 }], items: [{ comp: 10, mark: 0, letter: 'A' }] });
  near(computeAll(d3).courses.get(1).result.soFar, 0);
});

test('letter mid-points round-trip to their own letter on the UWindsor scale', () => {
  for (const [l] of UWINDSOR_LETTERS) {
    const d = mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 100 }], items: [{ comp: 10, letter: l }] });
    assert.equal(computeAll(d).courses.get(1).letter.soFar, l, l);
  }
});

test('float boundaries: a grade computed on a cut-off lands in that band for every UWindsor cut', () => {
  for (const [letter, lo] of UWINDSOR_LETTERS) {
    const m = lo / 100;
    // weights 20/30/50, every item at m -> (20m + 30m + 50m)/100, which may drift by 1 ulp from m
    const d = mk({ courses: [{ id: 1 }],
      comps: [{ id: 10, course: 1, weight: 20 }, { id: 11, course: 1, weight: 30 }, { id: 12, course: 1, weight: 50 }],
      items: [{ comp: 10, mark: m }, { comp: 11, mark: m }, { comp: 12, mark: m }] });
    assert.equal(computeAll(d).courses.get(1).letter.soFar, letter, `${letter} at ${lo}`);
    const d2 = mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 100 }],
      items: [{ comp: 10, mark: lo * 10, out_of: 1000 }] });
    assert.equal(computeAll(d2).courses.get(1).letter.soFar, letter, `${letter} via /1000`);
  }
});

test('percent scale: no GPA points anywhere (course, term, year, cumulative), letter still shown', () => {
  const r = computeAll(simple([{ id: 1, m: 0.86 }], { terms: [{ id: 1, year_of_study: 1 }] }));
  assert.equal(r.courses.get(1).gpa.soFar, null);
  for (const s of [r.terms.get(1), r.years.get(1), r.cumulative]) { assert.equal(s.gpa.soFar, null); assert.equal(s.letter.soFar, 'A'); }
});

test('points scale: GPA is credit-weighted mean of course points; below every band is Fail = 0 points', () => {
  const settings = { gpa_scale: 'custom', custom_scale: { kind: 'points', bands: [{ min: 0.5, letter: 'P', points: 4 }] } };
  // A 3cr 0.9 -> 4; B 1cr 0.3 -> Fail (0 points). (3*4 + 1*0)/4 = 3
  const r = computeAll(simple([{ id: 1, m: 0.9 }, { id: 2, f: { credits: 1 }, m: 0.3 }], { settings }));
  assert.equal(r.courses.get(2).gpa.soFar, 'Fail'); assert.equal(r.courses.get(2).letter.soFar, null);
  near(r.cumulative.gpa.soFar, 3);
});

test('final_letter: ignored on pass/fail, transfer, withdrawn; override beats letter; override 0 is a real grade', () => {
  for (const type of ['pass_fail', 'transfer', 'withdrawn']) {
    const r = computeAll(simple([{ id: 1, f: { type, final_letter: 'A' } }]));
    assert.equal(r.courses.get(1).counts, false, type); assert.equal(r.cumulative.soFar, null, type);
  }
  const g = computeAll(simple([{ id: 1, f: { final_letter: 'A' } }]));   // A -> (85+89)/2 = 87%
  near(g.courses.get(1).result.soFar, 0.87); assert.equal(g.courses.get(1).result.estimated, true); assert.equal(g.courses.get(1).counts, true);
  const o = computeAll(simple([{ id: 1, f: { final_letter: 'A', final_override: 0.5 }, m: 0.9 }]));
  near(o.courses.get(1).result.soFar, 0.5); assert.equal(o.courses.get(1).result.estimated, undefined);
  const z = computeAll(simple([{ id: 1, f: { final_override: 0 } }])); // set 0%: counts even without marks
  near(z.cumulative.soFar, 0); assert.equal(z.courses.get(1).counts, true);
  assert.equal(computeAll(simple([{ id: 1, f: { final_letter: 'zz' }, m: 0.4 }])).courses.get(1).result.overridden, undefined);
});

test('pass/fail, transfer, withdrawn never enter averages; credits reported separately', () => {
  const r = computeAll(simple([{ id: 1, m: 0.8 }, { id: 2, f: { type: 'pass_fail', pass_result: 'pass' }, m: 0.1 },
    { id: 3, f: { type: 'pass_fail', pass_result: 'fail' } }, { id: 4, f: { type: 'transfer', credits: 6 }, m: 0.2 },
    { id: 5, f: { type: 'withdrawn' }, m: 0.3 }]));
  near(r.cumulative.soFar, 0.8); assert.equal(r.cumulative.courses, 1);
  assert.equal(r.cumulative.passCredits, 3); assert.equal(r.cumulative.transferCredits, 6);
  assert.equal(r.courses.get(4).gpa.soFar, null);
});

// ------------------------------------------------------------ repeats
const rep = (policy, ids = [1, 2, 3]) => ({ repeats: [{ id: 'g', course_ids: ids, policy }] });
const terms3 = [{ id: 1, year_of_study: 1 }, { id: 2, year_of_study: 1 }, { id: 3, year_of_study: 2 }];

test('repeats: group with deleted courses; live single attempt still counts; all-deleted does not throw', () => {
  const r = computeAll(simple([{ id: 1, m: 0.7 }], rep('latest', [1, 77, 78])));
  near(r.cumulative.soFar, 0.7); assert.equal(r.courses.get(1).repeat.excluded.soFar, false);
  computeAll(simple([{ id: 1, m: 0.7 }], rep('best', [77, 78])));
});

test('repeats latest: ranked by term sort_order, not list order; unknown term ranks oldest', () => {
  const terms = [{ id: 1, sort_order: 2 }, { id: 2, sort_order: 1 }]; // term 2 is chronologically first
  const r = computeAll(simple([{ id: 1, f: { term: 1 }, m: 0.5 }, { id: 2, f: { term: 2 }, m: 0.9 }, { id: 3, f: { term: 42 }, m: 0.99 }],
    { terms, ...rep('latest') }));
  near(r.cumulative.soFar, 0.5);                            // course 1 (term sort 2) is latest; others excluded
  assert.equal(r.courses.get(3).repeat.excluded.soFar, true); assert.equal(r.courses.get(2).repeat.excluded.soFar, true);
  near(r.terms.get(2).soFar, 0.9);                          // term averages still show every attempt
});

test('repeats latest: a later attempt without a grade or withdrawn does not displace the earlier one', () => {
  const r = computeAll(simple([{ id: 1, f: { term: 1 }, m: 0.6 }, { id: 2, f: { term: 2, type: 'withdrawn' }, m: 0.2 }, { id: 3, f: { term: 3 } }],
    { terms: terms3, ...rep('latest') }));
  near(r.cumulative.soFar, 0.6); assert.equal(r.courses.get(1).repeat.excluded.soFar, false);
});

test('repeats best / all / default policy from settings', () => {
  const specs = [{ id: 1, f: { term: 1 }, m: 0.6 }, { id: 2, f: { term: 2 }, m: 0.8 }];
  near(computeAll(simple(specs, { terms: terms3, ...rep('best', [1, 2]) })).cumulative.soFar, 0.8);
  near(computeAll(simple(specs, { terms: terms3, ...rep('all', [1, 2]) })).cumulative.soFar, 0.7); // (0.6+0.8)/2, equal credits
  near(computeAll(simple(specs, { terms: terms3, repeats: [{ id: 'g', course_ids: [1, 2] }], settings: { repeat_policy_default: 'best' } })).cumulative.soFar, 0.8);
  near(computeAll(simple(specs, { terms: terms3, repeats: [{ id: 'g', course_ids: [1, 2], policy: 'bogus' }] })).cumulative.soFar, 0.8); // bogus -> default best -> 0.8
});

test('repeats: cumulativeTo(year) should reflect only attempts up to that year', () => {
  // attempt 1 in year 1 (0.5), attempt 2 in year 2 (0.9), policy latest.
  // As of year 1 the only attempt is 0.5, so cumulativeTo(1) should be 0.5 (and cumulativeTo(2) 0.9).
  const r = computeAll(simple([{ id: 1, f: { term: 1 }, m: 0.5 }, { id: 2, f: { term: 3 }, m: 0.9 }], { terms: terms3, ...rep('latest', [1, 2]) }));
  near(r.cumulativeTo.get(2).soFar, 0.9);
  near(r.cumulativeTo.get(1).soFar, 0.5);
});

// ------------------------------------------------------------ nested components
const nest = (parentExtra = {}) => mk({
  courses: [{ id: 1 }],
  comps: [{ id: 10, course: 1, weight: 60, name: 'Work', ...parentExtra }, { id: 11, course: 1, parent: 10, weight: 1, name: 'Labs' },
    { id: 12, course: 1, parent: 10, weight: 1, name: 'Quiz' }, { id: 13, course: 1, weight: 40, name: 'Final' }],
  items: [{ comp: 11, mark: 0.8 }],
});

test('nested: orphan child (missing parent) acts as a leaf and its weight is counted by the weight check', () => {
  const d = mk({ courses: [{ id: 1 }], comps: [{ id: 11, course: 1, parent: 999, weight: 100 }], items: [{ comp: 11, mark: 0.8 }] });
  const r = computeAll(d);
  near(r.courses.get(1).result.soFar, 0.8);                       // math uses it
  assert.equal(r.courses.get(1).result.weightCheck.total, 100);   // so the check should see 100, not 0
  assert.equal(r.courses.get(1).result.weightCheck.ok, true);
});

test('nested: a component that is its own parent is not silently dropped', () => {
  const d = mk({ courses: [{ id: 1 }], comps: [{ id: 11, course: 1, parent: 11, weight: 100 }], items: [{ comp: 11, mark: 0.8 }] });
  near(computeAll(d).courses.get(1).result.soFar, 0.8);
});

test('nested: a grandchild (2 levels deep) is not silently dropped from the grade', () => {
  // Work 60 > Labs (all of Work) > LabA; plus Final 40 at 0.5. LabA carries Work's weight (0.8)
  // Expected so far = 0.6*0.8 + 0.4*0.5 = 0.68. If the grandchild vanishes: 0.4*0.5 = 0.20.
  const d = mk({ courses: [{ id: 1 }],
    comps: [{ id: 10, course: 1, weight: 60 }, { id: 11, course: 1, parent: 10, weight: 1 }, { id: 12, course: 1, parent: 11, weight: 1 }, { id: 13, course: 1, weight: 40 }],
    items: [{ comp: 12, mark: 0.8 }, { comp: 13, mark: 0.5 }] });
  near(computeAll(d).courses.get(1).result.soFar, 0.68);
});

test('nested: weights share the parent weight; all-zero child weights share equally; parent roll-up', () => {
  const r = computeAll(nest());
  const c = r.courses.get(1).result.components;
  near(c.get(11).weight, 30); near(c.get(12).weight, 30); near(c.get(10).weight, 60); // 60 split 1:1
  near(c.get(10).soFar, 0.4);        // (30*.8 + 30*0)/60
  near(c.get(10).average, 0.8);      // only Labs has marks
  near(r.courses.get(1).result.soFar, 0.24); // 30*.8/100
  const zero = nest(); zero.components.find((x) => x.id === 11).weight = 0; zero.components.find((x) => x.id === 12).weight = 0;
  near(computeAll(zero).courses.get(1).result.components.get(11).weight, 30);          // equal shares
});

test('nested: parent items ignored with a warning; weightCheck ignores children', () => {
  const d = nest(); d.assessments.push({ id: 1, component_id: 10, mark: 1, out_of: 1, counts_in: 'both' });
  const w = computeAll(d).courses.get(1).result.warnings;
  assert.ok(w.some((x) => x.type === 'parent_items' && x.component_id === 10));
  near(computeAll(d).courses.get(1).result.soFar, 0.24);
  assert.equal(weightCheck(d.components).total, 100); assert.equal(weightCheck(d.components).ok, true);
  assert.equal(weightCheck([]).ok, true);
  assert.equal(weightCheck([{ weight: 80 }, { weight: 30, is_bonus: 1 }]).ok, false); // bonus excluded: total 80
});

test('nested: a min_warning rule on a parent component fires from the parent roll-up', () => {
  // Work (parent) rule: warn if its average < 0.9; its roll-up average is 0.8.
  const r = computeAll(nest({ rule: { type: 'min_warning', min: 0.9, label: 'Work' } }));
  assert.ok(r.courses.get(1).result.warnings.some((x) => x.type === 'min'), 'parent rule silently ignored');
});

test('needFor with nested components, and needPerItem on leaves', () => {
  // Labs .8 marked (weight 30); Quiz (30) and Final (40) unmarked. Target 0.7, same mark x on both:
  // 0.24 + 0.7x = 0.7 -> x = 0.46/0.7
  const d0 = nest(); d0.assessments.push({ id: 71, component_id: 12, out_of: 1, counts_in: 'both' }, { id: 72, component_id: 13, out_of: 1, counts_in: 'both' });
  const r = computeAll(d0);
  const { course } = r.courses.get(1); const leaves = r.compsByCourse.get(1);
  const q = needFor(course, leaves, r.itemsByComp, 0.7);
  assert.equal(q.status, 'possible'); near(q.need, 0.46 / 0.7, '', 1e-6);
  const per = needPerItem(course, leaves, r.itemsByComp, 0.7);
  // Quiz alone, Final filled at course marked average 0.8: 0.24 + 0.3x + 0.32 = 0.7 -> x = 0.14/0.3
  near(per.get(71).need, 0.14 / 0.3, '', 1e-6);
  // Final alone, Quiz filled 0.8: 0.24 + 0.24 + 0.4x = 0.7 -> x = 0.22/0.4 = 0.55
  near(per.get(72).need, 0.22 / 0.4, '', 1e-6);
});

test('needFor: only = a parent component id reaches its children', () => {
  const d = nest(); d.assessments.push({ id: 71, component_id: 12, out_of: 1, counts_in: 'both' });
  const r = computeAll(d); const { course } = r.courses.get(1); const leaves = r.compsByCourse.get(1);
  const q = needFor(course, leaves, r.itemsByComp, 0.5, [10]);   // solve for the Work parent's open items
  assert.notEqual(q.status, 'nothing_left');
});

// ------------------------------------------------------------ needFor statuses
test('needFor statuses: guaranteed, exactly reachable, over 100, impossible, nothing left', () => {
  const d = () => mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 50 }, { id: 11, course: 1, weight: 50 }],
    items: [{ comp: 10, mark: 0.8 }, { comp: 11 }] });
  const run = (t, dd = d()) => { const r = computeAll(dd); return needFor(r.courses.get(1).course, r.compsByCourse.get(1), r.itemsByComp, t); };
  assert.equal(run(0.4).status, 'guaranteed');                    // banked 0.4 >= 0.4 on a 0 final
  const exact = run(0.9);                                         // 0.4 + 0.5x = 0.9 -> x = 1.0 exactly
  assert.equal(exact.status, 'possible'); near(exact.need, 1, '', 1e-6);
  const over = run(1.0);                                          // 0.4 + 0.5x = 1.0 -> x = 1.2
  assert.equal(over.status, 'over_100'); near(over.need, 1.2, '', 1e-6);
  assert.equal(run(1.2).status, 'impossible');                    // x = 1.6 > 150%
  assert.equal(run(0.7).projection, true);
  const full = d(); full.assessments[1].mark = 0.5;
  assert.equal(run(0.9, full).status, 'nothing_left');
});

test('needFor with weights over 100 and with a 100% cap', () => {
  // weights 60 + 60 = 120 (acts as bonus): marked .5 on first -> so far 0.3; second: 0.3 + 0.6x = 0.9 -> x = 1.0
  const d = mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 60 }, { id: 11, course: 1, weight: 60 }], items: [{ comp: 10, mark: 0.5 }, { comp: 11 }] });
  const r = computeAll(d); const q = needFor(r.courses.get(1).course, r.compsByCourse.get(1), r.itemsByComp, 0.9);
  assert.equal(q.status, 'possible'); near(q.need, 1, '', 1e-6);
  // cap_100, first marked 1: 0.6 + 0.6x = 1.0 -> x = 2/3
  const dc = mk({ courses: [{ id: 1, cap_100: 1 }], comps: [{ id: 10, course: 1, weight: 60 }, { id: 11, course: 1, weight: 60 }], items: [{ comp: 10, mark: 1 }, { comp: 11 }] });
  const rc = computeAll(dc);
  near(needFor(rc.courses.get(1).course, rc.compsByCourse.get(1), rc.itemsByComp, 1.0).need, 2 / 3, '', 1e-6);
});

test('zero vs blank: a real 0 lowers average, a blank does not', () => {
  const a = computeAll(mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 100 }], items: [{ comp: 10, mark: 1 }, { comp: 10, mark: 0 }] }));
  near(a.courses.get(1).result.average, 0.5);
  const b = computeAll(mk({ courses: [{ id: 1 }], comps: [{ id: 10, course: 1, weight: 100 }], items: [{ comp: 10, mark: 1 }, { comp: 10 }] }));
  near(b.courses.get(1).result.average, 1); near(b.courses.get(1).result.soFar, 0.5);
});
