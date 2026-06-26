# Why ContextDevKit: the engineering case

_The rationale behind treating AI-assisted development as engineering — who this is
for, what problem it actually solves, and what you give up to get it._

## The audience-conflation problem

Most AI coding tools are designed for one of two audiences:

- **Explorers** who want fast results and don't mind throwaway context. A blank chat
  window and a capable model are enough.
- **Engineers** who need results that compound — decisions that are traceable,
  sessions that hand off cleanly, work that a future agent (or colleague) can resume
  without a briefing.

The problem is that the same tool is sold to both. An "explorer" feature (no session
state, no persistent memory, no governance) is a liability for an engineer. An
"engineer" feature (enforced workflows, drift detection, decision records) feels like
overhead to an explorer. Most tools pick a lane by pretending the other audience
doesn't exist.

ContextDevKit picks the engineering lane explicitly. It is designed for developers
who are using AI for work that matters — work that ships, work that is maintained,
work where a bad decision made in session 3 still has consequences in session 47.
If you want fast throwaway results, this kit is genuine overhead and you should not
install it. If you want AI-assisted development to behave like engineering, read on.

## The core thesis: enforcement beats instruction

The canonical way to control AI behavior is to add instructions to `CLAUDE.md` (or
the equivalent). "Always write tests." "Always record decisions in ADRs." "Never
commit without running the quality gates." These instructions work until they don't
— which is whenever the model is under time pressure, context is long, or a
simpler path is available. The more capable the model, the more persuasively it
argues for the shortcut.

ContextDevKit's thesis is that **the right unit of enforcement is a hook, not an
instruction**. A hook is code that runs deterministically. It does not reason, it
does not weigh trade-offs, it does not get tired. The Stop hook either sees a
registered session or it doesn't. The pre-push gate either passes quality checks or
it exits 1. The `advance` engine either finds the required deliverable in the right
place or it names the gap and refuses.

The implication is significant: the kit's governance does not depend on the quality
of any particular model. A capable model and a weak model are held to the same bar
by the same code. Governance that lives in a prompt is a guideline; governance that
lives in a hook is a constraint. ContextDevKit builds constraints.

## What "durable memory" actually means

The phrase "project memory" is used loosely in AI tooling to mean anything from
conversation history to vector database embeddings. ContextDevKit's memory is
deliberately narrow and deliberately plain-text:

- **ADRs** record *why* a decision was made — the forces considered, the
  alternatives rejected, the trade-offs accepted. Not what was built; why it was
  built that way. An ADR that says "we chose PostgreSQL" is useless. An ADR that
  says "we chose PostgreSQL over SQLite because the project has three concurrent
  writers and we need row-level locking" is recoverable context six months later.
- **Session logs** record *what* happened in each working session — files changed,
  decisions made, tasks advanced. Not a transcript; a structured record that the
  next session can diff against the current state.
- **The glossary** records the mapping between UI language and code identifiers.
  When a product term and a code term diverge, bugs follow. The glossary is the
  single source of truth for that mapping.

All of this lives in your repository, under version control, in Markdown. No
external service, no API key, no database. It is readable by a human, diffable by
git, and loadable by any AI session that can read files. The durability is not a
feature of the storage system — it is a consequence of choosing the right format.

## Why the level system

The seven levels exist because governance has a cost, and that cost should match the
stage of the project.

A greenfield experiment in week one does not need an L5 mutation guard or an
enforced workflow journey. Adding those constraints too early kills momentum without
yielding the return they are designed for. The kit installs at L3 for an empty
folder — enough to have memory, track sessions, and prevent the common failure mode
of "we started but nothing is recorded."

An existing production codebase with multiple contributors working in parallel needs
the full stack: branch-scoped workflow guards, pre-commit compliance auditing, the
deliberation council before architectural decisions, and cost-tiered model routing
to keep the token economy sustainable. That is L6/L7.

The level system lets you start where you are and climb as the project's needs
mature. Climbing adds capability; descending removes now-unnecessary constraints
without losing the memory that was already accumulated.

