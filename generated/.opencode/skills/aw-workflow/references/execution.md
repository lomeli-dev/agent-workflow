# Execution and verification

Use rg or working semantic tools to locate code, then read sufficient surrounding behavior/callers. Batch independent reads; do not fragment discovery into avoidable serial round trips. Do not reread unchanged material without reason, but refresh files changed by others.

Apply a coherent multi-file patch. Whole-file writes suit new files or intentional rewrites, not an arbitrary percentage threshold. A second edit is appropriate when tests or review reveal a problem.

Run focused regressions during implementation. Shared schemas/APIs/state require affected-consumer and failure tests. At integration run mandated broader checks. Repeat checks when inputs or relevant risk change, not to make a task look busy. LSP/vet/build/runtime tests establish different things.

Preserve real exit codes; pipelines ending in tail can conceal failure unless the runner preserves the tested command status. Save bounded secret-safe logs and return useful excerpts. Never batch approval-sensitive publication into a blind add/commit/push chain.

Keep compatible caches. In Go, -count=1 disables test-result caching; use it when fresh execution is required, not as a speed default. Model/effort and compaction settings are client-specific: inherit the user's settings unless authorized verified profiles exist.

Use `agent-workflow doctor --json` to inspect tools. `setup` is explicit, optional and scoped to a named dependency; startup hooks never install. Tool presence is not functional client integration. Measure elapsed time to accepted results and rework, not just call counts.
