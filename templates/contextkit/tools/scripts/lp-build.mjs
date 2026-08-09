#!/usr/bin/env node
/**
 * Landing-page builder (ADR-0050) — assembles the componentized lp/ source into
 * an atomic, indexable dist/: section partials concatenated in numeric order,
 * `{{dot.path}}` tokens resolved from { config, copy, legal, build }, FAQPage
 * JSON-LD generated from the SAME copy.json the visible FAQ uses (rule 4).
 *
 *   lp-build.mjs [--dir lp] [--check] [--json]
 *
 * --check is the local gate (rule 8 — refuse-by-default): fails on any leftover
 * {{token}} or [PREENCHA] sentinel in dist/, then runs seo-audit + aiso-audit
 * against dist/ and fails on critical/high findings. Zero-dep, ROOT = cwd.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SENTINEL = '[PREENCHA]';

const readText = (path) => readFileSync(path, 'utf-8').replace(/^﻿/, '');
const readJson = (path) => JSON.parse(readText(path));

/** Resolves `a.b.0.c` against the data bag; missing → null (token stays put). */
function lookup(bag, dotPath) {
  let node = bag;
  for (const key of dotPath.split('.')) {
    if (node == null || typeof node !== 'object') return null;
    node = node[key];
  }
  return typeof node === 'string' || typeof node === 'number' ? String(node) : null;
}

function fillTokens(html, bag) {
  return html.replace(/\{\{([\w.-]+)\}\}/g, (token, dotPath) => lookup(bag, dotPath) ?? token);
}

function faqJsonLd(copy) {
  const items = (copy.faq && copy.faq.items) || [];
  if (!items.length) return '';
  const mainEntity = items.map((item) => ({
    '@type': 'Question',
    name: item.q,
    acceptedAnswer: { '@type': 'Answer', text: item.a },
  }));
  const schema = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity };
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

function assemble(srcDir, bag) {
  const sections = readdirSync(join(srcDir, 'sections')).filter((f) => f.endsWith('.html')).sort()
    .map((f) => readText(join(srcDir, 'sections', f))).join('\n');
  const partial = (name) => readText(join(srcDir, 'partials', name));
  let html = readText(join(srcDir, 'shell.html'))
    .replace('<!--LP:SECTIONS-->', sections)
    .replace('<!--LP:CONSENT-->', partial('consent.html'))
    .replace('<!--LP:GTM-->', partial('gtm.html'))
    .replace('<!--LP:JSONLD-->', partial('jsonld.html'));
  html = html.replace('<!--LP:FAQ-JSONLD-->', faqJsonLd(bag.copy));
  return fillTokens(html, bag);
}

function build(srcDir) {
  const config = readJson(join(srcDir, 'lp.config.json'));
  const copy = readJson(join(srcDir, 'content', 'copy.json'));
  const legal = readJson(join(srcDir, 'content', 'legal.json'));
  const buildDate = new Date().toISOString().slice(0, 10);
  const clientConfig = JSON.stringify({ gtmId: config.gtmId || '', webhookUrl: config.webhookUrl || '' });
  const bag = { config, copy, legal, build: { date: buildDate, clientConfig } };
  const dist = join(srcDir, config.outDir || 'dist');
  mkdirSync(dist, { recursive: true });

  writeFileSync(join(dist, 'index.html'), assemble(srcDir, bag), 'utf-8');
  for (const page of ['privacidade.html', 'termos.html']) {
    writeFileSync(join(dist, page), fillTokens(readText(join(srcDir, 'legal', page)), bag), 'utf-8');
  }
  for (const metaFile of ['robots.txt', 'llms.txt']) {
    writeFileSync(join(dist, metaFile), fillTokens(readText(join(srcDir, 'meta', metaFile)), bag), 'utf-8');
  }
  const urls = ['', 'privacidade.html', 'termos.html']
    .map((page) => `  <url><loc>${config.canonicalOrigin}/${page}</loc><lastmod>${buildDate}</lastmod></url>`)
    .join('\n');
  writeFileSync(join(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, 'utf-8');

  mkdirSync(join(dist, 'styles'), { recursive: true });
  mkdirSync(join(dist, 'js'), { recursive: true });
  for (const css of readdirSync(join(srcDir, 'styles'))) cpSync(join(srcDir, 'styles', css), join(dist, 'styles', css));
  for (const js of readdirSync(join(srcDir, 'js'))) {
    if (js !== 'tracking-models.js') cpSync(join(srcDir, 'js', js), join(dist, 'js', js)); // models are docs, not payload
  }
  return { dist, config };
}

/** Substring of the lawyer-review disclaimer — its presence in dist is asserted (ADR-0050). */
const LEGAL_DISCLAIMER = 'revise com um advogado';

/** The local gate: leftover tokens/sentinels are refusals; audits must be clean. */
function check(dist) {
  const problems = [];
  for (const file of readdirSync(dist).filter((f) => f.endsWith('.html') || f.endsWith('.txt'))) {
    const text = readText(join(dist, file));
    const tokens = [...new Set(text.match(/\{\{[\w.-]+\}\}/g) || [])];
    if (tokens.length) problems.push(`${file}: unresolved token(s) ${tokens.slice(0, 5).join(' ')}`);
    if (text.includes(SENTINEL)) problems.push(`${file}: placeholder content still present (${SENTINEL}…)`);
  }
  // ADR-0050: the lawyer-review disclaimer is "non-removable" — make that TECHNICAL,
  // not social. A legal page in dist that dropped it is a refusal, not a silent pass.
  for (const page of ['privacidade.html', 'termos.html']) {
    const path = join(dist, page);
    if (!existsSync(path)) { problems.push(`${page}: missing from dist (legal pages are mandatory, ADR-0050)`); continue; }
    if (!readText(path).includes(LEGAL_DISCLAIMER)) problems.push(`${page}: lawyer-review disclaimer removed — it is non-removable (ADR-0050)`);
  }
  for (const audit of ['seo-audit.mjs', 'aiso-audit.mjs']) {
    const result = spawnSync(process.execPath, [join(SCRIPTS_DIR, audit), '--json'], { cwd: dist, encoding: 'utf-8' });
    let findings = [];
    try { findings = JSON.parse(result.stdout).findings || []; } catch { problems.push(`${audit}: unparseable output`); }
    for (const finding of findings.filter((f) => f.severity === 'critical' || f.severity === 'high')) {
      problems.push(`${audit}: [${finding.severity}] ${finding.code} ${finding.file || ''}`);
    }
  }
  return problems;
}

function main() {
  const argv = process.argv.slice(2);
  const dirFlag = argv.indexOf('--dir');
  const srcDir = resolve(ROOT, dirFlag !== -1 && argv[dirFlag + 1] ? argv[dirFlag + 1] : 'lp');
  if (!existsSync(join(srcDir, 'shell.html'))) {
    console.error(`✖ no landing source at ${srcDir} — run lp-scaffold.mjs first`);
    process.exit(1);
  }
  const { dist } = build(srcDir);
  const problems = argv.includes('--check') ? check(dist) : [];
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ dist, checked: argv.includes('--check'), problems }, null, 2));
  } else {
    console.log(`🏗️  Built ${dist}`);
    for (const problem of problems) console.log(`  ✗ ${problem}`);
    if (argv.includes('--check') && !problems.length) console.log('  ✓ check passed — no leftover tokens, audits clean');
  }
  process.exit(problems.length ? 1 : 0);
}

main();
