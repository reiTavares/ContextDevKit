/**
 * DevPipeline prioritization — WSJF (SAFe) + bug severity (S1–S4) + SLA.
 *
 * Pure functions over plain numbers/strings, zero deps. The bands / SLA / bug
 * taxonomy can be overridden in `vibekit/config.json` → `pipeline.*`; these are
 * the defaults the CLI falls back to.
 *
 * Model: every task lands on a priority **P0–P3**, derived from one of —
 *   • WSJF score (value items)   → `wsjfToPriority`
 *   • bug severity S1–S4 (bugs)  → `bugSeverityToPriority`
 *   • scanner severity 1–5       → `severityToPriority`
 * — and the **SLA due date** follows from the priority (`slaDue`).
 */
export const DEFAULTS = {
  wsjfBands: { p0: 8, p1: 5, p2: 2 }, // WSJF score ≥ → priority
  severityPriority: { S1: 'P0', S2: 'P1', S3: 'P2', S4: 'P3' }, // ITIL bug severity
  slaDays: { P0: 1, P1: 3, P2: 14, P3: 60 }, // resolution target per priority
  bugTypes: ['functional', 'regression', 'security', 'performance', 'data', 'integration', 'ui', 'build', 'flaky', 'other'],
};

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/** WSJF (SAFe) = Cost of Delay ÷ Job Size. Inputs 1–10; returns a rounded score. */
export function wsjfScore({ userValue = 0, timeCriticality = 0, riskReduction = 0, jobSize = 1 }) {
  const cod = num(userValue) + num(timeCriticality) + num(riskReduction);
  return Math.round((cod / Math.max(num(jobSize) || 1, 1)) * 10) / 10;
}

/** WSJF score → priority band. */
export function wsjfToPriority(score, bands = DEFAULTS.wsjfBands) {
  const s = num(score);
  if (s >= bands.p0) return 'P0';
  if (s >= bands.p1) return 'P1';
  if (s >= bands.p2) return 'P2';
  return 'P3';
}

/** Scanner numeric severity (1–5, 5 = worst) → priority. Debt caps at P1. */
export function severityToPriority(sev) {
  const n = num(sev);
  if (n >= 4) return 'P1';
  if (n >= 3) return 'P2';
  return 'P3';
}

/** Bug severity label (S1–S4, S1 = critical) → priority. */
export function bugSeverityToPriority(sev, map = DEFAULTS.severityPriority) {
  return map[String(sev || '').toUpperCase()] || 'P2';
}

/** Resolution due date = created + SLA days for the priority (ISO yyyy-mm-dd). */
export function slaDue(priority, createdISO, slaDays = DEFAULTS.slaDays) {
  const days = slaDays[priority] ?? 30;
  const base = createdISO ? new Date(createdISO) : new Date();
  if (Number.isNaN(base.getTime())) return '';
  return new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
}

/** True when a not-yet-done task is past its SLA date. */
export function isOverdue(task) {
  if (!task || !task.sla || task.stage === 'conclusion') return false;
  const due = new Date(task.sla);
  return !Number.isNaN(due.getTime()) && due < new Date();
}
