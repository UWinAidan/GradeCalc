// GradeCalc page: overview / term / course panes, inline editing, Edit structure mode, + Mark sheet, history,
// recently deleted, settings, demo data. Ported from Gradebook's page; data lives in this browser (store.js).
// All math comes from calc.js (a copy of shared/calc.js, the same code the tests run).
// Projections are always labelled and never saved as marks.
import { computeAll, needFor, needPerItem, parseCurve, curvedMark, itemPct, rawPct, courseCandle, SCALES, letterToPct } from './calc.js';
import { api, onExternalChange, emptyDoc } from './store.js';
import {
  h, fill, pct, num, when, parseMark, markText, editable, editorHooks, toast, openDialog, closeDialog, confirmDialog,
} from './ui.js';
import { openWizard, guessSeason } from './wizard.js';
import { bellChart, clusterChart, cumulativeChart, termChart, componentChart } from './charts.js';
import { demoDoc } from './demo.js';
import { backupName, backupFile, readJson, toSheets, fromSheets, marksTable, fromMarksTable, toCsv, parseCsv, appendDoc, summary, courseTemplate, MAX_FILE_BYTES, XLSX_READ_OPTS, sheetsFromWorkbook } from './files.js';
import { moveId, sortPatches, copyComponentsPlan, copyCourseBody, remapRefs, bulkText, parseBulk, previewDelta, dropFrom, liveDoc } from './structure.js';

const S = {
  data: null,          // api.all() (live rows only)
  live: null,          // data minus rows under a deleted parent, terms sorted
  calc: null,          // computeAll(live)
  structure: false,    // Edit structure mode
  editing: 0,          // open inline editors (renders wait until they close)
  dirty: false,
  collapsed: new Set(),
  lastCourseId: null,
  ruleDraft: new Map(), // component id → rule type picked but not complete yet
  info: new Set(),      // open ⓘ explanations
  needUpdate: null,     // refreshes the "what do I need" answers after a render
};

const $ = (id) => document.getElementById(id);
const panes = { overview: $('pane-overview'), term: $('pane-term'), course: $('pane-course') };
const mobileQuery = matchMedia('(max-width: 899px)');
const isMobile = () => mobileQuery.matches;
const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id;
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: fine */ } },
};
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const parseRule = (r) => { if (!r) return null; if (typeof r === 'object') return r; try { return JSON.parse(r); } catch { return null; } };
// Curves: item curves are typed as "+2", "×1.1" (or x / *), "=45" in the item's own points (% for items out of 1).
const itemUnit = (a) => (a.out_of === 1 ? 100 : 1);
const curveText = (c, unit = 1) => (!c ? '' : c.type === 'add' ? `${c.value < 0 ? '−' : '+'}${num(Math.abs(c.value) * unit)}`
  : c.type === 'mul' ? `×${num(c.value)}` : `=${num(c.value * unit)}`);
function parseItemCurve(text, a) {
  const t = String(text).trim().replace(',', '.').replace('−', '-');
  if (!t) return { value: null };
  const m = /^([+\-]|[x×*]|=)\s*(\d*\.?\d+)$/i.exec(t);
  if (!m) return { error: 'Curve: +2, −1, ×1.1 or =45' };
  const n = Number(m[2]);
  if (m[1] === '+' || m[1] === '-') return { value: { type: 'add', value: (m[1] === '-' ? -n : n) / itemUnit(a) } };
  if (m[1] === '=') return { value: { type: 'set', value: n / itemUnit(a) } };
  if (n > 10) return { error: 'Curve factor must be 0–10' };
  return { value: { type: 'mul', value: n } };
}
const courseCurveText = (c) => (!c ? '' : c.type === 'add' ? `curve ${c.value < 0 ? '−' : '+'}${num(Math.abs(c.value))} pts`
  : c.type === 'mul' ? `curve ×${num(c.value)}` : `curve set to ${pct(c.value, 1)}`);
const isMarked = (a) => (a.mark !== null && a.mark !== undefined) || !!a.letter;
const isOpenItem = (a) => !isMarked(a) && !a.excused && (a.counts_in === 'both' || a.counts_in === 'so_far' || a.counts_in == null);

const TYPE_LABEL = { graded: 'Graded', pass_fail: 'Pass/fail', transfer: 'Transfer credit', withdrawn: 'Withdrawn' };
const POLICY_LABEL = { best: 'Best attempt counts', latest: 'Latest attempt counts', all: 'All attempts count' };
const typeOf = (c) => c.type || 'graded';

// ---------------------------------------------------------------- data
function recompute() {
  S.live = liveDoc(S.data);
  S.calc = computeAll(S.live);
}
const coursesOf = (term) => S.live.courses.filter((c) => c.term_id === term.id).sort(bySort);
const leavesOf = (course) => S.calc.compsByCourse.get(course.id) || [];  // calc's copies: math only, never patched
const rawComps = (course) => S.live.components.filter((k) => k.course_id === course.id).sort(bySort);
const topComps = (course) => rawComps(course).filter((k) => k.parent_id === null || k.parent_id === undefined);
const kidsOf = (k) => S.live.components.filter((x) => x.parent_id === k.id).sort(bySort);
const rawItems = (k) => S.live.assessments.filter((a) => a.component_id === k.id).sort(bySort);
const calcItem = (a) => (S.calc.itemsByComp.get(a.component_id) || []).find((x) => x.id === a.id) || a;
const defaultCredits = () => Number(S.data.settings.default_credits) || 3;
const courseLabel = (c) => c.code || c.short_name || c.title;
const termOf = (c) => S.live.terms.find((t) => t.id === c.term_id);
const hasData = () => S.live.terms.length > 0;

// Letter on a percentage scale (UWindsor), grade points on a points scale.
const isPoints = () => S.calc.scale.kind === 'points';
const fmtGpa = (g) => (g === null || g === undefined ? '—' : g === 'Fail' ? 'Fail' : (Math.round(g * 100) / 100).toFixed(2));
const gradeFoot = (gpa, letter) => (isPoints() ? `GPA ${fmtGpa(gpa)}` : `Letter ${letter || '—'}`);
const gradeCell = (gpa, letter) => (isPoints() ? fmtGpa(gpa) : letter || '—');

// ---------------------------------------------------------------- routing: #/t12/c34
const termSlug = (t) => `t${t.id}`;
const courseSlug = (c) => `c${c.id}`;
const termHash = (t) => `#/${termSlug(t)}`;
const courseHash = (t, c) => `#/${termSlug(t)}/${courseSlug(c)}`;

function currentTerm() {
  // Latest term with an active course that has marks; then latest with any active course; then the last term.
  const all = [...S.live.terms].reverse();
  const ts = all.some((t) => !t.archived) ? all.filter((t) => !t.archived) : all;
  const active = (t) => coursesOf(t).filter((c) => c.status === 'active');
  return ts.find((t) => active(t).some((c) => S.calc.courses.get(c.id).result.hasMarks))
    || ts.find((t) => active(t).length) || ts[0] || null;
}
function readRoute() {
  const [ts, cs] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean); // slugs are t<id>/c<id>: no decoding needed
  // Home ("#/", also "#/graphs") = Graphs. "#/overview" = Overview with the current term.
  if (!ts || ts === 'graphs') return { graphs: true, term: null, course: null, depth: 1, shownTerm: null };
  const term = S.live.terms.find((t) => termSlug(t) === ts) || null;
  const course = term && cs ? coursesOf(term).find((c) => courseSlug(c) === cs) || null : null;
  const depth = course ? 2 : term ? 1 : 0;
  const shownTerm = term || (!isMobile() ? currentTerm() : null);
  return { term, course, depth, shownTerm };
}

// ---------------------------------------------------------------- save state + writes
let inflight = 0;
function setSave(kind, text) {
  const el = $('save-state');
  el.className = `save-state ${kind}`;
  el.textContent = text;
}
/** A save was refused because another tab changed the gradebook: say so until the page is reloaded (never a silent drop). */
function showConflict() {
  const b = $('conflict');
  if (b) b.hidden = false;
}
async function track(promise) {
  inflight++;
  setSave('', 'Saving…');
  try {
    const r = await promise;
    if (--inflight === 0) setSave('ok', 'Saved in this browser');
    return r;
  } catch (e) {
    inflight--;
    setSave('err', `Not saved: ${e.message}`);
    if (e && e.status === 409) showConflict();
    throw e;
  }
}

// ---------------------------------------------------------------- undo / redo (this tab, this visit)
// Every saved change is recorded as an operation; changes made together (duplicate, bulk edit, reorder, the wizard)
// form one step. Undo applies the inverse through the store (a create is undone by a soft delete, so redo restores the
// same row), and both directions are logged in History like any other change.
const UNDO_MAX = 100;
const H = { undo: [], redo: [], tx: null, busy: false, last: null }; // last = the step the latest batch() recorded (or null)
const ENTITY_WORD = { courses: 'course', components: 'component', assessments: 'item', terms: 'term', repeats: 'repeat link', settings: 'settings' };
function record(op, label) {
  if (H.busy) return null;
  if (H.tx) { if (!H.tx.stale) H.tx.ops.push(op); return H.tx; }
  const tx = { label, ops: [op] };
  H.undo.push(tx);
  if (H.undo.length > UNDO_MAX) H.undo.shift();
  H.redo = [];
  undoButtons();
  return tx;
}
/** Run several writes as one undo step. */
async function batch(label, fn) {
  if (H.tx) return fn(); // already inside one
  const tx = { label, ops: [] };
  H.tx = tx;
  try { return await fn(); } finally {
    H.tx = null;
    // A batch the history was cleared under (another tab changed the gradebook) is never kept: its ids may mean other rows.
    H.last = tx.ops.length && !tx.stale ? tx : null;
    if (H.last) { H.undo.push(tx); if (H.undo.length > UNDO_MAX) H.undo.shift(); H.redo = []; }
    undoButtons();
  }
}
async function applyOp(op, dir) {
  const back = dir === 'undo';
  if (op.type === 'patch') return api.patch(op.entity, op.id, back ? op.before : op.after);
  if (op.type === 'settings') return api.settings(back ? op.before : op.after);
  const hide = op.type === 'create' || op.type === 'restore' ? back : !back; // create/restore undone = delete again
  return hide ? api.remove(op.entity, op.id) : api.restore(op.entity, op.id);
}
async function stepHistory(dir) {
  const from = dir === 'undo' ? H.undo : H.redo;
  if (H.busy || H.tx || !from.length || S.editing) return;
  const tx = from.pop();
  H.busy = true;
  try {
    // Every row the step touches must still exist (it can't be half applied); otherwise the history is out of date.
    const doc = api.snapshot();
    if (tx.ops.some((op) => op.type !== 'settings' && !(doc[op.entity] || []).some((r) => r.id === op.id))) {
      throw new Error('a row it changes is gone (another tab?). Undo starts fresh');
    }
    for (const op of dir === 'undo' ? [...tx.ops].reverse() : tx.ops) await track(applyOp(op, dir));
    (dir === 'undo' ? H.redo : H.undo).push(tx);
    toast(`${dir === 'undo' ? 'Undone' : 'Redone'}: ${tx.label}`, dir === 'undo'
      ? { action: { label: 'Redo', fn: () => { if (H.redo[H.redo.length - 1] === tx) redo(); } } } : {});
  } catch (e) {
    H.undo = []; H.redo = []; // the gradebook changed under us (another tab?): start a fresh history
    toast(`Couldn’t ${dir}: ${e.message}`, { error: true });
  } finally {
    H.busy = false;
    await reload();
    undoButtons();
  }
}
const undo = () => stepHistory('undo');
const redo = () => stepHistory('redo');
function clearUndo() { H.undo = []; H.redo = []; H.last = null; if (H.tx) H.tx.stale = true; undoButtons(); }
function undoButtons() {
  const u = $('undo'), r = $('redo');
  if (!u) return;
  u.disabled = !H.undo.length; r.disabled = !H.redo.length;
  u.title = H.undo.length ? `Undo: ${H.undo[H.undo.length - 1].label} (Ctrl+Z)` : 'Nothing to undo';
  r.title = H.redo.length ? `Redo: ${H.redo[H.redo.length - 1].label} (Ctrl+Y)` : 'Nothing to redo';
}
/** A toast's "Undo": the undo stack when this change is still the last step, else `fallback`. */
const undoAction = (tx, fallback) => ({ label: 'Undo', fn: () => (tx && H.undo[H.undo.length - 1] === tx ? undo() : fallback && fallback()) });

/** Edit a row: recalculates at once, then saves. `row` may be a copy; the stored row is found by id. */
function patch(entity, row, changes, label) {
  if (H.tx && H.tx.stale) return Promise.resolve(); // the gradebook changed in another tab part-way through: stop
  const real = S.data[entity].find((r) => r.id === row.id) || row;
  const prev = {};
  for (const k of Object.keys(changes)) prev[k] = real[k] === undefined ? null : clone(real[k]);
  Object.assign(real, changes);
  recompute(); render();
  return track(api.patch(entity, real.id, changes))
    .then((res) => {
      Object.assign(real, res);
      if (Object.keys(changes).some((k) => JSON.stringify(prev[k]) !== JSON.stringify(changes[k]))) {
        record({ type: 'patch', entity, id: real.id, before: prev, after: clone(changes) },
          label || `edit ${ENTITY_WORD[entity]} ${real.name || real.title || ''}`.trim());
      }
    })
    .catch((e) => {
      for (const k of Object.keys(changes)) if (real[k] === changes[k]) real[k] = prev[k];
      toast(`Not saved: ${e.message}`, { error: true });
    })
    .finally(() => { recompute(); render(); });
}
async function create(entity, body) {
  if (H.tx && H.tx.stale) return null; // the gradebook changed in another tab part-way through: stop
  try {
    const row = await track(api.create(entity, body));
    S.data[entity].push(row);
    record({ type: 'create', entity, id: row.id }, `add ${ENTITY_WORD[entity]} ${row.name || row.title || ''}`.trim());
    recompute(); render();
    return row;
  } catch (e) {
    toast(`Not saved: ${e.message}`, { error: true });
    return null;
  }
}

async function removeRow(entity, row, label) {
  try {
    await track(api.remove(entity, row.id));
  } catch (e) {
    toast(`Not deleted: ${e.message}`, { error: true });
    return;
  }
  const tx = record({ type: 'remove', entity, id: row.id }, `delete ${label}`);
  S.data[entity] = S.data[entity].filter((r) => r.id !== row.id);
  recompute(); render();
  toast(`Deleted ${label}`, { action: undoAction(tx, () => restoreRow(entity, row.id, label)) });
}

async function restoreRow(entity, id, label) {
  try {
    await track(api.restore(entity, id));
    record({ type: 'restore', entity, id }, `restore ${label}`);
    await reload();
    toast(`Restored ${label}`);
  } catch (e) {
    toast(`Not restored: ${e.message}`, { error: true });
  }
}

async function reload() {
  S.data = await api.all();
  recompute(); render();
}

async function saveSettings(changes) {
  try {
    const before = clone(S.data.settings);
    S.data.settings = await track(api.settings(changes));
    if (JSON.stringify(before) !== JSON.stringify(S.data.settings)) record({ type: 'settings', before, after: clone(S.data.settings) }, 'change settings');
    recompute(); render();
    return true;
  } catch (e) {
    toast(`Not saved: ${e.message}`, { error: true });
    return false;
  }
}

