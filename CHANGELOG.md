# Changelog

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
