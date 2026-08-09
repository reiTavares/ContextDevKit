# Reference: Changelog policy

The rules governing release chronology: which file records what, who cuts a version,
what the format requires, and which entries are refused.

## Two changelogs with the same name

The most common mistake in this area is conflating two files with near-identical
names and opposite subjects. They are different entities and neither substitutes for
the other.

| File | Subject | Where it lives | Origin |
| --- | --- | --- | --- |
| `CHANGELOG.md` at the repository root | The **product's** releases — the platform itself | Only in the platform's own source repository | Authored and closed by hand |
| `docs/CHANGELOG.md` | The **installed project's** releases — your application | Inside each project the platform is installed into | Rendered at install time from `templates/docs/CHANGELOG.md.tpl` |

Read the consequence carefully, because it inverts depending on where you are
standing.

- Working in **your own project**: `docs/CHANGELOG.md` is your changelog. It is the
  file `/close-version`, `/log-session`, and `/draft-changelog` all mean. The
  platform's product changelog is not present in your repository at all.
- Working on **the platform's source**: the root `CHANGELOG.md` is the product
  changelog and the only one tracked in that repository. Every reference to
  `docs/CHANGELOG.md` inside the shipped templates means the *target project's* file,
  which is evaluated in the target repository — never the product changelog.

In the platform's own repository both files exist on disk, because that repository
also installs the platform into itself. The one in `docs/` there belongs to the
dogfood install and is not the product record. The product changelog carries this
warning at the top of the file for exactly this reason.

## Format

Both changelogs use [Keep a Changelog](https://keepachangelog.com/) with
[Semantic Versioning](https://semver.org/).

### Structure

A changelog is a reverse-chronological list of version sections. The newest section is
always `## [Unreleased]`, which accumulates entries as work lands. Released sections
carry a version and an ISO date:

```markdown
## [Unreleased]

### Added
- <entry>

## [3.7.0] - 2026-07-19

### Added
- <entry>
```

### Sections

Within a version, entries are grouped under the Keep a Changelog headings: `Added`,
`Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`. A section with no entries is
omitted rather than left empty.

### Version numbers

Semantic Versioning: the major digit changes on a breaking change to the public
surface, the minor on backward-compatible capability, the patch on a
backward-compatible fix. A pre-release qualifier is permitted and documents which
section it belongs to.

## Rotation by major

A single unbounded changelog becomes unreadable and expensive for every tool that
reads it whole. The policy bounds it:

- `CHANGELOG.md` retains `[Unreleased]` plus the **current major** only.
- When a major closes, its sections move to `docs/changelog/vN.md`.
- `docs/changelog/README.md` indexes the rotated majors.

Rotation is part of closing a version at a major boundary, not a routine step. It
happens once per major, and the rotated file is byte-for-byte the sections that left
the head file — rotation moves history, it never rewrites it. Until a major closes,
the head file legitimately carries everything since the last rotation.

## Who cuts a version

`/close-version <version>` is the entry point. It performs, in order:

1. Read the changelog and confirm `[Unreleased]` has content. An empty
   `[Unreleased]` stops the process — there is nothing to release.
2. Rename `## [Unreleased]` to `## [<version>] - <today>` and insert a fresh empty
   `[Unreleased]` above it.
3. Summarise what is being released.
4. Offer — never run unprompted — the commit and tag commands.

Drafting the entries is a separate, read-only step:

```shell
node contextkit/tools/scripts/draft-changelog.mjs
node contextkit/tools/scripts/draft-changelog.mjs --since v1.7.0
node contextkit/tools/scripts/draft-changelog.mjs --json
```

This reads Conventional Commit subjects since the last tag and groups them into
Keep a Changelog sections. It **drafts only** — it never writes the changelog. A
human reviews the draft, rewrites the entries into readable prose, and pastes them in.
Commit subjects are not changelog entries: they are written for reviewers of a diff,
not for readers of a release.

### Publishing

Push the release commit and the tag. A release workflow triggered by the tag runs the
full gate and creates the release. Do not create the release by hand — the tag is the
trigger, and a manually created release collides with the one the workflow makes.

## Prohibited entries

Three failure modes are refused rather than tolerated, because each one silently
degrades the record's value.

### A duplicated entry

The same change described twice, whether inside one version section or across two.
A duplicate makes the release look larger than it was and makes the changelog
unusable for answering "when did this ship" — there are now two answers.

### An entry without a verb

An entry names a change. A fragment that names only a component (`Workflow engine.`,
`Config schema.`) records that something happened to it and nothing about what. Every
entry starts from what changed: added, changed, removed, fixed. A reader must be able
to tell from the entry alone whether the change affects them.

### A claim without a receipt

An entry asserting that something was verified, measured, or improved, where no
evidence exists for the assertion. Concretely:

- No count of installs, users, or sessions.
- No percentage improvement, saving, or speed-up without a recorded before-and-after
  number.
- No "tests pass", "fully covered", or "verified" without the command output that
  established it.
- No model-quality or superiority judgment.

An unverified change is still worth an entry — write what changed and omit the claim.
Where a measurement was attempted and could not be taken, the honest record is that it
was not measured. It is never reported as a pass.

## Error conditions

| Condition | Result |
| --- | --- |
| `[Unreleased]` is empty at close time | The close stops; nothing is cut |
| A duplicate entry is present | The entry is removed before the version is cut |
| The version already exists as a section | The close is refused; pick the next version |
| The tag exists on the remote | Do not move or recreate it; cut the next version instead |
| Drafting finds no commits since the last tag | The draft is empty; that is a report, not an error |

## See also

- [Memory model](memory-model.md) — the session log, which records what a session did.
  It is a separate record from the release chronology and neither replaces the other.
- [Glossary](glossary.md) — the normative vocabulary.
- [The work domain model](../explanation/domain-model.md) — receipts and why a claim
  without one is refused.