## The autonomy dial and its floor

The autonomy dial (`autonomy.grade` 1–4) answers a different question from the
level system. Levels control *what capabilities are active*. The autonomy grade
controls *how much the AI may do without asking* at whatever level is active.

Grade 2 (the default) is the engineering-conservative posture: the AI suggests,
explains its reasoning, and waits for confirmation before mutating state. Grade 3
is appropriate for mature projects where the AI has a track record — it auto-executes
most actions but defers the irreversible ones (ADR writes, force-push, grade changes)
to a human quorum. Grade 4 is full-auto with a deliberation quorum at each gate,
designed for supervised batch work.

The floor is non-negotiable and encoded in the engine, not in a prompt. At every
grade:

- Secrets are never auto-committed.
- Force-push to the default branch is always blocked.
- ADR writes always require a human signature.
- Gate and hook self-edits (the governance machinery editing itself) are always blocked.
- The grade itself cannot be changed by the AI.

These are not guidelines. They are conditions the `resolveAutonomy()` function checks
before returning a permitted state. The AI cannot argue past them because they are
not in the argument layer.

## The token economy rationale

Token cost in AI-assisted development compounds in ways that are not obvious until
they are large. A session that loads all eight squad playbooks at boot because the
developer might need any of them is spending tokens on context that is almost never
used. A session that spawns every subagent at the premium model tier because that is
the default is paying a 5–10× premium on work that does not require premium capacity.

ContextDevKit approaches this as an engineering problem, not a product feature. The
squad director computes at boot which squads the current diff actually implicates,
and loads only those playbooks — subtraction, not addition. Cost-tiered model routing
assigns the reasoning tier to work that genuinely requires it (architecture,
security, privacy) and the fast tier to work that does not (scaffolding, packaging,
read-only exploration). The economy runtime measures spend per command and per agent
and makes it visible on the Execution Contract after each run.

The goal is not to make AI-assisted development cheap. It is to make the cost
*proportional to the value* — to close the gap between what you pay and what you
get by spending expensive capacity only where it changes the outcome.

## What you give up

Honest accounting requires naming the costs:

- **Setup time.** The kit does not configure itself. `/setupcontextdevkit` does the
  heavy lifting, but you still need to review and tune `config.json`, populate your
  CLAUDE.md coding constitution, and mark your high-risk paths. This is thirty
  minutes the first time and five minutes on each subsequent project.
- **Governance latency.** The deliberation council adds time to opening a feature
  or recording a decision. The workflow engine adds time to each phase advance when
  deliverables are missing. These delays are the point — they exist because the
  work they gate deserves the delay — but they are delays.
- **Ceremony on small changes.** The kit is optimized for projects with meaningful
  architectural surface area. A one-file script does not need a workflow spec, an ADR,
  and a QA sign-off. The level system mitigates this (stay at L1 or L2 for small
  work), but the kit's ceiling is genuinely higher than its floor.
- **Learning curve.** The command set is large. The governance model has concepts
  (autonomy grades, deliberation phases, workflow journey gates) that require a
  mental model before they are fluent. The docs exist to build that model, but
  they are docs you need to read.

For projects where AI-assisted development is doing real engineering work — complex
decisions, multiple sessions, multiple contributors, maintained over time — these
costs are small relative to the alternative: context that evaporates between sessions,
decisions that can't be traced, and governance that exists only in a prompt the model
is free to rationalize past.

## See also

- [docs/explanation/workflow-governance.md](workflow-governance.md) — how the
  workflow journey is enforced in the engine, not in a prompt.
- [docs/explanation/deliberation-council.md](deliberation-council.md) — why the
  deliberation council fires automatically at the two moments it matters.
- [docs/explanation/active-squads.md](active-squads.md) — how squads went from
  declared-but-passive to actively routed and governed.
- [docs/LEVELS.md](../LEVELS.md) — what each level adds and when to climb.