// ---------------------------------------------------------------- reorder: ↑/↓ buttons everywhere, drag and drop with a mouse
let drag = null; // { group, id }: set only by a drag that started on this page, so drops from elsewhere are ignored
async function reorder(entity, rows, from, to, word) {
  if (to < 0 || to >= rows.length || from === to) return;
  const changes = sortPatches(rows, moveId(rows.map((r) => r.id), from, to));
  const name = rows[from].name || rows[from].title || word;
  await batch(`move ${name}`, async () => {
    for (const c of changes) await patch(entity, rows.find((r) => r.id === c.id), { sort_order: c.sort_order });
  });
}
/** ⠿ handle + ↑ ↓ for row `i` of `rows` (stored rows in shown order). `group` keeps drags inside one list. */
function orderCtl(entity, rows, i, group) {
  const r = rows[i];
  const name = r.name || r.title || r.code || '';
  return h('span', { class: 'order no-print', on: { click: (e) => e.stopPropagation(), keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); } } },
    h('span', { class: 'drag', draggable: 'true', title: 'Drag to reorder', 'aria-hidden': 'true', text: '⠿', on: {
      dragstart: (e) => { drag = { group, id: r.id }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(r.id)); },
      dragend: () => { drag = null; for (const x of document.querySelectorAll('.drop')) x.classList.remove('drop'); } } }),
    h('button', { class: 'btn tiny', type: 'button', 'aria-label': `Move ${name} up`, title: 'Move up', text: '↑', disabled: i === 0,
      dataset: { k: `order:${entity}:${r.id}:up` }, on: { click: () => reorder(entity, rows, i, i - 1) } }),
    h('button', { class: 'btn tiny', type: 'button', 'aria-label': `Move ${name} down`, title: 'Move down', text: '↓', disabled: i === rows.length - 1,
      dataset: { k: `order:${entity}:${r.id}:down` }, on: { click: () => reorder(entity, rows, i, i + 1) } }));
}
/** Make `el` a drop spot for row `i` of the same list. */
function dropSpot(el, entity, rows, i, group) {
  el.addEventListener('dragover', (e) => { if (drag && drag.group === group) { e.preventDefault(); e.stopPropagation(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', (e) => {
    if (!drag || drag.group !== group) return;
    e.preventDefault(); e.stopPropagation();
    const from = rows.findIndex((x) => x.id === drag.id); // by id: the list may have been redrawn since the drag began
    drag = null;
    el.classList.remove('drop');
    if (from !== -1) reorder(entity, rows, from, i);
  });
  return el;
}

// ---------------------------------------------------------------- previews: how an average would change (never saved)
/** "Course average 81.20% → 79.05%" lines for the averages a change would move. */
function deltaLines(d) {
  const same = (p) => p && (p[0] === p[1] || (p[0] !== null && p[1] !== null && Math.abs(p[0] - p[1]) < 5e-5));
  const line = (label, p) => (p === undefined ? null : `${label}: ${pct(p[0])} → ${p[1] === null ? 'no grade' : pct(p[1])}${same(p) ? ' (no change)' : ''}`);
  return [line('Course average', d.course), d.term && !same(d.term) ? line('Term average', d.term) : null,
    !same(d.cumulative) ? line('Cumulative average', d.cumulative) : null].filter(Boolean);
}
function previewBox(d) {
  const lines = deltaLines(d);
  return lines.length ? h('div', { class: 'preview small' }, h('span', { class: 'est', text: 'preview' }), lines.map((l) => h('div', { text: l }))) : null;
}

// ---------------------------------------------------------------- parsers for structure fields
const numberField = (min, max, { nullable = false, int = false, label = 'Value' } = {}) => (text) => {
  const s = String(text).trim();
  if (s === '') return nullable ? { value: null } : { error: `${label} can’t be empty` };
  const v = Number(s);
  if (!Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
    return { error: `${label} must be ${int ? 'a whole number' : 'a number'} ${min}–${max}` };
  }
  return { value: v };
};
const pctField = (label) => (text) => { // projections: typed as %, stored as a fraction
  const s = String(text).trim().replace('%', '');
  if (s === '') return { value: null };
  const v = Number(s);
  if (!Number.isFinite(v) || v < 0 || v > 150) return { error: `${label} must be 0–150%` };
  return { value: Math.round(v * 1e4) / 1e6 };
};
const textField = (label, { required = false, max = 200 } = {}) => (text) => {
  const s = String(text).trim();
  if (!s) return required ? { error: `${label} can’t be empty` } : { value: null };
  if (s.length > max) return { error: `${label} is too long` };
  return { value: s };
};
const pctOut = (v) => (v === null || v === undefined ? '' : num(v * 100));

/** One labelled input for Edit structure mode; saves on change. */
function field(label, entity, row, key, { type = 'text', parse, format, options, wide = false, placeholder, decimal = false } = {}) {
  const k = `${entity}:${row.id}:${key}`;
  const save = (raw) => {
    const r = parse ? parse(raw) : { value: raw === '' ? null : raw };
    if (r.error) { toast(r.error, { error: true }); render(); return; }
    if (r.value === row[key]) return;
    patch(entity, row, { [key]: r.value });
  };
  let input;
  if (type === 'checkbox') {
    input = h('input', { type: 'checkbox', checked: !!row[key], dataset: { k },
      on: { change: (e) => patch(entity, row, { [key]: e.target.checked ? 1 : 0 }) } });
    return h('label', { class: 'field check' }, input, label);
  }
  if (type === 'select') {
    input = h('select', { dataset: { k }, on: { change: (e) => save(e.target.value) } },
      options.map(([v, l]) => h('option', { value: v, text: l, selected: String(row[key] ?? '') === v })));
  } else if (type === 'textarea') {
    input = h('textarea', { rows: '2', dataset: { k }, on: { change: (e) => save(e.target.value) } });
    input.value = row[key] ?? '';
  } else {
    input = h('input', { type, value: format ? format(row[key]) : row[key] ?? '', dataset: { k }, placeholder,
      inputmode: decimal ? 'decimal' : null,
      on: { change: (e) => save(e.target.value), keydown: (e) => { if (e.key === 'Enter') e.target.blur(); } } });
  }
  return h('label', { class: `field${wide ? ' wide' : ''}` }, label, input);
}

// ---------------------------------------------------------------- small view parts
const stat = (label, value, foot, cls = '') => h('div', { class: `stat ${cls}` },
  h('div', { class: 'label' }, label), h('div', { class: 'value', text: value }), foot ? h('div', { class: 'foot', text: foot }) : null);
// Overview: "so far" only makes sense for the term in progress (across the degree it mixes finished and open terms).
function thisTermSoFar() {
  const t = currentTerm();
  const s = t && S.calc.terms.get(t.id);
  return stat('This term so far', s && s.courses ? pct(s.soFar) : '—', t ? `${t.name}, unmarked = 0` : null);
}
/** ⓘ button that shows / hides an explanation (S.info remembers which ones are open across re-renders). */
function infoTip(key, text) {
  const open = S.info.has(key);
  const note = h('p', { class: 'info-note small', id: `info-${key}`, hidden: !open, text });
  const btn = h('button', { class: 'info-btn', type: 'button', 'aria-label': 'What does this mean?', title: text,
    'aria-expanded': open ? 'true' : 'false', 'aria-controls': note.id, text: 'ⓘ', on: { click: (e) => {
      e.stopPropagation();
      if (S.info.has(key)) S.info.delete(key); else S.info.add(key);
      note.hidden = !S.info.has(key);
      btn.setAttribute('aria-expanded', S.info.has(key) ? 'true' : 'false');
    } } });
  return { btn, note };
}
// Follows the default in Settings (one course can override it in Edit structure).
const CUM_INFO = {
  best: 'Repeated courses count only your best attempt in the cumulative, but each year’s average keeps the grade from that year, so the cumulative can be higher or lower than every year average.',
  latest: 'Repeated courses count only your latest attempt in the cumulative, but each year’s average keeps the grade from that year, so the cumulative can be higher or lower than every year average.',
  all: 'Repeated courses count every attempt, in the cumulative and in each year’s average.',
};
const cumInfo = () => `${CUM_INFO[S.data.settings.repeat_policy_default] || CUM_INFO.best} Change this in Settings, or for one course in Edit structure.`;
const est = () => h('span', { class: 'est', title: 'Projection: an estimate, not a grade', text: 'est.' });

function courseBadges(course, cr) {
  const out = [];
  for (const w of cr.result.warnings.filter((x) => x.type === 'min')) {
    out.push(h('span', { class: 'badge warn', title: `${w.label}: ${pct(w.value, 1)}`, text: `${w.label.replace(/\s*\d+%$/, '')} at risk` }));
  }
  const type = typeOf(course);
  if (type === 'pass_fail') {
    out.push(h('span', { class: `badge ${course.pass_result === 'pass' ? 'good' : course.pass_result === 'fail' ? 'bad' : ''}`,
      text: course.pass_result ? (course.pass_result === 'pass' ? 'Pass' : 'Fail') : 'Pass/fail' }));
  } else if (type !== 'graded') out.push(h('span', { class: 'badge', text: TYPE_LABEL[type] }));
  if (cr.repeat) {
    const out1 = cr.repeat.excluded.average;
    out.push(h('span', { class: `badge${out1 ? '' : ' set'}`, title: POLICY_LABEL[cr.repeat.policy],
      text: out1 ? 'Repeat · not counted' : 'Repeat · counts' }));
  }
  const curve = parseCurve(course.curve);
  if (curve && type === 'graded' && cr.result.raw && cr.result.raw.average !== null && !cr.result.overridden) {
    out.push(h('span', { class: 'badge', title: `${courseCurveText(curve)}; raw ${pct(cr.result.raw.average)}`, text: 'Curved' }));
  }
  if (cr.result.overridden) {
    out.push(h('span', { class: 'badge set', title: `Final grade set by hand. Calculated: ${cr.result.calculated.average === null ? 'no marks' : pct(cr.result.calculated.average)}`, text: 'Set' }));
  }
  if (course.status === 'complete') out.push(h('span', { class: 'badge', text: 'Complete' }));
  else if (!cr.result.hasMarks && type === 'graded') out.push(h('span', { class: 'badge', text: 'No marks yet' }));
  return out;
}

function nextName(comp) {
  const items = rawItems(comp);
  const last = items[items.length - 1];
  const m = last && /^(.*?)(\d+)\s*$/.exec(last.name);
  if (m) return `${m[1]}${Number(m[2]) + 1}`;
  return `${comp.name.replace(/s$/i, '')} ${items.length + 1}`;
}

function suggestTermName() {
  const d = new Date();
  const m = d.getMonth();
  return `${m <= 3 ? 'Winter' : m <= 7 ? 'Summer' : 'Fall'} ${d.getFullYear()}`;
}

function siteFooter() {
  return h('footer', { class: 'site' },
    h('div', { class: 'links' }, h('span', { text: '© 2026 Aidan Brown' }),
      h('a', { href: 'https://aidanwbrown.com', target: '_blank', rel: 'noopener', text: 'aidanwbrown.com' }),
      h('a', { href: '/about', text: 'About' }), h('a', { href: '/privacy', text: 'Privacy' })),
    h('div', { class: 'disclaimer', text: 'Not affiliated with or endorsed by the University of Windsor.' }));
}

/** Small footer for the term, graphs and course panes (phones show one pane at a time, so the Overview footer is hidden). */
const miniFooter = () => h('footer', { class: 'site mini' },
  h('span', { text: 'Not affiliated with or endorsed by the University of Windsor.' }), ' ',
  h('a', { href: '/about', text: 'About' }), ' · ', h('a', { href: '/privacy', text: 'Privacy' }));

// ---------------------------------------------------------------- welcome (nothing yet)
function renderWelcome() {
  fill(panes.overview);
  fill(panes.course);
  fill(panes.term,
    h('div', { class: 'welcome-box' },
      h('img', { src: '/favicon.svg', alt: '', width: '56', height: '56' }),
      h('h1', { text: 'GradeCalc' }),
      h('p', { class: 'lead', text: 'A free grade calculator: weighted grades, what you need on the final, term averages and GPA.' }),
      h('p', null, h('button', { class: 'btn primary big', type: 'button', id: 'quick-start', text: 'Set up my first course', on: { click: () => newCourseWizard(null) } })),
      h('p', { class: 'muted small', text: 'About two minutes: copy the weights from your syllabus (assignments, midterm, final…), then type marks as you get them.' }),
      h('div', { class: 'row-actions center' },
        h('button', { class: 'btn', type: 'button', id: 'try-demo', text: 'Try it with demo data', on: { click: loadDemo } }),
        h('button', { class: 'btn', type: 'button', text: 'Start with a term', on: { click: () => addTermDialog() } })),
      h('p', { class: 'muted small' }, 'Have a backup or a spreadsheet? ',
        h('button', { class: 'link', type: 'button', id: 'welcome-import', text: 'Import a file', on: { click: openFiles } }), '.'),
      h('ul', { class: 'welcome-points' },
        h('li', { text: 'No account needed. Your marks stay in this browser on this device.' }),
        h('li', { text: 'Grade so far, current average, projected grade and “what do I need”, labelled as projections.' }),
        h('li', { text: 'Drop lowest, bonus marks, curves, excused items, final-replaces-midterm, repeats, pass/fail.' })),
      h('p', { class: 'muted small' }, 'Letters follow the University of Windsor percentage scale by default. Change it in ',
        h('button', { class: 'link', type: 'button', text: 'Settings', on: { click: openSettings } }), '.')),
    siteFooter());
}

// ---------------------------------------------------------------- overview pane
function renderOverview(r) {
  const c = S.calc;
  const cum = c.cumulative;
  const activeTerm = r.shownTerm || r.term;
  const extra = [cum.passCredits ? `${num(cum.passCredits)} pass` : null, cum.transferCredits ? `${num(cum.transferCredits)} transfer` : null].filter(Boolean);

  // Archived terms still count everywhere; they just leave the list (a folded "Archived" list), except in Edit structure.
  const termRow = (t) => {
    const s = c.terms.get(t.id);
    const link = h('a', { class: `row-link${activeTerm && activeTerm.id === t.id ? ' active' : ''}`, href: termHash(t) },
      h('span', { class: 'grow' }, t.name, h('span', { class: 'muted small', text: t.year_of_study ? `  Year ${t.year_of_study}` : '' })),
      t.archived && S.structure ? h('span', { class: 'badge', text: 'archived' }) : null,
      h('span', { class: 'num', text: s.courses ? pct(s.average) : '—' }));
    if (!S.structure) return h('li', null, link);
    const i = S.live.terms.indexOf(t);
    return dropSpot(h('li', { class: 'ordered' }, orderCtl('terms', S.live.terms, i, 'terms'), link), 'terms', S.live.terms, i, 'terms');
  };
  const archived = S.structure ? [] : S.live.terms.filter((t) => t.archived);
  const termRows = (S.structure ? S.live.terms : S.live.terms.filter((t) => !t.archived)).map(termRow);
  const archivedList = archived.length ? h('details', { class: 'archived', open: S.info.has('archived') || !!(activeTerm && activeTerm.archived),
    on: { toggle: (e) => { if (e.target.open) S.info.add('archived'); else S.info.delete('archived'); } } },
    h('summary', { class: 'small muted', text: `Archived terms (${archived.length}) · still count in averages` }),
    h('ul', { class: 'list' }, archived.map(termRow))) : null;

  fill(panes.overview,
    h('nav', { class: 'side-nav', 'aria-label': 'Main' }, h('ul', { class: 'list' }, h('li', null,
      h('a', { class: `row-link nav-graphs${r.graphs ? ' active' : ''}`, href: '#/', 'aria-current': r.graphs ? 'page' : null },
        chartIcon(), h('span', { class: 'grow', text: 'Graphs' }))))),
    h('div', { class: 'pane-head' }, h('h2', { text: 'Overview' }),
      h('span', { class: 'sub small', text: `${cum.courses} graded · ${num(cum.credits)} cr${extra.length ? ` (+ ${extra.join(', ')})` : ''}` })),
    (() => {
      const tip = infoTip('cumulative', cumInfo());
      return [h('div', { class: 'stats' },
        h('div', { class: 'stat big' }, h('div', { class: 'label' }, 'Cumulative average ', tip.btn),
          h('div', { class: 'value', text: pct(cum.average) }), h('div', { class: 'foot', text: gradeFoot(cum.gpa.average, cum.letter.average) })),
        thisTermSoFar()), tip.note];
    })(),
    c.yearList.length ? [h('h3', { text: 'Years of study' }),
      h('div', { class: 'years' }, c.yearList.map((y) => {
        const s = c.years.get(y);
        return h('div', { class: `year${s.courses ? '' : ' none'}` },
          h('div', { class: 'label', text: `Year ${y}` }),
          h('div', { class: 'value', text: s.courses ? pct(s.average) : '—' }),
          s.courses ? h('div', { class: 'label', text: gradeFoot(s.gpa.average, s.letter.average) }) : null);
      }))] : null,
    h('h3', { text: 'Terms' }),
    h('ul', { class: 'list' }, termRows),
    archivedList,
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn small primary', type: 'button', text: 'New course (set up)', on: { click: () => newCourseWizard(activeTerm) } }),
      h('button', { class: 'btn small', type: 'button', text: '+ Term', on: { click: () => addTermDialog() } })),
    h('h3', { text: 'More' }),
    h('ul', { class: 'list more' },
      h('li', null, h('button', { class: 'link', type: 'button', text: 'Settings (grade scale, repeats, reset)', on: { click: openSettings } })),
      h('li', null, h('button', { class: 'link', type: 'button', id: 'open-files', text: 'Files: Excel, CSV, backup, templates', on: { click: openFiles } })),
      h('li', null, h('button', { class: 'link', type: 'button', text: 'Recently deleted', on: { click: openDeleted } })),
      h('li', null, h('button', { class: 'link', type: 'button', id: 'history-all', text: 'History (all changes)', on: { click: () => openHistory(null) } }))),
    siteFooter(),
  );
}

function addTermDialog() {
  const name = h('input', { type: 'text', value: S.live.terms.length ? '' : suggestTermName(), placeholder: 'e.g. Fall 2026', maxlength: '100' });
  const yos = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'optional, e.g. 1', maxlength: '2' });
  const err = h('div', { class: 'err-msg' });
  const go = async () => {
    const n = textField('Name', { required: true, max: 100 })(name.value);
    const y = numberField(1, 10, { nullable: true, int: true, label: 'Year of study' })(yos.value);
    if (n.error || y.error) { err.textContent = n.error || y.error; return; }
    closeDialog('dlg');
    const term = await create('terms', { name: n.value, ...guessSeason(n.value), year_of_study: y.value,
      sort_order: Math.max(0, ...S.live.terms.map((t) => t.sort_order ?? 0)) + 1 });
    if (term) location.hash = termHash(term);
  };
  for (const i of [name, yos]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  openDialog('dlg', h('h2', { text: 'Add a term' }),
    h('div', { class: 'form' },
      h('label', null, 'Name', name),
      h('label', null, 'Year of study (for year averages)', yos), err),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => closeDialog('dlg') } }),
      h('button', { class: 'btn primary', type: 'button', text: 'Add term', on: { click: go } })));
  name.focus();
}

