/**
 * Non-binding orchestration-size recommendations (ADR-0158).
 *
 * ContextDevKit 4 never dispatches, trims, persists an intent envelope, or
 * denies work from this configuration. The active agent remains the authority;
 * these caps exist only as optional planning guidance.
 */
export const ORCHESTRATION_DEFAULTS = Object.freeze({
  overOrchestrationGuard: Object.freeze({
    authority: 'recommendation-only',
    blocking: false,
    tierCaps: Object.freeze({
      trivial: 0,
      feature: 3,
      architectural: 5,
    }),
  }),
});
