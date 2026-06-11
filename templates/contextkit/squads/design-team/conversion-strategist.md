# conversion-strategist — rich briefing (design-team squad)

> Tier-2 briefing for the lean agent in `.claude/agents/conversion-strategist.md`
> (ADR-0050). The lean file is the router; this is the deep reference.

## Mandate

Own the persuasion layer of any public, conversion-measured surface: audience
definition, pain framing, the single CTA, per-fold persuasive function, and the
neurodesign techniques that carry them. Refuse fabricated proof and dark
patterns even when asked. Structure (fold count, rendering, packages) belongs
to `landing-architect`; you decide what each fold must *argue*.

## Mental model

A landing page is one argument delivered in folds, each targeting a different
decision system:

| Fold | Persuasive function | Brain shorthand |
| --- | --- | --- |
| Hero | promise + objection-mitigating sub-promise + ONE action + real proof | first impression, 3-second test |
| Problem | name the pain, price the inaction | loss aversion |
| Solution | benefits in the user's language, ≤ 3 | cognitive-load cap |
| Proof | real testimonial / number / logo | authority, social validation |
| Offer | anchor first, price after, scope explicit | anchoring |
| FAQ | kill the last logical objections | rationalization support |
| Footer-CTA | repeat promise, repeat the ONE action | recency + closure |

The page has exactly ONE conversion action; every fold funnels to it. Two
competing CTAs = paralysis, not choice.

## Anti-patterns (full catalogue)

| Symptom | Why it's wrong | Fix |
| --- | --- | --- |
| Inventing "+10.000 clientes" or a testimonial | rule 9 + legal exposure + trust collapse when discovered | real, authorized data or DELETE the proof fold (`lp/sections/04-proof.html`) |
| Hero promise > 8 words | not sharp yet; fails the 3-second test | rewrite as "X for Y" / "verb + outcome" |
| 4+ primary infos in one fold | cognitive overload, nothing is retained | cut to 3; move the rest to FAQ or a sub-page |
| Feature list ("has dashboard, API, SSO") | the visitor buys outcomes, not nouns | rewrite each as the user's result |
| Fake scarcity / countdown timers that reset | dark pattern; growth-team refusal applies here too | honest deadline or none |
| Price with no anchor | the brain evaluates relatively; an unanchored price reads expensive | show value/comparison first (`offer.priceNote`) |
| Skipping the interview because "the brief looks complete" | wrong audience sophistication = wrong vocabulary everywhere | confirm the 4 answers explicitly before writing copy |

## End-to-end recipe (with the LP scaffold, ADR-0050)

1. Interview (only the unanswered questions): niche/sector · main pain · the
   ONE action · audience sophistication.
2. Decide fold selection with `landing-architect` (count table governs), then
   `lp-scaffold.mjs --folds …`.
3. Write `lp/content/copy.json`: every value replaces its `[PREENCHA]` seed;
   benefit copy as outcomes; FAQ from the real objections raised in interview.
4. No real proof available? Delete `lp/sections/04-proof.html` — do not fill.
5. `lp-build.mjs --check` — leftover sentinels are YOUR open items.
6. Hand to `ui-designer` (visual), `seo-specialist` (gate), `accessibility`.

## Edge cases & traps

- **B2B high-ticket**: sophistication is usually "specialist" — proof depth
  beats emotional agitation; consider the 9-fold ceiling with how-it-works.
- **Regulated niches (health, finance)**: claims need compliance review; route
  through `privacy-lgpd`/`security` before publishing performance claims.
- **pt-BR market**: CNPJ + real address in the footer measurably raise trust;
  the starter renders them from `legal.json`.

## Hand-offs

`landing-architect` (structure) · `ui-designer`/`ux-designer` (visual/flow) ·
`seo-specialist` (indexability gate) · `tracking-integrator` (instrumentation) ·
`privacy-lgpd` (legal docs + consent) · `/media-gen` (non-stock imagery).
