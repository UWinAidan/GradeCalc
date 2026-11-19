// GradeCalc math. The one place grades are computed: used by the page and the tests.
// Core ported from Aidan's Gradebook (code only, no data); rules in DECISIONS.md "Math".
// All values are fractions (0.85 = 85%). Component weights are points out of 100 of the course.
//
// Two views of every course:
//   soFar   ("grade so far")   = what you have banked: unmarked items count as 0.
//   average ("current average") = how you're doing on what has been marked.
// Projections ("projected", "what do I need") are labelled as projections and never stored as marks.

export const RULES = {
  // A component (usually the final) takes over listed components' weight when it is marked and beats them
  // (e.g. "if the final is higher than the midterm, the final counts for both").
  absorb_if_higher: 'absorb_if_higher',
  // Warning only (no effect on the grade): component average below `min` (e.g. "you must pass the labs").
  min_warning: 'min_warning',
};

export const COURSE_TYPES = ['graded', 'pass_fail', 'transfer', 'withdrawn'];
export const REPEAT_POLICIES = ['latest', 'best', 'all'];
export const VIEWS = ['soFar', 'average', 'projected'];
const EPS = 1e-9;

const countsIn = (a, view) => !a.excused && (a.counts_in === 'both' || a.counts_in == null || a.counts_in === view);
const isMarked = (a) => a.mark !== null && a.mark !== undefined;
const itemW = (a) => (a.item_weight === null || a.item_weight === undefined ? 1 : a.item_weight);
const courseType = (c) => (COURSE_TYPES.includes(c.type) ? c.type : c.pass_fail ? 'pass_fail' : 'graded');

function parseRule(rule) {
  if (!rule) return null;
  if (typeof rule === 'object') return rule;
  try { return JSON.parse(rule); } catch { return null; }
}

// ---------------------------------------------------------------- letters and GPA scales

/**
 * University of Windsor percentage → letter table (Senate Policy on Grading and Calculation of Averages, section I;
 * source and date in DECISIONS.md). Grades are integers, so "85-89.9" means 85..89 in practice.
 */
export const UWINDSOR_LETTERS = [
  ['A+', 90, 100], ['A', 85, 89.9], ['A-', 80, 84.9], ['B+', 77, 79.9], ['B', 73, 76.9], ['B-', 70, 72.9],
  ['C+', 67, 69.9], ['C', 63, 66.9], ['C-', 60, 62.9], ['D+', 57, 59.9], ['D', 53, 56.9], ['D-', 50, 52.9], ['F', 0, 49.9],
];

/**
 * A letter-only mark (no number known) counts as the middle of the letter's integer range on the UWindsor table:
 * A+ → 95, A → 87, B → 74.5, F → 24.5. It is an estimate and is flagged as one (DECISIONS.md).
 */
