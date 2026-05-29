# Vibe-Coding Review Protocol

> How `/analyze-code-ia-practices` is meant to be *run* — severity vocabulary,
> when each tier applies, the audit protocol, and the contract between the
> deterministic scanner and the agent.
>
> **Paired with `best-practices.md`** (the rubric: principles, tiers, rules,
> over-apply clauses). That file says *what good looks like*; this file says
> *how to apply it and how to report.*
>
> **Scope.** This protocol covers the *code-quality* lens: architecture
> (Tier 1) and hygiene (Tier 2). Security, accessibility, privacy and
> dependency / supply-chain concerns are owned by the kit's specialised
> agents and commands — see *Adjacent concerns* at the foot of
> `best-practices.md` for the routing.
>
> Keep both files in sync with the constitution in `CLAUDE.md` and with
> `vibekit/config.json` (thresholds and ledger paths).

## Severity vocabulary

Anchored on the scanner's existing **1..5** scale (used by `tech-debt-scan`
and its `--ci` gate) so the rubric, the deterministic scan, and the build
gate stay aligned. Inventing a parallel scale would drift them apart.

| Label       | Scanner sev | Meaning                                                |
| ----------- | :---------: | ------------------------------------------------------ |
| `BLOCKER`   | 5           | Fix before merge. Fails `tech-debt-scan --ci`.         |
| `HARD`      | 4           | Clear violation, no cohesion excuse. Fix it.           |
| `CANDIDATE` | 2–3         | Judgment call; may be justified. Explain the tradeoff. |
| `NIT`       | 1           | Mention once, don't litigate.                          |

Mapping rules of thumb:

- A **Tier 1** (architecture) finding is typically `HARD` — the cost of
  leaving it grows fast. Downgrade to `CANDIDATE` only when the affected
  surface is genuinely small and isolated.
