// Files (Round 4), with no DOM: JSON backup, Excel workbook tables, CSV of marks, course templates.
// The page (app.js) reads and writes the actual files (SheetJS for .xlsx, loaded only when needed); tests/files.test.js
// runs these directly. Everything imported goes through store.js normalize() before it is saved.
import { computeAll, letterToPct } from './calc.js';
import { liveDoc, copyComponentsPlan, copyCourseBody } from './structure.js';
import { normalize, emptyDoc, ENTITIES } from './store.js';

export const APP = 'GradeCalc';
export const FORMAT = 1;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20000; // per sheet / CSV
export const MAX_COLS = 64; // per sheet: GradeCalc's widest sheet has 18 columns
export const MAX_SHEETS = 20;
export const MAX_DEPTH = 10; // component nesting (the page offers one level; the math recurses per level)
const clone = (x) => JSON.parse(JSON.stringify(x));
const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const r10 = (x) => Math.round(x * 1e10) / 1e10; // marks have ≤ 6 decimals: ×100 and ÷100 come back exactly
const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const today = (d = new Date()) => d.toISOString().slice(0, 10);

export class FileError extends Error {}

/** An imported document must not nest components deeper than MAX_DEPTH (or in a long loop): calc.js walks every
 * chain and recurses per level, so a crafted file with a 20,000-deep chain would freeze, then break, the page on
 * every load once saved. Deleted rows count too (they can be restored). Linear: at most MAX_DEPTH steps per row. */
export function checkNesting(doc) {
  const parentOf = new Map(doc.components.map((k) => [k.id, k.parent_id ?? null]));
  for (const k of doc.components) {
    const seen = new Set([k.id]);
    for (let p = parentOf.get(k.id), n = 0; p !== null && parentOf.has(p) && !seen.has(p); p = parentOf.get(p)) {
      if (++n > MAX_DEPTH) throw new FileError(`Components are nested too deep (${MAX_DEPTH} levels at most).`);
      seen.add(p);
    }
  }
  return doc;
}

// ---------------------------------------------------------------- JSON backup (everything: history, Recently deleted)
export const backupName = (d = new Date()) => `gradecalc-backup-${today(d)}`;
export function backupFile(doc, at = new Date()) {
  return { app: APP, kind: 'backup', format: FORMAT, exported_at: at.toISOString(), gradebook: clone(doc) };
}

/** What a parsed .json file is: { kind: 'backup', doc } or { kind: 'template', template }. */
export function readJson(obj) {
  if (!isPlain(obj) || obj.app !== APP) throw new FileError('This isn’t a GradeCalc file.');
  if (typeof obj.format !== 'number' || obj.format > FORMAT) throw new FileError('This file is from a newer GradeCalc. Reload the page and try again.');
  if (obj.kind === 'backup') {
    if (!isPlain(obj.gradebook)) throw new FileError('The backup has no gradebook in it.');
    return { kind: 'backup', doc: checkNesting(normalize(obj.gradebook)) };
  }
  if (obj.kind === 'course-template') return { kind: 'template', template: readTemplate(obj) };
  throw new FileError('Unknown kind of GradeCalc file.');
}

// ---------------------------------------------------------------- course templates (structure only: never marks)
/** A course's structure as a shareable file: components, parts, items and rules, no marks, dates, curves or notes. */
export function courseTemplate(course, comps, items, at = new Date()) {
  const plan = copyComponentsPlan(comps.filter((k) => k.parent_id == null), comps, items);
  const { notes, ...body } = copyCourseBody(course);
  delete body.status;
  return {
    app: APP, kind: 'course-template', format: FORMAT, exported_at: at.toISOString(),
    course: body,
    components: plan.map((p) => ({ ref: p.old, parent_ref: p.parentOld, ...p.body, items: p.items })),
  };
}
const TEMPLATE_COURSE = ['code', 'title', 'short_name', 'credits', 'type', 'cap_100'];
const TEMPLATE_COMP = ['name', 'weight', 'is_bonus', 'drop_so_far', 'drop_average', 'aggregation', 'rule', 'excused_to', 'sort_order'];
const TEMPLATE_ITEM = ['name', 'out_of', 'item_weight', 'counts_in', 'sort_order'];
/** A template file → { course, plan } where plan has the shape of copyComponentsPlan (old ids = the file's refs). */
export function readTemplate(obj) {
  if (!isPlain(obj.course) || !Array.isArray(obj.components)) throw new FileError('The template is missing its course or components.');
  if (obj.components.length > 200) throw new FileError('Too many components in this template (200 at most).');
  // Run the rows through the store's cleaning: known fields only, right types, text capped.
  const one = (entity, row, keys) => {
    const d = normalize({ [entity]: [{ id: 1, ...row }] })[entity][0];
    return Object.fromEntries(keys.map((k) => [k, d[k]]));
  };
  const course = one('courses', obj.course, TEMPLATE_COURSE);
  if (!course.title) course.title = course.code || 'Course from a template';
  const refs = new Map(); // ref → nesting depth
  const plan = [];
  let itemCount = 0;
  for (const k of obj.components) {
    if (!isPlain(k) || !Number.isSafeInteger(k.ref) || refs.has(k.ref)) throw new FileError('A component in the template has no usable ref.');
    const parentOld = k.parent_ref == null ? null : k.parent_ref;
    if (parentOld !== null && !refs.has(parentOld)) throw new FileError('A part in the template comes before its group.');
    const depth = parentOld === null ? 0 : refs.get(parentOld) + 1;
    if (depth > MAX_DEPTH) throw new FileError(`Components are nested too deep (${MAX_DEPTH} levels at most).`);
    refs.set(k.ref, depth);
    const items = (Array.isArray(k.items) ? k.items : []).filter(isPlain);
    itemCount += items.length;
    if (itemCount > 2000) throw new FileError('Too many items in this template (2000 at most).');
    plan.push({ old: k.ref, parentOld, body: one('components', k, TEMPLATE_COMP), items: items.map((a) => one('assessments', a, TEMPLATE_ITEM)) });
  }
  return { course, plan };
}

