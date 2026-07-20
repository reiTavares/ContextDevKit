/**
 * Integration tests for the WF-0082 Business create command.
 *
 * Covers the public ceremony contract, the closed Business kind enum, dry-run
 * safety, decision/workflow structure validation, collision refusal, and
 * aggregate rollback after an injected staging failure.
 *
 * Standalone: node tools/integration-test-work-business-create.mjs
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reporter } from './it-helpers.mjs';
import { installEngine } from '../tools/install/engine.mjs';
import { pathsFor } from '../templates/contextkit/runtime/config/paths.mjs';
import { BUSINESS_KINDS } from '../templates/contextkit/runtime/work/enums.mjs';
import { validateBusiness } from '../templates/contextkit/runtime/work/schema-business.mjs';
import {
  applyBusinessPackage,
  handleBusinessCreate,
  planBusinessPackage,
  resolveBusinessCeremony,
  resolveBusinessCreateInputs,
} from '../templates/contextkit/tools/scripts/work-business-create.mjs';
import { buildBusinessPrompt } from '../templates/contextkit/tools/scripts/business-templates.mjs';
import { dispatch } from '../templates/contextkit/tools/scripts/work.mjs';
import { writeFileEnsured } from '../templates/contextkit/tools/scripts/work-io.mjs';
import { validatePlan } from '../templates/contextkit/tools/scripts/workflow/validate.mjs';
import { validateStructure } from '../templates/contextkit/methodology/validate-structure.mjs';

const rep = reporter();
const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const root = mkdtempSync(join(tmpdir(), 'contextkit-business-create-'));

/**
 * Recursively collect regular files for token assertions.
 * @param {string} directory directory to scan
 * @returns {string[]} absolute file paths
 */
