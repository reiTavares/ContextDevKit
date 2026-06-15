---
phases:
  - pipeline
  - ship
squads:
  - design-team
---
# Playbook — SEO + AISO (the two index spaces)

> Operational entry: `/seo-audit` runs both static analysers
> (`seo-audit.mjs` + `aiso-audit.mjs`) and the
> [`seo-specialist`](../../squads/_BRIEFING.md.tpl) agent reads this
> page on every invocation. Refuse-on-unindexable is the load-bearing
> rule; this playbook is what "indexable" means in practice.
>
> Authority: [ADR-0025](../../memory/decisions/0025-seo-and-aiso-posture.md). Freshness: AISO conventions dated **2026-06-02** — `llms.txt` + FAQ-schema effectiveness re-evaluated quarterly.

## Two indexes, two rule sets

A public page lives in two index spaces at the same time and is judged
by different signals in each.

| Index | Crawlers | What they reward | What kills you |
|---|---|---|---|
| **Classical SEO** | Googlebot, Bingbot, DuckDuckBot | server-rendered HTML, semantic tags, canonical URLs, sitemap, Core Web Vitals, JSON-LD entity markup | empty `<div id="root">`, JS-rendered titles, missing `<meta description>`, CLS > 0.1 |
| **AISO (AI Search Optimization)** | GPTBot, ClaudeBot, PerplexityBot, Google-Extended, OAI-SearchBot | `llms.txt`, FAQ schema, scannable Q&A headings, semantic HTML5, author + date schema | div-soup, JS-rendered content, no FAQ schema, no `llms.txt`, robots.txt blocking AI crawlers without user opting out |

Most projects optimise the first and ignore the second. In 2026 the
second is a measurable distribution channel — ChatGPT search, Claude
with web search, Perplexity, Gemini — and the gap between "ranks on
Google" and "appears in LLM answers" is a real conversion gap.

## SEO — the floor (refuse if missing)

### Server-rendered HTML

The smell that kills indexability: `curl https://your-page` returns
`<body><div id="root"></div></body>` and the rest is JS.

The refusal is automatic on landing surfaces (ADR-0025 + ADR-0023).
The fix is to pick a framework that ships SSR or SSG by default —
Astro, Next App Router (RSC), Nuxt, SvelteKit. Plain Vite + React for
a landing page is refused; use Astro.

### Per-page meta

- **`<title>`** — set server-side, descriptive, unique per route.
  Length: 50–60 chars (Google may truncate longer ones in SERPs).
- **`<meta name="description">`** — unique per route, 120–160 chars,
  rewrites the page in a way that earns the click.
- **`<link rel="canonical" href="https://...">`** — absolute URL,
  one per page. Without it Google may pick a wrong canonical and your
  internal links scatter ranking.

### Site-wide files

| File | Purpose | Smell |
|---|---|---|
| `sitemap.xml` | lists every public route Google should crawl | absent, or stale (missing recently-added routes) |
| `robots.txt` | tells crawlers what to fetch and what to skip | `User-agent: * Disallow: /` left over from staging |
| `humans.txt` | optional — credit the team | absent (not a refusal, but nice) |

### Structured data (JSON-LD)

For a marketing site, at minimum:

- `Organization` — the brand entity. Name, logo, sameAs (linked
  social), URL.
- `WebSite` with `SearchAction` — enables Google's sitelinks search
  box.
- `BreadcrumbList` on internal pages — shows breadcrumbs in SERPs.
- One per content type — `Product`, `SoftwareApplication`,
  `Article`, etc — relevant to the page.

The JSON-LD validator is at https://validator.schema.org/. Run it on
the rendered HTML, not the source.

### Images

- Every `<img>` has `alt`. Empty `alt=""` is correct for decorative
  images (better than absent — explicit no-text-needed signal).
- `width` and `height` attributes set — prevents CLS.
- Modern formats: AVIF or WebP with a JPEG/PNG fallback via
  `<picture>`.
- `loading="lazy"` on below-the-fold images; `loading="eager"` (the
  default) on the hero.
- `fetchpriority="high"` on the LCP image — measurable LCP
  improvement.

### Core Web Vitals (ranking signal since 2021)

| Metric | Threshold |
|---|---|
| **LCP** (Largest Contentful Paint) | < 2.5 s |
| **INP** (Interaction to Next Paint — replaced FID in 2024) | < 200 ms |
| **CLS** (Cumulative Layout Shift) | < 0.1 |

Measure with PageSpeed Insights (lab) + Plausible / Vercel Analytics
(real users). Lighthouse CI on every PR catches lab regressions.

## AISO — above the floor

### `llms.txt` at the root

