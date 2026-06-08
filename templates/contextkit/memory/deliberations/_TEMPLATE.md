# Deliberation: <short question title>

<!--
  ADR-0035 — a deliberation is PRE-DECISION working material: independent voices
  argue a hard question, a separate synthesizer converges. It feeds an ADR's
  Context; it is NOT a peer of the ADR and never the canonical record of the why.
  Filename: YYYY-MM-DD-NN-<kebab-slug>.md  (NN = monotonic, parsed by the index).
  Keep it CONCISE, OBJECTIVE, HIGHLY TECHNICAL. No filler, no theatre.
-->

- **Status**: resolved <!-- resolved | unresolved -->
- **Date**: YYYY-MM-DD
- **Question**: <the single decision under debate, stated as a question>
- **Voices**: 3
- **Feeds**: <ADR-NNNN once written, or "—" while pre-decision>

## Question

The decision under debate, with just enough context for an independent reader to
take a side without already knowing the answer. State the constraints honestly.

## Positions

> Each voice is a GENUINELY INDEPENDENT agent context arguing its strongest case —
> not one model role-playing both sides. One position per voice; no strawmen.

### Voice A — <position label>
The strongest one-paragraph case for this position. Its key evidence and the
trade-off it accepts.

### Voice B — <position label>
The strongest case for the opposing position. Where it directly rebuts Voice A.

### Voice C — <position label>
A third axis the first two miss (cost, time, reversibility, blast radius, …).

## Synthesis

> Written by the SEPARATE synthesizer — whoever argued does not declare the winner.

The reasoned convergence: which position wins on which axes, what each loser
contributes that survives into the answer, and the decisive trade-off.

## Verdict

**Consensus:** <the decision, stated plainly> — or, if `Status: unresolved`,
**No consensus:** the unresolved tension, stated as the trade-off the human must
break. An unresolved deliberation is a valid outcome; it offers no ADR.

<!-- On consensus, /debate offers a pre-filled /new-adr; the resulting ADR links
     back here via [[deliberation: <this-slug>]]. -->
