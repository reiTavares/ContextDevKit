# Skill: deps-audit

> Dependency & supply-chain audit (security-team) — lockfile, pinning, CVEs → backlog.
# 🔐 Deps Audit (security-team)

Run the **security-team's** dependency / supply-chain check, then feed the backlog.

1. **Audit** (writes findings for ingestion):
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

2. **Feed the DevPipeline backlog** — each issue becomes an auto-prioritized task:
   ```
   node contextkit/tools/scripts/pipeline.mjs ingest contextkit/memory/deps-findings.json --type chore
   ```
   Idempotent (re-runs don't duplicate). Priorities are **always editable**
   (`pipeline.mjs prioritize <id> <P>` or `/pipeline`).

3. **Interpret with judgment** (adopt the posture of `the` (see `.agents/agents/the.md`) `security` agent): which advisories
   are actually reachable/exploitable in THIS app vs transitive noise? Recommend the
   fix (upgrade · pin · replace · accept-with-reason). On a Critical/High, the
   security-team can block the release.

4. **Report**: counts by severity + the top items + what was ingested.

5. **GitHub-native (optional, loop-closer)** — if the repo is on GitHub, pull its
   **Dependabot + code-scanning alerts** into the same backlog (needs the `gh` CLI,
   authenticated):
   ```
   node contextkit/tools/scripts/gh-alerts.mjs --write
   node contextkit/tools/scripts/pipeline.mjs ingest contextkit/memory/gh-alerts-findings.json --type chore
   ```
   Set up the scaffolding (`.github/dependabot.yml` + the security workflow) with
   `/security-setup`.

Stack note: Node is audited deterministically. For Python (`requirements.txt` /
`pyproject.toml`) the command flags that `pip-audit` / `safety` should run.
