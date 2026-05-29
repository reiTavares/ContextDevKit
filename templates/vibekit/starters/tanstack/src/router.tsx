/**
 * Re-exports the Router context type so consumers (loaders, route components)
 * can type-check against it without reaching into `main.tsx`.
 *
 * The actual `createRouter` call lives in `main.tsx` because it depends on the
 * generated `routeTree.gen.ts` (produced by `@tanstack/router-plugin`).
 */
import type { QueryClient } from '@tanstack/react-query';

export interface RouterContext {
  queryClient: QueryClient;
}
