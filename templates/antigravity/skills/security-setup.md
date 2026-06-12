# Skill: security-setup

> Scaffold GitHub-native security (Dependabot + CodeQL + dependency-review) and sync alerts into the backlog (security-team).
# 🔐 Security Setup (security-team)

Make GitHub's security features first-class: keep deps patched, scan code, and turn
GitHub's own alerts into owned backlog tasks. Idempotent — safe to re-run.

1. **Confirm the scaffolding** (the installer drops these write-if-missing; create if absent):
   - `.github/dependabot.yml` — version updates per ecosystem.
   - `.github/workflows/security.yml` — `dependency-review` (PRs) + `/deps-audit` + CodeQL,
     all **advisory** by default.

2. **Tune to THIS stack** — detect the ecosystems in the repo (npm / pip / gomod / cargo /
   maven / ...) and enable the matching `dependabot.yml` blocks; set the CodeQL `language`
   matrix to the repo's real languages, and drop jobs that don't apply. Keep it advisory —
   don't make it a required check until the team opts in (that's the enforcement switch).

3. **Close the loop (alerts → backlog)** — pull GitHub's own alerts in and prioritize them:
   ```
   node contextkit/tools/scripts/gh-alerts.mjs --write
   node contextkit/tools/scripts/pipeline.mjs ingest contextkit/memory/gh-alerts-findings.json --type chore
   ```
   Needs an authenticated `gh` CLI (`gh auth login`). Degrades silently if absent — never blocks.

4. **Triage with judgment** (adopt the posture of `the` (see `.agents/agents/the.md`) `code-security` agent): which alerts are actually
   reachable/exploitable in THIS app vs transitive noise? Recommend the fix — upgrade · pin ·
   replace · accept-with-reason. On a Critical/High, the security-team can block the release.

5. **Report**: what was scaffolded, which ecosystems/languages you enabled, and how many
   alerts were ingested.

Pairs with `/deps-audit` (deterministic local check: lockfile, pinning, license policy, SBOM,
CVEs). This command adds the GitHub-native layer on top.
