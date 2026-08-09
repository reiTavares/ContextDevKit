/**
 * integration-test-ci-squad.mjs — F5 / ADR-0064.
 *
 * Verifies the CI Squad GitHub Action ships OPT-IN: a default install must NOT
 * drop `squad-issue.yml` (it costs API credits + needs a repo secret), while
 * `--ci-squad` installs it. Also asserts the template's safety invariants — it
 * fires only on the `squad-ready` label, always opens a DRAFT PR (human merge),
 * and requires the ANTHROPIC_API_KEY secret.
 */
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reporter, installFixture, run, git, KIT } from './it-helpers.mjs';

const rep = reporter();

// 1. Default install (no --ci-squad) omits the opt-in action but keeps the rest.
const fx = installFixture(rep);
const wfDir = join(fx.proj, '.github', 'workflows');
!existsSync(join(wfDir, 'squad-issue.yml')) ? rep.ok('1. default install omits squad-issue.yml (opt-in)') : rep.bad('1. squad-issue.yml installed without consent');
existsSync(join(wfDir, 'quality.yml')) ? rep.ok('1b. default install still ships the standard workflows') : rep.bad('1b. quality.yml missing from default install');
fx.cleanup();

// 2. --ci-squad opts in.
const proj = mkdtempSync(join(tmpdir(), 'contextkit-cisquad-'));
git(['init', '-b', 'main'], proj);
git(['config', 'user.email', 'it@example.com'], proj);
git(['config', 'user.name', 'IT'], proj);
const inst = run([join(KIT, 'install.mjs'), '--target', proj, '--level', '5', '--name', 'CI', '--yes', '--ci-squad']);
inst.status === 0 ? rep.ok('2. install --ci-squad succeeds') : rep.bad(`2. install --ci-squad failed (status ${inst.status}): ${inst.stderr}`);
const squad = join(proj, '.github', 'workflows', 'squad-issue.yml');
existsSync(squad) ? rep.ok('2b. --ci-squad installs squad-issue.yml') : rep.bad('2b. --ci-squad did not install squad-issue.yml');

// 3. Template safety invariants.
const yml = existsSync(squad) ? readFileSync(squad, 'utf-8') : '';
/squad-ready/.test(yml) ? rep.ok('3. workflow is gated on the squad-ready label') : rep.bad('3. missing squad-ready label gate');
/--draft/.test(yml) ? rep.ok('3b. opens a DRAFT PR (human merge stays required)') : rep.bad('3b. PR is not created as a draft');
/ANTHROPIC_API_KEY/.test(yml) ? rep.ok('3c. requires the ANTHROPIC_API_KEY secret') : rep.bad('3c. missing ANTHROPIC_API_KEY reference');

rmSync(proj, { recursive: true, force: true });
rep.finish('CI Squad (F5)');
