# Host parity without duplicated authority

<!-- GENRE: Explanation (understanding-oriented) -->

ContextDevKit supports Claude Code, Codex, Antigravity, and Grok through one
canonical source model. Host-specific files are generated projections, not
independent policy copies.

## What parity means

Parity means that every declared lifecycle event maps to the same governance
moment and that every generated agent, command, and workflow has one canonical
source. It does not mean pretending that hosts expose identical APIs.

The projection manifest declares source, target, transform, owner, and host. A
generator validates all sources before writing, repairs declared drift, and
removes managed orphans. Verification fails on missing, stale, or undeclared
outputs, including in non-Git installs.

## Runtime boundary

Each host runs at most one process for each of prompt preflight, write preflight,
postflight, and completion. The host adapter normalizes input/output; the central
registry resolves policy. Host files cannot register extra gates or persist a
second task/workflow authority.

Unsupported host features degrade honestly. A bridge may receive context without
claiming governance. Missing routing metadata, graph data, or optional tooling
returns diagnostics and the current agent continues.

## Why generation matters

Hand-maintained copies drift silently and can preserve retired commands. The
manifest-driven generator makes source ownership explicit, provides orphan
detection, and lets the release gate prove that every shipped projection has a
current consumer.

See [Codex integration](../CODEX.md), [Antigravity integration](../ANTIGRAVITY.md),
and [Governance contract](../reference/governance-contract.md).
