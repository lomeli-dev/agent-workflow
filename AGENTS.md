# Agent Workflow development

This repository builds a portable workflow package; it is separate from Studio/Herdr. Read README.md and docs/architecture.md. The user authorized global installation on the current Mac and the lomeli-dev/agent-workflow repository (public since 0.7.2, docs on GitHub Pages), not installation on other hosts.

Edit canonical rules, skills, roles and commands in .rulesync. Generated client artifacts are built by npm run build. Do not manually modify generated content. Native settings and hooks are adapted by lib/install.mjs.

Tests must use temporary user roots and projects. Never point a destructive test or Rulesync global generation at the real home. Preserve unrelated config, hooks, credentials and user edits. No telemetry, model request, automatic dependency installation or shell execution from project configuration at session startup.

Use npm run check before delivery. Global installation needs an ownership manifest, backups, drift checks and reversible removal. Project opt-out is a workflow gate, not a guarantee that clients unload globally discoverable instructions/skills. State that limitation clearly.

Do not silently change user-selected models, reasoning effort, permissions or compaction settings. Worker roles inherit client defaults unless explicitly configured. A generated file or executable in PATH does not prove native client loading or functional LSP integration.
