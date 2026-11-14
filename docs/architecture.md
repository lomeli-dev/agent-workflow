# Architecture and ownership

1. `.rulesync` is the canonical portable content: applicability rule, skill and references, optional roles and command.
2. `scripts/build.mjs` invokes the pinned Rulesync in a fresh staging directory. It emits `generated/` and a SHA-256 manifest. No real global directories are touched.
3. `lib/install.mjs` maps generated artifacts to native user scopes. Rules are marked blocks; hooks and plugin arrays are merged using JSONC-preserving edits; other package files have exclusive ownership.
4. `installation.json` under the account's `.local/share/agent-workflow` records original contents and installed hashes. Its folder and file are private. It can contain sensitive pre-existing settings; it is never a distributable artifact.
5. A lock serializes our install operations. Preflight checks all paths before writes; each write checks for intervening changes. Partial failures roll back writes still matching our output. This is not an OS-wide lock against arbitrary external writers.
6. `lib/gate.mjs` reads only bounded project configuration. Hooks use it without project code execution, network, model calls or transcript access. Invalid config disables this package's workflow.
7. Native clients retain their own trust, precedence and permissions. Global applicability is behavioral; startup reminders do not intercept every tool. This package does not claim a security sandbox.

Project config is deliberately small: `{schemaVersion:1, enabled:boolean}`. No commands, scripts, executable installation recipes or credentials are loaded from it. The nearest config from cwd toward the repository root wins; outside repositories, directory ancestors can provide the switch. The CLI writes at the repository root. Nested overrides can be written explicitly by users.

Tools are installed through an explicit setup selection (`--tool`, `--tools`, `--profile`, `--all`, or interactive selection) with `--apply`. The allowlist and pinned dependency versions are code-reviewed; repository files cannot supply arbitrary install commands. Node packages can have lifecycle scripts, so setup is an intentional trust boundary, not a startup action.

Default layouts respect CODEX_HOME, CLAUDE_CONFIG_DIR and XDG_CONFIG_HOME for native global locations. `--user-root` deliberately uses isolated defaults instead of those host overrides. It changes no system environment variable. Optional dependencies are local to the managed store; shell PATH is never rewritten.

Update drift handling protects edited owned files and managed blocks. Shared config changes outside our entries are preserved. Removal restores the original bytes when the shared file still equals our installed version; otherwise only managed blocks/entries are removed. Native hook trust may need renewed approval after a runtime update even if command text is unchanged.

Models/effort inherit existing defaults; there is no universal model name or compaction threshold. Client-specific optional profiles may be added only with supported fields, explicit user selection and runtime verification. Existing Studio profiles remain separate.

Project connection receipts pin the original config path, client set and owned entry names. New receipts include a backup checksum; legacy receipts without that field remain readable. Checksums detect accidental inconsistency, not malicious edits by an actor who can rewrite the private receipt. The same-user filesystem is not a trust boundary. Changing OpenCode config precedence requires disconnect/uninstall before reconnect/reinstall.
