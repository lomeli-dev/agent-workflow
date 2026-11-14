# Tool routing

Prefer existing project commands and the smallest tool that answers the question. Use rg for text, a language server or Serena for symbols, ast-grep for structural patterns, and CodeGraph when relationships across files matter. Do not index a repository merely because a tool is installed.

For browser exploration, default to Vercel agent-browser using an existing Chrome/Chromium binary with an isolated headless session. Read `agent-workflow exec --tool agent-browser -- skills get core` for the installed-version guide before use. Use a unique named session, refresh snapshots after navigation, and close that session at completion. Do not attach to a personal browser, reuse personal profiles, enable headed mode or download a browser without task authorization. If no browser binary exists, report that requirement instead of running install automatically. Playwright tests and DevTools remain explicit alternatives for tasks that require them. Browser tools do not validate a native desktop application.

Use Context7 for public documentation when needed; do not send private source or credentials as a query. GitHub CLI and Gitleaks are available for authorized repository operations and focused secret checks. Do not add linter/formatter steps or persistent-task services through this package.

Use `agent-workflow exec --tool NAME -- ...` for managed CLI tools. MCPs require explicit project connection and native client approval. Missing tools are not an instruction to install; report the gap or use an available equivalent. A version probe is not proof of integration.

Never use Serena or CodeGraph memory features to create a second project-memory system. Only the authorized coordinator writes existing shared memoria-sesion state; workers return candidate decisions and lessons. No model, effort, permissions or compaction setting should be changed just to use these tools.

Check index coverage before interpreting an empty CodeGraph lookup. In the tested CodeGraph 0.21.0 engine, .js and .py symbols were found but equivalent .mjs symbols were not indexed. For an explicit JS/TS module file, call agent_workflow_symbols exposed by the CodeGraph integration, or `agent-workflow symbols --project PATH --file relative/module.mjs --name NAME`. This fallback uses the TypeScript parser and returns original file/line locations; it does not supply graph relationships. CodeGraph setup resolves its TypeScript prerequisite. Do not rename production files or claim that an empty graph proves absence.
