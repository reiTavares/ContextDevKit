# Squad — design-team

The kit's "make it usable, make it beautiful, make it findable" squad. Five
specialists, each sharp and narrow. Activated at **Level 4+**.

## When to invoke each

| Specialist | When to use | Refuses |
|---|---|---|
| **`ux-designer`** | Designing or critiquing a flow / screen / interaction. User journeys, friction maps, empty/loading/error states, IA. | Clever-over-clear, decoration that costs friction, designing only happy paths |
| **`ui-designer`** | Layout, spacing, type scale, colour roles, components, responsive behaviour, design tokens. | One-off styles, hard-coded raw hex colours in components, inventing patterns when the system has one |
| **`accessibility`** | WCAG 2.1 AA verification — keyboard nav, screen-reader semantics, contrast ratios, focus management, ARIA. | Adding ARIA when semantic HTML already does the job; mouse-only interactions |
| **`seo-specialist`** *(v1.7)* | Public-facing surfaces where indexability matters — SEO (Google + Bing) and AISO (LLM answer engines). | Plain client-rendered SPAs on public routes, JS-rendered cited content, prerender hacks, missing `llms.txt` / FAQ schema |
| **`landing-architect`** *(v1.7)* | Landing-page or marketing-site structural decisions — rendering posture, fold map, conversion levers, package picks. | Cookie-cutter "Lovable / v0 / Tailwind UI" pattern; `Inter` / Heroicons / three-tier pricing / testimonial slider as defaults |

## How they pair

```text
Brief: "design a landing page for our pricing change"

  /landing-page  →  landing-architect
                       │
                       ├──→ seo-specialist     (mandatory gate — indexability first)
                       ├──→ ui-designer        (tokens + visual layout)
                       ├──→ ux-designer        (user flow through the page)
                       ├──→ accessibility      (pre-merge WCAG AA)
                       └──→ /media-gen         (hero imagery instead of stock)
```

The **order matters**. `landing-architect` decides the rendering posture and
fold map first; `seo-specialist` verifies indexability *before* visual work
lands; only then do `ui-designer` and `ux-designer` shape the screen.

## `landing-architect` — the structural decision-maker *(new in v1.7)*

Authority: [ADR-0023](../../contextkit/memory/decisions/0023-landing-page-and-conversion-posture.md)
+ [`landing-page.md`](../../templates/contextkit/workflows/playbooks/landing-page.md) playbook.

### Posture

Anti-Lovable / anti-cookie-cutter is the load-bearing principle. The current
generation of AI-generated landing pages has a uniform look (gradient hero,
three feature cards, three-tier pricing, testimonial slider, FAQ accordion)
that a savvy visitor recognises in 3 seconds. Recognition reads as
"AI-built" → "low effort" → conversion cost.

### The three decisions (in this order)

1. **Rendering posture** — SSG (Astro recommended), SSR (Next App Router /
   Nuxt / Remix / SvelteKit), or carve-out via project ADR. Plain Vite +
   React for a public landing page is a refusal; propose Astro.
2. **Fold map** — count from the playbook's table:
   - **min 3** (hero · proof · CTA) — utility / one-feature pages
   - **ideal 5–7** — SaaS, marketing pages
   - **max 9** — high-ticket B2B; beyond falls off a cliff
   - Per-fold rule: **one message · one action · one proof**.
3. **Package picks** — framework, styling, animation, typography, icons,
   forms, analytics, experimentation, imagery. From the dated rec table
   in the playbook; refuse `Inter` / Heroicons / GA4 / Material UI as
   *defaults*.

### Output shape

Every `/landing-page` response is structured exactly:

1. Indexability decision (SSG / SSR / carve-out + framework + rationale)
2. Fold map (each: `<fold-name> · <message> · <action> · <proof>`)
3. Anti-Lovable map (smells refused + substitute for each)
4. Stack (one-line rationale per category)
5. Performance budget (LCP < 2.5 s · INP < 200 ms · CLS < 0.1 · JS < 100 kB)
6. Next-step delegations (which agent for what input)

**No code.** The plan is the deliverable.

## `seo-specialist` — the indexability + discoverability gate *(new in v1.7)*

Authority: [ADR-0025](../../contextkit/memory/decisions/0025-seo-and-aiso-posture.md)
+ [`seo-aiso.md`](../../templates/contextkit/workflows/playbooks/seo-aiso.md) playbook.

### Two index spaces, two rule sets

A public page is judged by **two crawler classes simultaneously**, and most
projects optimise the first while ignoring the second.

