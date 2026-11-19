// CalcCheck, Round 2: what the guest page shows. ui.js parseMark / markText, letter-only marks and set final grades in
// the stored shape the page writes, demo numbers worked by hand, the per-term cumulative the Graphs page computes, and
// "what do I need" per item / on the final. Made-up DEMO-xxxx data only.
import { assert, near } from './helpers.js';
import { build } from '../scripts/build.mjs';
import { computeAll, needFor, needPerItem, letterOf, SCALES } from '../shared/calc.js';
import { demoDoc } from '../site/js/demo.js';

build(); // ui.js imports ./calc.js (the generated copy of shared/calc.js)
globalThis.document ??= { getElementById: () => null }; // ui.js wires dialogs at import; no DOM in node
const { parseMark, markText, pct } = await import('../site/js/ui.js');

const demo = computeAll(demoDoc());
const byCode = (code, term) => [...demo.courses.values()].find((x) => x.course.code === code && (term === undefined || x.course.term_id === term));
const T = Object.fromEntries(demoDoc().terms.map((t) => [t.name, t.id]));

// ---------------------------------------------------------------- ui.js parseMark / markText
test('parseMark: blank, %, points, x/y, real zero', () => {
  assert.deepEqual(parseMark('', 1), { mark: null, out_of: 1, letter: null });
  assert.deepEqual(parseMark('—', 20), { mark: null, out_of: 20, letter: null });
  const r1 = parseMark('85', 1); near(r1.mark, 0.85, '85 on a % item = 0.85'); assert.equal(r1.out_of, 1);
  const r2 = parseMark('17', 20); near(r2.mark, 17, '17 on a /20 item = 17 points'); assert.equal(r2.out_of, 20);
  const r3 = parseMark('85%', 20); near(r3.mark, 17, '85% of 20 = 17'); assert.equal(r3.out_of, 20);
  const r4 = parseMark('437/500', 1); near(r4.mark, 437); assert.equal(r4.out_of, 500, '437/500 sets out of');
  const r5 = parseMark('0', 1); assert.equal(r5.mark, 0, 'a real zero is a mark, not blank'); assert.equal(r5.letter, null);
  const r6 = parseMark('17,5/20', 1); near(r6.mark, 17.5, 'comma decimal');
});

test('parseMark: letters A+..F (stored as {mark:null, letter}), bad letters and typos rejected', () => {
  assert.deepEqual(parseMark('b+', 1), { mark: null, out_of: 1, letter: 'B+' });
  assert.deepEqual(parseMark('A-', 20), { mark: null, out_of: 20, letter: 'A-' }, 'out of kept');
  assert.deepEqual(parseMark('F', 1), { mark: null, out_of: 1, letter: 'F' });
  for (const bad of ['F+', 'F-', 'E', 'A++', 'G']) assert.ok(parseMark(bad, 1).error, `${bad} rejected`);
  assert.ok(parseMark('-5', 1).error, 'negative');
  assert.ok(parseMark('17/0', 1).error, 'out of 0');
  assert.ok(parseMark('600%', 1).error, '> 500%');
  assert.match(parseMark('130', 1).warn, /130\.0%/, '> 120% warns');
  assert.equal(parseMark('100', 1).warn, null);
});

test('markText: letter, %, points, blank', () => {
  assert.equal(markText({ mark: null, letter: 'B+', out_of: 1 }), 'B+');
  assert.equal(markText({ mark: null, letter: null, out_of: 1 }), '—');
  assert.equal(markText({ mark: 0, out_of: 1 }), '0.0%');
  assert.equal(markText({ mark: 0.855, out_of: 1 }), '85.5%');
  assert.equal(markText({ mark: 17.5, out_of: 20 }), '17.5 / 20');
});

