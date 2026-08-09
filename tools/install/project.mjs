/**
 * Target-project inspection for the installer: detect the stack (for the
 * CLAUDE.md header on existing projects), decide whether a folder looks
 * greenfield, and derive a safe project basename.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { read } from './fs.mjs';

/** Best-effort, human-readable stack summary for the CLAUDE.md header. */
export async function detectStack(target) {
  const hints = [];
  const pkgPath = join(target, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await read(pkgPath));
      const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
      const known = ['react', 'next', 'expo', 'react-native', 'vue', 'svelte', 'hono', 'express', 'fastify', 'nestjs', 'vite', 'astro', 'drizzle-orm', 'prisma', 'typescript'];
      const found = known.filter((k) => deps.includes(k));
      hints.push(`Node/TypeScript project. Detected: ${found.length ? found.join(', ') : 'no well-known frameworks'}.`);
    } catch {
      hints.push('Node project (package.json present).');
    }
  }
  for (const [f, label] of [['pyproject.toml', 'Python'], ['go.mod', 'Go'], ['Cargo.toml', 'Rust'], ['pom.xml', 'Java/Maven'], ['Gemfile', 'Ruby']]) {
    if (existsSync(join(target, f))) hints.push(`${label} (${f}).`);
  }
  return hints.length ? hints.join(' ') : '_TBD — fill in your stack._';
}

export function requireBasename(p) {
  return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'project';
}

export function looksGreenfield(target) {
  try {
    const entries = existsSync(target) ? readdirSyncSafe(target) : [];
    const meaningful = entries.filter((e) => !['.git', '.gitignore', 'README.md', 'LICENSE', '.claude', 'contextkit'].includes(e));
    return meaningful.length === 0;
  } catch {
    return true;
  }
}

function readdirSyncSafe(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}
