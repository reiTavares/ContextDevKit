# L1 — read-only context loading

L1 gives a host the project instructions and a compact boot context without asking
the user to repeat them. `governance-session-context.mjs` reads configuration,
authored memory, Project Map health, and active governed workflow context. It does
not fetch remotes, create a session ledger, or write source/project state.

Host projections are generated from canonical manifests and checked for parity.
Missing optional data is reported as unavailable or stale; it never blocks the
first useful action.
