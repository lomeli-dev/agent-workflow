# Changelog

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
