/**
 * Integration test — P0-05 safe-writes: atomicWriteIfChanged + wireClaudeSettings
 * idempotency (3.1.2 updater-safety hotfix).
 *
 * Scenarios:
 *   A. UNCHANGED — identical content must not change mtime
 *   B. CHANGED — different content must update the file atomically (no .tmp-* leftover)
 *   C. MALFORMED — invalid-JSON settings.json is recovered by wireClaudeSettings
 *
 * Standalone: exits 0 on pass, 1 on any failure. No kit install needed.
 */
import { mkdtempSync, statSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';
import { atomicWriteIfChanged } from './install/fs.mjs';
import { wireClaudeSettings } from './install/claude.mjs';

const rep = reporter();

const tmp = () => mkdtempSync(join(tmpdir(), 'contextkit-sw-'));
const read = (p) => readFileSync(p, 'utf-8');

// ── A. UNCHANGED: identical content must not touch mtime ─────────────────────
await (async () => {
  const dir = tmp();
  try {
    const filePath = join(dir, 'test.json');
    const content = '{"key":"value"}\n';
    writeFileSync(filePath, content, 'utf-8');

    const mtimeBefore = statSync(filePath).mtimeMs;

    // Tiny OS-tick gap so the clock WOULD advance if a write occurred.
    await new Promise((r) => setTimeout(r, 20));

    const result = await atomicWriteIfChanged(filePath, content);

    result.written === false
      ? rep.ok('UNCHANGED: returned { written: false }')
      : rep.bad('UNCHANGED: returned { written: true } — should have skipped');

    const mtimeAfter = statSync(filePath).mtimeMs;
    mtimeAfter === mtimeBefore
      ? rep.ok('UNCHANGED: mtimeMs is identical (no write occurred)')
      : rep.bad(`UNCHANGED: mtime changed ${mtimeBefore} → ${mtimeAfter} (spurious write)`);

    read(filePath) === content
      ? rep.ok('UNCHANGED: file content byte-identical')
      : rep.bad('UNCHANGED: file content mutated');
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();

// ── B. CHANGED: different content must write atomically, no .tmp-* leftover ──
await (async () => {
  const dir = tmp();
  try {
    const filePath = join(dir, 'test.json');
    const original = '{"key":"old"}\n';
    const updated = '{"key":"new"}\n';
    writeFileSync(filePath, original, 'utf-8');

    const result = await atomicWriteIfChanged(filePath, updated);

    result.written === true
      ? rep.ok('CHANGED: returned { written: true }')
      : rep.bad('CHANGED: returned { written: false } — should have written');

    read(filePath) === updated
      ? rep.ok('CHANGED: file content updated correctly')
      : rep.bad(`CHANGED: file content wrong — got "${read(filePath).trim()}"`);

    // No .tmp-* sibling must linger after a successful atomic write.
    const leftover = readdirSync(dir).filter((n) => n.includes('.tmp-'));
    leftover.length === 0
      ? rep.ok('CHANGED: no leftover .tmp-* sibling files')
      : rep.bad(`CHANGED: leftover tmp file(s): ${leftover.join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();

// ── B2. NEW FILE: atomicWriteIfChanged must write when path does not exist ───
await (async () => {
  const dir = tmp();
  try {
    const filePath = join(dir, 'brand-new.json');
    const content = '{"brand":"new"}\n';

    const result = await atomicWriteIfChanged(filePath, content);

    result.written === true
      ? rep.ok('NEW FILE: returned { written: true }')
      : rep.bad('NEW FILE: returned { written: false } — should have written new file');

    existsSync(filePath) && read(filePath) === content
      ? rep.ok('NEW FILE: content written correctly')
      : rep.bad('NEW FILE: file missing or content wrong');
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();

// ── C. MALFORMED: wireClaudeSettings recovers and report notes the issue ─────
await (async () => {
  const dir = tmp();
  try {
    // wireClaudeSettings expects .claude/settings.json under target.
    const claudeDir = join(dir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.json');

    writeFileSync(settingsPath, '{ INVALID JSON !!!', 'utf-8');

    const report = [];
    await wireClaudeSettings(dir, 5, report);

    const malformedNote = report.some((l) => l.includes('malformed'));
    malformedNote
      ? rep.ok('MALFORMED: report contains malformed-recovery note')
      : rep.bad(`MALFORMED: report missing malformed note — got: ${JSON.stringify(report)}`);

    // The file must now contain valid JSON (the recovered settings).
    let parsed;
    try { parsed = JSON.parse(read(settingsPath)); } catch { parsed = null; }
    parsed !== null && typeof parsed === 'object'
      ? rep.ok('MALFORMED: settings.json recovered to valid JSON')
      : rep.bad('MALFORMED: settings.json still not valid JSON after recovery');

    const wiredNote = report.some((l) => l.includes('wired for L5'));
    wiredNote
      ? rep.ok('MALFORMED: report contains "wired for L5" confirmation')
      : rep.bad(`MALFORMED: report missing wired confirmation — got: ${JSON.stringify(report)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();

// ── C2. IDEMPOTENT: wireClaudeSettings called twice → second call is no-op ───
await (async () => {
  const dir = tmp();
  try {
    const claudeDir = join(dir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    const settingsPath = join(claudeDir, 'settings.json');

    const report1 = [];
    await wireClaudeSettings(dir, 5, report1);

    const mtime1 = statSync(settingsPath).mtimeMs;

    await new Promise((r) => setTimeout(r, 20));

    const report2 = [];
    await wireClaudeSettings(dir, 5, report2);

    const mtime2 = statSync(settingsPath).mtimeMs;

    mtime2 === mtime1
      ? rep.ok('IDEMPOTENT: second wireClaudeSettings call did not change mtime')
      : rep.bad(`IDEMPOTENT: mtime changed on second call ${mtime1} → ${mtime2}`);

    report2.some((l) => l.includes('already current'))
      ? rep.ok('IDEMPOTENT: second call reports "already current"')
      : rep.bad(`IDEMPOTENT: second call missing "already current" — got: ${JSON.stringify(report2)}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
})();

rep.finish('Safe Writes & Host Settings (P0-05 / 3.1.2 hotfix)');
