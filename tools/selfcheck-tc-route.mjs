/**
 * Self-check — Task-Compiler execution router (WF0022 / ADR-0088).
 *
 * Verifies tc-route.mjs exports:
 *   1.  TC_ROUTE_SCHEMA_VERSION === 'cdk-tc-route/1'
 *   2.  ROUTE_LADDER frozen and ordered correctly
 *   3.  mechanical signals → SCRIPT_ONLY
 *   4.  low-complexity bounded → HAIKU (via fake model-policy)
 *   5.  default → SONNET
 *   6.  changedPublicContracts → OPUS
 *   7.  requiresSecurity → OPUS
 *   8.  irreversible+wide-blast → OPUS, humanAtRisk true
 *   9.  floor clamp: HAIKU lifted to OPUS when policy returns floor(reasoning)
 *  10.  advisory:true on every decision + all contract keys present
 *  11.  side-effect-free (two calls → identical output)
 *  12.  presentRoute contains route+advisory; null input → safe string
 *  13.  TypeError on null packet / null signals
 *  14.  // consumes: model-policy comment + TC_ROUTE_SCHEMA_VERSION in source
 *  15.  zero-dep invariant (node:/* and relative paths only)
 *
 * ADR-0088. Zero runtime dependencies — node:* only.
 */
import { readFile }                    from 'node:fs/promises';
import { resolve, dirname }            from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @param {string} label
 * @param {string} filePath
 * @param {{ ok: (m:string)=>void, bad: (m:string)=>void }} reporter
 */
async function checkZeroDep(label, filePath, { ok, bad }) {
  let src = '';
  try { src = await readFile(filePath, 'utf-8'); } catch (e) {
    bad(`${label}: cannot read — ${e?.message}`); return;
  }
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) {
      bad(`${label}: imports from "${m[1]}"`); return;
    }
  }
  ok(`${label}: zero-dep invariant`);
}

/** Build a fake model-policy override that returns a fixed tier (+ optional reasons). */
const fakePolicy = (tier, extra = []) => ({
  resolveModel: (_a, _o) => ({
    model:   { fast: 'haiku', powerful: 'sonnet', reasoning: 'opus' }[tier] ?? tier,
    tier, reasons: [`${tier}-tier`, ...extra], agent: _a,
  }),
});

const CONTRACT_KEYS = [
  'schemaVersion', 'route', 'confidence', 'signals', 'reasons',
  'requiredCapabilities', 'missingContext', 'escalationTriggers',
  'estimatedPacketSize', 'advisory', 'escalation',
];

/**
 * Assert all required contract keys present and advisory===true.
 * @param {object} decision
 * @param {string} label
 * @param {{ ok: (m:string)=>void, bad: (m:string)=>void }} reporter
 */
function assertContract(decision, label, { ok, bad }) {
  const miss = CONTRACT_KEYS.filter((k) => !(k in decision));
  miss.length === 0
    ? ok(`${label}: contract keys`)
    : bad(`${label}: missing ${JSON.stringify(miss)}`);
  decision.advisory === true
    ? ok(`${label}: advisory===true`)
    : bad(`${label}: advisory wrong`);
}

// ---------------------------------------------------------------------------
// Exported runner
// ---------------------------------------------------------------------------

