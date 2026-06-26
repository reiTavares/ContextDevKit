#!/usr/bin/env node
/**
 * mcp.mjs — /mcp dispatch entry point (MCP-004).
 *
 * WHY this file exists: a single stable CLI surface for all /mcp subcommands.
 * Business logic lives EXCLUSIVELY in the delegated modules — this file is a
 * DISPATCHER only (constitution §2: no business logic in the entry point).
 *
 * Subcommands (AC-4):
 *   discover [query]   — browse MCP registry candidates  (→ mcp-discover.mjs)
 *   add <id>           — add a server from the registry   (→ mcp-discover.mjs)
 *   profile [id]       — show / manage server profiles    (→ mcp-discover.mjs)
 *   doctor [--json]    — health-check all enabled servers (→ mcp-doctor.mjs)
 *   audit  [--json]    — surface flags + posture          (→ mcp-audit.mjs)
 *   sync               — push manifest → host configs     (→ mcp-discover.mjs / renderers)
 *   disable <id>       — disable a server                 (→ mcp-discover.mjs)
 *   receipt [--write]  — write an MCP execution receipt   (→ mcp-receipt.mjs)
 *
 * Exit contract:
 *   - Each subcommand handles its own exit (via the delegated module's CLI).
 *   - On unknown subcommand: print usage and exit 0 (defensive; hook contract).
 *   - On unexpected dispatch error: print to stderr and exit 0.
 *
 * Zero runtime deps — node:* only (immutable rule §1).
 *
 * @module mcp
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const NODE       = process.execPath;

/** Path to the scripts folder (same dir as this file). */
const SCRIPTS_DIR = __dirname;

// ---------------------------------------------------------------------------
// Usage text
// ---------------------------------------------------------------------------

const USAGE = `
Usage: mcp <subcommand> [options]

Subcommands:
  discover [query]     Browse MCP registry candidates (no auto-enable).
  add <id>             Add a server from the registry (requires curation flow).
  profile [id]         Show or manage server capability profiles.
  doctor [--json]      Health-check all enabled MCP servers.
  audit  [--json]      Surface audit flags and posture for enabled servers.
  sync                 Push manifest changes to host config files.
  disable <id>         Disable an enabled server.
  receipt [--write]    Write (or dry-run) an MCP execution receipt.

Options:
  --root <path>        Project root override (default: cwd).
  --json               Machine-readable JSON output (supported per subcommand).
  --help, -h           Show this help.

Examples:
  mcp doctor
  mcp doctor --json
  mcp audit  --json --root /my/project
  mcp discover filesystem
  mcp receipt --write '{"task":"t","run":"r","servers":[],"tools":[],"host":"claude-code","result":"passed"}'
`.trimStart();

// ---------------------------------------------------------------------------
// Dispatch helpers
// ---------------------------------------------------------------------------

/**
 * Resolves the absolute path to a sibling script in the scripts dir.
 *
 * @param {string} scriptName — filename (without directory)
 * @returns {string}
 */
function scriptPath(scriptName) {
  return resolve(SCRIPTS_DIR, scriptName);
}

/**
 * Delegates execution to a sibling script by spawning it with the current
 * Node.js binary. Passes `remainingArgs` as argv. Inherits stdio.
 *
 * Exits with the child's exit code (or 0 on spawn failure — hook contract).
 *
 * @param {string}   scriptName    filename in the same directory
 * @param {string[]} remainingArgs forwarded argv
 */
function delegate(scriptName, remainingArgs) {
  const target = scriptPath(scriptName);
  const result = spawnSync(NODE, [target, ...remainingArgs], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    // Spawn failure (e.g. file not found) — report and exit cleanly.
    process.stderr.write(`mcp: failed to launch ${scriptName}: ${result.error.message}\n`);
    process.exit(0);
  }

  process.exit(result.status ?? 0);
}

// ---------------------------------------------------------------------------
// Subcommand map
// ---------------------------------------------------------------------------

/**
 * Maps subcommand names to the script that owns them.
 * Constitution §2: this file dispatches, never implements.
 *
 * @type {Record<string, string>}
 */
const SUBCOMMAND_MAP = {
  discover: 'mcp-discover.mjs',
  add:      'mcp-discover.mjs',   // handled by discover CLI with 'add' as first arg
  profile:  'mcp-discover.mjs',   // handled by discover CLI with 'profile' as first arg
  doctor:   'mcp-doctor.mjs',
  audit:    'mcp-audit.mjs',
  sync:     'mcp-discover.mjs',   // handled by discover CLI with 'sync' as first arg
  disable:  'mcp-discover.mjs',   // handled by discover CLI with 'disable' as first arg
  receipt:  'mcp-receipt.mjs',
};

// ---------------------------------------------------------------------------
// Main dispatch
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const [subcommand, ...rest] = args;
  const target = SUBCOMMAND_MAP[subcommand];

  if (!target) {
    process.stderr.write(`mcp: unknown subcommand '${subcommand}'\n\n${USAGE}`);
    process.exit(0); // hook contract: exit 0 on unknown; don't break real work
  }

  delegate(target, rest);
}

// ---------------------------------------------------------------------------
// Guard: only run when invoked as a CLI entry point
// ---------------------------------------------------------------------------

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === __filename;

if (isMain) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`mcp: unexpected error: ${err?.message ?? String(err)}\n`);
    process.exit(0); // hook contract
  }
}
