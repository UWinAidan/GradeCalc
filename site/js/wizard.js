// New-course setup wizard (ported from Gradebook), in syllabus order:
//   1 course + term + credits (or copy the structure of another course)   2 components + weights (live total, bonus)
//   3 items per component (count, out of, equal or custom weights, drop lowest N)
//   4 special rules (final replaces midterm, minimum warning, excused items)   5 curve if known   6 review → create.
// Nothing is saved until "Create": then the term (if new), the course, its components and items are created through the
// store's API (audited), and the rules that point at other components are set once their ids exist.
import { h, num, toast, openDialog, closeDialog } from './ui.js';

const STEPS = ['Course', 'Components', 'Items', 'Rules', 'Curve', 'Review'];
const NEW_TERM = 'new';
const singular = (name) => name.trim().replace(/ies$/i, 'y').replace(/zzes$/i, 'zz').replace(/(ch|sh|x)es$/i, '$1').replace(/([^s])s$/i, '$1');
/** "Fall 2026" → {season: 'Fall', year: 2026}; anything else → nothing. */
export function guessSeason(name) {
  const m = /\b(fall|winter|spring|summer)\b\D*((?:19|20)\d\d)\b/i.exec(String(name || ''));
  return m ? { season: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), year: Number(m[2]) } : {};
}
const numOr = (v, d) => (String(v).trim() === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const parseRule = (r) => { if (!r) return null; if (typeof r === 'object') return r; try { return JSON.parse(r); } catch { return null; } };

const newComp = (name = '', weight = '') => ({ name, weight, is_bonus: false, count: 1, out_of: 100, custom: false, itemWeights: '', drop: 0, names: null });

/**
 * ctx: { terms, term, courses, compsOf(course), itemsOf(comp), defaultCredits, suggestTerm, create(entity, body) → row | null,
 *        patchRow(entity, row, changes) → Promise, batch(label, fn) (optional: one undo step), done(term, course) }
 * With no terms yet (quick start) the first step also names the new term.
 */
export function openWizard(ctx) {
  const d = {
    step: 0,
    term_id: (ctx.term || ctx.terms[ctx.terms.length - 1])?.id ?? NEW_TERM,
    termName: ctx.suggestTerm || '',
    code: '', title: '', credits: String(ctx.defaultCredits),
    comps: [newComp('Assignments', 20), newComp('Midterm', 30), newComp('Final exam', 50)],
    absorb: null,   // {final: index, from: [index]}
    minWarn: null,  // {comp: index, min: %}
    excused: {},    // index → {mode: 'stay' | 'to' | 'by_date', to, pivot, before, after}
    curve: null,    // {type, value} as typed (add points, mul factor, set %)
    copiedFrom: null,
  };
  const err = h('div', { class: 'err-msg', role: 'alert' });
  const real = () => d.comps.map((c, i) => [c, i]).filter(([c]) => !c.is_bonus);

  // ---- copy structure from another course
  function copyFrom(course) {
    const comps = ctx.compsOf(course);
    d.comps = comps.map((k) => {
      const items = ctx.itemsOf(k);
      const weights = items.map((a) => a.item_weight ?? 1);
      return { name: k.name, weight: k.weight, is_bonus: !!k.is_bonus, count: Math.max(1, items.length),
        out_of: items[0]?.out_of ?? 100, custom: k.aggregation === 'weighted', itemWeights: weights.map(num).join(', '),
        drop: k.drop_average || 0, names: items.length ? items.map((a) => a.name) : null };
    });
    const idx = new Map(comps.map((k, i) => [k.id, i]));
    d.absorb = null; d.minWarn = null; d.excused = {};
    comps.forEach((k, i) => {
      const r = parseRule(k.rule);
      if (r && r.type === 'absorb_if_higher') d.absorb = { final: i, from: r.from.map((id) => idx.get(id)).filter((x) => x !== undefined) };
      if (r && r.type === 'min_warning') d.minWarn = { comp: i, min: Math.round(r.min * 1000) / 10 };
      const e = parseRule(k.excused_to);
      if (e && e.to && idx.has(e.to)) d.excused[i] = { mode: 'to', to: idx.get(e.to) };
      if (e && e.by_date && [e.by_date.pivot, e.by_date.before, e.by_date.after].every((id) => idx.has(id))) {
        d.excused[i] = { mode: 'by_date', pivot: idx.get(e.by_date.pivot), before: idx.get(e.by_date.before), after: idx.get(e.by_date.after) };
      }
    });
    const c = parseRule(course.curve);
    d.curve = c ? { type: c.type, value: c.type === 'set' ? num(c.value * 100) : num(c.value) } : null;
    d.copiedFrom = course;
  }

  // ---- totals
  function totals() {
    const r = d.comps.filter((c) => !c.is_bonus).reduce((s, c) => s + numOr(c.weight, 0), 0);
    const b = d.comps.filter((c) => c.is_bonus).reduce((s, c) => s + numOr(c.weight, 0), 0);
    return { r, b };
  }
  function totalLine() {
    const { r, b } = totals();
    const ok = Math.abs(r - 100) < 1e-9;
    const bonus = b ? ` (+ ${num(b)} bonus)` : '';
    return h('div', { class: `wcheck ${ok ? 'ok' : 'off'}`, role: 'status', 'aria-live': 'polite',
      text: ok ? `Weights = 100${bonus}` : r > 100 ? `Weights = ${num(r)}${bonus}: the ${num(r - 100)} over 100 counts as bonus`
        : `Weights = ${num(r)}${bonus}: should add up to 100` });
  }

  // ---- step validation (returns an error message or '')
  function check(step) {
    if (step === 0) {
      if (!d.title.trim()) return 'Title is needed';
      if (d.code.trim().length > 20) return 'Code: 20 characters at most';
      const cr = Number(d.credits);
      if (String(d.credits).trim() === '' || !(cr >= 0 && cr <= 30)) return 'Credits must be 0–30';
      if (d.term_id === NEW_TERM && !d.termName.trim()) return 'Name the term (e.g. Fall 2026)';
    }
    if (step === 1) {
      if (!d.comps.length) return 'Add at least one component';
      for (const c of d.comps) {
        if (!c.name.trim()) return 'Every component needs a name';
        const w = Number(c.weight);
        if (String(c.weight).trim() === '' || !(w >= 0 && w <= 100)) return `${c.name}: weight must be 0–100`;
      }
    }
    if (step === 2) {
      for (const c of d.comps) {
        const n = Number(c.count);
        if (!Number.isInteger(n) || n < 1 || n > 100) return `${c.name}: number of items must be 1–100`;
        if (!(Number(c.out_of) > 0)) return `${c.name}: "out of" must be more than 0`;
        const drop = Number(c.drop);
        if (!Number.isInteger(drop) || drop < 0 || drop >= n) return `${c.name}: drop lowest must be 0–${n - 1}`;
        if (c.custom) {
          const ws = c.itemWeights.split(/[,\s]+/).filter(Boolean).map(Number);
          if (ws.length !== n || ws.some((x) => !(x >= 0))) return `${c.name}: give ${n} item weights (e.g. 1, 1, 2)`;
        }
      }
    }
    if (step === 3) {
      if (d.absorb && (d.absorb.final === undefined || !d.absorb.from.length)) return 'Final replaces midterm: pick the final and at least one midterm';
      if (d.minWarn && !(Number(d.minWarn.min) > 0 && Number(d.minWarn.min) <= 100)) return 'Minimum must be 1–100%';
    }
    if (step === 4 && d.curve) {
      const v = Number(d.curve.value);
      const [lo, hi] = { add: [-100, 100], mul: [0, 10], set: [0, 150] }[d.curve.type];
      if (String(d.curve.value).trim() === '' || !(v >= lo && v <= hi)) return `Curve value must be ${lo}–${hi}`;
    }
    return '';
  }

  // ---- inputs bound to the draft
  const input = (obj, key, attrs = {}, onChange) => h('input', { type: 'text', value: obj[key] ?? '', ...attrs,
    on: { input: (e) => { obj[key] = e.target.value; if (onChange) onChange(); } } });
  const compSelect = (value, onPick, { label, blank, onlyReal = true } = {}) => h('select', { 'aria-label': label, on: { change: (e) => onPick(e.target.value === '' ? undefined : Number(e.target.value)) } },
    blank ? h('option', { value: '', text: blank }) : null,
    d.comps.map((c, i) => (onlyReal && c.is_bonus ? null : h('option', { value: String(i), text: c.name || `Component ${i + 1}`, selected: value === i }))));

  // ---- steps
  function stepCourse() {
    const code = input(d, 'code', { placeholder: 'e.g. DEMO-1010 (optional)', maxlength: '20', 'aria-label': 'Code' });
    const title = input(d, 'title', { placeholder: 'Course title', maxlength: '200', 'aria-label': 'Title' });
    const termName = input(d, 'termName', { placeholder: 'e.g. Fall 2026', maxlength: '100', 'aria-label': 'New term name' });
    const termNameBox = h('label', null, 'New term name', termName);
    termNameBox.hidden = d.term_id !== NEW_TERM;
    const copy = h('select', { 'aria-label': 'Copy structure from', on: { change: (e) => {
      const c = ctx.courses.find((x) => String(x.id) === e.target.value);
      if (c) copyFrom(c); else { d.copiedFrom = null; d.comps = [newComp('Assignments', 20), newComp('Midterm', 30), newComp('Final exam', 50)]; d.absorb = null; d.minWarn = null; d.excused = {}; d.curve = null; }
    } } }, h('option', { value: '', text: 'No: start from a blank syllabus' }),
    ctx.courses.filter((c) => ctx.compsOf(c).length).map((c) => h('option', { value: String(c.id), text: `${c.code || c.title}${c.code ? ` ${c.title}` : ''}`, selected: d.copiedFrom?.id === c.id })));
    return [
      h('label', null, 'Title', title),
      h('label', null, 'Code (optional)', code),
      h('div', { class: 'pair2' },
        h('label', null, 'Term', h('select', { 'aria-label': 'Term', on: { change: (e) => {
          d.term_id = e.target.value === NEW_TERM ? NEW_TERM : Number(e.target.value);
          termNameBox.hidden = d.term_id !== NEW_TERM;
        } } },
        ctx.terms.map((t) => h('option', { value: String(t.id), text: t.name, selected: t.id === d.term_id })),
        h('option', { value: NEW_TERM, text: '+ New term…', selected: d.term_id === NEW_TERM }))),
        h('label', null, 'Credits', input(d, 'credits', { inputmode: 'decimal', 'aria-label': 'Credits' }))),
      termNameBox,
      ctx.courses.length ? [
        h('label', null, 'Copy the structure of another course (optional)', copy),
        h('p', { class: 'muted small', text: 'Copying brings its components, weights, items (names, out of, weights, drops), rules and curve; never its marks.' }),
      ] : h('p', { class: 'muted small', text: 'Next: the parts of the grade from the syllabus (assignments, midterm, final…).' }),
    ];
  }

  function stepComponents() {
    const live = h('div', null, totalLine());
    const refresh = () => live.replaceChildren(totalLine());
    const rows = d.comps.map((c, i) => h('div', { class: 'wz-row' },
      input(c, 'name', { placeholder: 'e.g. Quizzes', 'aria-label': `Component ${i + 1} name` }),
      input(c, 'weight', { inputmode: 'decimal', placeholder: '%', class: 'w', 'aria-label': `Component ${i + 1} weight %` }, refresh),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.is_bonus, 'aria-label': `Component ${i + 1} is bonus`,
        on: { change: (e) => { c.is_bonus = e.target.checked; refresh(); } } }), 'bonus'),
      h('button', { class: 'btn small danger', type: 'button', text: '×', 'aria-label': `Remove component ${i + 1}`, on: { click: () => {
        d.comps.splice(i, 1);
        if (d.absorb && (d.absorb.final === i || d.absorb.from.includes(i))) d.absorb = null;
        if (d.minWarn && d.minWarn.comp === i) d.minWarn = null;
        d.excused = {};
        show();
      } } })));
    return [
      h('p', { class: 'muted small', text: 'As in the syllabus. Bonus components count on top of 100.' }),
      h('div', { class: 'wz-rows' }, rows),
      h('p', null, h('button', { class: 'btn small', type: 'button', text: '+ Component', on: { click: () => { d.comps.push(newComp()); show(); } } })),
      live,
    ];
  }

  function stepItems() {
    return d.comps.map((c, i) => {
      const wBox = input(c, 'itemWeights', { placeholder: 'e.g. 1, 1, 2', 'aria-label': `${c.name} item weights` });
      wBox.hidden = !c.custom;
      return h('fieldset', { class: 'wz-comp' }, h('legend', { text: `${c.name} · ${num(numOr(c.weight, 0))}%${c.is_bonus ? ' bonus' : ''}` }),
        h('div', { class: 'wz-grid' },
          h('label', null, 'Items', input(c, 'count', { inputmode: 'numeric', 'aria-label': `${c.name} number of items` }, () => { c.names = null; })),
          h('label', null, 'Each out of', input(c, 'out_of', { inputmode: 'decimal', 'aria-label': `${c.name} out of` })),
          h('label', null, 'Drop lowest', input(c, 'drop', { inputmode: 'numeric', 'aria-label': `${c.name} drop lowest` })),
          h('label', null, 'Item weights', h('select', { 'aria-label': `${c.name} item weights mode`, on: { change: (e) => { c.custom = e.target.value === 'custom'; wBox.hidden = !c.custom; } } },
            h('option', { value: 'equal', text: 'Equal', selected: !c.custom }), h('option', { value: 'custom', text: 'Custom', selected: c.custom })))),
        wBox);
    });
  }

  function stepRules() {
    const idxs = real().map(([, i]) => i);
    const guess = (re) => idxs.find((i) => re.test(d.comps[i].name));
    const out = [];
    // final replaces midterm
    const absorbOn = h('input', { type: 'checkbox', checked: !!d.absorb, 'aria-label': 'Final replaces midterm', on: { change: (e) => {
      d.absorb = e.target.checked ? { final: guess(/final|exam/i) ?? idxs[idxs.length - 1], from: [guess(/mid/i)].filter((x) => x !== undefined) } : null;
      show();
    } } });
    out.push(h('label', { class: 'check' }, absorbOn, 'Final replaces the midterm when the final is higher'));
    if (d.absorb) {
      out.push(h('div', { class: 'wz-sub' },
        h('label', null, 'Final', compSelect(d.absorb.final, (v) => { d.absorb.final = v; }, { label: 'Final component' })),
        h('div', null, h('span', { class: 'muted small', text: 'Takes the weight of:' }), idxs.filter((i) => i !== d.absorb.final).map((i) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: d.absorb.from.includes(i), 'aria-label': `Final takes the weight of ${d.comps[i].name}`, on: { change: (e) => {
            d.absorb.from = e.target.checked ? [...d.absorb.from, i] : d.absorb.from.filter((x) => x !== i);
          } } }), d.comps[i].name)))));
    }
    // minimum warning
    out.push(h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!d.minWarn, 'aria-label': 'Minimum warning', on: { change: (e) => {
      d.minWarn = e.target.checked ? { comp: guess(/lab/i) ?? idxs[0], min: 50 } : null;
      show();
    } } }), 'Minimum needed on a component (e.g. labs ≥ 50%)'));
    if (d.minWarn) {
      out.push(h('div', { class: 'wz-sub' },
        h('label', null, 'Component', compSelect(d.minWarn.comp, (v) => { d.minWarn.comp = v; }, { label: 'Minimum on component' })),
        h('label', null, 'Minimum %', input(d.minWarn, 'min', { inputmode: 'decimal', 'aria-label': 'Minimum %' }))));
    }
    // excused routing
    out.push(h('p', { class: 'muted small', text: 'Excused items: where does an excused item’s weight go? (You tick “excused” on an item later.)' }));
    for (const i of idxs) {
      const e = d.excused[i] || { mode: 'stay' };
      const others = idxs.filter((x) => x !== i);
      const sel = h('select', { 'aria-label': `Excused ${d.comps[i].name} go to`, on: { change: (ev) => {
        const v = ev.target.value;
        if (v === 'stay') delete d.excused[i];
        else if (v === 'by_date') d.excused[i] = { mode: 'by_date', pivot: guess(/mid/i) ?? others[0], before: guess(/mid/i) ?? others[0], after: guess(/final|exam/i) ?? others[others.length - 1] };
        else d.excused[i] = { mode: 'to', to: Number(v) };
        show();
      } } },
      h('option', { value: 'stay', text: 'Stay here', selected: e.mode === 'stay' }),
      others.map((o) => h('option', { value: String(o), text: `→ ${d.comps[o].name}`, selected: e.mode === 'to' && e.to === o })),
      others.length ? h('option', { value: 'by_date', text: 'By date (before / after a date)', selected: e.mode === 'by_date' }) : null);
      out.push(h('label', null, d.comps[i].name, sel));
      if (e.mode === 'by_date') {
        const pick = (label, key) => h('label', null, label, h('select', { 'aria-label': `${d.comps[i].name}: ${label}`, on: { change: (ev) => { e[key] = Number(ev.target.value); } } },
          others.map((o) => h('option', { value: String(o), text: d.comps[o].name, selected: e[key] === o }))));
        out.push(h('div', { class: 'wz-sub' }, pick('Date of', 'pivot'), pick('Before it →', 'before'), pick('On/after, or no date →', 'after')));
      }
    }
    return out;
  }

  function stepCurve() {
    const type = d.curve?.type || '';
    const box = h('input', { type: 'text', inputmode: 'decimal', value: d.curve?.value ?? '', disabled: !d.curve, 'aria-label': 'Curve value',
      on: { input: (e) => { if (d.curve) d.curve.value = e.target.value; } } });
    return [
      h('p', { class: 'muted small', text: 'Only if the syllabus or professor already says so. You can add or change it any time in Edit structure.' }),
      h('label', null, 'Course curve', h('select', { 'aria-label': 'Course curve', on: { change: (e) => {
        d.curve = e.target.value ? { type: e.target.value, value: { add: '', mul: '', set: '' }[e.target.value] } : null;
        show();
      } } }, [['', 'No curve'], ['add', '+ points'], ['mul', '× factor'], ['set', 'Set grade %']].map(([v, l]) => h('option', { value: v, text: l, selected: type === v })))),
      h('label', null, type === 'add' ? 'Points (±)' : type === 'mul' ? 'Factor' : type === 'set' ? 'Curved grade %' : 'Value', box),
    ];
  }

  function stepReview() {
    const term = d.term_id === NEW_TERM ? { name: `${d.termName.trim()} (new)` } : ctx.terms.find((t) => t.id === d.term_id);
    const name = (i) => d.comps[i]?.name;
    const lines = [];
    if (d.absorb) lines.push(`${name(d.absorb.final)} replaces ${d.absorb.from.map(name).join(', ')} when higher`);
    if (d.minWarn) lines.push(`${name(d.minWarn.comp)} minimum ${num(Number(d.minWarn.min))}%`);
    for (const [i, e] of Object.entries(d.excused)) {
      lines.push(e.mode === 'to' ? `Excused ${name(Number(i))} → ${name(e.to)}` : `Excused ${name(Number(i))}: before ${name(e.pivot)}’s date → ${name(e.before)}, on/after or no date → ${name(e.after)}`);
    }
    if (d.curve) lines.push(`Curve: ${d.curve.type === 'add' ? `+${d.curve.value} points` : d.curve.type === 'mul' ? `×${d.curve.value}` : `set to ${d.curve.value}%`}`);
    return [
      h('p', null, h('b', { text: `${d.code.trim() || ''} ${d.title.trim()}`.trim() }),
        h('span', { class: 'muted', text: ` · ${term?.name} · ${num(Number(d.credits))} cr` })),
      h('table', { class: 'grid wz-review' }, h('tbody', null, d.comps.map((c) => h('tr', null,
        h('td', { text: c.name }), h('td', { class: 'num', text: `${num(numOr(c.weight, 0))}%${c.is_bonus ? ' bonus' : ''}` }),
        h('td', { class: 'muted small', text: `${c.count} × /${num(Number(c.out_of))}${Number(c.drop) ? `, drop ${c.drop}` : ''}${c.custom ? ', custom weights' : ''}` }))))),
      totalLine(),
      lines.length ? h('ul', { class: 'small' }, lines.map((l) => h('li', { text: l }))) : h('p', { class: 'muted small', text: 'No special rules.' }),
    ];
  }

  // ---- create everything
  // The whole setup is one undo step when the page offers batch().
  const createAll = (btn) => (ctx.batch ? ctx.batch('set up a course', () => createAllNow(btn)) : createAllNow(btn));
  async function createAllNow(btn) {
    btn.disabled = true;
    err.textContent = 'Creating…';
    let term = ctx.terms.find((t) => t.id === d.term_id);
    if (d.term_id === NEW_TERM) {
      term = await ctx.create('terms', { name: d.termName.trim(), ...guessSeason(d.termName),
        sort_order: Math.max(0, ...ctx.terms.map((t) => t.sort_order ?? 0)) + 1 });
      if (!term) { err.textContent = 'Not created (see the message).'; btn.disabled = false; return; }
      d.term_id = term.id;
    }
    const course = await ctx.create('courses', { term_id: d.term_id, code: d.code.trim() || null, title: d.title.trim(),
      credits: Number(d.credits), sort_order: Math.max(0, ...ctx.courses.filter((c) => c.term_id === d.term_id).map((c) => c.sort_order ?? 0)) + 1 });
    if (!course) { err.textContent = 'Not created (see the message).'; btn.disabled = false; return; }
    const ids = [];
    for (const [i, c] of d.comps.entries()) {
      const n = Number(c.count);
      const drop = Number(c.drop) || 0;
      const k = await ctx.create('components', { course_id: course.id, name: c.name.trim(), weight: Number(c.weight), is_bonus: c.is_bonus ? 1 : 0,
        drop_so_far: drop, drop_average: drop, aggregation: c.custom ? 'weighted' : 'mean', sort_order: i + 1 });
      if (!k) { err.textContent = 'Stopped part-way: the course exists; finish it in Edit structure.'; closeDialog('dlg'); ctx.done(term, course); return; }
      ids.push(k.id);
      const ws = c.custom ? c.itemWeights.split(/[,\s]+/).filter(Boolean).map(Number) : null;
      for (let j = 0; j < n; j++) {
        const itemName = c.names?.[j] ?? (n === 1 ? c.name.trim() : `${singular(c.name)} ${j + 1}`);
        await ctx.create('assessments', { component_id: k.id, name: itemName, mark: null, out_of: Number(c.out_of),
          item_weight: ws ? ws[j] : null, sort_order: j + 1 });
      }
    }
    const comps = ctx.compsOf(course);
    const byIdx = (i) => comps.find((k) => k.id === ids[i]);
    if (d.absorb) await ctx.patchRow('components', byIdx(d.absorb.final), { rule: { type: 'absorb_if_higher', from: d.absorb.from.map((i) => ids[i]) } });
    if (d.minWarn) await ctx.patchRow('components', byIdx(d.minWarn.comp), { rule: { type: 'min_warning', min: Number(d.minWarn.min) / 100, label: `${d.comps[d.minWarn.comp].name.trim()} min ${num(Number(d.minWarn.min))}%` } });
    for (const [i, e] of Object.entries(d.excused)) {
      const value = e.mode === 'to' ? { to: ids[e.to] } : { by_date: { pivot: ids[e.pivot], before: ids[e.before], after: ids[e.after] } };
      await ctx.patchRow('components', byIdx(Number(i)), { excused_to: value });
    }
    if (d.curve) {
      const v = Number(d.curve.value);
      await ctx.patchRow('courses', course, { curve: { type: d.curve.type, value: d.curve.type === 'set' ? Math.round(v * 1e4) / 1e6 : v } });
    }
    closeDialog('dlg');
    toast(`Created ${d.code.trim() || d.title.trim()}`);
    ctx.done(term, course);
  }

  // ---- frame
  function show() {
    const body = [stepCourse, stepComponents, stepItems, stepRules, stepCurve, stepReview][d.step]();
    err.textContent = '';
    const back = h('button', { class: 'btn', type: 'button', text: d.step ? 'Back' : 'Cancel', on: { click: () => {
      if (d.step) { d.step--; show(); } else closeDialog('dlg');
    } } });
    const next = h('button', { class: 'btn primary', type: 'button', text: d.step === STEPS.length - 1 ? 'Create course' : 'Next', on: { click: () => {
      if (d.step === STEPS.length - 1) { createAll(next); return; }
      const e = check(d.step);
      if (e) { err.textContent = e; return; }
      d.step++; show();
    } } });
    openDialog('dlg',
      h('h2', { text: 'New course' }),
      h('ol', { class: 'wz-steps', 'aria-label': 'Steps' }, STEPS.map((s, i) => h('li', { class: i === d.step ? 'on' : i < d.step ? 'done' : '', text: s,
        'aria-current': i === d.step ? 'step' : null }))),
      h('div', { class: 'form wz-body' }, body),
      err,
      h('div', { class: 'row' }, back, next));
  }
  show();
}
