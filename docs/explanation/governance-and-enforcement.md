# Governance and enforcement

<!-- GENRE: Explanation (understanding-oriented) -->

Why this project enforces its rules through host hooks and CI scripts instead of
trusting an instruction to be followed — what the three enforcement modes actually
do, what counts as evidence, and which decisions no configuration can hand to an
agent.

## Background: a rule in a prompt is a request

The same capability that makes a language model useful — reasoning, planning,
generating — also lets it argue its way around a constraint it was asked to
respect. Told "do not write source before a workflow exists", a capable model can
produce a convincing case for why this particular change is the exception. That is
not a defect of one model; it is a property of instruction-following systems under
contextual pressure. Rules written in a prompt or a README are requests with
authority. They hold most of the time, and "most of the time" is the wrong
reliability target for governance, because the occasions when a rule bends are
exactly the occasions where bending it costs the most.

So the rules that can be checked mechanically were moved out of the prompt and into
the harness: hooks that run before and after tool calls, scripts that run in CI, and
engine transitions that refuse to advance without a verified artifact. The agent
still reasons freely. It simply finds that some actions are unavailable until the
conditions for them exist on disk.

That split follows checkability, not importance. Whether a test file exists, whether
a workflow is at a permitted phase, whether a commit message parses — these are
binary facts a script settles in milliseconds. Whether an abstraction is right, or a
scope proportionate, is judgment. The harness enforces the first kind and advises on
the second. When governance fails here, the diagnosis is always the same question:
where does this rule actually live?

## The three enforcement modes

The capability gates read one setting, `enforcement.mode`, with three values.

| Mode | At exploration | Before a write | Before completion |
| --- | --- | --- | --- |
| `advisory` | warn | warn | warn |
| `guarded` | warn | deny | deny |
| `strict` | deny | deny | deny |

Operationally, "warn" means the hook prints its reason and the tool call proceeds.
"Deny" means the hook returns a refusal to the host, which stops that one tool call
and hands the agent the reason plus the exact corrective command. Neither outcome
ends the session, and neither is a crash: a hook always exits zero and expresses a
denial as data on stdout.

`advisory` never denies, at any moment, for any reason. That is an invariant in the
decision functions rather than a convention — the advisory branch returns `warn`
before any other consideration is reached.

Three separate subsystems carry their own mode value, which is worth knowing before
you change one and expect the others to follow. The capability gates use
`enforcement.mode`. The domain-engineering gates derive theirs from the activation
level (level 4 advisory, levels 5 and 6 guarded, level 7 strict) and stay inert
entirely unless `domainEngineering.enabled` is true, which is not the default. The
graph-first exploration gate carries its own mode under the project-map settings.

## Graceful degradation: why guarded ships as the default

`guarded` is the value the gates fall back to when nothing is configured — including
on an install that has never been touched. That is workable only because a gate that
cannot evaluate its inputs safely does not guess. It degrades to advisory: it prints
what it noticed, exits zero, and lets the work continue.

The block authority is one small pure function, and it refuses to block unless every
one of five conditions holds: the mode is `guarded` or `strict`; an execution
contract exists on disk; the evaluation returned a denial; at least one of the
missing capabilities is a ceremony capability (intake completion or a required
decision record); and the work classification was computed with a confidence other
than "ask". Anything else — no contract, no classification, a policy registry that
failed to load, an unregistered task, a missing capability that is not a ceremony
capability, a thrown error anywhere — returns a warning instead, each with its own
recorded reason code.

The direction of that failure is deliberate. When a check cannot run, the harness
degrades toward letting work through with a visible note, never toward a silent
refusal and never toward a silent approval. A fresh install has no contract and no
classification, so it takes the degrade path on every gate and is never blocked by
machinery it has not yet used. The cost is honest: on a half-configured project,
guarded behaves much like advisory, and the way to tell which happened is the reason
code in the telemetry, not the absence of a message.

## What counts as a receipt

A gate is satisfied by a receipt, and a receipt is a file the harness wrote after a
script ran. It records the capability, the task, the session, the command, the host,
a result value, an exit code, and the scope the run covered. Its fingerprint is a
hash of that scope computed inside the writer, so a caller cannot supply its own.

A stored receipt only satisfies a gate when all of the following hold: its result is
`passed`; it has not expired (the default lifetime is twenty-four hours); its branch
matches the current branch; its task id matches the current task; and its fingerprint
matches the scope being evaluated right now. That list is what makes the common
near-misses fail closed. A receipt from yesterday is expired. A receipt earned on
another branch does not travel. A receipt whose scope no longer matches the files in
play is stale by fingerprint, not by opinion.

Prose is not a receipt. "The tests passed" in a message is a claim about a run, not
the run. The harness has no way to distinguish an accurate claim from a confident
one, so it does not try — it looks for the file. This is the difference between
governance and theatre, and it is the reason a session can be honest and still be
blocked.

A bypass is not a receipt either. Bypasses exist, they are recorded, and they are
reported in a separate list from satisfied capabilities so that a reader can always
tell a waiver from a proof. A bypass whose recorded actor is automation is invalid
outright for any capability that requires human approval — automation cannot
self-authorize the thing that was defined as needing a person.

## Skipped is never passed

When a check cannot produce a verdict — an optional dependency is missing, the
evidence it needed does not exist, the projection it queries is unreadable — the
result is `skipped` or `unknown`. Neither counts as a pass, anywhere.

