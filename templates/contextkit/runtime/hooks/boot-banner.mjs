/**
 * boot-banner — pure presentation layer for the SessionStart hook.
 *
 * `session-start.mjs` GATHERS the boot signals (I/O, git, ledgers, config); this
 * module RENDERS them into the `<project-context-boot>` banner. Splitting the two
 * keeps each within the line budget and mirrors the existing boot decomposition
 * (`boot-context-readers`, `boot-signals`, `boot-signals-projmap`): the hook stays
 * the orchestrator, presentation lives here. Pure — every value is pre-resolved by
 * the caller, so this module does NO I/O and has zero third-party deps.
 */

/**
 * Renders the full boot banner from a pre-gathered signal bundle.
 *
 * @param {object} boot the resolved boot signals (see `session-start.mjs#main`)
 * @returns {string} the complete `<project-context-boot>` block (newline-terminated)
 */
export function renderBootBanner(boot) {
  const { isCodex } = boot;
  const bootFile = isCodex ? 'AGENTS.md' : 'CLAUDE.md';
  const commandRef = (name, args = '') => (isCodex ? `node cdx.mjs ${name}${args ? ` ${args}` : ''}` : `/${name}${args ? ` ${args}` : ''}`);

  const out = [];
  out.push('<project-context-boot>');
  out.push(`# 📚 Boot context — ${boot.projectName} (${boot.host})`);
  out.push('');
  out.push(`Session id: \`${boot.sessionId.slice(0, 16)}\` · Branch: \`${boot.branch}\` · ContextDevKit level: \`L${boot.level}\`${boot.autonomyBadge}`);
  out.push('');

  if (boot.engineSignal) {
    out.push(boot.engineSignal);
    out.push('');
  }

  if (boot.pendingDigest) {
    out.push(boot.pendingDigest);
    out.push('');
  }

  if (boot.needsSetup) {
    out.push('## 🚀 First run — ContextDevKit not configured yet');
    out.push('');
    if (boot.greenfield) {
      out.push(`This folder looks **empty (no code yet)**. Run **\`${commandRef('aidevtool-from0')}\`** — it interviews you`);
      out.push('about the product, suggests/refines the stack, drafts a roadmap, adopts the best-practices');
      out.push('constitution, and seeds the DevPipeline. From zero, the kit stays ACTIVE: it keeps');
      out.push('suggesting the next practice/level as the product takes shape.');
    } else {
      out.push(`This project already has code. Run **\`${commandRef('setupcontextdevkit')}\`** — it inspects the project, tunes`);
      out.push(`the config to this stack, fills in \`${bootFile}\`, flags high-risk paths, installs what is`);
      out.push(`needed, and records a baseline ADR. (Empty project instead? use \`${commandRef('aidevtool-from0')}\`.)`);
    }
    out.push('');
  }

  if (boot.practicesActive) {
    out.push('## 🧠 Best-practices skill is ACTIVE');
    out.push('');
    out.push('Honor `contextkit/best-practices.md` (file-size budget, intelligent refactor by responsibility,');
    out.push(`SoC, naming, docs). Run \`${commandRef('analyze-code-ia-practices')}\` to audit + get refactor proposals.`);
    out.push('');
  }

  if (boot.behaviorsActive) {
    out.push('## 🧭 Behavioral discipline is ACTIVE');
    out.push('');
    out.push('Honor `contextkit/behaviors.md` while coding: **think before coding** (surface assumptions,');
    out.push('ask when ambiguous), **simplicity first**, **surgical changes** (match the surrounding style,');
    out.push('no drive-by refactor), **goal-driven** (reproduce-test first, loop to green).');
    out.push('');
  }

  if (boot.secDue) {
    out.push('## 🛡️ Security mode — time for a deep sweep');
    out.push('');
    out.push(`**${boot.secDue} sessions** in. Run **\`${commandRef('deep-analysis')}\`** — full code + security + deps + bug`);
    out.push('sweep → report → ADRs → backlog. (Active by default; disable via `securityMode.active`.)');
    out.push('');
  }

  if (boot.predDue) {
    out.push('## 🔮 Predictions — close the loop');
    out.push('');
    out.push(`**${boot.predDue} sessions** in with **unreviewed** \`/simulate-impact\` predictions. Run`);
    out.push(`**\`${commandRef('predictions-review')}\`** to fill their *Actual* section (predicted vs actual). It also`);
    out.push(`auto-runs at \`${commandRef('log-session')}\`; disable the reminder via \`predictionsReview.active\`.`);
    out.push('');
  }

  if (boot.bugs) {
    const bugs = boot.bugs;
    out.push('## 🐞 Open bugs awaiting resolution');
    out.push('');
    out.push(`**${bugs.total}** open bug(s)${bugs.p0 ? ` · 🔴 **${bugs.p0}** P0` : ''}${bugs.p1 ? ` · 🟠 **${bugs.p1}** P1` : ''} in backlog/working.`);
    out.push(`Resolve pending bugs (P0/P1 first) before new feature work — \`${commandRef('pipeline')}\` to triage, \`${commandRef('bug-hunt', '<id>')}\` to fix.`);
    out.push('');
  }

  if (boot.mapStale) {
    out.push('## 🗺️ Project map');
    out.push('');
    out.push(boot.mapStale);
    out.push('');
  }

  const squadContext = boot.squadContext;
  if (squadContext && squadContext.squads && squadContext.squads.length > 0) {
    out.push('## 👥 Active Squad Postures');
    out.push('');
    for (let i = 0; i < squadContext.squads.length; i++) {
      const squad = squadContext.squads[i];
      const agent = squadContext.agents[i] || 'architect';
      out.push(`- **Squad: \`${squad}\`** (Suggested agent: \`${agent}\`)`);
      const playbook = squadContext.playbooks.find((p) => p.squad === squad);
      if (playbook) {
        out.push(`  Playbook: \`${playbook.path}\``);
      }
    }
    if (squadContext.agentScaffolding && squadContext.agentScaffolding.length > 0) {
      out.push('');
      out.push('🤖 **Agent-Forge Suggestions:**');
      for (const sug of squadContext.agentScaffolding) {
        out.push(`- \`${sug}\``);
      }
    }
    out.push('');
  }

  const divergence = boot.divergence;
  if (divergence && (divergence.ahead > 0 || divergence.behind > 0)) {
    out.push('## 🔄 Git status vs upstream');
    out.push('');
    if (divergence.behind > 0) out.push(`- ⚠️  Behind upstream by **${divergence.behind}** commit(s). Consider \`git pull\` before editing.`);
    if (divergence.ahead > 0) out.push(`- ℹ️  Ahead of upstream by **${divergence.ahead}** commit(s) (unpushed).`);
    out.push('');
  }

  const drift = boot.drift;
  if (drift.length > 0) {
    out.push('## 🚨 Drift from previous session(s)');
    out.push('');
    // ADR-0033 — cap to the 2 freshest; collapse the rest so a few abandoned
    // ledgers don't bury the rest of the boot context.
    for (const d of drift.slice(0, 2)) {
      out.push(`Session \`${d.sessionId.slice(0, 8)}\` ended without \`/log-session\` and left ${d.paths.length} important file(s) modified:`);
      for (const p of d.paths.slice(0, 6)) out.push(`  - ${p}`);
      if (d.paths.length > 6) out.push(`  (… and ${d.paths.length - 6} more)`);
      out.push('');
    }
    if (drift.length > 2) {
      out.push(`_+ ${drift.length - 2} older unregistered session(s) — \`${commandRef('log-session')}\` to reconcile, or leave them if abandoned._`);
      out.push('');
    }
    out.push('If those changes still matter, **offer to retroactively register them** before new work.');
    out.push('');
  }

  if (boot.workspace) {
    out.push('## 👥 Active workspace claims');
    out.push('');
    out.push(boot.workspace);
    out.push('');
  }

  if (boot.branches) {
    out.push('## 🌿 Other active branches (parallel work)');
    out.push('');
    out.push(boot.branches);
    out.push('');
    out.push(`If you will touch files another branch changed, coordinate (or \`${commandRef('claim', '<path>')}\`) — the pre-push`);
    out.push('hook will also block a conflicting push.');
    out.push('');
  }

  if (boot.latest) {
    out.push('## 🗓️ Last registered session');
    out.push('');
    out.push(boot.latest.content);
    if (boot.latest.mode === 'digest') out.push('\n_(digest — open the full log in `contextkit/memory/sessions/` if you need detail) [ADR-0027]_');
    out.push('');
  }

  if (boot.unreleased) {
    out.push('## 📝 Unreleased changes (CHANGELOG `[Unreleased]`)');
    out.push('');
    out.push(boot.unreleased);
    out.push('');
  }

  if (boot.value) {
    out.push(boot.value);
    out.push('');
  }

  out.push('## ⚠️ Process rules');
  out.push('');
  out.push('1. Read SESSIONS index + relevant ADR before non-trivial changes.');
  out.push(`2. New architectural decision → \`${commandRef('new-adr', '<title>')}\` BEFORE implementing.`);
  if (boot.level >= 3) out.push(`3. Reserve area before parallel work → \`${commandRef('claim', '<path>')}\`. Free with \`${commandRef('release')}\`.`);
  out.push(`4. End of productive session → \`${commandRef('log-session')}\`.`);
  out.push(`5. \`${commandRef('state')}\` for a quick state summary at any time.`);
  if (boot.hasSnapshot) out.push('6. `.context-snapshot.md` available for a full-project view.');
  out.push('</project-context-boot>');

  return out.join('\n') + '\n';
}
