# Start focused work

Conversation and exploration are read-only. For a mutation:

1. Resolve an explicitly named or strongly matching existing task/workflow.
2. Keep one objective and state what is out of scope.
3. Query Project Map for exact symbols/paths, then fall back immediately to
   ordinary search if the graph is stale, partial, unavailable, or empty.
4. If beginning an existing task, start it in its explicit scope:

   ```text
   node contextkit/tools/scripts/pipeline.mjs start <task-id> --tasks <scope>
   ```

5. Load the full workflow context before a workflow-linked write.
6. Implement the smallest complete change, run focused tests, then broader QA.
7. Report the diff, exact commands/results, residual risk, and Git state.

Agent/model selection and optional Task Compiler output are recommendations.
Their absence never blocks the active agent.
