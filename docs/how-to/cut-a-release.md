# How to cut a release

<!-- GENRE: How-to guide (task-oriented)
     Goal: maintainer ships a version without tagging on a red gate or double-publishing.
     Voice: direct, imperative.
     Facts: the release trigger, the required secret and the preflight behaviour come
     from the release workflow and the version preflight script. -->

## When to use this guide

You maintain the kit and want to publish a version. This is a maintainer task — if you
are a user wanting the newest version in your project, you want
[upgrade and update](upgrade-and-update.md) instead.

## Prerequisites

- Publish rights, and the automation token stored as a repository secret.
- A green gate. The release workflow runs the suite again, but discovering a red gate
  after tagging is a worse experience than discovering it before.
- The changelog's unreleased section actually filled in. An empty one means there is
  nothing to release.

## Steps

### Prepare the changelog

1. Draft the unreleased section from the commits since the last tag.

   ```shell
   node contextkit/tools/scripts/draft-changelog.mjs
   ```

   This **drafts only** — it never writes the file. It reads the local git log, groups
   conventional-commit subjects into the standard sections, and prints the result for you
   to review and paste. Scope it explicitly when you need a different starting point:

   ```shell
   node contextkit/tools/scripts/draft-changelog.mjs --since v3.6.0
   ```

2. Review what you pasted. Three things are not allowed in a release entry: a duplicated
   line, an entry with no verb, and a claim with no receipt behind it. See
   [changelog policy](../reference/changelog-policy.md).

3. Close the version.

   ```text
   /close-version <X.Y.Z>
   ```

   This renames the unreleased heading to the version with today's date and opens a fresh
   empty unreleased block above it.

   Know which changelog you are closing. The repository-root `CHANGELOG.md` is **this
   product's** release history. A `docs/CHANGELOG.md` inside an installed project is
   **that project's** history, rendered from a template — a different file with the same
   name and the opposite meaning.

### Run the preflight

4. Bump the version in the package manifest, then run the preflight.

   ```shell
   npm run preflight-release
   ```

   This runs the full gate first, then refuses if the version is already published. Both
   halves exist because both mistakes have happened: tagging on a red gate, and
   re-publishing an existing version. A non-zero exit means stop and fix, not retry.

### Tag and push

5. Commit, tag, push.

   ```shell
   git commit -am "chore(release): vX.Y.Z"
   git tag vX.Y.Z
   git push && git push --tags
   ```

6. Do not create the release by hand.

   Pushing a version tag triggers the release workflow, which runs the suite and then
   publishes. Creating the release manually collides with it and fails. Push the commit
   and the tag; let the workflow do the rest.

### Announce it

7. Turn the closed entry into announcement copy.

   ```text
   /changelog-social
   ```

   Drafts only — it never posts anything.

## Verify it worked

- The release workflow shows a green run for the tag you pushed.
- The published version matches the manifest.
- The unreleased section is empty and the version you closed carries its date.

## Troubleshooting

**Symptom:** The preflight refuses, saying the version is already published.
Fix: Bump the version in the manifest. Republishing the same version is what the check
exists to prevent.

**Symptom:** The release workflow did not trigger.
Fix: It triggers on a version tag push specifically. Confirm the tag reached the remote
with `git push --tags`, and that the tag name carries the expected prefix.

**Symptom:** Publishing failed on authentication.
Fix: The automation token secret is missing or expired. It needs publish rights and must
bypass interactive confirmation.

**Symptom:** The version-closing command reports nothing to release.
Fix: The unreleased section is empty. Draft it first.

## Related

- [Changelog policy](../reference/changelog-policy.md) — format, rotation by major, and
  the two changelogs you must not confuse.
- [Upgrade and update](upgrade-and-update.md) — the consumer side of a release.
- [Audit and test](audit-and-test.md) — the gates that must be green first.
