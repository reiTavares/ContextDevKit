# Security policy

How to report a security problem in ContextDevKit, what is in scope, and what you
can expect back. Read the two reference pages before reporting — several behaviours
that look like flaws are documented properties of the design, and reporting them
costs you time and us signal.

- [docs/reference/footprint.md](docs/reference/footprint.md) — every file the kit
  writes and every process it runs.
- [docs/reference/data-posture.md](docs/reference/data-posture.md) — per-hook
  reads, writes and network calls, plus why hooks are not a security control.

## How to report

Use GitHub's private vulnerability reporting on the repository: open
<https://github.com/reiTavares/ContextDevKit/security/advisories> and choose
**Report a vulnerability**. That keeps the report and the discussion private until
a fix exists.

If that form is unavailable to you, open a normal issue at
<https://github.com/reiTavares/ContextDevKit/issues> that asks for a private
channel and contains **no** exploit detail, no proof-of-concept and no affected
path. A maintainer will follow up privately.

There is no dedicated security mailbox and no PGP key. Do not send reports to a
maintainer's personal address you found in the git history — it is not monitored
for this purpose.

Please do not open a public issue describing an exploitable problem, and do not
disclose publicly before a fix is available.

## What to include

The more of this you provide, the faster the triage:

- Kit version — the contents of `contextkit/.engine-version`, or the `version`
  field of `contextkit/.install-manifest.json`.
- Activation level and enforcement mode, from `contextkit/config.json`.
- Operating system, Node.js version, and the host you use (Claude Code,
  Antigravity or Codex).
- The exact path of the affected file under `contextkit/`, `tools/` or
  `templates/`.
- Reproduction steps, or a minimal fixture. A failing test is ideal — the project
  ships its own harnesses (`npm test`).
- The impact you believe it has, and what an attacker needs in order to reach it:
  a crafted repository, a crafted prompt, a crafted commit message, an existing
  local shell, a malicious dependency, network position.

Do not include real secrets, real tokens, or a customer's data in a report. If a
credential is involved, describe its shape and rotate it.

## Scope

### In scope

- The installer and its modules — `install.mjs`, `tools/install/**`.
- The engine under `templates/contextkit/runtime/**` and its installed copy at
  `contextkit/runtime/**`: hooks, git hooks, configuration loader, host adapters,
  status line.
- The script surface under `templates/contextkit/tools/scripts/**`, including the
  MCP layer, the graph extractor and the economics modules.
- What the kit writes into a host's configuration files.
- The CI and security workflow templates the kit scaffolds under `.github/`.
- The published `contextdevkit` npm package and its contents.

Classes of finding that are worth a report:

- Arbitrary command or code execution reachable from data the kit parses — a
  repository path, a file it reads, a commit message, a prompt, a host event
  payload, an MCP server response.
- Path traversal, or a write outside the project root and `~/.contextdevkit/` that
  is not documented in the footprint page.
- A secret written into a file, a log, a telemetry record, an error message or a
  generated artifact. This includes a value reaching a manifest that is documented
  as storing only environment-variable names.
- A generated artifact that leaks content the projection boundary is meant to keep
  out of a public path.
- Any network call to a destination not enumerated in the data-posture page.
- Supply-chain problems in what the kit ships or pins, including the curated MCP
  registry entries.
- A dependency-confusion or typosquat vector in an install path.

### Out of scope

- **The host applications.** Claude Code, Antigravity and Codex are not this
  project. Report those to their own vendors.
- **Third-party MCP servers.** Enabling one grants that code access to your
  repository through your host. The kit's registry records a pin and a risk class
  and verifies no signature or artifact hash — the data-posture page states that
  limit. Report the server's behaviour to the server's maintainer; report the
  *kit's* handling of it here.
- **Your project's own code**, and the linters, formatters, test runners and build
  tools the kit invokes on your behalf.
- **A cooperating-agent bypass of a governance gate.** Hooks fail open, degrade to
  advisory when they cannot evaluate, honour documented bypass flags, and live in a
  JSON file the agent can edit. That an agent or a developer can skip a gate is
  documented behaviour, not a vulnerability. If you have found a way for a gate to
  produce a false **pass** — a receipt accepted that was never earned, evidence
  recorded for work that did not happen — that is in scope, because it inverts the
  design's own rule that an unrunnable check reports as skipped.
- **The known gaps in the removal path**, listed under "Known gaps" in the
  footprint page. They are recorded defects with a documented manual workaround.
- Findings that require an attacker who already runs code as the developer, unless
  the kit meaningfully escalates what that attacker can reach.
- Missing hardening with no demonstrated impact, automated scanner output with no
  reachability analysis, and best-practice notes. Those are welcome as ordinary
  issues, not as security reports.

## What to expect

**There is no published service-level agreement.** This project does not commit to
a triage or fix window, and none should be inferred from this document. It is
maintained without a staffed on-call rotation.

In practice, the process is:

1. Acknowledgement that the report arrived and is being looked at.
2. Triage — reproduce, judge severity and reach, and say plainly whether it is
   accepted, out of scope, or already documented.
3. A fix on a branch with a regression test, because every change in this project
   ships with a test that would fail without it.
4. Release, and a `SECURITY` entry in the changelog naming the affected versions.
5. Credit in the advisory, unless you ask us not to.

If a report goes unanswered, a follow-up comment on the advisory or issue is
welcome and appropriate.

## Supported versions

Fixes land on the current release line. Older majors are not patched; the upgrade
path is `npx contextdevkit --update`, which snapshots your critical state to
`~/.contextdevkit/` before mutating anything.

## Checks you can run yourself

These exist in every install and need no network access:

```shell
node contextkit/tools/scripts/doctor.mjs      # config, level, hook wiring, git hooks
node contextkit/tools/scripts/deps-audit.mjs  # lockfile, pinning, licenses, local CVE data
node contextkit/tools/scripts/mcp-audit.mjs   # enabled MCP servers, write tools, secret-shaped keys
```

`/security-setup` scaffolds the GitHub-native layer — Dependabot, CodeQL and
dependency review — as advisory workflows. They constrain nothing until you mark
them as required checks on the branch, which is a decision for your repository
settings, not something the kit can make for you.
