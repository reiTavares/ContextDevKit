# ContextDevKit 4 release fences

These tools make legacy removal and package hygiene release facts rather than
reviewer assertions.

- `release-gate.mjs` runs the inventory, static reachability, dynamic module-load
  trace, actual `npm pack --dry-run` audit, and footprint capture.
- `baselines/v3.9.0.json` is the immutable before snapshot captured from tag
  `v3.9.0`; unmeasured performance fields remain `null`, never implicit passes.
- `templates/contextkit/package-files.json` is the positive distribution
  allowlist. `package.json/files` selects only those roots and `.npmignore` is a
  defense-in-depth filter for development artifacts inside the template tree.

Run the focused checks:

```text
node tools/release/v4/release-fences.selftest.mjs
node tools/release/v4/package-audit.mjs --check
node tools/release/v4/release-gate.mjs --report-dir tools/release/v4/reports
```

The complete release gate is expected to refuse on an integration branch while
any replacement entrypoint is missing, any retained executable legacy remains
reachable/loadable, or the package leaks a forbidden path. Reports never delete
files. Physical removal happens only after replacement, consumer-zero,
reachability, load-trace, migration, and rollback evidence are all concrete.
