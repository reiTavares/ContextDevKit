---
description: Turn a finished CHANGELOG release into announcement copy (release notes + short social posts). Drafts only — never posts.
argument-hint: [version | --unreleased]
---

# 📣 Changelog → announcement copy

Turn a shipped release into human announcement copy [ADR-0030, OSS repo-ops].
This **drafts text only** — it never posts anywhere. Publishing is always a
deliberate human action (sending content to an external service is irreversible).

1. **Read the source.** Pull the target section from `docs/CHANGELOG.md` — a cut
   version (`[X.Y.Z]`) or `[Unreleased]` if `--unreleased`. If you need the raw
   commit context, run `node contextkit/tools/scripts/draft-changelog.mjs`.

2. **Draft three artifacts**, in order of shrinking length:
   - **Release notes** (GitHub Releases / blog): a one-paragraph "why this matters",
     then the highlights grouped by theme, then breaking changes + migration, then
     a thank-you. Lead with user value, not commit nouns.
   - **Short post** (~280 chars, X/Mastodon/LinkedIn): the single biggest win +
     the version + a link placeholder `<release-url>`. No hashtag spam.
   - **One-liner** (changelog RSS / Discord): `vX.Y.Z — <the headline change>`.

3. **Tone rules.** Concrete over hype. Name the user benefit, not the internal
   refactor. No invented metrics, no "revolutionary". If the release is mostly
   chores, say "maintenance release" honestly rather than inflating it.

4. **Hand back the drafts** for the user to review and post. Offer to save them to
   a scratch file, but **do not publish** — no `gh release create`, no API calls,
   unless the user explicitly asks in a follow-up.
