// Graphs: inline SVG, no libraries. Colours come from CSS tokens (--viz-*, --text, --muted, --bad), so both themes work.
// Every chart draws at its real width (ResizeObserver), has a hover/focus tooltip and a "Table" twin with the same values.
// Text goes in with createTextNode / textContent only. Values are fractions (0.85 = 85%), like calc.js.
import { h, pct } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const lin = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
const p1 = (v) => pct(v, 1);
const r2 = (v) => Math.round(v * 100) / 100;
// The CSP blocks style="" attributes; setting styles through the CSSOM is allowed.
const sty = (el, o) => { Object.assign(el.style, o); return el; };
const pref = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: fine */ } },
};

/** Column from baseline y0 up to y1: 4px rounded top, square at the baseline. */
function colPath(x, w, y0, y1) {
  const r = Math.max(0, Math.min(4, w / 2, y0 - y1));
  return `M${r2(x)},${r2(y0)}V${r2(y1 + r)}Q${r2(x)},${r2(y1)} ${r2(x + r)},${r2(y1)}H${r2(x + w - r)}Q${r2(x + w)},${r2(y1)} ${r2(x + w)},${r2(y1 + r)}V${r2(y0)}Z`;
}
/** Bar from x0 right to x1 at y (thickness t): 4px rounded end, square at the baseline. */
function barPath(x0, x1, y, t) {
  const r = Math.max(0, Math.min(4, t / 2, x1 - x0));
  return `M${r2(x0)},${r2(y)}H${r2(x1 - r)}Q${r2(x1)},${r2(y)} ${r2(x1)},${r2(y + r)}V${r2(y + t - r)}Q${r2(x1)},${r2(y + t)} ${r2(x1 - r)},${r2(y + t)}H${r2(x0)}Z`;
}

// ---- drawing at the real width: one observer for every chart; detached plots are dropped.
const drawers = new WeakMap();
const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => {
  for (const e of entries) {
    const el = e.target;
    if (!el.isConnected) { ro.unobserve(el); continue; }
    const d = drawers.get(el);
    const w = Math.floor(el.clientWidth);
    if (d && w > 0 && Math.abs(w - d.w) > 2) { d.w = w; el.replaceChildren(d.draw(w)); }
  }
}) : null;

// ---- tooltip: value first (strong), label after; same on focus as on hover.
// position: fixed, placed in window coordinates, so no card or scrolling pane can clip it and it never runs off screen:
// below the mark, flipped above when there's no room below, clamped to the window on every side. Any scroll hides it.
const openTips = new Set();
if (typeof window !== 'undefined') {
  const hideAll = () => { for (const t of openTips) t.hidden = true; openTips.clear(); };
  window.addEventListener('scroll', hideAll, { capture: true, passive: true });
  window.addEventListener('resize', hideAll);
}
/** Top-left for a tw × th tooltip by anchor rect `a` in a vw × vh window, M px from every edge. */
export function placeTip(a, tw, th, vw, vh, M = 8, gap = 8) {
  const x = Math.max(M, Math.min(a.left + a.width / 2 - tw / 2, vw - tw - M));
  let y = a.bottom + gap;
  if (y + th > vh - M) y = a.top - th - gap;
  if (y < M) y = Math.max(M, Math.min(vh - th - M, a.bottom + gap));
  return { x: Math.round(x), y: Math.round(y) };
}
function tipper(fig) {
  const tip = h('div', { class: 'chart-tip', hidden: true });
  fig.append(tip);
  const show = (anchor, rows, title) => {
    tip.replaceChildren(title ? h('div', { class: 'tt', text: title }) : '',
      ...rows.map(([v, label, key]) => h('div', { class: 'tr' }, key ? h('span', { class: `key ${key}` }) : '',
        h('strong', { text: v }), label ? h('span', { text: ` ${label}` }) : '')));
    tip.hidden = false;
    openTips.add(tip);
    const de = document.documentElement;
    const { x, y } = placeTip(anchor.getBoundingClientRect(), tip.offsetWidth, tip.offsetHeight, de.clientWidth, de.clientHeight);
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  };
  const hide = () => { tip.hidden = true; openTips.delete(tip); };
  /** Hover + focus target `el` (bigger than the mark), lifting `mark` while active; the tooltip sits by the mark. */
  const bind = (el, mark, get) => {
    const on = () => {
      const t = get(), m = mark && mark.getBoundingClientRect();
      show(m && (m.width || m.height) ? mark : el, t.rows, t.title);
      if (mark) mark.classList.add('on');
    };
    const off = () => { hide(); if (mark) mark.classList.remove('on'); };
    el.setAttribute('tabindex', '0');
    el.addEventListener('pointerenter', on); el.addEventListener('pointerleave', off);
    el.addEventListener('focus', on); el.addEventListener('blur', off);
  };
  return { show, hide, bind };
}

function legendEl(items) {
  return h('ul', { class: 'chart-legend' }, items.map(([key, label]) => h('li', null, h('span', { class: `key ${key}` }), label)));
}
function tableEl(head, rows) {
  return h('details', { class: 'chart-table' }, h('summary', { text: 'Table' }),
    h('table', { class: 'grid' }, h('thead', null, h('tr', null, head.map((c, i) => h('th', { class: i ? 'num' : null, text: c })))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i ? 'num' : null, text: c })))))));
}

