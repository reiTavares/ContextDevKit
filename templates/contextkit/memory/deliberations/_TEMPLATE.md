# Deliberation: <short question title>

<!--
  ADR-0035 / ADR-0070 — a deliberation is PRE-DECISION working material: a council
  of independent SPECIALIST voices argues a hard question, a separate synthesizer
  converges. It feeds an ADR's Context; it is NOT a peer of the ADR and never the
  canonical record of the why.
  Filename: YYYY-MM-DD-NN-<kebab-slug>.md  (NN = monotonic, parsed by the index).
  Keep it CONCISE, OBJECTIVE, HIGHLY TECHNICAL. No filler, no theatre.
-->

- **Status**: resolved <!-- resolved | unresolved -->
- **Date**: YYYY-MM-DD
- **Question**: <the single decision under debate, stated as a question>
- **Trigger**: manual <!-- manual | feature-deliberation | decision-deliberation | high-risk-nudge | ship-checkpoint -->
- **Council**: <e.g. architect, security, ux-designer (3) — or "3 generic voices" when autoSelect is off>
- **Feeds**: <ADR-NNNN once written, or "—" while pre-decision>

## Question

The decision under debate, with just enough context for an independent reader to
take a side without already knowing the answer. State the constraints honestly.

## Evidence

<!--
  ADR-0070 §4 — facts gathered by the cheap `fast`-tier scouts BEFORE the voices
  argue, so the reasoning-tier voices spend premium tokens on judgment, not lookups.
  Each item is a verifiable project fact with its source (file:line, command output,
  ADR id). Omit this section only when the question is purely abstract.
-->

- <fact> — `path/to/file.ext:NN` (scout)
- <fact> — output of `<command>` (scout)

## Positions

> Each voice is a GENUINELY INDEPENDENT agent context arguing its strongest case
> from the Evidence above — not one model role-playing every side. The specialist
> agent supplies the PERSPECTIVE (its lane); every voice argues at the reasoning
> tier (ADR-0052 — voices are never downgraded). One position per voice; no strawmen.

### <architect> — <position label>
The strongest one-paragraph case from this specialist's lens. Its key evidence and
the trade-off it accepts.

### <security> — <position label>
The strongest case from this lens. Where it directly rebuts the position above.

### <ux-designer> — <position label>
A third axis the first two miss (cost, time, reversibility, blast radius, …).

<!-- Add one ### heading per council member; the council scales 3..max by question. -->

## Synthesis

> Written by the SEPARATE synthesizer (reasoning tier) — whoever argued does not
> declare the winner. `powerful`-tier verification may be cited here for any claim
> that needed checking in a larger context (ADR-0070 §4).

The reasoned convergence: which position wins on which axes, what each loser
contributes that survives into the answer, and the decisive trade-off.

## Verdict

**Consensus:** <the decision, stated plainly> — or, if `Status: unresolved`,
**No consensus:** the unresolved tension, stated as the trade-off the human must
break. An unresolved deliberation is a valid outcome; it offers no ADR.

<!-- On consensus, /debate offers a pre-filled /new-adr; the resulting ADR links
     back here via [[deliberation: <this-slug>]]. -->
