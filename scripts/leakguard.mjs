#!/usr/bin/env node
/* LeakGuard: run before every push (.githooks/pre-push) — `node scripts/leakguard.mjs`.
 * Fails (exit 1) if the repo or the commits about to be pushed contain:
 *   1. forbidden files (spreadsheets, CSV, PDFs, databases, seed/backup files, .dev.vars / .env, program.json),
 *   2. secrets (OAuth client secrets, private keys, GitHub/Cloudflare tokens, "secret = '...'" assignments),
 *   3. trackers or third-party code on the page (analytics, tag managers, CDNs, web fonts),
 *   4. real data: fingerprints of Aidan's private Gradebook (its course codes and IDs), read at RUN TIME from the local
 *      Gradebook checkout and from the untracked .leakguard.local.txt — the fingerprint list itself is never committed,
 *   5. unsafe deploy config (workers_dev / preview_urls on, extra routes).
 * Fails CLOSED: without the fingerprint source (../Gradebook/program/program.json, or LEAKGUARD_GRADEBOOK) it exits 2,
 * because a "pass" that never compared against the real data would mean nothing.
 * Options:
 *   --staged       also scan the staged versions of changed files
 *   --range <a..b> commit messages + added lines of that range (the pre-push hook passes the pushed range)
 *   --ci           Workers Builds build command (no private checkout there): skips the personal fingerprints and the
 *                  commit-history scan; still checks files, secrets, tokens, trackers, third-party URLs and deploy config.
 * Exit codes: 0 pass, 1 leak found, 2 cannot check (fingerprint source missing). */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const args = process.argv.slice(2);
const range = args.includes('--range') ? args[args.indexOf('--range') + 1] : null;
const CI = args.includes('--ci');

const problems = [];
const warnings = [];
const fail = (what, where) => problems.push(`${what}${where ? `  [${where}]` : ''}`);

