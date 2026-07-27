# How to connect MCP servers

## When to use this guide

You want an external Model Context Protocol server available to the agent in this
project — a repository host, a browser driver, a database reader — and you want the
kit's own posture tooling around it: a pinned entry, a health probe, and an audit of
what the server can reach.

Read the warning below before you enable anything. Then follow the steps, which cover
what the tooling does today and name plainly what it does not do yet.

## Read this first: what enabling a server actually grants

An MCP server is a process the agent talks to. Enabling one grants a third party read
access to the repository the agent is working in, and to whatever else that server's
tools can reach with the credentials you hand it. This is the one outbound integration
you add on purpose — the kit's own governance runs locally, and adding a server is you
choosing to widen that boundary.

Three consequences worth stating without softening:

- **"Curated" is not supply-chain vetting.** The curated registry records a publisher,
  a source, a pin and a declared risk class. It is a convenience index with an opinion
  about posture. It does not audit the server's code, verify its provenance, or attest
  its artifact. Every entry that ships today has a null `hash` and a null `verifiedAt`
  in its provenance block — no attestation has been captured.
- **A write-capable server can change things.** Risk classes and tool allow-lists exist
  precisely because some servers expose tools that mutate. Read the entry's
  `defaultMode` and its allow-list before enabling.
- **Secrets are referenced by name, never by value.** The manifest schema stores
  `referencedSecrets` — names of secrets held in your host's secret store. Putting a
  literal secret in a config file is a mistake the renderers refuse to make for you;
  do not make it by hand either.

Discovery also reaches the network: it queries the public npm registry directly.

## Prerequisites

- ContextDevKit installed, and commands run from the project root.
- Node.js 18 or newer.
- For a server that needs credentials: the credential already present in your
  environment, under the exact variable name the entry declares in `requiredSecrets`.

## Steps

1. **See the surface.** The dispatcher lists every verb it accepts.

   ```bash
   node contextkit/tools/scripts/mcp.mjs --help
   ```

   Four of the listed verbs are not implemented yet. See "What is not built" below
   before you plan around `add`, `sync`, `profile` or `disable`.

2. **Read the curated registry.** It is a file, and reading it is the honest way to see
   what the kit ships an opinion about.

   ```bash
   node -e "const r=require('./templates/contextkit/mcp/registry.json');console.log(r.entries.map(e=>[e.id,e.risk,e.defaultMode,e.approval,e.source].join('  ')).join('\n'))"
   ```

   Three entries ship: a first-party server, a repository host, and a browser driver.
   Each carries `id`, `displayName`, `publisher`, `source`, `transport`, `risk`,
   `capabilities`, `requiredSecrets`, `allowedHosts`, `defaultMode`, `versionPolicy`,
   `pin`, `approval` and `provenance`.

3. **Declare the server in the project manifest.** Create
   `contextkit/mcp/project-manifest.json`. Its schema requires `version` (must be `1`)
   and a `servers` array; each entry requires an `id` matching a registry id and may
   carry `pin`, `mode`, `referencedSecrets`, `allowedTools` and `disabled`.

   ```json
   {
     "version": 1,
     "servers": [
       {
         "id": "github",
         "mode": "read-only",
         "referencedSecrets": ["GITHUB_PERSONAL_ACCESS_TOKEN"],
         "allowedTools": ["search_repositories"]
       }
     ]
   }
   ```

   No manifest exists in a fresh install. The health probe prefers this file when it has
   a `servers` array, and falls back to `.claude/settings.json` otherwise.

4. **Write the host config.** This step is manual today. For Claude Code, the
   `mcpServers` block in `.claude/settings.json` is what the host reads. Reference each
   secret by name — the shape is `"${env:NAME}"` — and pin the version.

   > No command writes host configs yet. Pure per-host renderer functions exist, but
   > nothing outside the test suite calls them, and the `sync` verb is not wired to them.

5. **Health-check what you enabled.** This is a real probe, not a config lint.

   ```bash
   node contextkit/tools/scripts/mcp.mjs doctor --json
   ```

   For a stdio server it spawns the command, sends a JSON-RPC `initialize` over stdin,
   reads the first response line, then terminates the child. For an HTTP server it POSTs
   to the `/mcp` path under the configured URL and handles an event-stream response.
   Either probe times out after six seconds. A missing required secret reports as
   `skipped`, never as a pass and never as a failure.