export const LETTER_PCT = Object.fromEntries(UWINDSOR_LETTERS.map(([l, lo, hi]) => [l, (lo + Math.floor(hi)) / 2 / 100]));
export const letterToPct = (letter) => {
  const k = String(letter ?? '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(LETTER_PCT, k) ? LETTER_PCT[k] : null;
};

const band = (pairs) => pairs.map(([min, letter, points = null]) => ({ min, letter, points }));
/**
 * Built-in scales. kind 'percent': the percentage IS the grade (no grade points; a letter is shown).
 * kind 'points': each course's grade maps to points; a GPA is the credit-weighted mean of course points.
 */
export const SCALES = {
  uwindsor: {
    id: 'uwindsor', name: 'UWindsor (percentage, with letter)', kind: 'percent', max: null, official: true,
    bands: band(UWINDSOR_LETTERS.map(([l, lo]) => [lo / 100, l])),
  },
  uwindsor13: {
    id: 'uwindsor13', name: 'UWindsor 13-point (courses before Fall 2013)', kind: 'points', max: 13, official: true,
    bands: band([[0.93, 'A+', 13], [0.86, 'A', 12], [0.80, 'A-', 11], [0.77, 'B+', 10], [0.73, 'B', 9], [0.70, 'B-', 8],
      [0.67, 'C+', 7], [0.63, 'C', 6], [0.60, 'C-', 5], [0.57, 'D+', 4], [0.53, 'D', 3], [0.50, 'D-', 2], [0.35, 'F', 1], [0, 'F-', 0]]),
  },
  gpa4: {
    id: 'gpa4', name: 'Percentage → 4.0 (generic)', kind: 'points', max: 4, official: false,
    bands: band([[0.90, 'A+', 4.0], [0.85, 'A', 4.0], [0.80, 'A-', 3.7], [0.77, 'B+', 3.3], [0.73, 'B', 3.0], [0.70, 'B-', 2.7],
      [0.67, 'C+', 2.3], [0.63, 'C', 2.0], [0.60, 'C-', 1.7], [0.57, 'D+', 1.3], [0.53, 'D', 1.0], [0.50, 'D-', 0.7], [0, 'F', 0]]),
  },
  gpa12: {
    id: 'gpa12', name: 'Percentage → 12-point (generic)', kind: 'points', max: 12, official: false,
    bands: band([[0.90, 'A+', 12], [0.85, 'A', 11], [0.80, 'A-', 10], [0.77, 'B+', 9], [0.73, 'B', 8], [0.70, 'B-', 7],
      [0.67, 'C+', 6], [0.63, 'C', 5], [0.60, 'C-', 4], [0.57, 'D+', 3], [0.53, 'D', 2], [0.50, 'D-', 1], [0, 'F', 0]]),
  },
};
export const DEFAULT_SCALE = 'uwindsor';

/** The scale a document uses: settings.gpa_scale = a built-in id, or 'custom' with settings.custom_scale. */
export function resolveScale(settings = {}) {
  const id = settings.gpa_scale ?? DEFAULT_SCALE;
  if (id === 'custom' && settings.custom_scale && Array.isArray(settings.custom_scale.bands)) {
    const cs = settings.custom_scale;
    return { id: 'custom', name: cs.name || 'Custom', kind: cs.kind === 'percent' ? 'percent' : 'points', max: cs.max ?? null,
      official: false, bands: cs.bands.map((b) => ({ min: Number(b.min), letter: b.letter ?? '', points: b.points ?? null })) };
  }
  return SCALES[id] || SCALES[DEFAULT_SCALE];
}

/** The band a fraction falls in (lower bounds inclusive, with float tolerance). null below every band or for null. */
export function bandOf(avg, scale) {
  if (avg === null || avg === undefined || !scale) return null;
  const sorted = [...scale.bands].sort((a, b) => b.min - a.min);
  for (const b of sorted) if (avg >= b.min - EPS) return b;
  return null;
}
export const letterOf = (avg, scale) => bandOf(avg, scale)?.letter ?? null;
/** Grade points for a fraction on a points scale; 'Fail' below every band; null for a percent scale or no value. */
export function gpaOf(avg, scale) {
  if (avg === null || avg === undefined || !scale || scale.kind === 'percent') return null;
  const b = bandOf(avg, scale);
  return b ? b.points : 'Fail';
}

// ---------------------------------------------------------------- items and components

/**
 * Curves: {type: 'add' | 'mul' | 'set', value}. Item curve, in the item's own points (out_of): add = +value points
 * (+2 on a /50 mark), mul = × value, set = the adjusted mark itself. Course curve, on the course grade (a fraction):
 * add = +value percentage points, mul = × value, set = the adjusted grade (a fraction). null = none.
 */
export const parseCurve = (c) => {
  const r = parseRule(c);
  return r && ['add', 'mul', 'set'].includes(r.type) && Number.isFinite(r.value) ? r : null;
};
const applyCurve = (c, v, addScale = 1) => {
  if (!c) return v;
  if (c.type === 'add') return v + c.value / addScale;
  if (c.type === 'mul') return v * c.value;
  return c.value;
};
/** An item's mark after its curve, in its own points (never below 0). Null if unmarked. */
export const curvedMark = (a) => (isMarked(a) ? Math.max(0, applyCurve(parseCurve(a.curve), a.mark)) : null);
/** The fraction the math uses: curved mark ÷ out of. */
export const itemPct = (a) => (isMarked(a) ? curvedMark(a) / (a.out_of || 1) : null);
/** The raw fraction, before the item's curve (shown beside the curved one). */
export const rawPct = (a) => (isMarked(a) ? a.mark / (a.out_of || 1) : null);

// Mean or weighted mean of [{v, w}] after dropping the `drop` lowest values, keeping at least `keepMin`.
function aggregate(rows, aggregation, drop, keepMin) {
  const sorted = [...rows].sort((a, b) => b.v - a.v);
  const keep = Math.max(keepMin, sorted.length - (drop || 0));
  if (keep <= 0) return 0;
  const kept = sorted.slice(0, keep);
  if (aggregation === 'weighted') {
    const sw = kept.reduce((s, r) => s + r.w, 0);
    return sw > 0 ? kept.reduce((s, r) => s + r.v * r.w, 0) / sw : 0;
  }
  return kept.reduce((s, r) => s + r.v, 0) / kept.length;
}

/** Component grade so far: unmarked items count as 0, after drop_so_far. */
export function componentSoFar(comp, items, fill) {
  const rows = items
    .filter((a) => countsIn(a, 'so_far'))
    .map((a) => ({ v: fill ? fill(a) ?? 0 : itemPct(a) ?? 0, w: itemW(a) }));
  if (rows.length === 0) return 0;
  return aggregate(rows, comp.aggregation, comp.drop_so_far, 0);
}

/** Component average over marked items only, after drop_average. Null if nothing is marked. */
export function componentAverage(comp, items) {
  const rows = items
    .filter((a) => countsIn(a, 'average') && isMarked(a))
    .map((a) => ({ v: itemPct(a), w: itemW(a) }));
  if (rows.length === 0) return null;
  return aggregate(rows, comp.aggregation, comp.drop_average, 1);
}

const hasMarks = (items, view) => items.some((a) => countsIn(a, view) && isMarked(a));

/**
 * Effective weights after rules (absorb_if_higher). Compares so-far values.
 * With a fill (projection / "what do I need") the absorbing component counts as marked, so the rule applies to a
 * hypothetical final too.
 */
function effectiveWeights(comps, itemsOf, soFarOf, filled, base) {
  const w = new Map(base);
  for (const c of comps) {
    const r = parseRule(c.rule);
    if (!r || r.type !== RULES.absorb_if_higher || !Array.isArray(r.from)) continue;
    if (!(filled ? itemsOf(c).some((a) => countsIn(a, 'so_far')) : hasMarks(itemsOf(c), 'so_far'))) continue;
    for (const fromId of r.from) {
      const other = comps.find((x) => x.id === fromId);
      if (!other) continue;
      if (soFarOf(other) < soFarOf(c)) {
        w.set(c.id, w.get(c.id) + w.get(other.id));
        w.set(other.id, 0);
      }
    }
  }
  return w;
}

/**
 * Excused items. An excused item is left out of its component, and its share of the component's weight
 * (weight × item weight ÷ all counted item weights) moves to the component named by `excused_to`:
 *   null                                  → stays: the other items share it (nothing moves)
 *   {to: id}                              → that component
 *   {by_date: {pivot, before, after}}     → item dated before the pivot component's first date → `before`,
 *                                           on/after it, or either date missing → `after`
 * A component left with only excused items passes its whole weight on the same way (an excused midterm → Final,
 * including weight that excused quizzes had moved into it). Returns {weights, moves:[{from, to, weight, item_id}]}.
 */
export function excusedWeights(comps, itemsOf) {
  const w = new Map(comps.map((c) => [c.id, c.weight]));
  const moves = [];
  const real = new Map(comps.filter((c) => !c.is_bonus).map((c) => [c.id, c]));
  const counted = (c) => itemsOf(c).filter((a) => a.counts_in !== 'none');
  const firstDate = (id) => {
    const ds = itemsOf(real.get(id)).map((a) => a.date).filter(Boolean).sort();
    return ds[0] || null;
  };
  const target = (c, item) => {
    const r = parseRule(c.excused_to);
    if (!r) return null;
    let to = null;
    if (r.to !== undefined && r.to !== null) to = r.to;
    else if (r.by_date && real.has(r.by_date.pivot)) {
      const pivot = firstDate(r.by_date.pivot);
      to = item && item.date && pivot && item.date < pivot ? r.by_date.before : r.by_date.after;
    }
    return to !== c.id && real.has(to) ? to : null;
  };
  const move = (from, to, amount, itemId) => {
    if (!(amount > 0)) return;
    w.set(from, w.get(from) - amount);
    w.set(to, w.get(to) + amount);
    moves.push({ from, to, weight: amount, item_id: itemId });
  };
  for (const c of real.values()) {
    const items = counted(c);
    const sw = items.reduce((s, a) => s + itemW(a), 0);
    if (!(sw > 0)) continue;
    for (const a of items) {
      if (!a.excused) continue;
      const to = target(c, a);
      if (to !== null) move(c.id, to, (c.weight * itemW(a)) / sw, a.id);
    }
  }
  // Components with nothing left but excused items pass their whole (current) weight on. Bounded: no cycles.
  for (let pass = 0; pass < real.size; pass++) {
    let moved = false;
    for (const c of real.values()) {
      const items = counted(c);
      if (!items.length || !items.every((a) => a.excused) || !(w.get(c.id) > 1e-12)) continue;
      const to = target(c, null);
      if (to === null) continue;
      move(c.id, to, w.get(c.id), null);
      moved = true;
    }
    if (!moved) break;
  }
  return { weights: w, moves };
}

// raw → course curve → 100% cap.
const finish = (course, v) => {
  if (v === null) return null;
  let out = Math.max(0, applyCurve(parseCurve(course.curve), v, 100)); // like items: never below 0
  if (course.cap_100) out = Math.min(out, 1);
  return out;
};

/**
 * One course. `comps` = its (leaf) components, `itemsByComp` = Map(component id → items).
 * `fill(a)` optionally supplies a value for unmarked items (projection / "what do I need").
 */
export function courseResult(course, comps, itemsByComp, fill) {
  const itemsOf = (c) => itemsByComp.get(c.id) || [];
  const real = comps.filter((c) => !c.is_bonus);
  const bonus = comps.filter((c) => c.is_bonus);
  const soFarOf = (c) => componentSoFar(c, itemsOf(c), fill);
  const excused = excusedWeights(comps, itemsOf);
  const w = effectiveWeights(real, itemsOf, soFarOf, !!fill, excused.weights);

  const marked = real.some((c) => hasMarks(itemsOf(c), 'so_far') || hasMarks(itemsOf(c), 'average'));
  const components = new Map();
  for (const c of comps) {
    components.set(c.id, {
      weight: c.is_bonus ? c.weight : w.get(c.id),
      soFar: soFarOf(c),
      average: componentAverage(c, itemsOf(c)),
    });
  }

  // Grade so far = Σ(weight × so far)/100 + bonus, then the course curve and cap.
  let soFar = null, rawSoFar = null, rawAverage = null;
  if (marked || fill) {
    soFar = real.reduce((s, c) => s + w.get(c.id) * components.get(c.id).soFar, 0) / 100
      + bonus.reduce((s, c) => s + c.weight * components.get(c.id).soFar, 0) / 100;
    rawSoFar = soFar;
    soFar = finish(course, soFar);
  }

  // Current average = Σ(weight × average) over marked components ÷ (their weight − excess) + bonus.
  let average = null;
  const withAvg = real.filter((c) => components.get(c.id).average !== null);
  if (withAvg.length) {
    const totalW = real.reduce((s, c) => s + w.get(c.id), 0);
    const excess = Math.max(0, totalW - 100);
    const markedW = withAvg.reduce((s, c) => s + w.get(c.id), 0);
    // Weight over 100 acts as built-in bonus. The excess is subtracted in proportion to the weight marked so far:
    // all of it once everything is marked, a share of it early on, so one small marked component can't blow up the average.
    const den = totalW > 0 ? markedW - excess * (markedW / totalW) : markedW;
    if (den > 0) {
      average = withAvg.reduce((s, c) => s + w.get(c.id) * components.get(c.id).average, 0) / den
        + bonus.reduce((s, c) => s + c.weight * (components.get(c.id).average ?? 0), 0) / 100;
      rawAverage = average;
      average = finish(course, average);
    }
  }

  const warnings = [];
  for (const c of comps) {
    const r = parseRule(c.rule);
    if (r && r.type === RULES.min_warning) {
      const avg = components.get(c.id).average;
      if (avg !== null && avg < r.min) warnings.push({ type: 'min', component_id: c.id, label: r.label || `${c.name} min`, min: r.min, value: avg });
    }
  }
  return { soFar, average, raw: { soFar: rawSoFar, average: rawAverage }, hasMarks: marked, components, warnings, moves: excused.moves };
}

/**
 * A course as a candle (Graphs, "Class" view). Marked items that count toward the average (not excused) are replayed in
 * order: by date when every one has a date, otherwise by component then item order. open = the course's current
 * average after the first item(s) that give one; lo / hi = the lowest / highest single item % (curved), with the item.
 * `items` = how many marked items; 0 = no item-level detail (e.g. only a set final grade): open, lo and hi are then null.
 * The close is the course's own result (or set grade), so it is not computed here.
 */
export function courseCandle(course, comps, itemsByComp) {
  const seq = [];
  comps.forEach((c, ci) => (itemsByComp.get(c.id) || []).forEach((a, ii) => {
    if (isMarked(a) && countsIn(a, 'average')) seq.push({ a, c, k: ci * 1e6 + ii });
  }));
  if (!seq.length) return { items: 0, open: null, lo: null, hi: null };
  const dated = seq.every((x) => x.a.date);
  seq.sort((x, y) => (dated && x.a.date !== y.a.date ? (x.a.date < y.a.date ? -1 : 1) : x.k - y.k));
  let open = null;
  const shown = new Set();
  for (const x of seq) {
    shown.add(x.a);
    const partial = new Map();
    for (const c of comps) partial.set(c.id, (itemsByComp.get(c.id) || []).map((a) => (isMarked(a) && !shown.has(a) ? { ...a, mark: null } : a)));
    open = courseResult(course, comps, partial).average;
    if (open !== null) break;
  }
  let lo = null, hi = null;
  for (const x of seq) {
    const v = itemPct(x.a);
    const it = { name: x.a.name, component: x.c.name, v };
    if (!lo || v < lo.v) lo = it;
    if (!hi || v > hi.v) hi = it;
  }
  return { items: seq.length, open, lo, hi };
}

/** Projection for one course: your projections where entered, otherwise the current average. */
export function courseProjected(course, comps, itemsByComp, base) {
  const r = base || courseResult(course, comps, itemsByComp);
  if (!r.hasMarks && !comps.some((c) => c.projected != null || (itemsByComp.get(c.id) || []).some((a) => a.projected != null))) return null;
  const compOf = new Map();
  for (const c of comps) for (const a of itemsByComp.get(c.id) || []) compOf.set(a, c);
  const fill = (a) => {
    if (isMarked(a)) return itemPct(a);
    if (a.projected != null) return a.projected;
    const c = compOf.get(a);
    if (c.projected != null) return c.projected;
    if (c.is_bonus) return 0; // bonus isn't assumed
    return r.components.get(c.id).average ?? r.raw?.average ?? r.average ?? 0; // raw: the course curve is applied once, at the end
  };
  return courseResult(course, comps, itemsByComp, fill).soFar;
}

/**
 * "What do I need" (a projection): the uniform mark (fraction) needed on the remaining unmarked items to reach
 * `target` (fraction) as the course grade. `only` limits which items are solved for — an array of component ids, or
 * {components: [ids], items: [ids]}; every other unmarked item is then filled with its projection.
 * Returns {status, need, projection: true}:
 *   'guaranteed' (need 0), 'possible' (0 < need ≤ 1), 'over_100' (more than 100%, ≤ 150%), 'impossible', 'nothing_left'.
 */
export function needFor(course, comps, itemsByComp, target, only) {
  const base = courseResult(course, comps, itemsByComp);
  const spec = Array.isArray(only) ? { components: only } : only || null;
  const onlyComps = spec && spec.components ? new Set(spec.components) : null;
  const onlyItems = spec && spec.items ? new Set(spec.items) : null;
  const limited = !!(onlyComps || onlyItems);
  const compOf = new Map();
  for (const c of comps) for (const a of itemsByComp.get(c.id) || []) compOf.set(a, c);
  const open = (a) => {
    const c = compOf.get(a);
    return !isMarked(a) && !c.is_bonus && countsIn(a, 'so_far') // countsIn skips excused
      && (!onlyComps || onlyComps.has(c.id) || (c.ancestors || []).some((p) => onlyComps.has(p))) && (!onlyItems || onlyItems.has(a.id));
  };
  const out = (status, need) => ({ status, need, projection: true });
  const anyOpen = comps.some((c) => (itemsByComp.get(c.id) || []).some(open));
  if (!anyOpen) return out('nothing_left', null);
  const projFill = (a) => {
    if (a.projected != null) return a.projected;
    const c = compOf.get(a);
    if (c.projected != null) return c.projected;
    if (c.is_bonus) return 0;
    return base.components.get(c.id).average ?? base.raw.average ?? 0;
  };
  const gradeAt = (x) => courseResult(course, comps, itemsByComp, (a) => {
    if (isMarked(a)) return itemPct(a);
    if (open(a)) return x;
    return limited ? projFill(a) : 0;
  }).soFar;
  if (gradeAt(0) >= target - EPS) return out('guaranteed', 0);
  const MAX = 1.5;
  if (gradeAt(MAX) < target - EPS) return out('impossible', null);
  let lo = 0, hi = MAX;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (gradeAt(mid) >= target - EPS) hi = mid; else lo = mid;
  }
  return out(hi <= 1 + EPS ? 'possible' : 'over_100', hi);
}

