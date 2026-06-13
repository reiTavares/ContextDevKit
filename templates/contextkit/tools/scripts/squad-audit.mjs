#!/usr/bin/env node
/**
 * squad-audit — Static compliance scanner.
 * Audits modified files against squads-registry rules, enforcing that gated
 * changes (auth, database, workflows) are verified by the correct postures.
 *
 * File size budget: <280 lines. Zero runtime dependencies.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { pathsFor, PLATFORM_DIR } from '../../runtime/config/paths.mjs';
import { toRepoRelative } from '../../runtime/hooks/ledger.mjs';
import { matchHighRisk } from '../../runtime/hooks/path-classification.mjs';

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

/**
 * Resolves the audit scope. A target path keeps guard checks local, while the
 * no-target CLI mode preserves the historical full working-tree audit.
 *
 * @param {string | null} targetPath optional repo path passed by guard.mjs
 * @returns {string[]} repo-relative files to audit
 */
function getAuditFiles(targetPath) {
  if (targetPath) return [toRepoRelative(targetPath)];
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
function getActiveSessionSquads(sessionId) {
  const sessionsDir = paths.ledgerDir;
  if (!existsSync(sessionsDir)) return new Set();
  const squads = new Set();

  // 1. If explicit sessionId is provided, try to read that specific ledger
  if (sessionId) {
    try {
      const p = resolve(sessionsDir, `${sessionId}.json`);
      if (existsSync(p)) {
        const content = JSON.parse(readFileSync(p, 'utf-8'));
        const list = content.squads || content.postures || [];
        if (Array.isArray(list)) {
          for (const s of list) squads.add(s.toLowerCase());
        }
        return squads;
      }
    } catch {
      // fallback
    }
  }

  // 2. Otherwise, look for the most recently modified ledger in the ledger directory
  try {
    const files = readdirSync(sessionsDir).filter(f => f.endsWith('.json'));
    if (files.length === 0) return squads;

    let best = null;
    for (const f of files) {
      const p = resolve(sessionsDir, f);
      try {
        const st = statSync(p);
        if (!best || st.mtimeMs > best.mtime) {
          best = { path: p, mtime: st.mtimeMs };
        }
      } catch {
        // skip
      }
    }

    if (best) {
      const content = JSON.parse(readFileSync(best.path, 'utf-8'));
      const list = content.squads || content.postures || [];
      if (Array.isArray(list)) {
        for (const s of list) squads.add(s.toLowerCase());
      }
    }
  } catch {
    // fallback
  }

  return squads;
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
  const sessionId = process.argv[2] || null;
  const targetPath = process.argv[3] || null;
  const config = loadConfigSync(ROOT);
  const registry = loadRegistry();
  const modified = getAuditFiles(targetPath);
  const activeSquads = getActiveSessionSquads(sessionId);

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
      console.warn(`     👉 Recommended Agent: \`${w.agent}\`. Load playbook with \`cdx.mjs squad route ${w.file}\`.`);
    }
    const strictFails = warnings.filter(w => matchHighRisk(w.file, config?.l5?.highRiskPaths ?? []));
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runAudit());
}
export { runAudit };
