# Grok Build Integration

Grok Build is a first-class native ContextDevKit host. It is an operation-owned
host projection, not a provider, model adapter, or dependency of another host
workflow.

## Project surfaces

- `.grok/hooks/contextdevkit.json` — ContextDevKit-owned hook projection. User
  hooks in the same file are preserved during install, rewire, update, and uninstall.
- `.grok/config.toml` — Grok project configuration, including MCP servers. The
  ContextDevKit renderer writes `[mcp_servers."<id>"]` tables and Grok-native
  `${ENV_NAME}` references without copying secret values. The ContextDevKit
  entry uses the installed native stdio server; other remote entries use `url`.
- `AGENTS.md` — shared project instructions, also available to other hosts.
- `contextkit/` — shared engine, memory, workflows, receipts, and tests.

Grok hook payloads use camelCase fields such as `sessionId`, `toolName`, and
`toolInput.filePath`. ContextDevKit normalizes them into the shared ledger and
emits Grok's `allow`/`deny` decisions at the host boundary.

## Install and operate

```text
node install.mjs --target <project> --level 5 --yes
node install.mjs --target <project> --rewire --level 5 --yes
node contextkit/tools/scripts/context-level.mjs 5
```

After changing the level, restart Grok Build so it reloads `.grok/hooks/`.
Run `grok inspect --json` to verify the discovered hooks and MCP servers. Grok
requires project folder trust before project hooks or project MCP servers run;
grant that trust through Grok's normal `/hooks-trust` flow. ContextDevKit does
not silently change that security decision.

MCP configuration is rendered from the canonical project manifest through the
Grok renderer; it remains project-scoped and does not modify user-level Grok
settings. The native ContextDevKit server is local stdio; a remote entry is
emitted only when the registry supplies its documented HTTP URL.
Grok's documented remote MCP mode requires an HTTP/SSE `server_url`; ContextDevKit
does not claim a remote endpoint until its HTTP transport is deployed.

To uninstall the kit wiring while retaining project data:

```text
node install.mjs --target <project> --uninstall --yes
```

This strips only ContextDevKit hook commands and leaves `.grok/config.toml` and
unrelated user hooks untouched.

## Integração em português

O Grok Build é um host nativo próprio do ContextDevKit, não um provider. Seus
hooks ficam em `.grok/hooks/contextdevkit.json` e o MCP em `.grok/config.toml`;
as operações e workflows continuam independentes dos workflows de providers.
