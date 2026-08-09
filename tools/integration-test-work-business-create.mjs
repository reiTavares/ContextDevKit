/**
 * ContextDevKit 4 Business creation integration test.
 *
 * Proves that Business identity is independent from execution shape, direct
 * creation is the default, and an explicitly requested workflow is published
 * as one complete Workflow v2 package in the same atomic rename.
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
import { join } from 'node:path';
import { reporter } from './it-helpers.mjs';
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
import { writeFileEnsured } from '../templates/contextkit/tools/scripts/work-io.mjs';
import { validatePack } from '../templates/contextkit/tools/scripts/workflow/validate.mjs';

const rep = reporter();
const root = mkdtempSync(join(tmpdir(), 'contextkit v4 business '));
const NOW = '2026-08-09T12:00:00.000Z';

/** Run one assertion while retaining every failure in the suite receipt. */
function check(label, assertion) {
  try {
    assertion();
    rep.ok(label);
  } catch (error) {
    rep.bad(`${label}: ${error?.message ?? error}`);
  }
}

/** Return every relative file path below a directory. */
function relativeFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...relativeFiles(absolutePath, relativePath));
    else if (entry.isFile()) files.push(relativePath.replaceAll('\\', '/'));
  }
  return files.sort();
}

try {
  check('direct is the default and never inferred as workflow from Business kind', () => {
    for (const [index, kind] of BUSINESS_KINDS.entries()) {
      const inputs = resolveBusinessCreateInputs({
        positionals: [`Direct ${kind}`],
        flags: { id: `BIZ-${String(9200 + index).padStart(4, '0')}`, kind },
        root,
      });
      assert.equal(inputs.ceremony, 'decision');
      const plan = planBusinessPackage({ inputs: { ...inputs, now: NOW }, root });
      assert.equal(plan.ceremony.executionMode, 'direct');
      assert.equal(plan.workflowSpec, null);
      assert.equal(plan.ceremonyDir, null);
    }
  });

  check('public ceremony mapping is direct or explicit Workflow v2 only', () => {
    assert.deepEqual(
      { mode: resolveBusinessCeremony('decision').executionMode, shape: resolveBusinessCeremony('decision').shape },
      { mode: 'direct', shape: 'business-direct' },
    );
    assert.deepEqual(
      { mode: resolveBusinessCeremony('workflow').executionMode, shape: resolveBusinessCeremony('workflow').shape },
      { mode: 'workflow', shape: 'workflow-v2' },
    );
    assert.throws(() => resolveBusinessCeremony('direct-business'), /not public/i);
  });

  check('dry-run plans without creating any artifact', () => {
    const receipt = handleBusinessCreate({
      positionals: ['Dry Run'],
      flags: { id: 'BIZ-9210', kind: 'FEATURE', now: NOW },
      apply: false,
      root,
    });
    assert.equal(receipt.applied, false);
    assert.deepEqual(receipt.detail.committedWrites, []);
    assert.equal(receipt.detail.ceremonyPath, null);
    assert.equal(existsSync(receipt.detail.target), false);
  });

  check('direct apply publishes one valid Business aggregate without a workflow authority', () => {
    const receipt = handleBusinessCreate({
      positionals: ['Direct Business'],
      flags: { id: 'BIZ-9211', kind: 'TRANSFORMATION', now: NOW },
      apply: true,
      root,
    });
    const business = JSON.parse(readFileSync(join(receipt.detail.target, 'business.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(validateBusiness(business).ok, true);
    assert.equal(receipt.detail.atomicity, 'sibling-staging-rename');
    assert.equal(receipt.detail.ceremonyPath, null);
    assert.deepEqual(readdirSync(join(receipt.detail.target, 'workflows')), []);
    assert.equal(relativeFiles(receipt.detail.target).some((path) => path === 'workflow-plan.json'), false);
  });

  check('explicit workflow apply publishes a complete valid Workflow v2 below its owner', () => {
    const receipt = handleBusinessCreate({
      positionals: ['Governed Delivery'],
      flags: { id: 'BIZ-9212', kind: 'PROGRAMME', ceremony: 'workflow', now: NOW },
      apply: true,
      root,
    });
    const verdict = validatePack(receipt.detail.ceremonyPath);
    assert.equal(verdict.valid, true, verdict.errors.map((entry) => entry.message).join('; '));
    const definition = JSON.parse(readFileSync(join(receipt.detail.ceremonyPath, 'workflow.json'), 'utf8'));
    const state = JSON.parse(readFileSync(join(receipt.detail.ceremonyPath, 'workflow-state.json'), 'utf8'));
    const tasks = JSON.parse(readFileSync(join(receipt.detail.ceremonyPath, 'pipeline', 'tasks.json'), 'utf8'));
    assert.deepEqual(definition.owner, { kind: 'business', id: 'BIZ-9212' });
    assert.equal(state.workflowId, definition.id);
    assert.equal(tasks.scopeRef, definition.id);
    assert.equal(tasks.schemaVersion, 2);
    assert.equal(existsSync(join(receipt.detail.ceremonyPath, 'reports')), true);
    assert.equal(relativeFiles(receipt.detail.ceremonyPath).includes('workflow-plan.json'), false);
  });

  check('collision refuses without overwriting the first aggregate', () => {
    const first = handleBusinessCreate({
      positionals: ['Original'],
      flags: { id: 'BIZ-9213', kind: 'FEATURE', now: NOW },
      apply: true,
      root,
    });
    assert.throws(() => handleBusinessCreate({
      positionals: ['Replacement'],
      flags: { id: 'BIZ-9213', kind: 'FEATURE', now: NOW },
      apply: true,
      root,
    }), /already occupied/i);
    const preserved = JSON.parse(readFileSync(join(first.detail.target, 'business.json'), 'utf8'));
    assert.equal(preserved.title, 'Original');
  });

  check('injected staging failure leaves neither a target nor a staging sidecar', () => {
    const inputs = resolveBusinessCreateInputs({
      positionals: ['Rollback'],
      flags: { id: 'BIZ-9214', kind: 'INITIATIVE', ceremony: 'workflow' },
      root,
    });
    const plan = planBusinessPackage({ inputs: { ...inputs, now: NOW }, root });
    let writes = 0;
    assert.throws(() => applyBusinessPackage(plan, {
      writeFile: (path, content) => {
        writes += 1;
        if (writes === 2) throw new Error('injected staging failure');
        writeFileEnsured(path, content);
      },
    }), /injected staging failure/i);
    assert.equal(existsSync(plan.targetDir), false);
    const leftovers = existsSync(pathsFor(root).business)
      ? readdirSync(pathsFor(root).business).filter((name) => name.includes('staging'))
      : [];
    assert.deepEqual(leftovers, []);
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

rep.finish('ContextDevKit 4 Business create');
