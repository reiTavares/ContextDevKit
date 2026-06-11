# Playbook: tech-debt-sweep

> Reusable procedure. Follow the steps below when invoked.

# Playbook — `/tech-debt-sweep`

> Operational spec: [`.agents/skills/tech-debt-sweep.md`](../../../.agents/skills/tech-debt-sweep.md).
> This page is **why** the board exists, **how to read it**, and the **anti-patterns**.

## Why it exists

The constitution defines rules (file size, SRP, JSDoc) but the audit used to be
manual and disposable. Without a persistent artifact, debt grows unseen, nobody sees
the trend, and each session re-discovers the same problem.

The debt board is the pulse of code health:
- **versioned** — it shows up in PR review, the boot context, and `git log -p`;
- **sectioned by bounded context** — product code vs the platform (`contextkit/`);
- **trended** — red/yellow/info counts let you see the delta between sweeps.

## The detectors (deterministic, regex-based)

| Detector | Severity | Trigger |
| --- | --- | --- |
| **line-budget** | 🔴 above the hard limit / 🟡 in the yellow zone | File line count vs the constitution's budget. |
| **srp-and** | 🟡 | A function/const named `doXAndY` — an "And"/"Or" responsibility smell. |
| **jsdoc-orphan** | 🟡 | JSDoc declares N `@param` but the signature has M ≠ N. |
| **state-loop** | 🟡 | A UI component with many state hooks + an effect (logic that belongs in a hook/helper). |

Detectors are regex-based — **false positives are expected**. The board is input for
human review, not a verdict.

## How to read it

- **Header** — last sweep time, profile, files scanned, findings by severity. If
  `files scanned` drops sharply with no `git rm`, the scan is skipping paths — check
  the ignored-dirs list in `tech-debt-scan.mjs`.
- **Zero red is the goal.** Yellow is negotiable (a cohesion note can justify the
  +10% tolerance). Info is a nit — optional.
- **Bounded contexts** — product code takes priority; the platform tolerates a bit
  more. A file in the yellow zone with a documented cohesion reason is expected, not
  real debt.
- **Each finding** has a severity icon, a clickable `path:line`, an objective
  message, and a snippet.

## Lifecycle

```
the `tech-debt-sweep` skill [profile]
  → node contextkit/tools/scripts/tech-debt-scan.mjs --profile=X --write
     → regenerates the board
        → commit with the feature, or as "chore: refresh tech-debt board"
Resolution:
the `dev-start` skill "refactor: split <path>"  → read board → split → re-run sweep → expect a drop
```

## Anti-patterns

1. **Treating findings as a bug queue ("I'll fix all 10").** A sweep is an audit,
   not a backlog. Resolve one finding per focused `/dev-start` session.
2. **Silencing a false positive by editing the detector.** First add a top-of-file
   note explaining why JSDoc looks divergent, or fix the signature, or accept the
   nit. Touching the detector is the last resort (separate PR, new code + test).
3. **Letting the yellow zone grow "because there's a cohesion note".** The +10%
   tolerance is for specific cases; beyond the budget without a reason is debt.
4. **Disabling the `security` profile "because it's rare".** That profile is exactly
   what catches auth/crypto changes when they happen — keep it configured.
5. **Hand-editing the board.** Manual edits drift from the scan output and break
   future diffs. Always re-run the sweep.

## Cadence & configuration

Profiles and cadence come from `contextkit/config.json`. Edit via `/context-config set`,
never by hand. Add a custom profile under the sweep config the same way.

## Relation to other L5 components

- **`/simulate-impact`** — independent (ledger vs source code).
- **Contract-drift gate** — complementary: the sweep measures internal health, the
  contract gate measures external commitments.
- **`/distill-sessions`** — can use recurring findings as a pattern signal.
