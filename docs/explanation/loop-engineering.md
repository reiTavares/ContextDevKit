# Evidence-Driven Loop Engineering

ContextDevKit supports software engineering as an iterative evidence loop rather than a one-shot generation event.

An agent producing code is not the same thing as engineering work being complete.

The basic loop is:

```text
implement
   ↓
evaluate
   ↓
findings
   ↓
correct
   ↓
re-evaluate
   ↓
fresh evidence
   ↓
done
```

## Agent loop vs engineering loop

The coding host already owns an agent loop:

```text
reason
  ↓
call tool
  ↓
observe result
  ↓
reason again
```

ContextDevKit does not replace that loop.

The ContextDevKit engineering loop operates at project level:

```text
objective
  ↓
project context
  ↓
implementation
  ↓
engineering evaluation
  ↓
evidence
  ↓
correction
  ↓
fresh evaluation
  ↓
completion
```

That loop can survive context compaction, a new session, another agent, another model, or another coding host because its durable state belongs to the project rather than to one conversation.

## Evaluation depth is adaptive

ContextDevKit does not require every evaluator for every change.

The active agent selects appropriate depth from:

- complexity;
- scope;
- risk;
- affected contracts;
- blast radius;
- domain weight;
- critical paths;
- owner instructions;
- available evidence.

A localized edit may need only focused validation. A material feature may need testing and code review. A critical architectural change may justify QA, DDD evaluation, architecture analysis, technical debt, code review, security, integration/E2E, or performance evaluation where applicable.

The owner may also explicitly define a completion set. If the owner says "do not finish until all tests, QA, DDD, architecture, technical debt, and review are clean," those checks become part of the requested outcome.

## Evaluators return evidence

Evaluators exist to produce useful engineering evidence.

Examples include:

```text
QA
DDD
Technical Debt
Architecture Debt
Code Review
Security
Lean-code analysis
Performance
Accessibility
```

Not all evaluators have the same enforcement semantics.

### Quality floors

Three domains are eligible for guarded enforcement by default:

- QA sign-off;
- applicable deterministic DDD Class A invariants;
- new high/critical technical debt introduced by the current diff.

### Canary evaluators

Architecture Debt, code-review guidance, routing, graph observations, economy hints, simulations, and other engineering analysis normally produce findings for the agent to reason about without denying execution.

### Shadow evaluators

Privacy/LGPD remains observational by default.

## A finding is not automatically a stop

A finding has to be interpreted in context.

For example:

```text
Architecture Debt finding
        ↓
Does it affect this change?
        │
        ├── no → report/continue
        │
        └── yes
             ↓
        agent evaluates
             ↓
      fix / accept / escalate
```

A canary evaluator helps the agent make better decisions. It does not own the project.

## QA creates a real new cycle

When QA rejects a task, the task can return from `testing` or even `done` to a fresh backlog cycle.

```text
testing / done
      ↓
  qa-reject
      ↓
    backlog
      ↓
    working
      ↓
    testing
      ↓
 fresh evidence
      ↓
     done
```

Current-cycle evidence is cleared when the QA cycle restarts. Historical events remain available as history.

This distinction matters:

> Previous evidence proves the previous implementation. It does not automatically prove the corrected implementation.

If the enclosing Workflow had already completed, the Workflow can reopen as part of the new correction cycle.

## Code review in the loop

A material diff should receive a review pass.

When the host supports specialist delegation, ContextDevKit can recommend or explicitly invoke `code-reviewer`. The full `/ship` pipeline includes that review stage.

Outside a full pipeline, specialist routing remains advisory. If the specialist is unavailable, the active agent continues and performs the review responsibility itself.

The invariant is the engineering responsibility, not the presence of a particular subagent.

## Evidence-backed completion

ContextDevKit distinguishes evidence states such as:

```text
passed
violated
unknown
skipped
error
```

Unknown is not PASS. Skipped is not PASS. Evaluator failure is not PASS.

At the same time, optional evaluator failure is not automatically a platform denial. This prevents two opposite failure modes:

- fabricated confidence;
- governance deadlock.

Only the configured guarded quality floors may deny at their documented lifecycle moments and only with complete deterministic predicates.

## Owner authority and requested outcomes

The owner defines the outcome.

ContextDevKit can provide default quality floors, adaptive evaluator recommendations, and explicit evidence, but it does not turn a model score, named agent, swarm, or methodology into project ownership.

A scoped human override records that an owner accepted a guarded condition without changing the underlying evidence into a pass.

## Avoiding pathological loops

A healthy engineering loop should converge.

The active agent should detect when:

- the same finding repeats without progress;
- a correction creates another regression;
- required external information is missing;
- the problem is outside the active scope;
- a decision genuinely belongs to the owner;
- an evaluator itself is malfunctioning.

At that point, the correct behavior is not infinite retry. It is to surface the blocking evidence and escalate appropriately.

## Long-running loop continuity

Engineering loops may outlive one context window.

ContextDevKit preserves continuity through:

- canonical task state;
- Workflow state;
- reports;
- context manifests;
- project memory;
- continuation prompts;
- compact execution output;
- `run-compact`;
- task compilation;
- session and run state.

The project should know where the work stopped even when the model no longer remembers the original conversation.

## Full ship loop

The full `/ship` pipeline combines these responsibilities:

```text
scope
  ↓
design
  ↓
plan tests
  ↓
implement
  ↓
self-review
  ↓
test / QA
  ↓
quality analysis
  ↓
record evidence
  ↓
report
```

In automatic mode, red evidence should be repaired when it is attributable and within scope. If it cannot be resolved honestly, it is surfaced as unresolved rather than hidden behind a fabricated pass.

## Core principle

> **The model may propose completion. Evidence justifies completion. The owner defines the outcome.**
