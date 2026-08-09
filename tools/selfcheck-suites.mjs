#!/usr/bin/env node
/**
 * Suite-registry completeness check.
 *
 * Every top-level integration entrypoint must be registered, every registered
 * file must exist, and suite ids must be unique. Focused sibling selfchecks may
 * live anywhere; existence is verified directly instead of through a manual
 * exception list that can preserve removed contracts by accident.
 */
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allSuites } from './test-suites.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOOLS_DIRECTORY = resolve(KIT, 'tools');
const MIN_SUITES = 60;
let failures = 0;

const ok = (message) => console.log(`  ✓ ${message}`);
const bad = (message) => {
  console.error(`  ✗ ${message}`);
  failures += 1;
};

/** Discover user-runnable aggregate suite entrypoints. */
function discoverSuiteFiles() {
  return readdirSync(TOOLS_DIRECTORY)
    .filter((name) => name === 'selfcheck.mjs'
      || (name.startsWith('integration-test') && name.endsWith('.mjs') && !name.endsWith('-helpers.mjs')))
    .map((name) => `tools/${name}`)
    .sort();
}

function main() {
  console.log('\nContextDevKit suite-registry check\n');
  const onDisk = discoverSuiteFiles();
  const suites = allSuites();
  const listedFiles = new Set(suites.map((suite) => suite.file));

  const missingRegistrations = onDisk.filter((file) => !listedFiles.has(file));
  if (missingRegistrations.length === 0) ok(`every top-level suite (${onDisk.length}) is registered`);
  else bad(`top-level suite(s) are unregistered: ${missingRegistrations.join(', ')}`);

  if (onDisk.length >= MIN_SUITES) ok(`suite count ${onDisk.length} ≥ floor ${MIN_SUITES}`);
  else bad(`only ${onDisk.length} top-level suites exist; floor is ${MIN_SUITES}`);

  const vanished = suites
    .map((suite) => suite.file)
    .filter((file) => !existsSync(resolve(KIT, file)));
  if (vanished.length === 0) ok('every registered suite file exists');
  else bad(`registered suite(s) point at missing files: ${vanished.join(', ')}`);

  const ids = suites.map((suite) => suite.id);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  if (duplicates.length === 0) ok('suite ids are unique');
  else bad(`duplicate suite id(s): ${duplicates.join(', ')}`);

  console.log(failures === 0 ? '\nSuite registry passed.\n' : `\n${failures} suite-registry check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
