# Context size study and optional Claude lean mode

## What was measured

On one macOS account, a disposable Git fixture received the same minimal greeting three times per mode. These are exploratory client-reported context measurements, not a billing calculation or a benchmark of real tasks. No user config or credentials were changed. Raw client logs are local and private; [sanitized measurements](context-study-results.json) preserve each attempt and the harness errors.

| Client and mode | Reported input context in successful samples | Important difference |
| --- | --- | --- |
| Claude Sonnet 5.5, usual settings | 32,360; 42,484; 43,434 | Advertised tool count varied between starts. |
| Claude Sonnet 5.5, empty strict MCP list | 27,305 in each of 3 retries | No configured MCP servers available to that session. |
| Claude Sonnet 5.5, `ENABLE_TOOL_SEARCH=auto:5` | 43,737; 43,417; 43,957 | MCP remains configured; this sample does not establish an improvement. |
| Codex Luna, usual settings | 23,473 or 24,797 | Server catalogs/cache and startup varied. |
| Codex Luna, selected MCPs omitted from `direct` | 23,473 or 24,797 | No stable reduction established; availability was not fully demonstrated. |
| Codex Luna, five MCPs disabled for the invocation | 23,473 or 24,797 | No stable reduction established; those servers were unavailable. |

Claude totals above are the sum of its reported input, cache-creation input and cache-read input fields per response. These are not additive charges, not comparable to Codex's input accounting and not evidence of dollar savings. The reported medians for usual Claude vs empty MCP are 42,484 vs 27,305, a 15,179-token difference in these samples. Tool counts varied materially; the empty list also removed capabilities. Different prompts, model versions, connectors, caches, accounts and project rules can change the result.

Claude's [MCP documentation](https://code.claude.com/docs/en/mcp) describes deferred tool discovery and notes that disabling ToolSearch can instead load tools upfront. OpenAI's [configuration reference](https://developers.openai.com/codex/config-reference/) documents per-server visibility and enablement; their effect must be checked against the installed client. [OpenCode instructions](https://opencode.ai/docs/instructions/) describe project/global instruction loading. No global settings were changed based on these experiments.

## Opt-in launcher

`agent-workflow claude-lean --` starts a normal Claude session with `--strict-mcp-config` and an empty explicit MCP list. This means **no configured MCP servers are available in that session**, even when the project normally has them. It does not disable or uninstall them elsewhere. The normal `claude` command retains its existing configuration.

To load a specific selection instead, create a Claude MCP config JSON yourself and run:

```sh
agent-workflow claude-lean --mcp-file /path/to/selected-mcp.json --
```

The selected file uses Claude's MCP JSON format, for example:

```json
{"mcpServers":{"my-tool":{"command":"my-mcp-server","args":[]}}}
```

Credentials should stay in your existing secure environment/authentication mechanisms, not in a shareable config. The file is passed to Claude, not read or changed by Agent Workflow. Model, effort, user settings, hooks and permissions are not changed by the launcher. Claude's own configuration, trust and policy behavior still apply. Conflicting MCP flags must not be passed after `--`; use `--mcp-file` before `--` instead.

For noninteractive usage, pass Claude options after the separator:

```sh
agent-workflow claude-lean -- --print "Explain this project"
```

**Undo:** exit that session and start `claude` normally. To remove this unreleased feature from a local checkout, return to the previous installed version or revert the code change; it adds no hooks, background service or persistent client configuration.

## Native validation

The actual local Claude CLI started in lean mode with zero MCP servers and returned `OK`. With an explicitly selected local test MCP, the same launcher exposed one server; Claude discovered its tool through ToolSearch and called it successfully. In a separate Python fixture, Claude checked workflow applicability, made the requested source change and passed `python3 -m unittest`; tests and instructions stayed unchanged. A focused test suite exercises forwarding, explicit MCP selection, missing-file/conflict rejection and child exit propagation. These checks do not prove that every Claude version, MCP, permission policy or long-running task works, nor do they prove that all the user's project tools remain available in lean mode.
