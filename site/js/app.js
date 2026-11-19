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
  const d = S.data;
  const terms = [...d.terms].sort(bySort);
  const tIds = new Set(terms.map((t) => t.id));
  const courses = d.courses.filter((c) => tIds.has(c.term_id));
  const cIds = new Set(courses.map((c) => c.id));
  const inCourse = d.components.filter((k) => cIds.has(k.course_id));
  const inIds = new Set(inCourse.map((k) => k.id));
  const components = inCourse.filter((k) => k.parent_id === null || k.parent_id === undefined || inIds.has(k.parent_id));
  const kIds = new Set(components.map((k) => k.id));
  const assessments = d.assessments.filter((a) => kIds.has(a.component_id));
  const repeats = (d.repeats || []).map((g) => ({ ...g, course_ids: (g.course_ids || []).filter((id) => cIds.has(id)) }))
    .filter((g) => g.course_ids.length > 1);
  S.live = { terms, courses, components, assessments, repeats, settings: d.settings };
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
  const ts = [...S.live.terms].reverse();
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
    throw e;
  }
}

/** Edit a row: recalculates at once, then saves. `row` may be a copy; the stored row is found by id. */
function patch(entity, row, changes) {
  const real = S.data[entity].find((r) => r.id === row.id) || row;
  const prev = {};
  for (const k of Object.keys(changes)) prev[k] = real[k];
  Object.assign(real, changes);
  recompute(); render();
  return track(api.patch(entity, real.id, changes))
    .then((res) => { Object.assign(real, res); })
    .catch((e) => {
      for (const k of Object.keys(changes)) if (real[k] === changes[k]) real[k] = prev[k];
      toast(`Not saved: ${e.message}`, { error: true });
    })
    .finally(() => { recompute(); render(); });
}

