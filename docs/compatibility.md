# Compatibility, sources and evidence limits

Scope: macOS/Linux, Node 22.22.0+. Core clients (default): Claude Code, Codex CLI and OpenCode V2. Extra clients (0.4.0, explicit `--clients ...` or `--clients all`): Qwen Code, Kimi Code, Antigravity CLI (agy), Command Code, Pi and MiMo Code; DeepSeek Harness (dsh) since 0.6.0. ZCode and Cursor Agent CLI were left out by the owner's decision. No claim of Windows or all IDE support. Rulesync 43.8.0 is pinned; version updates require regeneration and adapter tests.

| Capability | Claude Code | Codex CLI | OpenCode V2 |
| --- | --- | --- | --- |
| Global rule | CLAUDE.md managed block | AGENTS.md managed block | Global AGENTS.md managed block |
| Skill | Native skills/aw-workflow | User .agents/skills/aw-workflow | Global skills/aw-workflow |
| Optional roles | Native agents/aw-* | Rulesync-generated agents/aw-*.toml | Native agents/aw-* |
| Start command | aw-start | Invoke aw-workflow; no fake project slash command | aw-start |
| Reminder hook | SessionStart, SubagentStart, PreCompact | Same event definitions; native trust required | Plugin diagnostic plus project-gated compound-validation shell guard |
| Validation guard (0.5.0; defaults 0.6.0) | `PreToolUse`, on by default since 0.6.0 (`--guard none` removes it) | `PreToolUse` with `--trust-codex` (or `--guard codex`); needs approval (`/hooks` or `trust --client codex`) | Plugin shell guard (always) |
| Project disable | Gate at hook invocation + behavioral instructions | Gate at hook invocation + behavioral instructions | Per-shell-call gate for validation guard + startup gate for MCP; reload long-lived MCPs after changing config |
| LSP | Separate native integration required | Separate available client/tool integration required | Separate native integration required |

## Extra clients (0.4.0)

Paths are for the default layout; `QWEN_HOME`, `KIMI_CODE_HOME` and `PI_CODING_AGENT_DIR` are honored like `CODEX_HOME`. The skill is installed once in `~/.agents/skills/aw-workflow`, which Codex, Qwen, Kimi, Command Code, Pi and MiMo all read; only Antigravity gets its own copy (it does not read that folder). Agents and commands are Rulesync 43.8.0 outputs, generated in project layout inside staging (never with `rulesync --global`, which writes into the real home and ignores `--output-roots`) and mapped to each client's user folder.

