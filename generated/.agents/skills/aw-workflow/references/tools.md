# Tool routing

Prefer existing project commands and the smallest tool that answers the question. Use rg for text, a language server or Serena for symbols, ast-grep for structural patterns, and CodeGraph when relationships across files matter. Do not index a repository merely because a tool is installed.

For browser work, choose repeatable Playwright tests, compact CLI operations, interactive MCP exploration or DevTools diagnostics according to the task. Do not run all four by default. Browser tools do not validate a native desktop application.

Use Context7 for public documentation when needed; do not send private source or credentials as a query. GitHub CLI and Gitleaks are available for authorized repository operations and focused secret checks. Do not add linter/formatter steps or persistent-task services through this package.

Use `agent-workflow exec --tool NAME -- ...` for managed CLI tools. MCPs require explicit project connection and native client approval. Missing tools are not an instruction to install; report the gap or use an available equivalent. A version probe is not proof of integration.

Never use Serena or CodeGraph memory features to create a second project-memory system. Only the authorized coordinator writes existing shared memoria-sesion state; workers return candidate decisions and lessons. No model, effort, permissions or compaction setting should be changed just to use these tools.