async function create(entity, body) {
  try {
    const row = await track(api.create(entity, body));
    S.data[entity].push(row);
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
  S.data[entity] = S.data[entity].filter((r) => r.id !== row.id);
  recompute(); render();
  toast(`Deleted ${label}`, { action: { label: 'Undo', fn: () => restoreRow(entity, row.id, label) } });
}

async function restoreRow(entity, id, label) {
  try {
    await track(api.restore(entity, id));
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
    S.data.settings = await track(api.settings(changes));
    recompute(); render();
  } catch (e) {
    toast(`Not saved: ${e.message}`, { error: true });
  }
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

  const termRows = S.live.terms.map((t) => {
    const s = c.terms.get(t.id);
    return h('li', null, h('a', { class: `row-link${activeTerm && activeTerm.id === t.id ? ' active' : ''}`, href: termHash(t) },
      h('span', { class: 'grow' }, t.name, h('span', { class: 'muted small', text: t.year_of_study ? `  Year ${t.year_of_study}` : '' })),
      h('span', { class: 'num', text: s.courses ? pct(s.average) : '—' })));
  });

  fill(panes.overview,
    h('nav', { class: 'side-nav', 'aria-label': 'Main' }, h('ul', { class: 'list' }, h('li', null,
      h('a', { class: `row-link nav-graphs${r.graphs ? ' active' : ''}`, href: '#/', 'aria-current': r.graphs ? 'page' : null },
        chartIcon(), h('span', { class: 'grow', text: 'Graphs' }))))),
    h('div', { class: 'pane-head' }, h('h2', { text: 'Overview' }),
      h('span', { class: 'sub small', text: `${cum.courses} graded · ${num(cum.credits)} cr${extra.length ? ` (+ ${extra.join(', ')})` : ''}` })),
    h('div', { class: 'stats' },
      stat('Cumulative average', pct(cum.average), gradeFoot(cum.gpa.average, cum.letter.average), 'big'),
      thisTermSoFar()),
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
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn small primary', type: 'button', text: 'New course (set up)', on: { click: () => newCourseWizard(activeTerm) } }),
      h('button', { class: 'btn small', type: 'button', text: '+ Term', on: { click: () => addTermDialog() } })),
    h('h3', { text: 'More' }),
    h('ul', { class: 'list more' },
      h('li', null, h('button', { class: 'link', type: 'button', text: 'Settings (grade scale, repeats, reset)', on: { click: openSettings } })),
      h('li', null, h('button', { class: 'link', type: 'button', text: 'Recently deleted', on: { click: openDeleted } }))),
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
  if (!term) { fill(el, h('div', { class: 'empty', text: 'Pick a term.' })); return; }
  const s = S.calc.terms.get(term.id);
  const courses = coursesOf(term);
  const activeCourse = r.course;

  const rows = courses.map((c) => {
    const cr = S.calc.courses.get(c.id);
    const graded = typeOf(c) === 'graded';
    return h('tr', { class: `click${activeCourse && activeCourse.id === c.id ? ' active' : ''}`,
      on: { click: () => { location.hash = courseHash(term, c); } } },
    h('td', { class: 'code' }, c.code || '—'),
    h('td', { class: 'title-cell' }, h('a', { href: courseHash(term, c), text: c.short_name && isMobile() ? c.short_name : c.title,
      class: 'plain', on: { click: (e) => e.stopPropagation() } }), courseBadges(c, cr)),
    h('td', { class: 'num', text: avgCell(c, cr) }),
    h('td', { class: 'num hide-m', text: graded ? pct(cr.result.soFar) : '—' }),
    h('td', { class: 'num hide-m muted', text: graded ? pct(cr.projected) : '—' }),
    h('td', { class: 'num', text: graded ? gradeCell(cr.gpa.average, cr.letter.average) : '' }));
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
        h('thead', null, h('tr', null, h('th', { text: 'Code' }), h('th', { text: 'Course' }), h('th', { class: 'num', text: 'Average' }),
          h('th', { class: 'num hide-m', text: 'So far' }), h('th', { class: 'num hide-m' }, 'Proj.', est()), h('th', { class: 'num', text: isPoints() ? 'GPA' : 'Letter' }))),
        h('tbody', null, rows))
      : h('div', { class: 'empty' },
        h('p', { text: 'No courses in this term yet.' }),
        h('button', { class: 'btn primary', type: 'button', text: 'Set up a course', on: { click: () => newCourseWizard(term) } })),
    courses.length && !S.structure ? h('p', { class: 'row-actions' },
      h('button', { class: 'btn small', type: 'button', text: 'New course (set up)', on: { click: () => newCourseWizard(term) } })) : null,
    courses.length ? thisTermChart(term) : null,
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
      cumulativeChart({ terms: cumul, years: yearPts, classes })));
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
      field('Year of study', 'terms', term, 'year_of_study', { parse: numberField(1, 10, { nullable: true, int: true, label: 'Year of study' }), decimal: true })),
    h('div', { class: 'row-actions' },
      h('button', { class: 'btn small primary', type: 'button', text: 'New course (set up)', on: { click: () => newCourseWizard(term) } }),
      h('button', { class: 'btn small', type: 'button', text: '+ Course', title: 'Just the name; add components later', on: { click: () => addCourseDialog(term) } }),
      h('button', { class: 'btn small danger', type: 'button', text: 'Delete term', on: { click: async () => {
        const n = coursesOf(term).length;
        if (await confirmDialog(`Delete ${term.name}?`, `${n ? `Its ${n} course${n === 1 ? '' : 's'} and their marks are hidden with it. ` : ''}You can restore it from Recently deleted for 30 days.`, 'Delete', { danger: true })) {
          await removeRow('terms', term, term.name);
          location.hash = '#/';
        }
      } } })));
}

