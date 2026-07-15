/**
 * readiness.mjs — SessionStart Domain Engineering readiness probe (ADR-0128 §14,
 * WF-0065). This is the §14 integration layer: it READS installed state (policy
 * bundles, config, pending packet/receipt) and shapes the `domainEngineering`
 * ledger block every downstream consumer reads. It NEVER dispatches an agent and
 * NEVER writes source — SessionStart only reads state and writes the ledger block.
 *
 * Fail-open (immutable rule 2 + constitution §8): any probe error degrades to a
 * recorded `degraded` state with a reason capability, NEVER a false `ready`. The
 * capability is default-OFF (config §26), so a project that has not opted in gets
 * `enabled: false` and SessionStart attaches nothing.
 *
 * Zero runtime dependencies beyond `node:crypto` + sibling runtime modules.
 *
 * @module domain-engineering/readiness
 */
import { createHash } from 'node:crypto';
import { resolveConfig } from './config.mjs';
import { loadPolicyBundle, loadPolicyTable } from './policy-load.mjs';
import { loadDevteamPolicyBundle } from '../devteam/policy-load.mjs';
import { loadDomainArtifactsPolicyBundle } from '../domain-artifacts/policy-load.mjs';
import { loadConfigSync } from '../config/load.mjs';

/** Readiness block schema version — bump on any breaking shape change (§14). */
export const READINESS_SCHEMA_VERSION = '1.0.0';

/**
 * Shapes the `domainEngineering` ledger block from already-resolved inputs. PURE
 * — no I/O, so the ready / packet-missing / degraded fixtures test it directly.
 * The status ladder is default-refuse: only a fully-installed, opted-in, gap-free
 * state is `ready`; anything unprovable degrades, never a silent pass.
 *
 * @param {object} inputs
 * @param {boolean} [inputs.enabled] domainEngineering.enabled
 * @param {boolean} [inputs.sessionStartReadiness] domainEngineering.sessionStartReadiness
 * @param {string[]} [inputs.missingCapabilities] policy capabilities that failed to load
 * @param {string|null} [inputs.registryVersion] policy manifest version
 * @param {string|null} [inputs.activeProfile] resolved profile of a pending packet
 * @param {boolean} [inputs.pendingImplementationPacket]
 * @param {boolean} [inputs.pendingReceipt]
 * @param {string|null} [inputs.configFingerprint]
 * @returns {object} the §14 ledger block.
 */
export function buildReadinessState(inputs) {
  const i = inputs && typeof inputs === 'object' ? inputs : {};
  const missingCapabilities = Array.isArray(i.missingCapabilities)
    ? [...new Set(i.missingCapabilities.filter((x) => typeof x === 'string'))]
    : [];
  const active = i.enabled === true && i.sessionStartReadiness === true;
  const pendingPacket = i.pendingImplementationPacket === true;

  let status;
  if (!active) status = 'disabled';
  else if (missingCapabilities.length > 0) status = 'degraded';
  else if (pendingPacket) status = 'packet-missing';
  else status = 'ready';

  return {
    schemaVersion: READINESS_SCHEMA_VERSION,
    enabled: active,
    status,
    registryVersion: typeof i.registryVersion === 'string' ? i.registryVersion : null,
    activeProfile: typeof i.activeProfile === 'string' ? i.activeProfile : null,
    pendingImplementationPacket: pendingPacket,
    pendingReceipt: i.pendingReceipt === true,
    missingCapabilities,
    configFingerprint: typeof i.configFingerprint === 'string' ? i.configFingerprint : null,
  };
}

/**
 * Runs the readiness probe: resolves config, checks the three policy bundles
 * (domain-engineering / devteam / domain-artifacts) for installation, reads the
 * registry version and shapes the ledger block. Never throws.
 *
 * @param {string} root absolute project root.
 * @param {object} [opts]
 * @param {object} [opts.config] the `domainEngineering` config block (tests inject).
 * @param {{ pendingImplementationPacket?: boolean, pendingReceipt?: boolean, activeProfile?: string|null }} [opts.pending]
 *   pending-work signal (tests inject; SessionStart defaults to none — packet
 *   persistence is wired by WF-0067, so the probe never fabricates a packet gap).
 * @returns {object} the §14 ledger block (buildReadinessState output).
 */
export function checkDomainEngineeringReadiness(root, opts = {}) {
  try {
    const rawConfig = opts.config !== undefined ? opts.config : loadConfigSync(root)?.domainEngineering;
    const config = resolveConfig(rawConfig);

    const missingCapabilities = [];
    if (loadPolicyBundle(root).degraded) missingCapabilities.push('domain-engineering-policy');
    if (loadDevteamPolicyBundle(root).degraded) missingCapabilities.push('devteam-policy');
    if (loadDomainArtifactsPolicyBundle(root).degraded) missingCapabilities.push('domain-artifacts-policy');

    const manifest = loadPolicyTable(root, 'manifest').table;
    const registryVersion = manifest && typeof manifest.policyVersion === 'string' ? manifest.policyVersion : null;

    const pending = opts.pending && typeof opts.pending === 'object' ? opts.pending : {};

    return buildReadinessState({
      enabled: config.enabled === true,
      sessionStartReadiness: config.sessionStartReadiness === true,
      missingCapabilities,
      registryVersion,
      activeProfile: typeof pending.activeProfile === 'string' ? pending.activeProfile : null,
      pendingImplementationPacket: pending.pendingImplementationPacket === true,
      pendingReceipt: pending.pendingReceipt === true,
      configFingerprint: fingerprint(config),
    });
  } catch {
    // Fail-open: a degraded readiness with a recorded reason, never a false ready.
    return buildReadinessState({ enabled: false, missingCapabilities: ['readiness-probe-error'] });
  }
}

/**
 * Renders the SHORT SessionStart banner section for the readiness state (§14 —
 * the banner stays short; detail lives in diagnostics). PURE. Returns '' when
 * the capability is disabled so a non-adopting project stays noise-free.
 *
 * @param {object} state a buildReadinessState output.
 * @returns {string} the banner section (no trailing newline), or ''.
 */
export function renderReadinessBanner(state) {
  if (!state || state.enabled !== true) return '';
  const lines = ['## 🧩 Domain Engineering readiness', ''];
  const tail = [
    state.activeProfile ? `profile \`${state.activeProfile}\`` : null,
    state.registryVersion ? `policy v${state.registryVersion}` : null,
  ].filter(Boolean);
  lines.push(`Status: **${state.status}**${tail.length ? ` · ${tail.join(' · ')}` : ''}.`);
  if (state.missingCapabilities.length > 0) {
    lines.push(`Missing: ${state.missingCapabilities.join(', ')} — degraded, advisory only.`);
  }
  if (state.pendingImplementationPacket) {
    lines.push('A code task has no Implementation Packet yet — compile one before writing code.');
  }
  lines.push('Shadow/advisory — never blocks. Detail: `/state` + the active workflow pack.');
  return lines.join('\n');
}

/** Deterministic short fingerprint of the resolved config (drift detection). */
function fingerprint(config) {
  try {
    return `sha256:${createHash('sha256').update(JSON.stringify(config), 'utf8').digest('hex').slice(0, 12)}`;
  } catch {
    return null;
  }
}
