# Agent Workflow

Global workflow guidance for Claude Code, Codex CLI and OpenCode V2, with project opt-out, Rulesync generation and a reversible installer.

[Español](README.es.md) · [Architecture](docs/architecture.md) · [Compatibility and limits](docs/compatibility.md) · [Testing](docs/testing.md)

This is a workflow package, not an autonomous orchestrator or a promise of faster completion. It provides a short applicability rule, the `aw-workflow` skill, optional `aw-worker`/`aw-reviewer` roles, a start command where supported, startup/compaction reminders and dependency diagnostics. Existing project instructions and user-selected models remain in charge.

## Install from the private repository

Requires Node.js 22+ and npm. Authenticate Git access to the private repository first; never paste tokens into these commands or project files.

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

The first install registers the CLI. The second deploys managed client files. `--clients claude,codex` restricts targets. All three are the default. No `sudo`, global permission changes, model requests or dependency installs occur in startup hooks. macOS and Linux paths are supported; Windows is not a tested target.

Rulesync is pinned to 43.8.0 and generates into isolated staging, never directly into the real home. The installer maps only this package's outputs to user scope, appends owned instruction blocks and merges its hooks/plugin entry. Unrelated settings/hooks are preserved. Existing symlink destinations or conflicting files cause a refusal instead of an overwrite.

**Clients may require trusting new hooks or restarting a session.** Codex's native hook trust is not bypassed. `verify` proves files/registrations, not that a running client reloaded or executed them. See the compatibility document for evidence levels.

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

You can commit that file as a team choice or keep it local. The nearest config up to the repository root wins; malformed config disables this workflow rather than guessing. Restart/reload a session that cached earlier policy state. Global rules/skills can remain discoverable: opt-out gates our workflow behavior, not the IDE's global discovery or unrelated integrations. No changes to the rest of the project's rules are made.

## Select and prepare tools

```sh
agent-workflow setup --list
agent-workflow setup --interactive --apply
agent-workflow setup --tools serena,codegraph --apply
agent-workflow setup --profile web --apply
agent-workflow setup --all --apply
agent-workflow doctor --json
```

Without `--apply`, setup only previews. The interactive menu accepts numbers, names or `all`; empty input cancels. Profiles: `lsp`, `code`, `web`, `docs`, `delivery`. The 16-module catalog includes six language servers, ast-grep, Serena, CodeGraph, Playwright engine/CLI/MCP, Chrome DevTools MCP, Context7, GitHub CLI and Gitleaks. **No standalone linter, formatter or persistent-task service is included.** Language servers may themselves expose formatting capabilities; the package does not activate them or rewrite source files.

Responding installations are reused and their actual versions reported. Missing tools use pinned packages in the managed user directory. Node/npm are required; Go, uv and a Rust toolchain are prerequisites for their corresponding modules. Missing prerequisites are reported without bootstrapping an entire development environment. No shell profile is edited and no dependency installs run at session startup.

### Connect selected MCPs to a project

```sh
agent-workflow connect --project /path/to/project --tools serena,codegraph --dry-run
agent-workflow connect --project /path/to/project --tools serena,codegraph
agent-workflow disconnect --project /path/to/project
agent-workflow exec --tool ast-grep -- --version
```

Installation is global; MCP registration is explicit and project-scoped. Supported MCP names: `serena`, `codegraph`, `playwright-mcp`, `devtools`, `context7`. `--clients claude,codex,opencode` selects native config targets (all three by default). Restart/reload and approve project tools in each client. Existing entries and comments are preserved; name collisions or edits to owned entries refuse rather than overwrite. Disconnect project registrations before uninstalling the package.

`setup` alone does not register MCPs or enable native client LSP plugins. See [tool selection and evidence](docs/tools.md) for routing, prerequisites and integration limits.

## Upgrade, verify, remove

```sh
# Review a new release before updating your checkout/install.
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

Updates/uninstall refuse changed owned files or hook definitions. Preserve/reconcile your edit before proceeding. Other additions outside owned blocks/entries are retained. The private ownership manifest keeps original config locally for reversal; it may contain private user settings and is never committed or uploaded. Optional downloaded tools and empty directories are retained on uninstall to avoid deleting shared resources. A changing client set currently requires uninstall/reinstall.

## Development

Edit `.rulesync`, not generated output. `npm run build` regenerates; `npm test` tests isolated installs, opt-out, preservation and failures; `npm run check` adds package/document checks. Rulesync build uses no model and never touches real client homes. `--user-root` redirects the install for safe previews/tests without overriding HOME.

```sh
mkdir -p /path/to/isolated-user
node bin/agent-workflow.mjs install --global --user-root /path/to/isolated-user
node bin/agent-workflow.mjs verify --user-root /path/to/isolated-user
node bin/agent-workflow.mjs uninstall --global --user-root /path/to/isolated-user
```

No model or effort is forced, no MCP server is added by the global workflow install, and no automatic project-memory writer is started. The coordinator uses an existing memory-sesion installation if the project and user call for it. Workers return candidate lessons to that coordinator.
