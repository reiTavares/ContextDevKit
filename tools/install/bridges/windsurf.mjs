/**
 * windsurf.mjs — Windsurf context bridge (F8 / ADR-0068).
 * Context ONLY — no governance enforcement (that stays on the native hosts).
 * Writes the shared context body via the common marker-inject installer.
 */
export { simpleBridgeInstall as installBridge } from './shared.mjs';