/** "What do I need" on each remaining item on its own (others at their projection). Map(item id → needFor result). */
export function needPerItem(course, comps, itemsByComp, target) {
  const out = new Map();
  for (const c of comps) {
    if (c.is_bonus) continue;
    for (const a of itemsByComp.get(c.id) || []) {
      if (!isMarked(a) && countsIn(a, 'so_far')) out.set(a.id, needFor(course, comps, itemsByComp, target, { items: [a.id] }));
    }
  }
  return out;
}

/** Credit-weighted mean of course values. */
export function creditMean(results, key) {
  let s = 0, cr = 0;
  for (const { course, result, projected } of results) {
    const v = key === 'projected' ? projected : result[key];
    if (v === null || v === undefined) continue;
    s += course.credits * v;
    cr += course.credits;
  }
  return cr > 0 ? s / cr : null;
}

/**
 * A set final grade (course.final_override, a fraction, or course.final_letter) replaces the calculated grade
 * everywhere: so far, average, projected, GPA, and every average above the course. The course then counts as graded
 * even without marks. The calculated values stay in result.calculated so the page can show them beside it.
 * Only 'graded' courses use it.
 */
export function applyOverride(course, result, projected) {
  const ov = course.final_override;
  if (ov === null || ov === undefined || courseType(course) !== 'graded') return { result, projected };
  return {
    result: { ...result, soFar: ov, average: ov, hasMarks: true, overridden: true,
      calculated: { soFar: result.soFar, average: result.average, projected, hasMarks: result.hasMarks, raw: result.raw } },
    projected: ov,
  };
}

