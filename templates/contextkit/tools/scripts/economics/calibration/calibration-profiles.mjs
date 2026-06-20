/**
 * calibration-profiles.mjs — Session Autonomy Receipt: calibration reader.
 *
 * Loads the versioned, scoped calibration profiles (calibration-profiles.json)
 * and matches a session's task profile against them. This is the mechanism that
 * lets the estimator apply the WF0018 #242 pilot result ONLY to compatible task
 * profiles (spec §6.2, §12) — and NEVER as a global `DEFAULT_AUTONOMY_MULTIPLIER`
 * (#24). No compatible profile → no calibration → the estimator must return
 * `insufficient-evidence`.
 *
 * Defensive I/O (constitution §8, immutable rule 2): a missing/malformed file
 * degrades to "no profiles", never throws on the hot path. Zero deps; the file
 * is read with node:fs only. Deterministic: no Date.now()/Math.random().
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Canonical schema id for the calibration-profiles document. */
export const CALIBRATION_PROFILES_SCHEMA_VERSION = 'cdk-calibration-profiles/1';

/** Minimum similarity for a profile to be considered a match (0..1). */
export const DEFAULT_MATCH_THRESHOLD = 0.6;

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(HERE, 'calibration-profiles.json');

/** Strips a UTF-8 BOM so JSON.parse never chokes (immutable rule 4). */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Loads calibration profiles from disk. Never throws.
 * @param {string} [filePath] override path (defaults to the shipped JSON).
 * @returns {{ schemaVersion: string, updated: string|null,
 *   profiles: object[] }} an empty profile set when the file is absent/invalid.
 */
export function loadCalibrationProfiles(filePath = DEFAULT_PATH) {
  try {
    const parsed = JSON.parse(stripBom(readFileSync(filePath, 'utf8')));
    const profiles = Array.isArray(parsed.profiles) ? parsed.profiles : [];
    return {
      schemaVersion: typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : null,
      updated: typeof parsed.updated === 'string' ? parsed.updated : null,
      profiles,
    };
  } catch {
    return { schemaVersion: null, updated: null, profiles: [] };
  }
}

/** Clamps repo-size proximity into a 0..1 score (1 = same order of magnitude). */
function sizeProximity(sessionLoc, calibLoc) {
  if (!Number.isFinite(sessionLoc) || !Number.isFinite(calibLoc) || sessionLoc <= 0 || calibLoc <= 0) {
    return 0;
  }
  const ratio = sessionLoc > calibLoc ? calibLoc / sessionLoc : sessionLoc / calibLoc;
  return ratio; // 1.0 when equal, → 0 as they diverge by orders of magnitude
}

/**
 * Scores how well a session's task profile matches a calibration profile.
 * Weighted: language (0.45) + taskType (0.35) + repo-size proximity (0.20).
 * Missing session signals lower the score (conservative — never inflate a match).
 *
 * @param {{ language?: string, taskType?: string, repoSizeLoc?: number,
 *   framework?: string }} sessionProfile
 * @param {object} calibProfile a profile entry's `.profile` block.
 * @returns {number} similarity in [0,1].
 */
export function profileSimilarity(sessionProfile, calibProfile) {
  const session = (sessionProfile && typeof sessionProfile === 'object') ? sessionProfile : {};
  const calib = (calibProfile && typeof calibProfile === 'object') ? calibProfile : {};
  let score = 0;

  if (typeof session.language === 'string' && typeof calib.language === 'string') {
    if (session.language.toLowerCase() === calib.language.toLowerCase()) score += 0.45;
  }
  if (typeof session.taskType === 'string' && typeof calib.taskType === 'string') {
    if (session.taskType.toLowerCase() === calib.taskType.toLowerCase()) score += 0.35;
  }
  score += 0.20 * sizeProximity(Number(session.repoSizeLoc), Number(calib.repoSizeLoc));
  return score;
}

/**
 * Selects the best-matching calibration profile for a session, if any clears
 * the threshold. Returns the FULL profile entry (carrying claim:null, the scoped
 * multiplier and bounds) plus the similarity — or a null match when nothing is
 * compatible, which the estimator reads as `insufficient-evidence`.
 *
 * @param {object} sessionProfile the session's detected task profile.
 * @param {object[]} [profiles] profile entries (defaults to the shipped set).
 * @param {{ threshold?: number }} [opts]
 * @returns {{ matched: boolean, profile: object|null, similarity: number,
 *   calibrationId: string|null }}
 */
export function matchProfile(sessionProfile, profiles, opts = {}) {
  const list = Array.isArray(profiles) ? profiles : loadCalibrationProfiles().profiles;
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : DEFAULT_MATCH_THRESHOLD;

  let best = null;
  let bestScore = -1;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const score = profileSimilarity(sessionProfile, entry.profile);
    if (score > bestScore) { bestScore = score; best = entry; }
  }

  if (best === null || bestScore < threshold) {
    return { matched: false, profile: null, similarity: Math.max(0, bestScore), calibrationId: null };
  }
  return {
    matched: true,
    profile: best,
    similarity: bestScore,
    calibrationId: typeof best.calibrationId === 'string' ? best.calibrationId : null,
  };
}
