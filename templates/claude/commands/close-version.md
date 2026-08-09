---
description: Close the current version in the CHANGELOG ([Unreleased] → [X.Y.Z]) and tag it.
argument-hint: <version e.g. 0.2.0>
---

Close version **$ARGUMENTS** in `docs/CHANGELOG.md`.

1. Read `docs/CHANGELOG.md`. Confirm `[Unreleased]` has content. If empty, stop and tell the user
   there is nothing to release.

2. Rename the `## [Unreleased]` heading to `## [$ARGUMENTS] - <today YYYY-MM-DD>` and insert a fresh
   empty `## [Unreleased]` block above it (with placeholder "Add your changes here.").

3. Summarize to the user what is being released.

4. Offer (do NOT run without confirmation) the tag + release commands:
   ```
   git add docs/CHANGELOG.md
   git commit -m "chore(release): v$ARGUMENTS"
   git tag v$ARGUMENTS
   ```
   And, if a GitHub remote exists and `gh` is available, offer `gh release create v$ARGUMENTS`.

If ContextDevKit is at Level 5 and a `qa` gate marker is configured beyond T0, surface any failing
quality signals before closing.
