---
description: Generate images (Nano Banana) or video (Veo) via Google AI Studio. Refuses cleanly without credentials. (ADR-0024)
argument-hint: <image|video> --prompt "..." --out PATH [options]
---

# 🎬 Media generation (Veo + Nano Banana)

Generate images or video on demand via the kit's media-provider
adapters. Two providers ship, both targeting Google AI Studio:

- **Nano Banana** — image (Imagen 3). `~$0.04 / image` (dated
  2026-06-02; verify at https://ai.google.dev/pricing).
- **Veo** — video. `~$0.50 / second`; typical 8 s clip `~$4.00`.

Authority: [ADR-0024](../../vibekit/memory/decisions/0024-media-generation-veo-nano-banana.md).

## Setup (one time)

1. Get a key at https://aistudio.google.com/apikey
2. Copy `vibekit/.env.example` to `vibekit/.env`, paste the key into
   `GOOGLE_AI_API_KEY=`.
3. (Optional) set `VIBEDEVKIT_MEDIA_MAX_USD=5.00` for a per-process
   cost cap — the adapter refuses the next call that would exceed it.
4. Run via Node's built-in env-file loader (Node 20.6+):

```
node --env-file=vibekit/.env vibekit/tools/scripts/media-gen.mjs <kind> ...
```

## Usage

### Image

```
node --env-file=vibekit/.env vibekit/tools/scripts/media-gen.mjs image \
  --prompt "editorial product hero, asymmetric grid, single bold cyan accent" \
  --out public/hero.png \
  --aspect-ratio 16:9
```

### Video

```
node --env-file=vibekit/.env vibekit/tools/scripts/media-gen.mjs video \
  --prompt "macro slow-motion of a single drop of ink hitting paper" \
  --out public/hero.mp4 \
  --duration 8 \
  --aspect-ratio 16:9
```

### Dry-run (no API call, no charge)

```
node vibekit/tools/scripts/media-gen.mjs image --prompt "..." --out path.png --dry-run
```

Prints what would be sent, including whether the required env vars are
present. Useful for sanity-checking a prompt or confirming the cost
cap is configured before the first paid call.

## Behaviour

- **Refuse-on-missing-creds (rule 8).** Without `GOOGLE_AI_API_KEY`
  set, the script exits with `NO_CREDENTIALS` pointing at
  `vibekit/.env.example`. Never silently substitutes a placeholder.
- **Refuse-on-content-policy.** Google's API rejects some prompts;
  the script exits with `CONTENT_POLICY`. Refine the prompt and
  retry.
- **Cost-cap guard.** When `VIBEDEVKIT_MEDIA_MAX_USD` is set, the
  adapters keep a per-process running total and refuse the next call
  that would push it over the cap.
- **Atomic file write.** The output file is written with the parent
  directory created on demand (`mkdir -p`-style).

## What this does NOT do

- **No cache.** Re-running the same prompt re-charges the API.
  Content-addressed cache is a follow-up (ticket 056).
- **No third provider.** Runway, Luma, Midjourney are not in scope.
  Rule 9 — next consumer justifies the next adapter.
- **No automatic invocation.** This command never runs by itself.
  Each call is explicit and the user accepts the cost.
- **No Vertex AI / OAuth flow.** Single-key API only. ADR-0024 spells
  out why (rule 1 — token refresh breaks zero-dep).

## When to use it

- Hero imagery on a landing page when stock photos would read as
  generic (most landing pages on the playbook's anti-Lovable list).
- Domain-specific renders for a marketing site (illustrate the
  actual product, not "person at laptop").
- Demo footage when a real recording would be slower to produce
  than to generate.
