#!/usr/bin/env node
/**
 * squad-director — High-performance agent posture and context assembler.
 * Analyzes file edits, stack dependencies, and schemas to suggest the active
 * squad posture and compile a token-light playbook context.
 *
 * File size budget: <280 lines. Zero runtime dependencies.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathsFor, PLATFORM_DIR } from '../../runtime/config/paths.mjs';

const ROOT = process.cwd();
const paths = pathsFor(ROOT);

// Safely load squads-registry.json
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

// Safely execute command and get output lines
function getGitChanges() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const files = status.split('\n')
      .map(line => line.slice(3).trim())
      .filter(Boolean);
    return [...new Set(files)];
  } catch {
    return [];
  }
}

// Check for PII fields in file modifications
function scanForPII(files) {
  const piiPatterns = [/\bemail\b/i, /\bcpf\b/i, /\bphone\b/i, /\btelephone\b/i, /\brg\b/i, /\bnome\b/i, /\bsobrenome\b/i];
  for (const file of files) {
    if (file.endsWith('.prisma') || file.includes('schema') || file.includes('db/')) {
      try {
        const content = readFileSync(resolve(ROOT, file), 'utf-8');
        if (piiPatterns.some(pattern => pattern.test(content))) return true;
      } catch {
        /* fail-silent */
      }
    }
  }
  return false;
}

// Check for missing specialized agents
function checkMissingAgents(registrySuggestions) {
  const pkgPath = resolve(ROOT, 'package.json');
  if (!existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
    const suggestions = [];
    const agentsDir = resolve(ROOT, '.claude/agents');
    const hasAgent = (name) => existsSync(resolve(agentsDir, `${name}.md`));

    if (deps.includes('stripe') && !hasAgent('stripe')) {
      suggestions.push('stripe-agent (handles Stripe billing & webhook integrations)');
    }
    if ((deps.includes('redis') || deps.includes('ioredis')) && !hasAgent('redis')) {
      suggestions.push('redis-agent (handles Redis caching & connection boundaries)');
    }
    if (deps.some(d => d.startsWith('@aws-sdk/')) && !hasAgent('aws')) {
      suggestions.push('aws-agent (handles AWS S3 / DynamoDB configuration)');
    }
    return suggestions;
  } catch {
    return [];
  }
}

// Load dynamic config override from config.json
function loadConfigSquads() {
  try {
    if (existsSync(paths.config)) {
      const cfg = JSON.parse(readFileSync(paths.config, 'utf-8').replace(/^﻿/, ''));
      return cfg.squads || null;
    }
  } catch {
    /* fallback */
  }
  return null;
}

/**
 * Matches either an intent phrase or a repo path against one registry row.
 *
 * @param {string} input user intent or path-like query
 * @param {{keywords: string[], paths: string[]}} definition registry row
 * @returns {boolean}
 */
function matchesDefinition(input, definition) {
  const lowerInput = input.toLowerCase();
  const keywordMatch = definition.keywords.some(kw => lowerInput.includes(kw));
  const pathMatch = definition.paths.some(p => lowerInput.includes(p.toLowerCase()) || lowerInput.endsWith(p.toLowerCase()));
  return keywordMatch || pathMatch;
}

export function analyzeContext(query = '') {
  const registry = loadRegistry();
  // Merge user's override config squads if present
  const override = loadConfigSquads();
  const squadDefinitions = override || registry.squads || [];

  const files = getGitChanges();
  const matchedSquads = new Set();
  const matchedAgents = new Set();
  const suggestions = [];

  // Match based on query intent
  if (query) {
    for (const definition of squadDefinitions) {
      if (matchesDefinition(query, definition)) {
        matchedSquads.add(definition.squad);
        matchedAgents.add(definition.agent);
      }
    }
  }

  // Match based on files touched
  for (const file of files) {
    for (const definition of squadDefinitions) {
      if (definition.paths.some(p => file.includes(p) || file.endsWith(p))) {
        matchedSquads.add(definition.squad);
        matchedAgents.add(definition.agent);
      }
    }
  }

  // Auto compliance-team trigger on schema PII detection
  if (scanForPII(files)) {
    matchedSquads.add('compliance-team');
    matchedAgents.add('privacy-lgpd');
  }

  // Default fallback to devteam
  if (matchedSquads.size === 0) {
    matchedSquads.add('devteam');
    matchedAgents.add('architect');
  }

  const result = {
    squads: [...matchedSquads],
    agents: [...matchedAgents],
    playbooks: [],
    agentScaffolding: checkMissingAgents()
  };

  // Compile Playbook Contents
  for (const squad of result.squads) {
    const def = squadDefinitions.find(d => d.squad === squad);
    if (def && def.playbook) {
      const playbookPath = resolve(paths.playbooks, def.playbook);
      const srcPlaybookPath = resolve(ROOT, 'templates', PLATFORM_DIR, 'workflows/playbooks', def.playbook);
      const activePath = existsSync(playbookPath) ? playbookPath : existsSync(srcPlaybookPath) ? srcPlaybookPath : null;
      if (activePath) {
        try {
          const content = readFileSync(activePath, 'utf-8');
          result.playbooks.push({
            squad,
            path: `contextkit/workflows/playbooks/${def.playbook}`,
            content
          });
        } catch {
          /* skip */
        }
      }
    }
  }

  return result;
}

// CLI entry point
function main() {
  const query = process.argv.slice(2).join(' ');
  const result = analyzeContext(query);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