// ---------------------------------------------------------------- nested components

/**
 * Effective parent of every component: its parent_id when that parent exists in the same list and the chain above it
 * ends at a top-level component. A missing parent ('orphan'), itself, or a loop makes it top-level, with a warning,
 * so nothing is ever silently dropped from the grade.
 */
export function resolveParents(comps) {
  const byId = new Map(comps.map((c) => [c.id, c]));
  const parent = new Map(), warnings = [];
  for (const c of comps) {
    if (c.parent_id === null || c.parent_id === undefined) { parent.set(c.id, null); continue; }
    if (!byId.has(c.parent_id)) { parent.set(c.id, null); warnings.push({ type: 'orphan', component_id: c.id }); continue; }
    const seen = new Set([c.id]);
    let p = c.parent_id, ok = true;
    while (p !== null && p !== undefined && byId.has(p)) {
      if (seen.has(p)) { ok = false; break; }
      seen.add(p); p = byId.get(p).parent_id;
    }
    parent.set(c.id, ok ? c.parent_id : null);
    if (!ok) warnings.push({ type: 'nesting_loop', component_id: c.id });
  }
  return { parent, warnings };
}

/**
 * Components nest (the page offers one level; the math is safe at any depth). A parent's children share the parent's
 * course weight in proportion to their own weights (any numbers; equal shares if they are all 0). A parent with
 * children ignores items placed directly on it (warning 'parent_items'). Bonus is inherited from the parent.
 * A parent's own rules: min_warning is checked on its roll-up; absorb_if_higher "from" a parent means all of its leaves.
 * Returns {leaves (the components the math uses, weights converted to course weight, with ancestors[]),
 *          parents: Map(id → {comp, children: descendant leaves}), warnings}.
 */