/** The setup wizard (site/js/wizard.js): syllabus order, creates everything through the store. */
function newCourseWizard(term) {
  openWizard({
    terms: S.live.terms, term, courses: S.live.courses, compsOf: leavesOf, itemsOf: rawItems, defaultCredits: defaultCredits(),
    suggestTerm: suggestTermName(), create, patchRow: patch,
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
    fill(el, h('div', { class: 'empty', text: 'Pick a course to see its marks.' }));
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
    tops.length ? tops.map((k) => (kidsOf(k).length ? groupCard(course, k, res) : compCard(course, k, res))) : h('div', { class: 'empty' },
      h('p', { text: 'No components yet (e.g. Assignments 20%, Midterm 30%, Final 50%).' }),
      S.structure ? null : h('button', { class: 'btn', type: 'button', text: 'Edit structure', on: { click: () => setStructure(true) } })),
    S.structure ? h('p', null, h('button', { class: 'btn small', type: 'button', text: '+ Component', on: { click: () => addComponent(course) } })) : null,
    course.notes && !S.structure ? h('p', { class: 'muted small', text: course.notes }) : null,
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
    await patch('courses', course, { term_id: toId });
    const now = S.data.courses.find((c) => c.id === course.id);
    if (!now || now.term_id !== toId) return; // not saved (the patch already said why)
    location.hash = courseHash(to, now);
    if (undoable) toast(`Moved ${courseLabel(course)} to ${to.name}`, { action: { label: 'Undo', fn: () => move(from.id, false) } });
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
    h('p', null, h('button', { class: 'btn small danger', type: 'button', text: 'Delete course', on: { click: async () => {
      const n = S.live.assessments.filter((a) => isMarked(a) && rawComps(course).some((k) => k.id === a.component_id)).length;
      if (await confirmDialog(`Delete ${courseLabel(course)}?`, `${n ? `Its ${n} mark${n === 1 ? '' : 's'} are hidden with it. ` : ''}Restore from Recently deleted for 30 days.`, 'Delete', { danger: true })) {
        const term = termOf(course);
        await removeRow('courses', course, courseLabel(course));
        if (term) location.hash = termHash(term);
      }
    } } })));
}

async function addComponent(course) {
  const used = topComps(course).filter((k) => !k.is_bonus).reduce((s, k) => s + (Number(k.weight) || 0), 0);
  const row = await create('components', { course_id: course.id, name: 'New component', weight: Math.max(0, Math.min(100, 100 - used)),
    sort_order: Math.max(0, ...rawComps(course).map((k) => k.sort_order ?? 0)) + 1 });
  if (row) await create('assessments', { component_id: row.id, name: 'Item 1', mark: null, out_of: 1, sort_order: 1 });
}

/** Split a component into parts (one level of nesting). Its items move into the first part. */
async function addPart(course, k) {
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

function compHead(k, cres, { group = false, child = false } = {}) {
  const collapsed = S.collapsed.has(k.id);
  const effChanged = !k.is_bonus && !child && Math.abs(cres.weight - k.weight) > 1e-9;
  const wText = child ? `${num(cres.weight)}% of course` : effChanged ? `${num(k.weight)}% → ${num(cres.weight)}%` : `${num(k.weight)}%`;
  return h('div', { class: 'comp-head', role: 'button', tabindex: '0', 'aria-expanded': collapsed ? 'false' : 'true',
    on: {
      click: () => { if (collapsed) S.collapsed.delete(k.id); else S.collapsed.add(k.id); render(); },
      keydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) e.currentTarget.click(); },
    } },
  h('span', { class: 'chev', text: collapsed ? '▸' : '▾' }),
  h('span', { class: 'name' }, editable({ text: k.name, edit: k.name, label: 'Component name', parse: textField('Name', { required: true }),
    save: (v) => patch('components', k, { name: v }) }), group ? h('span', { class: 'muted small', text: `  ${kidsOf(k).length} parts` }) : null),
  h('span', { class: 'w', title: effChanged ? 'Weight moved by excused items or a rule (final higher than a midterm)' : null, text: wText }),
  h('span', { class: 'num', title: 'Component average (marked items)', text: pct(cres.average, 1) }));
}

/** A component split into parts: its own header + the parts inside. */
function groupCard(course, k, res) {
  const cres = res.components.get(k.id) || { weight: k.weight, average: null };
  const card = h('div', { class: `comp group${k.is_bonus ? ' bonus' : ''}` }, compHead(k, cres, { group: true }));
  if (S.collapsed.has(k.id)) return card;
  if (S.structure) card.append(groupStructure(course, k));
  card.append(h('div', { class: 'comp-kids' }, kidsOf(k).map((x) => compCard(course, x, res, true))));
  return card;
}

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
      h('button', { class: 'btn small danger', type: 'button', text: 'Delete component', on: { click: () => deleteComponent(k) } })));
}

async function deleteComponent(k) {
  const all = [k, ...kidsOf(k)];
  const marks = all.flatMap((x) => rawItems(x)).filter(isMarked);
  const body = marks.length ? h('div', null, h('p', { text: `These ${marks.length} mark${marks.length === 1 ? '' : 's'} are hidden with it:` }),
    h('ul', { class: 'small' }, marks.slice(0, 12).map((a) => h('li', { text: `${a.name}: ${markText(a)}` })), marks.length > 12 ? h('li', { text: `…and ${marks.length - 12} more` }) : null),
    h('p', { text: 'Restore from Recently deleted for 30 days.' })) : 'Restore from Recently deleted for 30 days.';
  if (await confirmDialog(`Delete ${k.name}?`, body, 'Delete', { danger: true })) removeRow('components', k, k.name);
}

