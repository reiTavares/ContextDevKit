# Skill — Implementation review

> Trigger (§11): CMIS ≥ 50 AND non-trivial complexity; mandatory for
> high/critical risk, public contracts, or domain-driven+ profiles.

## packet-vs-diff

- Every changed line traces to the packet/request; unexplained lines are
  findings, not style notes (behaviors §3).
- Deviations from the packet are recorded, not discovered by the reviewer.

## contract-safety

- Removed/renamed exports, changed signatures, altered JSON shapes: each one
  names its consumers and its governing Decision.
- Error paths validated at the boundary, typed, never swallowed (H4).

## structure

- No new grab-bag modules; no "And"/"Or" functions (H2).
- No abstraction added just to satisfy a number; no cohesive journey shredded
  into wrappers (H1 — both directions are debt).
- Naming reveals domain intent; banned placeholders stay banned (H5).

## verdict

- The review ends in a verdict with evidence: approve, or name the exact
  corrective change. "Looks good" without the packet comparison is not a
  review — record what was actually checked in the receipt sections.
