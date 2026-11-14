---
root: true
targets: [claudecode, codexcli, opencode]
---

# Agent Workflow applicability

Before using Agent Workflow, inspect the nearest `.agent-workflow.json` up to the project root, or run `agent-workflow status --json`. If `enabled` is false, do not apply Agent Workflow rules, invoke its aw-* skills/roles, or perform its checks in this project. Existing project instructions still apply. Do not enable it on the user's behalf. This opt-out cannot prevent clients from discovering global files.

When enabled, prefer batched independent reads, sufficient symbol/context exploration, coherent multi-file patches, focused development tests and required integration checks. Inspect every tool result; preserve failing exit codes. Run required validation commands directly so their exit status remains visible. Do not pipe them into head/tail or append echo, file reads or other successful commands unless you explicitly capture and return the original failure status. Sequence dependent changes, use one writer per shared file, reconcile uncertain effects before retrying, and keep resource-heavy concurrency bounded.

Use aw-workflow for a substantial coding task that needs coordination or an efficiency correction. Load detailed procedures only when relevant. Do not install dependencies, launch workers or create memory merely because these instructions loaded. Only the coordinator writes existing shared project memory; workers return decisions, discoveries and verified candidate lessons. Follow the project's existing memory skill when available.
