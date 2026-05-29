# TanStack starter

> Minimal wiring scaffold copied by `/aidevtool-from0` when the chosen stack
> is **TanStack**. After copy, this becomes your project — there is no upgrade
> path from the kit.

## What this gives you

- **TanStack Router** (file-based, type-safe) wired through
  `@tanstack/router-plugin` for Vite. The plugin generates
  `src/routeTree.gen.ts` from `src/routes/**` on every dev/build — that file
  is gitignored.
- **TanStack Query** with a single `QueryClient` provider mounted in
  `src/main.tsx`. The Router is given `{ queryClient }` as `context`, so route
  loaders can call `context.queryClient.ensureQueryData(queryOptions)`.
- **React 19** + **Vite 6** + **TypeScript** (`strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`).

## What this does NOT give you (by design — ADR-0017)

- No invented domain (no `User`, `Product`, `Post` — just one placeholder route).
- No CSS framework / design system — the placeholder is plain HTML.
- No backend client, no auth, no DB. Those are separate decisions for separate
  ADRs in your project.
- No example query — the conventions are in the playbook; write your first
  query against your real backend.

## First steps after copy

```bash
npm install
npm run dev
```

Then:

1. **Replace `src/routes/index.tsx`** with your first real route.
2. **Write your first query** following the `queryOptions` pattern from the
   playbook — never `useState` for server data, never an inline `queryKey`
   string. Co-locate the `queryOptions` factory next to the feature, not in a
   global file.
3. **Open an ADR in your project** (`/new-adr "<your-first-feature>"`) before
   the first non-trivial route — type-safe Router params are a contract;
   contracts deserve ADRs.

## Conventions you inherit from the kit

The full conventions block lives in
[`vibekit/workflows/playbooks/tanstack.md`](../../workflows/playbooks/tanstack.md)
and was copied into your project's `CLAUDE.md` under "Stack" when this starter
was applied. The short version:

- Server state in Query, never `useState`.
- `queryOptions` is the unit of reuse.
- Cache keys are arrays, hierarchical, stable.
- Router params via `Route.useParams()` — never a generic hook.
- `staleTime` is deliberate; the default of `0` is correct only for dashboards.
- Mutations invalidate the **smallest viable** key, with a one-line comment
  naming the invariant the invalidation preserves.

## Upgrading to TanStack Start (SSR / full-stack)

This starter intentionally **omits** TanStack Start to avoid pinning to a
moving target. When you decide you need SSR + a sanctioned server story:

1. Read the current TanStack Start docs (the API has been evolving — verify
   before trusting any guide).
2. Open an ADR in your project capturing the migration: routing model staying,
   build tool changing from Vite to vinxi, deployment target.
3. The Router conventions you already follow carry over unchanged — only the
   build/runtime swap.

## Freshness

Versions in `package.json` were chosen at the time the kit shipped the
starter. Before relying on a specific TanStack API:

```bash
npm outdated
npm view @tanstack/react-router version
npm view @tanstack/react-query version
```

If a major has shipped since the kit's starter was authored, the playbook's
"Freshness" section in the kit repo is the place to refresh — not your
project. Your project owns its own pinned versions from the moment of copy.
