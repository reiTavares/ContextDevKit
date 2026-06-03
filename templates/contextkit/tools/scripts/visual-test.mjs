#!/usr/bin/env node
/**
 * Visual / browser-driven testing harness — scaffolder (roadmap #6).
 *
 * The kit does NOT bundle or run the browser runner (Playwright/Selenium are heavy
 * PROJECT dependencies that download real browsers) — it SCAFFOLDS a starter and the
 * project owns the runner. Stack-aware: JS (@playwright/test) + Python
 * (pytest-playwright). Zero-dependency, defensive, write-if-missing.
 *
 *   visual-test.mjs status [--json]            # is a visual harness set up here?
 *   visual-test.mjs scaffold [--js | --python] # write a starter (won't clobber)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ROOT = process.cwd();
const has = (p) => existsSync(resolve(ROOT, p));
const read = (p) => {
  try {
    return readFileSync(resolve(ROOT, p), 'utf-8');
  } catch {
    return '';
  }
};
const readJson = (p) => {
  try {
    return JSON.parse(read(p).replace(/^﻿/, ''));
  } catch {
    return null;
  }
};

const JS_CONFIGS = ['playwright.config.js', 'playwright.config.ts', 'playwright.config.mjs', 'cypress.config.js'];

function detectStacks() {
  const stacks = [];
  // A stack counts if its manifest exists OR a visual harness is already scaffolded
  // (so `status` recognizes an existing harness even in a bare project).
  if (has('package.json') || JS_CONFIGS.some(has)) stacks.push('js');
  if (has('pyproject.toml') || has('requirements.txt') || has('tests/visual/conftest.py')) stacks.push('python');
  return stacks;
}

function jsStatus() {
  const pkg = readJson('package.json') || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  return {
    runner: deps.cypress ? 'cypress' : 'playwright-js',
    dep: !!(deps['@playwright/test'] || deps.playwright || deps.cypress),
    config: JS_CONFIGS.some(has),
  };
}

function pyStatus() {
  const text = read('pyproject.toml') + read('requirements.txt');
  return { runner: 'playwright-python', dep: /pytest-playwright|playwright|selenium/.test(text), config: has('tests/visual') };
}

function buildStatus() {
  const stacks = detectStacks();
  const report = {
    stacks,
    js: stacks.includes('js') ? jsStatus() : null,
    python: stacks.includes('python') ? pyStatus() : null,
  };
  report.set = !!((report.js && (report.js.dep || report.js.config)) || (report.python && (report.python.dep || report.python.config)));
  return report;
}

function writeIfMissing(rel, content) {
  const abs = resolve(ROOT, rel);
  if (existsSync(abs)) return [];
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
  return [rel];
}

function scaffoldJs() {
  const esm = (readJson('package.json') || {}).type === 'module';
  const config = esm
    ? `import { defineConfig, devices } from '@playwright/test';\n\nexport default defineConfig({\n  testDir: './tests/visual',\n  use: { baseURL: process.env.BASE_URL || 'http://localhost:3000' },\n  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],\n});\n`
    : `const { defineConfig, devices } = require('@playwright/test');\n\nmodule.exports = defineConfig({\n  testDir: './tests/visual',\n  use: { baseURL: process.env.BASE_URL || 'http://localhost:3000' },\n  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],\n});\n`;
  const spec = `import { test, expect } from '@playwright/test';\n\n// Visual baseline. The first run creates the snapshot; later runs diff against it.\n// Update intentionally with:  npx playwright test --update-snapshots\ntest('home page — visual baseline', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveScreenshot('home.png', { maxDiffPixelRatio: 0.01 });\n});\n`;
  return [...writeIfMissing('playwright.config.js', config), ...writeIfMissing('tests/visual/home.spec.js', spec)];
}

function scaffoldPython() {
  const conftest = `import os\nimport pytest\n\n\n@pytest.fixture(scope="session")\ndef base_url():\n    return os.environ.get("BASE_URL", "http://localhost:3000")\n`;
  const test = `# Visual baseline with pytest-playwright. Install:\n#   pip install pytest-playwright && playwright install chromium\n# Run:  pytest tests/visual\nimport pathlib\n\nSNAP = pathlib.Path(__file__).parent / "__screenshots__"\n\n\ndef test_home_visual_baseline(page, base_url):\n    SNAP.mkdir(exist_ok=True)\n    page.goto(base_url)\n    # First run writes the baseline; later runs compare. Swap in your team's\n    # visual-diff assertion (e.g. pytest-playwright-visual) when you adopt one.\n    page.screenshot(path=str(SNAP / "home.png"))\n`;
  return [...writeIfMissing('tests/visual/conftest.py', conftest), ...writeIfMissing('tests/visual/test_home_visual.py', test)];
}

function runScaffold(only) {
  const stacks = only ? [only] : detectStacks().length ? detectStacks() : ['js'];
  const written = [];
  for (const s of stacks) written.push(...(s === 'python' ? scaffoldPython() : scaffoldJs()));
  if (written.length === 0) {
    console.log('🖼️  visual-test: starter already present (nothing written).');
    return;
  }
  console.log(`🖼️  visual-test: scaffolded ${written.length} file(s):`);
  for (const w of written) console.log(`   + ${w}`);
  console.log('\nNext — install the runner (a PROJECT dependency, never the kit):');
  if (stacks.includes('js')) console.log('   npm i -D @playwright/test && npx playwright install chromium');
  if (stacks.includes('python')) console.log('   pip install pytest-playwright && playwright install chromium');
  console.log('   Point baseURL / BASE_URL at your running app, then run the visual suite.');
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd === 'status') {
    const report = buildStatus();
    if (args.includes('--json')) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      return;
    }
    console.log(`🖼️  visual-test status — stacks: ${report.stacks.join(', ') || 'none'}`);
    if (report.js) console.log(`   JS:     runner=${report.js.runner} dep=${report.js.dep} config=${report.js.config}`);
    if (report.python) console.log(`   Python: dep=${report.python.dep} layout=${report.python.config}`);
    console.log(report.set ? '   ✓ a visual harness looks set up.' : '   ✗ no visual harness yet — run: visual-test.mjs scaffold');
    return;
  }
  if (cmd === 'scaffold') {
    runScaffold(args.includes('--python') ? 'python' : args.includes('--js') ? 'js' : null);
    return;
  }
  console.error('Usage: visual-test.mjs <status [--json] | scaffold [--js|--python]>');
  process.exit(1);
}

main();
