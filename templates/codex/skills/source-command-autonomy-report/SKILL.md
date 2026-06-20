---
name: "source-command-autonomy-report"
description: "Show or verify a stored Session Autonomy Receipt (token/autonomy/cost) for a session."
---

# source-command-autonomy-report

Use this skill when the user asks to run the migrated source command `autonomy-report`.

## Command Template

# /autonomy-report — Session Autonomy Receipt viewer

Read-only viewer/verifier for the canonical Session Autonomy Receipts produced at
session finalization (ADR-0108). It does NOT regenerate receipts (finalization owns
generation); it renders or verifies what was stored, preserving the historical
pricing snapshot. Extends the CLI convention of `token-report` — it does not
duplicate it.

## Usage

```bash
node contextkit/tools/scripts/autonomy-report.mjs --session <id>     # render one receipt
node contextkit/tools/scripts/autonomy-report.mjs --session <id> --json
node contextkit/tools/scripts/autonomy-report.mjs --session <id> --verify   # integrity verdict
node contextkit/tools/scripts/autonomy-report.mjs --latest           # most recent receipt
node contextkit/tools/scripts/autonomy-report.mjs --all              # list every receipt
node contextkit/tools/scripts/autonomy-report.mjs --all --mode subscription
```

## What it shows

- Consumption mode (subscription / api / hybrid / unknown) and claim type
  (**measured** / **estimated** / **insufficient-evidence**).
- Observed tokens, estimated baseline, token reduction, **Autonomy Multiplier**
  (always labelled estimated/measured; a low-confidence result shows a range, never a
  false-precision point), and additional autonomous capacity.
- API cost breakdown + cost-per-accepted-task (api/hybrid only). Subscription mode
  never shows an invented dollar figure.
- Confidence, evidence basis, calibration id, and integrity status (`--verify`
  recomputes the hash and checks the Ed25519 signature when present).

## Honesty

An estimate is always labelled `estimated` and carries its calibration basis
("pilot calibration — not a proven claim"). No multiplier is shown without a matched
calibration baseline or a real direct A/B comparison.
