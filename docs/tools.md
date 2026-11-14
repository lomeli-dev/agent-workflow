# Optional tools, scope and evidence

The catalog is in `lib/catalog.mjs`. Setup accepts an explicit selection; startup hooks never install tools. Selecting all does not make every tool mandatory on every task. Execute CLI tools through `agent-workflow exec --tool NAME -- ...` so managed binaries and browser paths are available without editing shell profiles.

| Profile | Modules | Intended use |
| --- | --- | --- |
| lsp | gopls, typescript, python, rust, bash, yaml | Definitions, references and language diagnostics |
| code | ast-grep, serena, codegraph | Structural search, symbol operations and dependency/call analysis |
| web | playwright, playwright-cli, playwright-mcp, devtools | Repeatable browser checks, exploration and browser diagnostics |
| docs | context7 | Current public library documentation |
| delivery | github, gitleaks | Repository workflows and explicit secret scanning |

Use Playwright tests for repeatable assertions, CLI for compact scripted browser work, MCP for interactive agent-driven exploration, and DevTools when console/network/performance investigation is needed. They are complementary options, not four mandatory passes. Native desktop apps require another control mechanism.

## Clean-machine prerequisites

Node.js 22+ and npm are required. The Go module needs Go, Serena needs uv (which can provision Python 3.13), and Rust needs rustup with a toolchain. Native GitHub/Gitleaks release extraction requires tar and unzip as appropriate. No standalone linter or formatter is installed/configured, and no persistent task runner is started. Native modules support macOS/Linux arm64/x64. Linux browser runtime system libraries may require distribution-specific preparation; setup reports browser failures rather than silently installing OS packages.

Existing responding executables are reused, not forcibly upgraded. Npm packages are pinned; GitHub/Gitleaks release downloads are checked against official SHA256 checksums. CodeGraph engine availability is probed separately from npm package installation. Installation failure is recorded per module and returns failure overall; inspect the receipt before retrying an uncertain operation.

## Project connections and boundaries

`connect` adds owned project entries for Claude, Codex and OpenCode V2. `disconnect` removes only owned entries and restores original bytes when no outside edits occurred. Private ownership receipts contain original configuration: never publish them. These registrations point to the current installed CLI path; disconnect/reconnect if that path moves. Credentials are not copied into generated entries.

The MCP launcher checks project opt-out on startup. Disabled projects get empty tools without starting the backend. Restart existing MCP connections after changing opt-out; it does not revoke an already running server. Clients may still discover globally installed skills. No claim of a filesystem sandbox is made.

CodeGraph uses graph-only mode with telemetry/model fetch disabled and excludes `.git`, `.memory` and `node_modules`. Serena is launched with no-memories/no-onboarding modes and no dashboard. In the tested Serena version the discovery list still included memory tools: do not treat those flags as an enforcement boundary. Agent Workflow instructions prohibit using them for project memory; only the authorized coordinator uses the existing memoria-sesion workflow. No memory tool was invoked in validation.

Browser MCPs use headless isolated profiles and do not operate the user's open browser or desktop pointer. DevTools usage statistics are disabled. Context7 is a remote documentation service: query public library names, not private source. Account/key requirements and rate limits remain provider-controlled. GitHub authentication is separate; installing gh does not log in. Gitleaks is available explicitly, without adding a commit hook.

## Verification levels

See [module validation](module-validation.json) for this release's local evidence. All 16 modules installed or reused successfully on the tested Mac. Five MCP servers initialized and published tools; functional fixture calls checked symbol lookup, graph lookup, browser content, DevTools page creation and a public documentation lookup. Native client registration is tested in isolated configuration fixtures; it is not a claim that every running IDE loaded every MCP. No real project was connected automatically. All six language servers completed LSP initialization. The first TypeScript attempt exposed a missing compatible tsserver; setup now checks the companion and installs TypeScript 5.9.3 alongside the language server when needed. LSP initialization establishes protocol startup, not complete client integration or every language operation.

The live probe scripts are development checks, not startup actions. `exercise-modules.mjs` uses disposable code and a local web fixture, with one public Context7 lookup. No private repository content is uploaded as part of those checks.