export function flattenComponents(comps, itemsByComp = new Map()) {
  const { parent, warnings } = resolveParents(comps);
  const kidsOf = new Map();
  for (const c of comps) {
    const p = parent.get(c.id);
    if (p === null) continue;
    if (!kidsOf.has(p)) kidsOf.set(p, []);
    kidsOf.get(p).push(c);
  }
  const leaves = [], parents = new Map();
  const walk = (c, weight, bonus, ancestors) => {
    const kids = kidsOf.get(c.id);
    if (!kids || !kids.length) {
      leaves.push({ ...c, weight, is_bonus: bonus ? 1 : 0, ancestors });
      return [leaves[leaves.length - 1]];
    }
    if ((itemsByComp.get(c.id) || []).length) warnings.push({ type: 'parent_items', component_id: c.id });
    const sw = kids.reduce((s, k) => s + (k.weight > 0 ? k.weight : 0), 0);
    const mine = [];
    for (const k of kids) {
      const kw = sw > 0 ? (weight * Math.max(0, k.weight)) / sw : weight / kids.length;
      mine.push(...walk(k, kw, bonus || !!k.is_bonus, [...ancestors, c.id]));
    }
    parents.set(c.id, { comp: c, children: mine });
    return mine;
  };
  for (const c of comps) if (parent.get(c.id) === null) walk(c, c.weight, !!c.is_bonus, []);
  // absorb_if_higher "from" a parent → its leaves
  for (const l of leaves) {
    const r = parseRule(l.rule);
    if (r && r.type === RULES.absorb_if_higher && Array.isArray(r.from) && r.from.some((id) => parents.has(id))) {
      l.rule = { ...r, from: r.from.flatMap((id) => (parents.has(id) ? parents.get(id).children.map((k) => k.id) : [id])) };
    }
  }
  return { leaves, parents, warnings };
}

