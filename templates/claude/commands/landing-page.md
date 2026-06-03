---
description: Landing-page architect — opinionated, anti-cookie-cutter, fold rules, package recs, indexable-by-default. (ADR-0023)
argument-hint: <feature or scope, e.g. "marketing site for new pricing">
---

# 🎯 Landing page (anti-cookie-cutter)

Drive a landing-page or marketing-site design pass from a strategic
brief. The session reads two artefacts on every invocation and refuses
the cookie-cutter pattern by default:

- [Landing-page playbook](../../contextkit/workflows/playbooks/landing-page.md) — fold rules, anti-Lovable refusals, package recommendations (dated), performance budget.
- [SEO + AISO playbook](../../contextkit/workflows/playbooks/seo-aiso.md) — indexability gate; refuse-on-SPA.

Authority: [ADR-0023](../../contextkit/memory/decisions/0023-landing-page-and-conversion-posture.md).

## Posture for this session

Act as **landing-architect**. Read the brief in **$ARGUMENTS** and:

1. **State the indexability decision FIRST.** Pick SSG (Astro
   recommended), SSR (Next App Router / Nuxt / Remix / SvelteKit), or
   carve out a non-indexable surface with a project ADR. Plain Vite +
   React for a public landing page is a refusal — propose Astro.
2. **Pick the fold count from the rule table.** State min / ideal /
   max for the brief's situation. Justify the pick (utility tool →
   3 folds; SaaS pricing page → 5–7; high-ticket B2B → up to 9).
3. **Sketch each fold as a one-liner.** One message, one action, one
   proof per fold. No "while we're here" sections.
4. **Refuse the cookie-cutter explicitly.** Walk the playbook's
   anti-Lovable table and name the substitute the design will use
   (editorial hero, in-context testimonial, decision-tree pricing,
   inline FAQ).
5. **Choose packages from the rec table.** State the framework,
   styling tokens, animation library, typography pair, icon set,
   forms, analytics, experimentation, imagery source. Refuse the
   defaults the playbook calls out (`Inter`, Heroicons, GA4,
   Material UI).
6. **Defer to the squad:**
   - `seo-specialist` for the AISO checklist + FAQ schema before any
     visual work lands;
   - `ui-designer` for tokens + layout once the structure is set;
   - `ux-designer` for the user flow through the page;
   - `accessibility` for WCAG AA before merge;
   - `/media-gen` for hero imagery + video instead of stock photos.
7. **Performance budget commitment.** State the LCP / INP / CLS / JS
   payload target up front — they are conversion levers, not
   afterthoughts.

## Output shape

- **Indexability decision** (SSG / SSR / carve-out) + framework pick
  with one-line rationale.
- **Fold map** — `N folds`, each as `<fold-name> · <message> · <action>
  · <proof>`.
- **Anti-Lovable map** — which playbook smells the design refuses
  and what the substitute is for each.
- **Stack** — package picks with one-line rationale per category.
- **Performance budget** — LCP, INP, CLS, JS payload targets.
- **Next-step delegations** — which agent owns the next pass and
  what input they need.

## What this does NOT do

- It does **not** write the code in this session. It produces the
  *plan* the next session (or the next agent) implements.
- It does **not** invent a domain (rule 9 + ADR-0017's five-constraint
  inheritance). The user owns the product story; this command shapes
  the structure.
- It does **not** override a project-local ADR that carves out
  indexability. Read those first.
