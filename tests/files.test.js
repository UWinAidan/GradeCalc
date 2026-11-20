// Round 4 (files): JSON backup, Excel workbook, CSV, course templates (site/js/files.js). Made-up data only.
// The Excel round trip uses the vendored SheetJS build, the same file the page loads.
import { readFileSync } from 'node:fs';
import { assert, near } from './helpers.js';
import { build } from '../scripts/build.mjs';
import { computeAll } from '../shared/calc.js';
import { demoDoc } from '../site/js/demo.js';

build();
globalThis.document ??= { getElementById: () => null };
const F = await import('../site/js/files.js');
const { normalize } = await import('../site/js/store.js');
// The package is "type": "module", so the UMD file can't be require()d: run it with its own `exports`.
const XLSX = {};
new Function('exports', readFileSync(new URL('../site/vendor/sheetjs-0.20.3/xlsx.mini.min.js', import.meta.url), 'utf8'))(XLSX);

const demo = () => normalize(demoDoc());
const live = (d) => ({ ...d, terms: d.terms.filter((r) => !r.deleted_at) });
const strip = (d) => {
  // The parts that matter for grades (ids, rows, settings), without timestamps and versions.
  const out = {};
  for (const e of ['terms', 'courses', 'components', 'assessments', 'repeats']) {
    out[e] = d[e].filter((r) => !r.deleted_at).map(({ created_at, updated_at, version, deleted_at, ...r }) => r).sort((a, b) => a.id - b.id);
  }
  out.settings = d.settings;
  return out;
};
const sameGrades = (a, b) => {
  const x = computeAll(live(a)), y = computeAll(live(b));
  near(y.cumulative.average, x.cumulative.average, 'cumulative');
  for (const [id, r] of x.courses) near(y.courses.get(id).result.average, r.result.average, `course ${id}`);
};
/** Write sheets to a real .xlsx (bytes) and read them back as { name: rows }, like the page does. */
function viaXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const back = XLSX.read(bytes, { type: 'array', cellDates: true });
  return Object.fromEntries(back.SheetNames.map((n) => [n, XLSX.utils.sheet_to_json(back.Sheets[n], { header: 1, raw: true, defval: null })]));
}

test('JSON backup round trip keeps everything (rows, settings, history)', () => {
  const d = demo();
  d.audit.push({ at: '2026-01-01T00:00:00.000Z', action: 'update', entity: 'settings', entity_id: 0, course_id: null, before: null, after: null });
  const file = JSON.parse(JSON.stringify(F.backupFile(d)));
  assert.equal(file.app, 'GradeCalc');
  assert.equal(file.kind, 'backup');
  const r = F.readJson(file);
  assert.equal(r.kind, 'backup');
  assert.deepEqual(r.doc, normalize(d));
  assert.match(F.backupName(new Date('2026-03-04T12:00:00Z')), /^gradecalc-backup-2026-03-04$/);
});

test('readJson refuses other files and newer formats', () => {
  assert.throws(() => F.readJson({ hello: 1 }), /isn’t a GradeCalc file/);
  assert.throws(() => F.readJson([]), /isn’t a GradeCalc file/);
  assert.throws(() => F.readJson({ app: 'GradeCalc', kind: 'backup', format: 99, gradebook: {} }), /newer GradeCalc/);
  assert.throws(() => F.readJson({ app: 'GradeCalc', kind: 'backup', format: 1 }), /no gradebook/);
  assert.throws(() => F.readJson({ app: 'GradeCalc', kind: 'mystery', format: 1 }), /Unknown kind/);
  // Junk inside a backup is cleaned by normalize (unknown fields dropped, no prototype keys).
  const r = F.readJson(JSON.parse('{"app":"GradeCalc","kind":"backup","format":1,"gradebook":{"terms":[{"id":1,"name":"T","__proto__":{"x":1},"evil":2}]}}'));
  assert.equal(r.doc.terms[0].evil, undefined);
  assert.equal({}.x, undefined);
});

