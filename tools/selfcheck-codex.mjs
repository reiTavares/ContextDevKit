/**
 * Self-check — Codex host invariants.
 *
 * Keeps the third host honest without growing the already-large source checker:
 * hook composition, generated skill/subagent parity, and core template presence.
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function listMdFiles(dir, base = dir) {
  let out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(await listMdFiles(full, base));
    else if (entry.name.endsWith('.md') && entry.name !== 'README.md') out.push(relative(base, full).replaceAll('\\', '/'));
  }
  return out;
}

async function listSkillDirs(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function checkCodexHooks(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking Codex hook composition...');
  const mod = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/config/codex-hooks-compose.mjs')).href);
  const group = (level) => mod.composeCodexHooks(null, level).hooks ?? {};
  const events = (level) => Object.keys(group(level)).sort();
  const expected = {
    1: ['SessionStart'],
    2: ['PostToolUse', 'SessionStart', 'Stop'],
    3: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
    5: ['PostToolUse', 'PreToolUse', 'SessionStart', 'Stop'],
  };
  for (const [level, want] of Object.entries(expected)) {
    const got = events(Number(level));
    JSON.stringify(got) === JSON.stringify(want.sort())
      ? ok(`Codex L${level} -> ${got.join(', ')}`)
      : bad(`Codex L${level} expected [${want}] got [${got}]`);
  }
  const commands = Object.values(group(5)).flat().flatMap((entry) => (entry.hooks || []).map((hook) => hook.command || ''));
  commands.every((command) => command.includes('--host codex'))
    ? ok('Codex hooks identify themselves with --host codex')
    : bad('Codex hook command missing --host codex');
  const merged = mod.composeCodexHooks({ hooks: { UserPromptSubmit: [{ hooks: [{ command: 'mine' }] }] } }, 5);
  merged.hooks.UserPromptSubmit?.[0]?.hooks?.[0]?.command === 'mine'
    ? ok('Codex composer preserves user hook groups')
    : bad('Codex composer dropped a user hook group');
  mod.stripCodexHooks(mod.composeCodexHooks(null, 5)) === null
    ? ok('stripCodexHooks removes only the kit wiring')
    : bad('stripCodexHooks left generated kit-only wiring behind');
}

async function checkCodexParity(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking templates/codex tracks templates/claude...');
  const core = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/codex/convert-core.mjs')).href);
  const commandFiles = await listMdFiles(resolve(KIT, 'templates/claude/commands'));
  const skillDirs = await listSkillDirs(resolve(KIT, 'templates/codex/skills'));
  const missingSkills = commandFiles.map((file) => core.codexSkillName(file)).filter((name) => !skillDirs.includes(name));
  missingSkills.length === 0
    ? ok(`Codex skills track Claude commands (${commandFiles.length} file(s))`)
    : bad(`templates/codex/skills missing: ${missingSkills.slice(0, 5).join(', ')}`);

  const staleSkills = [];
  for (const file of commandFiles) {
    const raw = await readFile(resolve(KIT, 'templates/claude/commands', file), 'utf-8');
    const twinPath = resolve(KIT, 'templates/codex/skills', core.codexSkillName(file), 'SKILL.md');
    const twin = await readFile(twinPath, 'utf-8').catch(() => null);
    if (twin !== core.convertCommandToSkill(raw, file)) staleSkills.push(file);
  }
  staleSkills.length === 0
    ? ok('Codex skill content matches an in-memory rebuild')
    : bad(`Codex skills stale vs Claude source: ${staleSkills.slice(0, 5).join(', ')}`);

  const agentFiles = await listMdFiles(resolve(KIT, 'templates/claude/agents'));
  const staleAgents = [];
  for (const file of agentFiles) {
    const raw = await readFile(resolve(KIT, 'templates/claude/agents', file), 'utf-8');
    const twinPath = resolve(KIT, 'templates/codex/agents', `${basename(file, '.md')}.toml`);
    const twin = await readFile(twinPath, 'utf-8').catch(() => null);
    if (twin !== core.convertAgentToToml(raw, file)) staleAgents.push(file);
  }
  staleAgents.length === 0
    ? ok(`Codex agents track Claude agents (${agentFiles.length} file(s))`)
    : bad(`Codex agents stale/missing: ${staleAgents.slice(0, 5).join(', ')}`);
}

async function checkCodexInventory(rep, KIT) {
  const { ok, bad } = rep;
  for (const rel of [
    'templates/AGENTS.md.tpl',
    'templates/cdx.mjs',
    'templates/codex/README.md',
    'templates/contextkit/runtime/codex/convert-all.mjs',
    'templates/contextkit/runtime/codex/convert-core.mjs',
    'tools/install/codex.mjs',
    'tools/integration-test-codex.mjs',
  ]) {
    existsSync(resolve(KIT, rel)) ? ok(rel) : bad(`missing ${rel}`);
  }
  const agentsTemplate = await readFile(resolve(KIT, 'templates/AGENTS.md.tpl'), 'utf-8');
  /Complete Session Workflow \(Codex\)/.test(agentsTemplate) &&
  /node cdx\.mjs log-session/.test(agentsTemplate) &&
  /Collaborate across hosts/.test(agentsTemplate)
    ? ok('AGENTS.md.tpl carries the Codex workflow and cooperation contract')
    : bad('AGENTS.md.tpl missing Codex workflow/cooperation instructions');
}

export async function runCodexChecks(rep, { KIT }) {
  await checkCodexHooks(rep, KIT);
  await checkCodexParity(rep, KIT);
  await checkCodexInventory(rep, KIT);
}