// ---------------------------------------------------------------- the stored shapes the page writes
const one = (course, comps, items, settings = {}) => computeAll({
  terms: [{ id: 1, name: 'Term A', sort_order: 1 }], courses: [{ id: 10, term_id: 1, code: 'DEMO-5000', credits: 3, type: 'graded', ...course }],
  components: comps.map((k, i) => ({ course_id: 10, sort_order: i, ...k })), assessments: items, settings,
});

test('letter-only mark as the page stores it ({mark:null, letter}) on a points item', () => {
  // B+ = middle of 77..79 = 78% (estimate). Item /20 → 15.6/20. One component, 100%: average 78%.
  const r = one({}, [{ id: 1, name: 'Tests', weight: 100 }], [
    { id: 2, component_id: 1, mark: null, out_of: 20, letter: 'B+' },
    { id: 3, component_id: 1, mark: null, out_of: 20, letter: null }]);
  const c = r.courses.get(10);
  near(c.result.average, 0.78, 'average over the letter item only');
  near(c.result.soFar, 0.39, 'so far: (0.78 + 0) / 2');
  const it = r.itemsByComp.get(1)[0];
  assert.equal(it.estimated, true); near(it.mark, 15.6, '0.78 × 20');
});

test('a number beats a letter left on the row; a letter-only item is not "open" for what-do-I-need', () => {
  const r = one({}, [{ id: 1, name: 'Exam', weight: 100 }], [{ id: 2, component_id: 1, mark: 0.9, out_of: 1, letter: 'C' }]);
  near(r.courses.get(10).result.average, 0.9);
  const r2 = one({}, [{ id: 1, name: 'Exam', weight: 100 }], [{ id: 2, component_id: 1, mark: null, out_of: 1, letter: 'C' }]);
  const c2 = r2.courses.get(10);
  assert.equal(needFor(c2.course, r2.compsByCourse.get(10), r2.itemsByComp, 0.8).status, 'nothing_left');
});

test('set final grade: final_override (incl. a real 0) vs final_letter, as finalGradeField stores them', () => {
  const comps = [{ id: 1, name: 'Exam', weight: 100 }];
  const items = [{ id: 2, component_id: 1, mark: 0.6, out_of: 1 }];
  const zero = one({ final_override: 0, final_letter: null }, comps, items).courses.get(10);
  assert.equal(zero.result.overridden, true); assert.equal(zero.result.average, 0, 'a set 0% is a grade, not blank');
  near(zero.result.calculated.average, 0.6, 'calculated kept beside it');
  const letter = one({ final_override: null, final_letter: 'A-' }, comps, items).courses.get(10);
  near(letter.result.average, 0.82, 'A- = middle of 80..84 = 82%'); assert.equal(letter.result.estimated, true);
  assert.equal(letter.letter.average, 'A-', 'and shows back as A- on the UWindsor scale');
  const g4 = one({ final_override: null, final_letter: 'B+' }, comps, items, { gpa_scale: 'gpa4' }).courses.get(10);
  assert.equal(g4.gpa.average, 3.3, 'B+ (78%) on the generic 4.0 scale = 3.3');
});

test('every letter typed as a set grade maps back to the same letter on the UWindsor scale', () => {
  for (const [l] of [['A+'], ['A'], ['A-'], ['B+'], ['B'], ['B-'], ['C+'], ['C'], ['C-'], ['D+'], ['D'], ['D-'], ['F']]) {
    const c = one({ final_letter: l }, [], []).courses.get(10);
    assert.equal(letterOf(c.result.average, SCALES.uwindsor), l, l);
  }
});

