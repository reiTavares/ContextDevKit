# Customizing VibeDevKit

The kit works out of the box, but a few tweaks make it fit your project well.

## 1. Tune which paths matter (do this first)

`vibekit/config.json` → `ledger` drives drift detection. Defaults are generic
(`src/`, `lib/`, `app/`, `packages/`, …). Adjust per stack:

```jsonc
{
  "ledger": {
    "important":    ["app/", "tests/", "pyproject.toml"],   // edits here → drift nudge
    "irrelevant":   ["node_modules/", "dist/", "__pycache__/"], // never tracked
    "registration": ["vibekit/memory/SESSIONS.md", "docs/CHANGELOG.md"] // counts as "registered"
  }
}
```

Examples: Python → add `app/`, `tests/`; Go → `cmd/`, `internal/`; Rust →
`src/`, `Cargo.toml`. Use `/vibe-config set ledger.important '["app/","tests/"]'`
or edit the file directly. Arrays **replace** the defaults.

## 2. Protect high-risk paths (Level 5)

`l5.highRiskPaths` is empty by default — the gate protects nothing until you fill
it. Add the files whose blast radius is largest:

```jsonc
{ "l5": { "highRiskPaths": [
  "db/schema.sql", "src/contracts/", "src/auth/", "openapi.yaml"
] } }
```

Now editing any of those is blocked until `/simulate-impact` records a covering
analysis.

## 3. Grow your own squad of sub-agents (Level 4)

Sub-agents are `.claude/agents/*.md` files with frontmatter. Copy
`_TEMPLATE.md` and make the agent **sharp and narrow** — its `description` is how
Claude decides when to route to it, so name the concrete files/dirs it owns.

```markdown
---
name: api-specialist
description: Use when the task touches src/api/ routes, request validation, or the service layer.
# Optional: declare MCP servers the agent expects (ADR-0019)
# mcpServers:
#   - name: postgres
#     rationale: needs read access to the production schema
#     optional: true
---
You are api-specialist... (mental model, invariants, anti-patterns, self-audit)
```

Good agents do one domain extremely well and delegate the rest. The shipped
`architect`, `code-reviewer`, `context-keeper`, `seo-specialist`,
`landing-architect` are stack-agnostic references — read them as style guides
before writing your own. Add domain agents (frontend, db, security, …) as your
codebase grows.

The kit ships **28 sub-agents** across 7 squads — see
[`docs/SQUADS/design-team.md`](SQUADS/design-team.md) for the UI/UX/SEO/landing
specialists and [`docs/SQUADS/agent-forge.md`](SQUADS/agent-forge.md) for the
L6+ agent-forge squad.

Tip: keep a short frontmatter `description` + a focused body. A vague
"helps with everything" agent defeats routing.

## 4. Add a slash command

Slash commands are `.claude/commands/**/*.md` — frontmatter `description` (+ optional
`argument-hint`) and a prompt body. `$ARGUMENTS` interpolates what the user typed.
Drop a new file in and it's available immediately.

Claude Code resolves commands by **file basename**, not path — so
`/my-command` finds `my-command.md` whether you place it at the root or under
`audit/my-command.md`. Use the existing packs (`audit/`, `pipeline/`, `qa/`,
`vcs/`, `forge/`, `setup/`) as a taxonomy reference. See
[`templates/claude/commands/README.md`](../templates/claude/commands/README.md)
for the full taxonomy.

## 5. Write your project's constitution

The installed `CLAUDE.md` ships a generic coding constitution (file-size limit,
SRP, naming, language policy, self-audit). **Edit it** to match your project:
fill in the immutable rules (and link the ADR that justifies each), set the
language policy, adjust the line limit. Keep it short — push detail into ADRs.

## 6. Add a provider adapter (review, media)

The kit ships two pluggable adapter surfaces. Both follow the same five-point
contract: **no SDK dependency, refuse-on-missing-creds, typed errors,
refuse-on-content-policy (where applicable), per-process cost cap (media only)**.

### Review providers (`vibekit/runtime/providers/review/`)

Add an adapter for GitLab / Bitbucket / Gitea by creating a new `.mjs` file that
shells out to the user-installed CLI:

