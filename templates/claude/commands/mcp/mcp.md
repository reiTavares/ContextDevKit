---
description: Manage Model Context Protocol (MCP) servers — discover, add (curated), health-check, audit, and sync host configs from the curated registry.
argument-hint: [discover|add|profile|doctor|audit|sync|disable|receipt] [args]
---

Drive the MCP integration layer through its single dispatcher. Business logic
lives in the delegated modules; this command is a thin surface over them.

All subcommands run via the dispatcher:

```
node contextkit/tools/scripts/mcp.mjs <subcommand> [options]
```

## Subcommands

- **`discover [query]`** — browse candidates from the curated registry (and,
  with discovery enabled, the official MCP registry). **Never auto-enables** —
  every candidate stays a CANDIDATE until curated.
- **`add <id>`** — add a server from the curated registry (requires the
  curation flow; respects approval policy: `auto` vs `human`).
- **`profile [id]`** — show or manage capability profiles
  (`contextkit/mcp/profiles/*.json`). Each profile references known registry
  ids and lists a least-privilege `allowedTools` surface.
- **`doctor [--json]`** — health-check every enabled server. Three-way verdict:
  `pass` / `fail` / **`skipped`** (a missing secret is *skipped*, never a false
  pass). Never throws on a single broken server; exits non-zero only on a real
  failure.
- **`audit [--json]`** — surface audit flags and posture for enabled servers.
- **`sync`** — push manifest changes into the per-host config files
  (Claude / Codex / Cursor / Antigravity renderers). Marker-idempotent
  (ADR-0067): re-running is a no-op when nothing changed.
- **`disable <id>`** — disable an enabled server.
- **`receipt [--write]`** — write (or dry-run) an MCP execution receipt.
  Dry-run by default; `--write` performs an atomic apply.

## How to respond

1. Read `$ARGUMENTS`; if empty or `--help`, run `node contextkit/tools/scripts/mcp.mjs --help`
   and summarize the available subcommands.
2. Otherwise dispatch the requested subcommand and report its output.
3. For `doctor`/`audit`, summarize the pass/fail/skipped tally and call out any
   server that needs a secret or curation — never present a `skipped` server as
   healthy.

Secrets are referenced by **env-var name only** (e.g. `GITHUB_PERSONAL_ACCESS_TOKEN`),
never as literal values. If a required secret is absent at runtime the server is
**skipped**, not a hard failure.
