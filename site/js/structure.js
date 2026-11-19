// Edit-structure helpers with no DOM (Round 3): reorder, duplicate, bulk edit and "how would my average change" previews.
// The page (app.js) turns these plans into store writes; tests/structure.test.js runs them directly.
import { computeAll } from './calc.js';
import { parseMark } from './ui.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;

/** Move one entry of `ids` from index `from` to index `to` (both clamped); returns a new array. */
export function moveId(ids, from, to) {
  const out = [...ids];
  if (from < 0 || from >= out.length) return out;
  const t = Math.max(0, Math.min(out.length - 1, to));
  const [x] = out.splice(from, 1);
  out.splice(t, 0, x);
  return out;
}

/** sort_order 1..n for rows in the order `ids`: only the rows whose number changes. */
export function sortPatches(rows, ids) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  ids.forEach((id, i) => {
    const r = byId.get(id);
    if (r && (r.sort_order ?? 0) !== i + 1) out.push({ id, sort_order: i + 1 });
  });
  return out;
}

// ---------------------------------------------------------------- duplicate
const COURSE_KEEP = ['code', 'title', 'short_name', 'credits', 'type', 'cap_100', 'notes'];
const COURSE_RESULT = ['pass_result', 'curve', 'final_override', 'final_letter', 'status'];
const COMP_KEEP = ['name', 'weight', 'is_bonus', 'drop_so_far', 'drop_average', 'aggregation', 'rule', 'excused_to', 'sort_order'];
const ITEM_KEEP = ['name', 'out_of', 'item_weight', 'counts_in', 'sort_order'];
const ITEM_RESULT = ['mark', 'letter', 'excused', 'curve', 'projected', 'date'];
const pickKeys = (row, keys) => Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, clone(row[k])]));
const parseJson = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

/**
 * Plan for copying components (with their parts and items) of one course. `comps` = the components to copy (a parent's
 * parts are copied with it), `all` = every component of the source course, `items` = all its assessments.
 * withMarks: also copy marks, letters, excused flags, item curves, projections and dates.
 * Returns [{ old, parentOld, body, items: [body…] }] parents first; rules are remapped later with remapRefs().
 */
export function copyComponentsPlan(comps, all, items, { withMarks = false } = {}) {
  const ids = new Set(comps.map((k) => k.id));
  const list = [...comps];
  for (const k of [...all].sort(bySort)) if (!ids.has(k.id) && k.parent_id != null && ids.has(k.parent_id)) { ids.add(k.id); list.push(k); }
  const depth = (k) => { let d = 0, p = k.parent_id; const seen = new Set(); while (p != null && ids.has(p) && !seen.has(p)) { seen.add(p); d++; p = all.find((x) => x.id === p)?.parent_id; } return d; };
  return list.sort((a, b) => depth(a) - depth(b) || bySort(a, b)).map((k) => ({
    old: k.id,
    parentOld: k.parent_id != null && ids.has(k.parent_id) ? k.parent_id : null,
    body: { ...pickKeys(k, COMP_KEEP), ...(withMarks ? pickKeys(k, ['projected']) : {}) },
    items: items.filter((a) => a.component_id === k.id).sort(bySort)
      .map((a) => ({ ...pickKeys(a, ITEM_KEEP), ...(withMarks ? pickKeys(a, ITEM_RESULT) : {}) })),
  }));
}

/** The course row of a copy (results only with marks). */
export function copyCourseBody(course, { withMarks = false } = {}) {
  return { ...pickKeys(course, COURSE_KEEP), ...(withMarks ? pickKeys(course, COURSE_RESULT) : { status: 'active' }) };
}

/**
 * A copied component's rule / excused_to point at the *old* component ids. Map them to the new ids (`idMap` old → new).
 * Inside one course (`keepUnmapped`) an id that wasn't copied still exists and is kept; across courses it's dropped.
 * `dropUnmappedAbsorb` (duplicate inside one course): an absorb rule keeps only ids that were copied with it; the
 * original still takes the weight of anything else, and two rules competing for one component's weight would make
 * the grade depend on which comes first. Returns only the fields that need a patch.
 */
