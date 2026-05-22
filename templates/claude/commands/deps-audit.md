---
description: Dependency & supply-chain audit (security-team) — lockfile, pinning, CVEs → backlog.
---

# 🔐 Deps Audit (security-team)

Run the **security-team's** dependency / supply-chain check, then feed the backlog.

1. **Audit** (writes findings for ingestion):
   ```
   node vibekit/tools/scripts/deps-audit.mjs --write
   ```
   Flags: missing lockfile (non-reproducible installs), unbounded version ranges,
   and — when the toolchain is present — `npm`/`pnpm`/`yarn audit` CVEs
   (severity-mapped critical→5 … info→1).

2. **Feed the DevPipeline backlog** — each issue becomes an auto-prioritized task:
   ```
   node vibekit/tools/scripts/pipeline.mjs ingest vibekit/memory/deps-findings.json --type chore
   ```
   Idempotent (re-runs don't duplicate). Priorities are **always editable**
   (`pipeline.mjs prioritize <id> <P>` or `/pipeline`).

3. **Interpret with judgment** (delegate to the `security` agent): which advisories
   are actually reachable/exploitable in THIS app vs transitive noise? Recommend the
   fix (upgrade · pin · replace · accept-with-reason). On a Critical/High, the
   security-team can block the release.

4. **Report**: counts by severity + the top items + what was ingested.

Stack note: Node is audited deterministically. For Python (`requirements.txt` /
`pyproject.toml`) the command flags that `pip-audit` / `safety` should run.