// ---------------------------------------------------------------- term pane
function avgCell(c, cr) {
  const type = typeOf(c);
  if (type === 'pass_fail') return c.pass_result === 'pass' ? 'Pass' : c.pass_result === 'fail' ? 'Fail' : 'P/F';
  if (type === 'transfer') return 'Transfer';
  if (type === 'withdrawn') return 'W';
  return pct(cr.result.average);
}

function renderTerm(r) {
  const el = panes.term;
  if (r.graphs) return renderGraphs();
  const term = r.shownTerm;
  if (!term) { fill(el, h('div', { class: 'empty', text: 'Pick a term.' }), miniFooter()); return; }
  const s = S.calc.terms.get(term.id);
  const courses = coursesOf(term);
  const activeCourse = r.course;

  const rows = courses.map((c, i) => {
    const cr = S.calc.courses.get(c.id);
    const graded = typeOf(c) === 'graded';
    const tr = h('tr', { class: `click${activeCourse && activeCourse.id === c.id ? ' active' : ''}`,
      on: { click: () => { location.hash = courseHash(term, c); } } },
    S.structure ? h('td', { class: 'order-cell' }, orderCtl('courses', courses, i, `courses:${term.id}`)) : null,
    h('td', { class: 'code' }, c.code || '—'),
    h('td', { class: 'title-cell' }, h('a', { href: courseHash(term, c), text: c.short_name && isMobile() ? c.short_name : c.title,
      class: 'plain', on: { click: (e) => e.stopPropagation() } }), courseBadges(c, cr)),
    h('td', { class: 'num', text: avgCell(c, cr) }),
    h('td', { class: 'num hide-m', text: graded ? pct(cr.result.soFar) : '—' }),
    h('td', { class: 'num hide-m muted', text: graded ? pct(cr.projected) : '—' }),
    h('td', { class: 'num', text: graded ? gradeCell(cr.gpa.average, cr.letter.average) : '' }));
    return S.structure ? dropSpot(tr, 'courses', courses, i, `courses:${term.id}`) : tr;
  });

  fill(el,
    h('div', { class: 'pane-head' },
      h('h2', { text: term.name }),
      h('span', { class: 'sub', text: [[term.season, term.year].filter(Boolean).join(' '), term.year_of_study ? `Year ${term.year_of_study}` : null].filter(Boolean).join(' · ') })),
    h('div', { class: 'stats' },
      stat('Average', s.courses ? pct(s.average) : '—', gradeFoot(s.gpa.average, s.letter.average)),
      stat('So far', s.courses ? pct(s.soFar) : '—', 'unmarked = 0'),
      h('div', { class: 'stat proj' }, h('div', { class: 'label' }, 'Projected', est()), h('div', { class: 'value', text: s.courses ? pct(s.projected) : '—' }),
        h('div', { class: 'foot', text: `${s.courses} graded · ${num(s.credits)} cr` }))),
    S.structure ? termStructure(term) : null,
    courses.length
      ? h('table', { class: 'grid' },
        h('thead', null, h('tr', null, S.structure ? h('th', { class: 'order-cell', 'aria-label': 'Order' }) : null, h('th', { text: 'Code' }), h('th', { text: 'Course' }), h('th', { class: 'num', text: 'Average' }),
          h('th', { class: 'num hide-m', text: 'So far' }), h('th', { class: 'num hide-m' }, 'Proj.', est()), h('th', { class: 'num', text: isPoints() ? 'GPA' : 'Letter' }))),
        h('tbody', null, rows))
      : h('div', { class: 'empty' },
        h('p', { text: 'No courses in this term yet.' }),
        h('button', { class: 'btn primary', type: 'button', text: 'Set up a course', on: { click: () => newCourseWizard(term) } })),
    courses.length && !S.structure ? h('p', { class: 'row-actions' },
      h('button', { class: 'btn small', type: 'button', text: 'New course (set up)', on: { click: () => newCourseWizard(term) } })) : null,
    courses.length ? thisTermChart(term) : null,
    miniFooter(),
  );
}

// ---------------------------------------------------------------- graphs
const ICON_NS = 'http://www.w3.org/2000/svg';
/** Small line-chart icon (inline SVG, currentColor). */
function chartIcon() {
  const svg = document.createElementNS(ICON_NS, 'svg');
  for (const [k, v] of Object.entries({ class: 'nav-icon', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  for (const d of ['M2 2v12h12', 'M4.5 10.5 7.5 7l2 2 4-4.5']) {
    const p = document.createElementNS(ICON_NS, 'path');
    for (const [k, v] of Object.entries({ d, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
    svg.append(p);
  }
  return svg;
}
const termShort = (t) => (t.season && t.year ? `${t.season[0]}${String(t.year).slice(-2)}` : t.name.slice(0, 6));
/** Courses that count toward averages (graded, with marks or a set grade), with their term. */
function gradedResults() {
  const termById = new Map(S.live.terms.map((t) => [t.id, t]));
  return S.live.courses.map((c) => S.calc.courses.get(c.id))
    .filter((cr) => cr && cr.counts && cr.result.average !== null)
    .map((cr) => ({ ...cr, term: termById.get(cr.course.term_id) }));
}

/** Degree-wide graphs (#/): bell curve, term clusters, cumulative over time. Uses the middle + right panes. */
function renderGraphs() {
  const graded = gradedResults();
  const groups = [], cumul = [], years = [], classes = [];
  const pick = (g) => ({ label: courseLabel(g.course), name: g.course.title, v: g.result.average });
  const extremes = (list) => {
    const byGrade = [...list].sort((a, b) => a.result.average - b.result.average);
    return { worst: pick(byGrade[0]), best: pick(byGrade[byGrade.length - 1]) };
  };
  let prevCum = null;
  S.live.terms.forEach((t, i) => {
    const mine = graded.filter((g) => g.term.id === t.id).sort((a, b) => bySort(a.course, b.course));
    if (!mine.length) return;
    const ts = S.calc.terms.get(t.id);
    const short = termShort(t);
    groups.push({ short, name: t.name, avg: ts.average,
      items: mine.map((g) => ({ label: courseLabel(g.course), v: g.result.average })) });
    // Cumulative after this term, with the repeat policy applied to the attempts so far.
    const upTo = new Set(S.live.terms.slice(0, i + 1).map((x) => x.id));
    const cum = computeAll({ ...S.live, courses: S.live.courses.filter((c) => upTo.has(c.term_id)) }).cumulative.average;
    cumul.push({ short, name: t.name, before: prevCum ?? ts.average, cum, term: ts.average, ...extremes(mine) });
    // Years of study: one candle per year of study (terms without one count in the cumulative only, as in calc).
    const yr = Number.isFinite(t.year_of_study) ? t.year_of_study : null;
    if (yr !== null) {
      let y = years.find((x) => x.year === yr);
      if (!y) { y = { year: yr, courses: [] }; years.push(y); }
      y.courses.push(...mine);
    }
    // Classes: one candle per course, grouped by term.
    for (const g of mine) {
      const k = courseCandle(g.course, leavesOf(g.course), S.calc.itemsByComp);
      classes.push({ group: short, groupName: t.name, label: courseLabel(g.course), name: g.course.title, v: g.result.average,
        final: !!g.result.overridden || g.course.status === 'complete', items: k.items, open: k.open, lo: k.lo, hi: k.hi });
    }
    prevCum = cum;
  });
  // Close = calc's year average and cumulative-to-year (repeat policy applied within each scope).
  years.sort((a, b) => a.year - b.year);
  const yearPts = years.map((y, i) => {
    const avg = S.calc.years.get(y.year)?.average ?? null;
    const cum = S.calc.cumulativeTo.get(y.year)?.average ?? avg;
    const before = i ? S.calc.cumulativeTo.get(years[i - 1].year)?.average ?? avg : avg;
    return { short: `Y${y.year}`, name: `Year ${y.year}`, before, cum, term: avg, ...extremes(y.courses) };
  });
  fill(panes.term,
    h('div', { class: 'pane-head' }, h('h2', { text: 'Graphs' }),
      h('span', { class: 'sub small', text: `${graded.length} graded courses · set final grades used where set` })),
    graded.length ? null : h('p', { class: 'muted', text: 'Graphs fill in as you add marks.' }),
    h('div', { class: 'charts' },
      bellChart(graded.map((g) => ({ label: courseLabel(g.course), name: g.course.title, sub: g.term.name, v: g.result.average }))),
      clusterChart(groups),
      cumulativeChart({ terms: cumul, years: yearPts, classes })),
    miniFooter());
}

/** Need on the final(s) for `target`: the components named "final" that still have unmarked items. */
function needOnFinal(course, target) {
  const cr = S.calc.courses.get(course.id);
  if (cr.result.overridden) return { text: 'set', cls: 'muted' };
  const comps = leavesOf(course);
  const open = comps.filter((k) => !k.is_bonus && (S.calc.itemsByComp.get(k.id) || []).some(isOpenItem));
  let finals = open.filter((k) => /final/i.test(k.name));
  if (!finals.length) finals = open.filter((k) => /exam/i.test(k.name) && !/mid/i.test(k.name));
  if (!finals.length) return { text: '—', cls: 'muted' };
  const r = needFor(course, comps, S.calc.itemsByComp, target, finals.map((k) => k.id));
  if (r.status === 'guaranteed') return { text: 'any mark works', cls: 'good' };
  if (r.status === 'possible') return { text: `need ${pct(r.need, 1)}`, cls: '' };
  if (r.status === 'over_100') return { text: `need ${pct(r.need, 1)}`, cls: 'warn' };
  if (r.status === 'impossible') return { text: 'not reachable', cls: 'bad' };
  return { text: '—', cls: 'muted' };
}

/** This term: so far / current / projected per course + "need on the final for __%" (a projection, never saved). */
function thisTermChart(term) {
  const list = coursesOf(term).filter((c) => typeOf(c) === 'graded');
  if (!list.length) return null;
  const saved = Number(store.get('gc-chart-target', 80));
  const input = h('input', { type: 'text', inputmode: 'decimal', value: String(Number.isFinite(saved) ? saved : 80),
    'aria-label': 'Target course grade % for the final', dataset: { k: `chart-target:${term.id}` } });
  const slot = h('div');
  const draw = () => {
    const t = Number(input.value.replace('%', ''));
    const target = Number.isFinite(t) && t > 0 && t <= 150 ? t : 80;
    fill(slot, termChart(list.map((c) => {
      const cr = S.calc.courses.get(c.id);
      return { label: courseLabel(c), title: c.title, soFar: cr.result.soFar, average: cr.result.average, projected: cr.projected,
        need: needOnFinal(c, target / 100) };
    }), target / 100));
  };
  input.addEventListener('change', () => { store.set('gc-chart-target', input.value.trim() || '80'); draw(); });
  draw();
  return h('div', { class: 'charts' },
    h('div', { class: 'need small', title: 'A projection, never saved as a mark' }, 'Need', est(), 'on the final to finish each course with', input, '%'),
    slot);
}

function termStructure(term) {
  return h('div', { class: 'struct' },
    h('div', { class: 'struct-grid' },
      field('Name', 'terms', term, 'name', { parse: textField('Name', { required: true, max: 100 }) }),
      field('Season', 'terms', term, 'season', { type: 'select', options: [['', '—'], ['Fall', 'Fall'], ['Winter', 'Winter'], ['Spring', 'Spring'], ['Summer', 'Summer']],
        parse: (v) => ({ value: v || null }) }),
      field('Year', 'terms', term, 'year', { parse: numberField(1900, 2100, { nullable: true, int: true, label: 'Year' }), decimal: true }),
      field('Year of study', 'terms', term, 'year_of_study', { parse: numberField(1, 10, { nullable: true, int: true, label: 'Year of study' }), decimal: true }),
      field('Archived', 'terms', term, 'archived', { type: 'checkbox' })),
    h('p', { class: 'muted small', text: 'Archived terms fold away under “Archived terms” in the list and + Mark skips their courses. They still count in every average and graph.' }),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn small primary', type: 'button', text: 'New course (set up)', on: { click: () => newCourseWizard(term) } }),
      h('button', { class: 'btn small', type: 'button', text: '+ Course', title: 'Just the name; add components later', on: { click: () => addCourseDialog(term) } }),
      h('button', { class: 'btn small danger', type: 'button', text: 'Delete term', on: { click: async () => {
        const n = coursesOf(term).length;
        const body = h('div', null, h('p', { text: `${n ? `Its ${n} course${n === 1 ? '' : 's'} and their marks are deleted with it. ` : ''}You can restore it from Recently deleted for 30 days.` }),
          previewBox(previewDelta(S.live, (d) => dropFrom(d, 'terms', term.id))));
        if (await confirmDialog(`Delete ${term.name}?`, body, 'Delete', { danger: true })) {
          await removeRow('terms', term, term.name);
          location.hash = '#/';
        }
      } } })));
}

/** The setup wizard (site/js/wizard.js): syllabus order, creates everything through the store. */
function newCourseWizard(term) {
  openWizard({
    terms: S.live.terms, term, courses: S.live.courses, compsOf: leavesOf, itemsOf: rawItems, defaultCredits: defaultCredits(),
    suggestTerm: suggestTermName(), create, patchRow: patch, batch,
    done: (t, c) => { location.hash = courseHash(t, c); },
  });
}

function addCourseDialog(term) {
  const code = h('input', { type: 'text', placeholder: 'optional', maxlength: '20' });
  const title = h('input', { type: 'text', placeholder: 'Course title', maxlength: '200' });
  const credits = h('input', { type: 'text', inputmode: 'decimal', value: String(defaultCredits()) });
  const type = h('select', null, Object.entries(TYPE_LABEL).map(([v, l]) => h('option', { value: v, text: l })));
  const err = h('div', { class: 'err-msg' });
  const go = async () => {
    const c = textField('Code', { max: 20 })(code.value), t = textField('Title', { required: true })(title.value), cr = numberField(0, 30, { label: 'Credits' })(credits.value);
    const e = c.error || t.error || cr.error;
    if (e) { err.textContent = e; return; }
    closeDialog('dlg');
    const row = await create('courses', { term_id: term.id, code: c.value, title: t.value, credits: cr.value, type: type.value,
      sort_order: Math.max(0, ...coursesOf(term).map((x) => x.sort_order ?? 0)) + 1 });
    if (row) location.hash = courseHash(term, row);
  };
  openDialog('dlg', h('h2', { text: `Add a course to ${term.name}` }),
    h('div', { class: 'form' }, h('label', null, 'Title', title), h('label', null, 'Code', code), h('label', null, 'Credits', credits), h('label', null, 'Type', type), err),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => closeDialog('dlg') } }),
      h('button', { class: 'btn primary', type: 'button', text: 'Add', on: { click: go } })));
  title.focus();
}

// ---------------------------------------------------------------- course pane
function renderCourse(r) {
  const el = panes.course;
  const course = r.course;
  S.needUpdate = null;
  if (!course) {
    fill(el, h('div', { class: 'empty', text: 'Pick a course to see its marks.' }), miniFooter());
    return;
  }
  const term = termOf(course);
  const cr = S.calc.courses.get(course.id);
  const res = cr.result;
  const leaves = leavesOf(course);
  const tops = topComps(course);
  const complete = course.status === 'complete';
  const curve = parseCurve(course.curve);
  const type = typeOf(course);

  const head = h('div', { class: 'pane-head' },
    h('h2', null, course.title),
    h('span', { class: 'sub code', text: course.code || '' }),
    h('span', { class: 'sub small', text: `${num(course.credits)} cr${type !== 'graded' ? ` · ${TYPE_LABEL[type]}` : ''}` }),
    h('div', { class: 'actions no-print' },
      h('button', { class: 'btn small', type: 'button', text: complete ? 'Reopen' : 'Mark complete',
        on: { click: () => patch('courses', course, { status: complete ? 'active' : 'complete' }) } }),
      h('button', { class: 'btn small', type: 'button', text: 'History', on: { click: () => openHistory(course) } }),
      h('button', { class: 'btn small', type: 'button', text: 'Print', on: { click: () => window.print() } })));

  let stats;
  if (type === 'pass_fail') {
    stats = h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('div', { class: 'label', text: 'Pass/fail (not in averages)' }),
        h('div', { class: 'row-actions' }, ['pass', 'fail'].map((v) => h('button', {
          class: 'btn small', type: 'button', 'aria-pressed': course.pass_result === v ? 'true' : 'false', text: v === 'pass' ? 'Pass' : 'Fail',
          on: { click: () => patch('courses', course, { pass_result: course.pass_result === v ? null : v }) },
        })))),
      res.average !== null ? stat('Average', pct(res.average), 'for reference') : null);
  } else if (type === 'transfer') {
    stats = h('div', { class: 'stats' }, stat('Transfer credit', `${num(course.credits)} cr`, 'counts as credits, not in averages'));
  } else if (type === 'withdrawn') {
    stats = h('div', { class: 'stats' }, stat('Withdrawn', 'W', 'not in averages or credits'));
  } else if (res.overridden) {
    const calc = res.calculated;
    stats = h('div', { class: 'stats' },
      stat(`Final grade (set${course.final_letter && course.final_override == null ? ` as ${course.final_letter}` : ''})`, pct(res.average), gradeFoot(cr.gpa.average, cr.letter.average), 'big'),
      stat('Calculated', pct(calc.average), curve && calc.raw && calc.raw.average !== null ? `curved · raw ${pct(calc.raw.average)}` : 'from the marks'),
      stat('Calc. so far', pct(calc.soFar), 'unmarked = 0'));
  } else {
    stats = h('div', { class: 'stats' },
      stat('Current average', pct(res.average), gradeFoot(cr.gpa.average, cr.letter.average), 'big'),
      stat('So far', pct(res.soFar), 'unmarked = 0'),
      curve && res.raw.average !== null ? stat('Raw (before curve)', pct(res.raw.average), `${courseCurveText(curve)} · so far ${pct(res.raw.soFar)}`) : null,
      h('div', { class: 'stat proj' }, h('div', { class: 'label' }, 'Projected', est()), h('div', { class: 'value', text: pct(cr.projected) }),
        h('div', { class: 'foot', text: 'projections, else avg.' })));
  }

  const notes = [];
  for (const w of res.warnings) {
    if (w.type === 'min') notes.push(h('span', { class: 'badge warn', text: `${w.label}: ${pct(w.value, 1)}` }));
  }
  const estimated = leaves.some((k) => (S.calc.itemsByComp.get(k.id) || []).some((a) => a.estimated)) || res.estimated;
  if (estimated) notes.push(h('span', { class: 'badge', title: 'A letter with no number counts as the middle of its range (e.g. B+ = 78%)', text: 'includes letter-only estimates' }));
  if (cr.repeat) {
    const counted = !cr.repeat.excluded.average;
    notes.push(h('span', { class: `badge${counted ? ' set' : ''}`, text: `Repeated course: ${POLICY_LABEL[cr.repeat.policy].toLowerCase()} → this attempt ${counted ? 'counts' : 'doesn’t count'} in year and cumulative averages` }));
  }

  fill(el,
    h('p', { class: 'muted small only-mobile-crumb', text: term ? term.name : '' }),
    head, stats, notes.length ? h('p', { class: 'notes' }, notes) : null,
    type !== 'graded' ? null : res.overridden
      ? h('div', { class: 'need muted' }, 'Final grade is set, so it’s used in every average. Clear it in Edit structure to go back to the calculated grade.')
      : needBox(course, leaves),
    leaves.length && type === 'graded' && !S.structure ? componentChart(tops.map((k) => {
      const c = res.components.get(k.id) || { weight: k.weight, average: null };
      return { label: k.name, weight: c.weight, bonus: !!k.is_bonus, avg: c.average };
    })) : null,
    S.structure ? courseStructure(course) : null,
    tops.length ? tops.map((k, i) => (kidsOf(k).length ? groupCard(course, k, res, topSib(course, tops, i)) : compCard(course, k, res, false, topSib(course, tops, i)))) : h('div', { class: 'empty' },
      h('p', { text: 'No components yet (e.g. Assignments 20%, Midterm 30%, Final 50%).' }),
      S.structure ? null : h('button', { class: 'btn', type: 'button', text: 'Edit structure', on: { click: () => setStructure(true) } })),
    S.structure ? h('p', null, h('button', { class: 'btn small', type: 'button', text: '+ Component', on: { click: () => addComponent(course) } })) : null,
    course.notes && !S.structure ? h('p', { class: 'muted small', text: course.notes }) : null,
    miniFooter(),
  );
  if (S.needUpdate) S.needUpdate();
}

