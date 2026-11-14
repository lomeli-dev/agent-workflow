# Execution and verification

Use rg or working semantic tools to locate code, then read sufficient surrounding behavior/callers. Batch independent reads; do not fragment discovery into avoidable serial round trips. Do not reread unchanged material without reason, but refresh files changed by others.

Apply a coherent multi-file patch. Whole-file writes suit new files or intentional rewrites, not an arbitrary percentage threshold. A second edit is appropriate when tests or review reveal a problem.

Run focused regressions during implementation. Shared schemas/APIs/state require affected-consumer and failure tests. At integration run mandated broader checks. Repeat checks when inputs or relevant risk change, not to make a task look busy. LSP/vet/build/runtime tests establish different things.

Run required validation directly and inspect its actual exit status. A pipeline ending in tail/head, or appending echo/ls/cat after a test, can turn failure into a successful tool result. When filtering is necessary, capture and propagate the tested command status explicitly; never infer success from the last shell command. Batch independent reads, not validation followed by unrelated successful commands. Save bounded secret-safe logs and return useful excerpts. Never batch approval-sensitive publication into a blind add/commit/push chain.

Keep compatible caches. In Go, -count=1 disables test-result caching; use it when fresh execution is required, not as a speed default. Model/effort and compaction settings are client-specific: inherit the user's settings unless authorized verified profiles exist.

Use `agent-workflow doctor --json` to inspect tools. `setup` is explicit, optional and scoped to a named dependency; startup hooks never install. Tool presence is not functional client integration. Measure elapsed time to accepted results and rework, not just call counts.

OpenCode V2 installs a project-gated shell hook that rejects recognized test/build commands combined with pipes, separators or conditionals before execution. If it returns AW_VALIDATION_COMPOUND, run the validation directly using the tool cwd rather than hiding it inside another shell. This is a bounded workflow guard, not a complete shell parser or sandbox.
