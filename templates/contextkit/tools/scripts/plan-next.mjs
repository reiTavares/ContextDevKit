#!/usr/bin/env node
/**
 * /plan-week — rank the backlog into an actionable, explained top-N.
 *
 * Answers "what should I pick up next?" deterministically, so the planner is a
 * substrate fact instead of a judgement call. Each backlog ticket gets a
 * composite **plan score** combining three signals the kit already records —
 *
 *   • **priority** (P0–P3) — the dominant band; already folds in WSJF/severity.
 *   • **SLA urgency** — overdue dominates, then proximity to the due date.
 *   • **lane weight** — a `type: bug` or `source: advise:security` finding
 *     outranks a same-priority chore (risk-reduction bias).
 *
 * A ticket with open dependencies (`blockedBy > 0`) sinks to the bottom — you
 * cannot start it, so it is never a "next" pick; its blockers surface above it.
 *
 * Pure ranking functions (`planScore`, `rankBacklog`) take an injectable `now`
 * so the selfcheck/integration tests are deterministic. Zero deps.
 */
import { pathsFor } from '../../runtime/config/paths.mjs';
import { listTasks } from './pipeline-tasks.mjs';
import { blockedBy } from './pipeline-validate.mjs';

// Priority is the human's explicit call, so it dominates: the spread is wide
// enough that lane/SLA bonuses (≤ ~68) re-rank *within* a band, and only a badly
// overdue ticket (SLA urgency ≤ 100) can cross one — which is the intent.
const PRIORITY_WEIGHT = { P0: 400, P1: 200, P2: 100, P3: 40 };
const LANE_WEIGHT = { security: 18, architecture: 8, deepen: 6, features: 5, growth: 4, ux: 4 };
const BUG_WEIGHT = 14;
const BLOCKED_PENALTY = 1000; // a blocked ticket can't be started — push it below everything actionable

const DAY_MS = 86400000;
const MS_TODAY = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

/** Whole days from `now` until the ISO date (negative = overdue, null = no/invalid date). */
export function daysUntil(iso, now) {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  return Math.round((due.getTime() - MS_TODAY(now)) / DAY_MS);
}

/** SLA-urgency points: overdue dominates (50 + days late), then proximity to due date. */
export function slaUrgency(task, now) {
  const days = daysUntil(task.sla, now);
  if (days === null) return 0;
  if (days < 0) return 50 + Math.min(-days, 50); // overdue, capped so one ancient ticket can't dominate forever
  if (days <= 3) return 30;
  if (days <= 7) return 15;
  if (days <= 30) return 5;
  return 0;
}

/** Lane points: bug type + the advisor lane in `source: advise:<lane>`. */
export function laneWeight(task) {
  let weight = task.type === 'bug' ? BUG_WEIGHT : 0;
  const lane = /^advise:([a-z]+)/.exec(task.source || '')?.[1];
  if (lane && LANE_WEIGHT[lane]) weight += LANE_WEIGHT[lane];
  return weight;
}

/** Composite planning score + its component breakdown for one backlog task. */
export function planScore(task, allTasks, now) {
  const base = PRIORITY_WEIGHT[task.priority] ?? 30;
  const sla = slaUrgency(task, now);
  const lane = laneWeight(task);
  const wsjf = Number(task.wsjf) || 0;
  const blockers = blockedBy(task, allTasks);
  const score = base + sla + lane + wsjf - (blockers > 0 ? BLOCKED_PENALTY : 0);
  return { score, base, sla, lane, wsjf, blockers };
}

/** One-line, human rationale for why a ticket ranks where it does. */
function explain(task, parts, now) {
  const bits = [task.priority];
  const days = daysUntil(task.sla, now);
  if (days !== null) bits.push(days < 0 ? `⏰ overdue ${-days}d` : days <= 7 ? `SLA in ${days}d` : `SLA ${task.sla}`);
  if (task.type === 'bug') bits.push(`bug${task.severity ? ' ' + task.severity : ''}`);
  const lane = /^advise:([a-z]+)/.exec(task.source || '')?.[1];
  if (lane) bits.push(`lane:${lane}`);
  if (parts.wsjf) bits.push(`WSJF ${parts.wsjf}`);
  if (parts.blockers > 0) bits.push(`⛔ blocked by ${parts.blockers} — do its dependencies first`);
  return bits.join(' · ');
}

/** Rank every backlog ticket by descending plan score. Pure; `now` is injectable. */
export function rankBacklog(allTasks, now = new Date()) {
  return allTasks
    .filter((t) => t.stage === 'backlog')
    .map((t) => {
      const parts = planScore(t, allTasks, now);
      return { task: t, ...parts, rationale: explain(t, parts, now) };
    })
    .sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));
}

function getFlag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : undefined;
}

function main() {
  const ranked = rankBacklog(listTasks(pathsFor(process.cwd()).pipeline));
  if (getFlag('json')) {
    const out = ranked.map((r) => ({ id: r.task.id, title: r.task.title, priority: r.task.priority, score: r.score, blocked: r.blockers > 0, rationale: r.rationale }));
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const top = getFlag('all') ? ranked.length : Number(getFlag('top')) || 5;
  if (ranked.length === 0) {
    console.log('📋 Backlog is empty — nothing to plan. 🎉');
    return;
  }
  const actionable = ranked.filter((r) => r.blockers === 0);
  console.log(`🗓️  Plan — top ${Math.min(top, actionable.length)} of ${ranked.length} backlog ticket(s), by WSJF × SLA × lane:\n`);
  actionable.slice(0, top).forEach((r, i) => {
    console.log(`  ${i + 1}. #${r.task.id}  ${r.task.title}`);
    console.log(`     ${r.rationale}  (score ${r.score})`);
  });
  const blocked = ranked.filter((r) => r.blockers > 0);
  if (blocked.length) {
    console.log(`\n⛔ ${blocked.length} blocked (clear dependencies first): ${blocked.map((r) => '#' + r.task.id).join(', ')}`);
  }
  console.log(`\n▶ Start the top pick:  /dev-start "#${actionable[0]?.task.id || ranked[0].task.id}"`);
}

if (process.argv[1]?.endsWith('plan-next.mjs')) main();