function needText(r) {
  if (r.status === 'guaranteed') return { text: 'any mark works', cls: 'good' };
  if (r.status === 'possible') return { text: `need ${pct(r.need, 1)}`, cls: '' };
  if (r.status === 'over_100') return { text: `need ${pct(r.need, 1)}`, cls: 'warn' };
  if (r.status === 'impossible') return { text: 'out of reach', cls: 'bad' };
  return { text: '', cls: '' };
}

/** "What do I need": on the course (all or one component) and per remaining item. A projection, never saved. */
function needBox(course, leaves) {
  const items = (k) => S.calc.itemsByComp.get(k.id) || [];
  const open = leaves.filter((k) => !k.is_bonus && items(k).some(isOpenItem));
  if (!open.length) {
    return leaves.length ? h('div', { class: 'need muted' }, 'What do I need? Nothing left to mark.') : null;
  }
  const key = `gc-need-${course.id}`;
  const saved = store.get(key, {});
  const target = h('input', { type: 'text', inputmode: 'decimal', value: saved.target ?? '', placeholder: '80', 'aria-label': 'Target course grade %', dataset: { k: `need:${course.id}:t` } });
  const parentName = (k) => (k.ancestors && k.ancestors.length ? `${S.live.components.find((x) => x.id === k.ancestors[0])?.name} › ` : '');
  const scope = h('select', { 'aria-label': 'On which marks', dataset: { k: `need:${course.id}:s` } },
    h('option', { value: '', text: 'everything left' }),
    open.map((k) => h('option', { value: String(k.id), text: `${parentName(k)}${k.name}`, selected: String(saved.scope) === String(k.id) })));
  const answer = h('span', { class: 'answer' });
  const update = () => {
    store.set(key, { target: target.value, scope: scope.value });
    const t = Number(target.value.replace('%', ''));
    const perItem = panes.course.querySelectorAll('[data-need-item]');
    if (!target.value.trim() || !Number.isFinite(t) || t <= 0 || t > 150) {
      answer.textContent = '';
      for (const s of perItem) { s.textContent = ''; s.className = 'need-item'; }
      return;
    }
    const r = needFor(course, leaves, S.calc.itemsByComp, t / 100, scope.value ? [Number(scope.value)] : undefined);
    answer.className = 'answer';
    if (r.status === 'guaranteed') {
      answer.textContent = scope.value
        ? `→ any mark on ${scope.selectedOptions[0].textContent} works, if your other unmarked work goes as projected`
        : '→ already there, even with 0 on the rest';
    }
    else if (r.status === 'possible') answer.textContent = `→ need ${pct(r.need, 1)} on average`;
    else if (r.status === 'over_100') { answer.textContent = `→ need ${pct(r.need, 1)} (over 100%)`; answer.className = 'answer badge warn'; }
    else if (r.status === 'impossible') { answer.textContent = '→ not reachable'; answer.className = 'answer badge bad'; }
    else answer.textContent = '→ nothing left to mark';
    const each = needPerItem(course, leaves, S.calc.itemsByComp, t / 100);
    for (const s of perItem) {
      const x = each.get(Number(s.dataset.needItem));
      const n = x ? needText(x) : { text: '', cls: '' };
      s.textContent = n.text ? `${n.text} (est.)` : '';
      s.className = `need-item ${n.cls}`;
      s.title = 'Projection: what this item needs for your target if your other unmarked work goes as projected (your current average unless you set a projection)';
    }
  };
  target.addEventListener('input', update);
  scope.addEventListener('change', update);
  S.needUpdate = update;
  return h('div', { class: 'need', title: 'A projection, never saved as a mark' }, 'Need', est(), 'on', scope, 'to finish with', target, '%', answer);
}

function weightCheckLine(course) {
  const tops = topComps(course);
  const real = tops.filter((k) => !k.is_bonus).reduce((s, k) => s + (Number(k.weight) || 0), 0);
  const bonus = tops.filter((k) => k.is_bonus).reduce((s, k) => s + (Number(k.weight) || 0), 0);
  const ok = Math.abs(real - 100) < 1e-6;
  const b = bonus ? ` (+ ${num(bonus)} bonus)` : '';
  const text = ok ? `Weights = 100${b}` : real > 100 ? `Weights = ${num(real)}${b}: the ${num(real - 100)} over 100 counts as bonus`
    : `Weights = ${num(real)}${b}: should add up to 100`;
  return h('div', { class: `wcheck ${ok ? 'ok' : 'off'}`, role: 'status', text });
}

/** Course curve: none / + points / × factor / set grade; applied to the raw grade, then the 100% cap. */
function courseCurveField(course) {
  const cur = parseCurve(course.curve);
  const type = cur ? cur.type : '';
  const shown = !cur ? '' : cur.type === 'set' ? num(cur.value * 100) : num(cur.value);
  const value = h('input', { type: 'text', inputmode: 'decimal', value: shown, disabled: !cur, 'aria-label': 'Curve value',
    placeholder: type === 'mul' ? '1.05' : type === 'set' ? '85' : '2', dataset: { k: `courses:${course.id}:curve_value` }, on: {
      keydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      change: (e) => {
        const [lo, hi, label] = { add: [-100, 100, 'Points'], mul: [0, 10, 'Factor'], set: [0, 150, 'Grade %'] }[type];
        const r = numberField(lo, hi, { label })(e.target.value);
        if (r.error) { toast(r.error, { error: true }); render(); return; }
        patch('courses', course, { curve: { type, value: type === 'set' ? Math.round(r.value * 1e4) / 1e6 : r.value } });
      } } });
  const sel = h('select', { 'aria-label': 'Course curve', dataset: { k: `courses:${course.id}:curve` }, on: { change: (e) => {
    const t = e.target.value;
    if (!t) return patch('courses', course, { curve: null });
    patch('courses', course, { curve: { type: t, value: { add: 0, mul: 1, set: 1 }[t] } });
  } } }, [['', 'No curve'], ['add', '+ points'], ['mul', '× factor'], ['set', 'Set grade %']]
    .map(([v, l]) => h('option', { value: v, text: l, selected: type === v })));
  return [h('label', { class: 'field' }, 'Course curve', sel),
    h('label', { class: 'field' }, type === 'add' ? 'Points (±)' : type === 'mul' ? 'Factor' : type === 'set' ? 'Curved grade %' : 'Curve value', value)];
}

/** Final grade set by hand: a % or a letter (a letter alone counts as the middle of its range, flagged as an estimate). */
function finalGradeField(course) {
  const shown = course.final_override !== null && course.final_override !== undefined ? pctOut(course.final_override) : course.final_letter || '';
  return h('label', { class: 'field' }, 'Final grade (set)', h('input', { type: 'text', value: shown, placeholder: '% or letter',
    dataset: { k: `courses:${course.id}:final` }, on: {
      keydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      change: (e) => {
        const v = e.target.value.trim();
        if (!v) return patch('courses', course, { final_override: null, final_letter: null });
        if (/^[a-f][+-]?$/i.test(v)) {
          if (letterToPct(v) === null) { toast('Letters: A+ to D-, or F', { error: true }); render(); return; }
          return patch('courses', course, { final_override: null, final_letter: v.toUpperCase() });
        }
        const r = pctField('Final grade')(v);
        if (r.error) { toast(r.error, { error: true }); render(); return; }
        patch('courses', course, { final_override: r.value, final_letter: null });
      } } }));
}

/** Move a course (marks and all) to another term; Undo moves it back. */
function moveCourseRow(course) {
  const others = S.live.terms.filter((t) => t.id !== course.term_id);
  if (!others.length) return null;
  const sel = h('select', { 'aria-label': 'Move to term', dataset: { k: `courses:${course.id}:move` } },
    others.map((t) => h('option', { value: String(t.id), text: t.name })));
  const move = async (toId, undoable) => {
    const from = termOf(course);
    const to = S.live.terms.find((t) => t.id === toId);
    await patch('courses', course, { term_id: toId }, `move ${courseLabel(course)} to ${to.name}`);
    const now = S.data.courses.find((c) => c.id === course.id);
    if (!now || now.term_id !== toId) return; // not saved (the patch already said why)
    location.hash = courseHash(to, now);
    if (undoable) toast(`Moved ${courseLabel(course)} to ${to.name}`, { action: undoAction(H.undo[H.undo.length - 1], () => move(from.id, false)) });
  };
  return h('div', { class: 'row-actions move-row' }, h('label', { class: 'field' }, 'Move to term', sel),
    h('button', { class: 'btn small', type: 'button', text: 'Move', on: { click: () => move(Number(sel.value), true) } }));
}

/** Repeated course: link attempts of the same course; the group's policy decides which attempt counts. */
function repeatRow(course) {
  const group = (S.data.repeats || []).find((g) => (g.course_ids || []).includes(course.id) && S.live.repeats.some((x) => x.id === g.id));
  const label = (c) => `${c.code ? `${c.code} ` : ''}${c.title} (${termOf(c)?.name ?? '?'})`;
  const def = S.data.settings.repeat_policy_default || 'best';
  if (!group) {
    const same = (c) => (course.code && c.code === course.code) || c.title === course.title;
    const others = S.live.courses.filter((c) => c.id !== course.id && typeOf(c) === 'graded').sort((a, b) => same(b) - same(a) || bySort(a, b));
    if (!others.length) return null;
    const sel = h('select', { 'aria-label': 'Repeat of', dataset: { k: `courses:${course.id}:repeat` }, on: { change: async (e) => {
      const other = S.live.courses.find((c) => String(c.id) === e.target.value);
      if (!other) return;
      const g = (S.data.repeats || []).find((x) => (x.course_ids || []).includes(other.id));
      if (g) await patch('repeats', g, { course_ids: [...g.course_ids, course.id] });
      else await create('repeats', { course_ids: [other.id, course.id], policy: null });
      toast('Linked as a repeated course');
    } } }, h('option', { value: '', text: 'Not a repeat' }), others.map((c) => h('option', { value: String(c.id), text: label(c) })));
    return h('div', { class: 'row-actions' }, h('label', { class: 'field wide' }, 'Repeat of an earlier attempt?', sel));
  }
  const attempts = group.course_ids.map((id) => S.live.courses.find((c) => c.id === id)).filter(Boolean);
  const policy = h('select', { 'aria-label': 'Which attempt counts', dataset: { k: `repeats:${group.id}:policy` }, on: { change: (e) => {
    patch('repeats', group, { policy: e.target.value || null });
  } } },
  h('option', { value: '', text: `Default: ${POLICY_LABEL[def].toLowerCase()}`, selected: !group.policy }),
  Object.entries(POLICY_LABEL).map(([v, l]) => h('option', { value: v, text: l, selected: group.policy === v })));
  const unlink = async () => {
    const rest = group.course_ids.filter((id) => id !== course.id);
    if (rest.length < 2) await removeRow('repeats', group, 'repeat link');
    else await patch('repeats', group, { course_ids: rest });
  };
  return h('div', { class: 'struct-sub' },
    h('div', { class: 'small muted', text: `Attempts: ${attempts.map(label).join(' · ')}` }),
    h('div', { class: 'row-actions' }, h('label', { class: 'field' }, 'Which attempt counts', policy),
      h('button', { class: 'btn small', type: 'button', text: 'Not a repeat', on: { click: unlink } })),
    h('div', { class: 'small muted', text: 'Each attempt still shows in its own term. Year and cumulative averages count the attempt(s) the policy picks.' }));
}