/**
 * Runs Task-Compiler execution router self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcRouteChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler execution router (WF0022 / ADR-0088)...');

  const modPath  = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-route.mjs');
  const corePath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-route-core.mjs');

  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-route.mjs imports cleanly');
  } catch (e) {
    bad(`import failed: ${e?.message}`);
    return;
  }

  const { TC_ROUTE_SCHEMA_VERSION, ROUTE_LADDER, resolveExecution, presentRoute, _injectModelPolicyForTest } = lib;
  const STUB = Object.freeze({ schemaVersion: 'cdk-work-packet/1', objective: 'test' });

  // ── 1. Schema version ────────────────────────────────────────────────────
  TC_ROUTE_SCHEMA_VERSION === 'cdk-tc-route/1'
    ? ok('TC_ROUTE_SCHEMA_VERSION === "cdk-tc-route/1"')
    : bad(`schema version wrong: ${TC_ROUTE_SCHEMA_VERSION}`);

  // ── 2. ROUTE_LADDER ───────────────────────────────────────────────────────
  const ladderOk = Array.isArray(ROUTE_LADDER)
    && ['SCRIPT_ONLY', 'HAIKU', 'SONNET', 'OPUS'].every((t, i) => ROUTE_LADDER[i] === t)
    && Object.isFrozen(ROUTE_LADDER);
  ladderOk
    ? ok('ROUTE_LADDER frozen + ordered')
    : bad(`ROUTE_LADDER wrong: ${JSON.stringify(ROUTE_LADDER)}`);

  // ── 3. mechanical → SCRIPT_ONLY ──────────────────────────────────────────
  _injectModelPolicyForTest(fakePolicy('fast'));
  {
    const d = resolveExecution(STUB, { complexityTier: 'mechanical', risk: 'low', reversibility: 'reversible', blastRadius: 'local' });
    d.route === 'SCRIPT_ONLY'
      ? ok('mechanical → SCRIPT_ONLY')
      : bad(`expected SCRIPT_ONLY, got ${d.route}`);
    assertContract(d, 'SCRIPT_ONLY', { ok, bad });
  }

  // ── 4. bounded low-complexity → HAIKU ───────────────────────────────────
  {
    const d = resolveExecution(STUB, { complexityTier: 'moderate', risk: 'low', blastRadius: 'local', affectedFileCount: 1 });
    d.route === 'HAIKU'
      ? ok('bounded low-complexity → HAIKU')
      : bad(`expected HAIKU, got ${d.route}`);
    assertContract(d, 'HAIKU', { ok, bad });
  }

  // ── 5. default → SONNET ──────────────────────────────────────────────────
  _injectModelPolicyForTest(fakePolicy('powerful'));
  {
    const d = resolveExecution(STUB, { complexityTier: 'moderate' });
    d.route === 'SONNET'
      ? ok('default → SONNET')
      : bad(`expected SONNET, got ${d.route}`);
    assertContract(d, 'SONNET', { ok, bad });
  }

  // ── 6. changedPublicContracts → OPUS ─────────────────────────────────────
  _injectModelPolicyForTest(fakePolicy('reasoning'));
  {
    const d = resolveExecution(STUB, { changedPublicContracts: true });
    d.route === 'OPUS'
      ? ok('changedPublicContracts → OPUS')
      : bad(`expected OPUS, got ${d.route}`);
    d.reasons.includes('public-contract-change')
      ? ok('OPUS: public-contract-change reason')
      : bad('OPUS missing reason');
    assertContract(d, 'OPUS/contract', { ok, bad });
  }

  // ── 7. requiresSecurity → OPUS ───────────────────────────────────────────
  {
    const d = resolveExecution(STUB, { requiresSecurity: true });
    d.route === 'OPUS'
      ? ok('requiresSecurity → OPUS')
      : bad(`expected OPUS, got ${d.route}`);
    assertContract(d, 'OPUS/security', { ok, bad });
  }

  // ── 8. irreversible+wide-blast → OPUS, humanAtRisk true ─────────────────
  {
    const d = resolveExecution(STUB, { reversibility: 'irreversible', blastRadius: 'wide' });
    d.route === 'OPUS'
      ? ok('irreversible+wide → OPUS')
      : bad(`expected OPUS, got ${d.route}`);
    d.escalation?.humanAtRisk === true
      ? ok('OPUS: humanAtRisk===true')
      : bad(`humanAtRisk wrong: ${d.escalation?.humanAtRisk}`);
    assertContract(d, 'OPUS/irreversible', { ok, bad });
  }

  // ── 9. floor clamp: HAIKU → OPUS when policy returns floor(reasoning) ────
  _injectModelPolicyForTest(fakePolicy('reasoning', ['floor(reasoning)']));
  {
    const d = resolveExecution(STUB, { complexityTier: 'moderate', risk: 'low', blastRadius: 'local', affectedFileCount: 1 });
    d.route === 'OPUS'
      ? ok('floor clamp: HAIKU lifted to OPUS')
      : bad(`floor clamp expected OPUS, got ${d.route}`);
    const hasFloor = (d.reasons ?? []).some((r) => r.startsWith('floor-clamp'));
    hasFloor
      ? ok('floor clamp: floor-clamp reason present')
      : bad(`floor-clamp reason missing in ${JSON.stringify(d.reasons)}`);
  }

  // ── 10. advisory + contract keys already covered by assertContract above ──

  // ── 11. side-effect-free ──────────────────────────────────────────────────
  _injectModelPolicyForTest(fakePolicy('powerful'));
  {
    const sig = { complexityTier: 'moderate', affectedFileCount: 5 };
    JSON.stringify(resolveExecution(STUB, sig)) === JSON.stringify(resolveExecution(STUB, sig))
      ? ok('resolveExecution is side-effect-free (two calls identical)')
      : bad('resolveExecution not pure — second call differs');
  }

  // ── 12. presentRoute ──────────────────────────────────────────────────────
  {
    const d = resolveExecution(STUB, { complexityTier: 'moderate' });
    const s = presentRoute(d);
    typeof s === 'string' && s.includes('SONNET') && s.includes('advisory')
      ? ok('presentRoute contains route + advisory')
      : bad(`presentRoute missing fields:\n${s}`);
    presentRoute(null).startsWith('route-decision: invalid')
      ? ok('presentRoute(null) → safe string')
      : bad('presentRoute(null) did not return safe string');
  }

  // ── 13. TypeErrors ────────────────────────────────────────────────────────
  { let t = false; try { resolveExecution(null); } catch (e) { t = e instanceof TypeError; }
    t ? ok('TypeError on null packet') : bad('expected TypeError on null packet'); }
  { let t = false; try { resolveExecution(STUB, null); } catch (e) { t = e instanceof TypeError; }
    t ? ok('TypeError on null signals') : bad('expected TypeError on null signals'); }

  _injectModelPolicyForTest(null);

  // ── 14. Source assertions ─────────────────────────────────────────────────
  {
    const src = await readFile(modPath, 'utf-8');
    src.includes('consumes: model-policy')
      ? ok('"consumes: model-policy" comment present')
      : bad('"consumes: model-policy" missing');
    src.includes('TC_ROUTE_SCHEMA_VERSION')
      ? ok('TC_ROUTE_SCHEMA_VERSION in source')
      : bad('TC_ROUTE_SCHEMA_VERSION missing from source');
  }

  // ── 15. Zero-dep invariant ───────────────────────────────────────────────
  await checkZeroDep('tc-route.mjs', modPath, { ok, bad });
  await checkZeroDep('tc-route-core.mjs', corePath, { ok, bad });
}

// ---------------------------------------------------------------------------
// Standalone guard — mirrors selfcheck-tc-packet.mjs pattern
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (_m) => {};
  const bad = (m) => { failures++; console.error(`FAIL: ${m}`); };
  const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runTcRouteChecks({ ok, bad }, { KIT })
    .then(() => process.exit(failures ? 1 : 0))
    .catch((err) => { console.error('selfcheck-tc-route: unexpected error:', err); process.exit(1); });
}