// ---------- 1. forbidden files ----------
function walk(dir, rel = '') {  // CI fallback if git metadata is unavailable
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '.wrangler'].includes(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r)); else out.push(r);
  }
  return out;
}
let files;
try { files = git('ls-files', '-z').split('\0').filter(Boolean); }
catch (e) { if (!CI) throw e; files = walk(ROOT); warnings.push('git unavailable: scanned the working tree instead'); }
const FORBIDDEN = [
  [/\.(xlsx|xlsm|xls|csv|pdf|sqlite3?|db)$/i, 'spreadsheet / CSV / PDF / database file'],
  [/(^|\/)~\$/, 'Office lock file'],
  [/(^|\/)seed[^/]*\.(sql|json)$/i, 'seed file'],
  [/(^|\/)program\.json$/i, 'program.json (private program data)'],
  [/(^|\/)(\.dev\.vars|\.env(\..*)?)$/, 'secrets file'],
  [/(^|\/)\.leakguard\.local\.txt$/, 'LeakGuard fingerprint list'],
  [/transcript/i, 'transcript'],
  [/gradecalc-backup/i, 'a user backup export'],
  [/(^|\/)\.wrangler\//, '.wrangler state (local D1 data)'],
];
for (const f of files) for (const [re, why] of FORBIDDEN) if (re.test(f)) fail(`forbidden file: ${why}`, f);

// ---------- 2–4. content scans ----------
const SECRETS = [
  [/GOCSPX-[A-Za-z0-9_-]{10,}/, 'Google OAuth client secret'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS key'],
  [/\b[A-Za-z0-9_~.-]{3}8Q~[A-Za-z0-9_~.-]{31,}/, 'Microsoft (Entra) client secret'],
  [/(?:secret|password|passwd|api[_-]?key|client[_-]?secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9+/_~.=-]{16,}["']/i, 'hard-coded secret value'],
];
const TRACKERS = [
  /google-analytics\.com|googletagmanager\.com|gtag\(|\bga\(['"]create/i, /doubleclick|facebook\.net|connect\.facebook|fbq\(/i,
  /plausible\.io|umami|matomo|segment\.(io|com)|mixpanel|amplitude|hotjar|clarity\.ms|posthog|sentry(-cdn)?\.io|newrelic|datadog/i,
  /cloudflareinsights\.com|beacon\.min\.js/i,
  /fonts\.(googleapis|gstatic)\.com|use\.typekit|cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|code\.jquery|cdn\.sheetjs\.com\/[^\s"']*\.js/i,
];
// Links the page may contain (navigation only — none are loaded automatically). Sign-in providers are redirect targets.
const ALLOWED_HOSTS = new Set([
  'aidanwbrown.com', 'gradecalc.aidanwbrown.com', 'github.com', 'www.linkedin.com', 'buymeacoffee.com',
  'accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'login.microsoftonline.com', 'graph.microsoft.com',
  'www.uwindsor.ca', 'uwindsor.ca', 'sheetjs.com', 'docs.sheetjs.com', 'cdn.sheetjs.com', 'git.sheetjs.com',
  'www.w3.org', 'developers.cloudflare.com', 'dash.cloudflare.com', 'console.cloud.google.com', 'entra.microsoft.com', 'portal.azure.com',
]);

// Fingerprints of real data: never in the repo, gathered at run time.
const fingerprints = new Set();
const GRADEBOOK = process.env.LEAKGUARD_GRADEBOOK || path.resolve(ROOT, '../Gradebook');
const programPath = path.join(GRADEBOOK, 'program/program.json');
if (CI) {
  warnings.push('--ci: personal fingerprints and commit history skipped (no private checkout here); the pre-push hook checks them');
} else if (!existsSync(programPath)) {
  console.log(`LeakGuard ERROR: fingerprint source not found: ${programPath}`);
  console.log('Clone UWinAidan/Gradebook next to this repo or set LEAKGUARD_GRADEBOOK to its folder. (--ci is for Workers Builds only.)');
  console.log('LeakGuard could not check for real data: do not push.');
  process.exit(2);
} else {
  const raw = readFileSync(programPath, 'utf8');
  for (const m of raw.matchAll(/\b[A-Z]{3,4}[- ]?\d{4}\b/g)) {
    fingerprints.add(m[0]); fingerprints.add(m[0].replace(/[- ]/, '')); fingerprints.add(m[0].replace(/[- ]/, '-')); fingerprints.add(m[0].replace(/[- ]/, ' '));
  }
  if (fingerprints.size === 0) { console.log(`LeakGuard ERROR: no course codes found in ${programPath}: do not push.`); process.exit(2); }
  const p = path.join(GRADEBOOK, 'wrangler.jsonc');  // the private Gradebook's resource IDs
  if (existsSync(p)) for (const m of readFileSync(p, 'utf8').matchAll(/"(database_id|ACCESS_AUD)"\s*:\s*"([^"]{16,})"/g)) fingerprints.add(m[2]);
}
const localList = path.join(ROOT, '.leakguard.local.txt');
if (CI) { /* the personal list lives only on Aidan's machine */ } else if (existsSync(localList)) {
  for (const line of readFileSync(localList, 'utf8').split(/\r?\n/)) { const s = line.trim(); if (s && !s.startsWith('#')) fingerprints.add(s); }
} else warnings.push('no .leakguard.local.txt (optional: one private string per line, e.g. names or exact marks to never commit)');
const fpList = [...fingerprints].filter((s) => s.length >= 4);
const SELF = 'scripts/leakguard.mjs';

function scanText(text, where, { isPage = false, isVendor = false } = {}) {
  for (const [re, why] of SECRETS) if (re.test(text)) fail(`possible ${why}`, where);
  if (!isVendor) {
    for (const s of fpList) if (text.includes(s)) fail(`real-data fingerprint "${s.slice(0, 3)}…" (from Gradebook / local list)`, where);
  }
  if (isPage && !isVendor) {
    for (const re of TRACKERS) if (re.test(text)) fail(`tracker / third-party code (${re.source.slice(0, 40)}…)`, where);
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (!ALLOWED_HOSTS.has(host) && !host.endsWith('.localhost') && host !== 'localhost' && host !== '127.0.0.1') fail(`unlisted external host ${host}`, where);
    }
    // anything the page would load by itself must be same-origin
    for (const m of text.matchAll(/<(script|link|img|iframe|source|video|audio|object|embed)\b[^>]*\b(src|href|data)\s*=\s*["'](https?:)?\/\/[^"']+["'][^>]*>/gi)) {
      fail(`page loads an external resource: ${m[0].slice(0, 80)}`, where);
    }
    if (/\b(fetch|importScripts|import)\s*\(\s*["'`]https?:/i.test(text) || /\bimport\s[^;]*from\s*["']https?:/i.test(text)) fail('page code fetches/imports from another origin', where);
  }
}

for (const f of files) {
  if (f === SELF || /\.(png|jpg|jpeg|gif|ico|woff2?)$/i.test(f)) continue;
  let text;
  try { text = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }  // deleted in the working tree
  scanText(text, f, { isPage: f.startsWith('site/'), isVendor: f.startsWith('site/vendor/') });
}
if (args.includes('--staged')) {
  for (const f of git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean)) {
    if (f === SELF) continue;
    try { scanText(git('show', `:${f}`), `staged ${f}`, { isPage: f.startsWith('site/'), isVendor: f.startsWith('site/vendor/') }); } catch { /* deleted */ }
  }
}

// Commits about to be pushed: messages and every added line (catches data that was committed and then removed again).
const pushRange = CI ? null : range || (() => { try { git('rev-parse', '--verify', '@{u}'); return '@{u}..HEAD'; } catch { return 'HEAD'; } })();
if (!CI) try {
  const log = git('log', '--format=%H%n%B', pushRange);
  scanText(log, `commit messages ${pushRange}`);
  const added = git('log', '-p', '--format=', pushRange, '--', '.', `:!${SELF}`, ':!site/vendor/')
    .split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n');
  scanText(added, `added lines in ${pushRange}`);
} catch { /* no commits yet */ }

// ---------- 5. deploy config ----------
const wr = readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
if (!/"workers_dev"\s*:\s*false/.test(wr)) fail('wrangler.jsonc: workers_dev must be false');
if (!/"preview_urls"\s*:\s*false/.test(wr)) fail('wrangler.jsonc: preview_urls must be false');
const routes = [...wr.matchAll(/"pattern"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
if (routes.length !== 1 || routes[0] !== 'gradecalc.aidanwbrown.com') fail(`wrangler.jsonc: routes must be only gradecalc.aidanwbrown.com (found ${routes.join(', ') || 'none'})`);
if (!/"database_name"\s*:\s*"gradecalc"/.test(wr)) fail('wrangler.jsonc: D1 must be the separate "gradecalc" database');

// ---------- report ----------
for (const w of warnings) console.log('WARN  ' + w);
console.log(CI ? `LeakGuard --ci: ${files.length} files (personal fingerprints skipped)`
  : `LeakGuard: ${files.length} tracked files, ${fpList.length} real-data fingerprints, range ${pushRange}`);
if (problems.length) {
  for (const p of problems) console.log('FAIL  ' + p);
  console.log(`LeakGuard FAILED (${problems.length}). Do not push.`);
  process.exit(1);
}
console.log('LeakGuard PASS');