- A **Tier 2** (hygiene) finding starts at `CANDIDATE` and rises to `HARD`
  only when the over-apply clause has been considered and rejected, or to
  `BLOCKER` when the scanner already emits severity 5 (e.g. `> 308` lines —
  the project's line-budget RED zone, configurable in `vibekit/config.json
  → l5.lineBudget`).
- For **security findings**, dispatch the security-team — see *Adjacent
  concerns* in `best-practices.md`. The severity vocabulary here applies
  inside the rubric's lane only.

## When this rubric applies

Rigor must match the stakes, or it's either waste or negligence.

- **Production paths** (anything shipped to users, anything that holds real
  data): the full rubric applies.
- **Spikes & throwaways** (prototypes, scratch directories like
  `/experiments` or `/spikes`, code you will delete within the week):
  **Tier 2 hygiene and tests are relaxed.** Don't demand JSDoc or coverage
  on code that isn't going to survive. Naming and obvious-error handling
  still matter — but the documentation/tests bar drops.
- **Tier 1 (architecture)** sits in the middle. A three-file script doesn't
  need a hexagonal architecture; an app with a real domain does. The
  *direction* of dependencies still matters at any size — the *depth* of
  layering scales with complexity.

## Running the analysis

How `/analyze-code-ia-practices` should behave once the scanner has run.

1. **Read both rubric files first** (`best-practices.md` and this protocol).
   Use the project's `l5.lineBudget` thresholds from `vibekit/config.json`
   (defaults: `yellow: 240`, `red: 308`).

2. **Run the deterministic scan:**

   ```
   node vibekit/tools/scripts/tech-debt-scan.mjs --json
   ```

   The scan surfaces mechanical signal — oversized files, "And/Or/E"
   identifier names, TODO/FIXME/HACK/XXX markers, and (in React/JSX
   projects only) `useState`/`useEffect` loops. That is the *floor* of the
   report, not the ceiling.

3. **Apply judgment the regex can't, in tier order:**

   - **Tier 1 first.** Read the code: does the domain depend on
     infrastructure? Are boundaries respected? Any circular imports or
     fan-out monsters? Where does state actually live, and does it live
     once?
   - **Tier 2 next.** Walk the scanner findings; for each file, decide the
     *right* fix per H1's preference list (extract a unit with one job,
     promote inline render functions, lift complex state into a hook,
     separate layers), not "split at random."

4. **Lead with the right fix, per file.** Name the concrete refactor
   ("extract the `OrderRepo` port", "lift this state into a hook", "move
   business math out of the route handler") rather than "this is too big."
   A Tier-1 finding usually reframes the Tier-2 ones — don't lead with
   "this file is 320 lines" when the real story is "the domain imports the
   persistence client."

5. **Honor each rule's "Don't over-apply" clause.** If the clause covers
   the case, say so and move on. Manufactured findings cost more trust
   than they save.

6. **Silence is a valid result.** Clean code gets a clean bill. Do not
   manufacture findings to look thorough.

7. **Route adjacent concerns out, don't smuggle them in.** If during the
   pass you spot a security/accessibility/privacy/dependency issue, name
   it briefly and dispatch the relevant agent/command (see *Adjacent
   concerns* in `best-practices.md`). Don't expand the rubric's lane.

8. **Feed the DevPipeline backlog** with the surviving items,
   auto-prioritised by severity (BLOCKER → P0, HARD → P1, CANDIDATE → P2,
   NIT → P3):

   ```
   node vibekit/tools/scripts/pipeline.mjs add --type chore --priority <P> \
     --source "practices:<file>" --title "<short fix description>"
   ```

   `--source` keeps re-runs idempotent. Priorities remain editable
   (`/pipeline` or `pipeline.mjs prioritize <id> <P>`).

9. **Do not refactor in this command** — it is analysis. Offer to open a
   focused `/dev-start "refactor <file> by responsibility"` (or `/ship`)
   on the top item if the user wants to act.

## Report shape

Each finding follows the same shape so reports are scannable and sortable:

```
path:line — TIER/§ID — SEVERITY — what's wrong — proposed fix
```

Example findings:

```
src/api/orders.ts:142 — TIER1/S1 — HARD — controller imports DB client directly — extract an OrderRepo port; inject from edge
src/state/cart.ts:88  — TIER1/S4 — HARD — cart total cached in 3 components, drifting — derive from one source (one query hook)
src/ui/Dashboard.tsx  — TIER2/H1 — BLOCKER — 412 lines (> 308) — extract `useDashboardData` hook + promote `renderHeader` to component
src/lib/helpers.ts:8  — TIER2/H5 — NIT — `arr` carries meaning here — rename to `pendingInvoices`
```

**Sort by:** tier (1 → 2), then severity (5 → 1), then **blast radius** —
how far the smell spreads (how many call sites, how exposed the code path
is). A `BLOCKER` on a widely-imported module beats a `BLOCKER` on a leaf
utility.

Group findings by file in the final report so the human sees the *file's*
story, not a flat list.

## Scanner map — what's mechanical vs. what needs judgment

The deterministic scanner (`tech-debt-scan.mjs`) owns the mechanical
signal; the agent owns everything that needs judgment. The split is honest
— the rubric does not promise enforcement the scanner cannot deliver.

### Scanner (regex, cheap, exact — runs today)

| Detector               | Rule informed     | Sev    | Notes                                        |
| ---------------------- | ----------------- | :----: | -------------------------------------------- |
| `detectLineBudget`     | H1                | 3 / 5  | Yellow ≥ 240, RED > 308 (configurable).      |
| `detectSrpAnd`         | H2                | 2      | JS/TS `And`/`Or`/`E`; Python `_and_`/`_or_`. |
| `detectReactStateLoop` | H3 (React/JSX)    | 3      | `> 2 useState + ≥ 1 useEffect`; no-op elsewhere. |
| `detectTodoMarkers`    | H4 / H6 (debt)    | 1      | `TODO`/`FIXME`/`HACK`/`XXX` in comments.     |

The scanner auto-restricts each detector by file extension; in a project
with no React, `detectReactStateLoop` is a silent no-op. That is what makes
the kit stack-agnostic in practice, not just in principle.

**Custom detectors** drop into `vibekit/detectors/*.mjs` and are
auto-loaded. A broken custom detector is skipped, never blocks the scan
(constitution, rule 2 — "hooks never break real work").

**`--ci` gate** fails the build on any severity-5 finding. This is the
hard line the project will not regress past.

**Plug-in slot is the right place for stack-specific detectors** (e.g. a
project that wants to detect its specific ORM's misuse, or a particular
secret-naming convention) — add a `*.mjs` file under `vibekit/detectors/`
exporting a `default` function or a `detectors` array. The kit ships zero
stack-specific detectors on purpose (constitution, rule 9 — templates
carry no invented domain content).

### Agent only — judgment, no regex can do it

- **All of Tier 1** (S1 dependency direction, S2 boundaries, S3 coupling
  and cycles, S4 state location). These require reading import graphs and
  understanding intent, not pattern-matching strings.
- **Whether a flagged H1 size is cohesion or rot.** The scanner sees 312
  lines; only the agent can tell whether they're a dumb constants file or
  a god component.
- **The right refactor per file.** "Extract `X`", "lift state into a
  hook", "promote `renderY` to a component" — these are H1's *Fix*
  preference list, not the scanner's job.
- **Whether a Tier-2 violation is relaxable** because the file is a spike
  or throwaway (see *When this rubric applies*).

### What this protocol deliberately does not promise

- **No `// vibe-allow §ID: reason` pragma** — not implemented in the
  scanner. If you find one in someone's proposal, it is aspirational, not
  honored. (Rule 9: don't ship a speculative half. A future ADR may add it
  as an atomic change: detector + selfcheck assertion + this doc.)
- **No import-cycle, secret-pattern, or `any`-counter detection in the
  kit's default set.** These belong in custom detectors a project adds for
  itself, or in future ADRs that ship them properly with tests.
- **No security/AppSec coverage in this rubric.** That is the security-team's
  lane: `code-security`, `security`, `infra-security` agents; `/audit`,
  `/deps-audit`, `/security-setup` commands.

Keep this map and `vibekit/config.json` in agreement; keep the whole pair
of files in sync with `CLAUDE.md` and `best-practices.md`.
