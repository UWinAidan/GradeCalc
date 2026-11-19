// Shared test helpers. Synthetic data only.
import assert from 'node:assert/strict';

export { assert };

export const near = (actual, expected, msg = '', tol = 1e-9) => {
  if (expected === null) return assert.equal(actual, null, msg);
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) <= tol, `${msg} expected ${expected}, got ${actual}`);
};

// Build a course quickly: spec = [{name, weight, ...compFields, items: [mark | {mark, ...}]}]
let nextId = 1000;
export function makeCourse(spec, courseFields = {}) {
  const course = { id: nextId++, term_id: 1, credits: 3, adjust_points: 0, cap_100: 0, pass_fail: 0, ...courseFields };
  const comps = [];
  const itemsByComp = new Map();
  spec.forEach((c, ci) => {
    const { items = [], ...fields } = c;
    const comp = { id: fields.id ?? nextId++, course_id: course.id, weight: 0, is_bonus: 0, drop_so_far: 0, drop_average: 0,
      aggregation: 'mean', rule: null, projected: null, sort_order: ci, ...fields };
    comps.push(comp);
    itemsByComp.set(comp.id, items.map((it, ii) => {
      const a = typeof it === 'object' && it !== null ? it : { mark: it };
      return { id: nextId++, component_id: comp.id, name: `item ${ii + 1}`, out_of: 1, item_weight: null, counts_in: 'both',
        projected: null, sort_order: ii, ...a };
    }));
  });
  return { course, comps, itemsByComp };
}

// GPA scales in the old [[lower bound, points], ...] shorthand → a GradeCalc scale / settings object.
export const pointsScale = (pairs) => ({ id: 'custom', kind: 'points', bands: pairs.map(([min, points]) => ({ min, letter: '', points })) });
export const customSettings = (pairs) => ({ gpa_scale: 'custom', custom_scale: { kind: 'points', bands: pairs.map(([min, points]) => ({ min, points })) } });