A 2024-vintage convention (https://llmstxt.org) — the analogue of
`sitemap.xml` for AI crawlers. Format is markdown, listing the
canonical pages an LLM should cite.

Minimum viable `llms.txt`:

```
# Project name

> One-sentence description of what the project is.

## Docs

- [Page title](https://example.com/page): one-line description
- [Another page](https://example.com/another): ...

## Examples

- [Example 1](https://example.com/example-1): ...
```

The LLM crawlers that honour it (early 2026: Anthropic, partial OAI,
partial Perplexity) get a curated routing map instead of having to
guess from the HTML.

### FAQ schema — the load-bearing AISO move

LLM answer engines cite `FAQPage` JSON-LD near-verbatim. A marketing
page with 3–5 real Q&A pairs in `FAQPage` schema shows up in
ChatGPT / Perplexity answers; a marketing page without one does not.

The pattern:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is [Product]?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "One-sentence concrete answer. No marketing fluff. No 'leverage synergies'."
      }
    },
    // 2–4 more
  ]
}
</script>
```

Questions to pick: the **real** customer questions, in the customer's
words. The same 5 questions sales answers on every demo. If the team
does not know them, ask sales for a list — the 5 that come up most.

### Semantic HTML5

LLM extractors weight semantic tags. `<article>`, `<section>`,
`<nav>`, `<main>`, `<aside>`, `<header>`, `<footer>`. Not divs
everywhere with class names that describe the same thing.

Bad:
```html
<div class="article">
  <div class="header">
    <div class="title">Why X matters</div>
  </div>
  <div class="content">...</div>
</div>
```

Good:
```html
<article>
  <header>
    <h2>Why X matters</h2>
  </header>
  <p>...</p>
</article>
```

The `aiso-audit.mjs` script flags pages with a low semantic-tag ratio
(divs : semantic > 5:1).

### Scannable Q&A headings

LLM summarisers look for question-shaped headings. A page with
`## What is X?` / `## How do I Y?` / `## When should I use Z?` is
easier for an LLM to extract than the same content as flowing prose.

The pattern is best for help / docs / "how it works" sections, not
for the hero. Use it on the second half of the page.

### Author + organization schema

LLM rankers weight authored content over anonymous. Every public
document carries:

- `Organization` schema (brand-level — see SEO section).
- `Person` schema for the author when the page has one.
- `datePublished` and `dateModified` — LLMs care about recency.

### Robots & AI crawlers

`robots.txt` default for a marketing site:

```
User-agent: *
Allow: /
Sitemap: https://your-domain/sitemap.xml

# AI crawlers — explicitly named. Opt out by changing Allow: / to
# Disallow: / under the specific user-agent block.
User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: OAI-SearchBot
Allow: /
```

The `aiso-audit.mjs` script flags a `robots.txt` that blocks any of
these without a project-local ADR opting out explicitly.

### Avoid JS-rendered content for cited material

Most LLM crawlers in 2026 do not execute JS reliably. The pricing
table, the FAQ, the documentation, the marketing copy — all in the
HTML. Reserve JS for interactivity (open the modal, animate the
chart, toggle the menu) — never for content the user wants cited.

## Audit codes (what the scripts emit)

`seo-audit.mjs` and `aiso-audit.mjs` emit findings:

```json
{ "file": "src/pages/index.astro", "line": 12, "code": "MISSING_DESCRIPTION", "severity": "high", "message": "..." }
```

### SEO codes

| Code | Severity |
|---|---|
| `SPA_ENTRYPOINT` | critical (refusal) |
| `MISSING_TITLE` | high |
| `MISSING_DESCRIPTION` | high |
| `MULTIPLE_H1` | high |
| `MISSING_CANONICAL` | medium |
| `MISSING_ALT` | medium |
| `MISSING_SITEMAP` | high |
| `MISSING_ROBOTS` | medium |

### AISO codes

| Code | Severity |
|---|---|
| `MISSING_LLMS_TXT` | high |
| `MISSING_FAQ_SCHEMA` | high |
| `MISSING_ORG_SCHEMA` | medium |
| `DIV_SOUP` | medium |
| `JS_RENDERED_CONTENT` | high |
| `MISSING_AUTHOR_SCHEMA` | low |
| `MISSING_DATE_STAMP` | low |
| `BLOCKS_AI_CRAWLERS` | high |

## When this playbook does NOT apply

- **Internal admin tools / dashboards behind auth** — no indexability
  expected. The override is a project-local ADR.
- **Single-customer apps** — same posture as admin tools.
- **API endpoints / JSON resources** — no SEO surface.

The seo-specialist agent respects these overrides; do not re-litigate
them.

## Freshness protocol

AISO conventions are young (2024–2026). This playbook's AISO section
carries a date. When `llms.txt` adoption stalls or a new convention
overtakes FAQ schema, the playbook is amended via an ADR. Re-evaluate
quarterly.