function compCard(course, k, res, child = false) {
  const cres = res.components.get(k.id) || { weight: k.weight, average: null, soFar: 0 };
  const items = rawItems(k);
  const collapsed = S.collapsed.has(k.id);
  const drops = k.drop_average || k.drop_so_far;
  const rule = parseRule(k.rule);

  const card = h('div', { class: `comp${k.is_bonus ? ' bonus' : ''}${child ? ' child' : ''}` }, compHead(k, cres, { child }));
  if (collapsed) return card;

  if (S.structure) {
    card.append(compStructure(course, k, items, child));
    return card;
  }
  card.append(h('table', { class: 'items' }, h('tbody', null, items.map((a) => itemRow(a)))));
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
      h('thead', null, h('tr', null, ['Item', 'Out of', 'Item weight', 'Counts in', 'Excused', 'Curve', 'Proj. %', ''].map((t) => h('th', { text: t })))),
      h('tbody', null, items.map((a) => h('tr', null,
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
          on: { click: () => removeRow('assessments', a, a.name) } }))))))),
    h('p', { class: 'row-actions' },
      h('button', { class: 'btn small', type: 'button', text: '+ Item', on: { click: () => create('assessments', {
        component_id: k.id, name: nextName(k), mark: null, out_of: items[items.length - 1]?.out_of ?? 1,
        sort_order: Math.max(0, ...items.map((a) => a.sort_order ?? 0)) + 1 }) } }),
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
  const { entries } = await api.audit({ course_id: course.id, limit: 500 });
  const list = entries.map((e) => {
    const before = e.before, after = e.after;
    const row = after || before || {};
    const name = row.name || row.title || `#${e.entity_id}`;
    let diff = null;
    if (e.action === 'update' && before && after) {
      diff = Object.keys(after).filter((k) => !SKIP.has(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]))
        .map((k) => h('div', { class: 'diff' }, `${k.replace(/_/g, ' ')}: `, fmtVal(k, before[k], before), ' → ', h('b', { text: fmtVal(k, after[k], after) })));
    }
    const verb = { create: 'added', update: 'changed', delete: 'deleted', restore: 'restored' }[e.action] || e.action;
    return h('li', null, h('div', { class: 'when', text: when(e.at) }), h('div', null, `${ENTITY_LABEL[e.entity] || e.entity} `, h('b', { text: name }), ` ${verb}`), diff);
  });
  openDialog('drawer',
    h('div', { class: 'pane-head' }, h('h2', { text: `History · ${courseLabel(course)}` }),
      h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', text: 'Close', on: { click: () => closeDialog('drawer') } }))),
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
    await saveSettings(changes);
    toast('Settings saved');
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
    h('p', { class: 'muted small', text: `Stored in this browser only (${kb} KB). Clearing your browser’s site data deletes it. Excel / JSON backup comes in a later update.` }),
    h('div', { class: 'row-actions' },
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
  S.collapsed.clear();
  setStructure(false);
  recompute();
  location.hash = '#/';
  render();
  toast('Everything was deleted from this browser.');
}

// ---------------------------------------------------------------- + Mark bottom sheet
function markSheet(pref = {}) {
  const recent = store.get('gc-recent-courses', []);
  const ct = currentTerm();
  const graded = (c) => typeOf(c) === 'graded';
  let pool = S.live.courses.filter((c) => c.status === 'active' && graded(c));
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
      err)
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
  $('toggle-structure').textContent = on ? 'Done editing' : 'Edit structure';
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
  $('open-settings').addEventListener('click', openSettings);
  $('add-mark').addEventListener('click', () => markSheet());
  $('fab-mark').addEventListener('click', () => markSheet());
  $('back').addEventListener('click', () => {
    const r = readRoute();
    location.hash = r.depth === 2 && r.term ? termHash(r.term) : '#/overview';
  });
  window.addEventListener('hashchange', render);
  mobileQuery.addEventListener('change', render);
  onExternalChange(() => { reload(); toast('Updated from another tab'); });
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