/** figure.chart: caption, optional legend, the plot (drawn on resize), a tooltip and the table twin. */
function frame({ cls = '', title, note, tools, legend, table, draw, empty }) {
  const fig = h('figure', { class: `chart ${cls}` },
    h('figcaption', null, h('span', { class: 'chart-title', text: title }), note ? h('span', { class: 'chart-note', text: note }) : null, tools || null));
  if (empty) { fig.append(h('p', { class: 'muted small', text: empty })); return fig; }
  if (legend) fig.append(legendEl(legend));
  const plot = h('div', { class: 'chart-plot' });
  fig.append(plot);
  const tip = tipper(fig);
  if (table) fig.append(table);
  drawers.set(plot, { w: 0, draw: (w) => draw(w, tip) });
  if (ro) ro.observe(plot);
  fig.redraw = () => {
    const d = drawers.get(plot), w = Math.floor(plot.clientWidth);
    tip.hide();
    if (w > 0) { d.w = w; plot.replaceChildren(d.draw(w)); }
  };
  return fig;
}

const niceStep = (span, target) => {
  const raw = span / Math.max(1, target);
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((st) => st >= raw) || p * 10;
};
function grid(svg, y, ticks, x0, x1, fmt, labels = true) {
  for (const t of ticks) {
    svg.append(s('line', { class: 'viz-grid', x1: x0, x2: x1, y1: r2(y(t)), y2: r2(y(t)) }),
      labels ? s('text', { class: 'viz-tick', x: x0 - 6, y: r2(y(t)) + 4, 'text-anchor': 'end' }, fmt(t)) : null);
  }
}

// ---------------------------------------------------------------- 1. bell curve of course grades
/**
 * Spread dots along a curve so none overlap: each wants arc-length position `want`; dots closer than `gap` are merged
 * into a run centred on their mean wanted position (repeated until no runs touch). Returns positions in input order.
 */
export function spreadAlong(wants, gap, total) {
  const order = wants.map((w, i) => ({ w, i })).sort((a, b) => a.w - b.w);
  let runs = order.map((o) => ({ items: [o], sum: o.w }));
  const startOf = (r) => {
    const k = r.items.length, span = (k - 1) * gap;
    return Math.max(0, Math.min(total - span, r.sum / k - span / 2));
  };
  for (let merged = true; merged;) {
    merged = false;
    const next = [];
    for (const r of runs) {
      const prev = next[next.length - 1];
      if (prev && startOf(prev) + (prev.items.length - 1) * gap + gap > startOf(r) + 1e-9) {
        prev.items.push(...r.items); prev.sum += r.sum; merged = true;
      } else next.push(r);
    }
    runs = next;
  }
  const out = new Array(wants.length);
  for (const r of runs) { const st = startOf(r); r.items.forEach((o, j) => { out[o.i] = st + j * gap; }); }
  return out;
}