/** Adds each parent's roll-up to result.components (weight = sum of its leaves; so far / average weighted by them). */
function addParents(result, parents) {
  for (const [id, { comp, children }] of parents) {
    let w = 0, sf = 0, aw = 0, av = 0;
    for (const k of children) {
      const r = result.components.get(k.id);
      w += r.weight; sf += r.weight * r.soFar;
      if (r.average !== null) { aw += r.weight; av += r.weight * r.average; }
    }
    const average = aw > 0 ? av / aw : null;
    result.components.set(id, { weight: w, soFar: w > 0 ? sf / w : 0, average, children: children.map((k) => k.id), parentOf: comp.id });
    const r = parseRule(comp.rule);
    if (r && r.type === RULES.min_warning && average !== null && average < r.min) {
      result.warnings.push({ type: 'min', component_id: id, label: r.label || `${comp.name} min`, min: r.min, value: average });
    }
  }
  return result;
}

/** Live weight check (never blocks): total of the course's top-level non-bonus weights vs 100. */
export function weightCheck(comps) {
  const { parent } = resolveParents(comps);
  const total = comps.filter((c) => parent.get(c.id) === null && !c.is_bonus).reduce((s, c) => s + (Number(c.weight) || 0), 0);
  return { total, ok: Math.abs(total - 100) < 1e-6 || comps.length === 0 };
}

