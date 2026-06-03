#!/usr/bin/env node
/**
 * AISO audit — static analyser for AI Search Optimization smells (ADR-0025).
 *
 * AISO is the discoverability surface for LLM answer engines
 * (ChatGPT search, Perplexity, Claude search, Gemini). A site can rank
 * well on Google and never appear in LLM answers — this audit catches
 * the missing patterns: `llms.txt`, FAQ schema, semantic HTML5,
 * author + date stamps, and a `robots.txt` that does not block AI
 * crawlers by accident.
 *
 * Same shape as seo-audit.mjs: walks page files, emits findings,
 * supports `--json`. Zero deps. Defensive.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { lineOf, renderFindings, exitCodeFor, walkProject } from './audit-shared.mjs';

const PAGE_EXTS = ['.html', '.astro', '.jsx', '.tsx', '.vue', '.svelte', '.mdx'];

const SEVERITY = {
  MISSING_LLMS_TXT:       'high',
  MISSING_FAQ_SCHEMA:     'high',
  MISSING_ORG_SCHEMA:     'medium',
  DIV_SOUP:               'medium',
  JS_RENDERED_CONTENT:    'high',
  MISSING_AUTHOR_SCHEMA:  'low',
  MISSING_DATE_STAMP:     'low',
  BLOCKS_AI_CRAWLERS:     'high',
};

const finding = (rel) => (code, line, message) =>
  ({ file: rel, code, line, severity: SEVERITY[code] || 'medium', message });

const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'OAI-SearchBot'];

/** robots.txt smells: missing file (handled by seo-audit) and AI-crawler disallow without explicit override. */
function checkRobots(root) {
  const out = [];
  const robotsPaths = ['robots.txt', 'public/robots.txt', 'static/robots.txt'];
  const robotsPath = robotsPaths.map((p) => resolve(root, p)).find((p) => existsSync(p));
  if (!robotsPath) return out;
  let txt = '';
  try { txt = readFileSync(robotsPath, 'utf8'); } catch { return out; }
  for (const ua of AI_CRAWLERS) {
    const block = new RegExp(`User-agent:\\s*${ua}[\\s\\S]*?Disallow:\\s*/`, 'i');
    if (block.test(txt)) {
      out.push({
        file: relative(root, robotsPath).replaceAll('\\', '/'),
        code: 'BLOCKS_AI_CRAWLERS',
        line: 0,
        severity: SEVERITY.BLOCKS_AI_CRAWLERS,
        message: `robots.txt blocks ${ua}; the site will not appear in that LLM's answers. Add a project ADR if this is intentional.`,
      });
    }
  }
  return out;
}

/** llms.txt presence — the 2024-vintage AISO convention. */
function checkLlmsTxt(root) {
  const paths = ['llms.txt', 'public/llms.txt', 'static/llms.txt'];
  if (paths.some((p) => existsSync(resolve(root, p)))) return [];
  return [{
    file: 'public/llms.txt',
    code: 'MISSING_LLMS_TXT',
    line: 0,
    severity: SEVERITY.MISSING_LLMS_TXT,
    message: 'no llms.txt at root — LLM answer engines have no curated routing map. See llmstxt.org for the format.',
  }];
}

/** Per-file AISO checks: FAQ + Org schema, div-soup, JS-rendered content, author + date stamps. */
function checkFile(file, text, rel) {
  const f = finding(rel);
  const out = [];
  const isHtmlLike = /\.(html|astro)$/i.test(file);

  if (!isHtmlLike) return out;

  // FAQ schema — the load-bearing AISO move
  if (!/"@type":\s*"FAQPage"/.test(text)) {
    out.push(f('MISSING_FAQ_SCHEMA', 1, 'no FAQPage JSON-LD — LLMs cite FAQ entries near-verbatim; without it the page does not appear in answers'));
  }

  // Organization schema
  if (!/"@type":\s*"Organization"/.test(text)) {
    out.push(f('MISSING_ORG_SCHEMA', 1, 'no Organization JSON-LD — brand entity unknown to LLM rankers'));
  }

  // Author / person schema (low — only flags if completely absent)
  if (!/"@type":\s*"(Person|Article|NewsArticle)"/.test(text) && /<article/i.test(text)) {
    out.push(f('MISSING_AUTHOR_SCHEMA', 1, 'page has <article> but no Person/Article schema — LLMs weight authored content over anonymous'));
  }

  // Date stamps
  if (!/(datePublished|dateModified|article:modified_time)/i.test(text)) {
    out.push(f('MISSING_DATE_STAMP', 1, 'no published/modified timestamp — LLMs care about recency'));
  }

  // Div soup: ratio of <div> to semantic HTML5 tags
  const divs = (text.match(/<div[\s>]/gi) || []).length;
  const semantic = (text.match(/<(article|section|nav|main|aside|header|footer)[\s>]/gi) || []).length;
  if (divs > 5 && semantic > 0 && divs / Math.max(semantic, 1) > 5) {
    out.push(f('DIV_SOUP', 1, `${divs} <div> to ${semantic} semantic tags (ratio ${(divs / semantic).toFixed(1)}:1) — LLM extractors weight semantic HTML5`));
  } else if (divs > 10 && semantic === 0) {
    out.push(f('DIV_SOUP', 1, `${divs} <div> with no semantic HTML5 tags at all — use <article>, <section>, <nav>, <main>`));
  }

  // JS-rendered content heuristic: large <script> with template-like content but tiny <body>
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(text);
  if (bodyMatch) {
    const bodyText = bodyMatch[1].replace(/<[^>]+>/g, '').trim();
    const scripts = [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
    const heavyScript = scripts.some((m) => m[1].length > 2000);
    if (bodyText.length < 200 && heavyScript) {
      out.push(f('JS_RENDERED_CONTENT', lineOf(text, bodyMatch.index), 'body text < 200 chars but script body > 2 kB — content appears JS-rendered; LLM crawlers may miss it'));
    }
  }
  return out;
}

/**
 * Run the AISO audit against a project root.
 *
 * @param {string} root
 * @returns {{ findings: object[] }}
 */
export function runAisoAudit(root) {
  const findings = [...checkLlmsTxt(root), ...checkRobots(root)];
  for (const file of walkProject(root, PAGE_EXTS)) {
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    findings.push(...checkFile(file, text, relative(root, file).replaceAll('\\', '/')));
  }
  return { findings };
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
    process.stdout.write(`Usage: aiso-audit.mjs [--json]

Scans the project for AI Search Optimization smells per ADR-0025.
AISO is about LLM answer-engine discoverability (ChatGPT, Perplexity,
Claude, Gemini) — orthogonal to classical SEO.

  --json   emit findings as JSON to stdout
  --help   this message
`);
    process.exit(0);
  }
  const root = process.cwd();
  const result = runAisoAudit(root);
  if (wantJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(renderFindings(result.findings, { title: 'AISO audit' }));
  }
  process.exit(exitCodeFor(result.findings));
}
