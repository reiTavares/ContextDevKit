/**
 * bridges/index.mjs — F8 bridge orchestration (ADR-0068).
 *
 * Drives the opt-in context bridges for the six non-native tools. The registry
 * (`BRIDGE_HOSTS`) is the single source of truth in `host-adapter.mjs`; each
 * enabled tool has a sibling installer (`./<key>.mjs`) exporting
 * `installBridge(target, body, host)`. The shared body comes from `render.mjs`;
 * every installer writes through `marker-inject.mjs` (idempotent, non-destructive).
 *
 * Gating: config `bridges.enabled` (per-tool opt-in). Empty/absent → no-op, so a
 * default install ships ZERO bridges. Defensive (rule #2): a missing or throwing
 * installer is reported as skipped, never a failed install.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRIDGE_HOSTS } from '../../../templates/contextkit/runtime/hooks/host-adapter.mjs';
import { renderBridgeBody } from './render.mjs';

/** Reads `bridges.enabled` from the target's contextkit/config.json (BOM-safe). */
function readEnabledBridges(target) {
  try {
    const file = join(target, 'contextkit', 'config.json');
    if (!existsSync(file)) return [];
    const cfg = JSON.parse(readFileSync(file, 'utf-8').replace(/^﻿/, ''));
    return Array.isArray(cfg?.bridges?.enabled) ? cfg.bridges.enabled : [];
  } catch {
    return [];
  }
}

/**
 * Installs each enabled context bridge into `target`. Opt-in per tool; idempotent.
 * @param {string} target project root
 * @param {{ name?: string }} ctx install context (uses ctx.name for the heading)
 * @param {string[]} report mutated with progress lines
 */
export async function installBridges(target, ctx, report) {
  const enabled = readEnabledBridges(target);
  if (enabled.length === 0) return;

  for (const host of BRIDGE_HOSTS) {
    if (!enabled.includes(host.key)) continue;
    try {
      const mod = await import(`./${host.key}.mjs`);
      const body = renderBridgeBody({ name: ctx?.name, label: host.label });
      const res = await mod.installBridge(target, body, host);
      report.push(`✓ ${host.label} context bridge → ${res?.file || host.targetFile} (context-only, no enforcement)`);
    } catch (err) {
      report.push(`ℹ️  ${host.label} bridge skipped: ${err?.message ?? err}`);
    }
  }
  report.push('   ↳ bridges carry CONTEXT only — governance (hooks/gates) stays on the native hosts.');
}
