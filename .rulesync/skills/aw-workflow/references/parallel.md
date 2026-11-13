# Parallel ownership

Before dispatch, give each worker an objective, minimal context, permitted paths, exclusions, dependencies, acceptance check and stop condition. Inspect current project memory if present and include relevant decisions/blockers in the spec. New worktrees may not contain uncommitted state or memory.

One writer per shared file, one laboratory operator and one coordinator for shared memory/board. Separate worktrees help isolate edits but do not isolate databases, ports or remote resources. Fix shared contracts first and sequence dependent tasks. Keep resource-heavy jobs within the host budget.

Workers return results, changed files, commands and evidence, remaining risks, Decisions, Discoveries and candidate Lessons. They do not write shared memory or commit a shared checkout. A reviewer stays read-only; an author does not impersonate an independent review. Integration and acceptance remain with the coordinator.

Prefer completion events. A heartbeat without evidence of worker activity is not progress. Inspect an expired signal before restarting; an uncertain write must not be replayed blindly.
