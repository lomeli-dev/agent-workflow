# Testing and acceptance

[Español](pruebas.es.md)

Run `npm run check`. All installer tests use fresh temporary user roots; the test suite never substitutes HOME or calls the real global installer.

Historical initial local results are in [validation.json](validation.json) and [native discovery](native-discovery.json). These record evidence boundaries rather than claiming model-driven execution in every client. `node scripts/package-smoke.mjs` additionally installs the actual packed npm artifact in a temporary prefix and tests its lifecycle.

Covered: idempotence, original-byte restoration, unrelated config preservation, project enable/disable and nested boundaries, malformed config, collision refusal, symlink refusal, installation lock, owned-file/hook drift, tampered manifest paths, CLI argument validation, hook output bounds and opt-out, OpenCode startup gate, dependency allowlist and nonmutating setup preview.

The build runs the real pinned Rulesync generator in temporary staging. Syntax and internal documentation/resource links are checked. Tests validate effects rather than exact prose. No LLM, authentication or paid provider calls are needed for these checks.

Before real deployment, run `install --global --dry-run`, review target paths, apply and run verify. A second install must report zero changed files. Native clients must separately acknowledge new hooks/plugins and discover their skills/roles. Trust approval is never bypassed for a test. Installed executable versions do not prove LSP definition/reference/diagnostic integration.

For project opt-out, create a temporary project, disable it, invoke the actual hook subprocess and confirm no context output; re-enable and confirm bounded context. Verify the same before launching a worker. Do not interpret this as hiding global files from client discovery.

For performance, compare equivalent coding tasks before/after and record verified elapsed completion, unnecessary sequential rounds, repeated checks and rework. No synthetic percent speedup is published. Hooks run no model and no network, and timeout instead of holding the session indefinitely.

## v0.2 optional-module acceptance

At that stage, 23 automated tests passed, including selection, project MCP preservation/collisions, opt-out server behavior and uninstall guards. The packed npm artifact lifecycle passed. The interactive terminal selector was exercised with a single choice in preview mode. The global update verified successfully and a repeated sync changed zero files.

[Module validation](module-validation.json) records real installation/reuse, six LSP initialization responses and five functional MCP checks. These optional live scripts are separate from the offline/default suite: `scripts/probe-lsp.mjs`, `scripts/probe-modules.mjs` and `scripts/exercise-modules.mjs`. They do not prove loading or all permissions in a running IDE.

## Default browser acceptance

Vercel agent-browser 0.43.0 was installed without downloading a browser. `scripts/probe-agent-browser.mjs` exercised a disposable local HTTP page using an existing Chrome binary, a unique headless session and no personal profile: navigation, interactive snapshot, button click and a PNG screenshot succeeded; the session closed afterwards. This checks browser operation through the CLI, not invocation by each IDE. The browser-profile selection tests ensure optional alternatives are absent from automatic installation.

## 0.2.1 audit validation

The five-reviewer audit added effect-based regressions for comments inside shared arrays, changed OpenCode config precedence, missing managed blocks, connection receipt drift, nested opt-out registration, invalid containers, inherited JavaScript property names, missing/malformed LSP servers and FIFO project configs. At that point the suite had 36 passing tests. CI now checks untracked generated files and the actual minimum Node 22.22.0. See [audit coverage and remaining limits](audit-2026-11-13.md).

## Native-client behavioral acceptance

See the [real-agent trial](native-trial-2026-11-13.md) and its [structured evidence](native-trial-2026-11-13.json). These optional, authenticated sessions are separate from CI and the deterministic package tests. The intentionally broken seed under examples/native-client-lab is copied to disposable projects for agent implementation; its initial failure is expected. Never run it against real user projects or treat a model report as the sole assertion.

## 0.2.3 repairs

42 deterministic tests cover the native validation guard, per-call opt-out, original-file AST symbol fallback, bounds and dependency selection. [Repair evidence](repairs-2026-11-13.md) separately records real OpenCode guard execution, MCP fallback and completed manual compaction/resume. Local `.runtime` debugging artifacts are excluded from package checks and Git.
