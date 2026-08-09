/**
 * Self-check — Economy Runtime auto-activation defaults (ADR-0103).
 *
 * Asserts that defaults-economy.mjs carries the explicit auto-activation
 * contract introduced alongside the economy stack going ON-by-default:
 *   - `autoActivate` is present and === true
 *   - `tools` sub-object is frozen with all 5 levers present and === true
 *   - The existing master `enabled` flag is still present and === true
 *   - The root object itself is frozen (Object.isFrozen)
 *
 * Eight assertions total. Zero runtime dependencies — node:* only.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Runs economy auto-activation defaults self-checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root (templates/ lives here)
 * @returns {Promise<void>}
 */
export async function runEconomyAutoActivateChecks({ ok, bad }, { KIT }) {
  console.log('Checking economy auto-activation defaults (ADR-0103)...');

  const defaultsPath = resolve(
    KIT,
    'templates/contextkit/runtime/config/defaults-economy.mjs',
  );

  let mod;
  try {
    mod = await import(pathToFileURL(defaultsPath).href);
    ok('defaults-economy.mjs imports cleanly');
  } catch (err) {
    bad(`defaults-economy.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const { ECONOMY_CONFIG_DEFAULTS: d } = mod;

  // Assert 1 — master switch present and ON (unchanged existing key)
  d?.enabled === true
    ? ok('economy defaults: enabled === true (master switch present and ON)')
    : bad(`economy defaults: enabled should be true, got ${d?.enabled}`);

  // Assert 2 — root object is frozen
  Object.isFrozen(d)
    ? ok('economy defaults: root ECONOMY_CONFIG_DEFAULTS is frozen')
    : bad('economy defaults: ECONOMY_CONFIG_DEFAULTS is NOT frozen');

  // Assert 3 — autoActivate present and true
  d?.autoActivate === true
    ? ok('economy defaults: autoActivate === true (session-start activation ON by default)')
    : bad(`economy defaults: autoActivate should be true, got ${d?.autoActivate}`);

  // Assert 4 — tools sub-object exists and is frozen
  d?.tools !== null && typeof d?.tools === 'object' && Object.isFrozen(d.tools)
    ? ok('economy defaults: tools sub-object present and frozen')
    : bad('economy defaults: tools sub-object missing or not frozen');

  // Assert 5-9 — each of the 5 economy levers is present and true
  const levers = /** @type {const} */ ([
    'find', 'runCompact', 'workPacket', 'subagentProfile', 'loopBreaker',
  ]);
  for (const lever of levers) {
    d?.tools?.[lever] === true
      ? ok(`economy defaults: tools.${lever} === true`)
      : bad(`economy defaults: tools.${lever} should be true, got ${d?.tools?.[lever]}`);
  }
}
