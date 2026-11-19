// Guest mode: the whole gradebook is one JSON document in this browser's localStorage. Nothing is sent anywhere.
// The document mirrors Gradebook's tables (terms, courses, components, assessments) plus repeats and settings, so
// calc.js reads it directly. It is the same document an account will sync later (Round 5).
// `api` has the same shape as Gradebook's server API (create / patch / remove / restore / deleted / audit), so the page
// code works the same way. Deletes are soft (deleted_at) so "Recently deleted" can restore them; history is an audit
// list inside the document. Both are capped.

const KEY = 'gc-gradebook';
const SCHEMA = 1;
const AUDIT_MAX = 1000;
const DELETED_DAYS = 30;

/** Fields each kind of row can have, with their defaults (anything else is dropped). */
export const FIELDS = {
  terms: { name: '', season: null, year: null, year_of_study: null, archived: 0, sort_order: 0 },
  courses: {
    term_id: null, code: null, title: '', short_name: null, credits: 3, type: 'graded', pass_result: null, status: 'active',
    curve: null, cap_100: 0, final_override: null, final_letter: null, notes: null, sort_order: 0,
  },
  components: {
    course_id: null, parent_id: null, name: '', weight: 0, is_bonus: 0, drop_so_far: 0, drop_average: 0, aggregation: 'mean',
    projected: null, rule: null, excused_to: null, sort_order: 0,
  },
  assessments: {
    component_id: null, name: '', mark: null, out_of: 1, letter: null, item_weight: null, counts_in: 'both', excused: 0,
    curve: null, projected: null, date: null, sort_order: 0,
  },
  repeats: { course_ids: [], policy: null },
};
export const ENTITIES = Object.keys(FIELDS);
export const DEFAULT_SETTINGS = { gpa_scale: 'uwindsor', custom_scale: null, repeat_policy_default: 'best', default_credits: 3 };
const PARENT = { courses: ['terms', 'term_id'], components: ['courses', 'course_id'], assessments: ['components', 'component_id'] };

export class StoreError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; this.body = {}; }
}

const now = () => new Date().toISOString();
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function emptyDoc() {
  const d = { schema: SCHEMA, next_id: 1, settings: { ...DEFAULT_SETTINGS }, audit: [] };
  for (const e of ENTITIES) d[e] = [];
  return d;
}

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const goodId = (v) => Number.isSafeInteger(v) && v > 0;
const MAX_TEXT = 2000;

/** One field value, coerced to the type of its default: text, number, id list, or (default null) a number, text or object. */
function coerce(def, v) {
  if (v === undefined) return clone(def);
  if (Array.isArray(def)) return Array.isArray(v) ? v.filter(goodId).slice(0, 50) : [];
  if (typeof def === 'string') return typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, MAX_TEXT) : def;
  if (typeof def === 'number') { const n = typeof v === 'boolean' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : def; }
  if (v === null || (typeof v === 'number' && Number.isFinite(v))) return v;
  if (typeof v === 'string') return v.slice(0, MAX_TEXT);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (isPlain(v) || Array.isArray(v)) { const s = JSON.stringify(v); return s.length <= 20000 ? JSON.parse(s) : null; }
  return null;
}
/** Only the known fields of one kind of row, each coerced (own keys only: "__proto__" and friends never pass). */
function cleanRow(entity, r) {
  const out = {};
  for (const [k, def] of Object.entries(FIELDS[entity])) out[k] = coerce(def, own(r, k) ? r[k] : undefined);
  return out;
}
function cleanSettings(raw) {
  const s = { ...DEFAULT_SETTINGS };
  if (!isPlain(raw)) return s;
  if (typeof raw.gpa_scale === 'string' && /^[a-z0-9_]{1,30}$/.test(raw.gpa_scale)) s.gpa_scale = raw.gpa_scale;
  if (['best', 'latest', 'all'].includes(raw.repeat_policy_default)) s.repeat_policy_default = raw.repeat_policy_default;
  const cr = Number(raw.default_credits);
  if (Number.isFinite(cr) && cr >= 0 && cr <= 30) s.default_credits = cr;
  const cs = raw.custom_scale;
  if (isPlain(cs) && Array.isArray(cs.bands) && cs.bands.length <= 40) {
    const bands = cs.bands.filter(isPlain).map((b) => ({
      min: Math.min(1.5, Math.max(0, Number(b.min) || 0)), letter: String(b.letter ?? '').slice(0, 4),
      points: b.points === null || b.points === undefined || !Number.isFinite(Number(b.points)) ? null : Number(b.points) }));
    s.custom_scale = { name: 'Custom', kind: cs.kind === 'percent' ? 'percent' : 'points', max: Number.isFinite(Number(cs.max)) ? Number(cs.max) : null, bands };
  }
  return s;
}