function courseStructure(course) {
  const graded = typeOf(course) === 'graded';
  return h('div', { class: 'struct' },
    weightCheckLine(course),
    h('div', { class: 'struct-grid' },
      field('Title', 'courses', course, 'title', { parse: textField('Title', { required: true }), wide: true }),
      field('Code', 'courses', course, 'code', { parse: textField('Code', { max: 20 }) }),
      field('Short name', 'courses', course, 'short_name', { parse: textField('Short name', { max: 60 }) }),
      field('Credits', 'courses', course, 'credits', { parse: numberField(0, 30, { label: 'Credits' }), decimal: true }),
      field('Type', 'courses', course, 'type', { type: 'select', options: Object.entries(TYPE_LABEL) }),
      graded ? courseCurveField(course) : null,
      graded ? field('Cap at 100%', 'courses', course, 'cap_100', { type: 'checkbox' }) : null,
      graded ? finalGradeField(course) : null,
      field('Notes', 'courses', course, 'notes', { type: 'textarea', parse: textField('Notes', { max: 2000 }), wide: true })),
    graded ? repeatRow(course) : null,
    moveCourseRow(course),
    h('p', { class: 'row-actions' },
      h('button', { class: 'btn small', type: 'button', text: 'Duplicate course…', title: 'Same components and items, e.g. for a retake or a new term', on: { click: () => duplicateCourse(course) } }),
      h('button', { class: 'btn small', type: 'button', id: 'save-template', text: 'Save as template', title: 'Download this course’s structure (no marks) to share or reuse', on: { click: () => saveTemplate(course) } }),
      h('button', { class: 'btn small danger', type: 'button', text: 'Delete course', on: { click: async () => {
      const n = S.live.assessments.filter((a) => isMarked(a) && rawComps(course).some((k) => k.id === a.component_id)).length;
      const body = h('div', null, h('p', { text: `${n ? `Its ${n} mark${n === 1 ? ' is' : 's are'} deleted with it. ` : ''}You can restore it from Recently deleted for 30 days.` }),
        previewBox(previewDelta(S.live, (d) => dropFrom(d, 'courses', course.id), { termId: course.term_id })));
      if (await confirmDialog(`Delete ${courseLabel(course)}?`, body, 'Delete', { danger: true })) {
        const term = termOf(course);
        await removeRow('courses', course, courseLabel(course));
        if (term) location.hash = termHash(term);
      }
    } } })));
}

function addComponent(course) { return batch('add a component', () => addComponentNow(course)); }
async function addComponentNow(course) {
  const used = topComps(course).filter((k) => !k.is_bonus).reduce((s, k) => s + (Number(k.weight) || 0), 0);
  const row = await create('components', { course_id: course.id, name: 'New component', weight: Math.max(0, Math.min(100, 100 - used)),
    sort_order: Math.max(0, ...rawComps(course).map((k) => k.sort_order ?? 0)) + 1 });
  if (row) await create('assessments', { component_id: row.id, name: 'Item 1', mark: null, out_of: 1, sort_order: 1 });
}

/** Split a component into parts (one level of nesting). Its items move into the first part. */
function addPart(course, k) { return batch(`split ${k.name} into parts`, () => addPartNow(course, k)); }
async function addPartNow(course, k) {
  const kids = kidsOf(k);
  let order = Math.max(0, ...rawComps(course).map((x) => x.sort_order ?? 0)) + 1;
  let n = kids.length;
  if (!kids.length) {
    const items = rawItems(k);
    const first = await create('components', { course_id: course.id, parent_id: k.id, name: `${k.name} part 1`, weight: 1, sort_order: order++ });
    if (!first) return;
    n = 1;
    if (items.length) for (const a of items) await patch('assessments', a, { component_id: first.id });
    else await create('assessments', { component_id: first.id, name: 'Item 1', mark: null, out_of: 1, sort_order: 1 });
  }
  const row = await create('components', { course_id: course.id, parent_id: k.id, name: `${k.name} part ${n + 1}`, weight: 1, sort_order: order });
  if (row) await create('assessments', { component_id: row.id, name: 'Item 1', mark: null, out_of: 1, sort_order: 1 });
  S.collapsed.delete(k.id);
}

function compHead(k, cres, { group = false, child = false, sib = null } = {}) {
  const collapsed = S.collapsed.has(k.id);
  const effChanged = !k.is_bonus && !child && Math.abs(cres.weight - k.weight) > 1e-9;
  const wText = child ? `${num(cres.weight)}% of course` : effChanged ? `${num(k.weight)}% → ${num(cres.weight)}%` : `${num(k.weight)}%`;
  return h('div', { class: 'comp-head', role: 'button', tabindex: '0', 'aria-expanded': collapsed ? 'false' : 'true',
    on: {
      click: () => { if (collapsed) S.collapsed.delete(k.id); else S.collapsed.add(k.id); render(); },
      keydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) e.currentTarget.click(); },
    } },
  S.structure && sib ? orderCtl('components', sib.rows, sib.i, sib.group) : null,
  h('span', { class: 'chev', text: collapsed ? '▸' : '▾' }),
  h('span', { class: 'name' }, editable({ text: k.name, edit: k.name, label: 'Component name', parse: textField('Name', { required: true }),
    save: (v) => patch('components', k, { name: v }) }), group ? h('span', { class: 'muted small', text: `  ${kidsOf(k).length} parts` }) : null),
  h('span', { class: 'w', title: effChanged ? 'Weight moved by excused items or a rule (final higher than a midterm)' : null, text: wText }),
  h('span', { class: 'num', title: 'Component average (marked items)', text: pct(cres.average, 1) }));
}

/** A component split into parts: its own header + the parts inside. */
function groupCard(course, k, res, sib = null) {
  const cres = res.components.get(k.id) || { weight: k.weight, average: null };
  const card = h('div', { class: `comp group${k.is_bonus ? ' bonus' : ''}` }, compHead(k, cres, { group: true, sib }));
  if (S.structure && sib) dropSpot(card, 'components', sib.rows, sib.i, sib.group);
  if (S.collapsed.has(k.id)) return card;
  if (S.structure) card.append(groupStructure(course, k));
  const kids = kidsOf(k);
  card.append(h('div', { class: 'comp-kids' }, kids.map((x, i) => compCard(course, x, res, true, { rows: kids, i, group: `parts:${k.id}` }))));
  return card;
}
/** Sibling info for a top-level component card (for ↑/↓ and drag). */
const topSib = (course, rows, i) => ({ rows, i, group: `comps:${course.id}` });

function groupStructure(course, k) {
  const rule = parseRule(k.rule);
  return h('div', { class: 'struct' },
    h('div', { class: 'struct-grid' },
      field('Weight %', 'components', k, 'weight', { parse: numberField(0, 100, { label: 'Weight' }), decimal: true }),
      field('Bonus (on top of 100)', 'components', k, 'is_bonus', { type: 'checkbox' }),
      h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: !!(rule && rule.type === 'min_warning'), on: { change: (e) => {
        patch('components', k, { rule: e.target.checked ? { type: 'min_warning', min: 0.5, label: `${k.name} min 50%` } : null });
      } } }), 'Warn below 50%')),
    h('p', { class: 'muted small', text: 'The parts share this weight in proportion to their “share” numbers (e.g. 2 and 1 = two thirds and one third).' }),
    h('p', { class: 'row-actions' },
      h('button', { class: 'btn small', type: 'button', text: '+ Part', on: { click: () => addPart(course, k) } }),
      h('button', { class: 'btn small', type: 'button', text: 'Duplicate', title: 'A copy of this component, its parts and items (no marks)', on: { click: () => duplicateComponent(course, k) } }),
      h('button', { class: 'btn small danger', type: 'button', text: 'Delete component', on: { click: () => deleteComponent(k) } })));
}

async function deleteComponent(k) {
  const all = [k, ...kidsOf(k)];
  const marks = all.flatMap((x) => rawItems(x)).filter(isMarked);
  const body = marks.length ? h('div', null, h('p', { text: `These ${marks.length} mark${marks.length === 1 ? ' is' : 's are'} deleted with it:` }),
    h('ul', { class: 'small' }, marks.slice(0, 12).map((a) => h('li', { text: `${a.name}: ${markText(a)}` })), marks.length > 12 ? h('li', { text: `…and ${marks.length - 12} more` }) : null),
    h('p', { text: 'You can restore it from Recently deleted for 30 days.' }), previewBox(previewDelta(S.live, (d) => dropFrom(d, 'components', k.id), { courseId: k.course_id })))
    : 'You can restore it from Recently deleted for 30 days.';
  if (await confirmDialog(`Delete ${k.name}?`, body, 'Delete', { danger: true })) removeRow('components', k, k.name);
}

function compCard(course, k, res, child = false, sib = null) {
  const cres = res.components.get(k.id) || { weight: k.weight, average: null, soFar: 0 };
  const items = rawItems(k);
  const collapsed = S.collapsed.has(k.id);
  const drops = k.drop_average || k.drop_so_far;
  const rule = parseRule(k.rule);

  const card = h('div', { class: `comp${k.is_bonus ? ' bonus' : ''}${child ? ' child' : ''}` }, compHead(k, cres, { child, sib }));
  if (S.structure && sib) dropSpot(card, 'components', sib.rows, sib.i, sib.group);
  if (collapsed) return card;

  if (S.structure) {
    card.append(compStructure(course, k, items, child));
    return card;
  }
  card.append(items.length ? h('table', { class: 'items' }, h('tbody', null, items.map((a) => itemRow(a))))
    : h('p', { class: 'muted small empty-items', text: 'No items yet. Add one below, or paste several with “Bulk add / edit”.' }));
  const notes = [];
  if (!k.is_bonus && Number(k.weight) === 0 && !child) notes.push('0%: shown, not counted');
  if (drops) notes.push(`drops lowest ${k.drop_average === k.drop_so_far ? k.drop_average : `${k.drop_so_far} (so far) / ${k.drop_average} (avg)`}`);
  if (k.aggregation === 'weighted') notes.push('weighted by item');
  if (rule && rule.type === 'absorb_if_higher') notes.push('takes a midterm’s weight if higher');
  if (rule && rule.type === 'min_warning') notes.push(`${rule.label || 'minimum'}: ${pct(rule.min, 0)}`);
  if (k.projected != null) notes.push(`projected ${pct(k.projected, 1)} (est.)`);
  const nameOf = (id) => S.live.components.find((x) => x.id === id)?.name || '?';
  const out = new Map(), inn = new Map();
  for (const m of res.moves || []) {
    if (m.from === k.id) out.set(m.to, (out.get(m.to) || 0) + m.weight);
    if (m.to === k.id) inn.set(m.from, (inn.get(m.from) || 0) + m.weight);
  }
  for (const [to, w] of out) notes.push(`excused: ${num(w)}% → ${nameOf(to)}`);
  for (const [from, w] of inn) notes.push(`+${num(w)}% from excused ${nameOf(from)}`);
  card.append(h('div', { class: 'comp-foot small' },
    h('button', { class: 'link', type: 'button', text: '+ Add item', on: { click: () => create('assessments', {
      component_id: k.id, name: nextName(k), mark: null, out_of: items[items.length - 1]?.out_of ?? 1,
      sort_order: Math.max(0, ...items.map((a) => a.sort_order ?? 0)) + 1 }) } }),
    h('button', { class: 'link', type: 'button', text: 'Bulk add / edit', on: { click: () => bulkDialog(course, k) } }),
    notes.length ? h('span', { class: 'muted', text: notes.join(' · ') }) : null));
  return card;
}

function itemRow(a) {
  const curve = parseCurve(a.curve);
  const ca = calcItem(a);  // calc's copy: a letter-only mark has its estimated number here
  const curved = !!curve && ca.mark !== null && ca.mark !== undefined;
  const tag = a.excused ? h('span', { class: 'badge', title: 'Left out; its weight moves as set in Edit structure', text: 'excused' })
    : a.counts_in && a.counts_in !== 'both'
      ? h('span', { class: 'badge', text: { so_far: 'so-far only', average: 'average only', none: 'not counted' }[a.counts_in] }) : null;
  let sub = null;
  if (curved) {
    sub = h('div', { class: 'muted small curve-note', title: 'Curved mark above (used in the math); raw mark as entered here',
      text: `raw ${markText(a)}${ca.estimated ? ' (est.)' : ''} · ${curveText(curve, itemUnit(a))} (${itemPct(ca) >= rawPct(ca) ? '+' : '−'}${pct(Math.abs(itemPct(ca) - rawPct(ca)), 1)})` });
  } else if (ca.estimated) {
    sub = h('div', { class: 'muted small', title: 'A letter with no number counts as the middle of its range', text: `≈ ${pct(ca.mark / (ca.out_of || 1), 1)} est.` });
  } else if (a.out_of !== 1 && a.mark !== null && a.mark !== undefined) {
    sub = h('div', { class: 'muted small', text: pct(a.mark / a.out_of, 1) });
  }
  const editText = a.mark === null || a.mark === undefined ? (a.letter || '') : a.out_of === 1 ? num(a.mark * 100) : `${num(a.mark)}/${num(a.out_of)}`;
  return h('tr', { class: a.excused ? 'excused' : !isMarked(a) ? 'unmarked' : '' },
    h('td', null, editable({ text: a.name, edit: a.name, label: 'Item name', parse: textField('Name', { required: true }),
      save: (v) => patch('assessments', a, { name: v }) }), tag,
    a.projected != null ? h('span', { class: 'muted small', text: `  proj. ${pct(a.projected, 0)}` }) : null,
    isOpenItem(a) ? h('div', { class: 'need-item', dataset: { needItem: String(a.id) } }) : null),
    h('td', { class: 'date' }, editable({ text: a.date || '', edit: a.date || '', type: 'date', label: 'Date',
      parse: (v) => ({ value: v || null }), save: (v) => patch('assessments', a, { date: v }) })),
    h('td', { class: 'mark num' }, editable({
      text: curved ? markText({ ...ca, letter: null, mark: curvedMark(ca) }) : markText(a), cls: 'mark-ed', label: `Mark for ${a.name}${curved ? ' (raw; shown curved)' : ''}`,
      edit: editText,
      placeholder: a.out_of === 1 ? '85, 17/20 or B+' : `points / ${num(a.out_of)}`,
      parse: (v) => { const r = parseMark(v, a.out_of); return r.error ? r : { value: r, warn: r.warn }; },
      save: (r) => patch('assessments', a, r.out_of !== a.out_of ? { mark: r.mark, out_of: r.out_of, letter: r.letter } : { mark: r.mark, letter: r.letter }),
    }), sub));
}

