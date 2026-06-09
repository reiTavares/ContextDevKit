# Playbook: landing-page

> Reusable procedure. Follow the steps below when invoked.

# Playbook — Landing page & high-conversion sites

> Operational entry: `/landing-page` (the skill) calls the
> `landing-architect` briefing, which reads this playbook on every
> invocation. The SEO + AISO gate (ADR-0025) is mandatory — every
> public surface goes through `seo-specialist` before this playbook's
> visual recommendations apply.
>
> Authority: [ADR-0023](../../memory/decisions/0023-landing-page-and-conversion-posture.md). Freshness: package recommendations dated **2026-06-02** — re-evaluate quarterly.

## Why this playbook exists

The current generation of AI-generated landing pages has a uniform
look: gradient hero, three feature cards, three-tier pricing,
testimonial slider, FAQ accordion, newsletter signup. A savvy visitor
recognises the pattern in under three seconds, and recognition reads as
"AI-built" — which reads as "low effort" — which costs conversion on
the same page that was supposed to convert. This playbook is the kit's
explicit refusal of that pattern and its substitute.

## Folds — the strategic minimum

| Folds | Use when | Cost of more |
|---|---|---|
| **3 (min)** — hero · proof · CTA | utility tool, single-feature, free product with one job-to-be-done | adding more is "while we're here" — every extra fold is friction |
| **5–7 (ideal, SaaS)** — hero · problem · solution · social proof · pricing/CTA · FAQ · footer-CTA | most SaaS landing pages | beyond 7, recall + scroll-depth fall off; pick the fight you actually need |
| **9 (max recommended)** — adds: how it works · integrations · founder note | high-ticket B2B where the deal needs more context | beyond 9 you are writing a sales letter; that is a different format |

**Per-fold rule, non-negotiable:**

- **One message.** One thing the visitor should take away.
- **One action.** One next step that fold invites.
- **One proof.** When you make a claim, one concrete artefact that
  makes it credible (a number, a quote, a logo, a screenshot — never
  three "as featured in" rows).

A fold that does not pass all three is the section to cut.

## Above the fold (the only fold that exists at first)

Hard rules:

- **Value prop ≤ 8 words.** If it does not fit, the message is not
  sharp yet. "X for Y" / "The Z that does W" / "Verb + outcome" are
  the shapes that work. Refuse: "Solutions for the modern enterprise",
  "AI-powered platform for the future of work", "Empower your team to
  do more with less" — all dead.
- **One concrete next action.** Not "Learn more" + "See pricing" +
  "Watch demo" all weighted equally — that is paralysis. Pick the
  *next* action the visitor's funnel state implies, give it visual
  weight, demote the rest to text links.
- **No second-guessing in the headline.** "We help teams" / "We
  believe" / "We're on a mission" — refuse. The reader does not care
  about you yet; they care about themselves.

## Anti-Lovable refusals (cookie-cutter patterns the playbook rejects)

Each row: the smell, why it is wrong, the substitute.

| Cookie-cutter | Why it dies | Substitute |
|---|---|---|
| Gradient purple-pink hero with centred title + "Get Started" button | recognised in 3 s as AI-generated; signals low effort | editorial layout: a strong point of view in the headline, asymmetric grid, real imagery — Veo/Nano Banana hero (ADR-0024) of the *actual* product or domain |
| Three feature cards in a row with icon + 2-line description | tells nothing; the icons are decorative; the descriptions are generic | one feature shown in context (screenshot + 1-sentence outcome), repeated 2–3 times, each tied to a real user moment |
| Three-tier pricing table (Basic / Pro / Enterprise) as default | most products do not have three tiers; the table is performative | start with one price + a "is this for me?" decision tree; if multi-tier, lay out as recommendation engine ("for teams of X → plan Y"), not table |
| Testimonial slider at the bottom | sliders hide content; visitors do not interact with them | in-context quotes *next to the feature they validate* + a single hero testimonial above the fold with a real photo |
| FAQ accordion at the bottom | hidden by default; never read; useless for AISO | FAQ as scannable Q&A headings near the relevant section + `FAQPage` JSON-LD schema for AISO (ADR-0025) |
| Full-width newsletter signup in the footer | nobody signs up for a newsletter from a landing page in 2026 | offer one specific resource (a guide, a calculator, a template) gated by an email — earned, not begged |
| Generic stock photos of people at laptops | reads as fake; everyone uses the same Unsplash bucket | real product screenshots, custom illustrations, or Veo/Nano Banana renders of the *domain* (ADR-0024) |
| `Inter` font, `Heroicons` icons, `tailwindui.com` patterns | the "AI tells" of 2026 — recognised instantly | pair a display face (e.g. Fraunces / Schibsted Grotesk / Migra) with a clean body (e.g. Geist / SF Pro Web fallback). Lucide or hand-rolled SVG for icons. |

## Package recommendations — by concern (dated 2026-06-02)

Refresh quarterly. A recommendation that no longer holds gets replaced
via an ADR-0023 amendment.

### Framework (rendering — load-bearing for SEO/AISO)

