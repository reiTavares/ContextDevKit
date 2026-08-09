---
description: SEO + AISO audit — runs the two static analysers and summarises findings. Refuse-on-SPA for landing pages. (ADR-0025)
argument-hint: [--json] [--seo-only|--aiso-only]
---

# 🔍 SEO + AISO audit

Run both static analysers against the current project and produce a
prioritised findings list. The kit treats two index spaces as
first-class concerns:

- **Classical SEO** — Googlebot, Bingbot, structured data, Core Web
  Vitals. Audited by `seo-audit.mjs`.
- **AISO** (AI Search Optimization) — GPTBot, ClaudeBot, PerplexityBot,
  the `llms.txt` + FAQ-schema family. Audited by `aiso-audit.mjs`.

Authority: [ADR-0025](../../contextkit/memory/decisions/0025-seo-and-aiso-posture.md) + [seo-aiso playbook](../../contextkit/workflows/playbooks/seo-aiso.md).

## What this does

1. Runs `node contextkit/tools/scripts/seo-audit.mjs` and
   `node contextkit/tools/scripts/aiso-audit.mjs` (or only one, if
   `--seo-only` / `--aiso-only` is passed).
2. Reads the findings. If `--json` was passed, prints raw JSON for CI
   consumption.
3. Otherwise: groups findings by severity, lists the top 3 next-step
   fixes ordered by *severity × leverage* (a single fix that resolves
   multiple findings is worth more than three isolated ones).
4. Refuse-on-critical: if `SPA_ENTRYPOINT` fires, this command writes a
   clear refusal pointing at the landing-page playbook and the
   override path (a project-local ADR).

## Refusal posture

A finding with severity `critical` (currently only `SPA_ENTRYPOINT`) is
an explicit refusal — the audit exits non-zero and the
`seo-specialist` agent will refuse PR approval on a landing surface
until either:

- The framework is changed to one that ships SSR/SSG (Astro, Next
  App Router, Nuxt, Remix, SvelteKit), OR
- The project ships a local ADR explicitly carving the surface out
  ("this is an internal admin tool — no indexability needed").

## When to run

- **Before opening a PR** that touches a landing page or marketing
  site.
- **On the design pass** when proposing a new public route.
- **In CI** — the JSON output is gateable
  (`node contextkit/tools/scripts/seo-audit.mjs --json > seo.json` +
  a tiny step that `jq`s for critical severity).

## What it does NOT do

- It does not auto-rewrite HTML. Findings are the deliverable; the
  human approves the fix (rule 8, ADR-0025).
- It does not run a headless-browser crawl. Static analyser only
  (rule 1).
- It does not measure Core Web Vitals. Use PageSpeed Insights or
  Lighthouse CI for that. The audit flags *patterns* that hurt
  CWV (missing image dimensions, JS-rendered hero content) — not the
  measurements themselves.
