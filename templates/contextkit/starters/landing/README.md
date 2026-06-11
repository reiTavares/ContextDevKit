# Landing starter — componentized source, atomic output (ADR-0050)

Structure with `{{token}}` placeholders and **zero invented domain content**
(rule 9). The AI (or you) edits `content/*.json`; the markup is deterministic.

```
lp-scaffold.mjs            copies this tree into <project>/lp/ (write-if-missing)
lp-build.mjs               assembles lp/ → lp/dist/ (index, legal pages, meta files)
lp-build.mjs --check       fails on leftover {{tokens}} / [PREENCHA] sentinels,
                           then runs seo-audit + aiso-audit against dist/
```

- `content/copy.json` — ALL visible text + meta + FAQ. The single editing surface.
- `content/legal.json` — business facts that fill the legal pages.
- `sections/NN-*.html` — one fold per file (delete a file to drop the fold;
  `04-proof` MUST be deleted if you have no real, authorized proof).
- `partials/` — consent banner (default ON), ID-less consent-gated GTM, JSON-LD.
- `js/tracking-models.js` — commented pixel templates; never shipped to dist.
- Legal pages are drafts ("minuta") — the lawyer-review disclaimer is part of
  the template and must not be removed.
