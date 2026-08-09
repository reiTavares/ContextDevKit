/** Focused install/update contract for ADR-0161 project personalization. */
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { KIT, reporter, run } from './it-helpers.mjs';
import { listOwnerPreferences } from '../templates/contextkit/runtime/preferences/owner-preferences.mjs';
import {
  OWNER_PREFERENCES_RELATIVE_PATH,
  PERSONALIZATION_END_MARKER,
  PERSONALIZATION_MARKDOWN_RELATIVE_PATH,
  PERSONALIZATION_START_MARKER,
} from './install/personalization.mjs';

const rep = reporter();
const sandbox = mkdtempSync(join(tmpdir(), 'contextkit-personalization-'));
const project = join(sandbox, 'project with spaces');
const backupRoot = mkdtempSync(join(tmpdir(), 'contextkit-personalization-backup-'));
mkdirSync(project, { recursive: true });

/**
 * Return every file under a directory without following non-directory entries.
 * @param {string} directory directory to enumerate
 * @returns {string[]} absolute file paths
 */
function walkFiles(directory) {
  const files = [];
  if (!statSync(directory).isDirectory()) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

/**
 * Execute the real installer with isolated backup storage.
 * @param {string[]} argumentsList installer arguments after the target
 * @returns {ReturnType<typeof run>} child-process receipt
 */
function install(argumentsList) {
  return run([join(KIT, 'install.mjs'), '--target', project, ...argumentsList, '--yes'], {
    cwd: KIT,
    env: { ...process.env, CONTEXTKIT_BACKUP_ROOT: backupRoot },
  });
}

/**
 * Count a literal marker without regex interpretation.
 * @param {string} text text to inspect
 * @param {string} token literal token
 * @returns {number} occurrence count
 */
function countLiteral(text, token) {
  return text.split(token).length - 1;
}

try {
  const fresh = install(['--level', '1', '--mode', 'existing', '--name', 'Personalization Fixture']);
  assert.equal(fresh.status, 0, `fresh install failed: ${fresh.stderr || fresh.stdout}`);

  const personalizationPath = join(project, ...PERSONALIZATION_MARKDOWN_RELATIVE_PATH.split('/'));
  const preferencesPath = join(project, ...OWNER_PREFERENCES_RELATIVE_PATH.split('/'));
  const auditPath = join(project, 'contextkit', 'memory', 'preferences', 'owner-preferences.audit.jsonl');
  const hostFiles = ['CLAUDE.md', 'AGENTS.md', 'INSTRUCTIONS.md'];
  assert.match(readFileSync(personalizationPath, 'utf8'), /User-owned project instructions/);
  const freshPreferences = listOwnerPreferences(project);
  assert.equal(freshPreferences.status, 'available');
  assert.equal(freshPreferences.authority, 'recommendation-only');
  assert.equal(freshPreferences.revision, 0);
  assert.deepEqual(freshPreferences.preferences, []);
  rep.ok('fresh install seeds personalization.md and reuses owner-preferences.json schema v1');

  for (const filename of hostFiles) {
    const content = readFileSync(join(project, filename), 'utf8');
    assert.equal(countLiteral(content, PERSONALIZATION_START_MARKER), 1, `${filename} start marker count`);
    assert.equal(countLiteral(content, PERSONALIZATION_END_MARKER), 1, `${filename} end marker count`);
    assert.ok(content.includes(PERSONALIZATION_MARKDOWN_RELATIVE_PATH), `${filename} Markdown reference`);
    assert.ok(content.includes(OWNER_PREFERENCES_RELATIVE_PATH), `${filename} JSON reference`);
    assert.match(content, /recommendation-only/);
  }
  rep.ok('Claude, Codex, and Antigravity roots cite both personalization files exactly once');

  const customMarkdown = '# Owner instructions\r\n\r\n- Preserve this exact CRLF content.\r\n';
  const customJson = '{ deliberately-invalid-but-user-owned-json-bytes }\r\n';
  const customAudit = '{"action":"owner-test","value":"preserve"}\r\n';
  writeFileSync(personalizationPath, customMarkdown, 'utf8');
  writeFileSync(preferencesPath, customJson, 'utf8');
  writeFileSync(auditPath, customAudit, 'utf8');

  const hostSnapshots = new Map();
  for (const filename of hostFiles) {
    const path = join(project, filename);
    const customized = `${readFileSync(path, 'utf8').replace(/\s+$/, '')}\n\nUSER-SENTINEL-${filename}\n`;
    writeFileSync(path, customized, 'utf8');
    hostSnapshots.set(filename, customized);
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const updated = install(['--update', '--allow-active-sessions']);
    assert.equal(updated.status, 0, `update ${attempt} failed: ${updated.stderr || updated.stdout}`);
    assert.equal(readFileSync(personalizationPath, 'utf8'), customMarkdown, `Markdown changed on update ${attempt}`);
    assert.equal(readFileSync(preferencesPath, 'utf8'), customJson, `JSON changed on update ${attempt}`);
    assert.equal(readFileSync(auditPath, 'utf8'), customAudit, `audit changed on update ${attempt}`);
    for (const filename of hostFiles) {
      assert.equal(readFileSync(join(project, filename), 'utf8'), hostSnapshots.get(filename), `${filename} changed outside/inside an already-current block`);
    }
  }
  rep.ok('two real updates preserve personalized bytes and user host prose exactly');

  const forced = install(['--force', '--level', '1', '--mode', 'existing', '--name', 'Personalization Fixture']);
  assert.equal(forced.status, 0, `forced reinstall failed: ${forced.stderr || forced.stdout}`);
  assert.equal(readFileSync(personalizationPath, 'utf8'), customMarkdown);
  assert.equal(readFileSync(preferencesPath, 'utf8'), customJson);
  assert.equal(readFileSync(auditPath, 'utf8'), customAudit);
  assert.equal(listOwnerPreferences(project).status, 'unavailable', 'invalid user JSON must be reported, not repaired');
  rep.ok('--force still preserves both user personalization files and the audit log');

  const backupFiles = walkFiles(backupRoot).map((path) => relative(backupRoot, path).replaceAll('\\', '/'));
  for (const requiredSuffix of [
    '/CLAUDE.md',
    '/AGENTS.md',
    '/INSTRUCTIONS.md',
    '/contextkit/memory/preferences/personalization.md',
    '/contextkit/memory/preferences/owner-preferences.json',
    '/contextkit/memory/preferences/owner-preferences.audit.jsonl',
  ]) {
    assert.ok(backupFiles.some((path) => path.endsWith(requiredSuffix)), `snapshot missing ${requiredSuffix}`);
  }
  rep.ok('pre-update external snapshots include host roots and personalization files');
} catch (error) {
  rep.bad(error.stack || error.message);
} finally {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(backupRoot, { recursive: true, force: true });
}

rep.finish('project personalization install/update');
