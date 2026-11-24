# Installation, use and recovery

[Español](operaciones.es.md) · [Overview](../README.md) · [Compatibility](compatibility.md)

## Requirements and scope

Node.js **22.22.0 or newer**, npm and Git are required. Rulesync is pinned and installed as a package dependency; no separate global Rulesync is required. This release targets macOS/Linux. The optional Go LSP requires Go, Serena requires uv, and Rust LSP requires rustup with a toolchain. Missing prerequisites are reported rather than installing unrelated system runtimes. Browser operation needs a compatible existing browser or an explicitly requested download.

The workflow installation is global per user. MCP registrations are project-local. Tool binaries are stored in the user's managed directory and are invoked via `exec`. Nothing is automatically installed when a session starts. No standalone formatter/linter or persistent task service is included. Dependencies can internally contain formatting libraries; this is not a promise that every transitive dependency is formatter-free.

## First install

Follow the clone, npm and `install --global` sequence in the overview. `npm ci` installs package dependencies; `npm install --global .` registers the executable; `agent-workflow install --global` installs owned integration files. Run `verify` afterwards. Restart/reload the native clients and approve hooks/tools if the client asks. Approval is not bypassed. Keep the local checkout at the same path: a global local-path npm installation can reference it.

The tools are optional. Preview with `setup --list`, `setup --interactive`, `setup --profile code` or `setup --tools serena,codegraph`. Add `--apply` to install. `--all` includes the ordinary modules and agent-browser, but excludes Playwright engine/CLI/MCP and DevTools; choose those by name. `setup --profile web --apply` installs agent-browser only and does not download Chrome. Its pinned npm postinstall provisions the platform CLI binary.

## Command reference

| Command | Effect |
| --- | --- |
| `install --global`, `sync --global` | Deploy/update owned workflow files; `--clients claude,codex,opencode` selects clients; `--trust-codex` (opt-in) trusts the Agent Workflow Codex hooks right after writing `hooks.json`; `--dsh-plugins` (0.7.0) adds the missing dsh hooks packages to each profile; `--agy-allow` (0.7.0) adds owned agy MCP permissions; `--all-in` turns on each of the three whose client is in `--clients` |
| `trust --client codex [--dry-run]` | Trust only the Agent Workflow Codex hooks through `codex app-server`, same as approving them in `/hooks`; shows before/after |
| `verify` | Check installation receipt, owned files, registrations and the Node/runtime the hooks call; `status: outdated` lists files that differ from this package (run `sync`); not native execution |
| `doctor --json` | Check executable/version availability and repeat the `verify` checks under `installation`; not authentication or complete LSP/browser integration |
| `status --project PATH --json` | Read effective project opt-out |
| `disable --project PATH`, `enable --project PATH` | Write the small project switch; `--dry-run` previews |
| `setup --list` | Show the full catalog and profiles |
| `setup --interactive`, `--tool NAME`, `--tools A,B`, `--profile NAME`, `--all` | Preview selection; add `--apply` to install |
| `symbols --project ROOT --file module.mjs [--name NAME]` | Find named declarations in an original JS/TS file via TypeScript; no graph relationships |
| `exec --tool NAME -- ARGS` | Run an installed tool with managed PATH; raw argument passthrough |
| `mcp-config --project ROOT` | Print native configuration suggestions only; writes nothing |
| `connect --project ROOT` | Register selected project MCPs; `--dry-run` previews; `--approve` approves the client's own way; `--exclude` (0.7.0) keeps generated files out of commits through `info/exclude`; `--all-in` = `--approve --exclude` |
| `disconnect --project ROOT` | Remove owned project registrations (and the `info/exclude` block); use the same `--clients` set used to connect |
| `disconnect --prune` | Forget receipts whose project no longer exists (for example a deleted worktree); `--dry-run` previews |
| `mcp --tool NAME --project PATH` | Internal stdio launcher used by generated registrations |
| `uninstall --global` | Remove workflow integration, restore owned changes (including agy permissions and the dsh packages added by `--dsh-plugins`); tools are retained |
| `--user-root PATH` | Redirect managed destinations to an existing test-user directory; not a full OS sandbox |