That has visible consequences. The receipt vocabulary carries `skipped`, `unknown`,
`insufficient-data`, `stale`, `bypassed` and `failed` alongside `passed`, and only
`passed` satisfies a gate. The architecture-debt gate treats missing evidence as an
`UNKNOWN` outcome, which is not in its approving set and fails its CI check. The
graph-first gate, when it cannot read the projection, says so out loud and allows the
search — it does not record that the graph was consulted.

The alternative default is what makes advisory systems untrustworthy: assume pass
unless explicitly failed, and a missing check silently reports compliance that was
never verified. Here a missing check reports that it is missing.

## Refuse by default, permit by opt-in

The default state of any assertion in the platform is unproved. Only a verified
verdict moves it. Approval and pass markers are born null, and nothing stamps them
but the check that earned them. Validators throw rather than warn, and they run
before expensive I/O so a refused state does not first copy a tree. Commands that
mutate are dry-run by default and require an explicit write flag, which then applies
atomically.

The same posture covers contradictions. When two configured requirements cannot both
be true, the resolution is an explicit refusal with both sides named, not a quiet
downgrade to whichever one is easier to satisfy. Silently substituting a weaker
option would leave the project believing it has the stronger one.

## The AI cannot approve its own work

Governance artifacts move through a lifecycle — draft, proposed, approved, sent back
for revision, or rejected — and the approving step is bound to a human actor. A
transition to approved with any other actor is refused with a structured error, not
downgraded to a warning. Closing a context with an outcome carries the same
requirement.

No autonomy grade relaxes this, because it is not implemented at the grade layer. An
agent can draft the decision record, gather the evidence, prepare the transition, and
present all of it. The signature is a separate act by a separate party. An agent that
could both write the justification and accept it would produce an audit trail that
proves only its own consistency.

## Hooks are governance, and they are not a security control

Every hook in this project is written to exit zero on error and to stay silent when
it has nothing to say. A failure inside the hook infrastructure is swallowed, not
propagated, because a broken hook that halts a developer's work is worse than a hook
that missed one call.

That property — fail-open — is what makes hooks safe to run on every tool call, and
it is also precisely what disqualifies them as a security boundary. A control you can
defeat by making it throw is not a control. Hooks raise the cost of skipping a
ceremony and they make the skip visible; they do not contain an adversary, and they
are not the layer to reach for if that is the goal. Application-layer security, secret
handling and dependency risk are separate concerns with their own tooling, and they do
not inherit any guarantee from this one.

The blocking checks that must not be evadable live in CI instead, where a non-zero
exit is the whole point. None of them run in a local edit hook.

## The floor no autonomy grade moves

The autonomy dial decides what the agent may do without asking, per area, and it
resolves through a table by grade. A floor clamps that table afterwards and cannot be
out-precedenced by a flag, a session override, or a configuration value. Five things
sit on it.

- Decision records and changes to the autonomy grade itself resolve to manual at every
  grade. An agent that could raise its own permissions has none.
- Paths that carry secrets resolve to manual. Projects may extend that path set; they
  cannot remove entries from it.
- Edits to the gates and hooks themselves, and to the host settings file that wires
  them, resolve to manual. A gate the agent may rewrite is a suggestion.
- Force-push resolves to manual, as does any push toward the default branch, even at
  the highest grade where ordinary feature-branch pushes are automatic.
- The stored evidence that qualifies a project for the highest grade resolves to
  manual, so the bar cannot be forged by the party being measured.

## Where strict is thinner than its name

`strict` is real but narrower than it reads. It differs from `guarded` in the
decision functions: it denies at exploration too, and it denies on a low-risk
domain-engineering verdict where guarded only warns. It does not differ in the block
authority. That function tests only whether the mode is advisory; guarded and strict
take the identical path through the remaining four conditions. So strict inherits
every degradation guarded has, and it cannot force a block on a capability outside
the two ceremony capabilities. Choosing strict tightens two decision points; it does
not make the gate absolute.

Two adjacent details in the same spirit. The domain-engineering rollout stage acts as
a ceiling on the level-derived mode: it can only lower authority, never raise it, and
when unset the level ladder applies unconstrained. And `enforcement.mode` is not
present in the shipped configuration defaults and is not validated by the config
schema, so an invalid value there does not error — it falls back to `guarded`.

## What this page does not cover

This is the reasoning, not the lookup. For the per-gate contract — required input,
behaviour when that input is absent, behaviour in each mode — see the governance
contract reference. For how quality specifically is judged, including why file length
never blocks anything, see the quality model. For which hooks are active at which
activation level, see the levels reference. For the configuration keys and their
defaults, see the configuration reference. For a gate that is blocking work you
believe it should not, see the troubleshooting guide.

Application security, dependency risk and privacy obligations are separate domains
with their own agents and commands, and nothing on this page speaks to them.

## Related

- [Governance contract](../reference/governance-contract.md) — the per-gate table.
- [Quality model](./quality-model.md) — how debt and quality are adjudicated.
- [Workflow governance](./workflow-governance.md) — phase gates in the engine.
- [Levels](../reference/levels.md) — which hooks run at which level.
- [Configuration](../reference/config.md) — keys, defaults, and what they change.
- [Troubleshoot an install](../how-to/troubleshoot.md) — when a gate blocks you.
- [Tune autonomy and level](../how-to/tune-autonomy-and-level.md) — the consent dial.
