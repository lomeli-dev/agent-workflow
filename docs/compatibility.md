# Compatibility, sources and evidence limits

Scope: macOS/Linux, Node 22.22.0+. Core clients (default): Claude Code, Codex CLI and OpenCode V2. Extra clients (0.4.0, explicit `--clients ...` or `--clients all`): Qwen Code, Kimi Code, Antigravity CLI (agy), Command Code, Pi and MiMo Code. ZCode and Cursor Agent CLI were left out by the owner's decision. No claim of Windows or all IDE support. Rulesync 43.8.0 is pinned; version updates require regeneration and adapter tests.

| Capability | Claude Code | Codex CLI | OpenCode V2 |
| --- | --- | --- | --- |
| Global rule | CLAUDE.md managed block | AGENTS.md managed block | Global AGENTS.md managed block |
| Skill | Native skills/aw-workflow | User .agents/skills/aw-workflow | Global skills/aw-workflow |
| Optional roles | Native agents/aw-* | Rulesync-generated agents/aw-*.toml | Native agents/aw-* |
| Start command | aw-start | Invoke aw-workflow; no fake project slash command | aw-start |
| Reminder hook | SessionStart, SubagentStart, PreCompact | Same event definitions; native trust required | Plugin diagnostic plus project-gated compound-validation shell guard |
| Validation guard (0.5.0) | Opt-in `PreToolUse` (`--guard claude`) | Opt-in `PreToolUse` (`--guard codex`); needs `/hooks` approval | Plugin shell guard (always) |
| Project disable | Gate at hook invocation + behavioral instructions | Gate at hook invocation + behavioral instructions | Per-shell-call gate for validation guard + startup gate for MCP; reload long-lived MCPs after changing config |
| LSP | Separate native integration required | Separate available client/tool integration required | Separate native integration required |

## Extra clients (0.4.0)

Paths are for the default layout; `QWEN_HOME`, `KIMI_CODE_HOME` and `PI_CODING_AGENT_DIR` are honored like `CODEX_HOME`. The skill is installed once in `~/.agents/skills/aw-workflow`, which Codex, Qwen, Kimi, Command Code, Pi and MiMo all read; only Antigravity gets its own copy (it does not read that folder). Agents and commands are Rulesync 43.8.0 outputs, generated in project layout inside staging (never with `rulesync --global`, which writes into the real home and ignores `--output-roots`) and mapped to each client's user folder.

| Client (version checked) | Global rule (managed block) | Skill | Agents aw-worker / aw-reviewer | aw-start | Session hook |
| --- | --- | --- | --- | --- | --- |
| Qwen Code 0.28.4 | `~/.qwen/QWEN.md` | shared | `~/.qwen/agents/` | `~/.qwen/commands/aw-start.md` | `~/.qwen/settings.json`: SessionStart, SubagentStart, PreCompact (Claude shape, `hookSpecificOutput.additionalContext`; PreCompact text becomes compaction instructions) |
| Kimi Code 2.7.3 | `~/.kimi-code/AGENTS.md` | shared | `~/.kimi-code/agents/` | skill `~/.kimi-code/skills/aw-start` | **none**: Kimi fires SessionStart but discards its output; only UserPromptSubmit output reaches the model, which would repeat the reminder on every prompt (0.5.0 adds only the PreToolUse validation guard, see below) |
| Antigravity CLI (agy) 1.5.15 | `~/.gemini/GEMINI.md` | `~/.gemini/config/skills/aw-workflow` | `~/.gemini/config/agents/` | skill `~/.gemini/config/skills/aw-start` | `~/.gemini/config/hooks.json`, named group `agent-workflow`, SessionStart → `injectSteps[].systemMessage` |
| Command Code 1.89.3 | `~/.commandcode/AGENTS.md` | shared | `~/.commandcode/agents/` | `~/.commandcode/commands/aw-start.md` | `~/.commandcode/settings.json` SessionStart (its only session event); may ask to trust hooks per project |
| Pi 1.6.0 | `~/.pi/agent/AGENTS.md` | shared | none (Pi has no subagents) | `~/.pi/agent/prompts/aw-start.md` | extension `~/.pi/agent/extensions/agent-workflow.js`: hidden message before the first run of each session |
| MiMo Code 0.1.16 | see below | shared | `~/.config/mimocode/agents/` (reviewer: `permission.edit: deny`) | `~/.config/mimocode/commands/aw-start.md` | plugin `~/.config/mimocode/plugins/agent-workflow.js` (`experimental.chat.system.transform`) |

MiMo loads only the first existing file of `$MIMOCODE_CONFIG_DIR/AGENTS.md`, `~/.config/mimocode/AGENTS.md` and `~/.claude/CLAUDE.md`. Creating its own `AGENTS.md` would silently stop it from reading Claude's file, so the block goes to `~/.config/mimocode/AGENTS.md` only when that file already exists or there is no `~/.claude/CLAUDE.md`; otherwise MiMo receives the rule through `CLAUDE.md` (install the `claude` client too). `install`/`verify` print a notice with the current situation. MiMo and Command Code also read `~/.claude/skills`, so with `claude` installed they may list `aw-workflow` from two folders (same content).

