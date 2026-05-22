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
---
You are api-specialist... (mental model, invariants, anti-patterns, self-audit)
```

Good agents do one domain extremely well and delegate the rest. The shipped
`architect`, `code-reviewer`, and `context-keeper` are stack-agnostic and worth
keeping; add domain agents (frontend, db, security, …) as your codebase grows.

Tip: keep a short frontmatter `description` + a focused body. A vague
"helps with everything" agent defeats routing.

## 4. Add a slash command

Slash commands are `.claude/commands/*.md` — frontmatter `description` (+ optional
`argument-hint`) and a prompt body. `$ARGUMENTS` interpolates what the user typed.
Drop a new file in and it's available immediately.

## 5. Write your project's constitution

The installed `CLAUDE.md` ships a generic coding constitution (file-size limit,
SRP, naming, language policy, self-audit). **Edit it** to match your project:
fill in the immutable rules (and link the ADR that justifies each), set the
language policy, adjust the line limit. Keep it short — push detail into ADRs.

## 6. Rebrand the platform folder

To rename `vibekit/` (e.g. to `devtools/`), change `PLATFORM_DIR` in
`vibekit/runtime/config/paths.mjs`, rename the folder, and update the hook
commands in `.claude/settings.json` (`node devtools/runtime/hooks/...`). Nothing
else references the literal name.

## 7. Updating the engine later

Re-run the installer over the project. It overwrites only the engine and slash
commands; it never touches your memory, config overrides, or `CLAUDE.md`:

```bash
node /path/to/vibedevkit/install.mjs --target . --level <N> --yes
```

## Uninstall

Delete the `vibekit/` folder and remove the VibeDevKit entries (the ones whose
command contains `vibekit/runtime/hooks`) from `.claude/settings.json`. Your
memory under `vibekit/memory/` is just markdown — keep a copy if you want the
history.
