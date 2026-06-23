# Token-Economy & Agility Plan

> A plan to reduce token consumption **and** increase agility in ContextDevKit, by
> moving deterministic extraction out of the AI and into zero-dep scripts.
> Companion to [ADR-0027](../contextkit/memory/decisions/0027-token-economy-digest-layer.md)
> and the ROADMAP section *"Token economy: the digest layer"*.
> Authored 2026-06-03.

## 1. The principle

In this kit, **tokens are spent when the AI (Claude) reads files and reasons over
them.** Every line of raw markdown the AI ingests is input tokens. The cheapest token
is the one never read. So the lever is simple:

> **Pre-digest deterministically in a script; let the AI reason over the compact
> output.** Scripts are free (they don't consume model tokens); the AI's context is
> the scarce resource.

The kit already lives by this — ~40 of 65 commands delegate heavy work to a `.mjs`
script. This plan finishes the job for the cluster that still makes the AI ingest
**full raw artifacts**.

## 2. Where the tokens go (the audit)

A pass over `templates/claude/commands/` (65 files) + the boot hook found three cost
shapes:

| Shape | Where | Why it's expensive |
| --- | --- | --- |
| **Read N raw session logs** | `/distill-sessions`, `/retro`, `/tune-agents` | last ~10 logs = 1,100–1,300 lines (~13–16K tok) **before any reasoning** |
| **Overlapping multi-file reads** | `/dev-start`, `/state`, `/ship` | each re-reads latest session + `[Unreleased]` + `CLAUDE.md` rules (+ADRs); also 3–5 sequential round-trips |
| **ADR discovery** | many flows ("read the relevant ADR") | 26 ADRs × ~110 lines; finding the right one by reading 3–5 ≈ 10–13K tok |
| **Boot banner** | `session-start.mjs` (every session) | injects 60 raw lines of the last session, **every session**, from turn 1 |

Already efficient (no action): `/audit`, `/deep-analysis`, `/deps-audit`,
`/contract-check`, `/dashboard`, `/stats`, `/pipeline`, `/token-report`, the forge/
vcs/setup families — all script-backed.

## 3. The fix (four pieces, one shared library)

Per ADR-0027 — each piece has a concrete existing consumer (Rule 9), reuses one
single-source extractor (Rule 4), stays zero-dep (Rule 1), and degrades to raw on any
parse miss (Rule 2/8):

1. **`lib/digest/`** — pure shared extractor (session log → compact record; ADR →
   `{number,title,status,decision1line}`). Used by the boot hook **and** the scripts.
2. **`session-digest.mjs`** — session logs → ~12–18 line digest (`--last N`/`--id`/
   `--json`). Rewires `/distill-sessions`, `/retro`, `/tune-agents`.
3. **`adr-digest.mjs`** — ~26-line ADR catalog + `--search`. Wires into `/ship`,
   `/dev-start`, `/new-adr`, `/deep-analysis`.
4. **`context-pack.mjs`** — one bounded "start of work" bundle. Collapses
   `/dev-start`/`/state`/`/ship` pre-reads into one call.
5. **Boot rewire** — 60 raw lines → ~12-line digest, with raw-truncated fallback.

### Automatic `/dev-start` economy pipeline

`/dev-start` resolves a deterministic economy plan before broad context
expansion. The bootstrap fingerprints (but does not persist) the raw objective,
probes resume state, evaluates Project Map freshness plus a focused path/symbol
lookup, reuses the L7 RequestOrchestrator, and then points to the bounded
`dev-start` context profile and `run-compact` for test/build commands.

Lifecycle ownership is deliberately split:

- `economy-events.jsonl` records economy-lever lifecycle facts.
- `routing-decisions.jsonl` records routing policy plus correlated execution
  acknowledgements.
- `economy-savings.jsonl` records only observed savings, never recommendations.
- `/token-report` reads and reconciles those ledgers; it does not create facts.

`policyWouldApply` is recommendation truth. `applied=true` requires a valid
execution acknowledgement correlated to the decision/session/task. Missing or
invalid acknowledgements remain unapplied, and provider cache value stays
separate from ContextDevKit-attributable savings.

## 4. Estimated token savings

**Assumptions (stated honestly):** ~12 input tokens per dense markdown line; figures
are **input/ingest** tokens (reasoning + output unaffected); prompt caching already
discounts re-reads inside a warm window, so the *realized* saving is largest on cold
and **cross-session** reads — the digest shrinks the bytes regardless. Frequencies are
for a single active project in a week; scale per your cadence. These are
**order-of-magnitude estimates**, provable after the fact with `/token-report --json`.

| Command / surface | Raw ingest today | With digest | Saved / run | ~Freq/wk | Weekly |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/distill-sessions` | ~1,200 ln ≈ 14K | ~150 ln ≈ 1.8K | **~12K** | 2 | ~24K |
| `/retro` | ~1,300 ln ≈ 15K | ~250 ln ≈ 3K | **~12K** | 1 | ~12K |
| `/tune-agents` | ~1,100 ln ≈ 13K | ~200 ln ≈ 2.5K | **~10K** | 1 | ~10K |
| `/dev-start` (step 2) | ~160 ln ≈ 2K | ~55 ln ≈ 0.7K | **~1.3K** | 15 | ~20K |
| `/state` | ~150 ln ≈ 1.8K | ~50 ln ≈ 0.6K | **~1.2K** | 10 | ~12K |
| `/ship` pre-read + ADRs | ~350 ln ≈ 4.5K | ~80 ln ≈ 1K | **~3.5K** | 4 | ~14K |
| ADR discovery (ad hoc) | ~330 ln ≈ 4K | ~136 ln ≈ 1.7K | **~2.3K** | 15 | ~35K |
| **Boot banner** (per session) | 60 ln ≈ 0.7K | 12 ln ≈ 0.15K | **~0.55K** | 35 | ~19K |
| | | | | **Total** | **~145K/wk** |

**Headline: ~120–200K input tokens/week** on an active project (the range covers
caching and cadence variance), order **~0.5–0.8M/month**. Two clear leaders:
- **Biggest single-run wins:** the periodic L5/L6 commands (`/distill-sessions`,
  `/retro`, `/tune-agents`) — ~10–14K each, because they ingest ~10 raw logs.
- **Highest-frequency win:** the **boot digest** — small per session (~0.55K) but
  paid by *every* session from turn 1.

## 5. The agility dividend (beyond tokens)

Token count isn't the only cost — **round-trips and determinism** matter too:

- **Fewer round-trips → lower latency.** `/dev-start` step 2 is 3–4 sequential
  `Read` calls today (each a turn). `context-pack.mjs` makes it **one** call. Same for
  `/state` and `/ship`'s pre-read.
- **Deterministic briefings.** Extraction is regex/structure, not an AI summary — the
  session *starts from the same context every time*, no run-to-run drift in what the
  AI saw. Reproducible inputs → reproducible behaviour.
- **Leaner from turn 1.** The boot digest means *every* session begins with a tighter
  context window, leaving more headroom before compaction kicks in.

## 6. Rollout — smallest blast radius first, measure around it

Sequenced so each slice ships independently, with a test (Rule 3) and a re-measure:

- **Phase 0 — Baseline (measure first).** Capture `node contextkit/tools/scripts/token-report.mjs
  --json` now, and note the `cache_read` share. You can't prove a saving you didn't
  baseline. *(No code.)*
- **Phase 1 — Biggest single-run wins.** Build `lib/digest/` + `session-digest.mjs` +
  selfcheck; rewire `/distill-sessions` and `/retro`. Highest tokens-per-run, lowest
  risk (these commands are periodic, off the hot path).
- **Phase 2 — Highest-frequency win + start pack.** Rewire the boot hook to the shared
  digester (with raw fallback) and ship `context-pack.mjs`; wire `/dev-start` + `/state`.
  Touches the hot path → guarded by the fallback + an integration test that the boot
  banner never empties.
- **Phase 3 — ADR discovery.** Ship `adr-digest.mjs`; wire `/ship`, `/new-adr`
  (dup-decision check), `/deep-analysis`, `/tune-agents`.
- **Phase 4 — Re-measure & close the loop.** Re-run `/token-report`, compare actual vs
  the §4 estimate, and file the predicted-vs-actual delta (the kit's predictions-review
  culture). Feed any surprise into the next reducer (follow-ups in ADR-0027).

## 7. Guardrails (don't regress the invariants)

- **Zero-dep, zero new hook** — plain scripts + one pure shared module; boot reuses the
  existing hot path. (Rule 1)
- **Never break, never empty** — a digest miss falls back to the current raw-truncated
  output; the boot banner can degrade but never blocks or shows nothing. (Rule 2/8)
- **Single-source** — one extractor module, used by boot *and* the scripts; no second
  copy of the parser. (Rule 4)
- **Every slice ships with a test** — `selfcheck`/`integration-test` assertions,
  including one that fails if the canonical session-log headings drift out of sync
  with the parser. (Rule 3)
- **Deterministic, not lossy** — digests extract structure; they never let the AI
  "summarize and forget". The full artifacts stay on disk, one `Read` away.

## 8. Out of scope (deferred, per Rule 9)

Per-command/agent token attribution in `/token-report`; a DevPipeline board digest for
`/pipeline`; a general "summarize any file" digester (unsafe — only the structured
artifacts qualify); an mtime-keyed digest cache (only if extraction cost ever shows up
in a profile).
