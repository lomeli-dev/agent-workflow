# Compatibility, sources and evidence limits

Initial scope: macOS/Linux, Node 22.22.0+, Claude Code, Codex CLI and OpenCode V2. No claim of Windows or all IDE support. Rulesync 43.8.0 is pinned; version updates require regeneration and adapter tests.

| Capability | Claude Code | Codex CLI | OpenCode V2 |
| --- | --- | --- | --- |
| Global rule | CLAUDE.md managed block | AGENTS.md managed block | Global AGENTS.md managed block |
| Skill | Native skills/aw-workflow | User .agents/skills/aw-workflow | Global skills/aw-workflow |
| Optional roles | Native agents/aw-* | Rulesync-generated agents/aw-*.toml | Native agents/aw-* |
| Start command | aw-start | Invoke aw-workflow; no fake project slash command | aw-start |
| Reminder hook | SessionStart, SubagentStart, PreCompact | Same event definitions; native trust required | Plugin diagnostic plus project-gated compound-validation shell guard |
| Project disable | Gate at hook invocation + behavioral instructions | Gate at hook invocation + behavioral instructions | Per-shell-call gate for validation guard + startup gate for MCP; reload long-lived MCPs after changing config |
| LSP | Separate native integration required | Separate available client/tool integration required | Separate native integration required |

OpenCode V2 has a bounded pre-execution shell guard for recognized compound test/build commands. Other clients retain advisory instructions; this is not a general permission sandbox. No model/effort, permission, authentication, compaction or unrelated plugin setting is changed. Reviewer read-only instructions are not a permission sandbox. Global files may remain in discovery when project-disabled; a zero-load guarantee is not claimed. Long-running clients can retain previously loaded policy until reload.

File generation, config parsing, hook invocation and native model-driven behavior are separate evidence levels. `verify` checks owned bytes/registrations only. No assertion that all IDEs execute these instructions identically or that a live model became faster. Diagnostics and tests must not read private prompts or credentials.

Initial read-only diagnostics (historical): Codex's prompt-input diagnostic included the global rule and workflow skill; it did not expose the custom-role catalog in that output, so native role dispatch is not claimed. OpenCode V2's standalone agent diagnostic listed both roles. Claude's read-only doctor exited successfully, but did not establish skill/role execution. Direct installed-hook subprocess tests exercised enable/disable; they do not grant native client hook trust.

Primary sources checked 13 November 2026:

- [Rulesync global mode](https://rulesync.dyoshikawa.com/guide/global-mode): user-scope destinations and shared-directory deletion hazards. This installer does not use a global orphan sweep.
- [Rulesync compatibility](https://rulesync.dyoshikawa.com/reference/supported-tools): target features differ.
- [Claude memory](https://code.claude.com/docs/en/memory) and [hooks](https://code.claude.com/docs/en/hooks): native instructions and lifecycle events.
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [hooks](https://learn.chatgpt.com/docs/hooks): loading, native trust and event contracts.
- [OpenCode instructions](https://opencode.ai/docs/instructions/), [agents](https://opencode.ai/docs/agents/), [server plugins](https://opencode.ai/docs/build/plugins/server): global files, inherited models and V2 startup plugin context.

The package is installed through its CLI rather than pretending one native plugin manifest works in every client. Its OpenCode V2 component is a native plugin; Claude/Codex use native files and hooks. Future plugin-marketplace packaging is a separate delivery, not an already published integration.

Later [native-client trials](native-trial-2026-11-13.md) exercised real inference and tool calls in all three clients. They establish specific behavior, not universal rule compliance: OpenCode reported a deliberately failed validation correctly while still masking the shell exit with echo.

The [0.2.3 repair verification](repairs-2026-11-13.md) supersedes the observed OpenCode validation masking case: the compound form was blocked before execution and the direct retry retained exit 7. It also records an actual native compaction/resume trial in OpenCode 2.2.7.