| Index | Crawlers | Rewards | Kills |
|---|---|---|---|
| **Classical SEO** | Googlebot, Bingbot, DuckDuckBot | Server-rendered HTML, semantic tags, canonical URLs, sitemap, Core Web Vitals, JSON-LD entities | Empty `<div id="root"></div>`, JS-rendered titles, missing `<meta description>`, CLS > 0.1 |
| **AISO** (AI Search Optimization) | GPTBot, ClaudeBot, PerplexityBot, Google-Extended, OAI-SearchBot | `llms.txt`, FAQ schema, scannable Q&A headings, semantic HTML5, recency stamps, author schema | Div-soup, JS-rendered content, no FAQ schema, no `llms.txt`, robots.txt blocking AI crawlers |

### Operational principles

- **Audit-first.** Runs `seo-audit.mjs` + `aiso-audit.mjs` before any opinion.
- **Refuse-on-unindexable for landing surfaces.** Plain SPA on public routes
  is a refusal — proposes SSG / SSR.
- **Refuse JS-tricks.** Prerender services, dynamic-rendering middleware —
  brittle, propose-correct-rendering-mode-up-front instead.
- **AISO is not optional for marketing sites.** `llms.txt` + FAQ schema +
  semantic HTML5 = the 80/20.
- **Propose, don't auto-rewrite.** Findings are the deliverable.
- **Respect project-local ADRs** that carve out indexability (internal admin
  tools, etc).

### Audits available

```bash
# Classical SEO — 8 codes, exit 1 on critical (SPA_ENTRYPOINT)
node contextkit/tools/scripts/seo-audit.mjs            # human-readable table
node contextkit/tools/scripts/seo-audit.mjs --json     # machine-readable

# AISO — 8 codes
node contextkit/tools/scripts/aiso-audit.mjs           # human-readable table
node contextkit/tools/scripts/aiso-audit.mjs --json    # machine-readable

# Or the slash command runs both and summarises:
/seo-audit
```

| SEO codes | AISO codes |
|---|---|
| `SPA_ENTRYPOINT` (critical), `MISSING_TITLE` (high), `MISSING_DESCRIPTION` (high), `MULTIPLE_H1` (high), `MISSING_CANONICAL` (medium), `MISSING_ALT` (medium), `MISSING_SITEMAP` (high), `MISSING_ROBOTS` (medium) | `MISSING_LLMS_TXT` (high), `MISSING_FAQ_SCHEMA` (high), `MISSING_ORG_SCHEMA` (medium), `DIV_SOUP` (medium), `JS_RENDERED_CONTENT` (high), `MISSING_AUTHOR_SCHEMA` (low), `MISSING_DATE_STAMP` (low), `BLOCKS_AI_CRAWLERS` (high) |

## `ui-designer` — the system voice

Owns layout, spacing, type scale, colour roles, components, responsive
behaviour, and visual consistency via **design tokens** (`:root { --color-primary: ... }`).
Refuses one-off styles. Pairs with the chosen styling system (Tailwind +
tokens being the kit's recommended default).

## `ux-designer` — the user-flow voice

Owns user journeys, IA, interaction design, and the *unhappy paths* (empty,
loading, error, partial, offline, first-run). Designs the flow backward
from the job-to-be-done; resists clever-over-clear.

## `accessibility` — the WCAG 2.1 AA floor

Owns keyboard navigation, screen-reader semantics, contrast ratios, focus
management, ARIA hygiene. Refuses ARIA-when-semantic-HTML-already-does-the-job.
Mandatory before any landing-page or marketing surface merges.

## Growing the squad

To add a specialist (e.g. `motion-designer` for advanced interaction):

1. Copy `templates/claude/agents/_TEMPLATE.md`.
2. Fill in `name` + `description` (the routing signal — Claude picks an
   agent by matching the description).
3. Add posture / principles / anti-patterns / self-audit / delegate-to.
4. Add a selfcheck assertion in `tools/selfcheck-source.mjs`.
5. Document in this file under "When to invoke each".

A vague "helps with everything" agent defeats routing. Keep it **sharp and
narrow** — see `seo-specialist.md` and `landing-architect.md` as references.

## Related

- [`docs/SQUADS/agent-forge.md`](agent-forge.md) — the L6+ squad that *builds*
  Agent Packages portable across hosts.
- Playbook [`landing-page.md`](../../templates/contextkit/workflows/playbooks/landing-page.md)
  + [`seo-aiso.md`](../../templates/contextkit/workflows/playbooks/seo-aiso.md).
- [`docs/CUSTOMIZING.md`](../CUSTOMIZING.md) — adding agents to any squad.
