# Skill: docs-reindex

> Apply/maintain the Diátaxis docs spine — ensure the four buckets and regenerate docs/README.md. Idempotent, never moves or loses files.
> Argument: (none)
# 📚 Reindex docs (Diátaxis)

Keep `docs/` organized by [Diátaxis](https://diataxis.fr/) — the four reader-intent
modes: **tutorials** (learning) · **how-to** (task) · **reference** (information) ·
**explanation** (understanding) [ADR-0030].

1. Run it:
   ```
   node contextkit/tools/scripts/docs-reindex.mjs
   ```
   It (a) ensures `docs/{tutorials,how-to,reference,explanation}/` exist with a
   README stub, and (b) **regenerates `docs/README.md`** as the navigation index,
   classifying every doc into a mode.

2. **It reorganizes without losing anything.** It never moves, renames, or deletes
   a content file, and it never overwrites a hand-written `docs/README.md` (only one
   carrying its auto-generated marker). The installer also runs it on `--update`, so
   the index stays current as docs grow.

3. **Classification.** A doc is placed by `docs/.diataxis.json` (explicit
   `{ "<relative-path>": "<mode>" }`), then by the bucket folder it lives in, then
   by a filename heuristic. Anything it can't place is listed under **Unclassified**
   in the index (never dropped silently) — add it to `docs/.diataxis.json` and
   re-run.

> `ROADMAP.md` and `CHANGELOG.md` are listed under "Planning & meta", not a
> Diátaxis mode — they're planning artifacts, not docs-for-readers.
