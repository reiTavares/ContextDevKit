/**
 * Doctor config-health checks — extracted from doctor.mjs to keep that CLI under
 * the 308-line budget (constitution §1). Two distinct concerns over config.json:
 * path-rot (dead paths from a renamed dir) and v3.0.0 path-collapse corruption.
 *
 * Each check takes a small reporter context `{ ROOT, pass, fail, note }` so the
 * single severity counter + exit decision stay in doctor.mjs.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfigSync } from '../../runtime/config/load.mjs';
import { runConfigHealth, summarizeForDoctor, CONFIG_HEALTH_STATES } from './config-health.mjs';

/**
 * Config path-rot guard (ticket 145). A renamed platform dir / moved file leaves
 * config.json pointing at dead paths, and consumers fail SILENTLY. Registration
 * rot is CRITICAL (breaks an L2 contract); the gate/QA lists are advisory (L4/L5).
 * @param {{ ROOT: string, pass: Function, fail: Function, note: Function }} ctx
 */
export function checkConfigPathRot({ ROOT, pass, fail, note }) {
  const cfg = loadConfigSync(ROOT);
  const probe = (entries, label, report) => {
    const missing = (entries ?? []).filter((p) => !existsSync(resolve(ROOT, p)));
    if (missing.length === 0) {
      if ((entries ?? []).length > 0) pass(`${label} paths all exist on disk`);
      return;
    }
    report(`${label} points at nonexistent path(s): ${missing.join(', ')}`, 'edit contextkit/config.json — was the platform dir or file renamed/moved? (e.g. a vibekit-era install)');
  };
  probe(cfg?.ledger?.registration, 'ledger.registration', fail);
  probe(cfg?.l5?.highRiskPaths, 'l5.highRiskPaths', note);
  probe(cfg?.qa?.criticalPaths, 'qa.criticalPaths', note);
}

/**
 * v3.0.0 config-corruption guard (P0 hotfix 3.0.1). Detects path lists that
 * collapsed to bare `contextkit/` entries and points at the safe recovery path.
 * Advisory (never fails doctor) — the user decides whether to restore.
 * @param {{ ROOT: string, pass: Function, note: Function }} ctx
 */
export function checkConfigCorruption({ ROOT, pass, note }) {
  const result = runConfigHealth(ROOT, { repair: false });
  if (result.status === CONFIG_HEALTH_STATES.HEALTHY || result.status === CONFIG_HEALTH_STATES.SKIPPED) {
    if (result.status === CONFIG_HEALTH_STATES.HEALTHY) pass('config.json free of v3.0.0 path-collapse corruption');
    return;
  }
  const s = summarizeForDoctor(result);
  note(s.message, s.fix);
}
