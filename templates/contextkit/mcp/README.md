# MCP Integration Layer — ContextDevKit

> MCP-002 — curated registry, per-project manifest, and profile resolver.
> Part of BIZ-0001 (MCP Integration Layer program, ADR-0073).

## Files at a glance

| File | Purpose |
|---|---|
| `registry.json` | Curated, version-pinned MCP server catalogue. Edit only via ADR-gated releases. |
| `manifest.schema.json` | JSON Schema v2020-12 for per-project manifests. |
| `profiles/<id>.json` | Named server bundles for common project archetypes. |
| `runtime/mcp/registry.mjs` | Loads and validates `registry.json`. Throws on any malformed entry. |
| `runtime/mcp/manifest.mjs` | Reads/writes `project-manifest.json` atomically. Rejects secret values. |
| `runtime/mcp/resolve-profile.mjs` | Maps a profile id + registry to a server PROPOSAL. |

## Key contracts

**registry.json is ADR-gated.** Adding a new curated server requires an ADR
(risk assessment, provenance attestation, pin decision). The file is immutable
between ADR cycles; waves 2/3 consume existing entries without re-editing it.

**Manifests never hold secret values.** `referencedSecrets` holds only the
*name* of an environment variable (e.g. `GITHUB_PERSONAL_ACCESS_TOKEN`). The
manifest writer throws a `TypeError` if a value that matches known token patterns
is supplied.

**Write-mode entries require human approval.** `resolveProfile()` returns a
PROPOSAL. Any entry with `mode:'write'` or `approval:'human'` is flagged
`humanApprovalRequired:true` — the caller must gate these on explicit consent
before activation. The resolver NEVER silently enables write access.

**Atomic writes.** `writeManifest()` writes to a `.tmp` file first, then
renames — no half-written manifests on crash.

**Zero runtime deps.** All three `.mjs` modules use `node:fs` / `node:path`
only. Safe on the hot path (Levels 1–3).

## Risk levels

| Level | Meaning |
|---|---|
| R0 | Internal / trusted — context memory only |
| R1 | Low — read-only metadata, public APIs |
| R2 | Medium — read + possible write to external service |
| R3 | High — browser/network automation, arbitrary code paths |
| R4 | Very high — infra access (DB, cloud, CI) |
| R5 | Critical — credential management, secrets, IAM |

## Profiles

| Profile | Servers |
|---|---|
| `web-app` | contextdevkit (R0) + github read (R2) + playwright (R3) |
| `backend-api` | contextdevkit (R0) + github read/write (R2) |
| `supabase` | contextdevkit (R0) + github read (R2) |
| `product-design` | contextdevkit (R0) + github read (R2) + playwright screenshots (R3) |
| `regulated` | contextdevkit (R0) only — minimal blast radius |

## Extending

1. Propose a new server via ADR (`/new-adr mcp-add-<name>`).
2. Add a full-provenance entry to `registry.json` (pin required).
3. Reference the new id in any profile that needs it.
4. Add a self-test in `tools/selfcheck-mcp-002-tmp.mjs` that covers the new entry.
