/**
 * Fixture loader — reads sanitized synthetic usage events from JSON files.
 *
 * These fixtures are SYNTHETIC and SANITIZED (no real transcript content).
 * They prove the measurement PIPELINE is correct on known inputs — they do NOT
 * validate that any real baseline (e.g., provisional ~US$36k gross-cache-value)
 * describes reality (panel QA#11, ADR-0078/0080). Any claim leaning on baselines
 * stays `inferred`, never "fixture-tested."
 *
 * Fixtures model a cache-heavy long session SHAPE (~95% cache-read share) only
 * as a structural shape to exercise the pipeline's arithmetic correctly.
 *
 * Zero runtime dependencies — plain Node.js ESM, node:* only.
 *
 * @returns {{ delta: Array, cumulative: Array, golden: Object }} Parsed fixture objects
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parses a JSON file, stripping UTF-8 BOM if present.
 *
 * @param {string} filePath - Absolute path to JSON file
 * @returns {any} Parsed JSON object
 * @throws {SyntaxError} if JSON is invalid
 */
function parseJsonFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  // Strip UTF-8 BOM (U+FEFF) if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  return JSON.parse(content);
}

/**
 * Loads the three fixture files (delta, cumulative, golden) from disk.
 * Returns them as an object keyed by fixture type.
 *
 * @export
 * @returns {{ delta: Array, cumulative: Array, golden: Object }}
 */
export function loadFixtures() {
  const deltaPath = path.join(__dirname, 'usage-delta.json');
  const cumulativePath = path.join(__dirname, 'usage-cumulative.json');
  const goldenPath = path.join(__dirname, 'golden.json');

  const delta = parseJsonFile(deltaPath);
  const cumulative = parseJsonFile(cumulativePath);
  const golden = parseJsonFile(goldenPath);

  return { delta, cumulative, golden };
}