Hooks of extra clients call `<store>/bin/node <store>/runtime/hook.mjs --client NAME`; the runtime adapts input (`workspacePaths` for agy) and output per client. Claude and Codex keep their previous command, so upgrading does not change their hook text. The PreToolUse validation guard (0.5.0) reuses the same command with a shell-tool matcher; see [Validation guard](#validation-guard-050). Reviewer read-only enforcement exists only for Claude, Codex, OpenCode and MiMo; elsewhere it is an instruction.

### Evidence (23 November 2026)

Every client: generated files, `--user-root` tests (install → verify → edits outside owned parts → sync → uninstall keeps them) and hook output tests. Real-client runs used an isolated install and never touched the real configuration (checksums of the real config files were compared before and after).

| Client | Native discovery without a model | Real headless session |
| --- | --- | --- |
| agy | `agy agents` lists aw-reviewer, aw-worker | **Verified.** `agy --gemini_dir=<isolated>/.gemini -p ...` (real sign-in, isolated config): quoted the `GEMINI.md` block (`user_global`) and the SessionStart hook text, listed the aw-start/aw-workflow skills; ran `npm test` directly and reported exit 7; after `disable --project` the hook text was gone (0 occurrences) while the rule stayed |
| MiMo | `mimo agent list` lists both subagents; `mimo debug skill` lists aw-workflow; `mimo debug config` loads the plugin without error | **Verified** with `MIMOCODE_CONFIG_DIR=<isolated>`: returned a canary placed in the isolated `AGENTS.md` that holds the block and quoted the plugin's gate sentence; ran `npm test > log 2>&1; echo "exit=$?"` (an allowed form) and reported 7; after `disable` the gate sentence was NONE. A first, open question was answered with "only the skill"; model self-reports are not reliable on their own |
| Pi | — | **Hook verified** with `pi -p -e <isolated>/extensions/agent-workflow.js`: quoted the injected message (`customType: agent-workflow`); none after `disable`. The global `~/.pi/agent/AGENTS.md` needs the real agent dir (sign-in lives there): run by the owner after the global sync |
| Command Code | `commandcode skills list` lists aw-workflow | pending global sync: settings and sign-in share `~/.commandcode` |
| Qwen | none offline | pending global sync: `QWEN_HOME` also moves the sign-in |
| Kimi | `kimi doctor`: config valid | pending global sync: `KIMI_CODE_HOME` also moves the sign-in |

**Antigravity headless hang.** On this Mac `agy -p` waited until its print timeout because `context7_api` and `huggingface` stay "still connecting" (agy log `mcp_manager.go:1014`) although both have `"disabled": true` in `~/.gemini/config/mcp_config.json`; other disabled servers do not block. That is an agy 1.5.15 behavior, and `--settings` accepts no MCP key. Workaround without touching the global config: the hidden `--gemini_dir` flag points agy at another `.gemini` folder while the keyring sign-in stays valid (a temporary `HOME` loses it). For daily use the owner can remove those two entries from `~/.gemini/config/mcp_config.json` instead of keeping them disabled; Agent Workflow does not change it.

Not added: ZCode and Cursor Agent (owner's decision). Factory Droid (`~/.factory`), GitHub Copilot CLI (`~/.copilot`) and DeepSeek Harness (`~/.dsh`) have config folders but no binary on this Mac; Rulesync maps them to `~/.factory/{AGENTS.md,skills,droids,commands}`, `~/.copilot/{copilot-instructions.md,skills,agents}` and `~/.dsh/{AGENTS.md,skills}`, so they can be added once a binary allows verification. Zed keeps its global rules in the Rules Library database (`~/.config/zed/prompts/prompts-library-db.0.mdb`, LMDB) and Warp keeps rules in the app/cloud: neither has a file this installer can own safely. The Claude Code and Codex VS Code extensions use `~/.claude` and `~/.codex`, already covered.

## Codex hook approval

Codex stores approval per hook in `~/.codex/config.toml` as `hooks.state."<hooks.json>:<event>:<group>:<handler>"` with `enabled = true`. A sync that changes a hook command (0.3.1 moved to the shim) leaves the old approval without `enabled`, and Codex silently skips the hook until it is reviewed. `verify` and `doctor` now return `warnings` (`codex-hook-untrusted`, `codex-hook-not-enabled`) for Agent Workflow hooks; they do not change `ok`. Fix: open Codex interactively, run `/hooks`, review and trust them. The installer never writes trust or uses `--dangerously-bypass-hook-trust`. A stale approval that still says `enabled = true` is not detected (the trusted hash is not recomputed).

## Validation guard (0.5.0)

The bounded pre-execution guard for recognized compound test/build commands (including `node <test file>` and commands identical to a single-command `test`/`check`/`build` script of the working directory's `package.json`) runs from one installed runtime, `shellGuard` in `<store>/runtime/gate.mjs` with `validation-guard.mjs`. It checks the project opt-out on every call, never executes or logs the command, and allows the three status-keeping forms. Clients without a pre-tool hook keep the rule as advisory text.

| Client (version checked) | Where | Shell tool / matcher | Denial | Real headless evidence (23 Nov 2026, isolated install) |
| --- | --- | --- | --- | --- |
| OpenCode V2 | plugin `shell.create.before` | every shell call | thrown `AW_VALIDATION_COMPOUND` error | earlier releases ([repairs](repairs-2026-11-13.md)) |
| Qwen Code 0.28.4 | `~/.qwen/settings.json` `PreToolUse` | `run_shell_command` | `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason` | **not run**: project hooks need interactive approval (`isProjectHooksApprovalGated`) and `QWEN_HOME` moves the sign-in. Hook runtime tested with Qwen's input shape (`tool_input.directory` honored) |
| Kimi Code 2.7.3 | `~/.kimi-code/config.toml` managed TOML block, `[[hooks]]` | `^Bash$` | same JSON (Kimi maps `permissionDecision: deny` to a block; exit 2 also works) | **not run**: hooks are read only from the global `config.toml` (plus registered plugins) and `KIMI_CODE_HOME` moves the sign-in. Hook runtime tested with Kimi's input (no `cwd` field: the hook process cwd is the session directory) |
| Command Code 1.93.2 | `~/.commandcode/settings.json` `PreToolUse`, appended after existing entries | `^SHELL$` (case-insensitive regex on the display name of `shell_command`) | same JSON; Command Code adds "Blocked by hook policy…" | **verified** with a project `.commandcode/settings.json` and `--trust`: `-p` mode does run `PreToolUse`. The model's `npm test; echo "EXIT_CODE=$?"` was blocked twice, then `npm test` ran directly; reported exit 7 |
| Pi 1.6.0 | extension `tool_call` | `bash` | `{block: true, reason}` | **verified** with `pi -e <isolated extension>`: `cd <fx> && npm test; echo …` and `cd <fx> && npm test > log 2>&1; echo …` were blocked (cd chain), then `npm test`; reported exit 7 |
| MiMo Code 0.1.16 | plugin `tool.execute.before` | `bash`, `exec_command` (`command`/`cmd`, `workdir`) | `output.cancel = true`, `cancelReason` (shown to the model as the tool output) | **verified** with `MIMOCODE_CONFIG_DIR=<isolated>`: P2 blocked `npm test; ec=$?; echo …; exit $ec`, then `npm test`, then the allowed `npm test > log 2>&1; echo "exit=$?"`; reported 7. P3 (forced `npm test; echo "exit=$?"`) same pattern. A first P2 attempt stalled after reading `package.json` and hit the 240 s timeout before any shell call; the rerun completed |
| Claude Code | `~/.claude/settings.json` `PreToolUse` (**opt-in**, `--guard claude`) | `Bash` | same JSON; Claude shows "PreToolUse:Bash hook error: AW_VALIDATION_COMPOUND…" and does not run the command | **verified** with `claude -p --settings <isolated PreToolUse>`: the model itself chained `cat package.json; npm test; echo "exit=$?"`, was blocked, then ran `npm test`; reported exit 7 |
| Codex CLI 0.171.0 | `~/.codex/hooks.json` `PreToolUse` (**opt-in**, `--guard codex`) | `Bash` (`tool_input.command`) | same JSON (documented by Codex) | **not run**: the new hook needs `/hooks` approval in the owner's Codex; `verify` reports it as `codex-hook-untrusted` (`…:pre_tool_use:N:0`) until then |
| Antigravity (agy) | — | — | — | no pre-tool guard in this release |

Why Claude and Codex are opt-in: Claude's Bash tool has no working-directory option, so the guard's "use the tool cwd instead of `cd` chains" means a separate `cd` call there; and Codex re-asks for approval of every new or changed hook. Adding or removing the `PreToolUse` entry leaves the command and the array position of the existing SessionStart/SubagentStart/PreCompact groups unchanged, so their Codex approval stays valid. 0.4.0 manifests (hook entries without `events`) upgrade in place.

Kimi caveat: Kimi can serialize its config section back to `config.toml` (`hooksToToml`); if that drops the comment markers, `verify` reports `managed-block-drift`/missing and `uninstall` refuses; remove the Agent Workflow `[[hooks]]` table by hand. Observed model behavior: Qwen chose `npm test > log 2>&1; status=$?; echo …`; that variant is not one of the three allowed forms and is blocked, so the model must retry.

This is not a general permission sandbox. No model/effort, permission, authentication, compaction or unrelated plugin setting is changed. Reviewer read-only instructions are not a permission sandbox. Global files may remain in discovery when project-disabled; a zero-load guarantee is not claimed. Long-running clients can retain previously loaded policy until reload.

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
