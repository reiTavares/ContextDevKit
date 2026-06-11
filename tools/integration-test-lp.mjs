#!/usr/bin/env node
/**
 * Integration test — landing-page scaffold + build (ADR-0050).
 *
 * Sibling of integration-test-tooling.mjs (own file by design: the shared test
 * files are owned by parallel workstreams — ADR-0050 §Coordination). Installs a
 * throwaway project, scaffolds the componentized LP source, builds the atomic
 * dist/ and asserts the ADR's contract: consent ships ON, GTM is ID-less,
 * pixels stay commented models, legal drafts carry the lawyer disclaimer, the
 * --check gate refuses placeholder content and passes once content is real.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFixture, reporter } from './it-helpers.mjs';

const rep = reporter();
console.log('\n🌐 Integration — landing scaffold + build (ADR-0050)\n');
const fx = installFixture(rep);
const lpDir = join(fx.proj, 'lp');
const read = (...parts) => readFileSync(join(...parts), 'utf-8');

try {
  // ---- scaffold: componentized source, write-if-missing -------------------
  const scaffold = fx.script('lp-scaffold.mjs');
  scaffold.status === 0 ? rep.ok('lp-scaffold exits 0') : rep.bad(`lp-scaffold failed: ${scaffold.stderr}`);
  const sections = existsSync(join(lpDir, 'sections')) ? readdirSync(join(lpDir, 'sections')) : [];
  sections.length === 7 ? rep.ok('7 fold files scaffolded (one per file — componentized)') : rep.bad(`expected 7 sections, got ${sections.length}`);
  for (const file of ['content/copy.json', 'content/legal.json', 'partials/consent.html', 'js/consent.js', 'js/tracking-models.js']) {
    existsSync(join(lpDir, file)) ? rep.ok(`${file} present`) : rep.bad(`missing ${file}`);
  }
  const sentinel = read(lpDir, 'content', 'copy.json');
  writeFileSync(join(lpDir, 'content', 'copy.json'), sentinel, 'utf-8'); // touch to prove user-ownership…
  const rescaffold = fx.script('lp-scaffold.mjs');
  /skipped|kept/.test(rescaffold.stdout) || rescaffold.stdout.includes('kept')
    ? rep.ok('re-scaffold keeps existing files untouched (write-if-missing)')
    : rep.bad('re-scaffold did not report kept files');

  // ---- build with placeholders: --check must REFUSE (rule 8) --------------
  const buildDirty = fx.script('lp-build.mjs', '--check');
  buildDirty.status === 1 ? rep.ok('--check refuses placeholder content (exit 1)') : rep.bad(`--check passed on [PREENCHA] content (status ${buildDirty.status})`);

  // ---- fill content deterministically, rebuild: gate must PASS ------------
  for (const jsonFile of ['copy.json', 'legal.json']) {
    const filled = read(lpDir, 'content', jsonFile).replaceAll('[PREENCHA] ', '');
    writeFileSync(join(lpDir, 'content', jsonFile), filled, 'utf-8');
  }
  const buildClean = fx.script('lp-build.mjs', '--check');
  buildClean.status === 0 ? rep.ok('--check passes once content is filled (seo-audit + aiso-audit clean on dist/)') : rep.bad(`--check failed on filled content: ${buildClean.stdout}`);

  // ---- the ADR-0050 contract on the built page ----------------------------
  const dist = join(lpDir, 'dist');
  const index = read(dist, 'index.html');
  index.includes('id="lp-consent"') ? rep.ok('consent banner ships in the page (default ON)') : rep.bad('consent banner missing from dist/index.html');
  /consent.*default.*denied|ad_storage: 'denied'/s.test(index) ? rep.ok('Consent Mode defaults to denied') : rep.bad('no denied-by-default consent push');
  !/gtm\.js\?id=GTM-[A-Z0-9]+/.test(index) ? rep.ok('GTM snippet carries no hardcoded container id') : rep.bad('a real GTM id is hardcoded in the page');
  index.includes('"gtmId":""') ? rep.ok('client config ships with empty gtmId (inert GTM)') : rep.bad('client config gtmId not empty');
  !existsSync(join(dist, 'js', 'tracking-models.js')) ? rep.ok('tracking models are NOT shipped to dist (docs, not payload)') : rep.bad('tracking-models.js leaked into dist');
  const models = read(lpDir, 'js', 'tracking-models.js');
  const executable = models.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  !/fbq\(|ttq\.|_linkedin/.test(executable) ? rep.ok('pixel models are commented out (never executable)') : rep.bad('an executable pixel call exists in tracking-models.js');
  for (const legalPage of ['privacidade.html', 'termos.html']) {
    const html = read(dist, legalPage);
    html.includes('revise com um advogado') ? rep.ok(`${legalPage} carries the lawyer-review disclaimer`) : rep.bad(`${legalPage} lost the disclaimer`);
  }
  for (const metaFile of ['robots.txt', 'sitemap.xml', 'llms.txt']) {
    existsSync(join(dist, metaFile)) ? rep.ok(`${metaFile} emitted`) : rep.bad(`missing ${metaFile} in dist`);
  }
  index.includes('"@type": "FAQPage"') ? rep.ok('FAQPage JSON-LD generated from copy.json') : rep.bad('FAQPage JSON-LD missing');

  // ---- copy/structure split: edit copy.json → value lands in dist ---------
  const copyPath = join(lpDir, 'content', 'copy.json');
  const copyJson = JSON.parse(read(copyPath));
  copyJson.hero.title = 'Round-trip prova o split copy/estrutura';
  writeFileSync(copyPath, JSON.stringify(copyJson, null, 2), 'utf-8');
  fx.script('lp-build.mjs');
  read(dist, 'index.html').includes('Round-trip prova o split copy/estrutura')
    ? rep.ok('copy.json edit lands in dist on rebuild (the token-economy seam)')
    : rep.bad('copy.json round-trip failed');

  // ---- fold selection ------------------------------------------------------
  const partial = fx.script('lp-scaffold.mjs', '--dir', 'lp3', '--folds', 'hero,solution,footer-cta');
  const lp3Sections = readdirSync(join(fx.proj, 'lp3', 'sections'));
  partial.status === 0 && lp3Sections.length === 3
    ? rep.ok('--folds scaffolds only the selected folds (3-fold minimum shape)')
    : rep.bad(`--folds selection wrong (${lp3Sections.length} sections)`);
} finally {
  fx.cleanup();
}

rep.finish('Landing scaffold integration');