// ---------------------------------------------------------------- whole gradebook

/**
 * Letter-only marks become numbers here (estimate = middle of the letter's range, flagged `estimated`).
 * The stored document is never changed.
 */
function prepItem(a) {
  if (isMarked(a) || !a.letter) return a;
  const p = letterToPct(a.letter);
  if (p === null) return a;
  return { ...a, mark: p * (a.out_of || 1), estimated: true };
}
function prepCourse(c) {
  const out = { ...c, type: courseType(c), credits: Number.isFinite(Number(c.credits)) ? Math.max(0, Number(c.credits)) : 0 };
  if ((out.final_override === null || out.final_override === undefined) && out.final_letter) {
    const p = letterToPct(out.final_letter);
    if (p !== null) { out.final_override = p; out.final_estimated = true; }
  }
  return out;
}

/** Order terms the way the user arranged them (sort_order, then position in the list). */
const termRank = (terms) => new Map([...terms].map((t, i) => [t.id, [t.sort_order ?? i, i]])
  .sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1]).map(([id], i) => [id, i]));

/**
 * Everything at once from a gradebook document:
 *   {terms, courses, components, assessments, repeats?, settings?: {gpa_scale, custom_scale, repeat_policy_default}}
 * Returns per-course, per-term, per-year (year_of_study, when set) and cumulative results.
 *
 * Counts toward averages: 'graded' courses with marks or a set final grade. Pass/fail, transfer and withdrawn courses
 * never count in averages (pass/fail and transfer credits are reported separately).
 * Repeated courses (doc.repeats = [{id, course_ids, policy}]): term averages show every attempt in its own term;
 * year and cumulative averages count per the policy — 'latest' (the latest attempt that has a grade), 'best' (the
 * highest), or 'all'.
 * GPA: on a 'points' scale, the credit-weighted mean of each course's points; on a 'percent' scale there are no
 * points and the letter of the percentage average is shown.
 */
