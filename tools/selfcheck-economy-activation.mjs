/**
 * Self-check — economy session-start activation (economy-session-activation.mjs).
 *
 * Asserts the module that the SessionStart hook calls to auto-activate the economy
 * stack guidance: isEconomyActive defaults true; economyActivationSection returns a
 * frozen guidance section mentioning --find / run-compact / work-packet by default,
 * and null when disabled via economy.enabled or economy.autoActivate; schema version;
 * zero-dep invariant.
 *
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — verifies a module imports only node:* / relative specifiers. */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); }
  catch (err) { return { error: `could not read: ${err?.message ?? err}` }; }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) return { error: `imports from "${spec}"` };
  }
  return { error: null };
}

/**
 * Runs the economy session-activation self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEconomyActivationChecks({ ok, bad }, { KIT }) {
  console.log('Checking economy session-start activation (economy-session-activation.mjs)...');
  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/economy-session-activation.mjs');

  let lib;
  try { lib = await import(pathToFileURL(modPath).href); ok('economy-session-activation.mjs imports cleanly'); }
  catch (err) { bad(`economy-session-activation.mjs import failed: ${err?.message ?? err}`); return; }

  const { ECONOMY_ACTIVATION_SCHEMA_VERSION, isEconomyActive, economyActivationSection } = lib;

  ECONOMY_ACTIVATION_SCHEMA_VERSION === 'cdk-economy-activation/1'
    ? ok('activation: SCHEMA_VERSION === "cdk-economy-activation/1"')
    : bad(`activation: SCHEMA_VERSION is "${ECONOMY_ACTIVATION_SCHEMA_VERSION}"`);

  // ── isEconomyActive ───────────────────────────────────────────────────────
  isEconomyActive({}) === true && isEconomyActive(undefined) === true
    ? ok('isEconomyActive: defaults to true (no config / empty config)')
    : bad('isEconomyActive: should default true');
  isEconomyActive({ economy: { enabled: false } }) === false
    ? ok('isEconomyActive: economy.enabled=false → false') : bad('isEconomyActive: enabled=false should be false');
  isEconomyActive({ economy: { autoActivate: false } }) === false
    ? ok('isEconomyActive: economy.autoActivate=false → false') : bad('isEconomyActive: autoActivate=false should be false');

  // ── economyActivationSection ──────────────────────────────────────────────
  const section = economyActivationSection({});
  section && section.kind === 'economy' && typeof section.title === 'string' && Array.isArray(section.lines)
    ? ok('economyActivationSection: default → {kind:economy, title, lines[]}')
    : bad(`economyActivationSection: default shape wrong: ${JSON.stringify(section)?.slice(0, 160)}`);

  const text = (section?.lines || []).join('\n');
  /--find/.test(text) && /run-compact/.test(text) && /work-packet/i.test(text)
    ? ok('economyActivationSection: guidance mentions --find + run-compact + work-packet')
    : bad(`economyActivationSection: guidance missing a tool: ${text.slice(0, 200)}`);

  Object.isFrozen(section)
    ? ok('economyActivationSection: section is frozen') : bad('economyActivationSection: should be frozen');

  economyActivationSection({ economy: { enabled: false } }) === null
    ? ok('economyActivationSection: economy.enabled=false → null') : bad('economyActivationSection: enabled=false should be null');
  economyActivationSection({ economy: { autoActivate: false } }) === null
    ? ok('economyActivationSection: economy.autoActivate=false → null') : bad('economyActivationSection: autoActivate=false should be null');

  // ── Zero-dep invariant ────────────────────────────────────────────────────
  const zd = await checkModuleZeroDep(modPath);
  zd.error ? bad(`zero-dep: economy-session-activation.mjs ${zd.error}`)
           : ok('zero-dep invariant: economy-session-activation.mjs imports only node:/* or relative paths');
}
