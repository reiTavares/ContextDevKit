# Skill: pipeline

> The DevPipeline manager — production board for bugs, increments, chores and roadmap tasks (backlog → testing → done).
> Argument: [show | add | move <id> <stage> | from-roadmap]
# 🛠️ DevPipeline

The execution control panel — **distinct from the product roadmap**. The roadmap
(`contextkit/memory/roadmap.md`) is the product/business plan (the *what/why*). The
DevPipeline is *how work actually flows*: bugs, increments, chores, and roadmap
items broken into tasks, each with priority + SLA, moving through three stages:
`backlog → testing → conclusion`. Tasks are files under `contextkit/pipeline/<stage>/`;
`devpipeline.md` is the generated dashboard.

Act as the **manager** of this board based on **<user-specified argument>**:

- **show** (default) — start token-light:
  `node contextkit/tools/scripts/pipeline.mjs board --digest` (compact lane
  summary, ADR-0047) and reason from it; open the full
  `contextkit/pipeline/devpipeline.md` (after `pipeline.mjs sync`) only when the
  digest isn't enough. Summarize what's in flight, what's next by priority, and
  any SLA at risk. Recommend the single next task to pull.
- **add** — create a task:
  ```
  node contextkit/tools/scripts/pipeline.mjs add --type <bug|feature|increment|chore> \
       --priority <P0-P3> --title "..." [--sla YYYY-MM-DD] [--roadmap P2.3]
  ```
  Then open the new file in `contextkit/pipeline/backlog/` and fill the context +
  acceptance criteria. **Right-size first** [ADR-0030]:
  `node contextkit/tools/scripts/complexity-rubric.mjs classify "<title>"` — an
  architectural tier means the task should reference (or trigger) an ADR; a
  regulated domain means tagging the owning agents (`@privacy-lgpd`/`@security`)
  in the acceptance criteria.
- **move** — `node contextkit/tools/scripts/pipeline.mjs move <id> <backlog|testing|conclusion>`
  as work progresses (testing when you start; conclusion when accepted). For a
  concluded task, add a short outcome report to its file.
- **from-roadmap** — read `contextkit/memory/roadmap.md`, pick the next milestone,
  and break it into a few concrete backlog tasks (`--roadmap <P-ID>` cross-ref).
  Keep the non-duplication rule: roadmap = product capabilities; pipeline = the
  tasks/bugs/increments to deliver and maintain them.

Always run `sync` after changes so `devpipeline.md` reflects reality. Treat P0/SLA
items as the priority. This board is the "boss" that keeps execution honest.