test('Excel: export → .xlsx → import gives the same gradebook and the same grades', () => {
  const d = demo();
  const back = F.fromSheets(viaXlsx(F.toSheets(d)));
  assert.deepEqual(strip(back), strip(d));
  sameGrades(d, back);
});

test('Excel: calculated columns match calc.js and are ignored on import', () => {
  const d = demo();
  const s = F.toSheets(d);
  const calc = computeAll(d);
  const head = s.Courses[0];
  const avgCol = head.indexOf('Current average % (calculated)');
  for (const row of s.Courses.slice(1)) {
    const r = calc.courses.get(row[0]);
    if (row[7] === 'graded') near(row[avgCol] === '' ? null : row[avgCol], r.result.average === null ? null : Math.round(r.result.average * 1e4) / 100, `course ${row[0]}`);
    row[avgCol] = 12.34; // edited: must not matter
  }
  sameGrades(d, F.fromSheets(s));
});

test('Excel: deleted rows are left out', () => {
  const d = demo();
  d.courses[0].deleted_at = '2026-01-01T00:00:00.000Z';
  const s = F.toSheets(d);
  assert.ok(!s.Courses.slice(1).some((r) => r[0] === d.courses[0].id));
  const back = F.fromSheets(s);
  assert.ok(!back.courses.some((c) => c.id === d.courses[0].id));
});

test('Excel: new rows without ids, matched by name; marks as % and points', () => {
  const s = {
    Terms: [['Id', 'Name', 'Year of study'], [null, 'Made-up Fall', 1]],
    Courses: [['Id', 'Term', 'Code', 'Title', 'Credits'], [null, 'made-up fall', 'DEMO-5000', 'Made-up Physics', 3]],
    Components: [['Id', 'Course', 'Name', 'Weight %'], [null, 'DEMO-5000', 'Labs', 40], [null, 'Made-up Physics', 'Final', 60]],
    Items: [['Id', 'Course', 'Component', 'Name', 'Mark', 'Out of', 'Letter'],
      [null, 'DEMO-5000', 'Labs', 'Lab 1', 17, 20, null], [null, 'DEMO-5000', 'labs', 'Lab 2', 90, '%', null],
      [null, 'DEMO-5000', 'Final', 'Exam', null, null, 'B+']],
  };
  const d = F.fromSheets(s);
  assert.equal(d.terms.length, 1);
  assert.equal(d.courses[0].term_id, d.terms[0].id);
  const labs = d.components.find((k) => k.name === 'Labs');
  const items = d.assessments.filter((a) => a.component_id === labs.id);
  assert.deepEqual(items.map((a) => [a.mark, a.out_of]), [[17, 20], [0.9, 1]]);
  assert.equal(d.assessments.find((a) => a.name === 'Exam').letter, 'B+');
  assert.ok(new Set([...d.terms, ...d.courses, ...d.components, ...d.assessments].map((r) => r.id)).size === 1 + 1 + 2 + 3, 'unique ids');
  near(computeAll(d).courses.get(d.courses[0].id).result.average, 0.4 * (0.85 + 0.9) / 2 + 0.6 * 0.78); // B+ alone = 78% (estimate)
});

