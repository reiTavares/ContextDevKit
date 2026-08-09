/**
 * Shared helpers for the SEO + AISO audit scripts (ADR-0025).
 *
 * - `walkProject(root, exts)` — recursive file walk that skips the usual
 *   noise (`node_modules`, `.git`, `dist`, `build`, framework caches).
 * - `detectFramework(root)` — reads package.json and reports the
 *   rendering posture (`astro`, `next`, `nuxt`, `remix`, `sveltekit`,
 *   `vite-react`, or `null`).
 * - `lineOf(text, idx)` — 1-based line number for a regex match index.
 * - `renderFindings(findings)` — pretty terminal output, grouped by
 *   severity. JSON output handled by the calling script.
 *
 * Zero deps. Defensive: any failure returns a safe default (empty
 * array, `null` framework) — rule 2.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const SKIP_DIRS = /(^|[\\/])(node_modules|\.git|dist|build|out|\.next|\.astro|\.nuxt|\.svelte-kit|\.cache|coverage|\.vercel|\.netlify|\.turbo)([\\/]|$)/;

/**
 * Walk a directory recursively yielding files with one of the given
 * extensions. Skips noise dirs. Defensive — unreadable subdirs are
 * silently skipped.
 *
 * @param {string}   root
 * @param {string[]} exts  e.g. ['.html', '.astro', '.jsx']
 */
export function* walkProject(root, exts) {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (SKIP_DIRS.test(full)) continue;
      if (e.isDirectory()) stack.push(full);
      else if (exts.includes(extname(e.name))) yield full;
    }
  }
}

/**
 * Best-effort framework detection from package.json. The result drives
 * the SPA_ENTRYPOINT refusal in seo-audit.
 *
 * @param {string} root
 * @returns {'astro' | 'next' | 'nuxt' | 'remix' | 'sveltekit' | 'vite-react' | 'gatsby' | 'eleventy' | null}
 */
export function detectFramework(root) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8').replace(/^﻿/, ''));
  } catch { return null; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.astro) return 'astro';
  if (deps.next) return 'next';
  if (deps.nuxt) return 'nuxt';
  if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.gatsby) return 'gatsby';
  if (deps['@11ty/eleventy']) return 'eleventy';
  if (deps.vite && (deps.react || deps['react-dom'])) return 'vite-react';
  return null;
}

/** True when the detected framework leaves the user responsible for SSR/SSG wiring. */
export const isSpaFramework = (fw) => fw === 'vite-react' || fw === null;

/** True when the detected framework ships SSG / SSR by default. */
export const isIndexableFramework = (fw) =>
  fw === 'astro' || fw === 'next' || fw === 'nuxt' || fw === 'remix' ||
  fw === 'sveltekit' || fw === 'gatsby' || fw === 'eleventy';

/**
 * 1-based line number for the character at `idx` in `text`.
 *
 * @param {string} text
 * @param {number} idx
 * @returns {number}
 */
export function lineOf(text, idx) {
  if (idx <= 0) return 1;
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const SEV_ORDER = ['critical', 'high', 'medium', 'low'];
const SEV_LABEL = {
  critical: '\x1b[31mCRITICAL\x1b[0m',
  high:     '\x1b[33mHIGH    \x1b[0m',
  medium:   '\x1b[36mMEDIUM  \x1b[0m',
  low:      '\x1b[90mLOW     \x1b[0m',
};

/**
 * Render findings as a coloured terminal table grouped by severity.
 *
 * @param {Array<{ code:string, file:string, line:number, severity:string, message:string }>} findings
 * @param {object} opts
 * @param {string} opts.title
 * @returns {string}
 */
export function renderFindings(findings, { title }) {
  if (!findings.length) {
    return `\n🔍 ${title}\n   ✅ no findings — all checks passed.\n`;
  }
  const bySev = Object.fromEntries(SEV_ORDER.map((s) => [s, []]));
  for (const f of findings) (bySev[f.severity] || bySev.medium).push(f);
  const lines = [`\n🔍 ${title}`, `   ${findings.length} finding${findings.length === 1 ? '' : 's'}\n`];
  for (const sev of SEV_ORDER) {
    if (!bySev[sev].length) continue;
    lines.push(`   ${SEV_LABEL[sev]} (${bySev[sev].length})`);
    for (const f of bySev[sev]) {
      const loc = f.line ? `:${f.line}` : '';
      lines.push(`     ${f.code.padEnd(22, ' ')} ${f.file}${loc}`);
      if (f.message) lines.push(`       ↳ ${f.message}`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

/** Convenience: exit code from findings (1 if any critical, 0 otherwise). */
export const exitCodeFor = (findings) =>
  findings.some((f) => f.severity === 'critical') ? 1 : 0;
