/**
 * Project-map CORE — deterministic, stack-agnostic structural scanner.
 *
 * Walks a project tree with ZERO AI tokens and builds a structured model the
 * agent reads INSTEAD of re-exploring: modules classified frontend/backend/
 * shared/config, per-module file counts + languages, a capped sample of exported
 * symbols, the detected stack, and a cheap signature for staleness detection.
 *
 * Pure exports (no self-execution, no I/O side effects beyond fs reads) so both
 * the CLI (`project-map.mjs`) and tests can import it. Best-effort: a missing or
 * unreadable file is skipped, never thrown. Bounded: caps files-per-module and
 * symbols-per-module so the OUTPUT stays a map, not a full index.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { DEP_EXTS, extractImports, linkDeps } from './project-map-deps.mjs';
import { extractSymbols } from './project-map-symbols.mjs';

/** Dirs never worth mapping (deps, build output, VCS, the platform itself). */
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
  '.turbo', '.expo', '.svelte-kit', 'coverage', '__pycache__', '.pytest_cache',
  'target', 'vendor', '.venv', 'venv', 'bin', 'obj', '.cache', '.idea', '.vscode',
  'contextkit', '.claude', '.agents', '.antigravity', '.tmp',
]);

const CAP_FILES_PER_MODULE = 600;
const CAP_SYMBOLS_PER_MODULE = 25;
const CAP_SAMPLE_FILES = 40;

/** Extension → language label (the languages we extract symbols for). */
const EXT_LANG = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.mjs': 'javascript', '.cjs': 'javascript', '.vue': 'vue', '.svelte': 'svelte',
  '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.kt': 'kotlin',
  '.rb': 'ruby', '.php': 'php', '.cs': 'csharp', '.sql': 'sql',
};

/** Dir-name hints → role. First match wins; extensions refine ambiguous cases. */
const ROLE_HINTS = [
  ['frontend', ['components', 'pages', 'views', 'ui', 'client', 'web', 'frontend', 'app', 'screens', 'public', 'styles']],
  ['backend', ['server', 'api', 'backend', 'functions', 'services', 'service', 'controllers', 'routes', 'handlers', 'workers', 'cmd', 'internal', 'pkg', 'supabase', 'db', 'database', 'migrations', 'models', 'repositories']],
  ['shared', ['shared', 'common', 'core', 'lib', 'libs', 'types', 'contracts', 'utils', 'helpers', 'domain', 'packages']],
  ['config', ['config', 'scripts', 'tooling', 'infra', 'deploy', 'docker', 'terraform', 'k8s', 'ci', '.github']],
  ['tests', ['tests', 'test', 'spec', '__tests__', 'e2e', 'cypress']],
];

const FRONTEND_EXTS = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.css', '.scss', '.html']);

/** Substrings that mark a cross-cutting shared module regardless of extensions. */
const SHARED_SUBSTR = ['shared', 'contract', 'common', 'types'];

/** Classify a module by its directory name, then refine by the extensions found. */
function classifyRole(dirName, extCounts) {
  const lower = dirName.toLowerCase();
  for (const [role, names] of ROLE_HINTS) {
    if (names.includes(lower)) return role;
  }
  if (SHARED_SUBSTR.some((s) => lower.includes(s))) return 'shared';
  const frontish = [...FRONTEND_EXTS].reduce((n, e) => n + (extCounts[e] || 0), 0);
  const total = Object.values(extCounts).reduce((a, b) => a + b, 0) || 1;
  if (frontish / total > 0.25) return 'frontend';
  if ((extCounts['.py'] || 0) + (extCounts['.go'] || 0) + (extCounts['.rs'] || 0) > 0) return 'backend';
  if ((extCounts['.ts'] || 0) + (extCounts['.js'] || 0) > 0) return 'backend';
  return 'shared';
}

