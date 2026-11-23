# Agent Workflow

Global workflow guidance for Claude Code, Codex CLI and OpenCode V2 (default), plus Qwen Code, Kimi Code, Antigravity CLI, Command Code, Pi and MiMo Code on request, with project opt-out, Rulesync generation and a reversible installer.

[Español](README.es.md) · [Architecture](docs/architecture.md) · [Compatibility and limits](docs/compatibility.md) · [Testing](docs/testing.md) · [Complete operations guide](docs/operations.md) · [Audit](docs/audit-2026-11-13.md)

This is a workflow package, not an autonomous orchestrator or a promise of faster completion. It provides a short applicability rule, the `aw-workflow` skill, optional `aw-worker`/`aw-reviewer` roles, a start command where supported, startup/compaction reminders and dependency diagnostics. Existing project instructions and user-selected models remain in charge.

## Install from the private repository

Requires Node.js 22.22.0+ and npm. Authenticate Git access to the private repository first; never paste tokens into these commands or project files.

```sh
git clone https://github.com/lomeli-dev/agent-workflow.git
cd agent-workflow
npm ci --ignore-scripts
npm run check
npm install --global . --ignore-scripts
agent-workflow install --global --dry-run
agent-workflow install --global
agent-workflow verify
```

The first install registers the CLI. The second deploys managed client files. `--clients claude,codex` restricts targets; claude, codex and opencode are the default. No `sudo`, global permission changes, model requests or dependency installs occur in startup hooks. macOS and Linux paths are supported; Windows is not a tested target.

Rulesync is pinned to 43.8.0 and generates into isolated staging, never directly into the real home. The installer maps only this package's outputs to user scope, appends owned instruction blocks and merges its hooks/plugin entry. Unrelated settings/hooks are preserved. Existing symlink destinations or conflicting files cause a refusal instead of an overwrite.

### More clients

```sh
agent-workflow sync --global --clients all --dry-run
agent-workflow sync --global --clients all
agent-workflow verify
```