// ---------------------------------------------------------------- Excel workbook (live rows; computed columns ignored on import)
const yes = (v) => (v ? 'yes' : '');
const isYes = (v) => v === true || v === 1 || /^(yes|y|true|1|x|✓)$/i.test(String(v ?? '').trim());
const jsonText = (v) => (v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
const pctCell = (v) => (v === null || v === undefined ? '' : Math.round(v * 1e4) / 100);
const CALC = ' (calculated)';

/** A percentage item (out of 1) shows as "85" with "%" as its out-of; a points item as "17" out of "20". */
function markCells(a) {
  const pctItem = a.out_of === 1;
  return [a.mark === null || a.mark === undefined ? '' : pctItem ? r10(a.mark * 100) : a.mark, pctItem ? '%' : a.out_of];
}

const SHEET_COLS = {
  Terms: ['Id', 'Name', 'Season', 'Year', 'Year of study', 'Archived', `Term average %${CALC}`],
  Courses: ['Id', 'Term id', 'Term', 'Code', 'Title', 'Short name', 'Credits', 'Type', 'Status', 'Pass/fail result', 'Cap at 100%',
    'Curve', 'Final grade %', 'Final letter', 'Notes', `Current average %${CALC}`, `Grade so far %${CALC}`, `Letter${CALC}`],
  Components: ['Id', 'Course id', 'Course', 'Parent id', 'Name', 'Weight %', 'Bonus', 'Drop lowest (so far)', 'Drop lowest (average)',
    'Aggregation', 'Projected %', 'Rule', 'Excused weight goes to'],
  Items: ['Id', 'Component id', 'Course', 'Component', 'Name', 'Mark', 'Out of', 'Letter', 'Item weight', 'Counts in', 'Excused',
    'Curve', 'Projected %', 'Date', `Percent${CALC}`],
  Repeats: ['Id', 'Course ids', 'Which attempt counts'],
  Settings: ['Setting', 'Value'],
};

/** The workbook as { sheetName: rows (arrays) }. `doc` = the stored document (deleted rows are left out). */
export function toSheets(doc, at = new Date()) {
  const live = liveDoc({ ...doc, terms: doc.terms.filter((r) => !r.deleted_at), courses: doc.courses.filter((r) => !r.deleted_at),
    components: doc.components.filter((r) => !r.deleted_at), assessments: doc.assessments.filter((r) => !r.deleted_at),
    repeats: (doc.repeats || []).filter((r) => !r.deleted_at) });
  const calc = computeAll(live);
  const terms = live.terms;
  const termName = new Map(terms.map((t) => [t.id, t.name]));
  const courses = terms.flatMap((t) => live.courses.filter((c) => c.term_id === t.id).sort(bySort));
  const courseName = new Map(courses.map((c) => [c.id, c.code || c.title]));
  const comps = courses.flatMap((c) => {
    const mine = live.components.filter((k) => k.course_id === c.id).sort(bySort);
    const out = [];
    const add = (parent) => { for (const k of mine.filter((x) => (x.parent_id ?? null) === parent)) { out.push(k); add(k.id); } };
    add(null);
    // A Parent id loop (only possible in an edited backup): calc treats every component on it as top-level, so the
    // sheet does too (Parent id blank) instead of leaving them out.
    for (const k of mine) if (!out.includes(k)) { out.push({ ...k, parent_id: null }); }
    return out;
  });
  const compName = new Map(comps.map((k) => [k.id, k.name]));
  const compCourse = new Map(comps.map((k) => [k.id, k.course_id]));
  const items = comps.flatMap((k) => live.assessments.filter((a) => a.component_id === k.id).sort(bySort));
  const itemPctOf = new Map();
  for (const list of calc.itemsByComp.values()) for (const a of list) if (a.mark !== null && a.mark !== undefined) itemPctOf.set(a.id, a.mark / (a.out_of || 1));
  const s = live.settings;
  const cum = calc.cumulative;
  return {
    'Read me': [
      ['GradeCalc export', at.toISOString().slice(0, 16).replace('T', ' ')],
      [],
      ['Each sheet is one kind of row: Terms, Courses, Components, Items, Repeats, Settings.'],
      ['You can edit this workbook and import it again (Files → Import). Keep the Id columns as they are; leave Id blank for a new row.'],
      ['A new row can name its parent instead of an id: Courses → Term; Components → Course (code or title); Items → Course + Component.'],
      ['Columns marked “(calculated)” are for reading only and are ignored on import. Rule, Curve and Excused columns are advanced (JSON text).'],
      ['Mark: a percent item has “%” in Out of (85 means 85%); a points item has a number (17 out of 20). Letter: A+ to F, used when there is no number.'],
      ['History and Recently deleted are not in this workbook: use the JSON backup to keep everything.'],
      [],
      [`Cumulative average${CALC}`, pctCell(cum.average)],
      [],
      ['Not affiliated with or endorsed by the University of Windsor.'],
    ],
    Terms: [SHEET_COLS.Terms, ...terms.map((t) => [t.id, t.name, t.season ?? '', t.year ?? '', t.year_of_study ?? '', yes(t.archived),
      calc.terms.get(t.id)?.courses ? pctCell(calc.terms.get(t.id).average) : ''])],
    Courses: [SHEET_COLS.Courses, ...courses.map((c) => {
      const r = calc.courses.get(c.id);
      return [c.id, c.term_id, termName.get(c.term_id) ?? '', c.code ?? '', c.title, c.short_name ?? '', c.credits, c.type, c.status,
        c.pass_result ?? '', yes(c.cap_100), jsonText(c.curve), c.final_override === null ? '' : r10(c.final_override * 100), c.final_letter ?? '', c.notes ?? '',
        r && c.type === 'graded' ? pctCell(r.result.average) : '', r && c.type === 'graded' ? pctCell(r.result.soFar) : '', r?.letter?.average ?? ''];
    })],
    Components: [SHEET_COLS.Components, ...comps.map((k) => [k.id, k.course_id, courseName.get(k.course_id) ?? '', k.parent_id ?? '', k.name, k.weight,
      yes(k.is_bonus), k.drop_so_far || '', k.drop_average || '', k.aggregation, k.projected === null ? '' : r10(k.projected * 100),
      jsonText(k.rule), jsonText(k.excused_to)])],
    Items: [SHEET_COLS.Items, ...items.map((a) => [a.id, a.component_id, courseName.get(compCourse.get(a.component_id)) ?? '', compName.get(a.component_id) ?? '',
      a.name, ...markCells(a), a.letter ?? '', a.item_weight ?? '', a.counts_in, yes(a.excused), jsonText(a.curve),
      a.projected === null ? '' : r10(a.projected * 100), a.date ?? '', itemPctOf.has(a.id) ? pctCell(itemPctOf.get(a.id)) : ''])],
    Repeats: [SHEET_COLS.Repeats, ...live.repeats.map((g) => [g.id, g.course_ids.join(', '), g.policy ?? ''])],
    Settings: [SHEET_COLS.Settings, ['gpa_scale', s.gpa_scale], ['repeat_policy_default', s.repeat_policy_default],
      ['default_credits', s.default_credits], ['custom_scale', jsonText(s.custom_scale)]],
  };
}

// ---- reading sheets back
const norm = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
/** Rows (arrays) with a header row → objects keyed by the lower-case header; empty rows skipped. */
function records(rows, sheet) {
  if (!Array.isArray(rows) || !rows.length) return [];
  if (rows.length > MAX_ROWS + 1) throw new FileError(`${sheet}: too many rows (${MAX_ROWS} at most).`);
  const head = (Array.isArray(rows[0]) ? rows[0] : []).slice(0, MAX_COLS).map(norm);
  return rows.slice(1).filter((r) => Array.isArray(r) && r.some((v) => !blank(v))).map((r, i) => {
    // No prototype: a header called "__proto__" or "constructor" is just an unknown column.
    const o = Object.create(null);
    o._row = i + 2;
    head.forEach((h, j) => { if (h && !h.endsWith(CALC)) o[h] = r[j]; });
    return o;
  });
}
// A date cell is local midnight (SheetJS): use the local calendar day (east of UTC, toISOString() is the day before).
const localDay = (v) => { const t = new Date(v.getTime() + 30000); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
const text = (v) => (blank(v) ? null : v instanceof Date ? localDay(v) : String(v).trim());
const COUNTS_IN = ['both', 'so_far', 'average', 'none'];
function numOf(v, where, { nullable = true } = {}) {
  if (blank(v)) { if (nullable) return null; throw new FileError(`${where}: a number is needed.`); }
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.').replace(/%$/, ''));
  if (!Number.isFinite(n)) throw new FileError(`${where}: “${String(v).slice(0, 30)}” isn’t a number.`);
  return n;
}
function jsonOf(v, where) {
  if (blank(v)) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch { throw new FileError(`${where}: not valid JSON text (leave it as exported, or empty).`); }
}
const pctOf = (v, where) => { const n = numOf(v, where); return n === null ? null : r10(n / 100); };
function idOf(v, where) {
  if (blank(v)) return null;
  const n = numOf(v, where);
  if (!Number.isSafeInteger(n) || n <= 0) throw new FileError(`${where}: ids are whole numbers above 0.`);
  return n;
}

/** Mark + Out of (+ Letter) cells → { mark, out_of, letter }. "%" (or blank) out of = a percentage item. */
function markOf(markCell, outCell, letterCell, where) {
  const outText = blank(outCell) ? '%' : String(outCell).trim();
  const pctItem = outText === '%';
  const out = pctItem ? 1 : numOf(outText, `${where}, Out of`);
  if (!(out > 0) || out > 1e6) throw new FileError(`${where}: “Out of” must be more than 0.`);
  let mark = numOf(markCell, `${where}, Mark`);
  if (mark !== null) {
    if (mark < 0) throw new FileError(`${where}: a mark can’t be negative.`);
    mark = pctItem ? r10(mark / 100) : mark;
    if (mark / out > 5) throw new FileError(`${where}: more than 500% (typo?).`);
  }
  const letter = text(letterCell)?.toUpperCase() ?? null;
  if (letter !== null && letterToPct(letter) === null) throw new FileError(`${where}: letters are A+ to D-, or F.`);
  return { mark, out_of: out, letter };
}

/** A workbook ({ sheetName: rows }) exported by toSheets (maybe edited) → a document. Throws FileError with the row. */
export function fromSheets(sheets) {
  const get = (name) => sheets[Object.keys(sheets).find((k) => norm(k) === norm(name))];
  if (!get('Courses') && !get('Items')) {
    // Not a GradeCalc workbook: the first sheet may be a marks table (same columns as the CSV).
    const first = Object.values(sheets)[0];
    if (first) return fromMarksTable(first);
    throw new FileError('No sheets in this file.');
  }
  const d = emptyDoc();
  const used = new Set();
  let next = 1;
  const take = (id) => { if (id === null) return null; if (used.has(id)) throw new FileError(`Id ${id} is used twice.`); used.add(id); return id; };
  const pending = []; // rows without an id get one after every given id is known
  const add = (entity, id, row) => { const r = { id, ...row }; d[entity].push(r); if (id === null) pending.push(r); return r; };

  for (const r of records(get('Terms'), 'Terms')) {
    const w = `Terms row ${r._row}`;
    const name = text(r.name);
    if (!name) throw new FileError(`${w}: a term needs a name.`);
    add('terms', take(idOf(r.id, w)), { name, season: text(r.season), year: numOf(r.year, w), year_of_study: numOf(r['year of study'], w),
      archived: isYes(r.archived) ? 1 : 0, sort_order: d.terms.length + 1 });
  }
  // Lookups go through Maps: a 20,000-row file must not take n² steps (it would freeze the tab).
  const group = (rows, key) => { const m = new Map(); for (const r of rows) for (const k of key(r)) { if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const termById = new Map(d.terms.filter((t) => t.id !== null).map((t) => [t.id, t]));
  const termsByName = group(d.terms, (t) => [t.name.toLowerCase()]);
  const findTerm = (id, name, w) => {
    const same = id !== null ? [] : termsByName.get(String(name ?? '').trim().toLowerCase()) || [];
    if (same.length > 1) throw new FileError(`${w}: more than one term is called “${text(name)}”; use its Term id.`);
    const t = id !== null ? termById.get(id) : same[0];
    if (!t) throw new FileError(`${w}: no term ${id !== null ? `with id ${id}` : `named “${text(name) ?? ''}”`} in the Terms sheet.`);
    return t;
  };
  const courseOrder = new Map();
  for (const r of records(get('Courses'), 'Courses')) {
    const w = `Courses row ${r._row}`;
    const term = findTerm(idOf(r['term id'], w), r.term, w);
    const title = text(r.title) ?? text(r.code);
    if (!title) throw new FileError(`${w}: a course needs a title or code.`);
    const type = text(r.type) ?? 'graded';
    if (!['graded', 'pass_fail', 'transfer', 'withdrawn'].includes(type)) throw new FileError(`${w}: Type is graded, pass_fail, transfer or withdrawn.`);
    const finalLetter = text(r['final letter'])?.toUpperCase() ?? null;
    if (finalLetter !== null && letterToPct(finalLetter) === null) throw new FileError(`${w}: Final letter is A+ to D-, or F.`);
    const n = (courseOrder.get(term) ?? 0) + 1;
    courseOrder.set(term, n);
    add('courses', take(idOf(r.id, w)), { term, code: text(r.code), title, short_name: text(r['short name']),
      credits: numOf(r.credits, w) ?? 3, type, status: text(r.status) === 'complete' ? 'complete' : 'active',
      pass_result: ['pass', 'fail'].includes(text(r['pass/fail result'])) ? text(r['pass/fail result']) : null, cap_100: isYes(r['cap at 100%']) ? 1 : 0,
      curve: jsonOf(r.curve, `${w}, Curve`), final_override: pctOf(r['final grade %'], w), final_letter: finalLetter,
      notes: text(r.notes), sort_order: n });
  }
  const courseById = new Map(d.courses.filter((c) => c.id !== null).map((c) => [c.id, c]));
  const coursesByKey = group(d.courses, (c) => new Set([(c.code ?? '').toLowerCase(), c.title.toLowerCase()]));
  const findCourse = (id, name, w) => {
    const key = String(name ?? '').trim().toLowerCase();
    if (id === null && !key) throw new FileError(`${w}: name its course (Course id, or the code or title in Course).`);
    const c = id !== null ? courseById.get(id) : coursesByKey.get(key) || [];
    if (Array.isArray(c) && c.length > 1) throw new FileError(`${w}: more than one course is called “${text(name)}”; use its Course id.`);
    const one = Array.isArray(c) ? c[0] : c;
    if (!one) throw new FileError(`${w}: no course ${id !== null ? `with id ${id}` : `called “${text(name) ?? ''}”`} in the Courses sheet.`);
    return one;
  };
  const compRows = records(get('Components'), 'Components');
  const compOrder = new Map();
  for (const r of compRows) {
    const w = `Components row ${r._row}`;
    const course = findCourse(idOf(r['course id'], w), r.course, w);
    const name = text(r.name);
    if (!name) throw new FileError(`${w}: a component needs a name.`);
    const n = (compOrder.get(course) ?? 0) + 1;
    compOrder.set(course, n);
    r._comp = add('components', take(idOf(r.id, w)), { course, parent: null, name, weight: numOf(r['weight %'], w) ?? 0,
      is_bonus: isYes(r.bonus) ? 1 : 0, drop_so_far: numOf(r['drop lowest (so far)'], w) ?? 0, drop_average: numOf(r['drop lowest (average)'], w) ?? 0,
      aggregation: text(r.aggregation) ?? 'mean', projected: pctOf(r['projected %'], w), rule: jsonOf(r.rule, `${w}, Rule`),
      excused_to: jsonOf(r['excused weight goes to'], `${w}, Excused weight goes to`), sort_order: n });
  }
  const compById = new Map(d.components.filter((k) => k.id !== null).map((k) => [k.id, k]));
  const compsByName = new Map(); // course row → lower-case name → components
  for (const k of d.components) {
    if (!compsByName.has(k.course)) compsByName.set(k.course, new Map());
    const m = compsByName.get(k.course), key = k.name.toLowerCase();
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(k);
  }
  for (const r of compRows) {
    const pid = idOf(r['parent id'], `Components row ${r._row}`);
    if (pid === null) continue;
    const p = compById.get(pid)?.course === r._comp.course ? compById.get(pid) : null;
    if (!p) throw new FileError(`Components row ${r._row}: no component with id ${pid} in the same course.`);
    r._comp.parent = p;
  }
  for (const r of compRows) {
    const seen = new Set();
    for (let k = r._comp; k; k = k.parent) {
      if (seen.has(k)) throw new FileError(`Components row ${r._row}: its Parent id makes a loop (a group inside itself).`);
      if (seen.size > MAX_DEPTH) throw new FileError(`Components row ${r._row}: nested too deep (${MAX_DEPTH} levels at most).`);
      seen.add(k);
    }
  }
  const itemOrder = new Map();
  for (const r of records(get('Items'), 'Items')) {
    const w = `Items row ${r._row}`;
    const cid = idOf(r['component id'], w);
    let comp;
    if (cid !== null) comp = compById.get(cid);
    else {
      const course = findCourse(null, r.course, w);
      const key = String(r.component ?? '').trim().toLowerCase();
      const list = compsByName.get(course)?.get(key) || [];
      if (list.length > 1) throw new FileError(`${w}: more than one component is called “${text(r.component)}”; use its Component id.`);
      comp = list[0];
    }
    if (!comp) throw new FileError(`${w}: no component ${cid !== null ? `with id ${cid}` : `“${text(r.component) ?? ''}”`} in the Components sheet.`);
    const name = text(r.name);
    if (!name) throw new FileError(`${w}: an item needs a name.`);
    const n = (itemOrder.get(comp) ?? 0) + 1;
    itemOrder.set(comp, n);
    const counts = text(r['counts in']) ?? 'both';
    add('assessments', take(idOf(r.id, w)), { comp, name, ...markOf(r.mark, r['out of'], r.letter, w), item_weight: numOf(r['item weight'], w),
      counts_in: COUNTS_IN.includes(counts) ? counts : 'both', excused: isYes(r.excused) ? 1 : 0,
      curve: jsonOf(r.curve, `${w}, Curve`), projected: pctOf(r['projected %'], w), date: text(r.date), sort_order: n });
  }
  for (const r of records(get('Repeats'), 'Repeats')) {
    const w = `Repeats row ${r._row}`;
    const ids = String(r['course ids'] ?? '').split(/[,;\s]+/).filter(Boolean).map((x) => idOf(x, w));
    const policy = text(r['which attempt counts']);
    add('repeats', take(idOf(r.id, w)), { course_ids: ids, policy: ['best', 'latest', 'all'].includes(policy) ? policy : null });
  }
  const settings = {};
  for (const r of records(get('Settings'), 'Settings')) {
    const k = text(r.setting);
    if (k === 'custom_scale') settings.custom_scale = jsonOf(r.value, `Settings ${k}`);
    else if (k) settings[k] = typeof r.value === 'number' ? r.value : text(r.value);
  }
  d.settings = settings;
  // Ids for new rows, then parents as ids.
  for (const e of ENTITIES) for (const r of d[e]) if (r.id !== null) next = Math.max(next, r.id + 1);
  for (const r of pending) r.id = next++;
  for (const c of d.courses) { c.term_id = c.term.id; delete c.term; }
  for (const k of d.components) { k.course_id = k.course.id; k.parent_id = k.parent ? k.parent.id : null; delete k.course; delete k.parent; }
  for (const a of d.assessments) { a.component_id = a.comp.id; delete a.comp; }
  d.next_id = next;
  return checkNesting(normalize(d));
}

// ---------------------------------------------------------------- CSV: one row per item (marks and the basic structure)
export const MARKS_COLS = ['Term', 'Year of study', 'Course code', 'Course title', 'Credits', 'Component', 'Weight %', 'Item', 'Mark', 'Out of', 'Letter', 'Date', 'Excused'];
/** The marks table (header + one row per item; a component or course with nothing under it still gets a row). */
export function marksTable(doc) {
  const s = toSheets(doc);
  const rows = [MARKS_COLS];
  const t = new Map(records(s.Terms, 'Terms').map((r) => [r.id, r]));
  const comps = records(s.Components, 'Components');
  const items = records(s.Items, 'Items');
  for (const c of records(s.Courses, 'Courses')) {
    const term = t.get(c['term id']);
    const base = [term.name, term['year of study'], c.code, c.title, c.credits];
    const mine = comps.filter((k) => k['course id'] === c.id);
    if (!mine.length) rows.push([...base, '', '', '', '', '', '', '', '']);
    for (const k of mine) {
      // A group's parts carry its name: "Labs › Part 1".
      const parent = mine.find((p) => p.id === k['parent id']);
      if (mine.some((x) => x['parent id'] === k.id)) continue;
      const kname = parent ? `${parent.name} › ${k.name}` : k.name;
      const weight = parent ? '' : k['weight %'];
      const its = items.filter((a) => a['component id'] === k.id);
      if (!its.length) rows.push([...base, kname, weight, '', '', '', '', '', '']);
      for (const a of its) rows.push([...base, kname, weight, a.name, a.mark, a['out of'], a.letter, a.date, a.excused]);
    }
  }
  return rows;
}

/**
 * A marks table (CSV or the first sheet of any workbook) → a document. Needs at least Course (code or title) and
 * Component columns; terms, courses and components are matched by name, in the order they first appear.
 * "Group › Part" component names become a group with parts. Weight % is read from the first row of each component.
 */
export function fromMarksTable(rows) {
  const recs = records(rows, 'Table');
  if (!recs.length) throw new FileError('The table is empty.');
  const has = (k) => Object.prototype.hasOwnProperty.call(recs[0], k);
  if (!(has('course code') || has('course title') || has('course')) || !has('component')) {
    throw new FileError('Needs a header row with at least “Course code” (or “Course title”) and “Component” columns, like the CSV GradeCalc exports.');
  }
  const d = emptyDoc();
  let id = 1;
  const terms = new Map(), courses = new Map(), comps = new Map();
  const count = new Map(); // sort_order counters (not a scan per row: 20,000 rows stay linear)
  const nextIn = (key) => { const n = (count.get(key) ?? 0) + 1; count.set(key, n); return n; };
  for (const r of recs) {
    const w = `Row ${r._row}`;
    const tname = text(r.term) ?? 'Imported';
    let term = terms.get(tname.toLowerCase());
    if (!term) {
      term = { id: id++, name: tname, year_of_study: numOf(r['year of study'], w), sort_order: terms.size + 1 };
      terms.set(tname.toLowerCase(), term); d.terms.push(term);
    }
    const code = text(r['course code']), title = text(r['course title']) ?? text(r.course) ?? code;
    if (!title) throw new FileError(`${w}: needs a course code or title.`);
    const ckey = `${term.id}|${(code ?? '').toLowerCase()}|${title.toLowerCase()}`;
    let course = courses.get(ckey);
    if (!course) {
      course = { id: id++, term_id: term.id, code, title, credits: numOf(r.credits, w) ?? 3, sort_order: nextIn(`t${term.id}`) };
      courses.set(ckey, course); d.courses.push(course);
    }
    const kname = text(r.component);
    if (!kname) continue; // a course with no components yet
    const parts = kname.split('›').map((x) => x.trim()).filter(Boolean);
    const compFor = (names, parent) => {
      const key = `${course.id}|${names.join('›').toLowerCase()}`;
      let k = comps.get(key);
      if (!k) {
        k = { id: id++, course_id: course.id, parent_id: parent ? parent.id : null, name: names[names.length - 1], weight: 0,
          sort_order: nextIn(`c${course.id}|${parent ? parent.id : ''}`) };
        comps.set(key, k); d.components.push(k);
      }
      return k;
    };
    const top = compFor(parts.slice(0, 1), null);
    if (top.weight === 0 && !blank(r['weight %'])) top.weight = numOf(r['weight %'], w);
    const leaf = parts.length > 1 ? compFor(parts.slice(0, 2), top) : top;
    if (parts.length > 1) leaf.weight = 1; // parts share the group's weight equally
    const iname = text(r.item);
    if (!iname) continue;
    d.assessments.push({ id: id++, component_id: leaf.id, name: iname, ...markOf(r.mark, r['out of'], r.letter, w), date: text(r.date),
      excused: isYes(r.excused) ? 1 : 0, sort_order: nextIn(`k${leaf.id}`) });
  }
  d.next_id = id;
  return normalize(d);
}

/** RFC 4180 CSV. Text that a spreadsheet would run as a formula (= + - @ tab CR at the start) gets a leading
 * apostrophe; so does text that already starts with apostrophes before one of those, so that parseCsv (which takes
 * exactly one off) gives back what was typed. */
const GUARDED = /^'*[=+\-@\t\r]/;
const UNGUARD = /^'(?='*[=+\-@\t\r])/;
export function toCsv(rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (typeof v === 'string' && GUARDED.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
export function parseCsv(textIn) {
  const t = String(textIn).replace(/^﻿/, '');
  const delim = (t.split(/\r?\n/, 1)[0].match(/;/g) || []).length > (t.split(/\r?\n/, 1)[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  const push = () => { row.push(cur); cur = ''; };
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === delim) push();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; push(); rows.push(row); row = []; if (rows.length > MAX_ROWS + 1) throw new FileError(`Too many rows (${MAX_ROWS} at most).`); }
    else cur += ch;
  }
  if (q) throw new FileError('The CSV has an unclosed quote.');
  if (cur !== '' || row.length) { push(); rows.push(row); }
  // The formula guard toCsv adds (quoted cell or not) comes off once, here only.
  return rows.map((r) => r.map((v) => v.replace(UNGUARD, '')));
}

// ---------------------------------------------------------------- add one gradebook to another
/** `incoming` (a normalized document) added to `base`: new ids for every row, references moved with them. History,
 * settings and Recently deleted stay the base's; deleted rows of the incoming file (and rows hidden under them) are not added. */
export function appendDoc(base, incoming) {
  const out = clone(base);
  const map = new Map();
  let next = out.next_id;
  // Only the rows the student sees in the file: not deleted, and not under a deleted term, course or group (a part of
  // a deleted group would otherwise come back as a top-level component and change the course's grade).
  const visible = liveDoc({ ...incoming, terms: incoming.terms.filter((r) => !r.deleted_at), courses: incoming.courses.filter((r) => !r.deleted_at),
    components: incoming.components.filter((r) => !r.deleted_at), assessments: incoming.assessments.filter((r) => !r.deleted_at),
    repeats: (incoming.repeats || []).filter((r) => !r.deleted_at) });
  const liveIn = {};
  for (const e of ENTITIES) { const ids = new Set(visible[e].map((r) => r.id)); liveIn[e] = incoming[e].filter((r) => ids.has(r.id)); }
  for (const e of ENTITIES) for (const r of liveIn[e]) map.set(`${e}:${r.id}`, next++);
  const to = (e, v) => (v === null || v === undefined ? v : map.get(`${e}:${v}`) ?? null);
  const parse = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);
  const termMax = Math.max(0, ...out.terms.filter((t) => !t.deleted_at).map((t) => t.sort_order ?? 0));
  // A repeat with no policy of its own follows the default in Settings. Settings stay yours, so pin the file's default
  // on its repeats when it differs: the file's attempts keep counting the way they did.
  const fileDefault = incoming.settings?.repeat_policy_default;
  const pin = fileDefault && fileDefault !== out.settings?.repeat_policy_default ? fileDefault : null;
  for (const e of ENTITIES) {
    for (const r of liveIn[e]) {
      const n = { ...clone(r), id: to(e, r.id) };
      if (e === 'terms') n.sort_order = termMax + (r.sort_order ?? 0);
      if (e === 'courses') n.term_id = to('terms', r.term_id);
      if (e === 'components') {
        n.course_id = to('courses', r.course_id);
        n.parent_id = to('components', r.parent_id);
        const rule = parse(r.rule);
        if (rule && Array.isArray(rule.from)) n.rule = { ...rule, from: rule.from.map((x) => to('components', x)).filter((x) => x !== null) };
        const ex = parse(r.excused_to);
        if (ex && ex.to != null) n.excused_to = { ...ex, to: to('components', ex.to) };
        else if (ex && ex.by_date) n.excused_to = { by_date: { ...ex.by_date, pivot: to('components', ex.by_date.pivot), before: to('components', ex.by_date.before), after: to('components', ex.by_date.after) } };
      }
      if (e === 'assessments') n.component_id = to('components', r.component_id);
      if (e === 'repeats') {
        n.course_ids = r.course_ids.map((x) => to('courses', x)).filter((x) => x !== null);
        if (!n.policy && pin) n.policy = pin;
      }
      out[e].push(n);
    }
  }
  out.next_id = next;
  return normalize(out);
}

/** Counts for the import question: live terms, courses, items with a mark. */
export function summary(doc) {
  const live = liveDoc({ ...doc, terms: doc.terms.filter((r) => !r.deleted_at), courses: doc.courses.filter((r) => !r.deleted_at),
    components: doc.components.filter((r) => !r.deleted_at), assessments: doc.assessments.filter((r) => !r.deleted_at), repeats: doc.repeats || [] });
  return { terms: live.terms.length, courses: live.courses.length, items: live.assessments.length,
    marks: live.assessments.filter((a) => (a.mark !== null && a.mark !== undefined) || a.letter).length };
}


// ---------------------------------------------------------------- reading a spreadsheet file (SheetJS passed in)
/** Options for XLSX.read: rows past the cap are never parsed (the cap still trips in records()). */
export const XLSX_READ_OPTS = { type: 'array', cellDates: true, dense: true, sheetRows: MAX_ROWS + 2 };
/**
 * A parsed workbook → { sheetName: rows (arrays) } for fromSheets. The range of each sheet is clamped first: a tiny
 * file can declare "A1:XFD1048576" (or put one cell there), and sheet_to_json with defval would then build billions
 * of cells and freeze the tab. GradeCalc's widest sheet has 18 columns; MAX_COLS leaves room for added ones.
 */
export function sheetsFromWorkbook(X, wb) {
  const out = Object.create(null);
  for (const n of wb.SheetNames.slice(0, MAX_SHEETS)) {
    const ws = wb.Sheets[n];
    if (!ws || !ws['!ref']) { out[n] = []; continue; }
    const r = X.utils.decode_range(ws['!ref']);
    r.e.c = Math.min(r.e.c, r.s.c + MAX_COLS - 1);
    r.e.r = Math.min(r.e.r, r.s.r + MAX_ROWS + 1);
    out[n] = X.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, range: r });
  }
  return out;
}