export function remapRefs(body, idMap, { keepUnmapped = false, dropUnmappedAbsorb = false } = {}) {
  const map = (id) => (idMap.has(id) ? idMap.get(id) : keepUnmapped ? id : null);
  const out = {};
  const rule = parseJson(body.rule);
  if (rule && rule.type === 'absorb_if_higher' && Array.isArray(rule.from)) {
    const from = rule.from.map((id) => (dropUnmappedAbsorb && !idMap.has(id) ? null : map(id))).filter((x) => x != null);
    const next = from.length ? { ...rule, from } : null;
    if (JSON.stringify(next) !== JSON.stringify(rule)) out.rule = next;
  }
  const ex = parseJson(body.excused_to);
  if (ex && ex.to != null) {
    const to = map(ex.to);
    const next = to == null ? null : { ...ex, to };
    if (JSON.stringify(next) !== JSON.stringify(ex)) out.excused_to = next;
  } else if (ex && ex.by_date) {
    const b = ex.by_date;
    const nb = { ...b, pivot: map(b.pivot), before: map(b.before), after: map(b.after) };
    const next = nb.pivot == null || nb.before == null || nb.after == null ? null : { by_date: nb };
    if (JSON.stringify(next) !== JSON.stringify(ex)) out.excused_to = next;
  }
  return out;
}

// ---------------------------------------------------------------- bulk edit
/** Text for the bulk box: one "Name: mark" line per item ("Name:" when unmarked). */
export function bulkText(items, markText) {
  // The page's short text (80.0%, 17 / 20) when it reads back as the stored mark; otherwise every stored digit, so
  // saving the box unchanged never rounds a mark (83.33% must not come back as 83.3%).
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const exact = (a) => {
    const t = markText(a);
    if (a.mark === null || a.mark === undefined) return t;
    const back = parseMark(t, a.out_of);
    if (!back.error && back.mark === r6(a.mark) && back.out_of === r6(a.out_of)) return t;
    return a.out_of === 1 ? `${r6(a.mark * 100)}%` : `${r6(a.mark)} / ${r6(a.out_of)}`;
  };
  return [...items].sort(bySort).map((a) => {
    const m = (a.mark === null || a.mark === undefined) && !a.letter ? '' : exact(a);
    return `${a.name}: ${m}`.trimEnd();
  }).join('\n');
}

/**
 * Parse the bulk box. Each line is "Name" or "Name: mark" (mark = 85, 85%, 17/20 or a letter; blank after ":" clears it).
 * A line whose name matches an item (case-insensitive) edits that item's mark; other lines add new items.
 * Items with no line are left alone (never deleted). Returns { updates: [{ item, changes }], creates: [body],
 * errors: [text], warnings: [text] }.
 */
export function parseBulk(text, items, { outOf = 1 } = {}) {
  const res = { updates: [], creates: [], errors: [], warnings: [] };
  const left = new Map();
  for (const a of [...items].sort(bySort)) {
    const k = a.name.trim().toLowerCase();
    if (!left.has(k)) left.set(k, []);
    left.get(k).push(a);
  }
  const lines = String(text).split(/\r?\n/);
  if (lines.length > 300) { res.errors.push('At most 300 lines at once'); return res; }
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (line.length > 300) { res.errors.push(`Line ${i + 1}: too long`); return; }
    const c = line.lastIndexOf(':');
    const name = (c === -1 ? line : line.slice(0, c)).trim();
    const markPart = c === -1 ? null : line.slice(c + 1).trim();
    if (!name) { res.errors.push(`Line ${i + 1}: needs a name before the “:”`); return; }
    if (name.length > 200) { res.errors.push(`Line ${i + 1}: name is too long`); return; }
    const match = left.get(name.toLowerCase())?.shift();
    let mark = null;
    if (markPart !== null) {
      const r = parseMark(markPart, match ? match.out_of : outOf);
      if (r.error) { res.errors.push(`Line ${i + 1} (${name}): ${r.error}`); return; }
      if (r.warn) res.warnings.push(`${name}: ${r.warn}`);
      mark = r;
    }
    if (match) {
      if (!mark) return; // a name alone: nothing to change
      const changes = {};
      // parseMark keeps 6 decimals: a stored mark with more is "the same" when it rounds to what was typed.
      const r6 = (x) => (x === null || x === undefined ? null : Math.round(x * 1e6) / 1e6);
      if (mark.mark !== r6(match.mark)) changes.mark = mark.mark;
      if ((mark.letter ?? null) !== (match.letter ?? null)) changes.letter = mark.letter;
      if (mark.out_of !== r6(match.out_of)) changes.out_of = mark.out_of;
      if (Object.keys(changes).length) res.updates.push({ item: match, changes });
    } else {
      res.creates.push({ name, mark: mark ? mark.mark : null, letter: mark ? mark.letter : null, out_of: mark ? mark.out_of : outOf });
    }
  });
  return res;
}

