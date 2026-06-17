/**
 * Shared helpers for dogfood-tarball.mjs packaging/upgrade test harness.
 *
 * Cohesion note: all helpers here are exclusively consumed by the tarball
 * harness — they form a single cohesive test-support unit and would be
 * premature to split further. (Kept < 280 lines per constitution.)
 */
import { mkdtempSync, writeFileSync, mkdirSync, statSync, readdirSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Lightweight assert: throws with message on falsy condition.
 * @param {boolean} cond
 * @param {string} message
 */
export function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Temp-dir management
// ---------------------------------------------------------------------------

/** Tracks all temp dirs created so the caller can clean them up. */
const _tmpDirs = [];

/**
 * Creates a mkdtemp directory under os.tmpdir(), registers it for cleanup.
 * @param {string} prefix
 * @returns {string} absolute path
 */
export function makeTmp(prefix = 'cdk-test-') {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  _tmpDirs.push(dir);
  return dir;
}

/**
 * Returns all temp dirs created via makeTmp().
 * @returns {string[]}
 */
export function allTmpDirs() {
  return [..._tmpDirs];
}

// ---------------------------------------------------------------------------
// Project simulation helpers
// ---------------------------------------------------------------------------

/**
 * Seeds a directory with stub source files to simulate an existing project.
 * @param {string} dir
 */
export function seedProject(dir) {
  writeFileSync(join(dir, 'index.js'), '// stub entry\nconsole.log("hello");\n');
  writeFileSync(join(dir, 'README.md'), '# Test project\n');
}

/**
 * Plants two "active" session ledger files in <projectDir>/.claude/.sessions/
 * to simulate the DEFERRED_ACTIVE_SESSIONS scenario.
 * @param {string} projectDir
 */
export function plantActiveSessions(projectDir) {
  const sessDir = join(projectDir, '.claude', '.sessions');
  mkdirSync(sessDir, { recursive: true });
  // Session 1: has activeTask → active
  writeFileSync(join(sessDir, 'session-aaa.json'), JSON.stringify({
    sessionId: 'session-aaa',
    registered: false,
    activeTask: 'running-hotfix',
    modifications: ['file.js'],
  }));
  // Session 2: unregistered + modifications → active
  writeFileSync(join(sessDir, 'session-bbb.json'), JSON.stringify({
    sessionId: 'session-bbb',
    registered: false,
    activeTask: '',
    modifications: ['other.js'],
  }));
}

// ---------------------------------------------------------------------------
// npm pack + tarball helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, sep);

/**
 * Runs `npm pack` in the repo root, returns the tarball path.
 * @returns {{ tgzPath: string, tgzName: string }}
 */
export function runNpmPack() {
  const result = spawnSync('npm', ['pack', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true,
  });
  if (result.status !== 0) throw new Error(`npm pack failed:\n${result.stderr}`);
  let tgzName;
  try {
    const parsed = JSON.parse(result.stdout.trim());
    tgzName = Array.isArray(parsed) ? parsed[0].filename : parsed.filename;
  } catch {
    tgzName = result.stdout.trim().split('\n').pop().trim();
  }
  return { tgzPath: join(REPO_ROOT, tgzName), tgzName };
}

/**
 * Extracts a .tgz into destDir.
 *
 * On win32 uses the Windows built-in bsdtar (C:\Windows\System32\tar.exe) which
 * accepts Windows-style drive-letter paths natively. Git Bash's /usr/bin/tar does
 * not: it misinterprets "D:\path" as hostname "D" and fails with "Cannot connect".
 *
 * @param {string} tgzPath  - absolute path to the .tgz (Windows or POSIX style)
 * @param {string} destDir  - destination directory (must exist)
 */
export function extractTarball(tgzPath, destDir) {
  const tarBin = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\tar.exe'
    : 'tar';
  const result = spawnSync(tarBin, ['-xzf', tgzPath, '-C', destDir], {
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`tar extract failed:\n${result.stderr || result.stdout}`);
  }
}

// ---------------------------------------------------------------------------
// Installer invocation helpers
// ---------------------------------------------------------------------------

/**
 * Runs the packaged install.mjs from an extracted tarball directory.
 *
 * Uses shell: false so paths with spaces are passed as atomic arguments and are
 * not split by the shell. On Windows, node.exe is resolved from PATH directly.
 *
 * @param {string} packageDir - path containing install.mjs (package/ subdir after npm pack)
 * @param {string[]} extraArgs
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
export function runInstaller(packageDir, extraArgs = []) {
  const installerPath = join(packageDir, 'install.mjs');
  // shell: false is critical on Windows — shell: true routes through cmd.exe which
  // splits unquoted paths on spaces, breaking --target "path with spaces".
  const result = spawnSync(process.execPath, [installerPath, ...extraArgs], {
    encoding: 'utf8',
    shell: false,
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ---------------------------------------------------------------------------
// Assertion utilities
// ---------------------------------------------------------------------------

/**
 * Asserts a file exists at the given path; throws descriptively on failure.
 * @param {string} filePath
 * @param {string} label
 */
export function assertFileExists(filePath, label) {
  assert(existsSync(filePath), `Expected file to exist: ${label} (${filePath})`);
}

/**
 * Reads mtime of a file (ms).
 * @param {string} filePath
 * @returns {number}
 */
export function getMtime(filePath) {
  return statSync(filePath).mtimeMs;
}

/**
 * Reads all forward-slash normalised paths found under `dir` (recursively).
 * @param {string} dir
 * @returns {string[]}
 */
export function walkRelative(dir) {
  const results = [];
  if (!existsSync(dir)) return results;
  function walk(current, rel) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), entryRel);
      else results.push(entryRel);
    }
  }
  walk(dir, '');
  return results;
}

export { REPO_ROOT };
