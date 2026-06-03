#!/usr/bin/env node
/**
 * SEO audit — static analyser for classical SEO smells (ADR-0025).
 *
 * Walks the project for page-shaped files (`.html`, `.astro`, `.jsx`,
 * `.tsx`, `.vue`, `.svelte`, `.mdx`), checks each against the SEO
 * checklist in `vibekit/workflows/playbooks/seo-aiso.md`, and emits
 * findings as either a coloured terminal table (default) or JSON
 * (`--json`).
 *
 * Exit code 1 when any `critical` finding is present (currently only
 * SPA_ENTRYPOINT) — so CI can gate on it. Exit code 0 otherwise.
 *
 * Zero deps. Defensive (rule 2 — never break the dev loop).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { detectFramework, isSpaFramework, lineOf, renderFindings, exitCodeFor, walkProject } from './audit-shared.mjs';

const PAGE_EXTS = ['.html', '.astro', '.jsx', '.tsx', '.vue', '.svelte', '.mdx'];

const SEVERITY = {
  SPA_ENTRYPOINT:      'critical',
  MISSING_TITLE:       'high',
  MISSING_DESCRIPTION: 'high',
  MULTIPLE_H1:         'high',
  MISSING_CANONICAL:   'medium',
  MISSING_ALT:         'medium',
  MISSING_SITEMAP:     'high',
  MISSING_ROBOTS:      'medium',
};

const finding = (rel) => (code, line, message) =>
  ({ file: rel, code, line, severity: SEVERITY[code] || 'medium', message });

/** Project-level checks: presence of sitemap.xml, robots.txt, SPA entry-point smell. */
function checkProject(root, framework) {
  const out = [];
  const sitemapPaths = ['sitemap.xml', 'public/sitemap.xml', 'static/sitemap.xml', 'src/pages/sitemap.xml.ts'];
  const robotsPaths  = ['robots.txt',  'public/robots.txt',  'static/robots.txt'];
  if (!sitemapPaths.some((p) => existsSync(resolve(root, p)))) {
    out.push({ file: 'public/sitemap.xml', code: 'MISSING_SITEMAP', line: 0, severity: SEVERITY.MISSING_SITEMAP, message: 'no sitemap.xml found at root, public/, or static/' });
  }
  if (!robotsPaths.some((p) => existsSync(resolve(root, p)))) {
    out.push({ file: 'public/robots.txt', code: 'MISSING_ROBOTS', line: 0, severity: SEVERITY.MISSING_ROBOTS, message: 'no robots.txt found at root, public/, or static/' });
  }
  const indexHtml = resolve(root, 'index.html');
  if (existsSync(indexHtml)) {
    let html = '';
    try { html = readFileSync(indexHtml, 'utf8'); } catch { /* defensive */ }
    const emptyRoot = /<div\s+id=["'](root|app|__next|___gatsby)["']\s*>\s*<\/div>/i.test(html);
    if (emptyRoot && isSpaFramework(framework)) {
      out.push({
        file: 'index.html',
        code: 'SPA_ENTRYPOINT',
        line: 1,
        severity: SEVERITY.SPA_ENTRYPOINT,
        message: 'empty <div id="root"></div> with no SSG/SSR framework detected — landing pages must be indexable. Pick Astro (recommended) or Next App Router; see ADR-0025.',
      });
    }
  }
  return out;
}

/** Per-file checks. The `<title>` / `<meta description>` / canonical checks fire only for HTML-shaped files. */
function checkFile(file, text, rel) {
  const f = finding(rel);
  const out = [];
  const isHtmlLike = /\.(html|astro)$/i.test(file);

  if (isHtmlLike) {
    if (!/<title>\s*[^<\s][^<]*<\/title>/i.test(text)) {
      out.push(f('MISSING_TITLE', 1, 'no <title> in head, or <title> is empty'));
    }
    if (!/<meta\s+[^>]*name=["']description["'][^>]*content=["'][^"']{20,}["']/i.test(text)) {
      out.push(f('MISSING_DESCRIPTION', 1, 'no <meta name="description"> with at least 20 chars of content'));
    }
    if (!/<link\s+[^>]*rel=["']canonical["']/i.test(text)) {
      out.push(f('MISSING_CANONICAL', 1, 'no <link rel="canonical"> — Google may pick a wrong canonical'));
    }
  }

  const h1s = [...text.matchAll(/<h1[\s>]/gi)];
  if (h1s.length > 1) {
    out.push(f('MULTIPLE_H1', lineOf(text, h1s[1].index), `${h1s.length} <h1> tags found; only one per page is allowed`));
  }

  for (const m of text.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = m[1];
    if (!/\balt\s*=/i.test(attrs)) {
      out.push(f('MISSING_ALT', lineOf(text, m.index), '<img> without alt — refuses screen readers and SEO'));
    }
  }
  return out;
}

/**
 * Run the SEO audit against a project root.
 *
 * @param {string} root  absolute path
 * @returns {{ framework: string | null, findings: object[] }}
 */
export function runSeoAudit(root) {
  const framework = detectFramework(root);
  const findings = [...checkProject(root, framework)];
  for (const file of walkProject(root, PAGE_EXTS)) {
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = relative(root, file).replaceAll('\\', '/');
    findings.push(...checkFile(file, text, rel));
  }
  return { framework, findings };
}

const argv = process.argv.slice(2);
const wantJson = argv.includes('--json');
const wantHelp = argv.includes('--help') || argv.includes('-h');

const isMain = (() => {
  try {
    const here = new URL(import.meta.url).pathname.toLowerCase();
    const entry = process.argv[1]
      ? new URL('file://' + process.argv[1].replace(/\\/g, '/')).pathname.toLowerCase()
      : '';
    return here === entry;
  } catch { return false; }
})();

if (isMain) {
  if (wantHelp) {
    process.stdout.write(`Usage: seo-audit.mjs [--json]

Scans the project for SEO smells per ADR-0025. Exit code 1 on any
critical finding (currently only SPA_ENTRYPOINT) so CI can gate.

  --json   emit findings as JSON to stdout (machine-readable)
  --help   this message
`);
    process.exit(0);
  }
  const root = process.cwd();
  const result = runSeoAudit(root);
  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(`\n   Framework detected: ${result.framework || 'none (plain HTML or unknown)'}`);
    process.stdout.write(renderFindings(result.findings, { title: 'SEO audit' }));
  }
  process.exit(exitCodeFor(result.findings));
}