6. **Audit the posture.** The audit reads `.claude/settings.json` and the local receipt
   store, and raises five flag codes.

   ```bash
   node contextkit/tools/scripts/mcp.mjs audit --json
   ```

   | Flag | Severity | Raised when |
   |---|---|---|
   | `HAS_WRITE_TOOLS` | high | An exposed tool's name matches a write-shaped pattern. |
   | `UNPINNED_SERVER` | medium | The server has no explicit version in config. |
   | `SECRET_REFERENCE` | low | An env key name looks credential-shaped. |
   | `UNUSED_SERVER` | low | The server is configured but no receipt names it. |
   | `HOST_DRIFT` | medium | A receipt's host differs from the current host. |

   Every check is name-pattern matching over config plus a receipt cross-reference. The
   audit does not consult the curated registry, the risk classes, or provenance. Env
   values never enter the report — only key names.

7. **Record a receipt when a task used a server.** Dry run by default; `--write` is the
   apply flag.

   ```bash
   node contextkit/tools/scripts/mcp.mjs receipt --write '{"task":"t","run":"r","servers":["github"],"tools":["search_repositories"],"host":"claude-code","result":"passed"}'
   ```

   Required payload fields are `task`, `run`, `servers`, `tools`, `host` and `result`
   (one of `passed`, `failed`, `skipped`, `error`). Receipts land under
   `contextkit/runtime/receipts/mcp/` and are written atomically. Evidence keys that
   look credential-shaped have their values replaced with a redaction marker.

## Verify it worked

```bash
node contextkit/tools/scripts/mcp.mjs doctor --json
```

Read three things in the output. `totalServers` above zero means your declaration was
found — zero means the probe found neither a manifest with a `servers` array nor an
`mcpServers` block. Each result carries `[PASS]`, `[SKIP]` or `[FAIL]` with the
capability names the server reported. And `hasFailures` drives the exit code: 1 when any
server failed, 0 otherwise.

A `[PASS]` means the server answered an `initialize` handshake. It does not mean the
server is safe, nor that its tools are the ones you expect — capability names come from
the handshake block alone, because the probe never calls a tool-listing method. Most real
servers therefore report empty tool lists here.

## Troubleshooting

**Symptom:** `doctor` reports `totalServers: 0` although you edited a config.
Fix: check which file you edited. The probe prefers `contextkit/mcp/project-manifest.json`
when it parses and contains a `servers` array, and only then falls back to
`.claude/settings.json`. A malformed manifest reads as absent.

**Symptom:** a server reports `[SKIP]` rather than passing.
Fix: a required secret is not in the environment. The probe refuses to spawn on a
missing credential and reports skipped, because a spawn failure and an absent credential
are different problems and only one of them is yours to fix in code.

**Symptom:** `audit` prints nothing at all and exits 0.
Cause, not fix: the audit and receipt scripts have a command-line entry guard that
compares a resolved path to a URL-derived path. On Windows those never match, so the
scripts import cleanly but their command-line path never runs. Their exported functions
work when imported. Run them on a POSIX shell, or call the exported function directly,
until the guard is fixed.

**Symptom:** `mcp sync` or `mcp add` runs and reports registry candidates instead of
doing anything.
Cause: those verbs dispatch to the discovery script, which parses no verbs — it treats
every non-flag argument as a search query. So `mcp sync` searches npm for the word
"sync". Nothing is written and nothing is broken; the verb simply is not implemented.

**Symptom:** `discover` shows candidates with risk `UNREVIEWED`.
Expected. Discovery queries the public npm registry, and every result is hardcoded as
unreviewed with guessed transport and capabilities. It is a browsing aid. It is not
connected to the curated registry, and it never enables anything.

## What is not built

Stating this plainly is more useful than a feature list that overpromises:

- **`add`, `sync`, `profile` and `disable` have no implementation.** They appear in the
  help text and in the slash-command briefing; they dispatch to discovery and perform a
  network search of the verb string.
- **No command writes a host config.** The per-host renderers exist as pure functions
  with no caller outside tests.
- **The curated registry is loaded by nothing outside the test suite.** Discovery uses
  npm; the registry is a file you read. They are two disconnected systems today.
- **All provenance attestation fields are null.** No hash, no verification timestamp,
  and no curation command exists to fill them.
- **The shared receipt store is a declared seam, not a built one** — the substrate
  status is a constant reporting `skipped`.
- **MCP has no configuration block.** There are no `mcp` keys in the config schema or
  defaults; roots come from `--root` or the working directory only.
- **`audit` and `doctor` can legitimately disagree**, because the audit reads only
  `.claude/settings.json` while the probe prefers the manifest.

Adjacent policy files ship and are readable, though no runtime path consumes them yet:
per-class defaults for risk `R0` through `R5`, per-server tool allow and deny lists where
deny wins, and seven project profiles under `contextkit/mcp/profiles/`.

## Related

- Reference: `docs/reference/config.md` — the configuration schema, and what MCP is
  absent from.
- How-to: `docs/how-to/work-across-hosts-and-bridges.md` — which hosts read which config
  file.