/** Recursively collect source files under a module dir (bounded). */
function walkModule(absDir, acc) {
  if (acc.files.length >= CAP_FILES_PER_MODULE) return;
  let entries;
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (acc.files.length >= CAP_FILES_PER_MODULE) return;
    if (e.name.startsWith('.') && e.name !== '.github') continue;
    const full = resolve(absDir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walkModule(full, acc);
    } else {
      const ext = extname(e.name).toLowerCase();
      if (!EXT_LANG[ext]) continue;
      acc.files.push(full);
      acc.extCounts[ext] = (acc.extCounts[ext] || 0) + 1;
      try {
        acc.bytes += statSync(full).size;
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Build the per-module record: role, languages, file count, sampled symbols, and
 * the raw import specifiers (resolved to edges later by `linkDeps`). Reads EVERY
 * walked file for imports (top-of-file, cheap on-demand); symbols stay sampled to
 * the first CAP_SAMPLE_FILES to keep the inventory bounded.
 */
function buildModule(root, absDir, relPath) {
  const acc = { files: [], extCounts: {}, bytes: 0 };
  walkModule(absDir, acc);
  if (acc.files.length === 0) return null;
  const languages = [...new Set(acc.files.map((f) => EXT_LANG[extname(f).toLowerCase()]))].sort();
  const symbols = [];
  const imports = [];
  acc.files.forEach((file, i) => {
    const ext = extname(file).toLowerCase();
    let text = '';
    try {
      text = readFileSync(file, 'utf-8');
    } catch {
      return;
    }
    if (DEP_EXTS.has(ext)) for (const spec of extractImports(text)) imports.push({ dir: dirname(file), spec });
    if (i < CAP_SAMPLE_FILES && symbols.length < CAP_SYMBOLS_PER_MODULE) {
      const rel = file.slice(root.length + 1).replaceAll('\\', '/');
      symbols.push(...extractSymbols(text, EXT_LANG[ext], rel, CAP_SYMBOLS_PER_MODULE - symbols.length));
    }
  });
  return {
    path: relPath,
    role: classifyRole(basename(relPath), acc.extCounts),
    languages,
    files: acc.files.length,
    bytes: acc.bytes,
    capped: acc.files.length >= CAP_FILES_PER_MODULE,
    imports,
    symbols: symbols.slice(0, CAP_SYMBOLS_PER_MODULE),
  };
}

const MONOREPO_PARENTS = ['apps', 'packages', 'services', 'modules'];

/** Top-level (and one-level-deep for monorepos) module directories to map. */
function moduleDirs(root) {
  const dirs = [];
  let top;
  try {
    top = readdirSync(root, { withFileTypes: true });
  } catch {
    return dirs;
  }
  for (const e of top) {
    if (!e.isDirectory() || IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    if (MONOREPO_PARENTS.includes(e.name)) {
      let kids = [];
      try {
        kids = readdirSync(resolve(root, e.name), { withFileTypes: true });
      } catch {
        /* ignore */
      }
      for (const k of kids) if (k.isDirectory() && !IGNORE_DIRS.has(k.name)) dirs.push(`${e.name}/${k.name}`);
    } else {
      dirs.push(e.name);
    }
  }
  return dirs;
}

const has = (root, rel) => {
  try {
    statSync(resolve(root, rel));
    return true;
  } catch {
    return false;
  }
};

/** Detect the data layer cheaply (presence only — never deep-parses a schema). */
function detectDataLayer(root) {
  const kinds = [];
  if (has(root, 'prisma/schema.prisma')) kinds.push('prisma');
  if (has(root, 'drizzle.config.ts') || has(root, 'drizzle')) kinds.push('drizzle');
  if (has(root, 'supabase/config.toml') || has(root, 'supabase')) kinds.push('supabase');
  if (has(root, 'migrations') || has(root, 'db/migrations')) kinds.push('migrations');
  return { detected: kinds.length > 0, kinds };
}

/** Lightweight stack read (manifest presence + package.json deps). */
function detectStack(root) {
  const languages = new Set();
  for (const [file, lang] of [['package.json', 'javascript'], ['tsconfig.json', 'typescript'], ['pyproject.toml', 'python'], ['requirements.txt', 'python'], ['go.mod', 'go'], ['Cargo.toml', 'rust'], ['pom.xml', 'java'], ['Gemfile', 'ruby'], ['composer.json', 'php']]) {
    if (has(root, file)) languages.add(lang);
  }
  let frameworks = [];
  let packageManager = null;
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
    frameworks = ['next', 'react', 'react-native', 'expo', 'vue', 'nuxt', 'svelte', 'astro', 'angular', 'solid-js', 'express', 'fastify', '@nestjs/core', 'hono', 'koa', 'prisma', 'drizzle-orm', 'vite', 'electron'].filter((f) => deps.includes(f));
    packageManager = pkg.packageManager ? String(pkg.packageManager).split('@')[0] : null;
  } catch {
    /* no package.json */
  }
  if (has(root, 'pnpm-lock.yaml')) packageManager ||= 'pnpm';
  else if (has(root, 'yarn.lock')) packageManager ||= 'yarn';
  else if (has(root, 'package-lock.json')) packageManager ||= 'npm';
  const monorepo = has(root, 'pnpm-workspace.yaml') || has(root, 'turbo.json') || has(root, 'nx.json') || has(root, 'lerna.json');
  return { languages: [...languages].sort(), frameworks, packageManager, monorepo };
}

function projectName(root) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
    if (typeof pkg?.name === 'string' && pkg.name) return pkg.name;
  } catch {
    /* fall through */
  }
  return basename(root);
}

/**
 * Scan a project root into the full structural model. Deterministic and
 * best-effort. `nowMs` is injected so callers control the timestamp.
 *
 * @param {string} root project root to map
 * @param {number} [nowMs] generation timestamp (ms since epoch)
 * @returns {object} the project-map model
 */
export function scanProject(root, nowMs = Date.now()) {
  const modules = [];
  for (const rel of moduleDirs(root)) {
    const mod = buildModule(root, resolve(root, rel), rel);
    if (mod) modules.push(mod);
  }
  modules.sort((a, b) => b.files - a.files);
  linkDeps(root, modules); // resolve raw imports → sorted `deps` edges (ADR-0040)
  const fileCount = modules.reduce((n, m) => n + m.files, 0);
  return {
    name: projectName(root),
    root,
    generatedAt: nowMs,
    stack: detectStack(root),
    dataLayer: detectDataLayer(root),
    modules,
    fileCount,
    signature: structuralSignature(modules),
  };
}

/**
 * Deterministic structural fingerprint — a sha256 over each module's
 * `path:files:bytes` (module set sorted for stability). DELIBERATELY excludes
 * mtime and the clock: an unchanged tree yields an identical signature, so the
 * committed docs don't churn and the staleness check survives a clone (which
 * resets mtimes). A content edit changes a module's byte total; an add/remove
 * changes its file count or the module set. [project-map / ADR-0039]
 *
 * @param {Array<{path:string, files:number, bytes:number}>} modules
 * @returns {string} 12-hex-char fingerprint
 */
export function structuralSignature(modules) {
  const lines = modules
    .map((m) => `${m.path}:${m.files}:${m.bytes}`)
    .sort()
    .join('|');
  return createHash('sha256').update(lines).digest('hex').slice(0, 12);
}
