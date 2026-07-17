#!/usr/bin/env node
/**
 * ContextDevKit integration test — Domain Engineering distribution (WF-0068).
 *
 * BIZ-0003 shipped the domain-engineering capability (policy tables, devteam
 * skills, the two gate hooks) but the installer did NOT distribute the
 * `policy/domain-engineering|devteam|domain-artifacts/` subtrees or
 * `contextkit/skills/` — the known WF-0068 gap. This proves the fix end-to-end
 * on a REAL install, plus the reversible uninstall path:
 *
 *   1. install/marker  — a fresh L5 install lands all three domain policy subtrees,
 *                        the six devteam skills, and the two gate hooks in
 *                        .claude/settings.json (PreToolUse + PostToolUse at L≥4).
 *   2. block-proof(OFF) — the wired gate is default-OFF: with no domainEngineering
 *                        config, a write is NOT blocked (fail-open, inert).
 *   3. CLI             — the /domain diagnostic script runs against the install.
 *   4. update          — a second --update is non-destructive: the policy tables
 *                        + skills survive and settings stay wired.
 *   5. uninstall       — --purge removes the domain policy subtrees + skills and
 *                        strips the gate hooks from settings.json.
 *
 * Run:  node tools/integration-test-domain-distribution.mjs   (exit 0 = healthy)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, installFixture, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🧩 ContextDevKit integration test — Domain Engineering distribution (WF-0068)\n');

const fx = installFixture(rep);
try {
  const ck = (...p) => join(fx.proj, 'contextkit', ...p);

  // ── 1. install / marker — policy subtrees + skills present ────────────────
  const policySubtrees = [
    ['domain-engineering', 'policy-manifest.json'],
    ['devteam', 'skills-registry.json'],
    ['domain-artifacts', 'artifact-schemas.json'],
  ];
  for (const [sub, sentinel] of policySubtrees) {
    existsSync(ck('policy', sub, sentinel))
      ? ok(`fresh install lands policy/${sub}/${sentinel}`)
      : bad(`fresh install MISSING policy/${sub}/${sentinel} (distribution gap)`);
  }
  const skills = ['senior-implementation', 'domain-modeling', 'modular-design', 'ddd-architecture-review', 'domain-test-strategy', 'implementation-review'];
  const skillsPresent = skills.filter((s) => existsSync(ck('skills', s, 'SKILL.md')));
  skillsPresent.length === skills.length
    ? ok(`fresh install lands all ${skills.length} devteam skills (contextkit/skills)`)
    : bad(`fresh install missing skills: ${skills.filter((s) => !skillsPresent.includes(s)).join(', ')}`);

  // Both gate hooks wired at L5 in settings.json (PreToolUse + PostToolUse).
  const settingsPath = join(fx.proj, '.claude', 'settings.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : { hooks: {} };
  const cmds = (evt) => (settings.hooks?.[evt] || []).flatMap((g) => (g.hooks || []).map((h) => String(h.command || '')));
  cmds('PreToolUse').some((c) => c.includes('domain-code-gate.mjs'))
    ? ok('settings.json wires domain-code-gate.mjs (PreToolUse) at L5')
    : bad('settings.json does NOT wire domain-code-gate.mjs');
  cmds('PostToolUse').some((c) => c.includes('domain-conformance.mjs'))
    ? ok('settings.json wires domain-conformance.mjs (PostToolUse) at L5')
    : bad('settings.json does NOT wire domain-conformance.mjs');

  // ── 2. block-proof(OFF) — default-OFF ⇒ the gate is INERT (not just "no block") ─
  // A disabled gate returns before ANY output, so stdout must be empty — a stronger
  // claim than "no block token": it also rules out a stray advisory/nudge leaking on
  // a fresh install.
  // A PLAIN source path (.mjs, no /domain/ or /contracts/ or test/ substring) so
  // classifyPath resolves it to `source-code` (APPLICABLE) — not `domain-contract`,
  // which the path rules match on `/domain/` BEFORE the source extension and which
  // this gate treats as non-blockable. The ON arm below needs an applicable target.
  const writePayload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(fx.proj, 'src', 'order.mjs') } });
  const gate = run([ck('runtime', 'hooks', 'domain-code-gate.mjs')], { cwd: fx.proj, input: writePayload });
  (gate.stdout || '').trim() === '' && gate.status === 0
    ? ok('domain-code-gate is default-OFF: genuinely inert (empty stdout, exit 0) — not even an advisory')
    : bad(`domain-code-gate emitted output with no config (should be inert): status=${gate.status} out=${(gate.stdout || '').slice(0, 120)}`);

  // ── 2b. live-wire(ON) — enabling makes the gate ACTUALLY fire (not permanently dead) ─
  // The OFF test alone cannot tell "correctly inert" from "wired dead". Enable the
  // capability and re-run the identical payload: at L5 (guarded), a source write with
  // no owner/packet must produce a non-empty advisory — proving the installed I/O glue
  // (resolveDomainMode→buildImplementationBlock→evaluateCodeGate→emit) is live end-to-end.
  const cfgPath = join(fx.proj, 'contextkit', 'config.json');
  const baseCfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  writeFileSync(cfgPath, JSON.stringify({ ...baseCfg, domainEngineering: { enabled: true } }, null, 2) + '\n', 'utf-8');
  const gateOn = run([ck('runtime', 'hooks', 'domain-code-gate.mjs')], { cwd: fx.proj, input: writePayload });
  gateOn.status === 0 && (gateOn.stdout || '').trim() !== ''
    ? ok('domain-code-gate live-wire: enabling produces output (installed hook fires end-to-end, not dead)')
    : bad(`domain-code-gate stayed silent when enabled (wired dead?): status=${gateOn.status} out=${(gateOn.stdout || '').slice(0, 120)}`);
  writeFileSync(cfgPath, JSON.stringify(baseCfg, null, 2) + '\n', 'utf-8'); // restore default-OFF for the rest of the test

  // ── 3. CLI — the /domain diagnostic runs against the install ──────────────
  const diag = run([ck('tools', 'scripts', 'domain-inspect.mjs'), 'add a field to the checkout aggregate', '--json'], { cwd: fx.proj });
  let diagOk = false;
  try {
    const view = JSON.parse(diag.stdout);
    diagOk = diag.status === 0 && typeof view.mode === 'string' && view.block && typeof view.block.profile === 'string';
  } catch { /* diagOk stays false */ }
  diagOk ? ok('/domain diagnostic CLI runs and emits a classification view') : bad(`/domain CLI failed: status=${diag.status} out=${(diag.stdout || diag.stderr || '').slice(0, 160)}`);

  // ── 4. update — non-destructive: tables + skills survive, hooks stay wired ─
  // Tag one distributed file and prove --update refreshes kit code without loss.
  const manifestBefore = readFileSync(ck('policy', 'domain-engineering', 'policy-manifest.json'), 'utf-8');
  const upd = run([join(KIT, 'install.mjs'), '--target', fx.proj, '--update', '--yes']);
  upd.status === 0 ? ok('--update exits 0') : bad(`--update failed (status ${upd.status}): ${(upd.stderr || '').slice(0, 200)}`);
  existsSync(ck('policy', 'domain-engineering', 'policy-manifest.json')) && existsSync(ck('skills', 'domain-modeling', 'SKILL.md'))
    ? ok('--update preserves the domain policy tables + skills')
    : bad('--update dropped the domain policy tables or skills');
  // The manifest is kit code (always-overwrite), so --update may refresh it — but it
  // must remain VALID JSON with a stable schema, never truncated/corrupted by the update.
  let manifestValid = false;
  try {
    const m = JSON.parse(readFileSync(ck('policy', 'domain-engineering', 'policy-manifest.json'), 'utf-8'));
    manifestValid = m && typeof m === 'object' && !Array.isArray(m);
  } catch { /* manifestValid stays false */ }
  manifestValid
    ? ok(`domain policy-manifest is valid JSON after --update${readFileSync(ck('policy', 'domain-engineering', 'policy-manifest.json'), 'utf-8') === manifestBefore ? ' (byte-identical, idempotent)' : ' (refreshed — kit overwrite)'}`)
    : bad('--update left the domain policy-manifest missing or non-JSON');

  // ── 5. uninstall --purge — removes domain trees + strips gate hooks ───────
  const uninst = run([join(KIT, 'install.mjs'), '--target', fx.proj, '--uninstall', '--purge', '--yes']);
  uninst.status === 0 ? ok('uninstall --purge exits 0') : bad(`uninstall --purge failed (status ${uninst.status})`);
  const purgedAll = ['domain-engineering', 'devteam', 'domain-artifacts'].every((sub) => !existsSync(ck('policy', sub))) && !existsSync(ck('skills'));
  purgedAll
    ? ok('--purge removes ALL three domain policy subtrees + skills (reversible, symmetric with install)')
    : bad('--purge left a domain policy subtree or skills behind (asymmetric with install)');
  const afterSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : { hooks: {} };
  const afterCmds = Object.values(afterSettings.hooks || {}).flat().flatMap((g) => (g.hooks || []).map((h) => String(h.command || '')));
  !afterCmds.some((c) => c.includes('domain-code-gate.mjs') || c.includes('domain-conformance.mjs'))
    ? ok('uninstall strips both domain gate hooks from settings.json')
    : bad('uninstall left a domain gate hook wired in settings.json');
} catch (err) {
  bad(`unexpected failure: ${err && err.stack ? err.stack : err}`);
} finally {
  fx.cleanup();
}

rep.finish('Domain Engineering distribution (WF-0068)');
