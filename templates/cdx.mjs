#!/usr/bin/env node
/**
 * ContextDevKit Codex runner.
 *
 * Thin wrapper over the shared command runner. `ctx.mjs` detects this entrypoint
 * name and brands help text as Codex while keeping one dispatch implementation.
 */
await import('./ctx.mjs');