| Pick | When |
|---|---|
| **Astro** (recommended default) | content-driven landing page, marketing site, blog. SSG by default, islands for interactivity, zero JS shipped for static parts. Indexable by default. |
| **Next.js App Router** (RSC) | landing page is part of a larger Next app; team already runs Next. Heavier than Astro for pure marketing pages but ergonomically familiar. |
| **Nuxt** | same shape as Next for Vue teams. |
| **SvelteKit** | same shape as Next for Svelte teams. |
| **Plain Vite + React** | **refused** for a landing page. The empty `<div id="root">` SSR payload fails the indexability gate (ADR-0025). Use Astro instead. |

### Styling

| Pick | Notes |
|---|---|
| **Tailwind CSS** + **CSS custom properties for tokens** | the unopinionated default. Tokens via `:root { --color-primary: ... }` and Tailwind's `theme.extend` — never raw hex literals in components. |
| **Material UI, Chakra, NextUI** | **refused as defaults** — too generic; turn every product into the same product. Pick if the design team explicitly wants the trade-off. |
| **CSS-in-JS (Emotion, styled-components)** | fine technically; pays a runtime cost on every render. Prefer Tailwind for landing pages. |

### Animation

| Pick | When |
|---|---|
| **Motion** (formerly Framer Motion) | React/Vue interactions. The default. |
| **Lenis** | smooth scroll. Adds polish at zero cost for users who prefer reduced motion (respects `prefers-reduced-motion`). |
| **GSAP** | complex sequenced animations (scroll-driven, sequenced timelines). Pay the licence if commercial. |
| **View Transitions API** | route transitions, expanding cards. Astro + Next + Nuxt all wire it up. |

### Typography

| Pick | Notes |
|---|---|
| **Fontsource** | self-host any Google Font. No `<link>` to fonts.googleapis.com (GDPR + performance). |
| **`@next/font` / Astro Fonts** | same, framework-native. |
| **`Inter` as the only face** | **refused as default** — became the Helvetica of 2025; signals "AI-built". Pair a display face with a clean body. |

### Icons

| Pick | Notes |
|---|---|
| **Lucide** | clean, consistent, tree-shakeable. The default. |
| **Hand-rolled SVG** | when the brand justifies it. |
| **Heroicons** | **refused as default** — too tied to Tailwind UI templates. |

### Forms

| Pick | Notes |
|---|---|
| **react-hook-form + zod** | unopinionated, type-safe, zero re-render cost. |
| **Form backend**: **Formspree**, **Convex**, or a server route. Pick by what the rest of the project uses. |

### Analytics

| Pick | Notes |
|---|---|
| **Plausible** | privacy-first, GDPR-OK, lightweight (1 KB script). RUM-friendly for Core Web Vitals. The default. |
| **Vercel Analytics** | if already on Vercel. Web Vitals included. |
| **GA4** | **refused as default** — heavy, ugly DX, GDPR-fragile. Pick when the stakeholder requires it. |

### Experimentation

| Pick | Notes |
|---|---|
| **GrowthBook** | self-hostable, OSS, feature flags + A/B. The kit's recommended option (user preference recorded in memory). |
| **PostHog** | if already running PostHog for product analytics. |

### Imagery & video

| Pick | Notes |
|---|---|
| **`/media-gen`** (the kit) | Veo for video, Nano Banana for image — ADR-0024. Domain-specific renders instead of stock. |
| **Unsplash API** | placeholders while iterating. Replace before launch. |

## Performance budget (Core Web Vitals are a ranking signal)

Targets:

- **LCP < 2.5 s** (Largest Contentful Paint)
- **INP < 200 ms** (Interaction to Next Paint — replaced FID)
- **CLS < 0.1** (Cumulative Layout Shift)
- **First-fold JS < 100 kB compressed**

Measure with:

- **PageSpeed Insights** during development
- **Lighthouse CI** on every PR
- **Plausible** or **Vercel Analytics** for real-user metrics post-launch

A landing page that fails any of these in lab measurement is a refusal
on this playbook + a finding in `seo-audit.mjs`.

## Indexability gate (cross-link)

Every public route the user wants indexed goes through
[`seo-aiso.md`](seo-aiso.md) before this playbook's visual
recommendations apply. The gate refuses:

- Plain client-rendered SPAs (no SSR/SSG).
- Pages with `<title>` set in JS.
- Routes missing `<link rel="canonical">`.
- Sites without `sitemap.xml`, `robots.txt`, or `llms.txt` at the root.

The override path is a project-local ADR explicitly carving out the
surface (e.g. "internal admin tool — no SEO needed").

## Freshness protocol

Package recommendations decay. This playbook's rec table carries a
date (top of the file). When that date is more than 90 days old,
`seo-specialist` and `landing-architect` are licensed to override the
rec inline with a one-line note, and an amendment ADR is filed if the
override would be permanent.

## When this playbook does NOT apply

- **Internal tools / admin dashboards** — no indexability gate, no
  conversion focus. Use `ui-designer` + `ux-designer` directly.
- **Documentation sites** — different posture; SSG-by-default is the
  same but the playbook's hero / fold rules do not apply. Use a docs-
  specific frame (Astro Starlight, Nextra, Docusaurus).
- **Web apps with a marketing wrapper** — the marketing page follows
  this playbook; the app inside does not. Keep them on separate
  routes / subdomains so the SEO posture is unambiguous.