test('Excel: clear errors with the row number', () => {
  const base = () => ({ Terms: [['Id', 'Name'], [1, 'T']], Courses: [['Id', 'Term id', 'Title'], [2, 1, 'C']],
    Components: [['Id', 'Course id', 'Name', 'Weight %'], [3, 2, 'K', 100]], Items: [['Id', 'Component id', 'Name', 'Mark', 'Out of'], [4, 3, 'I', 50, '%']] });
  let s = base(); s.Items[1][3] = 'abc';
  assert.throws(() => F.fromSheets(s), /Items row 2, Mark: “abc” isn’t a number/);
  s = base(); s.Courses[1][1] = 9;
  assert.throws(() => F.fromSheets(s), /Courses row 2: no term with id 9/);
  s = base(); s.Items[1][0] = 3;
  assert.throws(() => F.fromSheets(s), /Id 3 is used twice/);
  s = base(); s.Items[1][3] = -5;
  assert.throws(() => F.fromSheets(s), /negative/);
  s = base(); s.Items[1][3] = 600;
  assert.throws(() => F.fromSheets(s), /500%/);
  s = base(); s.Components[1].push('x'); s.Components[0].push('Rule'); s.Components[1][4] = '{oops';
  assert.throws(() => F.fromSheets(s), /Components row 2, Rule: not valid JSON/);
  s = base(); s.Items[0].push('Letter'); s.Items[1].push('Q');
  assert.throws(() => F.fromSheets(s), /letters are A\+ to D-, or F/);
});

test('CSV: export → parse → import keeps marks, structure and grades (parts become a group)', () => {
  const d = demo();
  const csv = F.toCsv(F.marksTable(d));
  assert.ok(csv.startsWith('﻿Term,Year of study,Course code'));
  const back = F.fromMarksTable(F.parseCsv(csv));
  assert.equal(back.courses.length, d.courses.length);
  assert.equal(back.assessments.length, d.assessments.length);
  const marks = (x) => x.assessments.map((a) => [a.name, a.mark, a.out_of, a.letter]).sort((p, q) => String(p).localeCompare(String(q)));
  assert.deepEqual(marks(back), marks(d));
  // Plain courses (no rules, drops or groups) get exactly the same average.
  const calcA = computeAll(d), calcB = computeAll(back);
  const plain = d.courses.filter((c) => c.final_override == null && !c.final_letter && !c.curve && !c.cap_100 && !d.components.some((k) => k.course_id === c.id && (k.rule || k.drop_so_far || k.drop_average || k.parent_id || k.is_bonus || k.excused_to)));
  assert.ok(plain.length >= 2);
  for (const c of plain) {
    const twin = back.courses.find((x) => x.code === c.code && x.title === c.title && back.terms.find((t) => t.id === x.term_id).name === d.terms.find((t) => t.id === c.term_id).name);
    near(calcB.courses.get(twin.id).result.average, calcA.courses.get(c.id).result.average, c.code);
  }
});

test('CSV: quotes, commas, newlines, semicolons and formula guards', () => {
  const rows = [['A', 'B'], ['x, y', 'say "hi"'], ['line\nbreak', '=1+1'], ['-3', 7]];
  const csv = F.toCsv(rows);
  assert.ok(csv.includes("'=1+1"), 'formula text is guarded');
  assert.deepEqual(F.parseCsv(csv), [['A', 'B'], ['x, y', 'say "hi"'], ['line\nbreak', '=1+1'], ['-3', '7']]);
  assert.deepEqual(F.parseCsv('a;b\r\n1,5;2\r\n'), [['a', 'b'], ['1,5', '2']], 'semicolon CSV (European Excel)');
  assert.throws(() => F.parseCsv('a,"b\n'), /unclosed quote/);
});

test('CSV import: a minimal table from any spreadsheet', () => {
  const d = F.fromMarksTable(F.parseCsv('Course code,Component,Weight %,Item,Mark,Out of\nDEMO-6000,Quizzes,30,Quiz 1,8,10\nDEMO-6000,Quizzes,,Quiz 2,90%,\nDEMO-6000,Final,70,,,\n'));
  assert.equal(d.terms[0].name, 'Imported');
  assert.deepEqual(d.components.map((k) => [k.name, k.weight]), [['Quizzes', 30], ['Final', 70]]);
  assert.deepEqual(d.assessments.map((a) => [a.mark, a.out_of]), [[8, 10], [0.9, 1]]);
  assert.throws(() => F.fromMarksTable([['Name', 'Score'], ['x', 1]]), /Course code/);
});

