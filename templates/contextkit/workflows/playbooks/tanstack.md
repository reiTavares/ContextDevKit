---
phases:
  - intake
  - spec
squads:
  - devteam
---
# Playbook — TanStack

> Operational entry points: `/aidevtool-from0` Phase 3 (proposing the stack),
> `/setupcontextdevkit` Phase 4 (writing rules when detected), and the opt-in
> starter under `templates/contextkit/starters/tanstack/`. This page is **why**
> TanStack, **when** to pick it, **how** to live with it, and the
> **anti-patterns** we will not write.
>
> Authority: [ADR-0017](../../memory/decisions/0017-tanstack-stack-recognition-and-opt-in-starter.md).

## Why TanStack as a curated option

TanStack is a family of headless, type-safe libraries with overlapping ergonomics
(Query / Router / Table / Form / Virtual) and one full-stack frame (Start). The
kit treats it as a curated option because three properties match its own
constitution:

- **Type safety as a first-class invariant.** Router params, Query data, and
  Table columns are typed end-to-end — drift between intent and runtime is
  caught by `tsc`, not by a regression. The kit's "fail fast at the boundary"
  posture (constitution §4) inherits this for free.
- **Headless by default.** No design-system bundled — the user owns the visual
  layer. Matches constitution rule 9 (no invented domain content) at the
  library level.
- **Cache & invalidation as explicit primitives.** Query forces `queryKey` +
  `staleTime` to be deliberate choices, not defaults. That is the same posture
  the kit takes for ledger paths and high-risk zones: refuse by default
  (rule 8), opt in to permit.

## When to pick TanStack (and when not to)

Pick it when:
- the project is a **type-safe React** (or Solid / Vue) app and the team values
  end-to-end inference over framework lock-in;
- routing needs to be **co-located with the data fetching contract** (Router
  loaders + Query) rather than scattered across page components;
- a future migration off a backend host (BFF, edge, serverless) is plausible —
  TanStack Start's adapter model is friendlier than baking a single host
  assumption into routes.

**Don't pick it (or pick a smaller subset) when:**
- the project already commits to a full-stack framework whose router is
  load-bearing (Next/Nuxt/Remix/SvelteKit) — adding TanStack Router on top
  creates two routing systems; use TanStack Query *with* the framework's
  router instead, that combination is the common case;
- the team is new to React patterns generally — TanStack rewards developers
  who already know what a query key, a stale time, and a suspense boundary
  *are*. Pair it with a senior, or pick a more opinionated frame first;
- the app is mostly **forms + CRUD on a single backend you own** — a single
  framework router + plain `fetch` may stay simpler than wiring Query + Router
  + Form for the same outcome.

## The family — pick by concern, not by reflex

| Concern | Sub-library | When to add |
| --- | --- | --- |
| Server state (fetching, caching, invalidation) | `@tanstack/react-query` | Any app that talks to a server. Add first. |
| Type-safe routing | `@tanstack/react-router` | When routes carry typed params/search and loaders. Skip if the host framework already owns routing. |
| Headless tables (sorting, filtering, virtualization-ready) | `@tanstack/react-table` | A data-heavy table with custom UI. Don't add for a simple list. |
| Headless forms | `@tanstack/react-form` | Complex multi-step forms or strict validation. Plain `useState` + zod is fine for a contact form. |
| Virtualized lists/grids | `@tanstack/react-virtual` | List > 200 items rendered concurrently. Premature for short lists. |
| Full-stack frame | `@tanstack/start` | New project that wants TanStack Router + a sanctioned server story. Not for grafting onto an existing Next/Nuxt app. |

Solid and Vue users substitute `@tanstack/solid-query` / `@tanstack/vue-query`;
the Query conventions below are identical.

## Core conventions (these go into the user's CLAUDE.md)

When TanStack is detected (or chosen on greenfield), `/setupcontextdevkit` /
`/aidevtool-from0` writes the following block into the project's `CLAUDE.md`
under "Stack" or "Immutable rules":

1. **Server state lives in Query, never in `useState`/Redux.** Fetch + cache +
   invalidation are Query's job. Cross-component server data is read with
   `useQuery` against the same `queryKey`, not propagated by hand.
2. **`queryOptions` is the unit of reuse.** Every cross-component query is
   declared via `queryOptions({ queryKey, queryFn, staleTime })` and consumed
   by both `useQuery(queryOptions(...))` and `queryClient.prefetchQuery` /
   `ensureQueryData`. No copy-pasted `queryKey` literals across files.
