# L3 — explicit coordination and transactional state

Parallel hosts coordinate through explicit records under `.claude/.workspace/`
and the canonical workflow/task JSON stores. Claims identify ownership; CAS
revisions and atomic rename protect state transitions. There is no per-session edit
ledger and no status encoded by moving Markdown cards between directories.

Each Git worktree has its own index, filesystem, and workspace-claim directory.
Rendered Markdown is a repairable projection of JSON authority, never a second
writer or fallback reader.