// ---------------------------------------------------------------- demo numbers, by hand
test('demo: every course average worked by hand', () => {
  // Fall 2025 DEMO-1010: assignments 72,65,40,70,68 drop 1 → (72+65+70+68)/4 = 68.75; 0.2·68.75 + 0.3·55 + 0.5·58 = 59.25
  near(byCode('DEMO-1010', T['Fall 2025']).result.average, 0.5925, 'DEMO-1010 first attempt');
  // DEMO-1100: essays 81, B+ (78 est.), 88 → 82.333; 0.6·82.333 + 0.1·95 + 0.3·84 = 49.4 + 9.5 + 25.2 = 84.1
  near(byCode('DEMO-1100').result.average, 0.841, 'DEMO-1100 (letter estimate)');
  // DEMO-1200: labs 30 = reports (share 2 → 20%) + quizzes (share 1 → 10%); reports .9,.85,.95,1 → .925; quizzes .8,.9,.7 → .8
  // (20·.925 + 10·.8 + 30·.91 + 40·.83)/100 + bonus 3·1/100 = .87 + .03 = .90
  near(byCode('DEMO-1200').result.average, 0.9, 'DEMO-1200 (nested + bonus)');
  // DEMO-1020: quizzes 80,74,90,85 drop 1 → 85; final 77 > midterm 69 → final 85% weight: 0.15·85 + 0.85·77 = 78.2
  near(byCode('DEMO-1020').result.average, 0.782, 'DEMO-1020 (final absorbs midterm)');
  // DEMO-1400: tests 86,79 → 82.5; 0.6·82.5 + 0.1·100 + 0.3·82 = 49.5 + 10 + 24.6 = 84.1
  near(byCode('DEMO-1400').result.average, 0.841, 'DEMO-1400');
  near(byCode('DEMO-1210').result.average, 0.84, 'DEMO-1210 set grade 84');
  // Retake DEMO-1010: assignments 85,90,78 (drop 78) → 87.5; midterm 76 → (20·.875 + 30·.76)/50 = 40.3/50 = .806
  // so far: assignments (85+90+78+0+0) drop 1 → 253/4 = 63.25; .2·.6325 + .3·.76 = .3545
  const re = byCode('DEMO-1010', T['Fall 2026']);
  near(re.result.average, 0.806, 'retake avg'); near(re.result.soFar, 0.3545, 'retake so far');
  // DEMO-2100: quizzes 90,85,(excused),blank → avg 87.5, so far (90+85+0)/3 = 58.333; midterm 31/40 = .775
  // avg (20·.875 + 30·.775)/50 = 40.75/50 = .815; so far .2·.58333 + .3·.775 = .349167
  near(byCode('DEMO-2100').result.average, 0.815, 'DEMO-2100 avg'); near(byCode('DEMO-2100').result.soFar, 0.3491666666666667, 'DEMO-2100 so far', 1e-12);
  // DEMO-2300: homework 92,88 → 90; tests 74 → (25·.9 + 35·.74)/60 = 48.4/60 = .806667; so far .25·.45 + .35·.37 = .242
  near(byCode('DEMO-2300').result.average, 48.4 / 60, 'DEMO-2300 avg', 1e-12); near(byCode('DEMO-2300').result.soFar, 0.242, 'DEMO-2300 so far', 1e-12);
});

test('demo: years and cumulative by hand (best attempt counts)', () => {
  // Year 1: 59.25, 84.1, 90, 78.2, 84.1, 84 (all 3 cr; no repeat inside year 1) → 479.65/6 = 79.941667
  near(demo.years.get(1).average, 4.7965 / 6, 'year 1', 1e-12);
  // Year 2: 80.6, 81.5, 80.6667 → 2.4276667/3 = 80.92222
  near(demo.years.get(2).average, (0.806 + 0.815 + 48.4 / 60) / 3, 'year 2', 1e-12);
  // Cumulative: retake 80.6 beats 59.25, so the first attempt is left out: 8 courses
  // .841+.9+.782+.841+.84+.806+.815+.806667 = 6.631667 → /8 = 82.895833
  near(demo.cumulative.average, (0.841 + 0.9 + 0.782 + 0.841 + 0.84 + 0.806 + 0.815 + 48.4 / 60) / 8, 'cumulative', 1e-12);
  assert.equal(pct(demo.cumulative.average), '82.90%', 'what the Overview shows');
  assert.equal(demo.cumulative.letter.average, 'A-');
  assert.equal(demo.cumulative.passCredits, 1, 'DEMO-1300 pass/fail credit reported separately');
  assert.equal(demo.cumulative.transferCredits, 3);
});