3. **Cache keys are arrays, hierarchical, stable.** Shape: `['domain', 'list', filters]`
   or `['domain', id]`. Filters are serializable. Never a stringified JSON
   blob; never an unstable object literal in the render path.
4. **Router params are typed via the route definition.** `Route.useParams()` /
   `Route.useSearch()` only — never `useParams()` from a generic hook on top
   of `window.location`. Add a `validateSearch` to anything that takes search
   params from a URL.
5. **`staleTime` is set deliberately on data with a known lifetime.** The
   default `0` (always stale) is correct for dashboards; a known-static lookup
   (countries, role list) sets `staleTime: Infinity` and invalidates on the
   event that actually changes it.
6. **Mutations invalidate the smallest viable key.** Don't invalidate
   `['domain']` after a single-row update; invalidate `['domain', id]` and the
   list keys that include it. The convention is one line of comment naming
   the invariant the invalidation preserves.

## Anti-patterns (caught in review)

1. **`useState(server data)` + a manual `useEffect` to refetch.** That is
   Query's job. Even one such pattern in the codebase signals that the team
   has not internalized the boundary; refactor before adding more.
2. **Untyped Router params.** `useParams<{ id: string }>()` cast at the call
   site instead of `Route.useParams()`. The Router's whole value proposition
   is that the route owns the type.
3. **`data: any` in a Query result.** The whole pipeline is generic; `any`
   defeats inference. Either give `queryFn` an explicit return type or use a
   zod parser to narrow at the boundary.
4. **`queryKey: [JSON.stringify(filters)]`.** Cache keys must be arrays of
   plain values; stringification hides drift and breaks invalidation.
5. **One giant `queryClient` configured per route.** Configure
   `defaultOptions` once at the provider; route-specific overrides go on the
   individual `queryOptions`. Multiple clients fragment the cache.
6. **Adding `@tanstack/react-router` on top of Next/Nuxt/Remix.** Two routing
   systems = two source-of-truth disputes. Pick one.
7. **Starting from a copy-pasted "examples/" repo with a fake `Pokemon` or
   `TodoList` domain.** Delete the fake first, then build. The opt-in starter
   ships nothing of the sort precisely so this anti-pattern doesn't enter the
   codebase.

## The opt-in starter

`templates/contextkit/starters/tanstack/` is a **minimal wiring scaffold** the
user explicitly accepts during `/aidevtool-from0` Phase 6. It contains:

- `package.json` with the TanStack family chosen for the project (Start +
  Router + Query by default; user can drop subsets);
- `src/main.tsx` with the `QueryClient` provider mounted once;
- `src/router.tsx` with one route (`/`) that renders a placeholder asking the
  user to wire their first real route;
- a `README.md` pointing back to this playbook and the user-project's ADR-0001
  recording the choice.

What the starter **does not** ship: a fake domain, a CSS framework, an auth
provider, a backend client, or example queries. See ADR-0017 for the five
constraints that govern any future stack-starter under
`templates/contextkit/starters/`.

`/setupcontextdevkit` (existing projects) **never** copies the starter — it
detects, writes rules, and stops.

## Freshness

TanStack is moving fast — especially Start. This playbook reflects conventions
as of **2026-05**. Before relying on a specific API named here:

1. Run `npm view @tanstack/start version` (or the sub-lib you care about) and
   compare against the starter's `package.json`.
2. If a major has shipped since this playbook's date, open `/new-adr "Refresh
   TanStack playbook against vX.Y"` in the **kit** repo before changing the
   user-project — the playbook is shared infrastructure.

## Relation to other parts of the kit

- **Detection** — `templates/contextkit/tools/scripts/detect-stack.mjs` surfaces
  any `@tanstack/*` dep in `frameworks`. Consumers branch on
  `frameworks.some(f => f.startsWith('@tanstack/'))`.
- **CLAUDE.md scoping** — when the kit detects TanStack inside a sub-app of a
  monorepo, the *scoped* `CLAUDE.md` for that app carries these conventions,
  not the root one (`/claude-md scaffold` + per-app fill).
- **QA squad** — Query-heavy apps benefit from `qa-integration` against a real
  backend (the cache is part of the contract); `qa-fuzzer` against
  `validateSearch` schemas catches Router parser drift.
- **`/contract-check`** — exported `queryOptions` factories are part of the
  public contract of a module; renaming `userListQueryOptions` is a breaking
  change for every consumer.
