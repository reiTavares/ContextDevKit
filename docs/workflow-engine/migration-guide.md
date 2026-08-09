# Workflow migration guide

Workflow v1 is not read by the normal workflow engine. `workflow-plan.json`,
legacy state journals, Markdown lanes, and `done/` placement are accepted only
by the explicit offline 3.x-to-4.0 importer.

Do not rename files by hand and do not copy v1 fields wholesale into v2. The
migrator inventories all cards and workflows, resolves identities, normalizes
statuses, creates complete v2 packages, validates parity, exercises rollback,
freezes old writers, and atomically changes authority.

The full operational sequence, config-key table, refusal conditions, and
rollback commands are in
[MIGRATION-3.x-TO-4.0.md](../../MIGRATION-3.x-TO-4.0.md).

After cutover:

- normal runtime has no dual-read or fallback;
- v3 writers remain fenced through rollback;
- old active data is moved to an external audit bundle only after acceptance;
- the rollback drill is followed by an explicit final v4 cutover before
  retirement;
- the bundle is not an executable runtime;
- the physical `contextkit/pipeline/` tree is absent after retirement;
- Project Map is regenerated under the active external memory root;
- `workflow validate` must pass every migrated pack.
