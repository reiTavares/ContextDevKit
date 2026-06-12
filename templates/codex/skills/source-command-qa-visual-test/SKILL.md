---
name: "source-command-qa-visual-test"
description: "Visual / browser-driven testing harness — scaffold + run screenshot/visual-regression checks (qa-e2e + design-team)."
---

# source-command-qa-visual-test

Use this skill when the user asks to run the migrated source command `visual-test`.

## Command Template

# 🖼️ Visual test (qa-e2e + design-team)

Add a **browser-driven, visual** layer on top of behavioural e2e: open the running
app, exercise a flow, and verify by **screenshot / visual regression**. The kit
**scaffolds**; the browser runner is a **project** dependency (never the kit's zero-dep
hot path).

Act on **$ARGUMENTS** — route to **qa-e2e**, pair with **design-team** for baselines:

## status
```
node contextkit/tools/scripts/visual-test.mjs status
```
Reports whether a visual harness exists (Playwright/Cypress for JS, pytest-playwright
for Python) and what's missing.

## scaffold
```
node contextkit/tools/scripts/visual-test.mjs scaffold          # auto-detect stack
node contextkit/tools/scripts/visual-test.mjs scaffold --python
```
Writes a starter (write-if-missing): a Playwright config + a `tests/visual/` screenshot
baseline. Then install the runner (the command prints it):
`npm i -D @playwright/test && npx playwright install` (JS) or
`pip install pytest-playwright && playwright install` (Python).

## run / baseline
Run the project's visual suite (e.g. `npx playwright test tests/visual`). The first run
records baselines; later runs diff against them. Treat an **unintended** visual diff as
a failure; update baselines deliberately (`--update-snapshots`) and have **design-team**
review intentional changes.

## judgment (qa-e2e)
- Cover the few screens where the *look* is the contract; don't snapshot everything.
- Stabilize: fixed viewport, seeded data, masked dynamic regions, wait on network-idle.
- A change isn't "done" until the visual check is green — wired into `/qa-signoff` and
  the `/ship` gate.
