# Testing and acceptance

Run `npm run check`. All installer tests use fresh temporary user roots; the test suite never substitutes HOME or calls the real global installer.

Initial local results are in [validation.json](validation.json) and [native discovery](native-discovery.json). These record evidence boundaries rather than claiming model-driven execution in every client. `node scripts/package-smoke.mjs` additionally installs the actual packed npm artifact in a temporary prefix and tests its lifecycle.

Covered: idempotence, original-byte restoration, unrelated config preservation, project enable/disable and nested boundaries, malformed config, collision refusal, symlink refusal, installation lock, owned-file/hook drift, tampered manifest paths, CLI argument validation, hook output bounds and opt-out, OpenCode startup gate, dependency allowlist and nonmutating setup preview.

The build runs the real pinned Rulesync generator in temporary staging. Syntax and internal documentation/resource links are checked. Tests validate effects rather than exact prose. No LLM, authentication or paid provider calls are needed for these checks.

Before real deployment, run `install --global --dry-run`, review target paths, apply and run verify. A second install must report zero changed files. Native clients must separately acknowledge new hooks/plugins and discover their skills/roles. Trust approval is never bypassed for a test. Installed executable versions do not prove LSP definition/reference/diagnostic integration.

For project opt-out, create a temporary project, disable it, invoke the actual hook subprocess and confirm no context output; re-enable and confirm bounded context. Verify the same before launching a worker. Do not interpret this as hiding global files from client discovery.

For performance, compare equivalent coding tasks before/after and record verified elapsed completion, unnecessary sequential rounds, repeated checks and rework. No synthetic percent speedup is published. Hooks run no model and no network, and timeout instead of holding the session indefinitely.

## v0.2 optional-module acceptance

23 automated tests passed, including selection, project MCP preservation/collisions, opt-out server behavior and uninstall guards. The packed npm artifact lifecycle passed. The interactive terminal selector was exercised with a single choice in preview mode. The global update verified successfully and a repeated sync changed zero files.

[Module validation](module-validation.json) records real installation/reuse, six LSP initialization responses and five functional MCP checks. These optional live scripts are separate from the offline/default suite: `scripts/probe-lsp.mjs`, `scripts/probe-modules.mjs` and `scripts/exercise-modules.mjs`. They do not prove loading or all permissions in a running IDE.
