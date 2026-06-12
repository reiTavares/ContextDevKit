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

/**
 * Claude-only host strings that must never survive into a generated Codex
 * skill description or body. A leak here means `adaptContent` skipped the field.
 */
const CLAUDE_ONLY_STRINGS = ['CLAUDE.md', 'Claude Code', '~/.claude'];

/** Reads the `description:` line out of a generated SKILL.md frontmatter. */
function skillDescription(skillText) {
  const match = skillText.match(/^description:\s*"?(.*?)"?\s*$/m);
  return match ? match[1] : '';
}

/**
 * Asserts coverage + skip-list: every non-skipped Claude command has a skill
 * dir, and every skip-listed command emits NONE. Catches both a missing twin
 * and an accidentally-emitted host-inappropriate skill.
 */
async function checkSkillCoverage(rep, core, commandFiles, skillDirs) {
  const { ok, bad } = rep;
  const emitted = commandFiles.filter((file) => !core.isSkippedForCodex(file));
  const missing = emitted.map((file) => core.codexSkillName(file)).filter((name) => !skillDirs.includes(name));
  missing.length === 0
    ? ok(`Codex skills cover non-skipped commands (${emitted.length} of ${commandFiles.length})`)
    : bad(`templates/codex/skills missing: ${missing.slice(0, 5).join(', ')}`);

  const leaked = commandFiles
    .filter((file) => core.isSkippedForCodex(file))
    .map((file) => core.codexSkillName(file))
    .filter((name) => skillDirs.includes(name));
  leaked.length === 0
    ? ok(`Host-inappropriate commands skipped (${core.CODEX_SKILL_SKIP_LIST.join(', ')})`)
    : bad(`skip-listed command emitted a Codex skill: ${leaked.join(', ')}`);
}

/**
 * Asserts PROPERTIES of every generated skill (not generator-echo parity):
 * no Claude-only string in a description, and no dead flat
 * `.agents/skills/<name>.md` reference in a body.
 */
async function checkSkillProperties(rep, KIT, skillDirs) {
  const { ok, bad } = rep;
  const descLeaks = [];
  const deadPaths = [];
  const deadFlatRef = /\.agents\/skills\/[A-Za-z0-9_-]+\.md(?![A-Za-z0-9_./-])/;
  for (const dir of skillDirs) {
    const text = await readFile(resolve(KIT, 'templates/codex/skills', dir, 'SKILL.md'), 'utf-8').catch(() => '');
    const description = skillDescription(text);
    if (CLAUDE_ONLY_STRINGS.some((needle) => description.includes(needle))) descLeaks.push(dir);
    if (deadFlatRef.test(text)) deadPaths.push(dir);
  }
  descLeaks.length === 0
    ? ok('No generated skill description leaks a Claude-only host string')
    : bad(`Claude-only string in skill description: ${descLeaks.slice(0, 5).join(', ')}`);
  deadPaths.length === 0
    ? ok('No generated skill body holds a dead flat .agents/skills/<name>.md reference')
    : bad(`Dead flat skill path in: ${deadPaths.slice(0, 5).join(', ')}`);
}

/**
 * Adversarial converter inputs: CRLF body, a `'''` fence, a backslash in a
 * description, and a no-frontmatter file. Each must convert without throwing,
 * without leaking a raw `---` block, and without breaking TOML/JSON escaping.
 */
function checkConverterRobustness(rep, core) {
  const { ok, bad } = rep;
  const crlf = '---\r\ndescription: "CLAUDE.md note"\r\n---\r\n\r\nRun `.claude/commands/state.md` now.\r\n';
  const fenced = "---\ndescription: \"x\"\n---\n\nbody '''with''' triple quotes\n";
  const backslash = '---\nname: "demo"\ndescription: "path C:\\Users x"\n---\n\nbody\n';
  const noFront = '# Plain command\n\nNo frontmatter at all.\n';
  const problems = [];
  try {
    const skill = core.convertCommandToSkill(crlf, 'state.md');
    if (!/description: "[^C]*Codex/.test(skill) && skill.includes('CLAUDE.md')) problems.push('crlf: description not adapted');
    if (/\n---\r?\n[\s\S]*\n---\r?\n/.test(skill.replace(/^---\n[\s\S]*?\n---\n/, ''))) problems.push('crlf: raw --- block leaked');
    if (skill.includes('.agents/skills/source-command-state/SKILL.md') === false) problems.push('crlf: command path not rewritten');
  } catch (err) { problems.push(`crlf threw: ${err.message}`); }
  try {
    const toml = core.convertAgentToToml(fenced, 'demo.md');
    if (!toml.includes('developer_instructions =')) problems.push('fenced: no developer_instructions');
  } catch (err) { problems.push(`fenced threw: ${err.message}`); }
  try {
    const toml = core.convertAgentToToml(backslash, 'demo.md');
    const descMatch = toml.match(/^description = (".*")$/m);
    // The emitted description must be a valid escaped string that parses back
    // to the original single-backslash path — proves no broken TOML escaping.
    if (!descMatch || JSON.parse(descMatch[1]) !== 'path C:\\Users x') problems.push('backslash: description not safely escaped');
  } catch (err) { problems.push(`backslash threw: ${err.message}`); }
  try {
    const skill = core.convertCommandToSkill(noFront, 'plain.md');
    if (!skill.startsWith('---\n')) problems.push('no-frontmatter: malformed skill');
  } catch (err) { problems.push(`no-frontmatter threw: ${err.message}`); }
  problems.length === 0
    ? ok('Converter survives CRLF / triple-quote / backslash / no-frontmatter inputs')
    : bad(`Converter robustness: ${problems.slice(0, 5).join('; ')}`);
}

async function checkCodexParity(rep, KIT) {
  const { ok, bad } = rep;
  console.log('Checking templates/codex tracks templates/claude...');
  const core = await import(pathToFileURL(resolve(KIT, 'templates/contextkit/runtime/codex/convert-core.mjs')).href);
  const commandFiles = await listMdFiles(resolve(KIT, 'templates/claude/commands'));
  const skillDirs = await listSkillDirs(resolve(KIT, 'templates/codex/skills'));
  await checkSkillCoverage(rep, core, commandFiles, skillDirs);
  await checkSkillProperties(rep, KIT, skillDirs);
  checkConverterRobustness(rep, core);

  const agentFiles = await listMdFiles(resolve(KIT, 'templates/claude/agents'));
  const missingAgents = agentFiles.filter((file) =>
    !existsSync(resolve(KIT, 'templates/codex/agents', `${basename(file, '.md')}.toml`)));
  missingAgents.length === 0
    ? ok(`Codex agents track Claude agents (${agentFiles.length} file(s))`)
    : bad(`Codex agents missing: ${missingAgents.slice(0, 5).join(', ')}`);
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
