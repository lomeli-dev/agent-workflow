# Changelog

## 0.7.1

- **Fix: `dsh --profile web` broke the next sync.** dsh's config editor (`dsh-config-editor`, `yaml` 2.9.1) rewrites `cordis.patch.yml` when a setting is saved. It folds every double-quoted `!!js` scalar at 80 columns and appends its own row (`ui-settings-general`) at the end of the list, which was inside our markers. 0.7.0 compared the block by bytes, so `verify` reported `managed-block-drift` and `sync` aborted for every client. Now:
  - The dsh rows are written as `!!js |-` literal blocks, which the editor keeps byte for byte.
  - A block whose bytes changed is compared by content, parsed with `js-yaml` 4.3.2 (new pinned dependency, the version dsh's loader uses) and the same `!!js` tag. If our rows are the same, it is adopted: `verify` is ok with a notice, and `sync` records it (`dataHash`) and moves the rows dsh added inside the block right after it. `uninstall` keeps those rows.
  - A real change to our rows is still drift.
- **A drift in one file no longer aborts the sync.** On an existing installation, a file that cannot be updated is skipped and listed in `skipped` with its error and the exact fix (exit 1). Its manifest entry is kept and every other file is synced. A first install is still all-or-nothing.
- **Docs.** The cause, the fix, why `cordis-plugin-include` is not used (it writes changes back to its file too) and isolated evidence with the real `dsh --profile web` are in the compatibility document. A short note is in both operations guides. The rewritten file from the owner's Mac is a test fixture, with only the hooks path replaced.

## 0.7.0

- **`--all-in`.** `install`/`sync --global --all-in` = `--trust-codex` + `--dsh-plugins` + `--agy-allow`, each only when its client is in `--clients`; `connect --all-in` = `--approve` + `--exclude`. Every step is opt-in, recorded and reversed by `uninstall`/`disconnect`; a later sync or connect keeps what was recorded.
- **`--dsh-plugins`.** For each profile in `<DSH_HOME>/profiles` without the hooks bridge and its peer, runs `dsh plugin --profile P add -w @deepseek-ai/dsh-hooks-claude-code@<v> @deepseek-ai/dsh-hook-protocol@<v>` (`v` from `dsh --version`, or the peer version the user's bridge pins) before writing files, so the profile block mounts the hooks row in the same sync. The manifest records the packages (`dshPlugins`); `uninstall` runs `dsh plugin --profile P remove -w` for those still at the recorded version, before touching files. A package present at another version is never replaced; a failed add removes what it added. The child gets `DSH_HOME` but keeps `HOME` (dsh's corepack pnpm lives there). `AGENT_WORKFLOW_DSH=PATH|none`. The API key is never handled.
- **`--agy-allow`.** Owned `permissions.allow` entries `mcp(agent-workflow-mcp_aw-serena/*)`, `…aw-codegraph/*`, `…aw-context7/*` in `~/.gemini/antigravity-cli/settings.json` (manifest `kind: "allow"`); entries added by hand are adopted, never duplicated; `verify` reports `allow-entry-missing`; `uninstall` removes them.
- **`connect --exclude`.** Adds the generated paths that are untracked and not ignored yet (`git check-ignore --no-index`, so hand-written lines and `.gitignore` count) to the repository's `info/exclude` (`git rev-parse --git-path`, shared by worktrees) in a `# agent-workflow:begin` block; the receipt records it, `disconnect` removes it, an edited block stops `disconnect`.
- **Kimi folder trust stays manual.** Kimi 2.7.3 keeps trust in internal files without a CLI command; the only persistent documented switch (`[workspace] require_trust = false`) applies to every folder. Documented, not automated.
- **Docs.** "Install everything in 5 minutes" / «Instalar todo en 5 minutos» at the top of both READMEs (requirements, clone, `sync --clients all --all-in`, what stays manual, project MCP with `.git/info/exclude`, canary and guard checks, update/disable/uninstall), with the manual commands kept as reference. Help text now names `.dsh/agent-workflow-mcp.json` (it still said the 0.6.0 `--patch` file). Isolated evidence with the real dsh 0.2.2-rc.5, a copy of the owner's agy settings and a copy of a hand-edited `info/exclude` in the compatibility document.

## 0.6.1

- **Kimi project MCP works in `kimi -p`.** Kimi Code 2.7.3 builds a session's tool list when it binds the agent profile, a few milliseconds after starting the MCP servers; our servers answered later (0.1–0.9 s), so the owner's real runs had no `aw-*` tools although Kimi had connected them. `agent-workflow mcp` now starts a light front (`lib/mcp-front.mjs`, Node builtins and `gate.mjs` only; `bin` loads everything else lazily) that answers `initialize` and the first `tools/list` from `<store>/mcp-cache/<tool>.json` (the real server's last answers for this package version and the requested protocol version) and passes every message to the real server; its replies refresh the cache, and changed tools send `notifications/tools/list_changed`. Opted-out projects never use the cache. `connect --approve` with Kimi warms it. Folder trust is still Kimi's (`KIMI_CODE_TRUST_WORKSPACE=1` or "Trust this folder").
- **dsh loads project MCP without `--patch`.** dsh has no project configuration layer, so each profile block written by `sync` now holds one `@deepseek-ai/dsh-mcp-client` row per MCP module, enabled only when the directory dsh starts in has `.dsh/agent-workflow-mcp.json` listing that server (`!!js` reads its `command`/`args`). `connect` writes that file (same `mcpServers` shape as `.mcp.json`) and retires the 0.6.0 `.dsh/agent-workflow.cordis.yml` when it is unedited. The rows go to every profile (they need only dsh itself); the hooks row still needs the bridge and its peer. A profile whose user layer is not a block list is skipped with a notice instead of failing the sync.
- **Docs.** A single "Client status" table (English in the compatibility document, Spanish in the operations guide) with what works, what does not and why; real-home evidence from 23 Nov 2026 (guard, project MCP in nine clients, opt-out, subagents, reviewer, compaction); Kimi's guard is verified in the owner's home; the dsh web profile connects the servers, model use through the web UI is not tested.

## 0.6.0

- **DeepSeek Harness (`dsh`) client** (in `--clients all`). Rule block in `~/.dsh/AGENTS.md` (`$DSH_HOME`), `aw-start` skill in `~/.dsh/skills` (the shared `aw-workflow` arrives through `~/.agents/skills`, which dsh scans), and hooks through the official `@deepseek-ai/dsh-hooks-claude-code` bridge: Agent Workflow owns `<store>/dsh/hooks.json` (SessionStart and SubagentStart context, PreToolUse guard on `bash`) and mounts the bridge with an `insert` row in a managed YAML block at the end of each profile's `cordis.patch.yml` (never `cordis.yml`; a lone `[]` is replaced and restored; other layouts are never edited). The block goes only to profiles that contain the bridge **and** its peer `@deepseek-ai/dsh-hook-protocol` at the same version: dsh 0.2.2-rc.5 does not ship the peer and pnpm does not add it, so with the bridge alone the entry does not activate. Other profiles get a notice with `dsh plugin --profile <p> add -w @deepseek-ai/dsh-hooks-claude-code@<v> @deepseek-ai/dsh-hook-protocol@<v>`; nothing is installed into profiles. dsh has no file-defined subagents or commands.
- **Antigravity guard.** `agy` gets a `PreToolUse` matcher group (`run_command`) in its `agent-workflow` hooks group; the runtime reads `toolCall.args.CommandLine`/`Cwd` and answers `{decision: "deny", reason}`. 0.5.x installs gain it on sync without moving the SessionStart hook.
- **Claude guard on by default; Codex with `--trust-codex`.** Without `--guard` and without a recorded choice (new installs, 0.5.x installs that never enabled it), the Claude `PreToolUse` guard is installed, and the Codex one when `--trust-codex` approves it. The choice is recorded in the manifest (`guard`); `--guard claude,codex|none` still sets it explicitly and a sync keeps it. A 50-command battery of realistic agent commands (pipes in inspection commands, direct validations, status-keeping and status-hiding forms) through the installed Claude and Codex hooks gave 0 false positives and 0 false negatives.
- **Guard and rule changes.** A leading `cd DIR &&` is allowed before a validation (Claude's Bash has no working-directory option; the status stays visible). `CMD | tail; exit ${PIPESTATUS[0]}` is **no longer allowed**: Claude Code and Codex run commands in zsh on macOS, which has no `PIPESTATUS`, so that form exited 0 and hid a failing test in a real Claude run. The rule, skill reference and guard reason now name only `set -o pipefail; CMD | tail` and `CMD > log 2>&1; echo "exit=$?"`; every client's rule block changes on sync.
- **Project MCP in every extra client.** `connect --clients LIST|all` writes `aw-*` entries for Qwen (`.qwen/settings.json`), Kimi and Command Code (`.mcp.json`, shared with Claude), Pi (`.pi/mcp.json`), MiMo (`mimocode.json(c)`), Antigravity (workspace plugin `.agents/plugins/agent-workflow-mcp`) and dsh (`.dsh/agent-workflow.cordis.yml`, loaded with `--patch`), with the same receipts, ownership, collision refusal, restore and worktree handling. Receipts are one entry per file (`schemaVersion: 2`); 0.5.x receipts still disconnect. `--approve` (opt-in) uses the client's own non-interactive approval where it exists (Claude `enabledMcpjsonServers` in `.claude/settings.local.json`, `qwen mcp approve`); the result lists what Kimi, Pi, agy, Codex and dsh still need. Real runs in every one of these clients called `aw-codegraph`'s `agent_workflow_symbols` from a fixture. The MCP tool environment now includes the launcher's Node directory, because Kimi and dsh start servers with a scrubbed environment and npm modules start with `#!/usr/bin/env node`.
- **Reviewer role.** Codex 0.171 ignores the role's `sandbox_mode` (the subagent inherits the parent sandbox): the role text says so and points to `codex exec -s read-only` for a read-only review, and `install`/`verify` print a notice. OpenCode and MiMo reviewers also deny `notebook_edit` and use `mode: all`, so `mimo run --agent aw-reviewer` runs the reviewer instead of falling back to the default agent (verified with MiMo 0.1.16).
- **Docs.** Qwen 0.28.4 runs SubagentStart but does not pass its text to the subagent; Claude's PreCompact `systemMessage` enters the transcript after a manual `/compact`. Recommend `.git/info/exclude` for machine-local project registrations.

## 0.5.1

- **`agent-workflow trust --client codex [--dry-run]`.** Trusts the Agent Workflow Codex hooks the way the Codex TUI `/hooks` does: it starts `codex app-server`, reads `hooks/list` (`currentHash`, `trustStatus`) and sends `config/batchWrite` with a `hooks.state` upsert of `trusted_hash`, so Codex writes its own `config.toml`. Only hooks of the user `hooks.json` whose command is exactly the Agent Workflow shim + store runtime are selected; other hooks (Orca, warp, yours) and their trust are untouched, and `enabled` is never changed. Shows the state before and after. If `codex` is missing or app-server fails, it exits 1 and changes nothing. No model request; `--dangerously-bypass-hook-trust` is never used.
- **`install`/`sync --global --trust-codex`** (opt-in) runs that step right after writing `hooks.json`. Without the flag nothing changes. If trust fails, the sync stays applied and the command exits 1 with `codexTrust.error`.
- **Fix: false `codex-hook-not-enabled`.** Codex treats a missing `enabled` as enabled; 0.5.0 warned whenever `enabled = true` was absent, even for trusted hooks Codex ran. `verify`/`doctor` now take `trustStatus` and `enabled` from `codex app-server` when Codex is available (`codexHookTrust.source`), warning with `codex-hook-untrusted`, `codex-hook-modified` (stale hash, now detected) or `codex-hook-disabled`. Without Codex they fall back to `config.toml` with the same rule (a missing `trusted_hash` or `enabled = false`); a stale hash is not detectable there (`hashChecked: false`). `AGENT_WORKFLOW_CODEX=PATH|none` selects the executable or forces the fallback.
- With `--user-root`, the Codex child gets `HOME` and `CODEX_HOME` pointed at that root. Tests use a fake `codex` that speaks the protocol; a run with the real Codex 0.171.0 on an isolated root is recorded in the compatibility document.

## 0.5.0

- **Validation guard in more clients.** The guard that OpenCode already had (`AW_VALIDATION_COMPOUND`) now blocks, before the shell runs, a test/build command whose exit status a pipe, `;`, `&&` or a following `echo` would hide, in Qwen Code, Kimi Code, Command Code, Pi and MiMo Code. One source of truth: every client calls `shellGuard` of the installed runtime (`gate.mjs` + `validation-guard.mjs`), which also honors the project opt-out on every call. The three status-keeping forms stay allowed (`set -o pipefail; CMD | tail`, `CMD | tail; exit ${PIPESTATUS[0]}`, `CMD > log 2>&1; echo "exit=$?"`).
  - Qwen (`run_shell_command`) and Command Code (`^SHELL$`): a `PreToolUse` entry in their `settings.json`, appended after the user's entries (Orca's `.*` entry in Command Code is not touched or reordered). The answer is `hookSpecificOutput.permissionDecision: "deny"` with the reason.
  - Kimi (`^Bash$`): Kimi has no JSON settings, so the `[[hooks]]` entry goes in a TOML managed block (`# agent-workflow:begin` … `# agent-workflow:end`) at the end of `~/.kimi-code/config.toml`. Invalid TOML is never overwritten; an edited block is drift for `verify`/`sync`/`uninstall`.
  - Pi: the extension adds a `tool_call` handler that returns `{block: true, reason}` for `bash`.
  - MiMo: the plugin adds `tool.execute.before`, which cancels `bash`/`exec_command` with `cancel`/`cancelReason`.
- **Claude Code and Codex: opt-in.** `--guard claude,codex` adds the same `PreToolUse` entry (matcher `Bash`) to `settings.json`/`hooks.json`; `--guard none` removes it; a sync without `--guard` keeps the current choice. The existing reminder hooks keep their command and position, so Codex keeps their approval; the new `PreToolUse` hook needs `/hooks` approval once (`verify` warns). Opt-in because Claude's Bash tool has no working-directory option (a `cd dir && npm test` chain is blocked and needs a separate `cd`), and Codex needs that extra approval.
- **Manifest.** Hook entries record their `events`; entries from 0.4.0 (without the list) keep working and a sync adds `PreToolUse` without rewriting or moving their other hooks. Block entries record `syntax` (`toml` for the Kimi config).
- OpenCode's plugin now uses the same `shellGuard` helper (behavior unchanged).
- Real headless runs with an isolated install (project-level hooks, `pi -e`, `MIMOCODE_CONFIG_DIR`, `claude --settings`): Claude, Command Code, Pi and MiMo blocked the model's own compound command and then ran `npm test` directly or an allowed form, reporting exit 7. Qwen, Kimi and Codex are covered by hook-runtime tests only; see the compatibility document for what remains to be run after the global sync.

## 0.4.0

- **Six opt-in clients.** `--clients all` (or a list) adds Qwen Code, Kimi Code, Antigravity CLI (`agy`), Command Code, Pi and MiMo Code to the default claude, codex and opencode. Each gets a managed rule block in its global instruction file, the shared `~/.agents/skills/aw-workflow` skill (agy gets its own copy in `~/.gemini/config/skills`), the Rulesync-generated `aw-worker`/`aw-reviewer` and `aw-start` where the client has them, and a session hook in its native shape: Claude-shaped JSON for Qwen (SessionStart, SubagentStart, PreCompact) and Command Code, `injectSteps` for agy, a Pi extension and a MiMo plugin. Kimi gets no hook (it discards SessionStart output). Same contract as before: manifest, drift checks, `verify` with `outdated`, and `uninstall` that removes only owned parts. Real headless sessions confirmed agy and MiMo (rule, hook text and opt-out) and the Pi extension; the rest is file/config evidence until the global sync. See the compatibility document.
- **MiMo keeps reading `CLAUDE.md`.** MiMo loads only the first of `~/.config/mimocode/AGENTS.md` and `~/.claude/CLAUDE.md`, so the installer writes its own `AGENTS.md` only when it already exists or there is no `CLAUDE.md`.
- **`sync` can add clients** to an existing installation; dropping one still requires `uninstall` first. `--clients` rejects unknown names and duplicates.
- **Codex hook approval.** `verify`/`doctor` add `warnings` (`codex-hook-untrusted`, `codex-hook-not-enabled`) when Codex has not approved the Agent Workflow hooks, read from `~/.codex/config.toml` without changing it. After a sync that changes hooks, re-approve them with `/hooks`.
- **OpenCode guard** also recognizes `node <test file>` and commands identical to a single-command `test`/`check`/`build` script of the working directory's `package.json` (read, never executed); `node test.js; echo "exit=$?"` is now blocked.
- **Fix:** `uninstall` failed with "Invalid JSON" when an owned hook was the last element of a compact JSON array after a user entry (a jsonc-parser 3.3.1 removal bug); removal now falls back to cutting the node and its separator.
- Rulesync generation stays in project mode inside staging; `rulesync generate --global` is documented as unsafe (it writes to the real home and ignores `--output-roots`).

## 0.3.1

- **Uninstall keeps your edits.** After a `sync`, `uninstall` restored the snapshot taken at the first install and wiped later edits to `CLAUDE.md`, `AGENTS.md`, `settings.json`, `hooks.json` and `opencode.jsonc` (deleting files that did not exist before). It now removes only the owned block, hooks and plugin entry; the snapshot is reused only when the file is otherwise untouched.
- **Stable hook Node.** Hooks call a generated shim, `<store>/bin/node`, instead of an nvm-versioned Node. `verify` and `doctor` report `hook-node-missing`/`hook-runtime-missing` with the `npm link` + `sync` repair; the first `sync` migrates older installs. See "After switching Node" in the operations guide.
- **`verify` detects outdated installs**: `status: "outdated"` lists files that differ from what this package would install, with installed and package versions.
- **Worktrees.** The MCP launcher serves the worktree it starts in when it belongs to the registered repository. New `disconnect --prune` forgets receipts of deleted projects; `uninstall` names what to run. Documented that an untracked `.agent-workflow.json` does not reach worktrees.
- **OpenCode guard matches the rule.** Allows `set -o pipefail; CMD | tail`, `CMD | tail; exit ${PIPESTATUS[0]}` and `CMD > log 2>&1; echo "exit=$?"`; recognizes `npx`/`pnpm exec`, `uv run`, gradle, `make -C` and `bash -c` validations. The rule text names the same forms.
- `aw-reviewer` asks each client to deny edits (Claude, Codex, OpenCode); `doctor` no longer probes the personal `opencode2` alias.

## 0.3.0

- Add opt-in `claude-lean` sessions with an empty or explicitly selected MCP configuration, without changing normal client settings.
- Document cross-client trials, context measurements, and Spanish testing and context guides; keep measured limits explicit.
- Add focused tests for argument forwarding, MCP selection, error handling and child exit status.

## 0.2.3

- Native OpenCode V2 shell hook rejects recognizable compound validations before execution, with per-call project opt-out.
- CodeGraph integration exposes a separate TypeScript-parser symbol tool for original JS/TS module files and warns on empty native graph results; setup resolves the parser prerequisite.
- Native verification of guarded failure status, `.mjs` symbol lookup, and manual compaction/resume with a preserved synthetic checkpoint.
- Added bounds/opt-out/AST tests and documented the limits of shell recognition and symbol-only fallback.

## 0.2.2

- Real native-client behavioral trials: implementation, project opt-out, roles, MCP calls and browser interaction, with synthetic evidence only.
- Stronger validation exit-status guidance and serialized shared-registry mutations.
- Documented CodeGraph 0.21.0 `.mjs` coverage gap and remaining model-compliance limits.
- Reproducible intentionally failing project seed; native trial reports distinguish observed behavior from guarantees.

## 0.2.1

- Audit-driven preservation fixes for comments in hook/plugin arrays, removed rules, and changed OpenCode config paths.
- Project MCP receipt validation, backup consistency checks, missing/duplicate block refusal and explicit root-only registrations.
- Reject inherited property names in tool selection and disabled MCP dispatch; reject special-file opt-out configuration.
- Minimum Node 22.22.0 reflected in metadata/docs/CI; generated untracked files checked.
- Complete English/Spanish operations guides and explicit historical/current evidence boundaries.

## 0.2.0

- Selectable optional tools with interactive, named, profile and all modes.
- Project-scoped reversible MCP connections for Claude, Codex and OpenCode V2.
- Vercel agent-browser becomes the default web tool, reusing an existing browser; Playwright variants and DevTools remain explicit alternatives.
- Live fixture probes for LSP, MCP and browser CLI, with their limits documented.

## 0.1.0

- Canonical Rulesync rule, workflow skill, optional worker/reviewer roles and start command.
- Reversible global deployment to Claude, Codex and OpenCode V2 with isolated generation and user-edit preservation.
- Explicit project enable/disable and bounded startup/compaction reminders.
- Local tool diagnostics and opt-in, pinned managed dependency preparation.
- Installer/gate/drift tests and packed-artifact smoke test; no model requests or inferred speedup.

Native discovery, hook trust, project opt-out and actual model behavior are separate states. This version does not promise universal plugins, hidden global skills when disabled, automatic LSP wiring or automatic background orchestration.
