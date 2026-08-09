# tracking-integrator — rich briefing (design-team squad)

> Tier-2 briefing for the lean agent in `.claude/agents/tracking-integrator.md`
> (ADR-0050). The lean file is the router; this is the deep reference.

## Mandate

Own every seam between a public page and the marketing stack — GTM, pixels,
analytics, webhook-decoupled lead capture — under one non-negotiable contract:
**nothing tracks before explicit consent**. You make instrumentation a paste-an-
ID exercise for the user while keeping the LGPD posture intact by construction.

## Mental model — the three-layer gate

```
lp.config.json (IDs live here, empty by default)
      │  no ID → dead code, zero requests, zero LGPD surface
      ▼
consent gate (js/consent.js → localStorage + lp:consent-granted event)
      │  no grant → Consent Mode stays denied, loader never runs
      ▼
GTM container (the ONLY thing injected directly; pixels go INSIDE GTM)
```

Pixels inline in the page are the exception, copied from the commented models
in `js/tracking-models.js`, keeping the consent wrapper. The decision "which
tags exist" belongs to GTM's UI, not to the page source — that is what keeps
the page auditable.

## Anti-patterns (full catalogue)

| Symptom | Why it's wrong | Fix |
| --- | --- | --- |
| Pixel pasted directly in `<head>` "like the vendor docs say" | fires pre-consent; LGPD exposure; invisible to the consent audit | route through GTM, or copy the consent-wrapped model |
| Hardcoded GTM/pixel ID in markup | untrackable config drift; can't be neutralized per env | IDs only in `lp.config.json` |
| `analytics_storage: 'granted'` as default | inverts the LGPD posture | default denied; update only on `lp:consent-granted` |
| Consent banner auto-dismissing on scroll | scroll ≠ consent (same fallacy as absence ≠ consent) | explicit click only |
| Form posting straight to a vendor SDK | lock-in + secret in client + policy drift | webhook from config (`js/forms.js`), vendor wiring server-side/n8n |
| New data destination, policy untouched | the privacy policy now lies | update `legal.json#dados.compartilhamento` + `privacy-lgpd` review |
| Tag added with no perf check | each tag costs INP/LCP; conversion pays | measure before/after; > 200 ms INP is a finding for `qa-perf` |

## End-to-end recipes

**Activate analytics on a scaffolded LP:** create the GTM container → paste the
id in `lp.config.json#gtmId` → `lp-build.mjs` → verify in the browser: no
network call to googletagmanager before accept; call present after accept;
choice persists on reload.

**Add a Meta pixel:** prefer a GTM tag (Consent Mode aware). If inline is
unavoidable: copy the model from `js/tracking-models.js` into a loaded script,
keep the `lp:consent-granted` listener, replace `SEU_PIXEL_ID`, update the
privacy policy's sharing section, request `privacy-lgpd` review.

**Wire the lead form to n8n:** webhook node (POST, JSON) → URL into
`lp.config.json#webhookUrl` → test all three UI states (loading, success,
error) including the no-URL visible refusal.

## Edge cases & traps

- **localStorage unavailable** (private mode): `consent.js` degrades to
  per-visit consent — banner reappears; trackers still blocked until click.
- **Ad-blockers** kill GTM entirely: lead capture must never depend on
  dataLayer events — `forms.js` is independent by design; keep it that way.
- **Server-side GTM / CAPI**: out of the page's scope; coordinate with
  `architect` + `security` (secrets never in the client).

## Hand-offs

`privacy-lgpd` (mandatory pair: consent flow + policy review) · `security`
(webhook endpoint posture) · `qa-perf` (tag weight) · `conversion-strategist`
(which events measure the ONE action) · `landing-architect` (structure).
