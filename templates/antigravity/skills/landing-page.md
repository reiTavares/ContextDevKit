# Skill: landing-page

> Landing-page architect + conversion squad — interview-first, anti-cookie-cutter, deterministic scaffold (lp-scaffold/lp-build), LGPD by default. (ADR-0023 + ADR-0050)
> Argument: <feature or scope, e.g. "marketing site for new pricing">
# 🎯 Landing page (conversion squad)

Drive a landing-page pass from a strategic brief — structure by
`landing-architect`, persuasion by `conversion-strategist`, instrumentation by
`tracking-integrator`. Reads on every invocation:

- [Landing-page playbook](../../contextkit/workflows/playbooks/landing-page.md) — fold rules + fold anatomy, neurodesign table, anti-Lovable refusals, package recs (dated), legal & consent defaults, performance budget.
- [SEO + AISO playbook](../../contextkit/workflows/playbooks/seo-aiso.md) — indexability gate; refuse-on-SPA.

Authority: [ADR-0023](../../contextkit/memory/decisions/0023-landing-page-and-conversion-posture.md) + ADR-0050.

## The pass, in order

0. **Interview (conversion-strategist).** Check the brief in **<user-specified argument>** for
   the four answers — niche/sector · main pain · the ONE CTA · audience
   sophistication. Ask ONLY what's missing; never re-ask what's given.
1. **Indexability decision FIRST (landing-architect).** Static scaffold
   (default for content pages), SSG framework (Astro) or SSR when app-like, or
   carve-out via project ADR. Plain Vite + React is a refusal.
2. **Fold count from the rule table**, then map each selected fold to its
   persuasive function from the playbook's fold-anatomy menu. One message ·
   one action · one proof per fold. No real social proof ⇒ the proof fold is
   dropped, never faked.
3. **Scaffold, don't hand-write** (static path):
   `node contextkit/tools/scripts/lp-scaffold.mjs --folds <selection>` →
   fill `lp/content/copy.json` + `lp/content/legal.json` (the AI's editing
   surface — markup only changes for real structural needs) →
   `node contextkit/tools/scripts/lp-build.mjs --check`.
4. **Refuse the cookie-cutter explicitly** — walk the anti-Lovable table and
   name each substitute. Framework variant: packages from the dated rec table.
5. **Legal & consent are defaults.** Consent banner ON, GTM ID-less, pixels as
   commented models only, privacy policy + terms generated from `legal.json`
   (minuta — lawyer disclaimer stays). Route the filled docs to `privacy-lgpd`.
6. **Delegate:** visual tokens/layout → `ui-designer` · flow → `ux-designer` ·
   indexability + AISO → `seo-specialist` (mandatory gate) · GTM/pixels/webhook
   → `tracking-integrator` · WCAG AA → `accessibility` · imagery → `/media-gen`.
7. **Exit gates.** `lp-build.mjs --check` green (no leftover tokens/sentinels;
   `seo-audit` + `aiso-audit` clean on `dist/`) + the performance budget
   restated (LCP < 2.5 s · INP < 200 ms · CLS < 0.1 · first-fold JS < 100 kB).

## Output shape

1. Interview answers (or the questions still open).
2. Indexability decision + rendering path (scaffold / framework) with rationale.
3. Fold map — each line `<fold> · <message> · <action> · <proof>` + the
   neurodesign technique it leans on.
4. Anti-Lovable map (smell → substitute).
5. Scaffold/build commands run + `--check` result.
6. Legal & consent status (docs generated, what `privacy-lgpd` must review).
7. Delegations + performance budget.

## What this does NOT do

- Invent domain content: copy, testimonials, numbers and legal facts come from
  the user (rule 9). Placeholder sentinels are open items, not content.
- Wire a tracker to fire before consent, or hardcode a container/pixel ID.
- Override a project-local ADR that carves out indexability.
