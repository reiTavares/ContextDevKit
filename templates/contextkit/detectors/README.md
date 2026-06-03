# Custom tech-debt detectors

Drop-in extension point for `/tech-debt-sweep` (`tech-debt-scan.mjs`). Any
`*.mjs` file in **this folder** is auto-loaded and its exported detector
function(s) run alongside the built-ins on every scan — no core edit needed.

> This folder itself is **excluded from scanning** (you don't lint your linters),
> and a broken detector is skipped defensively rather than failing the run.

## The contract

A detector is a pure function:

```js
// (relativePath, fileContent) => findings[]
export default function detectName(path, content) {
  // return [] when there's nothing to report
}
```

Each **finding** is an object:

| field      | type   | notes                                                  |
| ---------- | ------ | ------------------------------------------------------ |
| `kind`     | string | short id, e.g. `"console-log"`                          |
| `severity` | 1–5    | 5 = RED zone (fails the CI gate), 1 = info              |
| `path`     | string | the `path` arg                                          |
| `line`     | number | 1-based line number (optional)                         |
| `message`  | string | what's wrong + ideally how to fix                      |
| `snippet`  | string | optional offending line excerpt                        |

A module may `export default` one detector **or** export several named
functions — all exported functions are collected.

## Enable the example

```bash
cp contextkit/detectors/example-detector.mjs.example contextkit/detectors/console-log.mjs
node contextkit/tools/scripts/tech-debt-scan.mjs   # now flags stray console.log calls
```

## ⚠️ Trust

Detectors are **executed** by the scanner with full Node privileges. Only add
detectors you've read and trust — treat them like any other code in the repo.