function compStructure(course, k, items, child) {
  const leaves = leavesOf(course);
  const others = leaves.filter((x) => x.id !== k.id && !x.is_bonus);
  const rule = parseRule(k.rule);
  const ruleType = S.ruleDraft.get(k.id) ?? (rule ? rule.type : '');
  const ruleSel = h('select', { dataset: { k: `components:${k.id}:ruletype` }, on: { change: (e) => {
    const t = e.target.value;
    if (t === '') { S.ruleDraft.delete(k.id); patch('components', k, { rule: null }); return; }
    if (t === 'min_warning') { S.ruleDraft.delete(k.id); patch('components', k, { rule: { type: 'min_warning', min: 0.5, label: `${k.name} min 50%` } }); return; }
    S.ruleDraft.set(k.id, t); render(); // absorb: pick components first
  } } },
  [['', 'No rule'], ['absorb_if_higher', 'Takes weight of… if higher'], ['min_warning', 'Minimum warning']]
    .map(([v, l]) => h('option', { value: v, text: l, selected: ruleType === v })));
  let ruleExtra = null;
  if (ruleType === 'absorb_if_higher') {
    const from = new Set(rule && rule.type === 'absorb_if_higher' ? rule.from : []);
    ruleExtra = h('div', { class: 'field wide' }, 'Takes the weight of (when this one is higher):', others.map((o) => h('label', { class: 'field check' },
      h('input', { type: 'checkbox', checked: from.has(o.id), on: { change: (e) => {
        if (e.target.checked) from.add(o.id); else from.delete(o.id);
        S.ruleDraft.delete(k.id);
        patch('components', k, { rule: from.size ? { type: 'absorb_if_higher', from: [...from] } : null });
      } } }), o.name)));
  } else if (ruleType === 'min_warning' && rule) {
    ruleExtra = [
      h('label', { class: 'field' }, 'Minimum %', h('input', { type: 'text', inputmode: 'decimal', value: num(rule.min * 100), on: { change: (e) => {
        const r = numberField(0, 100, { label: 'Minimum' })(e.target.value);
        if (r.error) { toast(r.error, { error: true }); render(); return; }
        patch('components', k, { rule: { ...rule, min: r.value / 100 } });
      } } })),
      h('label', { class: 'field' }, 'Warning label', h('input', { type: 'text', value: rule.label || '', maxlength: '60', on: { change: (e) => {
        patch('components', k, { rule: { type: 'min_warning', min: rule.min, ...(e.target.value.trim() ? { label: e.target.value.trim() } : {}) } });
      } } })),
    ];
  }

  return h('div', { class: 'struct' },
    h('div', { class: 'struct-grid' },
      child
        ? field('Share of group', 'components', k, 'weight', { parse: numberField(0, 1000, { label: 'Share' }), decimal: true })
        : field('Weight %', 'components', k, 'weight', { parse: numberField(0, 100, { label: 'Weight' }), decimal: true }),
      child ? null : field('Bonus (on top of 100)', 'components', k, 'is_bonus', { type: 'checkbox' }),
      field('Drop lowest (so far)', 'components', k, 'drop_so_far', { parse: numberField(0, 100, { int: true, label: 'Drop' }), decimal: true }),
      field('Drop lowest (average)', 'components', k, 'drop_average', { parse: numberField(0, 100, { int: true, label: 'Drop' }), decimal: true }),
      field('Combine items', 'components', k, 'aggregation', { type: 'select', options: [['mean', 'Mean'], ['weighted', 'By item weight']] }),
      field('Projected % (est.)', 'components', k, 'projected', { parse: pctField('Projected'), format: pctOut, placeholder: 'none', decimal: true }),
      h('label', { class: 'field' }, 'Rule', ruleSel), ruleExtra, excusedField(k, others)),
    h('div', { class: 'table-scroll' }, h('table', { class: 'items-struct' },
      h('thead', null, h('tr', null, ['', 'Item', 'Out of', 'Item weight', 'Counts in', 'Excused', 'Curve', 'Proj. %', ''].map((t) => h('th', { text: t })))),
      h('tbody', null, items.length ? null : h('tr', null, h('td', { colspan: '9', class: 'muted small', text: 'No items yet: + Item or Bulk add / edit.' })),
        items.map((a, i) => dropSpot(h('tr', null,
        h('td', { class: 'order-cell' }, orderCtl('assessments', items, i, `items:${k.id}`)),
        h('td', null, structInput('assessments', a, 'name', textField('Name', { required: true }))),
        h('td', null, structInput('assessments', a, 'out_of', numberField(0.000001, 1e6, { label: 'Out of' }))),
        h('td', null, structInput('assessments', a, 'item_weight', numberField(0, 1e6, { nullable: true, label: 'Item weight' }))),
        h('td', null, h('select', { 'aria-label': `Counts in: ${a.name}`, dataset: { k: `assessments:${a.id}:counts_in` }, on: { change: (e) => patch('assessments', a, { counts_in: e.target.value }) } },
          [['both', 'Both'], ['so_far', 'So far'], ['average', 'Average'], ['none', 'Neither']].map(([v, l]) => h('option', { value: v, text: l, selected: (a.counts_in || 'both') === v })))),
        h('td', null, h('input', { type: 'checkbox', checked: !!a.excused, 'aria-label': `Excused: ${a.name}`, dataset: { k: `assessments:${a.id}:excused` },
          on: { change: (e) => patch('assessments', a, { excused: e.target.checked ? 1 : 0 }) } })),
        h('td', null, h('input', { type: 'text', class: 'curve-in', value: curveText(parseCurve(a.curve), itemUnit(a)), placeholder: '+2 ×1.1 =45',
          'aria-label': `Curve: ${a.name}`, title: `In the item’s own points${a.out_of === 1 ? ' (%)' : ` (out of ${num(a.out_of)})`}: +2, −1, ×1.1 or =45 (the adjusted mark). Empty = none.`,
          dataset: { k: `assessments:${a.id}:curve` }, on: {
            keydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
            change: (e) => {
              const r = parseItemCurve(e.target.value, a);
              if (r.error) { toast(r.error, { error: true }); render(); return; }
              if (JSON.stringify(r.value) !== JSON.stringify(a.curve ?? null)) patch('assessments', a, { curve: r.value });
            } } })),
        h('td', null, structInput('assessments', a, 'projected', pctField('Projected'), pctOut)),
        h('td', null, h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Delete ${a.name}`, text: '×',
          on: { click: () => deleteItem(course, a) } }))), 'assessments', items, i, `items:${k.id}`))))),
    h('p', { class: 'row-actions' },
      h('button', { class: 'btn small', type: 'button', text: '+ Item', on: { click: () => create('assessments', {
        component_id: k.id, name: nextName(k), mark: null, out_of: items[items.length - 1]?.out_of ?? 1,
        sort_order: Math.max(0, ...items.map((a) => a.sort_order ?? 0)) + 1 }) } }),
      h('button', { class: 'btn small', type: 'button', text: 'Bulk add / edit', on: { click: () => bulkDialog(course, k) } }),
      h('button', { class: 'btn small', type: 'button', text: 'Duplicate', title: 'A copy of this component and its items (no marks)', on: { click: () => duplicateComponent(course, k) } }),
      child ? null : h('button', { class: 'btn small', type: 'button', text: 'Split into parts', title: 'e.g. Labs = reports + quizzes', on: { click: () => addPart(course, k) } }),
      h('button', { class: 'btn small danger', type: 'button', text: child ? 'Delete part' : 'Delete component', on: { click: () => deleteComponent(k) } })));
}

/** Where an excused item's weight goes: stays here, one other component, or split by date around a component's date. */
function excusedField(k, others) {
  const cur = parseRule(k.excused_to);
  const mode = cur && cur.by_date ? 'by_date' : cur && cur.to ? `to:${cur.to}` : '';
  const guess = (re) => others.find((o) => re.test(o.name))?.id;
  const sel = h('select', { dataset: { k: `components:${k.id}:excused_to` }, 'aria-label': 'Excused items go to', on: { change: (e) => {
    const v = e.target.value;
    if (v === '') return patch('components', k, { excused_to: null });
    if (v.startsWith('to:')) return patch('components', k, { excused_to: { to: Number(v.slice(3)) } });
    const pivot = guess(/mid/i) ?? others[0]?.id, after = guess(/final|exam/i) ?? others[others.length - 1]?.id;
    if (!pivot || !after) { toast('Needs other components to move weight to', { error: true }); render(); return; }
    patch('components', k, { excused_to: { by_date: { pivot, before: pivot, after } } });
  } } },
  h('option', { value: '', text: 'Stay here', title: 'The other items in this component share its weight', selected: mode === '' }),
  others.map((o) => h('option', { value: `to:${o.id}`, text: `→ ${o.name}`, selected: mode === `to:${o.id}` })),
  others.length ? h('option', { value: 'by_date', text: 'By date (before / after a date)', selected: mode === 'by_date' }) : null);
  const out = [h('label', { class: 'field' }, 'Excused items go to', sel)];
  if (mode === 'by_date') {
    const b = cur.by_date;
    const pick = (label, key) => h('label', { class: 'field' }, label, h('select', { dataset: { k: `components:${k.id}:excused_${key}` }, on: { change: (e) => {
      patch('components', k, { excused_to: { by_date: { ...b, [key]: Number(e.target.value) } } });
    } } }, others.map((o) => h('option', { value: String(o.id), text: o.name, selected: b[key] === o.id }))));
    out.push(pick('Date of', 'pivot'), pick('Before it →', 'before'), pick('On/after, or no date →', 'after'));
  }
  return out;
}

function structInput(entity, row, key, parse, format) {
  return h('input', { type: 'text', value: format ? format(row[key]) : row[key] ?? '', dataset: { k: `${entity}:${row.id}:${key}` },
    'aria-label': `${key.replace('_', ' ')}: ${row.name}`, on: {
      keydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      change: (e) => {
        const r = parse(e.target.value);
        if (r.error) { toast(r.error, { error: true }); render(); return; }
        if (r.value !== row[key]) patch(entity, row, { [key]: r.value });
      },
    } });
}

// ---------------------------------------------------------------- delete an item, duplicate, bulk add / edit
/** An unmarked item goes at once (Undo in the toast); a marked one asks first and shows what the average does. */
async function deleteItem(course, a) {
  if (isMarked(a)) {
    const body = h('div', null, h('p', { text: `Its mark (${markText(a)}) is deleted with it. You can restore it from Recently deleted for 30 days.` }),
      previewBox(previewDelta(S.live, (d) => dropFrom(d, 'assessments', a.id), { courseId: course.id })));
    if (!(await confirmDialog(`Delete ${a.name}?`, body, 'Delete', { danger: true }))) return;
  }
  removeRow('assessments', a, a.name);
}

/** Create copies of `comps` (with parts and items) in course `toCourseId`; rules point at the copies. */
async function copyComponents(fromCourse, comps, toCourseId, { withMarks = false, sameCourse = false } = {}) {
  const all = rawComps(fromCourse);
  const allIds = new Set(all.map((k) => k.id));
  const plan = copyComponentsPlan(comps, all, S.live.assessments.filter((a) => allIds.has(a.component_id)), { withMarks });
  return createFromPlan(plan, toCourseId, { sameCourse, all });
}
/** Create the components and items of a copy plan (duplicate, or a template file) in a course; rules re-pointed. */
async function createFromPlan(plan, toCourseId, { sameCourse = false, all = [] } = {}) {
  const idMap = new Map(), made = [];
  let order = sameCourse ? Math.max(0, ...all.map((x) => x.sort_order ?? 0)) : 0;
  for (const p of plan) {
    const body = { ...p.body, course_id: toCourseId };
    const orig = all.find((x) => x.id === p.old);
    body.parent_id = p.parentOld != null ? idMap.get(p.parentOld) ?? null : sameCourse ? orig.parent_id ?? null : null;
    if (sameCourse && p.parentOld == null) {
      body.name = `${p.body.name} (copy)`;
      body.sort_order = ++order;
      const rule = parseRule(body.rule);
      if (rule && rule.type === 'absorb_if_higher') body.rule = null; // the original keeps taking that weight (see remapRefs)
    }
    const row = await create('components', body);
    if (!row) return null;
    idMap.set(p.old, row.id);
    made.push({ row, body });
    for (const it of p.items) if (!(await create('assessments', { ...it, component_id: row.id }))) return null;
  }
  for (const { row, body } of made) {
    const fix = remapRefs(body, idMap, { keepUnmapped: sameCourse, dropUnmappedAbsorb: sameCourse });
    if (Object.keys(fix).length) await patch('components', row, fix);
  }
  return idMap;
}

function duplicateComponent(course, k) {
  return batch(`duplicate ${k.name}`, async () => {
    if (await copyComponents(course, [k], course.id, { sameCourse: true })) toast(`Duplicated ${k.name} (no marks)`);
  });
}

function duplicateCourse(course) {
  const termSel = h('select', { 'aria-label': 'Copy into term' },
    S.live.terms.map((t) => h('option', { value: String(t.id), text: t.name, selected: t.id === course.term_id })));
  const marks = h('input', { type: 'checkbox', 'aria-label': 'Copy marks too' });
  const go = async () => {
    const to = S.live.terms.find((t) => t.id === Number(termSel.value));
    if (!to) return;
    closeDialog('dlg');
    const withMarks = marks.checked;
    let row = null;
    await batch(`duplicate ${courseLabel(course)}`, async () => {
      const body = copyCourseBody(course, { withMarks });
      if (to.id === course.term_id) body.title = `${course.title} (copy)`.slice(0, 200);
      row = await create('courses', { ...body, term_id: to.id, sort_order: Math.max(0, ...coursesOf(to).map((x) => x.sort_order ?? 0)) + 1 });
      if (row && !(await copyComponents(course, topComps(course), row.id, { withMarks }))) toast('Stopped part-way: Undo removes the copy.', { error: true });
    });
    if (!row) return;
    location.hash = courseHash(to, row);
    toast(`Duplicated ${courseLabel(course)} into ${to.name}${withMarks ? '' : ' (no marks)'}`, H.last ? { action: undoAction(H.last) } : {});
  };
  openDialog('dlg', h('h2', { text: `Duplicate ${courseLabel(course)}` }),
    h('p', { class: 'muted small', text: 'Copies the course with its components, parts, items and rules. Handy for a retake or the same course next term. Repeat links aren’t copied.' }),
    h('div', { class: 'form' },
      h('label', null, 'Into term', termSel),
      h('label', { class: 'check' }, marks, 'Copy marks, the final grade and the curve too')),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => closeDialog('dlg') } }),
      h('button', { class: 'btn primary', type: 'button', id: 'dup-go', text: 'Duplicate', on: { click: go } })));
}

/** Bulk add / edit: "Name: mark" per line. Matching names get the mark; new names become items; nothing is deleted. */
function bulkDialog(course, k) {
  const items = () => rawItems(k);
  const outOf = items().slice(-1)[0]?.out_of ?? 1;
  const box = h('textarea', { rows: '10', 'aria-label': 'Items, one per line', spellcheck: 'false', class: 'bulk' });
  box.value = bulkText(items(), markText);
  const info = h('div', { class: 'small', role: 'status' });
  const err = h('div', { class: 'err-msg' });
  const apply = (d, r) => {
    for (const u of r.updates) Object.assign(d.assessments.find((x) => x.id === u.item.id), u.changes);
    r.creates.forEach((c, i) => d.assessments.push({ id: 1e12 + i, component_id: k.id, counts_in: 'both', excused: 0, item_weight: null,
      curve: null, projected: null, date: null, sort_order: 1e6 + i, ...c }));
  };
  const check = () => {
    const r = parseBulk(box.value, items(), { outOf });
    err.textContent = r.errors.slice(0, 3).join(' · ') + (r.errors.length > 3 ? ` (+${r.errors.length - 3} more)` : '');
    if (r.errors.length) { fill(info); return null; }
    fill(info, h('div', { text: `${r.updates.length} mark${r.updates.length === 1 ? '' : 's'} changed · ${r.creates.length} new item${r.creates.length === 1 ? '' : 's'}` }),
      r.warnings.length ? h('div', { class: 'warn-text', text: `Check: ${r.warnings.join(', ')}` }) : null,
      r.updates.length || r.creates.length ? previewBox(previewDelta(S.live, (d) => apply(d, r), { courseId: course.id })) : null);
    return r;
  };
  const addLines = () => {
    const lines = box.value.split(/\r?\n/).filter((l) => l.trim());
    const last = lines.length ? lines[lines.length - 1].split(':')[0].trim() : '';
    const m = /^(.*?)(\d+)$/.exec(last);
    const base = m ? m[1] : `${k.name.replace(/s$/i, '')} `;
    let n = m ? Number(m[2]) : lines.length;
    for (let i = 0; i < 5; i++) lines.push(`${base}${++n}:`);
    box.value = lines.join('\n');
    check();
  };
  const go = async () => {
    const r = check();
    if (!r) return;
    closeDialog('dlg');
    if (!r.updates.length && !r.creates.length) return;
    const start = Math.max(0, ...items().map((a) => a.sort_order ?? 0));
    await batch(`bulk edit ${k.name}`, async () => {
      for (const u of r.updates) await patch('assessments', u.item, u.changes);
      for (const [i, c] of r.creates.entries()) await create('assessments', { component_id: k.id, ...c, sort_order: start + i + 1 });
    });
    toast(`${k.name}: ${r.updates.length} changed, ${r.creates.length} added`, H.last ? { action: undoAction(H.last) } : {});
  };
  box.addEventListener('input', check);
  openDialog('dlg', h('h2', { text: `Bulk add / edit: ${k.name}` }),
    h('p', { class: 'muted small', text: `One item per line: “Name: mark” (85, 85%, 17/20 or B+). A blank mark after “:” clears it. Names that match an item change its mark; new names add items${outOf !== 1 ? ` (out of ${num(outOf)} unless you type x/y)` : ''}. Items you remove from the box are left alone.` }),
    box, h('p', null, h('button', { class: 'btn small', type: 'button', text: '+ 5 numbered lines', on: { click: addLines } })),
    info, err,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => closeDialog('dlg') } }),
      h('button', { class: 'btn primary', type: 'button', id: 'bulk-go', text: 'Save', on: { click: go } })));
  check();
  box.focus();
}

// ---------------------------------------------------------------- history drawer
const SKIP = new Set(['id', 'created_at', 'updated_at', 'version', 'deleted_at']);
const ENTITY_LABEL = { courses: 'Course', components: 'Component', assessments: 'Item', terms: 'Term', repeats: 'Repeat link', settings: 'Settings' };
function fmtVal(key, v, row) {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'mark') return row && row.out_of && row.out_of !== 1 ? `${num(v)} / ${num(row.out_of)}` : pct(v, 1);
  if (key === 'projected' || key === 'final_override') return pct(v, 1);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}
async function openHistory(course) {
  const { entries } = await api.audit(course ? { course_id: course.id, limit: 500 } : { limit: 500 });
  const list = entries.map((e) => {
    const before = e.before, after = e.after;
    const row = after || before || {};
    const name = e.entity === 'settings' ? '' : row.name || row.title || `#${e.entity_id}`;
    let diff = null;
    if (e.action === 'update' && before && after) {
      diff = Object.keys(after).filter((k) => !SKIP.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
        .map((k) => h('div', { class: 'diff' }, `${k.replace(/_/g, ' ')}: `, fmtVal(k, before[k], before), ' → ', h('b', { text: fmtVal(k, after[k], after) })));
    }
    const verb = { create: 'added', update: 'changed', delete: 'deleted', restore: 'restored' }[e.action] || e.action;
    return h('li', null, h('div', { class: 'when', text: when(e.at) }), h('div', null, `${ENTITY_LABEL[e.entity] || e.entity} `, h('b', { text: name }), ` ${verb}`), diff);
  });
  openDialog('drawer',
    h('div', { class: 'pane-head' }, h('h2', { text: course ? `History · ${courseLabel(course)}` : 'History · all changes' }),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Close', on: { click: () => closeDialog('drawer') } }))),
    h('p', { class: 'muted small', text: 'Up to your last 1000 changes in this browser. Undo (↶ or Ctrl+Z) and Redo (↷ or Ctrl+Y) only step through changes made since you opened this page. Deleted terms, courses, components and items can be restored from Recently deleted for 30 days.' }),
    list.length ? h('ul', { class: 'list hist' }, list) : h('p', { class: 'muted', text: 'No changes recorded yet.' }));
}

// ---------------------------------------------------------------- recently deleted
async function openDeleted() {
  const d = await api.deleted();
  const all = await api.snapshot();
  const ctx = (entity, r) => {
    if (entity === 'assessments') {
      const k = all.components.find((x) => x.id === r.component_id);
      const c = k && all.courses.find((x) => x.id === k.course_id);
      return [c && courseLabel(c), k && k.name].filter(Boolean).join(' · ');
    }
    if (entity === 'components') { const c = all.courses.find((x) => x.id === r.course_id); return c ? courseLabel(c) : ''; }
    if (entity === 'courses') { const t = all.terms.find((x) => x.id === r.term_id); return t ? t.name : ''; }
    return '';
  };
  const sections = ['terms', 'courses', 'components', 'assessments'].filter((e) => (d[e] || []).length).map((e) => [
    h('h3', { text: `${ENTITY_LABEL[e]}s` }),
    h('ul', { class: 'list docs' }, d[e].map((r) => {
      const label = r.name || r.title || r.code || `#${r.id}`;
      return h('li', null, h('span', { class: 'grow' }, label, h('span', { class: 'muted small', text: `  ${ctx(e, r)}  ·  ${when(r.deleted_at)}` })),
        h('button', { class: 'btn small', type: 'button', text: 'Restore', on: { click: async () => { closeDialog('dlg'); await restoreRow(e, r.id, label); } } }));
    }))]);
  openDialog('dlg', h('h2', { text: 'Recently deleted' }),
    h('p', { class: 'muted small', text: 'Kept for 30 days in this browser, then removed for good.' }),
    sections.length ? h('div', null, sections) : h('p', { class: 'muted', text: 'Nothing deleted.' }),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Close', on: { click: () => closeDialog('dlg') } })));
}

// ---------------------------------------------------------------- settings
const scaleLines = (cs) => (cs && Array.isArray(cs.bands) ? cs.bands : SCALES.gpa4.bands)
  .map((b) => `${num(b.min * 100)} ${b.letter}${b.points !== null && b.points !== undefined ? ` ${num(b.points)}` : ''}`).join('\n');
function parseScale(text) {
  const bands = [];
  for (const [i, line] of String(text).split(/\r?\n/).entries()) {
    const t = line.trim();
    if (!t) continue;
    const m = /^(\d*\.?\d+)\s*%?\s+(\S{1,4})(?:\s+(\d*\.?\d+))?$/.exec(t);
    if (!m) return { error: `Line ${i + 1}: write “minimum% letter points”, e.g. 85 A 4.0` };
    const min = Number(m[1]);
    if (min > 100) return { error: `Line ${i + 1}: minimum must be 0–100` };
    bands.push({ min: min / 100, letter: m[2], points: m[3] === undefined ? null : Number(m[3]) });
  }
  if (!bands.length) return { error: 'Add at least one line' };
  const points = bands.some((b) => b.points !== null);
  if (points && bands.some((b) => b.points === null)) return { error: 'Give points on every line, or on none' };
  return { value: { name: 'Custom', kind: points ? 'points' : 'percent', max: points ? Math.max(...bands.map((b) => b.points)) : null, bands } };
}

function openSettings() {
  const st = S.data.settings;
  const scale = h('select', { 'aria-label': 'Grade scale' },
    Object.values(SCALES).map((s) => h('option', { value: s.id, text: s.name, selected: (st.gpa_scale || 'uwindsor') === s.id })),
    h('option', { value: 'custom', text: 'Custom…', selected: st.gpa_scale === 'custom' }));
  const custom = h('textarea', { rows: '8', 'aria-label': 'Custom scale', spellcheck: 'false' });
  custom.value = scaleLines(st.custom_scale);
  const customBox = h('label', null, 'Custom scale: one line per letter, “minimum% letter points” (points optional)', custom);
  const showCustom = () => { customBox.hidden = scale.value !== 'custom'; };
  scale.addEventListener('change', showCustom);
  showCustom();
  const repeat = h('select', { 'aria-label': 'Repeated courses' },
    Object.entries(POLICY_LABEL).map(([v, l]) => h('option', { value: v, text: l, selected: (st.repeat_policy_default || 'best') === v })));
  const credits = h('input', { type: 'text', inputmode: 'decimal', value: String(defaultCredits()), 'aria-label': 'Default credits' });
  const err = h('div', { class: 'err-msg' });
  const save = async () => {
    const cr = numberField(0, 30, { label: 'Default credits' })(credits.value);
    if (cr.error) { err.textContent = cr.error; return; }
    const changes = { gpa_scale: scale.value, repeat_policy_default: repeat.value, default_credits: cr.value };
    if (scale.value === 'custom') {
      const p = parseScale(custom.value);
      if (p.error) { err.textContent = p.error; return; }
      changes.custom_scale = p.value;
    }
    closeDialog('dlg');
    if (await saveSettings(changes)) toast('Settings saved');
  };
  const kb = Math.max(1, Math.round(api.stats().bytes / 1024));
  openDialog('dlg', h('h2', { text: 'Settings' }),
    h('div', { class: 'form' },
      h('label', null, 'Grade scale (letters and GPA)', scale),
      h('p', { class: 'muted small', text: 'The UWindsor scales follow the University of Windsor’s published grading policy: the percentage scale shows your grade as a percent with a letter beside it; the 13-point scale is for courses before Fall 2013. The 4.0 and 12-point scales are generic, not official for any school.' }),
      customBox,
      h('label', null, 'Repeated courses: which attempt counts (default for every repeat)', repeat),
      h('p', { class: 'muted small', text: 'UWindsor counts your best attempt. Many other schools count the latest attempt; change it here, or per course in Edit structure.' }),
      h('label', null, 'Credits for a new course', credits),
      err),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => closeDialog('dlg') } }),
      h('button', { class: 'btn primary', type: 'button', text: 'Save', on: { click: save } })),
    h('h3', { text: 'Your data' }),
    h('p', { class: 'muted small', text: `Stored in this browser only (${kb} KB). Clearing your browser’s site data deletes it: download a backup now and then.` }),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn small', type: 'button', id: 'settings-files', text: 'Export / import…', on: { click: openFiles } }),
      h('button', { class: 'btn small', type: 'button', id: 'settings-demo', text: 'Load demo data', on: { click: loadDemo } }),
      h('button', { class: 'btn small danger', type: 'button', id: 'settings-reset', text: 'Reset everything', on: { click: resetAll } })));
}

/** Per-course view choices ("what do I need" targets, recent courses) belong to the gradebook they were made for. */
function clearViewChoices() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('gc-need-') || k === 'gc-recent-courses') localStorage.removeItem(k);
  } catch { /* storage blocked: nothing to clear */ }
}

async function loadDemo() {
  if (hasData() && !(await confirmDialog('Replace your gradebook with demo data?', 'Everything in this browser is replaced by a made-up student’s courses. This can’t be undone.', 'Replace with demo', { danger: true }))) return;
  closeDialog('dlg');
  S.data = await track(api.replace(demoDoc()));
  clearViewChoices();
  clearUndo();
  S.collapsed.clear();
  recompute();
  location.hash = '#/overview';
  render();
  toast('Demo data loaded. Settings → Reset everything clears it.');
}

async function resetAll() {
  const n = S.live.courses.length;
  const marks = S.live.assessments.filter(isMarked).length;
  const ok = await confirmDialog('Reset everything?',
    `This deletes ${S.live.terms.length} term(s), ${n} course(s) and ${marks} mark(s) from this browser, plus history and Recently deleted. It can’t be undone. Your theme and view choices stay.`,
    'Delete everything', { danger: true });
  if (!ok) return;
  S.data = await track(api.replace(emptyDoc()));
  clearViewChoices();
  clearUndo();
  S.collapsed.clear();
  setStructure(false);
  recompute();
  location.hash = '#/';
  render();
  toast('Everything was deleted from this browser.');
}

// ---------------------------------------------------------------- files: export / import (Round 4)
// SheetJS (vendored, pinned) is loaded only when an Excel file is written or read.
const XLSX_SRC = '/vendor/sheetjs-0.20.3/xlsx.mini.min.js';
let xlsxReady = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  xlsxReady ??= new Promise((resolve, reject) => {
    const s = h('script', { src: XLSX_SRC });
    s.addEventListener('load', () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('the Excel library didn’t start'))));
    s.addEventListener('error', () => { xlsxReady = null; reject(new Error('couldn’t load the Excel library (offline?)')); });
    document.head.append(s);
  });
  return xlsxReady;
}
function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, hidden: true });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
const fileSlug = (s) => String(s || 'course').replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'course';