test('graphs: per-term cumulative (computeAll on the terms so far) by hand', () => {
  // What renderGraphs does: computeAll on the courses of terms 1..i.
  const doc = demoDoc();
  const upTo = (n) => { const ids = new Set(doc.terms.slice(0, n).map((t) => t.id)); return computeAll({ ...doc, courses: doc.courses.filter((c) => ids.has(c.term_id)) }).cumulative.average; };
  // After Fall 2025: (59.25 + 84.1 + 90)/3 = 77.78333
  near(upTo(1), (0.5925 + 0.841 + 0.9) / 3, 'after Fall 2025', 1e-12);
  // After Winter 2026 = year 1 (the retake isn't in scope yet, so the 59.25 attempt counts)
  near(upTo(2), demo.cumulativeTo.get(1).average, 'after Winter 2026 = cumulative to year 1', 1e-12);
  near(upTo(3), demo.cumulative.average, 'after Fall 2026 = the Overview number', 1e-12);
});

test('repeat inside one year: the year average counts the best attempt only', () => {
  // Year 1, Fall: DEMO-6010 50%; Winter: DEMO-6010 retake 80% + DEMO-6020 70%. Best → year 1 = (80 + 70)/2 = 75
  // (all three would be (50+80+70)/3 = 66.67, which the Graphs year candle shows today: see CalcCheck Round 2 report).
  const r = computeAll({
    terms: [{ id: 1, name: 'Fall', year_of_study: 1, sort_order: 1 }, { id: 2, name: 'Winter', year_of_study: 1, sort_order: 2 }],
    courses: [{ id: 10, term_id: 1, code: 'DEMO-6010', credits: 3 }, { id: 11, term_id: 2, code: 'DEMO-6010', credits: 3 }, { id: 12, term_id: 2, code: 'DEMO-6020', credits: 3 }],
    components: [{ id: 20, course_id: 10, weight: 100 }, { id: 21, course_id: 11, weight: 100 }, { id: 22, course_id: 12, weight: 100 }],
    assessments: [{ id: 30, component_id: 20, mark: 0.5 }, { id: 31, component_id: 21, mark: 0.8 }, { id: 32, component_id: 22, mark: 0.7 }],
    repeats: [{ id: 40, course_ids: [10, 11], policy: null }], settings: {},
  });
  near(r.years.get(1).average, 0.75, 'year 1 (best)');
  near(r.terms.get(1).average, 0.5, 'term averages still show every attempt');
});

// ---------------------------------------------------------------- what do I need (projections)
test('demo DEMO-2300: need on everything left, per item and on the final, by hand', () => {
  const c = byCode('DEMO-2300');
  const comps = demo.compsByCourse.get(c.course.id);
  const final = comps.find((k) => /final/i.test(k.name));
  // Everything left at x: homework (.92+.88+2x)/4, tests (.74+x)/2, final x
  // .25(.45+.5x) + .35(.37+.5x) + .4x = .242 + .7x ≥ .8 → x = .558/.7 = .797143
  const all = needFor(c.course, comps, demo.itemsByComp, 0.8);
  assert.equal(all.status, 'possible'); near(all.need, 0.558 / 0.7, 'everything left', 1e-6); assert.equal(all.projection, true);
  // On the final only (needOnFinal), the other open items at their component average (hw .9, tests .74):
  // .25·.9 + .35·.74 + .4x = .484 + .4x ≥ .8 → x = .79
  const onFinal = needFor(c.course, comps, demo.itemsByComp, 0.8, [final.id]);
  near(onFinal.need, 0.79, 'on the final', 1e-6);
  const each = needPerItem(c.course, comps, demo.itemsByComp, 0.8);
  const finalItem = demo.itemsByComp.get(final.id)[0];
  near(each.get(finalItem.id).need, 0.79, 'per item: the final', 1e-6);
  assert.equal(each.size, 4, 'hw 3, hw 4, test 2, final');
  // Exactly reachable: 100% on the final gives .884 → target 88.4% needs exactly 100%
  const exact = needFor(c.course, comps, demo.itemsByComp, 0.884, [final.id]);
  assert.equal(exact.status, 'possible'); near(exact.need, 1, 'exactly 100%', 1e-6);
  assert.equal(needFor(c.course, comps, demo.itemsByComp, 0.95, [final.id]).status, 'over_100');
  assert.equal(needFor(c.course, comps, demo.itemsByComp, 0.4, [final.id]).status, 'guaranteed');
});

