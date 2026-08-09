#!/usr/bin/env node
/**
 * /plan-week — rank the backlog into an actionable, explained top-N.
 *
 * Answers "what should I pick up next?" deterministically, so the planner is a
 * substrate fact instead of a judgement call. Each backlog ticket gets a
 * composite **plan score** combining two signals the kit already records:
 *
 *   • **priority** (P0–P4) — the explicit owner-defined ordering band.
 *   • **dependency readiness** — work with unfinished prerequisites is not
 *     presented as actionable.
 *
 * A ticket with open dependencies (`blockedBy > 0`) sinks to the bottom — you
 * cannot start it, so it is never a "next" pick; its blockers surface above it.
 *
 * The pure ranking functions are deterministic and have zero dependencies.
 */
import { readAuthoritySnapshot } from '../../runtime/authority-reader.mjs';
import { blockedBy } from './pipeline-validate.mjs';

const PRIORITY_WEIGHT = { P0: 500, P1: 400, P2: 300, P3: 200, P4: 100 };
const BLOCKED_PENALTY = 1000; // a blocked ticket can't be started — push it below everything actionable

/** Composite planning score + its component breakdown for one backlog task. */
export function planScore(task, allTasks) {
  const base = PRIORITY_WEIGHT[task.priority] ?? 30;
  const blockers = blockedBy(task, allTasks);
  const score = base - (blockers > 0 ? BLOCKED_PENALTY : 0);
  return { score, base, blockers };
}

/** One-line, human rationale for why a ticket ranks where it does. */
function explain(task, parts) {
  const bits = [task.priority];
  if (parts.blockers > 0) bits.push(`⛔ blocked by ${parts.blockers} — complete dependencies first`);
  return bits.join(' · ');
}

/** Rank every backlog ticket by descending plan score. Pure; `now` is injectable. */
export function rankBacklog(allTasks) {
  return allTasks
    .filter((task) => task.status === 'backlog')
    .map((t) => {
      const parts = planScore(t, allTasks);
      return { task: t, ...parts, rationale: explain(t, parts) };
    })
    .sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));
}

function getFlag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : undefined;
}

function main() {
  const ranked = rankBacklog(readAuthoritySnapshot(process.cwd()).tasks);
  if (getFlag('json')) {
    const out = ranked.map((rankedTask) => ({
      id: rankedTask.task.id,
      title: rankedTask.task.title,
      priority: rankedTask.task.priority,
      tasks: rankedTask.task.authorityPath,
      score: rankedTask.score,
      blocked: rankedTask.blockers > 0,
      rationale: rankedTask.rationale,
    }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const top = getFlag('all') ? ranked.length : Number(getFlag('top')) || 5;
  if (ranked.length === 0) {
    console.log('📋 Backlog is empty — nothing to plan. 🎉');
    return;
  }
  const actionable = ranked.filter((r) => r.blockers === 0);
  console.log(`🗓️  Plan — top ${Math.min(top, actionable.length)} of ${ranked.length} backlog task(s), by priority and dependency readiness:\n`);
  actionable.slice(0, top).forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.task.id}  ${r.task.title}`);
    console.log(`     ${r.rationale}  (score ${r.score})`);
  });
  const blocked = ranked.filter((r) => r.blockers > 0);
  if (blocked.length) {
    console.log(`\n⛔ ${blocked.length} blocked (clear dependencies first): ${blocked.map((rankedTask) => rankedTask.task.id).join(', ')}`);
  }
  const topTask = actionable[0]?.task ?? ranked[0].task;
  console.log(`\n▶ Next mutation: /dev-start "${topTask.id}" --tasks "${topTask.authorityPath}"`);
}

if (process.argv[1]?.endsWith('plan-next.mjs')) main();