async function exportFile(kind) {
  try {
    const doc = api.snapshot();
    const name = backupName();
    if (kind === 'json') {
      download(`${name}.json`, new Blob([JSON.stringify(backupFile(doc), null, 1)], { type: 'application/json' }));
    } else if (kind === 'csv') {
      download(`${name}.csv`, new Blob([toCsv(marksTable(doc))], { type: 'text/csv;charset=utf-8' }));
    } else {
      const X = await loadXlsx();
      const wb = X.utils.book_new();
      for (const [sheet, rows] of Object.entries(toSheets(doc))) {
        const ws = X.utils.aoa_to_sheet(rows);
        ws['!cols'] = (rows[0] || []).map((_, j) => ({ wch: Math.min(40, Math.max(8, ...rows.slice(0, 200).map((r) => String(r[j] ?? '').length))) }));
        X.utils.book_append_sheet(wb, ws, sheet);
      }
      download(`${name}.xlsx`, new Blob([X.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    }
    toast(kind === 'json' ? 'Backup downloaded (everything, incl. history)' : kind === 'csv' ? 'CSV of your marks downloaded' : 'Excel workbook downloaded');
  } catch (e) {
    toast(`Couldn’t export: ${e.message}`, { error: true });
  }
}

/** A chosen file → { kind: 'backup' | 'sheets' | 'csv', doc } or { kind: 'template', template }. Throws with a reason. */
async function readImport(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is over 5 MB; a gradebook file is much smaller.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { throw new Error('That .json file isn’t valid JSON.'); }
    return readJson(obj);
  }
  if (name.endsWith('.csv') || name.endsWith('.txt')) return { kind: 'csv', doc: fromMarksTable(parseCsv(await file.text())) };
  if (/\.(xlsx|xlsm|xls|ods)$/.test(name)) {
    const X = await loadXlsx();
    let wb;
    try { wb = X.read(await file.arrayBuffer(), XLSX_READ_OPTS); } catch { throw new Error('Couldn’t read that spreadsheet.'); }
    return { kind: 'sheets', doc: fromSheets(sheetsFromWorkbook(X, wb)) };
  }
  throw new Error('Pick a .xlsx, .csv or .json file.');
}

function openFiles() {
  const err = h('div', { class: 'err-msg', id: 'import-err', role: 'alert' });
  const input = h('input', { type: 'file', id: 'import-file', accept: '.xlsx,.xls,.ods,.csv,.json', 'aria-label': 'Import a file' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    err.textContent = '';
    let got;
    try { got = await readImport(file); } catch (e) { err.textContent = e.message; return; }
    if (got.kind === 'template') importTemplate(got.template);
    else importDialog(got, file.name);
  });
  const kb = Math.max(1, Math.round(api.stats().bytes / 1024));
  openDialog('dlg', h('h2', { text: 'Files' }),
    h('h3', { text: 'Download' }),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn small', type: 'button', id: 'export-xlsx', text: 'Excel (.xlsx)', on: { click: () => exportFile('xlsx') } }),
      h('button', { class: 'btn small', type: 'button', id: 'export-csv', text: 'CSV (marks)', on: { click: () => exportFile('csv') } }),
      h('button', { class: 'btn small primary', type: 'button', id: 'export-json', text: 'Backup (.json)', on: { click: () => exportFile('json') } })),
    h('ul', { class: 'muted small files-help' },
      h('li', { text: 'Backup (.json): everything, including History and Recently deleted. Use it to move to another browser or keep a copy.' }),
      h('li', { text: 'Excel: one sheet per kind of row, with your averages beside them. You can edit it and import it again: the “Read me” sheet explains how.' }),
      h('li', { text: 'CSV: one row per mark (term, course, component, item). Rules, curves, drops and item weights aren’t in it.' })),
    h('h3', { text: 'Import' }),
    h('p', { class: 'muted small', text: 'A GradeCalc backup, Excel workbook or CSV, or a course template. You choose next whether it replaces your gradebook or is added to it.' }),
    h('label', { class: 'btn small file-pick' }, 'Choose a file…', input),
    err,
    h('h3', { text: 'Course templates' }),
    h('p', { class: 'muted small', text: 'A template is a course’s structure (components, weights, items, rules) with no marks, to share with classmates or reuse. Save one from a course in Edit structure → “Save as template”, and import it here.' }),
    h('p', { class: 'muted small', text: `Your gradebook uses ${kb} KB in this browser. Files are made and read on this device; nothing is uploaded.` }),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Close', on: { click: () => closeDialog('dlg') } })));
}

function importDialog({ kind, doc }, fileName) {
  const n = summary(doc), mine = summary(api.snapshot());
  const what = `${n.terms} term${n.terms === 1 ? '' : 's'}, ${n.courses} course${n.courses === 1 ? '' : 's'}, ${n.marks} mark${n.marks === 1 ? '' : 's'}`;
  if (!n.terms && !n.courses) { toast('That file has no terms or courses in it.', { error: true }); return; }
  const empty = !mine.terms && !mine.courses;
  const go = async (mode) => {
    closeDialog('dlg');
    const prev = api.snapshot();
    const next = mode === 'add' ? appendDoc(prev, doc) : doc;
    try {
      S.data = await track(api.replace(next, { ifUnchanged: true }));
    } catch (e) {
      toast(`Not imported: ${e.message}`, { error: true });
      return;
    }
    if (mode === 'replace') clearViewChoices();
    clearUndo();
    S.collapsed.clear();
    recompute();
    location.hash = '#/overview';
    render();
    // Undo puts `prev` back only while the gradebook is still exactly what the import made. ifUnchanged alone isn't
    // enough: an edit made here since, or another tab's save this tab already reloaded (storage event), would be wiped.
    const imported = JSON.stringify(api.snapshot());
    toast(`Imported ${what}${mode === 'add' ? ' (added)' : ''}`, { action: { label: 'Undo', fn: async () => {
      if (JSON.stringify(api.snapshot()) !== imported) {
        toast('Couldn’t undo the import: the gradebook has changed since (here or in another tab). Nothing was changed.', { error: true });
        return;
      }
      try { S.data = await track(api.replace(prev, { ifUnchanged: true })); clearUndo(); recompute(); render(); toast('Import undone'); }
      catch (e) { toast(`Couldn’t undo: ${e.message}`, { error: true }); }
    } } });
  };
  const kindText = kind === 'backup' ? 'GradeCalc backup' : kind === 'sheets' ? 'Excel workbook' : 'CSV';
  openDialog('dlg', h('h2', { text: 'Import' }),
    h('p', null, `${fileName} (${kindText}): `, h('b', { text: what }), '.'),
    empty ? null : h('p', { class: 'muted small', text: `You have ${mine.terms} term(s), ${mine.courses} course(s) and ${mine.marks} mark(s) now. Replace swaps your whole gradebook for the file${kind === 'backup' ? ', with its settings and history' : kind === 'sheets' ? ', with its settings (your History and Recently deleted start empty)' : ', with default settings (your History and Recently deleted start empty)'}. Add puts the file’s terms after yours and keeps your settings. You can Undo either one right after.` }),
    kind === 'csv' ? h('p', { class: 'muted small', text: 'From a CSV: terms, courses, components (with weights), items and marks. Set rules, drops and curves afterwards in Edit structure.' }) : null,
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => closeDialog('dlg') } }),
      empty ? null : h('button', { class: 'btn', type: 'button', id: 'import-add', text: 'Add to my gradebook', on: { click: () => go('add') } }),
      h('button', { class: `btn ${empty ? 'primary' : 'danger'}`, type: 'button', id: 'import-replace', text: empty ? 'Import' : 'Replace my gradebook', on: { click: () => go('replace') } })));
}