/** points: [{label, name, sub, v}] (v = fraction). Normal curve from the mean and sample SD; ±1 SD, mean, 50% fail line. */
export function bellChart(points) {
  const vals = points.map((p) => p.v * 100);
  const n = vals.length;
  if (n < 2) return frame({ cls: 'bell', title: 'All course grades', empty: 'Needs at least 2 graded courses.' });
  const mean = vals.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) || 1;
  const lo = Math.max(0, Math.floor(Math.min(45, mean - 3 * sd, ...vals) / 5) * 5);
  const hi = Math.max(100, Math.ceil(Math.max(...vals) / 5) * 5);
  const sorted = points.map((p, i) => ({ ...p, x: vals[i] })).sort((a, b) => a.x - b.x);
  const table = tableEl(['Course', 'Name', 'Term', 'Grade'], [...sorted].reverse().map((p) => [p.label, p.name || '', p.sub || '', p1(p.v)]));
  return frame({
    cls: 'bell', title: 'All course grades',
    note: `${n} courses · mean ${mean.toFixed(1)}% · SD ${sd.toFixed(1)} (in-progress courses: current average)`,
    legend: [['line', 'Normal curve'], ['dot', 'A course (on the curve at its grade)']],
    table,
    draw: (W, tip) => {
      const L = 12, R = 12, T = 34, curveH = 130, base = T + curveH, H = base + 22;
      const x = lin(lo, hi, L, W - R);
      const pdf = (v) => Math.exp(-0.5 * ((v - mean) / sd) ** 2);
      const y = (d) => base - d * curveH * 0.92;
      // The curve, finely sampled, with arc length so dots can be spread along it.
      const N = 600, cx = [], cy = [], arc = [0];
      for (let i = 0; i <= N; i++) {
        const v = lo + ((hi - lo) * i) / N;
        cx.push(x(v)); cy.push(y(pdf(v)));
        if (i) arc.push(arc[i - 1] + Math.hypot(cx[i] - cx[i - 1], cy[i] - cy[i - 1]));
      }
      const arcAtX = (px) => {
        const t = Math.max(0, Math.min(N, ((px - cx[0]) / (cx[N] - cx[0])) * N)), i = Math.min(N - 1, Math.floor(t));
        return arc[i] + (arc[i + 1] - arc[i]) * (t - i);
      };
      const pointAt = (a) => {
        let i0 = 0, i1 = N;
        while (i1 - i0 > 1) { const m = (i0 + i1) >> 1; if (arc[m] <= a) i0 = m; else i1 = m; }
        const f = (a - arc[i0]) / ((arc[i1] - arc[i0]) || 1);
        return [cx[i0] + (cx[i1] - cx[i0]) * f, cy[i0] + (cy[i1] - cy[i0]) * f];
      };
      const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Bell curve of ${n} course grades` });
      const pts = cx.filter((_, i) => i % 5 === 0).map((X, k) => `${r2(X)},${r2(cy[k * 5])}`);
      for (let t = Math.ceil(lo / 10) * 10; t <= hi; t += 10) {
        svg.append(s('text', { class: 'viz-tick', x: r2(x(t)), y: H - 6, 'text-anchor': 'middle' }, `${t}`));
      }
      svg.append(s('line', { class: 'viz-axis', x1: L, x2: W - R, y1: base, y2: base }),
        s('path', { class: 'viz-area', d: `M${r2(x(lo))},${base}L${pts.join('L')}L${r2(x(hi))},${base}Z` }),
        s('path', { class: 'viz-line', d: `M${pts.join('L')}` }));
      const ref = (v, cls, label, row, anchor = 'middle') => {
        if (v < lo || v > hi) return;
        const X = r2(x(v));
        svg.append(s('line', { class: cls, x1: X, x2: X, y1: T - 4 + row * 13, y2: base }),
          s('text', { class: `viz-ref-label ${cls}`, x: anchor === 'end' ? X - 4 : X, y: T - 8 + row * 13, 'text-anchor': anchor }, label));
      };
      ref(mean - sd, 'viz-ref-sd', '−1 SD', 1);
      ref(mean + sd, 'viz-ref-sd', '+1 SD', 1);
      ref(mean, 'viz-ref-mean', `mean ${mean.toFixed(1)}%`, 0);
      ref(50, 'viz-ref-fail', '50% fail', 0, 'end');
      // Each dot sits on the curve at its grade; equal or close grades are nudged apart along the curve (11px apart,
      // more than a dot + its ring), so none hides another.
      const at = spreadAlong(sorted.map((p) => arcAtX(x(p.x))), 11, arc[N]);
      sorted.forEach((p, i) => {
        const [X, Y] = pointAt(at[i]);
        const dot = s('circle', { class: 'viz-dot', cx: r2(X), cy: r2(Y), r: 4, 'data-grade': r2(p.x) });
        const hit = s('circle', { class: 'viz-hit', cx: r2(X), cy: r2(Y), r: 9, 'aria-label': `${p.label} ${p1(p.v)}` });
        svg.append(dot, hit);
        tip.bind(hit, dot, () => ({ title: [p.label, p.sub].filter(Boolean).join(' · '), rows: [[p1(p.v), p.name || '']] }));
      });
      return svg;
    },
  });
}

// ---------------------------------------------------------------- 2. semester cluster bars
/** groups: [{short, name, avg, items: [{label, v}]}]. Each course a column, grouped by term; the term average is a line. */
export function clusterChart(groups) {
  const all = groups.flatMap((g) => g.items);
  if (!all.length) return frame({ cls: 'cluster', title: 'Courses by term', empty: 'No graded courses yet.' });
  const top = Math.max(1, ...all.map((c) => c.v));
  const table = tableEl(['Course', 'Term', 'Grade'], groups.flatMap((g) => [
    ...g.items.map((c) => [c.label, g.short, p1(c.v)]), [`${g.name} average`, g.short, p1(g.avg)]]));
  return frame({
    cls: 'cluster', title: 'Courses by term', note: 'term average = credit-weighted',
    legend: [['bar', 'Course grade'], ['avg', 'Term average']],
    table,
    draw: (W, tip) => {
      const L = 34, R = 6, T = 10, plotH = 150, H = T + plotH + 34;
      const y = lin(0, top * 100, T + plotH, T);
      const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Course grades grouped by term' });
      grid(svg, (v) => y(v), [0, 25, 50, 75, 100].filter((t) => t <= top * 100 + 1e-9), L, W - R, (t) => `${t}`);
      const gap = 12, slots = all.length;
      const slot = Math.max(3, (W - L - R - gap * (groups.length - 1)) / slots);
      const bw = Math.max(2, Math.min(24, slot - 2));
      let gx = L;
      for (const g of groups) {
        const gw = g.items.length * slot;
        g.items.forEach((c, i) => {
          const bx = gx + i * slot + (slot - bw) / 2;
          const bar = s('path', { class: 'viz-bar', d: colPath(bx, bw, y(0), y(c.v * 100)) });
          const hit = s('rect', { class: 'viz-hit', x: r2(gx + i * slot), y: T, width: r2(slot), height: plotH });
          svg.append(bar, hit);
          tip.bind(hit, bar, () => ({ title: c.label, rows: [[p1(c.v), g.name]] }));
        });
        if (g.avg !== null && g.avg !== undefined) {
          const ay = r2(y(g.avg * 100));
          const line = s('line', { class: 'viz-avg', x1: r2(gx), x2: r2(gx + gw), y1: ay, y2: ay });
          const hit = s('rect', { class: 'viz-hit', x: r2(gx), y: ay - 5, width: r2(gw), height: 10 });
          svg.append(line, hit);
          tip.bind(hit, line, () => ({ title: `${g.name} average`, rows: [[p1(g.avg), `${g.items.length} courses`]] }));
        }
        const cx = r2(gx + gw / 2);
        svg.append(s('text', { class: 'viz-label', x: cx, y: T + plotH + 14, 'text-anchor': 'middle' }, g.short));
        if (gw >= 40 && g.avg !== null && g.avg !== undefined) {
          svg.append(s('text', { class: 'viz-tick', x: cx, y: T + plotH + 28, 'text-anchor': 'middle' }, `${(g.avg * 100).toFixed(1)}`));
        }
        gx += gw + gap;
      }
      return svg;
    },
  });
}

// ---------------------------------------------------------------- 3. cumulative average over time
const MODE_KEY = 'gc-cumul-mode', SEM_KEY = 'gc-cumul-class-term';
const MODES = ['line', 'year', 'semester', 'class'];
/**
 * terms:   [{short, name, before, cum, term, worst: {label, name, v}, best: {...}}] in term order.
 * years:   the same shape, one per year of study (term = the year average).
 * classes: [{group, groupName, label, name, v, final, items, open, lo: {name, component, v}, hi}] in term order.
 * Line: cumulative = line (the point), term average = grey dots (context).
 * Candles (Year / Semester): body = cumulative before → after (first one: before = its own average); green filled if it
 * rose, red hollow if it fell (shape as well as colour); wick = lowest → highest course; grey dot = the year/term average.
 * Candles (Class): body = the course's running grade after its first marked item → its grade; wick = lowest → highest
 * assessment; grey dot = the grade. No item detail = dot only. Wide enough to scroll sideways inside the card.
 */
export function cumulativeChart({ terms: points, years = [], classes = [] }) {
  if (!points.length) return frame({ cls: 'cumul', title: 'Cumulative average', empty: 'No graded terms yet.' });
  let mode = pref.get(MODE_KEY, 'line');
  if (mode === 'candles') mode = 'semester'; // the old two-way toggle
  if (!MODES.includes(mode)) mode = 'line';
  const groups = [...new Set(classes.map((c) => c.group))];
  let sem = pref.get(SEM_KEY, 'all');
  if (sem !== 'all' && !groups.includes(sem)) sem = 'all';
  const has = (v) => v !== null && v !== undefined;
  const signed = (d) => `${d >= 0 ? '+' : '−'}${Math.abs(d * 100).toFixed(2)}`;
  const legends = {
    line: [['line', 'Cumulative'], ['dot ctx', 'Term average']],
    semester: [['candle up', 'Cumulative rose'], ['candle down', 'Cumulative fell'], ['wick', 'Lowest → highest course'], ['dot ctx', 'Term average']],
    year: [['candle up', 'Cumulative rose'], ['candle down', 'Cumulative fell'], ['wick', 'Lowest → highest course'], ['dot ctx', 'Year average']],
    class: [['candle up', 'Closed higher'], ['candle down', 'Closed lower'], ['wick', 'Lowest → highest assessment'], ['dot ctx', 'Final / current grade']],
  };
  const notes = {
    line: 'after each term, credit-weighted', semester: 'after each term, credit-weighted', year: 'after each year of study, credit-weighted',
    class: 'each course: grade after its first marked item → final grade',
  };
  const shownClasses = () => (sem === 'all' ? classes : classes.filter((c) => c.group === sem));
  const stepTable = (list, unit) => tableEl([unit, 'Before', 'After', 'Change', `${unit} average`, 'Worst course', 'Best course'], list.map((p) => [
    p.name, p1(p.before), p1(p.cum), has(p.before) && has(p.cum) ? signed(p.cum - p.before) : '—', p1(p.term),
    p.worst ? `${p.worst.label} ${p1(p.worst.v)}` : '—', p.best ? `${p.best.label} ${p1(p.best.v)}` : '—']));
  const itemText = (it) => `${it.name} ${p1(it.v)}`;
  const tableFor = (m) => {
    if (m === 'year') return stepTable(years, 'Year');
    if (m !== 'class') return stepTable(points, 'Term');
    return tableEl(['Course', 'Term', 'After first item', 'Grade', 'Change', 'Worst item', 'Best item'], shownClasses().map((c) => [
      `${c.label} ${c.name || ''}`.trim(), c.group, p1(c.open), p1(c.v), has(c.open) ? signed(c.v - c.open) : '—',
      c.items ? itemText(c.lo) : 'no item detail', c.items ? itemText(c.hi) : 'no item detail']));
  };
  const btn = (m, label) => h('button', { class: 'btn small', type: 'button', text: label, 'aria-pressed': String(mode === m), dataset: { mode: m },
    on: { click: () => setMode(m) } });
  const tools = h('div', { class: 'seg', role: 'group', 'aria-label': 'Chart type' },
    btn('line', 'Line'), h('span', { class: 'seg-label', text: 'Candles:' }), btn('year', 'Year'), btn('semester', 'Semester'), btn('class', 'Class'));
  const semBtn = (g, label) => h('button', { class: 'btn small', type: 'button', text: label, 'aria-pressed': String(sem === g), dataset: { sem: g },
    on: { click: () => setSem(g) } });
  const filter = h('div', { class: 'chart-filter', role: 'group', 'aria-label': 'Semester', hidden: mode !== 'class' },
    semBtn('all', 'All'), groups.map((g) => semBtn(g, g)));

  const fig = frame({
    cls: 'cumul', title: 'Cumulative average', note: notes[mode], tools,
    legend: legends[mode], table: tableFor(mode),
    draw: (W, tip) => (mode === 'line' ? drawLine(W, tip) : drawCandles(W, tip)),
  });
  fig.querySelector('.chart-legend').after(filter);

  function axis(vals) {
    const step0 = niceStep(Math.max(4, Math.max(...vals) - Math.min(...vals)), 4);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 1) / step0) * step0);
    const hi = Math.ceil((Math.max(...vals) + 1) / step0) * step0;
    const ticks = [];
    for (let t = lo; t <= hi + 1e-9; t += step0) ticks.push(Math.round(t * 100) / 100);
    return { lo, hi, ticks };
  }

  /** One candle at X: body open → close, wick lo → hi, grey dot; no open = dot only. */
  function candle(svg, X, cw, y, c) {
    const up = !has(c.open) || c.close >= c.open - 1e-12;
    const g = s('g', { class: `viz-candle ${has(c.open) ? (up ? 'up' : 'down') : 'none'}` });
    if (has(c.lo) && has(c.hi)) g.append(s('line', { class: 'viz-wick', x1: r2(X), x2: r2(X), y1: r2(y(c.hi * 100)), y2: r2(y(c.lo * 100)) }));
    if (has(c.open)) {
      const yTop = y(Math.max(c.open, c.close) * 100), yBot = y(Math.min(c.open, c.close) * 100);
      const bh = Math.max(2, yBot - yTop);
      g.append(s('rect', { class: 'viz-body', x: r2(X - cw / 2), y: r2((yTop + yBot) / 2 - bh / 2), width: r2(cw), height: r2(bh), rx: 2 }));
    }
    if (has(c.dot)) g.append(s('circle', { class: 'viz-dot ctx', cx: r2(X), cy: r2(y(c.dot * 100)), r: 4 }));
    svg.append(g);
    return { g, up };
  }

  function drawCandles(W, tip) {
    const isClass = mode === 'class';
    const step = mode === 'year' ? years : points;
    const unit = mode === 'year' ? 'year' : 'term';
    // Each item: {key (group), open, close, lo, hi, dot, title, rows, aria}
    const list = isClass
      ? shownClasses().map((c) => ({ key: c.group, open: c.open, close: c.v, lo: c.lo?.v, hi: c.hi?.v, dot: c.v, code: c.label,
        title: `${c.label} · ${[c.name, c.groupName].filter(Boolean).join(' · ')}`,
        aria: `${c.label}: ${c.items ? `${p1(c.open)} to ${p1(c.v)}` : `${p1(c.v)}, no item detail`}`,
        rows: (up) => (c.items && has(c.open) ? [
          [`${p1(c.open)} → ${p1(c.v)}`, `after first item → ${c.final ? 'final' : 'now'} (${signed(c.v - c.open)}, ${up ? 'higher' : 'lower'})`, `candle ${up ? 'up' : 'down'}`],
          [p1(c.hi.v), `best: ${c.hi.name} (${c.hi.component})`],
          [p1(c.lo.v), `worst: ${c.lo.name} (${c.lo.component})`],
          [p1(c.v), c.final ? 'final grade' : 'current average', 'dot ctx']]
          : [[p1(c.v), c.final ? 'final grade' : 'current average', 'dot ctx'], ['—', 'no item detail']]) }))
      : step.map((p) => {
        const open = has(p.before) ? p.before : p.term;
        return { key: p.short, short: p.short, open, close: p.cum, lo: p.worst?.v, hi: p.best?.v, dot: p.term, title: p.name,
          aria: `${p.name}: ${p1(open)} to ${p1(p.cum)}`,
          rows: (up) => [
            [`${p1(open)} → ${p1(p.cum)}`, `cumulative (${signed(p.cum - open)}, ${up ? 'rose' : 'fell'})`, `candle ${up ? 'up' : 'down'}`],
            p.best ? [p1(p.best.v), `best: ${p.best.label} ${p.best.name || ''}`.trim()] : null,
            p.worst ? [p1(p.worst.v), `worst: ${p.worst.label} ${p.worst.name || ''}`.trim()] : null,
            [p1(p.term), `${unit} average`, 'dot ctx']].filter(Boolean) };
      });
    const vals = list.flatMap((c) => [c.open, c.close, c.lo, c.hi, c.dot]).filter(has).map((v) => v * 100);
    const { lo, hi, ticks } = axis(vals);
    const n = list.length;
    const L = 34, T = 12, plotH = 180;
    const R = isClass ? 12 : 54;
    // Class: fixed slots grouped by term (gap + separator between terms); wider than the card = scroll inside it.
    const gap = isClass ? 14 : 0;
    const nGroups = isClass ? new Set(list.map((c) => c.key)).size : 1;
    const minSlot = isClass ? 22 : 0;
    // Class: the y-axis labels sit outside the scroller (AX wide) so they stay put; a short list is centred.
    const AX = isClass ? L : 0, L0 = isClass ? 6 : L, inner = W - AX;
    const fitSlot = isClass ? (inner - L0 - R - gap * (nGroups - 1)) / Math.max(1, n) : 0;
    const slot = isClass ? Math.max(minSlot, Math.min(96, fitSlot)) : (n === 1 ? W - L - R : (W - R - L - 28) / (n - 1));
    const used = n * slot + gap * (nGroups - 1);
    const codes = isClass && slot >= 60;
    const SW = isClass ? Math.max(inner, Math.ceil(L0 + R + used)) : W;
    const H = T + plotH + (codes ? 38 : 24);
    const y = lin(lo, hi, T + plotH, T);
    const xs = [];
    if (isClass) {
      let gx = L0 + Math.max(0, (inner - L0 - R - used) / 2);
      list.forEach((c, i) => {
        if (i && c.key !== list[i - 1].key) gx += gap;
        xs.push(gx + slot / 2); gx += slot;
      });
    } else for (let i = 0; i < n; i++) xs.push(n === 1 ? (L + W - R) / 2 : L + 14 + (i * (W - R - L - 28)) / (n - 1));
    const svg = s('svg', { width: SW, height: H, viewBox: `0 0 ${SW} ${H}`, role: 'img', 'data-mode': mode,
      'aria-label': isClass ? 'Each course as a candle: first marked item to grade' : `Cumulative average per ${unit} as candles` });
    grid(svg, (v) => y(v), ticks, L0, SW - R, (t) => `${t}`, !isClass);
    const cw = Math.max(6, Math.min(18, slot * (isClass ? 0.5 : 0.45)));
    // x labels: one per step, or per term group (+ course codes when there's room) with separators between groups.
    if (isClass) {
      let start = 0;
      list.forEach((c, i) => {
        if (codes) svg.append(s('text', { class: 'viz-tick', x: r2(xs[i]), y: T + plotH + 14, 'text-anchor': 'middle' }, c.code));
        if (i === n - 1 || list[i + 1].key !== c.key) {
          svg.append(s('text', { class: 'viz-label', x: r2((xs[start] + xs[i]) / 2), y: H - 6, 'text-anchor': 'middle' }, c.key));
          if (i < n - 1) {
            const sx = r2(xs[i] + slot / 2 + gap / 2);
            svg.append(s('line', { class: 'viz-sep', x1: sx, x2: sx, y1: T, y2: H - 2 }));
          }
          start = i + 1;
        }
      });
    } else list.forEach((c, i) => svg.append(s('text', { class: 'viz-label', x: r2(xs[i]), y: H - 6, 'text-anchor': 'middle' }, c.short)));
    list.forEach((c, i) => {
      const { g, up } = candle(svg, xs[i], cw, y, c);
      const hw = isClass ? slot / 2 : Math.max(12, slot / 2);
      const hit = s('rect', { class: 'viz-hit', x: r2(xs[i] - hw), y: T, width: r2(hw * 2), height: plotH, 'aria-label': c.aria });
      svg.append(hit);
      tip.bind(hit, g, () => ({ title: c.title, rows: c.rows(up) }));
    });
    if (!isClass) {
      const lastP = step[step.length - 1];
      svg.append(s('text', { class: 'viz-end', x: r2(xs[n - 1] + Math.max(12, cw / 2 + 6)), y: r2(y(lastP.cum * 100)) + 4 }, p1(lastP.cum)));
      return svg;
    }
    const ax = s('svg', { class: 'viz-yaxis', width: AX, height: H, viewBox: `0 0 ${AX} ${H}`, 'aria-hidden': 'true' });
    for (const t of ticks) ax.append(s('text', { class: 'viz-tick', x: AX - 6, y: r2(y(t)) + 4, 'text-anchor': 'end' }, `${t}`));
    const scroller = h('div', { class: 'chart-scroll' }, svg);
    if (SW > inner) requestAnimationFrame(() => { scroller.scrollLeft = scroller.scrollWidth; }); // newest courses in view
    return sty(h('div', { class: 'chart-scroll-row' }, ax, scroller), { gridTemplateColumns: `${AX}px minmax(0, 1fr)` });
  }

  function drawLine(W, tip) {
    const vals = points.flatMap((p) => [p.cum, p.term]).filter(has).map((v) => v * 100);
    const { lo, hi, ticks } = axis(vals);
    const L = 34, R = 54, T = 12, plotH = 150, H = T + plotH + 24;
    const y = lin(lo, hi, T + plotH, T);
    const n = points.length;
    const x = (i) => (n === 1 ? (L + W - R) / 2 : L + 14 + (i * (W - R - L - 28)) / (n - 1));
    const svg = s('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'data-mode': 'line', 'aria-label': 'Cumulative average after each term' });
    grid(svg, (v) => y(v), ticks, L, W - R, (t) => `${t}`);
    points.forEach((p, i) => svg.append(s('text', { class: 'viz-label', x: r2(x(i)), y: H - 6, 'text-anchor': 'middle' }, p.short)));
    const last = points[n - 1];
    const cross = s('line', { class: 'viz-cross', x1: 0, x2: 0, y1: T, y2: T + plotH, visibility: 'hidden' });
    svg.append(cross);
    points.forEach((p, i) => { if (has(p.term)) svg.append(s('circle', { class: 'viz-dot ctx', cx: r2(x(i)), cy: r2(y(p.term * 100)), r: 4 })); });
    svg.append(s('path', { class: 'viz-line', d: `M${points.map((p, i) => `${r2(x(i))},${r2(y(p.cum * 100))}`).join('L')}` }));
    points.forEach((p, i) => svg.append(s('circle', { class: 'viz-dot', cx: r2(x(i)), cy: r2(y(p.cum * 100)), r: 4 })));
    svg.append(s('text', { class: 'viz-end', x: r2(x(n - 1) + 9), y: r2(y(last.cum * 100)) + 4 }, p1(last.cum)));
    // Crosshair: snaps to the nearest term; arrow keys move it. The tooltip sits by the cumulative point.
    const pad = s('rect', { class: 'viz-hit', x: L, y: T, width: W - L - R + 40, height: plotH, 'aria-label': 'Cumulative average by term (arrow keys)' });
    let at = n - 1;
    const showAt = (i) => {
      at = Math.max(0, Math.min(n - 1, i));
      const X = r2(x(at));
      cross.setAttribute('x1', X); cross.setAttribute('x2', X); cross.setAttribute('visibility', 'visible');
      const p = points[at];
      const anchor = { getBoundingClientRect: () => {
        const b = svg.getBoundingClientRect(), Y = b.top + y(p.cum * 100);
        return { left: b.left + X - 4, top: Y - 4, width: 8, height: 8, bottom: Y + 4 };
      } };
      tip.show(anchor, [[p1(p.cum), 'cumulative', 'line'], [p1(p.term), 'term average', 'dot ctx']], p.name);
    };
    const off = () => { cross.setAttribute('visibility', 'hidden'); tip.hide(); };
    pad.setAttribute('tabindex', '0');
    pad.addEventListener('pointermove', (e) => {
      const b = svg.getBoundingClientRect(), px = e.clientX - b.left;
      let best = 0;
      points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
      if (best !== at || cross.getAttribute('visibility') !== 'visible') showAt(best);
    });
    pad.addEventListener('pointerleave', off);
    pad.addEventListener('focus', () => showAt(at));
    pad.addEventListener('blur', off);
    pad.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); showAt(at + (e.key === 'ArrowLeft' ? -1 : 1)); }
    });
    svg.append(pad);
    return svg;
  }

  function refresh() {
    tools.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    filter.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sem === sem)));
    filter.hidden = mode !== 'class';
    fig.querySelector('.chart-note').textContent = notes[mode];
    fig.querySelector('.chart-legend').replaceWith(legendEl(legends[mode]));
    const old = fig.querySelector('.chart-table'), next = tableFor(mode);
    next.open = old.open;
    old.replaceWith(next);
    fig.redraw();
  }
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    pref.set(MODE_KEY, m);
    refresh();
  }
  function setSem(g) {
    if (g === sem) return;
    sem = g;
    pref.set(SEM_KEY, g);
    refresh();
  }
  return fig;
}

// ---------------------------------------------------------------- horizontal rows (this term, components)
/**
 * HTML grid: labels | one SVG for every row | right-hand text. Rows have a fixed height so the three columns line up,
 * and long names get an ellipsis instead of running into the bars.
 */
function rowsChart({ cls, title, note, legend, table, rows, rowH, rightHead, max, drawRow, tipOf }) {
  const top = Math.max(1, max);
  const headH = 18, axisH = 18;
  return frame({
    cls: `rows ${cls}`, title, note, legend, table,
    draw: (W, tip) => {
      const labelW = Math.min(190, Math.max(72, Math.round(W * 0.3)));
      const rightW = rightHead ? Math.min(118, Math.max(84, Math.round(W * 0.22))) : 46;
      const plotW = Math.max(60, W - labelW - rightW - 12);
      const H = headH + rows.length * rowH + axisH;
      const wrap = sty(h('div', { class: 'rows-grid' }), { gridTemplateColumns: `${labelW}px ${plotW}px ${rightW}px` });
      const labels = sty(h('div', { class: 'rows-col' }), { paddingTop: `${headH}px` });
      const right = sty(h('div', { class: 'rows-col right' }), { paddingTop: rightHead ? '0px' : `${headH}px` });
      if (rightHead) right.append(sty(h('div', { class: 'rows-head', text: rightHead }), { height: `${headH}px` }));
      const x = lin(0, top * 100, 4, plotW - 6);
      const svg = s('svg', { width: plotW, height: H, viewBox: `0 0 ${plotW} ${H}`, role: 'img', 'aria-label': title });
      for (const t of [0, 25, 50, 75, 100].filter((v) => v <= top * 100 + 1e-9)) {
        svg.append(s('line', { class: t ? 'viz-grid' : 'viz-axis', x1: r2(x(t)), x2: r2(x(t)), y1: headH - 4, y2: H - axisH }),
          s('text', { class: 'viz-tick', x: r2(x(t)), y: H - 5, 'text-anchor': 'middle' }, `${t}`));
      }
      rows.forEach((row, i) => {
        const y0 = headH + i * rowH;
        labels.append(sty(h('div', { class: 'rows-label', title: row.title || row.label },
          h('span', { class: 'name', text: row.label }), row.sub ? h('span', { class: 'sub', text: row.sub }) : null), { height: `${rowH}px` }));
        right.append(sty(h('div', { class: `rows-right ${row.rightCls || ''}`, text: row.right ?? '' }), { height: `${rowH}px` }));
        const g = s('g', { class: 'viz-row' });
        drawRow(g, row, x, y0);
        const hit = s('rect', { class: 'viz-hit', x: 0, y: y0, width: plotW, height: rowH });
        svg.append(g, hit);
        tip.bind(hit, g, () => tipOf(row));
      });
      wrap.append(labels, h('div', { class: 'rows-plot' }, svg), right);
      return wrap;
    },
  });
}

/** This term. rows: [{label, title, soFar, average, projected, need: {text, cls}}]; target = fraction for "need". */
export function termChart(rows, target) {
  const vals = rows.flatMap((r) => [r.soFar, r.average, r.projected]).filter((v) => v !== null && v !== undefined);
  if (!vals.length) return frame({ cls: 'term', title: 'This term', empty: 'No marks yet this term.' });
  const head = `Final for ${(target * 100).toFixed(0)}%`;
  const table = tableEl(['Course', 'So far', 'Current', 'Projected (est.)', head],
    rows.map((r) => [r.label, p1(r.soFar), p1(r.average), p1(r.projected), r.need.text]));
  return rowsChart({
    cls: 'term', title: 'This term', note: 'so far (unmarked = 0) · current average · projected (est.)',
    legend: [['bar ctx', 'So far'], ['bar', 'Current'], ['tick', 'Projected (est.)']],
    table, rows: rows.map((r) => ({ ...r, right: r.need.text, rightCls: r.need.cls })), rowH: 30, rightHead: head,
    max: Math.max(...vals),
    drawRow: (g, r, x, y0) => {
      const x0 = x(0);
      if (r.soFar !== null && r.soFar !== undefined) g.append(s('path', { class: 'viz-bar ctx', d: barPath(x0, Math.max(x0, x(r.soFar * 100)), y0 + 6, 8) }));
      if (r.average !== null && r.average !== undefined) g.append(s('path', { class: 'viz-bar', d: barPath(x0, Math.max(x0, x(r.average * 100)), y0 + 16, 8) }));
      if (r.projected !== null && r.projected !== undefined) {
        const X = r2(x(r.projected * 100));
        g.append(s('line', { class: 'viz-tick-mark', x1: X, x2: X, y1: y0 + 3, y2: y0 + 27 }));
      }
    },
    tipOf: (r) => ({ title: r.title || r.label, rows: [[p1(r.soFar), 'so far', 'bar ctx'], [p1(r.average), 'current', 'bar'],
      [p1(r.projected), 'projected (est.)', 'tick'], [r.need.text, head.toLowerCase()]] }),
  });
}

/** One course's components. rows: [{label, weight, bonus, avg}] (weight in %, after any excused move). */
export function componentChart(rows) {
  if (!rows.length) return frame({ cls: 'comps', title: 'Components', empty: 'No components yet.' });
  const vals = rows.map((r) => r.avg).filter((v) => v !== null && v !== undefined);
  const wt = (r) => `${Math.round(r.weight * 100) / 100}%${r.bonus ? ' bonus' : ''}`;
  const table = tableEl(['Component', 'Weight', 'Average'], rows.map((r) => [r.label, wt(r), p1(r.avg)]));
  return rowsChart({
    cls: 'comps', title: 'Components', note: 'average of the marked items',
    table, rows: rows.map((r) => ({ ...r, sub: wt(r), right: r.avg === null || r.avg === undefined ? 'no marks' : p1(r.avg),
      rightCls: r.avg === null || r.avg === undefined ? 'muted' : '' })),
    rowH: 26, max: vals.length ? Math.max(...vals) : 1,
    drawRow: (g, r, x, y0) => {
      if (r.avg !== null && r.avg !== undefined) g.append(s('path', { class: 'viz-bar', d: barPath(x(0), Math.max(x(0), x(r.avg * 100)), y0 + 7, 12) }));
    },
    tipOf: (r) => ({ title: r.label, rows: [[p1(r.avg), 'average'], [wt(r), 'of the course']] }),
  });
}