// ---------------------------------------------------------------- preview
/**
 * The rows the page shows and computes from (stored rows → live gradebook): terms in their order, and only rows whose
 * parents still exist (a deleted term hides its courses, a deleted group its parts at any depth, a deleted component
 * its items); repeat links keep only live attempts and need two of them.
 */
export function liveDoc(d) {
  const terms = [...d.terms].sort(bySort);
  const tIds = new Set(terms.map((t) => t.id));
  const courses = d.courses.filter((c) => tIds.has(c.term_id));
  const cIds = new Set(courses.map((c) => c.id));
  let components = d.components.filter((k) => cIds.has(k.course_id));
  for (let n = -1; n !== components.length;) {
    n = components.length;
    const ids = new Set(components.map((k) => k.id));
    components = components.filter((k) => k.parent_id === null || k.parent_id === undefined || ids.has(k.parent_id));
  }
  const kIds = new Set(components.map((k) => k.id));
  const assessments = d.assessments.filter((a) => kIds.has(a.component_id));
  const repeats = (d.repeats || []).map((g) => ({ ...g, course_ids: (g.course_ids || []).filter((id) => cIds.has(id)) }))
    .filter((g) => g.course_ids.length > 1);
  return { terms, courses, components, assessments, repeats, settings: d.settings };
}

/** Remove a row and everything under it from a plain copy of the gradebook (for previews).
 * Same rows the page hides after the delete (app.js recompute): courses of a deleted term, parts of a deleted group
 * (any depth), items of deleted components, and repeat links left with fewer than two attempts. */
export function dropFrom(doc, entity, id) {
  const gone = { terms: new Set(), courses: new Set(), components: new Set(), assessments: new Set() };
  gone[entity].add(id);
  for (const c of doc.courses) if (gone.terms.has(c.term_id)) gone.courses.add(c.id);
  for (let changed = true; changed;) {
    changed = false;
    for (const k of doc.components) {
      if (!gone.components.has(k.id) && (gone.courses.has(k.course_id) || gone.components.has(k.parent_id))) { gone.components.add(k.id); changed = true; }
    }
  }
  for (const a of doc.assessments) if (gone.components.has(a.component_id)) gone.assessments.add(a.id);
  for (const e of Object.keys(gone)) doc[e] = doc[e].filter((r) => !gone[e].has(r.id));
  doc.repeats = (doc.repeats || []).map((g) => ({ ...g, course_ids: g.course_ids.filter((x) => !gone.courses.has(x)) })).filter((g) => g.course_ids.length > 1);
}
/**
 * How averages would change: runs computeAll on a copy of `live` changed by `mutate(copy)`.
 * Returns { course: [before, after], term: [before, after], cumulative: [before, after] } (averages, fractions or null);
 * course / term only when their id is given and the row still exists. A projection: nothing is saved.
 */
export function previewDelta(live, mutate, { courseId = null, termId = null } = {}) {
  const before = computeAll(live);
  const copy = clone(live);
  mutate(copy);
  const after = computeAll(copy);
  const avg = (r, key, id) => (id == null ? undefined : r[key].get(id) ? (key === 'courses' ? r[key].get(id).result.average : r[key].get(id).average) : null);
  const out = { cumulative: [before.cumulative.average, after.cumulative.average] };
  if (courseId != null) out.course = [avg(before, 'courses', courseId), avg(after, 'courses', courseId)];
  if (termId != null) out.term = [avg(before, 'terms', termId), avg(after, 'terms', termId)];
  return out;
}