/** Bring any stored or imported document to the current shape (unknown fields dropped, types checked, defaults filled in). */
export function normalize(raw) {
  const d = emptyDoc();
  if (!isPlain(raw)) return d;
  let maxId = 0;
  const seen = new Set();
  for (const e of ENTITIES) {
    for (const r of Array.isArray(raw[e]) ? raw[e] : []) {
      if (!isPlain(r) || !goodId(r.id) || seen.has(r.id)) continue;
      seen.add(r.id);
      const row = { id: r.id, ...cleanRow(e, r) };
      row.version = goodId(r.version) ? r.version : 1;
      row.created_at = typeof r.created_at === 'string' ? r.created_at.slice(0, 40) : now();
      row.updated_at = typeof r.updated_at === 'string' ? r.updated_at.slice(0, 40) : row.created_at;
      row.deleted_at = typeof r.deleted_at === 'string' ? r.deleted_at.slice(0, 40) : null;
      d[e].push(row);
      maxId = Math.max(maxId, r.id);
    }
  }
  const next = Number(raw.next_id);
  d.next_id = Math.max(maxId + 1, goodId(next) && next < Number.MAX_SAFE_INTEGER / 2 ? next : 1);
  d.settings = cleanSettings(raw.settings);
  const pickAudit = (e, v) => (isPlain(v) && own(FIELDS, e) ? { id: Number(v.id) || 0, ...cleanRow(e, v) } : isPlain(v) && e === 'settings' ? cleanSettings(v) : null);
  d.audit = (Array.isArray(raw.audit) ? raw.audit.slice(-AUDIT_MAX) : []).filter(isPlain).map((a) => ({
    at: typeof a.at === 'string' ? a.at.slice(0, 40) : now(),
    action: ['create', 'update', 'delete', 'restore'].includes(a.action) ? a.action : 'update',
    entity: typeof a.entity === 'string' ? a.entity.slice(0, 20) : '',
    entity_id: Number.isSafeInteger(a.entity_id) ? a.entity_id : 0,
    course_id: goodId(a.course_id) ? a.course_id : null,
    before: pickAudit(a.entity, a.before), after: pickAudit(a.entity, a.after),
  }));
  return d;
}

// ---------------------------------------------------------------- persistence
let doc = null;
const listeners = new Set();

function read() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? normalize(JSON.parse(s)) : emptyDoc();
  } catch {
    return emptyDoc();
  }
}
function load() {
  if (!doc) { doc = read(); purge(); }
  return doc;
}
function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc));
  } catch (e) {
    throw new StoreError(e && e.name === 'QuotaExceededError' ? 'This browser’s storage is full' : 'This browser won’t let the page save (private mode?)', 507);
  }
}
/** Rows deleted more than 30 days ago go for good, with everything under them. */
function purge() {
  const cutoff = Date.now() - DELETED_DAYS * 864e5;
  let changed = false;
  for (const e of ENTITIES) {
    const keep = doc[e].filter((r) => !(r.deleted_at && Date.parse(r.deleted_at) < cutoff));
    if (keep.length !== doc[e].length) { doc[e] = keep; changed = true; }
  }
  // Orphans (their parent row is gone).
  for (const e of ['courses', 'components', 'assessments']) {
    const [pe, key] = PARENT[e];
    const ids = new Set(doc[pe].map((r) => r.id));
    const keep = doc[e].filter((r) => ids.has(r[key]));
    if (keep.length !== doc[e].length) { doc[e] = keep; changed = true; }
  }
  if (changed) { try { write(); } catch { /* next save tries again */ } }
}

