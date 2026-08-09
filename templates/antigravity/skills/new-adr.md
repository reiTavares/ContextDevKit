# Skill: new-adr

> Generate, validate, and explicitly accept a canonical ContextDevKit ADR.
> Argument: <ADR title>
Create a canonical Authoritative Decision Record for: **<user-specified argument>**

0. **Search before creating** [ADR-0027]: run
   `node contextkit/tools/scripts/decision.mjs search --objective "<key terms from the title>" --json`.
   If an accepted ADR already governs the choice, use it or supersede it; never
   create a duplicate.

0b. **Deliberation is optional** [ADR-0158]. `/debate` may add independent
evidence when a decision has genuine tension, but debate, routing, and swarm are
never readiness, council, receipt, or delivery prerequisites.

1. Resolve the fleet-safe next ADR id with
   `node contextkit/tools/scripts/intake-collision-gate.mjs --json`; use the
   `ADR` row's `fleet` value. Do not infer the id from one directory.

2. Classify the owner and decision before writing:

   - `--context-type business` + `--primary-context BIZ-####` for a Business decision;
   - `--context-type operation` + `--primary-context OP-####` for an Operation decision;
   - `--context-type platform` for standing platform governance.

   Choose one closed `--kind` and, when relevant, one closed `--value-intent`.

3. Preview, then create only through the canonical generator:

   ```shell
   node contextkit/tools/scripts/decision.mjs create --id ADR-#### --kind ARCHITECTURE --context-type operation --primary-context OP-#### --title "<user-specified argument>" --json
   node contextkit/tools/scripts/decision.mjs create --id ADR-#### --kind ARCHITECTURE --context-type operation --primary-context OP-#### --title "<user-specified argument>" --apply --json
   ```

   Never copy `contextkit/memory/decisions/_TEMPLATE.md`, hand-build front matter,
   or create a new legacy ADR. Fill the generated guidance without changing its
   machine schema, `documentVersion`, or required headings.

4. Validate the exact file with
   `node contextkit/tools/scripts/decision.mjs validate --file <path> --json`.
   Show the proposed ADR to the user. Only an explicit human decision authorizes:
   `node contextkit/tools/scripts/decision.mjs accept --id ADR-#### --actor human --apply --json`.
   Acceptance stamps the deterministic decision hash; never hand-edit it.

5. Link the accepted ADR to the governing Business, Operation, or Workflow JSON
with `decision.mjs link`. If it implies implementation, add tasks only through
the named canonical workflow/batch `pipeline/tasks.json`. ADR creation never
seeds tasks or dispatches agents automatically.

6. To change an accepted ADR, generate a new one and use the canonical
supersession lifecycle. Never delete or rewrite an accepted record.