| Client (version checked) | Global rule (managed block) | Skill | Agents aw-worker / aw-reviewer | aw-start | Session hook |
| --- | --- | --- | --- | --- | --- |
| Qwen Code 0.28.4 | `~/.qwen/QWEN.md` | shared | `~/.qwen/agents/` | `~/.qwen/commands/aw-start.md` | `~/.qwen/settings.json`: SessionStart, SubagentStart, PreCompact (Claude shape, `hookSpecificOutput.additionalContext`; PreCompact text becomes compaction instructions). SubagentStart runs but Qwen does **not** pass its text to the subagent (owner test, 23 Nov 2026); subagents get the rule only through the global file |
| Kimi Code 2.7.3 | `~/.kimi-code/AGENTS.md` | shared | `~/.kimi-code/agents/` | skill `~/.kimi-code/skills/aw-start` | **none**: Kimi fires SessionStart but discards its output; only UserPromptSubmit output reaches the model, which would repeat the reminder on every prompt (0.5.0 adds only the PreToolUse validation guard, see below) |
| Antigravity CLI (agy) 1.5.15 | `~/.gemini/GEMINI.md` | `~/.gemini/config/skills/aw-workflow` | `~/.gemini/config/agents/` | skill `~/.gemini/config/skills/aw-start` | `~/.gemini/config/hooks.json`, named group `agent-workflow`, SessionStart → `injectSteps[].systemMessage`; PreToolUse guard since 0.6.0 |
| Command Code 1.89.3 | `~/.commandcode/AGENTS.md` | shared | `~/.commandcode/agents/` | `~/.commandcode/commands/aw-start.md` | `~/.commandcode/settings.json` SessionStart (its only session event); may ask to trust hooks per project |
| Pi 1.6.0 | `~/.pi/agent/AGENTS.md` | shared | none (Pi has no subagents) | `~/.pi/agent/prompts/aw-start.md` | extension `~/.pi/agent/extensions/agent-workflow.js`: hidden message before the first run of each session |
| MiMo Code 0.1.16 | see below | shared | `~/.config/mimocode/agents/` (reviewer: `mode: all`, `edit`/`notebook_edit: deny`) | `~/.config/mimocode/commands/aw-start.md` | plugin `~/.config/mimocode/plugins/agent-workflow.js` (`experimental.chat.system.transform`) |
| DeepSeek Harness (dsh) 0.2.2-rc.5 | `~/.dsh/AGENTS.md` (`$DSH_HOME`; loaded before `~/.agents/AGENTS.md`, which no other installed client reads) | shared (dsh scans `~/.agents/skills`) | none: presets are plugin rows, not files | skill `~/.dsh/skills/aw-start` | see [DeepSeek Harness](#deepseek-harness-060) |

MiMo loads only the first existing file of `$MIMOCODE_CONFIG_DIR/AGENTS.md`, `~/.config/mimocode/AGENTS.md` and `~/.claude/CLAUDE.md`. Creating its own `AGENTS.md` would silently stop it from reading Claude's file, so the block goes to `~/.config/mimocode/AGENTS.md` only when that file already exists or there is no `~/.claude/CLAUDE.md`; otherwise MiMo receives the rule through `CLAUDE.md` (install the `claude` client too). `install`/`verify` print a notice with the current situation. MiMo and Command Code also read `~/.claude/skills`, so with `claude` installed they may list `aw-workflow` from two folders (same content).

Hooks of extra clients call `<store>/bin/node <store>/runtime/hook.mjs --client NAME`; the runtime adapts input (`workspacePaths` for agy) and output per client. Claude and Codex keep their previous command, so upgrading does not change their hook text. The PreToolUse validation guard (0.5.0) reuses the same command with a shell-tool matcher; see [Validation guard](#validation-guard-050). Reviewer read-only enforcement exists only for Claude, Codex, OpenCode and MiMo; elsewhere it is an instruction.

### Evidence (23 November 2026)

Every client: generated files, `--user-root` tests (install → verify → edits outside owned parts → sync → uninstall keeps them) and hook output tests. Real-client runs used an isolated install and never touched the real configuration (checksums of the real config files were compared before and after).

| Client | Native discovery without a model | Real headless session |
| --- | --- | --- |
| agy | `agy agents` lists aw-reviewer, aw-worker | **Verified.** `agy --gemini_dir=<isolated>/.gemini -p ...` (real sign-in, isolated config): quoted the `GEMINI.md` block (`user_global`) and the SessionStart hook text, listed the aw-start/aw-workflow skills; ran `npm test` directly and reported exit 7; after `disable --project` the hook text was gone (0 occurrences) while the rule stayed |
| MiMo | `mimo agent list` lists both subagents; `mimo debug skill` lists aw-workflow; `mimo debug config` loads the plugin without error | **Verified** with `MIMOCODE_CONFIG_DIR=<isolated>`: returned a canary placed in the isolated `AGENTS.md` that holds the block and quoted the plugin's gate sentence; ran `npm test > log 2>&1; echo "exit=$?"` (an allowed form) and reported 7; after `disable` the gate sentence was NONE. A first, open question was answered with "only the skill"; model self-reports are not reliable on their own |
| Pi | — | **Hook verified** with `pi -p -e <isolated>/extensions/agent-workflow.js`: quoted the injected message (`customType: agent-workflow`); none after `disable`. The global `~/.pi/agent/AGENTS.md` needs the real agent dir (sign-in lives there): run by the owner after the global sync |
| Command Code | `commandcode skills list` lists aw-workflow | pending global sync: settings and sign-in share `~/.commandcode` |
| Qwen | none offline | pending global sync: `QWEN_HOME` also moves the sign-in |
| Kimi | `kimi doctor`: config valid | pending global sync: `KIMI_CODE_HOME` also moves the sign-in |

**Antigravity headless hang.** On this Mac `agy -p` waited until its print timeout because `context7_api` and `huggingface` stay "still connecting" (agy log `mcp_manager.go:1014`) although both have `"disabled": true` in `~/.gemini/config/mcp_config.json`; other disabled servers do not block. That is an agy 1.5.15 behavior, and `--settings` accepts no MCP key. Workaround without touching the global config: the hidden `--gemini_dir` flag points agy at another `.gemini` folder while the keyring sign-in stays valid (a temporary `HOME` loses it). For daily use the owner can remove those two entries from `~/.gemini/config/mcp_config.json` instead of keeping them disabled; Agent Workflow does not change it.

Not added: ZCode and Cursor Agent (owner's decision). Factory Droid (`~/.factory`) and GitHub Copilot CLI (`~/.copilot`) have config folders but no binary on this Mac; Rulesync maps them to `~/.factory/{AGENTS.md,skills,droids,commands}` and `~/.copilot/{copilot-instructions.md,skills,agents}`, so they can be added once a binary allows verification. DeepSeek Harness was added in 0.6.0. Zed keeps its global rules in the Rules Library database (`~/.config/zed/prompts/prompts-library-db.0.mdb`, LMDB) and Warp keeps rules in the app/cloud: neither has a file this installer can own safely. The Claude Code and Codex VS Code extensions use `~/.claude` and `~/.codex`, already covered.

## Client status (0.6.1)

One table with what works, what does not and why, from real runs in the owner's home (23 Nov 2026; `060-*` logs and the 0.5.1 pending-tests report) plus the isolated 0.6.1 checks. "Rule" is the managed block in the client's global file; "Hook" the session/subagent reminder; "Guard" the PreToolUse validation guard; "MCP" a project `aw-*` server used by the model.

| Client | Rule | Hook (session / subagent) | Guard | Project MCP | Reviewer read-only | Not working / why |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | ✅ | ✅ / ✅ | ✅ on by default (real: blocked, then exit 7) | ✅ `.mcp.json` + `enabledMcpjsonServers` | ✅ Edit/Write/NotebookEdit disallowed | Bash is still available to the reviewer (instruction only there) |
| Codex CLI | ✅ | ✅ / ✅ | ✅ with `--trust-codex` (real: blocked, then exit 7) | ✅ `.codex/config.toml`, trusted project | ❌ role sandbox ignored; use `codex exec -s read-only` | Codex 0.171 subagents inherit the parent sandbox |
| OpenCode V2 | ✅ | — (plugin is guard only) | ✅ plugin | ✅ `opencode.json(c)` | ✅ edit/notebook_edit denied | no session reminder by design |
| Qwen Code 0.28.4 | ✅ | ✅ / ❌ | ✅ | ✅ `.qwen/settings.json` + `qwen mcp approve` | instruction only | Qwen runs SubagentStart but does not pass its text to the subagent |
| Kimi Code 2.7.3 | ✅ | — / — | ✅ (real: blocked, after `disable` runs, exit 7) | ✅ since 0.6.1: `.mcp.json`, trusted folder or `KIMI_CODE_TRUST_WORKSPACE=1`, warmed launcher cache (`connect --approve`) | instruction only | Kimi discards SessionStart output; in 0.6.0 its `-p` sessions froze the tool list before our servers answered (see [Kimi tool list race](#kimi-tool-list-race-061)) |
| Antigravity (agy) 1.5.15 | ✅ | ✅ / — | ✅ (real: blocked, then exit 7) | ✅ workspace plugin; headless needs `mcp(agent-workflow-mcp_aw-<tool>/*)` (0.7.0: `--agy-allow`) | instruction only | MCP permission rule is user-level; no project-level rule |
| Command Code 1.93 | ✅ | — in `-p` / — | ✅ | ✅ `.mcp.json` | instruction only | `-p` does not run SessionStart |
| Pi 1.6 | ✅ | ✅ / — | ✅ | ✅ `.pi/mcp.json`, trusted project or `pi -a` | — (no subagents) | — |
| MiMo Code 0.1.16 | ✅ (own `AGENTS.md` or Claude's) | ✅ / — | ✅ | ✅ `mimocode.json(c)` | ✅ since 0.6.0 (`mode: all`, edit/notebook_edit denied) | — |
| DeepSeek Harness 0.2.2-rc.5 | ✅ | ✅ / ✅ (bridge + peer) | ✅ (real: blocked, then exit 7) | ✅ since 0.6.1 without `--patch` (profile rows read `.dsh/agent-workflow-mcp.json`) | — (presets are not files) | hooks need `@deepseek-ai/dsh-hook-protocol` in the profile (0.7.0: `--dsh-plugins` adds it); web profile: servers connect, model use not tested |

## All-in automation (0.7.0)

The manual steps of 0.6.1 are opt-in flags; `--all-in` turns on each one whose client is in `--clients`. Every change is recorded and reversed by `uninstall`/`disconnect`; nothing runs at session startup.

| Flag | What it does | Ownership and removal |
| --- | --- | --- |
| `install`/`sync --global --trust-codex` | as in 0.5.1: trusts only the Agent Workflow Codex hooks through `codex app-server` | Codex writes its own `config.toml` |
| `--dsh-plugins` | for each profile in `<DSH_HOME>/profiles` without the bridge and its peer, runs `dsh plugin --profile P add -w <pkg>@<v>` with `v` = `dsh --version` (the bridge's pinned peer version when the bridge is already there), then the sync mounts the hooks row. `-w` is pnpm's `--workspace-root`: a profile is a pnpm workspace root | manifest `dshPlugins` lists what was added; `uninstall` runs `dsh plugin --profile P remove -w <pkg>` for those still at the recorded version. A package already present at another version is never replaced (the profile is skipped and reported). A failed add removes what it added and installs nothing. `AGENT_WORKFLOW_DSH=PATH|none` picks or disables the executable |
| `--agy-allow` | adds `mcp(agent-workflow-mcp_aw-serena/*)`, `…aw-codegraph/*`, `…aw-context7/*` to `permissions.allow` of `~/.gemini/antigravity-cli/settings.json` | manifest entry `kind: "allow"`; entries already there are adopted (`adopted`), never duplicated; `verify` reports `allow-entry-missing`; `uninstall` removes all three and the containers it created |
| `connect --exclude` | adds the untracked generated paths that nothing ignores yet (checked with `git check-ignore --no-index`, so manual lines like `.codex/` or `.gitignore` rules count) to `git rev-parse --git-path info/exclude`, in a `# agent-workflow:begin` block | receipt `exclude` (path, patterns, block hash); later connects keep it; `disconnect` removes the block; an edited block stops `disconnect`. The file is shared by every worktree: a worktree's connect does not touch the clone's block and adds nothing that block already covers |
| `connect --all-in` | `--approve --exclude` | as above |

**Kimi folder trust is not automated.** Kimi Code 2.7.3 stores trust in internal files (`~/.kimi-code/workspace-trust/wd_<name>_<sha256(path)[:12]>`, JSON `{root, trustedAt}`) with no CLI command; the documented options are the interactive "Trust this folder", `KIMI_CODE_TRUST_WORKSPACE=1` (per process, no persistent record) and `[workspace] require_trust = false` (every folder). Writing the private file or turning trust off globally is not an official per-folder mechanism, so `connect --approve` still lists it.

Evidence (23 Nov 2026, isolated, real home untouched):

- **dsh 0.2.2-rc.5 (real binary).** `DSH_HOME` = a copy of the headless profile without the two packages: `install --global --clients dsh --dsh-plugins --user-root R` ran `dsh plugin --profile headless add -w @deepseek-ai/dsh-hooks-claude-code@0.2.2-rc.5 @deepseek-ai/dsh-hook-protocol@0.2.2-rc.5` (pnpm added both to the profile's `package.json`), the block got the hooks row, `verify` exit 0; `uninstall` ran `remove -w`, which took both out of `package.json`, and restored `cordis.patch.yml` to `[]`. Checksums of the real `~/.dsh/profiles/*/{package.json,cordis.patch.yml,pnpm-lock.yaml}` were identical before and after. dsh runs pnpm through corepack, whose cache is under `HOME`: with `HOME` redirected to the user-root the add failed (`Cannot find module …/corepack/…/pnpm.cjs`), so the child gets `DSH_HOME` only.
- **agy.** A copy of the owner's `settings.json` that already had the three entries (added by hand): `sync --clients agy --agy-allow` adopted them (3 entries, none duplicated, other keys kept); `uninstall` removed them and kept `model` and `trustedWorkspaces`.
- **exclude.** A repository with a copy of a real `info/exclude` holding hand-written lines (`.mcp.json`, `.codex/`, `.qwen/`, `.dsh/`…): `connect --clients all --all-in` reported all nine paths as `alreadyIgnored`, wrote no block, `git status` showed nothing; `disconnect` left the file byte-identical.
- Tests: `tests/all-in.test.mjs` (fake `dsh` in `PATH`, temporary user roots and repositories, worktree case).

## Real-home evidence (23 Nov 2026)

The coordinator ran these with the real global install (0.5.1 for A–D, 0.6.0 for the `060-*` runs), one sample per cell:

- **Opt-out (`disable --project`)**: Qwen, Kimi, Command Code, Codex, agy, Pi, MiMo and OpenCode lost the hook text and stopped blocking after `disable`, ran `npm test; echo "EXIT=$?"` and saw `EXIT=7`; the rule block stays (global file). With the project enabled the guard blocked it in Qwen, Kimi, Command Code, Pi, MiMo and OpenCode (Codex and agy had no guard in 0.5.1).
- **Guard, 0.6.0**: dsh, Claude, Codex and agy blocked the compound command with `AW_VALIDATION_COMPOUND` and then reported exit 7.
- **Project MCP, 0.6.0**: `aw-codegraph` `agent_workflow_symbols` returned `lib/validation-guard.mjs:134` in Claude, Codex, Qwen, Command Code, Pi, MiMo, agy and OpenCode, and in dsh only with `--patch` (fixed in 0.6.1). Kimi saw no MCP tools (fixed in 0.6.1).
- **Subagents (SubagentStart)**: Claude and Codex subagents quoted the hook text; Qwen's did not (the hook runs, its text is not passed on).
- **Reviewer**: Claude and OpenCode refused to write; Codex refused only by instruction (sandbox inherited); MiMo via `mimo run --agent` fell back to the default agent and wrote a file (fixed in 0.6.0 with `mode: all`).
- **Compaction (manual)**: Claude and Qwen kept the rule and the session marker after `/compact` and `/compress`; Claude's PreCompact `systemMessage` stays in the transcript as `<local-command-stdout>`; Qwen uses it as compaction instructions. Automatic compaction was not tested.

## Kimi tool list race (0.6.1)

Kimi Code 2.7.3 starts the project MCP servers and binds the agent profile in the same few milliseconds; the tool list (`llm.tools_snapshot`) sent for the whole `kimi -p` session contains only the MCP tools discovered before that bind (`profile.bind` in the session `wire.jsonl`). In the owner's 0.6.0 runs `profile.bind` came first and the snapshot had 26 tools, none `mcp__*`, although Kimi had connected all three servers (`mcp.tools_discovered` 2 ms later). It is not trust (`KIMI_CODE_TRUST_WORKSPACE=1` works; the servers started) and not the file format: a minimal Node MCP server that answers at once won 3/3, while the real servers need 0.1 s (CodeGraph, two Node wrappers), 0.3 s (Context7) and 0.9 s (Serena). `KIMI_CODE_EXPERIMENTAL_TOOL_SELECT=1` waits for the servers but still announced no loadable tools.

Fix: `agent-workflow mcp` now starts a light front (`lib/mcp-front.mjs`: Node builtins and `gate.mjs` only) that answers `initialize` and the first `tools/list` from `<store>/mcp-cache/<tool>.json`, the real server's last answers for that package version and requested protocol version, and passes every message to the real server. Replies to requests it already answered refresh the cache; changed tools send `notifications/tools/list_changed`. Opted-out projects never use the cache. A warm cache answers in about 30 ms; `connect --approve` with Kimi warms it (any previous start of the server by another client also does, for its protocol version). Evidence: clone of the owner's repo, the three default servers, `KIMI_CODE_TRUST_WORKSPACE=1 kimi -p`: 5/5 runs called `mcp__aw-codegraph__agent_workflow_symbols` and got line 134, with all three servers discovered before `profile.bind` and 75 tools in the snapshot.

## dsh rewrites its own patch file (0.7.1)

**What happened (23 Nov 2026, owner's home, 0.7.0).** Running `dsh --profile web` rewrote `~/.dsh/profiles/web/cordis.patch.yml`. The writer is `@deepseek-ai/dsh-config-editor`: when a setting is saved (here `ui-settings-general.welcomeNoticeVersion`), it runs `yaml` 2.9.1 `parseDocument`, then `document.add(row)` (or `setIn` for an existing row), then `String(document)`. Comments and our markers survive, but every double-quoted `!!js` scalar is folded at 80 columns. The new row is appended at the end of the list, which put it inside our markers, because the block was the last thing in the file. The data was unchanged, but the byte hash did not match. `verify` reported `managed-block-drift`, and `sync` threw `Edited/unowned managed block`, which aborted the sync of every client.

**0.7.1:**

- **Rows that dsh does not fold.** `!!js` expressions (and `configPath`) are now written as `|-` literal blocks. `yaml` keeps literal blocks as they are when it re-serializes. Running the dsh editor's write path on a 0.7.1 file leaves every byte of our rows unchanged; the only difference is dsh's own row.
- **Compared by content.** When the block's bytes differ from the record, it is split into its top-level items, and each item is parsed with `js-yaml` 4.3.2, the version dsh's loader uses, with the same `!!js` tag. Our item is the `insert:` list whose rows all have `agent-workflow-*` ids. If its data matches what was recorded, the block is still ours. The record is `dataHash`, new in 0.7.1; records from 0.6.1/0.7.0 are compared with the rows this version writes. Any other item inside the markers is dsh's or yours:
  - `verify` stays `ok` and adds a notice.
  - `sync` writes our block again and moves those items right after the end marker, where later dsh writes stay outside the block.
  - `uninstall` leaves them where the block was.
- **Real edits inside the block are still drift.** A row that really changed is still `managed-block-drift`.
- **One file no longer stops the sync.** On an existing installation, a file that cannot be updated (edited owned part, collision, invalid config) is skipped. The result lists it under `skipped` with the error and the exact fix, and exits 1. Its recorded entry is kept, and every other file is still synced. A first install is still all-or-nothing.
- **No `include` for now.** `@deepseek-ai/cordis-plugin-include` (1.1.0) could keep our rows in a file of our own, but it also writes tree changes back to its file ("writes updates back when the file is writable"). It would therefore not be safe from rewrites either, and it would add another loader layer to every profile, so it is not used.

**Evidence (isolated `DSH_HOME` with copies of the owner's web and headless profiles, without credentials or sessions; the real `~/.dsh` was not touched):**

- 0.7.1 was installed there. The real `dsh --profile web --no-open --host 127.0.0.1 --port 0` was started and stopped three times; it printed its URL, logged no errors, and `verify` stayed `ok` each time.
- Fetching the page without a browser does not save a setting, so the editor's write path was applied with dsh's own `yaml` library (`parseDocument` → `add`/`setIn` → `String`):
  - After the `add`, our rows were byte-identical and only the dsh row was added, inside the markers. `verify` was `ok` with the notice.
  - `sync` moved the row out.
  - A second dsh write (`setIn`) changed only that row, and `verify` was `ok` with no notice.
  - `uninstall` left only the header comments and the dsh row.
- `dsh --profile web --dump-config` in a connected project lists our rows as `!!js` expressions with the same text.
- `tests/dsh-reformat.test.mjs` uses the real rewritten file as a fixture (`tests/fixtures/dsh-web-rewritten.cordis.patch.yml`; only the hooks path is replaced): adoption, adoption of a legacy record without `dataHash`, moving the row out, uninstall, a real edit, and a skipped file while the other files are synced.

## DeepSeek Harness (0.6.0)

DeepSeek Harness 0.2.2-rc.5 (`dsh`, `@deepseek-ai/dsh`) composes each profile (`$DSH_HOME/profiles/<name>`, default `~/.dsh`) from bundle layers plus the user layer `cordis.patch.yml`; `cordis.yml` is never edited. What Agent Workflow installs with `--clients dsh` (or `all`):

- **Rule:** managed block in `~/.dsh/AGENTS.md`. `dsh-agent-instructions` loads `$DSH_HOME/AGENTS.md`, then `$DSH_AGENTS_HOME/AGENTS.md` (default `~/.agents/AGENTS.md`), then the project chain. `~/.agents/AGENTS.md` is not used: no other installed client reads it, and writing it would add a second copy for dsh.
- **Skills:** `dsh-skill-filesystem` scans `~/.dsh/skills` and `~/.agents/skills`, so the shared `aw-workflow` arrives without a copy; `aw-start` goes to `~/.dsh/skills/aw-start`. A natively set `DSH_AGENTS_HOME` other than `~/.agents` produces a notice.
- **Roles and commands:** none. dsh agent presets are plugin rows (`dsh-agent-preset`), and commands are registered by plugins; neither is read from files.
- **Hooks:** the official bridge `@deepseek-ai/dsh-hooks-claude-code` runs one Claude-format `hooks.json` (read once at startup). Agent Workflow owns `<store>/dsh/hooks.json` (SessionStart and SubagentStart context, PreToolUse guard with matcher `^bash$`; command `<store>/bin/node <store>/runtime/hook.mjs --client dsh`) and adds, at the end of each profile's `cordis.patch.yml`, a managed YAML block:

  ```yaml
  # agent-workflow:begin (managed; do not edit)
  - insert:
      - id: agent-workflow-hooks
        name: '@deepseek-ai/dsh-hooks-claude-code'
        config:
          configPath: "<store>/dsh/hooks.json"
  # agent-workflow:end
  ```

  A plain `- name: …` row without `id` is rejected by the loader ("id is required for non-insert patches"); new rows go in an `insert` list. A file that is only `[]` gets the block in its place and gets `[]` back on uninstall; layouts other than a top-level block list are never edited. Edits outside the block survive `sync` and `uninstall`; an edited block is drift.
- **Peer dependency.** The bridge imports `@deepseek-ai/dsh-hook-protocol` (same version), which the `dsh` package does not ship and pnpm does not add (`autoInstallPeers: false`). With only the bridge, the entry fails to import and dsh boots with "1 entry did not activate"; on this Mac it even resolves an old 0.1.2-rc.1 copy from `~/.dsh/profiles/node_modules` and fails on a missing export. The installer mounts the block only in profiles that contain both packages at matching versions and prints, for the others: `dsh plugin --profile <p> add -w @deepseek-ai/dsh-hooks-claude-code@0.2.2-rc.5 @deepseek-ai/dsh-hook-protocol@0.2.2-rc.5`, then `agent-workflow sync --global`. It installs them only with `--dsh-plugins` or `--all-in` (0.7.0, see [all-in automation](#all-in-automation-070)). A profile whose packages disappear later keeps its owned block and gets a notice.

Evidence (23 Nov 2026, `DSH_HOME` = copy of the headless profile, real DeepSeek API key from the Keychain, never printed): the canary placed in the isolated `~/.dsh/AGENTS.md` was quoted (rule loaded); with only the bridge the entry did not activate (no hook text, the model ran `set -o pipefail; npm test 2>&1 | tail -5; echo …` unblocked); after adding the peer: SessionStart text quoted, the compound command blocked and retried in an allowed form (exit 7), a subagent quoted the SubagentStart sentence, and after `disable --project` neither context nor blocking appeared. The real `~/.dsh` was not modified (checksums before/after).

## Project MCP (0.6.0)

`connect --project ROOT [--clients LIST|all] [--tools …] [--approve]` writes `aw-<tool>` entries (launcher `node bin/agent-workflow.mjs mcp --tool <tool> --project ROOT`) where each client reads project MCP servers. Same contract as 0.3.x: receipts in `<store>/connections`, idempotent, owned entries only, user entries and comments kept, collisions refused, `disconnect` restores, `disconnect --prune`, worktrees served through `mcpProject`. Receipts are now one entry per file (`schemaVersion: 2`); 0.5.x receipts still disconnect.

| Client | Project file and shape | Approval / trust before servers start | `--approve` | Real run (fixture with `lib/validation-guard.mjs`, tool `agent_workflow_symbols` of `aw-codegraph`, expected line 134) |
| --- | --- | --- | --- | --- |
| Claude Code | `.mcp.json` `mcpServers` | asks once per server | `enabledMcpjsonServers` in `.claude/settings.local.json` (only names it added are removed) | **verified** `claude -p` (line 134) |
| Command Code 1.93 | `.mcp.json` (shared; `commandcode mcp add -s project` writes there; Claude shape is listed as enabled) | none observed | — | **verified** `commandcode -p --trust` (134) |
| Kimi Code 2.7 | `.mcp.json` at the project root (Kimi reads it; `.kimi-code/mcp.json` is its own file) | untrusted folder: servers skipped with a warning; the tool list of a `-p` session is frozen a few ms after the servers start ([race](#kimi-tool-list-race-061)) | `--approve` warms the launcher cache (0.6.1); folder trust stays `KIMI_CODE_TRUST_WORKSPACE=1` or "Trust this folder" | 0.6.0: one isolated success, then **failed in the owner's home** ("no MCP tools"); 0.6.1 front + cache: **verified** 5/5 in a clone of the owner's repo with the three default servers (134) |
| Codex CLI | `.codex/config.toml` managed block | project must be trusted in the user `config.toml` | — | **verified** `codex exec` with an isolated `CODEX_HOME` trusting the fixture (134) |
| OpenCode V2 | `opencode.json(c)` `mcp.servers` | — | — | earlier releases |
| Qwen Code 0.28 | `.qwen/settings.json` `mcpServers` | "Pending approval" until approved; approval bound to the entry hash in `$QWEN_HOME/mcpApprovals.json` | runs `qwen mcp approve <name>` in the project | **verified** `qwen -p --yolo` with an isolated `QWEN_HOME` (134) |
| Pi 1.6 | `.pi/mcp.json` `mcpServers` | ignored until the project is trusted | — (`pi -a`/`--approve` per run) | **verified** `pi -a -p` (134) |
| MiMo Code 0.1.16 | first existing of `mimocode.json`, `mimocode.jsonc`, `.mimocode/mimocode.json(c)` (default `mimocode.json`), `mcp.<name> = {type: local, command: [...]}` | none observed | — | **verified** `mimo run` (134) |
| Antigravity 1.5.15 | no project MCP file: a workspace plugin `.agents/plugins/agent-workflow-mcp/{plugin.json,mcp_config.json}` (whole directory owned) | headless runs deny MCP tools; servers are namespaced `agent-workflow-mcp_aw-<tool>` | — (user rule `mcp(agent-workflow-mcp_aw-<tool>/*)` in `~/.gemini/antigravity-cli/settings.json` `permissions.allow`; a project `.gemini/settings.json` is not read) | **verified** with an isolated `--gemini_dir` holding that rule (134); without it: "a tool required the mcp permission … auto-denied" |
| dsh 0.2.2-rc.5 | `.dsh/agent-workflow-mcp.json` (`mcpServers`, written by connect, 0.6.1); dsh has no project layer, so each profile block installed by sync has one `@deepseek-ai/dsh-mcp-client` row per module that is enabled only when the directory dsh starts in has that file listing the server (`!!js` reads `command`/`args` from it) | none: loaded when dsh starts in the project, no `--patch` | — | **verified** `dsh --profile headless` in a clone of the owner's repo without flags (134); `--profile web`: the three servers connected (`dsh-mcp-client` initialize + tools/list), model use through the web UI not tested. 0.6.0 used `.dsh/agent-workflow.cordis.yml` + `--patch`; a later connect retires that file when unedited |

Global-only registration was not used anywhere: every client above has a project-scoped file. `--approve` uses only the clients' own non-interactive mechanisms and never bypasses a prompt; the connect result lists what remains for the others (`approval`). Kimi and dsh start MCP servers with a scrubbed environment, so the launcher now puts its own Node directory in the tool `PATH` (npm modules such as `codegraph-mcp` start with `#!/usr/bin/env node`). Qwen and MiMo stamp files that connect created (`$version`, `$schema`); a file left with only such keys is removed on disconnect. Keep registrations that are local to one machine out of commits: add `.mcp.json`, `.qwen/settings.json`, `.pi/mcp.json`, `mimocode.json`, `.agents/plugins/agent-workflow-mcp/`, `.dsh/agent-workflow.cordis.yml`, `.codex/config.toml`, `opencode.jsonc` and `.claude/settings.local.json` to `.git/info/exclude` as needed (it is not shared and does not touch `.gitignore`).

## Reviewer read-only per client (0.6.0)

| Client | Enforcement |
| --- | --- |
| Claude Code | `disallowedTools: [Edit, Write, NotebookEdit]`; the reviewer refused edits (owner test) |
| Codex CLI 0.171 | **not enforced for the role**: the subagent inherits the parent sandbox and ignores the role's `sandbox_mode = "read-only"` (owner test; `danger-full-access` parent). The role text now says so and `verify`/`install` print a notice; a review that must be read-only runs as a separate `codex exec -s read-only "<review task>"` |
| OpenCode V2, MiMo | `mode: all` (usable as primary, e.g. `mimo run --agent aw-reviewer`, and as subagent), `edit` and `notebook_edit` denied. 0.5.x used `mode: subagent`: `mimo run --agent aw-reviewer` fell back to the default agent and wrote a file. **Verified** with MiMo 0.1.16 (`MIMOCODE_CONFIG_DIR` isolated): listed as `aw-reviewer (all)`, ran as primary, exposed no write/edit/notebook tool and created nothing. OpenCode not rerun |
| Others | instruction only |

Claude Code `PreCompact`: the `systemMessage` of the hook enters the transcript after a manual `/compact` (owner test), not only the user's view.

## Codex hook approval

Codex 0.171.0 stores approval per hook in `~/.codex/config.toml` as `hooks.state."<hooks.json>:<event>:<group>:<handler>".trusted_hash`. It runs a hook when that hash equals the hook's current hash (a normalized TOML identity of event, matcher and handler) and `enabled` is not `false`; a missing `enabled` means enabled (`hook_enabled` in `codex-rs/hooks/src/engine/discovery.rs`). A sync that changes a hook command leaves a stale hash (`trustStatus: modified`) and Codex skips the hook until it is reviewed.

Since 0.5.1, `verify`/`doctor` read `trustStatus` and `enabled` from `codex app-server` `hooks/list` when Codex is available, and warn with `codex-hook-untrusted`, `codex-hook-modified` or `codex-hook-disabled` (they do not change `ok`). Without Codex they read `config.toml` and report only a missing `trusted_hash` or `enabled = false`; a stale hash is not detectable that way (`hashChecked: false`). 0.5.0 also warned `codex-hook-not-enabled` when `enabled = true` was absent, a false positive: Codex ran those hooks.

Fix: `agent-workflow trust --client codex` (or `sync --global --trust-codex`), which uses the same app-server requests as the TUI `/hooks` (`hooks/list`, then `config/batchWrite` `hooks.state` upsert, `write_hook_trusts` in `codex-rs/tui/src/hooks_rpc.rs`) for the Agent Workflow hooks only, or `/hooks` by hand. `--dangerously-bypass-hook-trust` is never used.

Evidence: with the real Codex 0.171.0 and an isolated `--user-root` (HOME and CODEX_HOME temporary), `trust --client codex` turned the three Agent Workflow hooks from `untrusted` to `trusted`, a third-party hook in the same `hooks.json` stayed `untrusted`, `config.toml` got only `trusted_hash` entries (no `enabled`) and `verify` returned no warnings. Before this release the coordinator ran the same requests by script on the owner's Codex: the hooks went from `modified` to `trusted` and `codex exec` without bypass saw the hook context. Tests use a fake `codex` that speaks the protocol.

## Validation guard (0.5.0)

The bounded pre-execution guard for recognized compound test/build commands (including `node <test file>` and commands identical to a single-command `test`/`check`/`build` script of the working directory's `package.json`) runs from one installed runtime, `shellGuard` in `<store>/runtime/gate.mjs` with `validation-guard.mjs`. It checks the project opt-out on every call, never executes or logs the command, and allows the two status-keeping forms (`set -o pipefail; CMD | tail`, `CMD > log 2>&1; echo "exit=$?"`), also after `cd DIR &&`. Clients without a pre-tool hook keep the rule as advisory text.

| Client (version checked) | Where | Shell tool / matcher | Denial | Real headless evidence (23 Nov 2026, isolated install) |
| --- | --- | --- | --- | --- |
| OpenCode V2 | plugin `shell.create.before` | every shell call | thrown `AW_VALIDATION_COMPOUND` error | earlier releases ([repairs](repairs-2026-11-13.md)) |
| Qwen Code 0.28.4 | `~/.qwen/settings.json` `PreToolUse` | `run_shell_command` | `hookSpecificOutput.permissionDecision: "deny"` + `permissionDecisionReason` | **not run**: project hooks need interactive approval (`isProjectHooksApprovalGated`) and `QWEN_HOME` moves the sign-in. Hook runtime tested with Qwen's input shape (`tool_input.directory` honored) |
| Kimi Code 2.7.3 | `~/.kimi-code/config.toml` managed TOML block, `[[hooks]]` | `^Bash$` | same JSON (Kimi maps `permissionDecision: deny` to a block; exit 2 also works) | **verified in the owner's home** (0.5.1 global install): `npm test; echo "EXIT=$?"` was blocked (the model even added ` ;`), and after `disable --project` it ran and showed `EXIT=7`. Hook runtime also tested with Kimi's input (no `cwd` field: the hook process cwd is the session directory) |
| Command Code 1.93.2 | `~/.commandcode/settings.json` `PreToolUse`, appended after existing entries | `^SHELL$` (case-insensitive regex on the display name of `shell_command`) | same JSON; Command Code adds "Blocked by hook policy…" | **verified** with a project `.commandcode/settings.json` and `--trust`: `-p` mode does run `PreToolUse`. The model's `npm test; echo "EXIT_CODE=$?"` was blocked twice, then `npm test` ran directly; reported exit 7 |
| Pi 1.6.0 | extension `tool_call` | `bash` | `{block: true, reason}` | **verified** with `pi -e <isolated extension>`: `cd <fx> && npm test; echo …` and `cd <fx> && npm test > log 2>&1; echo …` were blocked (cd chain), then `npm test`; reported exit 7 |
| MiMo Code 0.1.16 | plugin `tool.execute.before` | `bash`, `exec_command` (`command`/`cmd`, `workdir`) | `output.cancel = true`, `cancelReason` (shown to the model as the tool output) | **verified** with `MIMOCODE_CONFIG_DIR=<isolated>`: P2 blocked `npm test; ec=$?; echo …; exit $ec`, then `npm test`, then the allowed `npm test > log 2>&1; echo "exit=$?"`; reported 7. P3 (forced `npm test; echo "exit=$?"`) same pattern. A first P2 attempt stalled after reading `package.json` and hit the 240 s timeout before any shell call; the rerun completed |
| Claude Code | `~/.claude/settings.json` `PreToolUse` (**on by default** since 0.6.0; `--guard none` removes it) | `Bash` (no working-directory option; `cd DIR && CMD` is allowed) | same JSON; Claude shows "PreToolUse:Bash hook error: AW_VALIDATION_COMPOUND…" and does not run the command | **verified** with `claude -p --settings <isolated PreToolUse>` (0.5.0: `cat package.json; npm test; echo …` blocked, then `npm test`, exit 7). 0.6.0, package in `./web`: the model ran `cd web && npm test 2>&1 | tail -5; exit ${PIPESTATUS[0]}`, which 0.5.x allowed and which **hid exit 7** (Claude runs commands in zsh, which has no `PIPESTATUS`); with 0.6.0 that form is blocked and the retry `set -o pipefail; npm --prefix web test 2>&1 | tail -5` reported exit 7 |
| Codex CLI 0.171.0 | `~/.codex/hooks.json` `PreToolUse` (with `--trust-codex`, or `--guard codex`) | `Bash` (`tool_input.command`; Codex runs `/bin/zsh -lc`) | same JSON (documented by Codex) | **verified** (0.6.0) with `CODEX_HOME=<isolated>`: `install --clients codex --trust-codex` added and trusted the four hooks (PreToolUse included); `codex exec` submitted `cd web && npm test 2>&1 | tail -5` → "Command blocked by PreToolUse hook: AW_VALIDATION_COMPOUND…", then `npm test` with workdir `web`, exit 7. Without being told to test the hook, Codex followed the rule and never sent the compound command |
| Antigravity (agy) 1.5.15 | `~/.gemini/config/hooks.json` group `agent-workflow`, `PreToolUse` matcher group (0.6.0) | `run_command` (`toolCall.args.CommandLine`, `Cwd`) | `{"decision": "deny", "reason": …}` (agy: "tool call denied by pre-tool hook: …") | **verified** with `agy --gemini_dir=<isolated copy>`: forced `npm test; echo "exit=$?"` was denied with the reason, then `npm test`, exit 7; SessionStart text still quoted |
| DeepSeek Harness (dsh) 0.2.2-rc.5 | bridge hooks.json (`<store>/dsh/hooks.json`) `PreToolUse` | `^bash$` (`tool_input.command`, `workdir`) | same JSON; the bridge maps `deny` to a tool error with the reason | **verified** with `DSH_HOME=<isolated copy of the headless profile>` after adding the peer: `set -o pipefail; npm test 2>&1 | tail -5; echo "EXIT_CODE=${PIPESTATUS[0]}"` blocked, then `set -o pipefail; npm test 2>&1 | tail -5` → `[exit code: 7]` |

**0.6.0 defaults and false positives.** 0.5.x kept Claude and Codex opt-in because Claude's Bash tool has no working-directory option (a `cd dir && npm test` chain was blocked) and Codex re-asks for approval of every new hook. 0.6.0 allows a leading `cd DIR &&` (the status of `a && b` is visible: a failed `cd` stops the chain with its own failure) and evaluated 50 realistic agent commands (`tests/fixtures/guard-battery.mjs`: 22 inspection commands with pipes, 11 direct validations and status-keeping forms, 17 status-hiding validations) through the installed Claude and Codex hooks: **0 false positives and 0 false negatives** against the expected outcome. The Claude guard is therefore on by default; Codex gets it when `--trust-codex` approves it (otherwise Codex would skip an untrusted hook anyway). Two outcomes are deliberate and debatable: `npm run build && npm test` and `npm ci && npm test` are blocked ("one direct command"; run them as two calls). The choice is recorded in the manifest (`guard`); a 0.5.x manifest without it keeps the PreToolUse entries it has, and one with none gets the 0.6.0 default on the next sync. Adding or removing the `PreToolUse` entry leaves the command and the array position of the existing SessionStart/SubagentStart/PreCompact groups unchanged, so their Codex approval stays valid. 0.4.0 manifests (hook entries without `events`) upgrade in place.

**`exit ${PIPESTATUS[0]}` is no longer an allowed form (0.6.0).** `PIPESTATUS` exists in bash only. Claude Code and Codex run commands in the user's shell, zsh on macOS, where `CMD | tail; exit ${PIPESTATUS[0]}` exits with status 0 (checked: `zsh -c 'false | tail; exit ${PIPESTATUS[0]}'` → 0, bash → 1). The guard now blocks it and its reason names the two forms that hold in both shells: `set -o pipefail; CMD | tail` and `CMD > log 2>&1; echo "exit=$?"`. The rule text changed accordingly, so every client's rule block changes on the 0.6.0 sync.

Kimi caveat: Kimi can serialize its config section back to `config.toml` (`hooksToToml`); if that drops the comment markers, `verify` reports `managed-block-drift`/missing and `uninstall` refuses; remove the Agent Workflow `[[hooks]]` table by hand. Observed model behavior: Qwen chose `npm test > log 2>&1; status=$?; echo …`; that variant is not one of the three allowed forms and is blocked, so the model must retry.

This is not a general permission sandbox. No model/effort, permission, authentication, compaction or unrelated plugin setting is changed. Reviewer read-only instructions are not a permission sandbox. Global files may remain in discovery when project-disabled; a zero-load guarantee is not claimed. Long-running clients can retain previously loaded policy until reload.

File generation, config parsing, hook invocation and native model-driven behavior are separate evidence levels. `verify` checks owned bytes/registrations only. No assertion that all IDEs execute these instructions identically or that a live model became faster. Diagnostics and tests must not read private prompts or credentials.

Initial read-only diagnostics (historical): Codex's prompt-input diagnostic included the global rule and workflow skill; it did not expose the custom-role catalog in that output, so native role dispatch is not claimed. OpenCode V2's standalone agent diagnostic listed both roles. Claude's read-only doctor exited successfully, but did not establish skill/role execution. Direct installed-hook subprocess tests exercised enable/disable; they do not grant native client hook trust.

Primary sources checked 13 November 2026:

- [Rulesync global mode](https://rulesync.dyoshikawa.com/guide/global-mode): user-scope destinations and shared-directory deletion hazards. This installer does not use a global orphan sweep.
- [Rulesync compatibility](https://rulesync.dyoshikawa.com/reference/supported-tools): target features differ.
- [Claude memory](https://code.claude.com/docs/en/memory) and [hooks](https://code.claude.com/docs/en/hooks): native instructions and lifecycle events.
- [Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) and [hooks](https://learn.chatgpt.com/docs/hooks): loading, native trust and event contracts.
- [OpenCode instructions](https://opencode.ai/docs/instructions/), [agents](https://opencode.ai/docs/agents/), [server plugins](https://opencode.ai/docs/build/plugins/server): global files, inherited models and V2 startup plugin context.

The package is installed through its CLI rather than pretending one native plugin manifest works in every client. Its OpenCode V2 component is a native plugin; Claude/Codex use native files and hooks. Future plugin-marketplace packaging is a separate delivery, not an already published integration.

Later [native-client trials](native-trial-2026-11-13.md) exercised real inference and tool calls in all three clients. They establish specific behavior, not universal rule compliance: OpenCode reported a deliberately failed validation correctly while still masking the shell exit with echo.

The [0.2.3 repair verification](repairs-2026-11-13.md) supersedes the observed OpenCode validation masking case: the compound form was blocked before execution and the direct retry retained exit 7. It also records an actual native compaction/resume trial in OpenCode 2.2.7.
