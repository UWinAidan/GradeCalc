// courseCandle (Graphs "Class" view). Synthetic data only.
import { assert, near, makeCourse } from './helpers.js';
import { courseCandle, courseResult } from '../shared/calc.js';

const candle = ({ course, comps, itemsByComp }) => courseCandle(course, comps, itemsByComp);

test('candle: open = average after the first marked item (sort order), wicks = lowest / highest item', () => {
  const c = makeCourse([
    { name: 'Labs', weight: 40, items: [0.9, 0.5, null] },
    { name: 'Final', weight: 60, items: [{ mark: 35, out_of: 50 }] },
  ]);
  const k = candle(c);
  assert.equal(k.items, 3);
  near(k.open, 0.9);
  near(k.lo.v, 0.5); assert.equal(k.lo.name, 'item 2'); assert.equal(k.lo.component, 'Labs');
  near(k.hi.v, 0.9);
  near(courseResult(c.course, c.comps, c.itemsByComp).average, 0.7 * 0.4 + 0.7 * 0.6);
});

test('candle: dates order the items when every marked item has one', () => {
  const c = makeCourse([
    { name: 'A', weight: 50, items: [{ mark: 0.6, date: '2026-03-01' }] },
    { name: 'B', weight: 50, items: [{ mark: 0.8, date: '2026-01-15' }] },
  ]);
  near(candle(c).open, 0.8);
  c.itemsByComp.get(c.comps[1].id)[0].date = null; // one missing date: back to sort order
  near(candle(c).open, 0.6);
});

test('candle: excused and so-far-only items are skipped; curved % used', () => {
  const c = makeCourse([
    { name: 'A', weight: 50, items: [{ mark: 0.2, excused: 1 }, { mark: 0.1, counts_in: 'so_far' }, { mark: 40, out_of: 50, curve: '{"type":"add","value":5}' }] },
    { name: 'B', weight: 50, items: [0.7] },
  ]);
  const k = candle(c);
  assert.equal(k.items, 2);
  near(k.open, 0.9); near(k.hi.v, 0.9); near(k.lo.v, 0.7);
});

test('candle: no marked items = no item detail', () => {
  const k = candle(makeCourse([{ name: 'A', weight: 100, items: [null] }], { final_override: 0.8 }));
  assert.deepEqual(k, { items: 0, open: null, lo: null, hi: null });
});