export function computeAll(doc) {
  const settings = doc.settings || {};
  const scale = resolveScale(settings);
  const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
  const items = (doc.assessments || []).map(prepItem);
  const itemsByComp = new Map();
  for (const a of [...items].sort(bySort)) {
    if (!itemsByComp.has(a.component_id)) itemsByComp.set(a.component_id, []);
    itemsByComp.get(a.component_id).push(a);
  }
  const allCompsByCourse = new Map();
  for (const c of [...(doc.components || [])].sort(bySort)) {
    if (!allCompsByCourse.has(c.course_id)) allCompsByCourse.set(c.course_id, []);
    allCompsByCourse.get(c.course_id).push(c);
  }
  const terms = doc.terms || [];
  const termById = new Map(terms.map((t) => [t.id, t]));
  const rank = termRank(terms);
  const courseList = (doc.courses || []).map(prepCourse);
  const courseOrder = new Map(courseList.map((c, i) => [c.id, i]));

  const compsByCourse = new Map();
  const courses = new Map();
  for (const course of courseList) {
    const all = allCompsByCourse.get(course.id) || [];
    const { leaves, parents, warnings: nestWarnings } = flattenComponents(all, itemsByComp);
    compsByCourse.set(course.id, leaves);
    const calc = addParents(courseResult(course, leaves, itemsByComp), parents);
    const check = weightCheck(all);
    calc.weightCheck = check;
    calc.warnings.push(...nestWarnings);
    if (!check.ok) calc.warnings.push({ type: 'weights', total: check.total });
    const graded = course.type === 'graded';
    const calcProjected = graded ? courseProjected(course, leaves, itemsByComp, calc) : null;
    const { result, projected } = applyOverride(course, calc, calcProjected);
    if (course.final_estimated && result.overridden) result.estimated = true;
    const pts = (v) => (graded ? gpaOf(v, scale) : null);
    courses.set(course.id, {
      course, result, projected,
      counts: graded && result.hasMarks,
      gpa: { soFar: pts(result.soFar), average: pts(result.average), projected: pts(projected) },
      letter: graded ? { soFar: letterOf(result.soFar, scale), average: letterOf(result.average, scale), projected: letterOf(projected, scale) } : null,
    });
  }

  // Repeats: which attempts count per view in year/cumulative averages. Decided among the attempts inside each scope,
  // so "cumulative to year 1" uses the year-1 attempt even when a later year has a retake.
  const value = (r, v) => (v === 'projected' ? r.projected : r.result[v]);
  const groups = [];
  const repeatOf = new Map();
  for (const g of doc.repeats || []) {
    const policy = REPEAT_POLICIES.includes(g.policy) ? g.policy : (REPEAT_POLICIES.includes(settings.repeat_policy_default) ? settings.repeat_policy_default : 'latest');
    const ids = new Set((g.course_ids || []).filter((id) => courses.has(id)));
    for (const id of ids) repeatOf.set(id, { group: g.id, policy });
    groups.push({ ids, policy });
  }
  const key = (a) => [rank.get(a.course.term_id) ?? -1, a.course.sort_order ?? 0, courseOrder.get(a.course.id)];
  const later = (a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i]; return false; };
  const excludedWithin = (list) => {
    const inScope = new Set(list.map((r) => r.course.id));
    const excluded = { soFar: new Set(), average: new Set(), projected: new Set() };
    for (const { ids, policy } of groups) {
      if (policy === 'all') continue;
      const attempts = [...ids].filter((id) => inScope.has(id)).map((id) => courses.get(id));
      if (attempts.length < 2) continue;
      for (const v of VIEWS) {
        const withGrade = attempts.filter((x) => x.counts && value(x, v) !== null && value(x, v) !== undefined);
        if (withGrade.length < 2) continue;
        const keep = withGrade.reduce((best, x) => (policy === 'best' ? (value(x, v) > value(best, v) ? x : best) : (later(x, best) ? x : best)));
        for (const x of withGrade) if (x !== keep) excluded[v].add(x.course.id);
      }
    }
    return excluded;
  };
  const all = [...courses.values()];
  const overall = excludedWithin(all);
  for (const [id, info] of repeatOf) courses.get(id).repeat = { ...info, excluded: Object.fromEntries(VIEWS.map((v) => [v, overall[v].has(id)])) };

  const summarize = (list, applyRepeats) => {
    const counted = list.filter((r) => r.counts);
    const excluded = applyRepeats ? excludedWithin(list) : null;
    const out = {};
    for (const v of VIEWS) {
      const use = excluded ? counted.filter((r) => !excluded[v].has(r.course.id)) : counted;
      out[v] = creditMean(use, v);
    }
    const pointsMean = (v) => {
      if (scale.kind === 'percent') return null;
      let s = 0, cr = 0;
      for (const r of counted) {
        if (excluded && excluded[v].has(r.course.id)) continue;
        const p = r.gpa[v];
        if (p === null || p === undefined) continue;
        s += r.course.credits * (p === 'Fail' ? 0 : p); cr += r.course.credits;
      }
      return cr > 0 ? s / cr : null;
    };
    out.gpa = { soFar: pointsMean('soFar'), average: pointsMean('average'), projected: pointsMean('projected') };
    out.letter = { soFar: letterOf(out.soFar, scale), average: letterOf(out.average, scale), projected: letterOf(out.projected, scale) };
    out.courses = counted.length;
    out.credits = counted.reduce((s, r) => s + r.course.credits, 0);
    out.passCredits = list.filter((r) => r.course.type === 'pass_fail' && r.course.pass_result === 'pass').reduce((s, r) => s + r.course.credits, 0);
    out.transferCredits = list.filter((r) => r.course.type === 'transfer').reduce((s, r) => s + r.course.credits, 0);
    return out;
  };
  const termResults = new Map();
  for (const t of terms) termResults.set(t.id, summarize(all.filter((r) => r.course.term_id === t.id), false));
  const yearList = [...new Set(terms.map((t) => t.year_of_study).filter((y) => Number.isFinite(y)))].sort((a, b) => a - b);
  const yearOf = (r) => termById.get(r.course.term_id)?.year_of_study;
  const years = new Map(), cumulativeTo = new Map();
  for (const y of yearList) {
    years.set(y, summarize(all.filter((r) => yearOf(r) === y), true));
    // cumulative up to and including year y (terms without a year come after every year)
    cumulativeTo.set(y, summarize(all.filter((r) => Number.isFinite(yearOf(r)) && yearOf(r) <= y), true));
  }
  return { courses, terms: termResults, years, yearList, cumulativeTo, cumulative: summarize(all, true), scale, compsByCourse, itemsByComp };
}