```js
// vibekit/runtime/providers/review/glab.mjs
import { spawnSync } from 'node:child_process';
import { ProviderError } from './_adapter.mjs';

export const id = 'glab';
export const cliBinary = 'glab';
export const detectsRemote = (url) => /gitlab\.com[:/]/.test(url);

function runGlab(args, { stdin } = {}) {
  const r = spawnSync('glab', args, { input: stdin, encoding: 'utf-8' });
  if (r.error?.code === 'ENOENT') throw new ProviderError('CLI_MISSING', 'glab CLI not installed');
  if (r.status !== 0) throw new ProviderError('REMOTE_REJECTED', r.stderr);
  return r.stdout;
}

export async function createPullRequest({ title, body, baseBranch }) { … }
export async function listOpenReviewComments({ prNumber }) { … }
export async function postReviewComment({ prNumber, body }) { … }
```

`detect.mjs` automatically discovers the file and routes by `origin` URL.
Authority: [ADR-0021](../vibekit/memory/decisions/0021-provider-strategy-review-qa.md).

### Media providers (`vibekit/runtime/providers/media/`)

Add an adapter for Runway / Luma / Midjourney following the contract in
`_adapter.mjs`:

```js
// vibekit/runtime/providers/media/my-provider.mjs
import { MediaProviderError, MEDIA_ERROR_CODES, assertCredentials, noteCostOrThrow } from './_adapter.mjs';

export const id = 'my-provider';
export const kind = 'image';                       // or 'video'
export const envVar = 'MY_PROVIDER_API_KEY';
export const requiredEnv = ['MY_PROVIDER_API_KEY'];

export async function generate({ prompt, outPath, options }) {
  assertCredentials(requiredEnv);                  // refuse before network call
  noteCostOrThrow(0.05);                            // per-process cost tally
  // …node:fetch → write outPath…
  return { outPath, durationMs, costEstimateUsd, providerRequestId };
}
```

Authority: [ADR-0024](../vibekit/memory/decisions/0024-media-generation-veo-nano-banana.md).

## 7. Credentials flow (`vibekit/.env.example`)

The kit ships an `.env.example` template at the installed `vibekit/` root with
commented credentials for `/media-gen` and a tour of the other `VIBEDEVKIT_*`
env vars. Setup:

1. Copy `vibekit/.env.example` to `vibekit/.env`.
2. Fill in the keys you want (`GOOGLE_AI_API_KEY` for Nano Banana + Veo).
3. (Optional) set `VIBEDEVKIT_MEDIA_MAX_USD=5.00` to cap per-process spend.
4. Run scripts via Node 20.6+'s built-in env-file loader:

```bash
node --env-file=vibekit/.env vibekit/tools/scripts/media-gen.mjs image \
  --prompt "..." --out hero.png
```

Or copy the values into your project's existing dotenv setup (Astro / Next /
Nuxt / Vite all already read `.env` from the project root).

**The kit never writes secrets.** `vibekit/.env.example` is the only template;
you fill in `vibekit/.env` and it stays out of git via the standard `.env`
gitignore convention.

## 8. Rebrand the platform folder

To rename `vibekit/` (e.g. to `devtools/`), change `PLATFORM_DIR` in
`vibekit/runtime/config/paths.mjs`, rename the folder, and update the hook
commands in `.claude/settings.json` (`node devtools/runtime/hooks/...`). Nothing
else references the literal name.

## 9. Updating the engine later

Re-run the installer over the project. It overwrites only the engine and slash
commands; it never touches your memory, config overrides, or `CLAUDE.md`:

```bash
node /path/to/vibedevkit/install.mjs --target . --level <N> --yes
```

Or, even simpler:

```bash
npx vibedevkit@latest --target . --update
```

This refreshes engine + slash commands + hook wiring for your **current** level.
It **never** touches `CLAUDE.md`, `vibekit/config.json`, memory (ADRs/sessions/
roadmap), pipeline tasks, scoped module `CLAUDE.md`, or your `vibekit/.env`.

## Uninstall

Delete the `vibekit/` folder and remove the VibeDevKit entries (the ones whose
command contains `vibekit/runtime/hooks`) from `.claude/settings.json`. Your
memory under `vibekit/memory/` is just markdown — keep a copy if you want the
history.

Or use the installer:

```bash
node /path/to/vibedevkit/install.mjs --target . --uninstall          # keeps memory + CLAUDE.md
node /path/to/vibedevkit/install.mjs --target . --uninstall --purge  # also removes the engine
```
