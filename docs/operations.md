# Installation, use and recovery

[Español](operaciones.es.md) · [Overview](../README.md) · [Compatibility](compatibility.md)

## Requirements and scope

Node.js **22.22.0 or newer**, npm, Git and access to the private repository are required. Rulesync is pinned and installed as a package dependency; no separate global Rulesync is required. This release targets macOS/Linux. The optional Go LSP requires Go, Serena requires uv, and Rust LSP requires rustup with a toolchain. Missing prerequisites are reported rather than installing unrelated system runtimes. Browser operation needs a compatible existing browser or an explicitly requested download.

The workflow installation is global per user. MCP registrations are project-local. Tool binaries are stored in the user's managed directory and are invoked via `exec`. Nothing is automatically installed when a session starts. No standalone formatter/linter or persistent task service is included. Dependencies can internally contain formatting libraries; this is not a promise that every transitive dependency is formatter-free.

## First install

Follow the clone, npm and `install --global` sequence in the overview. `npm ci` installs package dependencies; `npm install --global .` registers the executable; `agent-workflow install --global` installs owned integration files. Run `verify` afterwards. Restart/reload the native clients and approve hooks/tools if the client asks. Approval is not bypassed. Keep the local checkout at the same path: a global local-path npm installation can reference it.

The tools are optional. Preview with `setup --list`, `setup --interactive`, `setup --profile code` or `setup --tools serena,codegraph`. Add `--apply` to install. `--all` includes the ordinary modules and agent-browser, but excludes Playwright engine/CLI/MCP and DevTools; choose those by name. `setup --profile web --apply` installs agent-browser only and does not download Chrome. Its pinned npm postinstall provisions the platform CLI binary.

## Command reference

| Command | Effect |
| --- | --- |
| `install --global`, `sync --global` | Deploy/update owned workflow files; `--clients claude,codex,opencode` selects clients |
| `verify` | Check installation receipt, owned files and registrations; not native execution |
| `doctor --json` | Check executable/version availability; not authentication or complete LSP/browser integration |
| `status --project PATH --json` | Read effective project opt-out |
| `disable --project PATH`, `enable --project PATH` | Write the small project switch; `--dry-run` previews |
| `setup --list` | Show the full catalog and profiles |
| `setup --interactive`, `--tool NAME`, `--tools A,B`, `--profile NAME`, `--all` | Preview selection; add `--apply` to install |
| `exec --tool NAME -- ARGS` | Run an installed tool with managed PATH; raw argument passthrough |
| `mcp-config --project ROOT` | Print native configuration suggestions only; writes nothing |
| `connect --project ROOT` | Register selected project MCPs; `--dry-run` previews |
| `disconnect --project ROOT` | Remove owned project registrations; use the same `--clients` set used to connect |
| `mcp --tool NAME --project PATH` | Internal stdio launcher used by generated registrations |
| `uninstall --global` | Remove workflow integration, restore owned changes; tools are retained |
| `--user-root PATH` | Redirect managed destinations to an existing test-user directory; not a full OS sandbox |

Do not combine `--all` with other setup selectors. `--apply` and `--dry-run` are mutually exclusive. A preview of setup may execute version/help probes, but does not install or register a client. No configuration flag can install an arbitrary package: the catalog is an allowlist.

## Project connections

Default MCPs are Serena, CodeGraph and Context7. Optional browser MCPs require explicit `--tools playwright-mcp,devtools`. Agent-browser is the default CLI/skill browser, not an automatically registered MCP. Native files: Claude `.mcp.json`, Codex `.codex/config.toml`, OpenCode `opencode.jsonc` or `opencode.json`.

Use the repository root for `connect`, `disconnect` and `mcp-config`. A nested path inside Git is rejected rather than silently promoted. Config applies to the registered root; a shared root registration cannot dynamically represent every nested opt-out. The MCP gate is checked when the server starts. Restart it after changing the switch; already running connections are not revoked. Global instructions remain discoverable when disabled.

Connection receipts preserve the exact original config path. If OpenCode config precedence changes, disconnect first and reconnect. If you used `--clients claude,codex`, use the same set for disconnect. Empty/duplicate clients, invalid containers, missing/edited managed blocks and changed owned entries fail before mutation.

## Browser use

Load `agent-workflow exec --tool agent-browser -- skills get core`, then follow its session workflow. Select an existing browser executable, an isolated headless session and a unique name; close only that session at completion. The generic `exec` command does **not** enforce those options. It does not inspect personal config or protect the mouse by itself. The workflow guide instructs agents not to attach to personal browsers or download browsers without authorization.

Downloading is a separate explicit action: `agent-workflow exec --tool agent-browser -- install`. For Playwright, `setup --tools playwright --apply` also runs `playwright install chromium`. Do not confuse CLI package size with browser disk/RAM requirements.

## Updates and removal

Fetch, inspect and fast-forward the intended source revision before reinstalling dependencies and running `sync`; see the exact sequence in the overview. Worktree divergence is not permission to reset. Rerun package checks and verify. A changed Node path or moved checkout may invalidate stored command paths; disconnect projects before moving and reconnect after installing at the new path.

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
