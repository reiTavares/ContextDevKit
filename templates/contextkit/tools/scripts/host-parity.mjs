#!/usr/bin/env node
/**
 * Governance-first host contract and generated-projection parity gate.
 *
 * Claude, Codex, and Antigravity must expose the same mutation-only intake,
 * gate, workflow-context, state, and advisory-routing contract. Generated host
 * assets are accepted only when declared by `host-projections.json`, byte-current,
 * and free of managed orphans. Missing sources and drift are failures.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_DIR } from '../../runtime/config/paths.mjs';
import {
  HOST_PROJECTION_HOSTS,
  validateHostProjectionManifest,
} from '../../methodology/projections.mjs';
import { runCodexProjectionGeneration } from '../../runtime/codex/convert-all.mjs';
import { runAntigravityProjectionGeneration } from '../../runtime/antigravity/convert-all.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..', '..', '..', '..');
const CONTRACT_START = '<!-- contextdevkit:host-contract:start -->';
const CONTRACT_END = '<!-- contextdevkit:host-contract:end -->';

/** Extracts the exact shared contract block from one boot template. */
function extractContractBlock(content, sourcePath) {
  const start = content.indexOf(CONTRACT_START);
  const end = content.indexOf(CONTRACT_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`canonical host contract markers are missing or malformed: ${sourcePath}`);
  }
  return content.slice(start, end + CONTRACT_END.length).replaceAll('\r\n', '\n');
}

/** Returns a stable short digest for report readability. */
function digest(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Loads and validates the template-mode projection manifest. */
async function loadManifest(root) {
  const manifestPath = resolve(root, 'templates', PLATFORM_DIR, 'policy', 'host-projections.json');
  const raw = await readFile(manifestPath, 'utf8');
  return { manifestPath, manifest: validateHostProjectionManifest(JSON.parse(raw.replace(/^\uFEFF/, ''))) };
}

/** Proves every template-mode source named by the manifest exists. */
async function validateDeclaredSources(root, manifest) {
  const errors = [];
  for (const hostName of HOST_PROJECTION_HOSTS) {
    for (const projection of manifest.hosts[hostName].projections) {
      const sourcePath = resolve(root, projection.source.templates);
      try {
        await stat(sourcePath);
      } catch {
        errors.push(`missing source for ${projection.id}: ${relative(root, sourcePath)}`);
      }
    }
  }
  return errors;
}

/**
 * Checks the three-host contract and generated assets without mutating files.
 *
 * @param {string} [root] ContextDevKit source root
 * @returns {Promise<object>} machine-readable parity report
 */
export async function checkParity(root = DEFAULT_ROOT) {
  const projectRoot = resolve(root);
  const errors = [];
  let manifest;
  let manifestPath;
  try {
    ({ manifest, manifestPath } = await loadManifest(projectRoot));
  } catch (error) {
    return {
      ok: false,
      root: projectRoot,
      manifestPath: null,
      contractDigest: null,
      contracts: [],
      loads: [],
      projections: [],
      gaps: [`manifest: ${error.message}`],
    };
  }

  errors.push(...await validateDeclaredSources(projectRoot, manifest));
  const hostContracts = [];
  let canonicalBlock = null;
  for (const hostName of HOST_PROJECTION_HOSTS) {
    const sourcePath = resolve(projectRoot, manifest.hosts[hostName].contractSource);
    try {
      const block = extractContractBlock(await readFile(sourcePath, 'utf8'), sourcePath);
      if (canonicalBlock === null) canonicalBlock = block;
      if (block !== canonicalBlock) errors.push(`host contract drift: ${hostName} differs from ${manifest.canonicalHost}`);
      const missingContracts = manifest.requiredContracts.filter((name) => !block.includes(`\`${name}\``));
      if (missingContracts.length > 0) {
        errors.push(`host contract incomplete: ${hostName} missing ${missingContracts.join(', ')}`);
      }
      hostContracts.push({ host: hostName, source: relative(projectRoot, sourcePath), digest: digest(block), missingContracts });
    } catch (error) {
      errors.push(`host contract source failure (${hostName}): ${error.message}`);
      hostContracts.push({ host: hostName, source: relative(projectRoot, sourcePath), digest: null, missingContracts: [...manifest.requiredContracts] });
    }
  }

  const projectionReports = [];
  for (const [host, runner] of [
    ['codex', runCodexProjectionGeneration],
    ['antigravity', runAntigravityProjectionGeneration],
  ]) {
    try {
      const report = await runner({ root: projectRoot, mode: 'templates', check: true });
      projectionReports.push({ host, ...report });
      for (const item of report.drift) errors.push(`${host} ${item.reason} drift: ${item.path}`);
      for (const orphanPath of report.orphans) errors.push(`${host} orphan projection: ${orphanPath}`);
    } catch (error) {
      errors.push(`${host} projection check failed: ${error.message}`);
      projectionReports.push({ host, ok: false, generated: 0, drift: [], orphans: [], mode: 'templates' });
    }
  }

  const loads = manifest.requiredContracts.map((name) => {
    const row = { name, verdict: 'parity' };
    for (const hostName of HOST_PROJECTION_HOSTS) {
      const host = hostContracts.find((entry) => entry.host === hostName);
      row[hostName] = Boolean(host?.digest) && !host.missingContracts.includes(name);
      if (!row[hostName]) row.verdict = 'GAP';
    }
    return row;
  });

  return {
    ok: errors.length === 0,
    root: projectRoot,
    manifestPath: relative(projectRoot, manifestPath),
    contractDigest: canonicalBlock ? digest(canonicalBlock) : null,
    contracts: hostContracts,
    loads,
    projections: projectionReports,
    gaps: errors,
  };
}

/** Renders a concise parity receipt. */
export function renderParity(report) {
  const lines = [
    '## Host Parity Report',
    '',
    `Manifest: ${report.manifestPath ?? 'unavailable'}`,
    `Canonical contract digest: ${report.contractDigest ?? 'unavailable'}`,
    '',
    '| Contract | Claude | Codex | Antigravity | Verdict |',
    '|---|:---:|:---:|:---:|:---:|',
  ];
  for (const row of report.loads) {
    lines.push(`| ${row.name} | ${row.claude ? 'yes' : 'no'} | ${row.codex ? 'yes' : 'no'} | ${row.antigravity ? 'yes' : 'no'} | ${row.verdict} |`);
  }
  lines.push('', '| Projection host | Declared outputs | Drift | Orphans |', '|---|---:|---:|---:|');
  for (const projection of report.projections) {
    lines.push(`| ${projection.host} | ${projection.generated} | ${projection.drift.length} | ${projection.orphans.length} |`);
  }
  lines.push('');
  if (report.ok) lines.push('**Verdict: PARITY** - contract and declared projections are current.');
  else {
    lines.push(`**Verdict: GAPS FOUND (${report.gaps.length})**`, '');
    for (const gap of report.gaps) lines.push(`- ${gap}`);
  }
  return lines.join('\n') + '\n';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await checkParity();
  process.stdout.write(renderParity(report));
  if (!report.ok) process.exitCode = 1;
}
