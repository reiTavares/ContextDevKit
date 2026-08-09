---
name: "source-command-audit-deps-audit"
description: "Read-only dependency and supply-chain audit with optional explicit report output."
---

# source-command-audit-deps-audit

Use this skill when the user asks to run the migrated source command `deps-audit`.

## Command Template

# 🔐 Deps Audit (security-team)

Run the dependency and supply-chain check and report actionable evidence.

1. **Audit** (pass `--write` only when the user requested a durable report):
   ```
   node contextkit/tools/scripts/deps-audit.mjs --write
   ```
   Detects: missing lockfile (non-reproducible installs), unbounded version
   ranges, **license-policy** violations (deny-list / allow-list from
   `contextkit/config.json` → `deps.licenses`), **lockfile drift** (a declared dep
   missing from the lockfile), and — when the toolchain is present —
   `npm`/`pnpm`/`yarn audit` CVEs (severity-mapped critical→5 … info→1).

   Generate a CycloneDX **SBOM** (provenance):
   ```
   node contextkit/tools/scripts/deps-audit.mjs --sbom   # → contextkit/memory/sbom.json
   ```

   **Staleness / abandonment** (ADR-0047 — the only audit step that touches the
   network, so it's opt-in):
   ```
   node contextkit/tools/scripts/deps-audit.mjs --registry --write
   ```
   Flags a deprecated `latest` and packages with no publish in 2+ years. An
   unreachable registry shows up as a `registry-skipped` finding — a skip,
   never a pass.

2. **Interpret with judgment** (consult the `security` agent when useful): which advisories
   are actually reachable/exploitable in THIS app vs transitive noise? Recommend the
   fix (upgrade · pin · replace · accept-with-reason). Security advice is
   explicit and serious, but agent presence is not a runtime gate.

3. **Report**: counts by severity, reachability, the top items, and skipped checks.

4. **GitHub-native (optional)** — if the repo is on GitHub, inspect its
   **Dependabot + code-scanning alerts** (needs the `gh` CLI,
   authenticated):
   ```
   node contextkit/tools/scripts/gh-alerts.mjs --write
   ```
   Set up the scaffolding (`.github/dependabot.yml` + the security workflow) with
   `/security-setup`.

Stack note: Node is audited deterministically. For Python (`requirements.txt` /
`pyproject.toml`) the command flags that `pip-audit` / `safety` should run.

The audit creates no task or workflow. Offer an explicitly scoped follow-up
mutation for accepted findings.