`all` adds `qwen`, `kimi`, `agy`, `commandcode`, `pi` and `mimo` to the default three; a comma list picks some. A sync can add clients to an existing installation; dropping one needs `uninstall` first. Each client gets what it supports natively: rule block, the shared `~/.agents/skills/aw-workflow` skill (agy gets its own copy), roles, `aw-start` and a session hook. Kimi gets no session hook (it discards SessionStart output). Antigravity was verified with a real headless session; see the compatibility document for how to run it without the MCP hang. The [compatibility document](docs/compatibility.md#extra-clients-040) has the per-client table, the MiMo `CLAUDE.md` precedence, and what was verified natively.

**Validation guard.** Before a shell command runs, Qwen, Kimi, Command Code, Pi and MiMo (and OpenCode, as before) block a test/build command whose exit status a pipe, `;` or following `echo` would hide, and tell the model the three allowed forms. For Claude Code and Codex it is opt-in: `agent-workflow sync --global --clients ... --guard claude,codex` (`--guard none` removes it; without `--guard` a sync keeps the current choice). Codex then asks to trust the new `PreToolUse` hook once. Opted-out projects are never blocked. Details and evidence per client: [compatibility](docs/compatibility.md#validation-guard-050).

**Clients may require trusting new hooks or restarting a session.** Codex's native hook trust is not bypassed; after a `sync` that changes hooks, re-approve them in Codex with `/hooks` (`verify` warns with `codex-hook-untrusted`/`codex-hook-not-enabled`). `verify` proves files/registrations, not that a running client reloaded or executed them. See the compatibility document for evidence levels.

## Disable for a project

```sh
agent-workflow disable --project /path/to/project
agent-workflow status --project /path/to/project --json
agent-workflow enable --project /path/to/project
```

These commands write a small `.agent-workflow.json` at the detected repository root (or the supplied directory outside Git):

```json
{"schemaVersion":1,"enabled":false}
```

You can commit that file as a team choice or keep it local. Inside Git, the nearest config up to the repository root wins. Outside Git, ancestors are searched up to the filesystem root; malformed config disables this workflow rather than guessing. Restart/reload a session that cached earlier policy state. Global rules/skills can remain discoverable: opt-out gates our workflow behavior, not the IDE's global discovery or unrelated integrations. No changes to the rest of the project's rules are made.

## Select and prepare tools

### Optional lean Claude session

If a task does not need your usual MCP servers, start an explicitly isolated
Claude session without changing your normal configuration:

```sh
agent-workflow claude-lean --
agent-workflow claude-lean -- --print "Explain this project"
agent-workflow claude-lean --mcp-file /path/to/selected-mcp.json --
```

Without `--mcp-file`, **no configured MCP servers are available in that
session**. With it, only servers in the explicitly selected Claude MCP JSON
file are loaded; manage its credentials separately. Agent Workflow does not
edit the file, user settings, models, approvals or other sessions. Claude Code
must be installed and authenticated. Forward Claude options after `--`;
specify the MCP file before it. Restart normally with `claude` to restore the
usual server set. Tool search and other client capabilities remain subject to
Claude's own behavior and permissions.

An exploratory three-sample hello-world comparison on one Mac found a lower
median initial context with an empty MCP list, but the set of tools changed
and caching/startup varied. This is not a guarantee of lower bills or equal
capability. See [context study](docs/context-study.md).

**The default browser tool is Vercel agent-browser 0.43.0.** `setup --profile web --apply` installs only this CLI, without downloading Chrome. `--all` includes agent-browser; Playwright engine/CLI/MCP and DevTools are explicit alternatives. Existing installations are retained.

```sh
agent-workflow setup --profile web --apply
agent-workflow exec --tool agent-browser -- skills get core
```

**This is agent guidance, not enforced by the generic `exec` passthrough.** The workflow skill routes browser tasks to agent-browser with an existing Chrome/Chromium executable and a separate headless session. Run its installed-version guide first. If no compatible browser exists, report the requirement; downloading one remains explicit via `agent-workflow exec --tool agent-browser -- install`. Do not use personal profiles or attach to the user's open browser by default. Close the task's named session afterwards.


```sh
agent-workflow setup --list
agent-workflow setup --interactive --apply
agent-workflow setup --tools serena,codegraph --apply
agent-workflow setup --profile web --apply
agent-workflow setup --all --apply
agent-workflow doctor --json
```

**Playwright with Chromium is explicit-only:** `--all`, interactive `all` and the `web` profile exclude the browser-engine module. Install it separately with `agent-workflow setup --tools playwright --apply`. That command invokes `playwright install chromium`, which downloads the managed browser binaries. Playwright CLI/MCP remain separate choices; excluding the engine does not remove an existing installation or prevent a browser tool from requesting a runtime later.

Without `--apply`, setup only previews. The interactive menu accepts numbers, names or `all`; empty input cancels. Profiles: `lsp`, `code`, `web`, `docs`, `delivery`. The 17-module catalog includes six language servers, ast-grep, Serena, CodeGraph, Vercel agent-browser, Playwright engine/CLI/MCP, Chrome DevTools MCP, Context7, GitHub CLI and Gitleaks. **No standalone linter, formatter or persistent-task service is included.** Language servers may themselves expose formatting capabilities; the package does not activate them or rewrite source files.

Responding installations are reused and their actual versions reported. Missing tools use pinned packages in the managed user directory. Node/npm are required; Go, uv and a Rust toolchain are prerequisites for their corresponding modules. Missing prerequisites are reported without bootstrapping an entire development environment. No shell profile is edited and no dependency installs run at session startup.

### Connect selected MCPs to a project

```sh
agent-workflow connect --project /path/to/project --tools serena,codegraph --dry-run
agent-workflow connect --project /path/to/project --tools serena,codegraph
agent-workflow disconnect --project /path/to/project
agent-workflow exec --tool ast-grep -- --version
```

Installation is global; MCP registration is explicit and project-scoped. Pass the repository root: nested paths are rejected to prevent silently bypassing their opt-out. Use the same `--clients` set when disconnecting a subset connection. Default MCP connections are Serena, CodeGraph and Context7. Agent-browser is used through the CLI/skill, so it adds no default MCP tool inventory. Supported optional MCP names: `serena`, `codegraph`, `playwright-mcp`, `devtools`, `context7`. `--clients claude,codex,opencode` selects native config targets (all three by default). Restart/reload and approve project tools in each client. Existing entries and comments are preserved; name collisions or edits to owned entries refuse rather than overwrite. Disconnect project registrations before uninstalling the package.

`setup` alone does not register MCPs or enable native client LSP plugins. See [tool selection and evidence](docs/tools.md) for routing, prerequisites and integration limits.

## Upgrade, verify, remove

```sh
# Fetch and inspect the intended revision; keep local work before switching.
git fetch origin --tags
git log --oneline HEAD..origin/main
git diff HEAD..origin/main
# After review, fast-forward only; divergence is a stop, not a reset.
git merge --ff-only origin/main
npm ci --ignore-scripts
npm run check
npm install --global . --ignore-scripts
agent-workflow sync --global --dry-run
agent-workflow sync --global
agent-workflow verify
agent-workflow uninstall --global --dry-run
agent-workflow uninstall --global
npm uninstall --global @lomeli-dev/agent-workflow
```

Updates/uninstall refuse changed owned files or hook definitions. Preserve/reconcile your edit before proceeding. Other additions outside owned blocks/entries are retained. The private ownership manifest keeps original config locally for reversal; it may contain private user settings and is never committed or uploaded. Optional downloaded tools and empty directories are retained on uninstall to avoid deleting shared resources. Adding clients is a `sync --clients ...`; removing clients requires uninstall/reinstall.

## Development

Edit `.rulesync`, not generated output. `npm run build` regenerates; `npm test` tests isolated installs, opt-out, preservation and failures; `npm run check` adds package/document checks. Rulesync build uses no model and never touches real client homes. `--user-root` redirects the install for safe previews/tests without overriding HOME.

```sh
mkdir -p /path/to/isolated-user
node bin/agent-workflow.mjs install --global --user-root /path/to/isolated-user
node bin/agent-workflow.mjs verify --user-root /path/to/isolated-user
node bin/agent-workflow.mjs uninstall --global --user-root /path/to/isolated-user
```

No model or effort is forced, no MCP server is added by the global workflow install, and no automatic project-memory writer is started. The coordinator uses an existing memory-sesion installation if the project and user call for it. Workers return candidate lessons to that coordinator.

[Native client behavioral trial](docs/native-trial-2026-11-13.md): real implementation, opt-out, roles, MCP and browser checks, including remaining limitations.

Version 0.5.0 extends the validation guard to Qwen, Kimi, Command Code, Pi and MiMo, and makes it opt-in for Claude and Codex (`--guard`); see the [changelog](CHANGELOG.md).

Version 0.4.0 adds six opt-in clients, warns about unapproved Codex hooks, extends the OpenCode guard to `node <test file>` and the project test script, and fixes an uninstall failure on compact JSON; see the [changelog](CHANGELOG.md).

Version 0.3.1 makes `uninstall` keep edits made after a `sync`, runs hooks through a stable Node shim, reports outdated installs in `verify`, handles worktrees (`disconnect --prune`) and aligns the OpenCode guard with the rule; see the [changelog](CHANGELOG.md).

Version 0.2.3 adds a native OpenCode compound-validation guard and an explicit JS/TS module-symbol fallback. See [verified repairs](docs/repairs-2026-11-13.md). CodeGraph setup also checks/installs the selected TypeScript prerequisite; no browser is added by that dependency.
