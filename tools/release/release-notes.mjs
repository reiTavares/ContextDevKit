#!/usr/bin/env node
/** Extracts one complete, authoritative product changelog section for release. */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Validates the exact release version accepted by the changelog extractor.
 * @param {string} version release version without the leading `v`
 * @returns {string} validated version
 * @throws {TypeError} when the version is not SemVer
 */
export function validateReleaseVersion(version) {
  if (typeof version !== 'string' || !SEMVER_PATTERN.test(version)) {
    throw new TypeError(`invalid release version: ${String(version)}`);
  }
  return version;
}

/**
 * Extracts an exact `## [version]` block through the next level-two heading.
 * @param {{changelogText:string, version:string}} options changelog input
 * @returns {string} complete version section including its heading
 * @throws {Error} when the section is missing, duplicated, or substantively empty
 */
export function extractReleaseNotes({ changelogText, version }) {
  validateReleaseVersion(version);
  if (typeof changelogText !== 'string') throw new TypeError('changelogText must be a string');
  const normalized = changelogText.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const headings = [...normalized.matchAll(/^## \[([^\]]+)](?: - \d{4}-\d{2}-\d{2})?[ \t]*$/gm)];
  const matches = headings.filter((heading) => heading[1] === version);
  if (matches.length !== 1) {
    throw new Error(`CHANGELOG.md must contain exactly one ## [${version}] section; found ${matches.length}`);
  }
  const start = matches[0].index;
  const afterHeading = start + matches[0][0].length;
  const nextHeading = /^## /gm;
  nextHeading.lastIndex = afterHeading;
  const following = nextHeading.exec(normalized);
  const section = normalized.slice(start, following?.index ?? normalized.length).trim();
  if (!/^### /m.test(section) || !/^- /m.test(section)) {
    throw new Error(`CHANGELOG.md ## [${version}] has no categorized release entries`);
  }
  return `${section}\n`;
}

/**
 * Confirms that the tag-derived version matches the npm package version.
 * @param {{packageText:string, version:string}} options package JSON input
 * @returns {void}
 * @throws {Error} when package JSON is invalid or carries another version
 */
export function assertPackageVersion({ packageText, version }) {
  let manifest;
  try {
    manifest = JSON.parse(String(packageText).replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`package manifest is invalid JSON: ${error.message}`, { cause: error });
  }
  if (manifest.version !== version) {
    throw new Error(`tag/changelog version ${version} does not match package version ${String(manifest.version)}`);
  }
}

/**
 * Writes validated release notes through a same-directory atomic rename.
 * @param {{changelogPath:string, packagePath:string, outputPath:string, version:string}} options file inputs
 * @returns {{version:string,outputPath:string,bytes:number}} render receipt
 * @throws {Error} when validation or atomic output fails
 */
export function renderReleaseNotesFile({ changelogPath, packagePath, outputPath, version }) {
  const validatedVersion = validateReleaseVersion(version);
  const absoluteOutput = resolve(outputPath);
  const notes = extractReleaseNotes({
    changelogText: readFileSync(resolve(changelogPath), 'utf8'),
    version: validatedVersion,
  });
  assertPackageVersion({
    packageText: readFileSync(resolve(packagePath), 'utf8'),
    version: validatedVersion,
  });
  mkdirSync(dirname(absoluteOutput), { recursive: true });
  const temporaryOutput = `${absoluteOutput}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryOutput, notes, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryOutput, absoluteOutput);
  } catch (error) {
    rmSync(temporaryOutput, { force: true });
    throw error;
  }
  return { version: validatedVersion, outputPath: absoluteOutput, bytes: Buffer.byteLength(notes) };
}

/** Parses the deliberately small release CLI without accepting unknown flags. */
function parseArguments(argumentsList) {
  const values = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const flag = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!['--version', '--changelog', '--package', '--output'].includes(flag) || value === undefined) {
      throw new Error('usage: release-notes.mjs --version X.Y.Z --changelog CHANGELOG.md --package package.json --output <path>');
    }
    if (values.has(flag)) throw new Error(`duplicate argument: ${flag}`);
    values.set(flag, value);
  }
  for (const required of ['--version', '--changelog', '--package', '--output']) {
    if (!values.has(required)) throw new Error(`missing required argument: ${required}`);
  }
  return values;
}

function main() {
  const argumentsMap = parseArguments(process.argv.slice(2));
  const receipt = renderReleaseNotesFile({
    version: argumentsMap.get('--version'),
    changelogPath: argumentsMap.get('--changelog'),
    packagePath: argumentsMap.get('--package'),
    outputPath: argumentsMap.get('--output'),
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`release-notes: ${error.message}`);
    process.exitCode = 1;
  }
}