test('scoped "guaranteed" relies on the projection for the other unmarked work (not 0 on the rest)', () => {
  // A 50% (marked 100), B 25% (blank), C 25% (blank). Target 70 on B only: C is projected at the course average (100%)
  // → 50 + 0 + 25 = 75 ≥ 70 → guaranteed. With 0 on everything left it's 50%, so "everything left" needs 40%.
  const r = one({}, [{ id: 1, name: 'A', weight: 50 }, { id: 2, name: 'B', weight: 25 }, { id: 3, name: 'C', weight: 25 }],
    [{ id: 5, component_id: 1, mark: 1 }, { id: 6, component_id: 2, mark: null }, { id: 7, component_id: 3, mark: null }]);
  const c = r.courses.get(10), comps = r.compsByCourse.get(10);
  assert.equal(needFor(c.course, comps, r.itemsByComp, 0.7, [2]).status, 'guaranteed');
  const all = needFor(c.course, comps, r.itemsByComp, 0.7);
  assert.equal(all.status, 'possible'); near(all.need, 0.4, '(70 − 50)/50', 1e-6);
});

test('nested display numbers: parts as "% of course" and the group roll-up (demo DEMO-1200 Labs)', () => {
  const c = byCode('DEMO-1200');
  const raw = demoDoc().components.filter((k) => k.course_id === c.course.id);
  const labs = raw.find((k) => k.name === 'Labs');
  const reports = raw.find((k) => k.name === 'Lab reports'), quizzes = raw.find((k) => k.name === 'Lab quizzes');
  near(c.result.components.get(reports.id).weight, 20, 'reports: share 2 of 3 × 30'); near(c.result.components.get(quizzes.id).weight, 10, 'quizzes');
  const g = c.result.components.get(labs.id);
  near(g.weight, 30); near(g.average, (20 * 0.925 + 10 * 0.8) / 30, 'group average weighted by part weight', 1e-12);
});

test('display boundary: the letter follows the percentage as shown (2 decimals)', () => {
  assert.equal(pct(0.79996), '80.00%');
  assert.equal(letterOf(0.79996, SCALES.uwindsor), 'A-', 'shown as 80.00% → A-');
  assert.equal(letterOf(0.79994, SCALES.uwindsor), 'B+', 'shown as 79.99% → B+');
  assert.equal(letterOf(0.8, SCALES.uwindsor), 'A-', 'exactly on the cut-off = the higher letter');
});

test('repeats: a repeated course counts its credits once; a set letter keeps its band', () => {
  const r = computeAll(demoDoc());
  assert.equal(r.cumulative.courses, 8); assert.equal(r.cumulative.credits, 24);
  const d = { terms: [{ id: 1, name: 'T' }], courses: [{ id: 2, term_id: 1, title: 'X', credits: 3, final_letter: 'F' }],
    components: [], assessments: [], settings: { gpa_scale: 'uwindsor13' } };
  const c = computeAll(d).courses.get(2);
  assert.equal(c.letter.average, 'F'); assert.equal(c.gpa.average, 1);
});