// Another tab changed the gradebook: reload it here too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== null) return;
    doc = read();
    for (const fn of listeners) fn();
  });
}
export const onExternalChange = (fn) => listeners.add(fn);

// ---------------------------------------------------------------- helpers
function find(entity, id) {
  if (!own(FIELDS, entity)) throw new StoreError(`Unknown kind: ${entity}`, 404);
  const row = load()[entity].find((r) => r.id === id);
  if (!row) throw new StoreError('Not found (deleted in another tab?)', 404);
  return row;
}
function courseIdOf(entity, row) {
  if (entity === 'courses') return row.id;
  if (entity === 'components') return row.course_id;
  if (entity === 'assessments') return doc.components.find((k) => k.id === row.component_id)?.course_id ?? null;
  return null;
}
function log(action, entity, row, before, after) {
  doc.audit.push({ at: now(), action, entity, entity_id: row.id, course_id: courseIdOf(entity, row), before: clone(before) ?? null, after: clone(after) ?? null });
  if (doc.audit.length > AUDIT_MAX) doc.audit.splice(0, doc.audit.length - AUDIT_MAX);
}
const pick = (entity, body) => { const all = cleanRow(entity, body || {}); return Object.fromEntries(Object.keys(body || {}).filter((k) => own(FIELDS[entity], k)).map((k) => [k, all[k]])); };
const live = (rows) => rows.filter((r) => !r.deleted_at);

// ---------------------------------------------------------------- API (same shape as Gradebook's)
export const api = {
  async all() {
    const d = load();
    const out = { settings: clone(d.settings) };
    for (const e of ENTITIES) out[e] = clone(live(d[e]));
    return out;
  },
  async create(entity, body) {
    if (!own(FIELDS, entity)) throw new StoreError(`Unknown kind: ${entity}`, 404);
    const d = load();
    const t = now();
    const row = { id: d.next_id++, ...clone(FIELDS[entity]), ...clone(pick(entity, body)), version: 1, created_at: t, updated_at: t, deleted_at: null };
    d[entity].push(row);
    log('create', entity, row, null, row);
    write();
    return clone(row);
  },
  async patch(entity, id, changes) {
    const row = find(entity, id);
    const before = clone(row);
    Object.assign(row, clone(pick(entity, changes)));
    row.version++;
    row.updated_at = now();
    log('update', entity, row, before, row);
    write();
    return clone(row);
  },
  async remove(entity, id) {
    const row = find(entity, id);
    row.deleted_at = now();
    row.version++;
    log('delete', entity, row, row, null);
    write();
    return { ok: true };
  },
  async restore(entity, id) {
    const row = find(entity, id);
    row.deleted_at = null;
    row.version++;
    log('restore', entity, row, null, row);
    write();
    return clone(row);
  },
  async deleted() {
    const d = load();
    const out = {};
    for (const e of ENTITIES) out[e] = clone(d[e].filter((r) => r.deleted_at).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)));
    return out;
  },
  async audit({ course_id, limit = 500 } = {}) {
    const d = load();
    const list = d.audit.filter((a) => course_id === undefined || a.course_id === Number(course_id));
    return { entries: clone(list.slice(-limit).reverse()) };
  },
  async settings(changes) {
    const d = load();
    const before = clone(d.settings);
    d.settings = cleanSettings({ ...d.settings, ...(isPlain(changes) ? changes : {}) });
    d.audit.push({ at: now(), action: 'update', entity: 'settings', entity_id: 0, course_id: null, before, after: clone(d.settings) });
    write();
    return clone(d.settings);
  },
  /** Replace everything (demo data, Reset everything, later: restore a backup). */
  async replace(next) {
    doc = normalize(next);
    write();
    return api.all();
  },
  /** The whole stored document (backup / sync). */
  snapshot: () => clone(load()),
  stats() {
    let bytes = 0;
    try { bytes = (localStorage.getItem(KEY) || '').length * 2; } catch { /* blocked */ }
    return { bytes };
  },
};
