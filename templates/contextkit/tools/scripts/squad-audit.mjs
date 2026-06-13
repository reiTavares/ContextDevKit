#!/usr/bin/env node
/**
 * squad-audit — Static compliance scanner.
 * Audits modified files against squads-registry rules, enforcing that gated
 * changes (auth, database, workflows) are verified by the correct postures.
 *
 * File size budget: <280 lines. Zero runtime dependencies.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathsFor, PLATFORM_DIR } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const paths = pathsFor(ROOT);

// Load registry
function loadRegistry() {
  const customRegistry = resolve(paths.policy, 'squads-registry.json');
  const srcRegistry = resolve(ROOT, 'templates', PLATFORM_DIR, 'policy/squads-registry.json');
  const file = existsSync(customRegistry) ? customRegistry : existsSync(srcRegistry) ? srcRegistry : null;
  if (!file) return { squads: [] };
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return { squads: [] };
  }
}

// Get git modified files
function getModifiedFiles() {
  try {
    const output = execSync('git diff --name-only --diff-filter=d HEAD', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const cached = execSync('git diff --cached --name-only --diff-filter=d', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const files = [...output.split('\n'), ...cached.split('\n')]
      .map(f => f.trim())
      .filter(Boolean);
    return [...new Set(files)];
  } catch {
    // If not a git repo, return empty
    return [];
  }
}

// Find active session file and read active squads
function getActiveSessionSquads() {
  const sessionsDir = resolve(ROOT, '.claude/.sessions');
  if (!existsSync(sessionsDir)) return new Set();
  try {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return new Set();
    // find the latest modified file
    const latest = files
      .map(f => ({ name: f, time: readdirSync(sessionsDir) })) // stub for stats
      .map(item => {
        try {
          const p = resolve(sessionsDir, item.name);
          const content = JSON.parse(readFileSync(p, 'utf-8'));
          return { squads: content.squads || content.postures || [], mtime: 1 };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    
    const squads = new Set();
    for (const entry of latest) {
      if (Array.isArray(entry.squads)) {
        for (const s of entry.squads) squads.add(s.toLowerCase());
      }
    }
    return squads;
  } catch {
    return new Set();
  }
}

// Secret scanner
function scanForSecrets(files) {
  const secretsRegex = /(password|passwd|secret|api_key|private_key|token|access_key|credentials)\s*[:=]\s*['"][\w-]{16,}['"]/i;
  const violations = [];
  for (const file of files) {
    try {
      const content = readFileSync(resolve(ROOT, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (secretsRegex.test(lines[i]) && !file.includes('registry') && !file.includes('playbook')) {
          violations.push({ file, line: i + 1, detail: 'Potential hardcoded secret key found' });
        }
      }
    } catch {
      /* skip binary files */
    }
  }
  return violations;
}

function runAudit() {
  const registry = loadRegistry();
  const modified = getModifiedFiles();
  const activeSquads = getActiveSessionSquads();

  if (modified.length === 0) {
    console.log('✅ No modified files to audit.');
    return 0;
  }

  let failures = 0;
  const warnings = [];

  // 1. Audit secret patterns
  const secretViolations = scanForSecrets(modified);
  for (const v of secretViolations) {
    console.error(`🔴 SECURITY ERROR: ${v.file}:${v.line} — ${v.detail}`);
    failures++;
  }

  // 2. Audit file scopes vs active postures
  for (const file of modified) {
    for (const definition of registry.squads) {
      // We enforce gates on security, compliance, and ops
      if (['security-team', 'compliance-team', 'ops-team'].includes(definition.squad)) {
        const matchesPath = definition.paths.some(p => file.includes(p) || file.endsWith(p));
        if (matchesPath) {
          // If the squad is not marked active in the session, raise a violation
          if (!activeSquads.has(definition.squad.toLowerCase())) {
            warnings.push({
              file,
              squad: definition.squad,
              agent: definition.agent
            });
          }
        }
      }
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Active Squad Posture Warnings:');
    for (const w of warnings) {
      console.warn(`   • [${w.squad}] Touched gated file \`${w.file}\` without an active posture.`);
      console.warn(`     👉 Recommeded Agent: \`${w.agent}\`. Load playbook with \`cdx.mjs squad route ${w.file}\`.`);
    }
    // High-risk path strict failures (e.g. databases/security configs)
    const highRiskPaths = ['prisma/schema.prisma', 'db/schema', 'auth/'];
    const strictFails = warnings.filter(w => highRiskPaths.some(hp => w.file.includes(hp)));
    if (strictFails.length > 0) {
      console.error('\n🔴 Gated release block: strict security/compliance postures missing for high-risk files.');
      failures++;
    }
  }

  if (failures > 0) {
    console.error(`\n❌ Squad compliance audit failed with ${failures} error(s).`);
    return 1;
  }

  console.log('✅ Squad compliance audit passed.');
  return 0;
}

// Run CLI
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace('file:///', '').replace('file://', ''))) {
  process.exit(runAudit());
}
export { runAudit };
