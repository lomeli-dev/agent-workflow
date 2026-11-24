# Agent Workflow

Global workflow guidance for Claude Code, Codex CLI and OpenCode V2 (default), plus Qwen Code, Kimi Code, Antigravity CLI, Command Code, Pi, MiMo Code and DeepSeek Harness (dsh) on request, with project opt-out, Rulesync generation and a reversible installer.

[Español](README.es.md) · [Install everything in 5 minutes](#install-everything-in-5-minutes) · [Architecture](docs/architecture.md) · [Compatibility and limits](docs/compatibility.md) · [Testing](docs/testing.md) · [Complete operations guide](docs/operations.md) · [Audit](docs/audit-2026-11-13.md)

This is a workflow package, not an autonomous orchestrator or a promise of faster completion. It provides a short applicability rule, the `aw-workflow` skill, optional `aw-worker`/`aw-reviewer` roles, a start command where supported, startup/compaction reminders and dependency diagnostics. Existing project instructions and user-selected models remain in charge.

## Install everything in 5 minutes

For a clean Mac that already has some of the clients installed. Each step is a command and what it does; details follow below and in the [operations guide](docs/operations.md).

**1. Requirements.** Node.js 22.22.0+ (`node --version`), npm, Git with access to the private repository, and the clients you want to use installed and signed in (open each once). For dsh, boot a profile once (`dsh headless`) so `~/.dsh/profiles/headless` exists.

**2. Clone and install the CLI.**

```sh
git clone https://github.com/lomeli-dev/agent-workflow.git
cd agent-workflow
npm ci --ignore-scripts                    # pinned dependencies, no install scripts
npm install --global . --ignore-scripts    # registers the agent-workflow command (links this folder)
```

For development, use `npm link` instead of the last line. Either way the command points at this clone: do not move or delete it.

**3. Install into every client.**

```sh
agent-workflow sync --global --clients all --all-in --dry-run   # files it would change and steps it would run
agent-workflow sync --global --clients all --all-in             # install
agent-workflow verify                                           # check files, registrations and hooks
```

On a new installation `install --global` and `sync --global` do the same; `sync` also updates and adds clients. `--all-in` (0.7.0) combines three opt-in steps, each only when its client is in `--clients`:

- `--trust-codex`: trusts only the Agent Workflow hooks in Codex, the same as approving them in `/hooks` (through `codex app-server`; other hooks are untouched).
- `--dsh-plugins`: in each dsh profile that lacks the hooks bridge, runs `dsh plugin --profile <p> add -w @deepseek-ai/dsh-hooks-claude-code@<v> @deepseek-ai/dsh-hook-protocol@<v>` with the version from `dsh --version`, and records it so `uninstall` removes it. A package you already have at another version is never replaced.
- `--agy-allow`: adds `mcp(agent-workflow-mcp_aw-serena/*)`, `mcp(agent-workflow-mcp_aw-codegraph/*)` and `mcp(agent-workflow-mcp_aw-context7/*)` to `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`, without duplicating the ones you have.

Validation guard after this step: always Qwen, Kimi, agy, Command Code, Pi, MiMo, dsh and OpenCode; Claude by default; Codex because `--all-in` includes `--trust-codex` (on a new installation only: if you installed without it, add `--guard claude,codex`). Later syncs keep that choice and what `--dsh-plugins` and `--agy-allow` recorded.

**4. What stays manual.**

- **dsh key.** dsh reads `DEEPSEEK_API_KEY`; Agent Workflow never touches it. Keep it in the macOS Keychain (the first line prompts without echo, so it stays out of your history) and pass it only to dsh with a function in `~/.zshrc`:

  ```sh
  security add-generic-password -a "$USER" -s deepseek-api-key -w
  dsh() { DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-$(security find-generic-password -s deepseek-api-key -w 2>/dev/null)}" command dsh "$@"; }
  ```

- **Kimi folder trust.** Kimi does not start project MCP servers in an untrusted folder. Choose "Trust this folder" the first time you open `kimi` in the project, or run `KIMI_CODE_TRUST_WORKSPACE=1 kimi -p "..."` (that process only). There is no official command that stores trust for one folder; `[workspace] require_trust = false` in `~/.kimi-code/config.toml` removes it for every folder, so the installer does not do it.
- **agy hangs headless.** If `agy -p` waits until its timeout and its log (`~/.gemini/antigravity-cli/log/cli-*.log`) says `MCP: N server(s) still connecting`, those are servers with `"disabled": true` in `~/.gemini/config/mcp_config.json` that agy 1.5.15 still waits for: remove those entries (your call; Agent Workflow does not edit that file).
- **Codex after another `sync`.** If a sync changes the hooks, repeat it with `--trust-codex` (or `--all-in`) or run `agent-workflow trust --client codex`. `verify` warns with `codex-hook-untrusted` or `codex-hook-modified`.
- **Codex and Pi per project.** Codex loads `.codex/config.toml` only in a trusted project (accept when it asks); Pi reads `.pi/mcp.json` once the project is trusted or with `pi -a`.

Without `--all-in`, the same by hand: `dsh plugin --profile <headless|web> add -w @deepseek-ai/dsh-hooks-claude-code@$(dsh --version) @deepseek-ai/dsh-hook-protocol@$(dsh --version)`, then `agent-workflow sync --global` (`-w` is pnpm's `--workspace-root`: each profile is a pnpm workspace root and pnpm refuses to add packages there without it); and in `~/.gemini/antigravity-cli/settings.json`, merged with what is there, `{"permissions": {"allow": ["mcp(agent-workflow-mcp_aw-serena/*)", "mcp(agent-workflow-mcp_aw-codegraph/*)", "mcp(agent-workflow-mcp_aw-context7/*)"]}}`.

**5. Turn on Serena, CodeGraph and Context7 in a project.**

```sh
agent-workflow connect --project /path/to/root --clients all --all-in --dry-run   # files it would write and what it would exclude
agent-workflow connect --project /path/to/root --clients all --all-in
```

Use the repository root and reload each client afterwards. `connect --all-in` is `--approve` (each client's official approval: Claude `enabledMcpjsonServers`, `qwen mcp approve`, and the cache Kimi needs) plus `--exclude` (adds the generated paths that are neither tracked nor already ignored to `$(git rev-parse --git-path info/exclude)`, in a managed block that `disconnect` removes). The paths are `.mcp.json`, `.codex/config.toml`, `opencode.jsonc` (or `opencode.json` if it exists), `.qwen/settings.json`, `.agents/plugins/agent-workflow-mcp/`, `.pi/mcp.json`, `mimocode.json` (or the variant that exists), `.dsh/agent-workflow-mcp.json` and `.claude/settings.local.json`. Lines you already have, even `.codex/` or without a leading `/`, are detected with `git check-ignore` and not duplicated.

By hand (without `--exclude`), an equivalent one-liner that does not duplicate lines and works in worktrees:

```sh
cd /path/to/root && x="$(git rev-parse --git-path info/exclude)" && mkdir -p "$(dirname "$x")" && for p in /.mcp.json /.codex/config.toml /opencode.jsonc /.qwen/settings.json /.agents/plugins/agent-workflow-mcp/ /.pi/mcp.json /mimocode.json /.dsh/agent-workflow-mcp.json /.claude/settings.local.json; do grep -qxF "$p" "$x" 2>/dev/null || echo "$p" >> "$x"; done
```

If your team tracks any of those files, drop it from the list: `info/exclude` does not affect tracked files.

**6. Check that it works.** In a new session of each client, inside a project:

- Canary: "Without running anything: in your session instructions, what is the word right after "for substantial coding tasks load"? Answer with that word only." Expected: `aw-workflow`. Kimi, OpenCode and Command Code in `-p` have no session hook; ask about the rule instead: "Without running anything: in your global instructions, which word comes right after "Use" in the sentence that continues "for a substantial coding task that needs coordination"? Answer with that word only." (also `aw-workflow`).
- Guard: create a project whose test fails with 7 and ask for the compound command.

  ```sh
  mkdir -p /tmp/aw-prueba && cd /tmp/aw-prueba && git init -q && npm init -y > /dev/null && npm pkg set scripts.test="node -e 'process.exit(7)'"
  ```

  "Run exactly this shell command in one tool call, without changing it: npm test; echo "exit=$?" . Then tell me whether the tests pass and with which exit code." Expected: an `AW_VALIDATION_COMPOUND` block, then `npm test` run directly (or an allowed form) with exit 7.

What works in each client and what does not: [client status](docs/compatibility.md#client-status-061) (Spanish: [estado por cliente](docs/operaciones.es.md#estado-por-cliente-061)).

**7. Update, disable and uninstall.**

```sh
# Update (from the clone)
git pull --ff-only
npm ci --ignore-scripts
npm install --global . --ignore-scripts         # or npm link
agent-workflow sync --global --clients all --all-in
agent-workflow verify

# Disable the workflow in a project (enable reverts it)
agent-workflow disable --project /path/to/root

# Uninstall: disconnect every connected project first
agent-workflow disconnect --project /path/to/root --clients all
agent-workflow uninstall --global --dry-run
agent-workflow uninstall --global
npm uninstall --global @lomeli-dev/agent-workflow
```

Before uninstalling, back up your configurations (`~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.gemini`, `~/.kimi-code`, `~/.dsh`…). `uninstall` removes only what it owns, including the agy permissions and the dsh packages added by `--dsh-plugins`, and stops if you edited something it owns. In the update sync the client list cannot be smaller than the installed one.

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

`all` adds `qwen`, `kimi`, `agy`, `commandcode`, `pi`, `mimo` and `dsh` to the default three; a comma list picks some. A sync can add clients to an existing installation; dropping one needs `uninstall` first. Each client gets what it supports natively: rule block, the shared `~/.agents/skills/aw-workflow` skill (agy gets its own copy), roles, `aw-start` and a session hook. Kimi gets no session hook (it discards SessionStart output). dsh gets `~/.dsh/AGENTS.md`, the `aw-start` skill and hooks through its official `@deepseek-ai/dsh-hooks-claude-code` bridge, mounted in each profile that has the bridge and its peer `@deepseek-ai/dsh-hook-protocol` (otherwise a notice prints the `dsh plugin --profile P add -w ...` command; since 0.7.0 `--dsh-plugins` or `--all-in` runs it and `uninstall` reverts it). Antigravity was verified with a real headless session; see the compatibility document for how to run it without the MCP hang. The [compatibility document](docs/compatibility.md#extra-clients-040) has the per-client table, the MiMo `CLAUDE.md` precedence, and what was verified natively.

**Validation guard.** Before a shell command runs, Qwen, Kimi, Antigravity, Command Code, Pi, MiMo, dsh and Claude Code (and OpenCode, as before) block a test/build command whose exit status a pipe, `;` or following `echo` would hide, and tell the model the allowed forms (`set -o pipefail; CMD | tail`, `CMD > log 2>&1; echo "exit=$?"`, optionally after `cd DIR &&`). Since 0.6.0 the Claude guard is on by default and the Codex one comes with `--trust-codex`; `--guard claude,codex|none` sets the choice and a sync keeps the recorded one. `CMD | tail; exit ${PIPESTATUS[0]}` is no longer accepted: zsh, the macOS shell of Claude Code and Codex, has no `PIPESTATUS` and exits 0. Opted-out projects are never blocked. Details and evidence per client: [compatibility](docs/compatibility.md#validation-guard-050).

**Clients may require trusting new hooks or restarting a session.** Codex's native hook trust is not bypassed; after a `sync` that changes hooks, re-approve them with `agent-workflow trust --client codex` (same as `/hooks`, Agent Workflow hooks only; or pass `--trust-codex` to the sync) or in Codex with `/hooks`. `verify` reads the state from `codex app-server` when Codex is available and warns with `codex-hook-untrusted`/`codex-hook-modified`/`codex-hook-disabled`. `verify` proves files/registrations, not that a running client reloaded or executed them. See the compatibility document for evidence levels.

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

Installation is global; MCP registration is explicit and project-scoped. Pass the repository root: nested paths are rejected to prevent silently bypassing their opt-out. Use the same `--clients` set when disconnecting a subset connection. Default MCP connections are Serena, CodeGraph and Context7. Agent-browser is used through the CLI/skill, so it adds no default MCP tool inventory. Supported optional MCP names: `serena`, `codegraph`, `playwright-mcp`, `devtools`, `context7`. `--clients LIST|all` selects native config targets (claude, codex and opencode by default; `all` adds qwen, kimi, agy, commandcode, pi, mimo and dsh, see [project MCP](docs/compatibility.md#project-mcp-060)). `--approve` (opt-in) also approves the servers the client's own way where a non-interactive mechanism exists (Claude, Qwen); the result names what other clients still need. `--exclude` (0.7.0) keeps the generated files out of commits with a managed block in `info/exclude` that `disconnect` removes; `--all-in` = `--approve --exclude`. Restart/reload and approve project tools in each client. Existing entries and comments are preserved; name collisions or edits to owned entries refuse rather than overwrite. Disconnect project registrations before uninstalling the package.

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

Version 0.7.0 automates the steps that were manual: `--all-in` for `install`/`sync --global` (`--trust-codex`, `--dsh-plugins`, `--agy-allow`) and for `connect` (`--approve`, `--exclude`), all reversible; see [Install everything in 5 minutes](#install-everything-in-5-minutes) and the [changelog](CHANGELOG.md).

Version 0.6.1 makes project MCP work in `kimi -p` (a launcher cache that answers before Kimi freezes its tool list) and in dsh without `--patch`, and adds a single [client status](docs/compatibility.md#client-status-061) table; see the [changelog](CHANGELOG.md).

Version 0.6.0 adds the DeepSeek Harness client, the Antigravity guard, project MCP for every extra client, the Claude guard by default and a zsh-safe rule; see the [changelog](CHANGELOG.md).

Version 0.5.1 adds `agent-workflow trust --client codex` and `--trust-codex` (approve only the Agent Workflow Codex hooks, as `/hooks` does) and removes a false `codex-hook-not-enabled` warning; see the [changelog](CHANGELOG.md).

Version 0.5.0 extends the validation guard to Qwen, Kimi, Command Code, Pi and MiMo, and makes it opt-in for Claude and Codex (`--guard`); see the [changelog](CHANGELOG.md).

Version 0.4.0 adds six opt-in clients, warns about unapproved Codex hooks, extends the OpenCode guard to `node <test file>` and the project test script, and fixes an uninstall failure on compact JSON; see the [changelog](CHANGELOG.md).

Version 0.3.1 makes `uninstall` keep edits made after a `sync`, runs hooks through a stable Node shim, reports outdated installs in `verify`, handles worktrees (`disconnect --prune`) and aligns the OpenCode guard with the rule; see the [changelog](CHANGELOG.md).

Version 0.2.3 adds a native OpenCode compound-validation guard and an explicit JS/TS module-symbol fallback. See [verified repairs](docs/repairs-2026-11-13.md). CodeGraph setup also checks/installs the selected TypeScript prerequisite; no browser is added by that dependency.
