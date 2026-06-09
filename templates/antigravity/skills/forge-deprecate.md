# Skill: forge-deprecate

> Stamp `metadata.deprecated_at` into a forged Agent Package's manifest and recommend an ADR for the reason. Atomic write; dry-run by default. (agent-forge squad)
> Argument: <agent>[@<version>] [--write]
# 🛠️ Mode: agent-forge — deprecate

Run `node vibekit/squads/agent-forge/cli/forge-admin.mjs deprecate <user-specified argument>`.

Marks the version as deprecated without deleting it. Clients can still
consume the package; the marker tells them to migrate to the successor.

## After
1. Recommend `/new-adr "deprecate <agent>@<version>"` with the migration path.
2. If a successor exists, link it: `metadata.superseded_by: <agent>@<new>`.
3. Add a CHANGELOG entry in the package's own `CHANGELOG.md`.