function filesUnder(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

/**
 * Run one assertion and report the outcome without hiding the failure detail.
 * @param {string} label assertion label
 * @param {() => void} assertion assertion callback
 * @returns {void}
 */
function check(label, assertion) {
  try {
    assertion();
    rep.ok(label);
  } catch (error) {
    rep.bad(`${label}: ${error?.message ?? error}`);
  }
}

/**
 * Run an asynchronous assertion and keep its failure in the suite receipt.
 *
 * @param {string} label assertion label
 * @param {() => Promise<void>} assertion asynchronous assertion callback
 * @returns {Promise<void>}
 */
async function asyncCheck(label, assertion) {
  try {
    await assertion();
    rep.ok(label);
  } catch (error) {
    rep.bad(`${label}: ${error?.message ?? error}`);
  }
}

try {
  await asyncCheck('clean install distributes methodology for installed work command', async () => {
    const installRoot = mkdtempSync(join(tmpdir(), 'contextkit-business-install-'));
    try {
      const report = [];
      const sync = { manifest: { files: {} }, nextFiles: {}, conflicts: [], pendingMerges: 0 };
      await installEngine(installRoot, join(KIT, 'templates'), {
        name: 'Install Probe',
        level: 7,
        version: 'test',
        args: { force: false },
        sync,
      }, report);
      const installedMethodology = join(installRoot, 'contextkit', 'methodology', 'templates', 'manifest.json');
      const installedWork = join(installRoot, 'contextkit', 'tools', 'scripts', 'work.mjs');
      assert.equal(existsSync(installedMethodology), true);
      const { dispatch: installedDispatch } = await import(`${pathToFileURL(installedWork).href}?install-probe=${Date.now()}`);
      assert.equal(typeof installedDispatch, 'function');
    } finally {
      rmSync(installRoot, { recursive: true, force: true });
    }
  });

  check('decision maps to decision-only/business-decision', () => {
    const ceremony = resolveBusinessCeremony('decision');
    assert.equal(ceremony.shape, 'decision-only');
    assert.equal(ceremony.journeyBranch, 'business-decision');
  });

  check('workflow maps to multi-workflow-program/business-workflow', () => {
    const ceremony = resolveBusinessCeremony('workflow');
    assert.equal(ceremony.shape, 'multi-workflow-program');
    assert.equal(ceremony.journeyBranch, 'business-workflow');
  });

  check('direct-business is rejected as a public ceremony', () => {
    assert.throws(
      () => resolveBusinessCeremony('direct-business'),
      /direct-business.*not public/i,
    );
  });

  check('all five persisted Business kinds are accepted', () => {
    for (const [index, kind] of BUSINESS_KINDS.entries()) {
      const inputs = resolveBusinessCreateInputs({
        positionals: [`Kind ${kind}`],
        flags: { kind, id: `BIZ-${String(9110 + index).padStart(4, '0')}` },
        root,
      });
      assert.equal(inputs.kind, kind);
    }
  });

  check('human Business template renders the authoritative kind list', () => {
    const template = buildBusinessPrompt('business-case');
    assert.equal(template.includes(`[FILL: ${BUSINESS_KINDS.join(' | ')}]`), true);
  });

  check('lowercase and classifier kinds are rejected', () => {
    assert.throws(
      () => resolveBusinessCreateInputs({ positionals: ['Bad kind'], flags: { kind: 'capability' }, root }),
      /--kind.*TRANSFORMATION.*INITIATIVE/i,
    );
    assert.throws(
      () => resolveBusinessCreateInputs({ positionals: ['Missing kind'], flags: {}, root }),
      /--kind is required/i,
    );
  });

  check('dry-run leaves no target and reports no committed writes', () => {
    const receipt = handleBusinessCreate({
      positionals: ['Dry Run'],
      flags: { kind: 'FEATURE', ceremony: 'decision', id: 'BIZ-9120' },
      apply: false,
      root,
    });
    assert.equal(receipt.applied, false);
    assert.deepEqual(receipt.detail.committedWrites, []);
    assert.equal(existsSync(receipt.detail.target), false);
  });

  check('dispatcher wires business create without applying by default', () => {
    const receipt = dispatch(
      { command: 'business', positionals: ['Dispatch Dry Run'], flags: { kind: 'ENABLER', id: 'BIZ-9121' } },
      { root },
    );
    assert.equal(receipt.command, 'business');
    assert.equal(receipt.applied, false);
    assert.equal(existsSync(receipt.detail.target), false);
  });

  check('decision apply produces a schema- and structure-valid aggregate', () => {
    const receipt = handleBusinessCreate({
      positionals: ['Decision Package'],
      flags: { kind: 'TRANSFORMATION', ceremony: 'decision', id: 'BIZ-9122' },
      apply: true,
      root,
    });
    const businessPath = join(receipt.detail.target, 'business.json');
    const business = JSON.parse(readFileSync(businessPath, 'utf-8'));
    assert.equal(validateBusiness(business).ok, true);
    assert.equal(business.kind, 'TRANSFORMATION');
    assert.equal(validateStructure(receipt.detail.ceremonyPath, 'decision-only').ok, true);
    assert.equal(existsSync(join(receipt.detail.ceremonyPath, 'decision-record.md')), true);
    assert.deepEqual(readdirSync(join(receipt.detail.target, 'workflows')), ['.gitkeep']);
  });

  check('workflow apply produces a complete WF pack under the Business workflows root', () => {
    const receipt = handleBusinessCreate({
      positionals: ['Workflow Package'],
      flags: { kind: 'PROGRAMME', ceremony: 'workflow', id: 'BIZ-9123' },
      apply: true,
      root,
    });
    const structure = validateStructure(receipt.detail.ceremonyPath, 'multi-workflow-program');
    assert.equal(structure.ok, true, structure.errors.join('; '));
    const workflowPlan = JSON.parse(readFileSync(join(receipt.detail.ceremonyPath, 'workflow-plan.json'), 'utf-8'));
    assert.equal(validatePlan(workflowPlan).valid, true);
    for (const filePath of filesUnder(receipt.detail.ceremonyPath)) {
      assert.equal(readFileSync(filePath, 'utf-8').includes('{{'), false, `unresolved token in ${filePath}`);
    }
    assert.match(receipt.detail.ceremonyPath.replaceAll('\\', '/'), /\/workflows\/WF-\d{4}-workflow-package$/);
  });

  check('declared continuation validator refuses malformed workflow output', () => {
    const inputs = resolveBusinessCreateInputs({
      positionals: ['Malformed Continuation'],
      flags: { kind: 'FEATURE', ceremony: 'workflow', id: 'BIZ-9127' },
      root,
    });
    const plan = planBusinessPackage({ inputs, root });
    const continuation = plan.files.find((file) => file.relativePath === 'CONTINUATION-PROMPT.md');
    continuation.content = '# malformed continuation\n';
    assert.throws(
      () => applyBusinessPackage(plan),
      /continuation-sections validation failed/i,
    );
    assert.equal(existsSync(plan.targetDir), false);
  });

  check('collision refuses without overwriting the first aggregate', () => {
    const first = handleBusinessCreate({
      positionals: ['Original Package'],
      flags: { kind: 'FEATURE', ceremony: 'decision', id: 'BIZ-9124' },
      apply: true,
      root,
    });
    assert.throws(
      () => handleBusinessCreate({
        positionals: ['Replacement Package'],
        flags: { kind: 'FEATURE', ceremony: 'decision', id: 'BIZ-9124' },
        apply: true,
        root,
      }),
      /already occupied/i,
    );
    const preserved = JSON.parse(readFileSync(join(first.detail.target, 'business.json'), 'utf-8'));
    assert.equal(preserved.title, 'Original Package');
  });

  check('injected staging failure leaves no published tree or residual staging directory', () => {
    const inputs = resolveBusinessCreateInputs({
      positionals: ['Rollback Package'],
      flags: { kind: 'INITIATIVE', ceremony: 'workflow', id: 'BIZ-9125' },
      root,
    });
    const plan = planBusinessPackage({ inputs, root });
    let writeCount = 0;
    assert.throws(
      () => applyBusinessPackage(plan, {
        writeFile: (filePath, content) => {
          writeCount += 1;
          if (writeCount === 2) throw new Error('injected staging failure');
          writeFileEnsured(filePath, content);
        },
      }),
      /injected staging failure/i,
    );
    assert.equal(existsSync(plan.targetDir), false);
    const businessRoot = pathsFor(root).business;
    const leftovers = existsSync(businessRoot)
      ? readdirSync(businessRoot).filter((name) => name.includes('staging'))
      : [];
    assert.deepEqual(leftovers, []);
  });

  check('missing methodology skeleton refuses before any apply', () => {
    const inputs = resolveBusinessCreateInputs({
      positionals: ['Missing Template'],
      flags: { kind: 'ENABLER', ceremony: 'decision', id: 'BIZ-9126' },
      root,
    });
    assert.throws(
      () => planBusinessPackage({ inputs, root, methodologyRoot: join(root, 'missing-methodology') }),
      /skeleton is unavailable/i,
    );
    assert.equal(existsSync(join(pathsFor(root).business, 'BIZ-9126-missing-template')), false);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

rep.finish('WF-0082 business create');
