---
name: aw-workflow
description: Organize a substantial coding task into bounded discovery, coherent edits, focused validation and integration. Use when the user requests this workflow, coordinated implementation, or fewer repeated tool steps; skip trivial independent edits.
targets: [claudecode, codexcli, opencode]
---

# Efficient implementation

First check `agent-workflow status --json` for the current project. If disabled, stop applying this workflow; continue the user's task under its own instructions. If the CLI is absent, inspect `.agent-workflow.json` along the cwd-to-project-root path. Do not install anything just to discover applicability.

Identify the accepted result, affected contracts and smallest meaningful verification. Read the project map and current state, not the full history. Batch independent discovery calls; inspect each result. Use a coherent patch across related files and tests, allowing corrections driven by evidence.

Choose checks by affected behavior, not just filenames. Run focused checks while editing and required broader checks at integration. Preserve command exit status and enough diagnostics to explain failures; a shortened output is not the source of truth.

For delegated work, read [parallel ownership](references/parallel.md). For test selection and tool efficiency, read [execution](references/execution.md). Use existing project roles when suitable; aw-worker/aw-reviewer are optional generic fallbacks, not additional workers that must start.

At milestones, the coordinator updates the existing board/memory, if present and authorized. Before compaction or handoff, record candidate revision, completed checks, unresolved effects, assignments and live resources. Compaction is a client capability, not something a Markdown summary performs.

Finish when acceptance is demonstrated. Report outcome, tests, limitations and resources retained. Do not publish/deploy beyond user authorization or claim a performance gain without measurements.

When optional tools are available, follow [tool routing](references/tools.md). Installation is never a prerequisite for every task.