Do not combine `--all` with other setup selectors. `--apply` and `--dry-run` are mutually exclusive. A preview of setup may execute version/help probes, but does not install or register a client. No configuration flag can install an arbitrary package: the catalog is an allowlist.

## Project connections

Default MCPs are Serena, CodeGraph and Context7. Optional browser MCPs require explicit `--tools playwright-mcp,devtools`. Agent-browser is the default CLI/skill browser, not an automatically registered MCP. Native files: Claude `.mcp.json`, Codex `.codex/config.toml`, OpenCode `opencode.jsonc` or `opencode.json`; since 0.6.0 (`--clients LIST|all`) also `.mcp.json` for Command Code and Kimi (both read it), `.qwen/settings.json`, `.pi/mcp.json`, `mimocode.json(c)`, an Antigravity workspace plugin `.agents/plugins/agent-workflow-mcp/` and `.dsh/agent-workflow-mcp.json` for dsh (since 0.6.1 the rows that sync puts in each profile load it when dsh starts in the project; no `--patch`). `--approve` (opt-in) approves the servers through the client's own non-interactive mechanism where one exists (Claude `enabledMcpjsonServers` in `.claude/settings.local.json`, `qwen mcp approve`); the result lists what the other clients still need (Kimi `KIMI_CODE_TRUST_WORKSPACE=1` or a trusted folder, plus a launcher cache that `--approve` warms because Kimi freezes its tool list right after starting the servers, Pi `-a` or a trusted project, agy `mcp(agent-workflow-mcp_aw-<tool>/*)` in `~/.gemini/antigravity-cli/settings.json`, Codex a trusted project). Details and evidence: [compatibility](compatibility.md#project-mcp-060). Add machine-local registrations to `.git/info/exclude` (not shared, leaves `.gitignore` alone): since 0.7.0 `connect --exclude` (or `--all-in`) does it in a managed block of the repository's `info/exclude` (`git rev-parse --git-path`, shared by its worktrees), only for untracked paths nothing ignores yet (your own lines are detected with `git check-ignore`), and `disconnect` removes it. `sync --global --agy-allow` adds the agy rule for serena, codegraph and context7. Kimi folder trust stays manual: Kimi has no official per-folder command, only internal files and the global `[workspace] require_trust = false`. Details and isolated evidence: [all-in automation](compatibility.md#all-in-automation-070).

Use the repository root for `connect`, `disconnect` and `mcp-config`. A nested path inside Git is rejected rather than silently promoted. Config applies to the registered root; a shared root registration cannot dynamically represent every nested opt-out. The MCP gate is checked when the server starts. Restart it after changing the switch; already running connections are not revoked. Global instructions remain discoverable when disabled.

### Worktrees (Orca and `git worktree`)

- **`connect` from a worktree** registers that worktree's root, not the main checkout.
- **A copied or committed `.mcp.json`** stores the checkout where it was connected. At startup the launcher looks at its working directory: if it is another worktree of the same repository (same common Git directory), it serves that worktree and says so on stderr. A directory outside the repository keeps the registered path. This relies on the client starting the MCP in the project directory, which was not verified in real clients.
- **An untracked `.agent-workflow.json` does not reach worktrees.** A new worktree only contains tracked files, so a `disable` in the main checkout does not apply there and the worker sees "enabled". Commit the file, or run `agent-workflow disable --project WORKTREE_PATH` in each worktree.
- **Deleting a connected worktree** leaves an orphaned receipt, and `uninstall --global` stops and names the missing project. `agent-workflow disconnect --prune --dry-run` lists receipts whose project no longer exists, and `disconnect --prune` forgets them without touching other checkouts. `doctor` lists them under `connections`.

Connection receipts preserve the exact original config path. If OpenCode config precedence changes, disconnect first and reconnect. If you used `--clients claude,codex`, use the same set for disconnect. Empty/duplicate clients, invalid containers, missing/edited managed blocks and changed owned entries fail before mutation.

## Browser use

Load `agent-workflow exec --tool agent-browser -- skills get core`, then follow its session workflow. Select an existing browser executable, an isolated headless session and a unique name; close only that session at completion. The generic `exec` command does **not** enforce those options. It does not inspect personal config or protect the mouse by itself. The workflow guide instructs agents not to attach to personal browsers or download browsers without authorization.

Downloading is a separate explicit action: `agent-workflow exec --tool agent-browser -- install`. For Playwright, `setup --tools playwright --apply` also runs `playwright install chromium`. Do not confuse CLI package size with browser disk/RAM requirements.

## Updates and removal

**A file that cannot be updated no longer stops a sync (0.7.1).** On an existing installation, `sync` skips a file whose owned part was edited, a colliding destination or an invalid config, and lists it under `skipped` with the error and the exact fix. It exits 1, keeps that file's recorded entry and still syncs every other file. dsh rewrites `cordis.patch.yml` itself when a setting is saved in `dsh web`; that is not drift as long as our rows are the same (see [compatibility](compatibility.md#dsh-rewrites-its-own-patch-file-071)).

Fetch, inspect and fast-forward the intended source revision before reinstalling dependencies and running `sync`; see the exact sequence in the overview. Worktree divergence is not permission to reset. Rerun package checks and verify. A changed Node path or moved checkout may invalidate stored command paths; disconnect projects before moving and reconnect after installing at the new path.

### After switching Node

Hooks run through a stable shim, `<store>/bin/node`, which records the Node that ran the last `sync`. With nvm, `npm link` (or `npm install --global .`) is per Node version, so after `nvm use` to another version the `agent-workflow` command may not exist, and after deleting the recorded version the shim falls back to the `node` in PATH or, if there is none, exits 0 without context. `verify` and `doctor` report `hook-node-missing` (or `hook-runtime-missing`) with the repair:

```sh
cd /path/to/agent-workflow   # your checkout
npm link                     # with the Node you want to keep
agent-workflow sync --global --dry-run
agent-workflow sync --global
agent-workflow verify
```

### Codex hook trust

Codex runs a hook only when `hooks.state."<key>".trusted_hash` in `~/.codex/config.toml` equals the hook's current hash; a sync that changes a hook command makes it stop running until it is approved again. `agent-workflow trust --client codex` (preview with `--dry-run`) does what `/hooks` does, through `codex app-server` (`hooks/list`, then `config/batchWrite` of `hooks.state`, written by Codex itself). It selects only hooks in the user `hooks.json` whose command is the Agent Workflow shim + store runtime; other hooks (Orca, warp, yours) and their trust are never touched, and `enabled` is never changed. If `codex` is missing or app-server fails, it exits 1 and changes nothing. `sync --global --trust-codex` runs the same step right after writing `hooks.json` (opt-in; a sync without it never writes trust).

`verify`/`doctor` report `codexHookTrust` from `codex app-server` when Codex is available (`trustStatus`, `enabled`) and warn with `codex-hook-untrusted`, `codex-hook-modified` or `codex-hook-disabled`. Without Codex they read `config.toml`: a missing `enabled` means enabled; only a missing `trusted_hash` or `enabled = false` is reported, and whether a present hash still matches is not computed (`hashChecked: false`). `AGENT_WORKFLOW_CODEX=PATH` selects the executable; `AGENT_WORKFLOW_CODEX=none` forces the TOML reading.

Installs from 0.3.0 and earlier call the absolute Node path directly; the first `sync` with 0.3.1 moves them to the shim. Project MCP registrations also record the Node and checkout path: disconnect and reconnect them after switching.

Before uninstalling, disconnect every registered project. The global uninstall refuses while connection receipts remain. Review `uninstall --global --dry-run`, then uninstall and remove the npm CLI. Retained optional tools are intentional; there is no automatic tool purge command. Do not recursively delete a shared cache or reused system executable. Existing project opt-out files are also retained.

Private state under the user's `.local/share/agent-workflow/` contains installation originals, project connection originals, locks, tool receipts and downloaded tools. Native user destinations may honor CODEX_HOME, CLAUDE_CONFIG_DIR or XDG_CONFIG_HOME. Never upload ownership receipts: original settings may contain secrets. New connection backups have consistency checksums; these are not tamper-proof against someone who can edit the private receipt itself. Legacy receipts without a checksum remain readable for removal.

## Troubleshooting

- **Lock exists:** inspect whether the original process is still running. Do not delete it or replay an uncertain install blindly.
- **Owned file/block changed:** preserve your edit, compare with the prior receipt/source and reconcile. Do not force overwrite. A missing owned block is also drift.
- **MCP missing in the client:** check registration scope, native approval and client reload; `verify` is not a native loading test.
- **Tool installed but operation fails:** version/help is only a launcher probe. Exercise the specific operation in an isolated fixture; report runtime/authentication prerequisites separately.
- **No browser:** select an existing compatible executable or explicitly request a download. Never silently attach to an open personal session.
- **Private snapshot corruption:** preserve configuration and receipt for manual recovery. Do not regenerate unknown originals or call them verified.

For validation history and current coverage, read [testing](testing.md) and the [five-reviewer audit](audit-2026-11-13.md). No measured end-to-end agent speedup or universal IDE execution is claimed.

## Validation guard and module coverage

OpenCode V2 registers a `shell.create.before` hook. Since 0.5.0 the same guard (one runtime, `shellGuard` in `gate.mjs` + `validation-guard.mjs`) runs before the shell tool of Qwen, Kimi and Command Code (`PreToolUse` hook, answered with `permissionDecision: deny`), Pi (extension `tool_call` → `block`) and MiMo (plugin `tool.execute.before` → `cancel`); since 0.6.0 also Antigravity (`PreToolUse` `run_command` → `decision: deny`), DeepSeek Harness (`PreToolUse` `^bash$` through the hooks bridge) and, by default, Claude Code (`PreToolUse`, matcher `Bash`; `--guard none` removes it). Codex gets it with `--trust-codex` or `--guard codex`. When the effective project gate is enabled, recognized test/build commands combined with pipes, separators or conditionals are rejected before execution. Run the check directly and use the tool cwd field; where the tool has none (Claude), `cd DIR && CMD` is allowed.

Recognized validations include npm/pnpm/yarn/bun scripts, `npx`/`pnpm exec`/`bunx` runners, `uv run`/`poetry run`, pytest/jest/vitest, `node --test`, cargo/go/dotnet, gradle/`./gradlew` test tasks, `make [-C DIR] test|check|build` and `bash -c`/`sh -c` scripts (checked recursively). Two forms keep the failure status in bash and zsh and are allowed, also after `cd DIR &&`:

- `set -o pipefail; CMD | tail` (also `set -euo pipefail`): the pipeline returns the first failure;
- `CMD > log 2>&1; echo "exit=$?"`: full output goes to a file and the status is printed. Without the redirection, `CMD; echo $?` stays blocked.

`CMD | tail; exit ${PIPESTATUS[0]}` is blocked since 0.6.0: `PIPESTATUS` is bash-only and Claude Code/Codex run commands in zsh on macOS, where that form exits 0. Anything after those forms, `;` after a `cd`, other `&&`/`||` chains and background jobs stay blocked. Ordinary reads and direct validations are unchanged. Recognition is deliberately bounded; it is not a general shell parser, permission filter or guarantee for arbitrary scripts/substitutions. Unsupported plugin APIs retain guidance only and report `validationGuard: false` in plugin storage.

The CodeGraph adapter adds `agent_workflow_symbols` and coverage guidance. It reads only the explicit original project-relative JS/TS file (maximum 1 MiB), refuses path escapes and syntax errors, and returns named declarations with original locations. It never executes project modules. TypeScript is a setup prerequisite of CodeGraph. Results identify `source: typescript-parser` and `graphRelationships: false`; this does not patch the upstream relationship graph.
