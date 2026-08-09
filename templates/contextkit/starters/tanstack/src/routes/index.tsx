import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: IndexRoute,
});

function IndexRoute() {
  return (
    <main>
      <h1>TanStack starter</h1>
      <p>
        Wiring only — no invented domain. Replace this placeholder with your
        first real route. See <code>README.md</code> for the conventions.
      </p>
    </main>
  );
}