/** Save a course's structure (no marks) as a template file. */
function saveTemplate(course) {
  const comps = rawComps(course);
  const ids = new Set(comps.map((k) => k.id));
  const t = courseTemplate(course, comps, S.live.assessments.filter((a) => ids.has(a.component_id)));
  download(`gradecalc-template-${fileSlug(course.code || course.title)}.json`, new Blob([JSON.stringify(t, null, 1)], { type: 'application/json' }));
  toast('Template downloaded (structure only, no marks)');
}

/** A template file → a new course (with no marks) in a term the student picks. One undo step. */
function importTemplate({ course, plan }) {
  if (!S.live.terms.length) { toast('Add a term first, then import the template into it.', { error: true }); return; }
  const r = readRoute();
  const termSel = h('select', { 'aria-label': 'Into term', id: 'template-term' },
    S.live.terms.map((t) => h('option', { value: String(t.id), text: t.name, selected: r.shownTerm && t.id === r.shownTerm.id })));
  const n = plan.reduce((s, p) => s + p.items.length, 0);
  const go = async () => {
    const to = S.live.terms.find((t) => t.id === Number(termSel.value));
    if (!to) return;
    closeDialog('dlg');
    let row = null;
    await batch(`add ${course.code || course.title} from a template`, async () => {
      row = await create('courses', { ...course, term_id: to.id, status: 'active',
        sort_order: Math.max(0, ...coursesOf(to).map((x) => x.sort_order ?? 0)) + 1 });
      if (row && !(await createFromPlan(plan, row.id))) toast('Stopped part-way: Undo removes the course.', { error: true });
    });
    if (!row) return;
    location.hash = courseHash(to, row);
    toast(`Added ${course.code || course.title} to ${to.name} from the template`, H.last ? { action: undoAction(H.last) } : {});
  };
  openDialog('dlg', h('h2', { text: 'Course from a template' }),
    h('p', null, h('b', { text: [course.code, course.title].filter(Boolean).join(' · ') }),
      ` — ${plan.filter((p) => p.parentOld === null).length} component(s), ${n} item(s), no marks.`),
    h('div', { class: 'form' }, h('label', null, 'Into term', termSel)),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => closeDialog('dlg') } }),
      h('button', { class: 'btn primary', type: 'button', id: 'template-go', text: 'Add course', on: { click: go } })));
}

// ---------------------------------------------------------------- + Mark bottom sheet
function markSheet(pref = {}) {
  const recent = store.get('gc-recent-courses', []);
  const ct = currentTerm();
  const graded = (c) => typeOf(c) === 'graded';
  let pool = S.live.courses.filter((c) => c.status === 'active' && graded(c) && !termOf(c)?.archived);
  if (!pool.length && ct) pool = coursesOf(ct).filter(graded);
  const termOrder = new Map(S.live.terms.map((t, i) => [t.id, i]));
  pool.sort((a, b) => {
    const ra = recent.indexOf(a.id), rb = recent.indexOf(b.id);
    if (ra !== rb) return (ra === -1 ? 1e9 : ra) - (rb === -1 ? 1e9 : rb);
    return termOrder.get(b.term_id) - termOrder.get(a.term_id) || bySort(a, b);
  });
  if (!pool.length) { toast('No courses yet. Set one up first.'); return; }
  const routeCourse = readRoute().course;
  const courseId = pref.courseId ?? (routeCourse && pool.some((c) => c.id === routeCourse.id) ? routeCourse.id : pool[0].id);
  const course = pool.find((c) => c.id === courseId) || pool[0];
  const comps = leavesOf(course);
  const compName = (k) => (k.ancestors && k.ancestors.length ? `${S.live.components.find((x) => x.id === k.ancestors[0])?.name} › ${k.name}` : k.name);
  const allItems = comps.flatMap((k) => rawItems(k).map((a) => ({ a, k })));
  const firstOpen = allItems.find(({ a, k }) => !k.is_bonus && isOpenItem(a));
  const itemKey = pref.itemKey ?? (firstOpen ? `i:${firstOpen.a.id}` : comps[0] ? `new:${comps[0].id}` : '');
  const picked = itemKey.startsWith('i:') ? allItems.find(({ a }) => a.id === Number(itemKey.slice(2))) : null;
  const newComp = itemKey.startsWith('new:') ? comps.find((k) => k.id === Number(itemKey.slice(4))) : null;
  const outOfDefault = picked ? picked.a.out_of : newComp ? rawItems(newComp).slice(-1)[0]?.out_of ?? 1 : 1;
  const mode = pref.mode ?? (outOfDefault !== 1 ? 'pts' : 'pct');

  const courseSel = h('select', { 'aria-label': 'Course', on: { change: (e) => markSheet({ courseId: Number(e.target.value) }) } },
    pool.map((c) => h('option', { value: String(c.id), text: `${c.code || ''} ${c.short_name || c.title}`.trim(), selected: c.id === course.id })));
  const itemSel = h('select', { 'aria-label': 'Item', on: { change: (e) => markSheet({ courseId: course.id, itemKey: e.target.value }) } },
    comps.map((k) => h('optgroup', { label: `${compName(k)} (${num(k.weight)}%${k.is_bonus ? ' bonus' : ''})` },
      rawItems(k).map((a) => h('option', { value: `i:${a.id}`, text: `${a.name}${isMarked(a) ? `: ${markText(a)}` : ''}`, selected: itemKey === `i:${a.id}` })),
      h('option', { value: `new:${k.id}`, text: `+ New item in ${k.name}`, selected: itemKey === `new:${k.id}` }))));
  const nameIn = newComp ? h('input', { type: 'text', value: nextName(newComp), maxlength: '200', 'aria-label': 'New item name' }) : null;
  const pctIn = h('input', { class: 'big-input', type: 'text', placeholder: '% or letter', 'aria-label': 'Mark in percent or a letter', id: 'sheet-pct' });
  const ptsIn = h('input', { class: 'big-input', type: 'text', inputmode: 'decimal', placeholder: 'points', 'aria-label': 'Points' });
  const outIn = h('input', { class: 'big-input', type: 'text', inputmode: 'decimal', placeholder: 'out of', 'aria-label': 'Out of',
    value: outOfDefault !== 1 ? num(outOfDefault) : '' });
  const err = h('div', { class: 'err-msg' });
  const pv = h('div', { class: 'sheet-preview', role: 'status' });
  const typed = () => {
    if (mode === 'pct') {
      const v = pctIn.value.trim();
      if (!v) return null;
      const out = picked ? picked.a.out_of : outOfDefault;
      return /^[a-f][+-]?$/i.test(v) ? parseMark(v, out) : parseMark(`${v.replace('%', '')}%`, out);
    }
    if (!ptsIn.value.trim() || !outIn.value.trim()) return null;
    return parseMark(`${ptsIn.value}/${outIn.value}`);
  };
  const showPreview = () => {
    const r = typed();
    if (!r || r.error || (!picked && !newComp)) { fill(pv); return; }
    fill(pv, previewBox(previewDelta(S.live, (d) => {
      if (picked) Object.assign(d.assessments.find((x) => x.id === picked.a.id), { mark: r.mark, out_of: r.out_of, letter: r.letter });
      else d.assessments.push({ id: 1e12, component_id: newComp.id, name: 'new', mark: r.mark, out_of: r.out_of, letter: r.letter,
        counts_in: 'both', excused: 0, item_weight: null, curve: null, projected: null, sort_order: 1e6 });
    }, { courseId: course.id, termId: course.term_id })));
  };
  for (const i of [pctIn, ptsIn, outIn]) i.addEventListener('input', showPreview);
  let confirmedWarn = null;
  const save = async () => {
    let r;
    if (mode === 'pct') {
      const v = pctIn.value.trim();
      if (!v) { err.textContent = 'Type the mark.'; return; }
      r = /^[a-f][+-]?$/i.test(v) ? parseMark(v, picked ? picked.a.out_of : outOfDefault) : parseMark(`${v.replace('%', '')}%`, picked ? picked.a.out_of : outOfDefault);
    } else {
      if (!ptsIn.value.trim() || !outIn.value.trim()) { err.textContent = 'Type points and out of.'; return; }
      r = parseMark(`${ptsIn.value}/${outIn.value}`);
    }
    if (r.error) { err.textContent = r.error; return; }
    if (r.warn && confirmedWarn !== `${r.mark}/${r.out_of}`) { confirmedWarn = `${r.mark}/${r.out_of}`; err.textContent = `${r.warn}. Tap Save again to keep it.`; return; }
    store.set('gc-recent-courses', [course.id, ...recent.filter((id) => id !== course.id)].slice(0, 10));
    closeDialog('sheet');
    if (picked) {
      await patch('assessments', picked.a, r.out_of !== picked.a.out_of ? { mark: r.mark, out_of: r.out_of, letter: r.letter } : { mark: r.mark, letter: r.letter });
    } else if (newComp) {
      const name = textField('Name', { required: true })(nameIn.value);
      await create('assessments', { component_id: newComp.id, name: name.value || nextName(newComp), mark: r.mark, out_of: r.out_of, letter: r.letter,
        sort_order: Math.max(0, ...rawItems(newComp).map((a) => a.sort_order ?? 0)) + 1 });
    }
    toast(`Saved ${courseLabel(course)}`);
  };
  for (const i of [pctIn, ptsIn, outIn, nameIn]) i?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

  openDialog('sheet',
    h('h2', { text: 'Add a mark' }),
    comps.length ? h('div', { class: 'form' },
      h('label', null, 'Course', courseSel),
      h('label', null, 'Item', itemSel),
      nameIn ? h('label', null, 'Name', nameIn) : null,
      picked && isMarked(picked.a) ? h('div', { class: 'muted small', text: `Currently ${markText(picked.a)}. Saving replaces it.` }) : null,
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Enter as' },
        h('button', { class: 'btn', type: 'button', 'aria-pressed': mode === 'pts' ? 'true' : 'false', text: 'Points / out of',
          on: { click: () => markSheet({ courseId: course.id, itemKey, mode: 'pts' }) } }),
        h('button', { class: 'btn', type: 'button', 'aria-pressed': mode === 'pct' ? 'true' : 'false', text: '% or letter',
          on: { click: () => markSheet({ courseId: course.id, itemKey, mode: 'pct' }) } })),
      mode === 'pct' ? pctIn : h('div', { class: 'pair' }, ptsIn, h('span', { class: 'muted', text: '/' }), outIn),
      pv, err)
      : h('div', null, h('label', { class: 'field' }, 'Course', courseSel), h('p', { class: 'muted', text: 'This course has no components yet. Add them with Edit structure.' })),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => closeDialog('sheet') } }),
      comps.length ? h('button', { class: 'btn primary', type: 'button', text: 'Save', on: { click: save } }) : null));
  (mode === 'pct' ? pctIn : ptsIn).focus();
}

// ---------------------------------------------------------------- render
function render() {
  if (!S.calc) return;
  if (S.editing > 0) { S.dirty = true; return; }
  S.dirty = false;
  const active = document.activeElement;
  const focusKey = active && active.dataset ? active.dataset.k : null;
  if (!hasData()) {
    document.body.className = 'welcome';
    renderWelcome();
    if (document.title !== 'GradeCalc — free grade calculator') document.title = 'GradeCalc — free grade calculator';
    return;
  }
  const r = readRoute();
  document.body.className = `depth-${r.depth}${S.structure ? ' structure' : ''}${r.graphs ? ' graphs' : ''}`;
  const ng = $('nav-graphs');
  if (r.graphs) ng.setAttribute('aria-current', 'page'); else ng.removeAttribute('aria-current');
  renderOverview(r);
  renderTerm(r);
  renderCourse(r);
  const cid = r.course ? r.course.id : null;
  if (cid !== S.lastCourseId) { panes.course.scrollTop = 0; S.lastCourseId = cid; }
  if (focusKey) {
    const el = document.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
    if (el) el.focus();
  }
  const title = r.course ? `${courseLabel(r.course)} · GradeCalc` : r.term ? `${r.term.name} · GradeCalc` : r.graphs ? 'Graphs · GradeCalc' : 'GradeCalc';
  if (document.title !== title) document.title = title;
}

function setStructure(on) {
  S.structure = on;
  S.ruleDraft.clear();
  $('toggle-structure').setAttribute('aria-pressed', on ? 'true' : 'false');
  fill($('toggle-structure'), h('span', { class: 'long', text: on ? 'Done editing' : 'Edit structure' }), h('span', { class: 'short', text: on ? 'Done' : 'Edit' }));
  render();
}

editorHooks.onOpen = () => { S.editing++; };
editorHooks.onClose = () => {
  S.editing = Math.max(0, S.editing - 1);
  if (S.editing === 0 && S.dirty) setTimeout(render, 0);
};

async function init() {
  $('toggle-theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('gc-theme', next); } catch { /* not saved; still switches */ }
  });
  $('toggle-structure').addEventListener('click', () => setStructure(!S.structure));
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  undoButtons();
  // Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z (⌘ on a Mac). Inside a text box the browser's own undo runs instead.
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !hasData()) return;
    const k = e.key.toLowerCase();
    if (k !== 'z' && k !== 'y') return;
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (k === 'z' && !e.shiftKey) undo(); else redo();
  });
  $('conflict-reload').addEventListener('click', () => location.reload());
  $('open-settings').addEventListener('click', openSettings);
  $('add-mark').addEventListener('click', () => markSheet());
  $('fab-mark').addEventListener('click', () => markSheet());
  $('back').addEventListener('click', () => {
    const r = readRoute();
    location.hash = r.depth === 2 && r.term ? termHash(r.term) : '#/overview';
  });
  window.addEventListener('hashchange', render);
  mobileQuery.addEventListener('change', render);
  onExternalChange(() => { clearUndo(); reload(); toast('Updated from another tab. Undo starts fresh.'); });
  try {
    S.data = await api.all();
  } catch (e) {
    $('loading').textContent = e.message;
    return;
  }
  recompute();
  render();
  $('loading').remove();
  setSave('', 'Saved in this browser');
}

init();
