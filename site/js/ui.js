// Small DOM helpers: element builder, number formatting, inline editor, dialogs and toasts. No framework.
// Ported from Gradebook; marks can also be typed as a letter (A+, B-), which counts as an estimate.
import { letterToPct } from './calc.js';

/** h('div', {class, text, on: {click}, ...attrs}, ...children). Text is always set as text (never HTML). */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, kids);
  return el;
}
/** Replace an element's children; null/false are skipped and arrays flattened (unlike replaceChildren). */
export function fill(el, ...kids) {
  el.replaceChildren();
  append(el, kids);
  return el;
}
function append(el, kids) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

// ---- formatting ----
export const pct = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`);
export const num = (v) => (v === null || v === undefined ? '' : String(Math.round(v * 1000) / 1000));
export const gpaText = (g) => (g === null || g === undefined ? '—' : g === 'Fail' ? 'Fail' : g.toFixed(1));
export const when = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/**
 * Parse what was typed for a mark. `item` gives the current out_of.
 *   ""      → not marked        "17/20" → 17 out of 20       "85%" → 85% of out_of
 *   "17"    → 17 points when out_of ≠ 1, otherwise 17%     "B+" → a letter only (estimated as the middle of its range)
 * Returns {mark, out_of, letter} or {error}; {warn} when above 120%.
 */
export function parseMark(text, outOf = 1) {
  const s = String(text).trim().replace(',', '.');
  if (s === '' || s === '-' || s === '—') return { mark: null, out_of: outOf, letter: null };
  if (/^[a-f][+-]?$/i.test(s)) {
    return letterToPct(s) === null ? { error: 'Letters: A+ to D-, or F' } : { mark: null, out_of: outOf, letter: s.toUpperCase() };
  }
  let m, mark, out = outOf;
  if ((m = s.match(/^(\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/))) { mark = Number(m[1]); out = Number(m[2]); }
  else if ((m = s.match(/^(\d*\.?\d+)\s*%$/))) mark = (Number(m[1]) / 100) * outOf;
  else if ((m = s.match(/^\d*\.?\d+$/))) mark = outOf === 1 ? Number(s) / 100 : Number(s);
  else return { error: 'Type 85, 85%, 17/20 or a letter (B+)' };
  if (!(out > 0)) return { error: '“Out of” must be more than 0' };
  if (!(mark >= 0)) return { error: 'Mark can’t be negative' };
  const ratio = mark / out;
  if (ratio > 5) return { error: 'More than 500%: typo?' };
  return { mark: round6(mark), out_of: round6(out), letter: null, warn: ratio > 1.2 ? `That’s ${(ratio * 100).toFixed(1)}%` : null };
}
const round6 = (x) => Math.round(x * 1e6) / 1e6;

export const markText = (a) => {
  if ((a.mark === null || a.mark === undefined) && a.letter) return a.letter;
  if (a.mark === null || a.mark === undefined) return '—';
  if (a.out_of === 1) return pct(a.mark, 1);
  return `${num(a.mark)} / ${num(a.out_of)}`;
};

// ---- inline editor ----
// Click → input; Enter or leaving the field saves, Esc cancels. `parse(text)` → {value} | {error} | {warn}.
// A warning needs a second Enter. While an editor is open the app holds re-renders (onOpen / onClose).
export const editorHooks = { onOpen: () => {}, onClose: () => {} };

export function editable({ text, edit, parse, save, cls = '', placeholder = '', type = 'text', label = 'Edit' }) {
  const span = h('span', { class: `ed ${cls}`, tabindex: '0', role: 'button', 'aria-label': label, text: text || '—' });
  const open = (ev) => {
    if (ev) { ev.stopPropagation(); ev.preventDefault(); }
    if (span.dataset.open) return;
    span.dataset.open = '1';
    editorHooks.onOpen();
    const input = h('input', { class: 'ed-input', type, value: edit ?? '', placeholder, 'aria-label': label,
      inputmode: type === 'text' && cls.includes('mark') ? 'decimal' : null });
    const msg = h('span', { class: 'ed-msg' });
    const wrap = h('span', { class: 'ed-wrap' }, input, msg);
    span.replaceWith(wrap);
    input.focus();
    input.select();
    let confirmed = null, done = false;
    const close = () => {
      if (done) return;
      done = true;
      wrap.replaceWith(span);
      delete span.dataset.open;
      editorHooks.onClose();
    };
    const commit = (fromBlur) => {
      if (done) return;
      if (input.value === String(edit ?? '')) return close();
      const r = parse ? parse(input.value) : { value: input.value };
      if (r.error) {
        msg.textContent = r.error; msg.className = 'ed-msg err'; input.classList.add('err');
        if (fromBlur) close();
        return;
      }
      if (r.warn && confirmed !== input.value) {
        if (fromBlur) return close();
        confirmed = input.value;
        msg.textContent = `${r.warn}. Enter again to save.`; msg.className = 'ed-msg';
        return;
      }
      close();
      save(r.value);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(false); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('blur', () => setTimeout(() => commit(true), 0));
    input.addEventListener('click', (e) => e.stopPropagation());
  };
  span.addEventListener('click', open);
  span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  return span;
}

// ---- toasts ----
export function toast(message, { action, error = false, timeout = 5000 } = {}) {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast${error ? ' err' : ''}`, role: error ? 'alert' : 'status' }, h('span', { text: message }));
  let timer;
  const close = () => { clearTimeout(timer); t.remove(); };
  if (action) {
    t.append(h('button', { class: 'link', type: 'button', text: action.label, on: { click: () => { close(); action.fn(); } } }));
  }
  t.append(h('button', { class: 'link', type: 'button', 'aria-label': 'Dismiss', text: '×', on: { click: close } }));
  box.append(t);
  timer = setTimeout(close, action ? Math.max(timeout, 8000) : timeout);
  return close;
}

// ---- dialogs (native <dialog>; never alert/confirm) ----
export function openDialog(id, ...content) {
  const d = document.getElementById(id);
  fill(d, content);
  if (!d.open) d.showModal();
  return d;
}
export function closeDialog(id) {
  const d = document.getElementById(id);
  if (d.open) d.close();
}
for (const id of ['dlg', 'sheet', 'drawer']) {
  // Click on the backdrop closes.
  document.getElementById(id)?.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
}

export function confirmDialog(title, body, okLabel = 'OK', { danger = false } = {}) {
  return new Promise((resolve) => {
    const d = document.getElementById('dlg');
    const done = (v) => { d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(v); };
    const onClose = () => done(false);
    openDialog('dlg',
      h('h2', { text: title }),
      body ? h('div', { class: 'muted' }, body) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', text: 'Cancel', on: { click: () => done(false) } }),
        h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', text: okLabel, on: { click: () => done(true) } })));
    d.addEventListener('close', onClose);
  });
}
