/**
 * Ledger (drift-detection) path-classification defaults for ContextDevKit.
 *
 * Extracted from `defaults.mjs` to keep that file within the 308-line budget
 * (immutable rule 1) — same split pattern as `defaults-routing.mjs`,
 * `defaults-eacp.mjs` and `defaults-economy.mjs`. Pure data, zero runtime deps.
 *
 *  - `important`    — path prefixes/files whose changes trigger a drift nudge.
 *  - `irrelevant`   — generated/vendored paths the ledger ignores.
 *  - `registration` — the session/changelog index files a session updates.
 */
export const LEDGER_DEFAULTS = Object.freeze({
  important: [
    'src/',
    'lib/',
    'app/',
    'apps/',
    'packages/',
    'components/',
    'pages/',
    'server/',
    'contextkit/',
    '.claude/',
    '.github/',
    'CLAUDE.md',
    'package.json',
    'tsconfig.json',
    'pyproject.toml',
    'go.mod',
    'Cargo.toml',
  ],
  irrelevant: [
    'node_modules/',
    'dist/',
    'build/',
    'out/',
    '.next/',
    '.turbo/',
    '.expo/',
    '.svelte-kit/',
    'coverage/',
    '__pycache__/',
    'target/',
    'vendor/',
    '.context-snapshot.md',
    '.claude/.sessions/',
    '.claude/.workspace/',
  ],
  registration: ['contextkit/memory/SESSIONS.md', 'docs/CHANGELOG.md'],
});