test('Course template: structure only, never marks; rules follow the new ids', () => {
  const d = demo();
  // A course with a "final replaces midterm" rule and parts.
  const course = d.courses.find((c) => d.components.some((k) => k.course_id === c.id && k.rule));
  const comps = d.components.filter((k) => k.course_id === course.id);
  const items = d.assessments.filter((a) => comps.some((k) => k.id === a.component_id));
  const file = JSON.parse(JSON.stringify(F.courseTemplate(course, comps, items)));
  const s = JSON.stringify(file);
  for (const k of ['"mark"', '"letter"', '"curve"', '"final_override"', '"notes"', '"excused"', '"date"', '"projected"', '"term_id"', '"status"']) assert.ok(!s.includes(k), `no ${k}`);
  const { kind, template } = F.readJson(file);
  assert.equal(kind, 'template');
  assert.equal(template.course.title, course.title);
  assert.equal(template.plan.length, comps.length);
  assert.equal(template.plan.reduce((n, p) => n + p.items.length, 0), items.length);
  assert.ok(template.plan.every((p) => p.items.every((a) => a.mark === undefined)));
  // Parts come after their group.
  const seen = new Set();
  for (const p of template.plan) { if (p.parentOld !== null) assert.ok(seen.has(p.parentOld)); seen.add(p.old); }
});

test('Course template: bad files are refused', () => {
  const ok = { app: 'GradeCalc', kind: 'course-template', format: 1, course: { title: 'T' }, components: [] };
  assert.equal(F.readJson(ok).template.course.title, 'T');
  assert.throws(() => F.readJson({ ...ok, course: null }), /missing/);
  assert.throws(() => F.readJson({ ...ok, components: [{ ref: 1 }, { ref: 1 }] }), /no usable ref/);
  assert.throws(() => F.readJson({ ...ok, components: [{ ref: 2, parent_ref: 1 }] }), /before its group/);
  assert.throws(() => F.readJson({ ...ok, components: Array.from({ length: 201 }, (_, i) => ({ ref: i + 1 })) }), /200 at most/);
  const t = F.readJson({ ...ok, components: [{ ref: 1, name: 'x'.repeat(5000), weight: 'heavy', mark: 0.9, items: [{ name: 'q', mark: 1 }] }] }).template;
  assert.equal(t.plan[0].body.name.length, 2000, 'text capped');
  assert.equal(t.plan[0].body.weight, 0, 'bad number → default');
  assert.equal(t.plan[0].body.mark, undefined);
  assert.equal(t.plan[0].items[0].mark, undefined);
});

test('appendDoc: adds a second gradebook with new ids; grades of both unchanged', () => {
  const a = demo(), b = demo();
  const m = F.appendDoc(a, b);
  assert.equal(m.terms.length, a.terms.length * 2);
  const ids = ['terms', 'courses', 'components', 'assessments', 'repeats'].flatMap((e) => m[e].map((r) => r.id));
  assert.equal(new Set(ids).size, ids.length, 'unique ids');
  assert.ok(m.next_id > Math.max(...ids));
  // Each copy's courses get the same averages as the original.
  const ca = computeAll(a), cm = computeAll(m);
  const byKey = (doc, c) => `${doc.terms.find((t) => t.id === c.term_id).name}|${c.code}`;
  for (const c of a.courses) {
    const twins = m.courses.filter((x) => byKey(m, x) === byKey(a, c));
    assert.equal(twins.length, 2);
    for (const t of twins) near(cm.courses.get(t.id).result.average, ca.courses.get(c.id).result.average, c.code);
  }
  // Rules point inside their own copy.
  for (const k of m.components) {
    const from = k.rule && k.rule.from;
    if (from) for (const id of from) assert.equal(m.components.find((x) => x.id === id).course_id, k.course_id);
  }
  assert.deepEqual(m.settings, a.settings);
});

test('summary counts live rows', () => {
  const d = demo();
  const s = F.summary(d);
  assert.equal(s.courses, d.courses.length);
  assert.equal(s.marks, d.assessments.filter((a) => a.mark !== null || a.letter).length);
});
