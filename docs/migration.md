# Consolidating the knowledge plugins

The canonical source repository is `beex-labs/dsh-knowledge`. The old sibling directories `dsh-knowledge-copilot`, `dsh-knowledge-minimaxcode`, and `opencode-knowledge` are superseded. They were local source directories without independent Git metadata in the inspected workspace. The connected `beex-labs` and `anyiba` repository inventories contained one matching remote knowledge repository; unrelated repositories must not be deleted.

The project knowledge documents do not move. Every integration still reads and writes `<project-root>/.dsh/overview.md`, `architecture.md`, and `features/*.md`.

## Replacing old integrations

1. Keep a backup of old source directories and local changes before cleanup.
2. Point Copilot's local plugin location to the canonical repository root, or run `node bin/dsh-knowledge.mjs install --agent copilot --project <project>` for project instructions and skill. Remove the old plugin registration to avoid duplicate skills.
3. Run the installer with `--agent opencode` for the target project. It writes a default-only module wrapper and `/knowledge` command. Remove old OpenCode plugin configuration that imports `opencode-knowledge/index.js`; loading both copies duplicates reminders. The wrapper imports the canonical source path, so keep that directory in place or rerun installation after moving it.
4. MiniMax desktop's existing `.minimax-plugin` profile remains in the canonical root. Replace the old installed plugin with this root (a local junction is suitable). The separate `scripts/package-minimax.mjs` produces a self-contained mcode 0.4 format from the same source. Do not maintain another repository for that generated directory. Check the official version limitations in agents.md.
5. Existing DSH profile links to `dsh-knowledge` remain valid. Reload the host after upgrading source. The DSH command stays `/init`; project skills and other adapters use `knowledge`.
6. For Claude Code, choose either the project installer or `claude --plugin-dir <canonical-root>`. The project skill uses `/knowledge`; the plugin skill is namespaced `/dsh-knowledge:knowledge`.

The installer does not rewrite arbitrary user-global configuration or silently remove old registrations. Run it for each business project. `--agent all` adds supported project pointers and hooks, not DSH profile registration or a globally installed MiniMax plugin. Aider needs `aider --read AGENTS.md`.

## Source layout

- `lib/knowledge.mjs`: one root/scope/document/prompt implementation.
- `index.js`: backward compatible DSH Cordis entry.
- `adapters/opencode.js`: OpenCode V1/V2 host boundaries.
- `scripts/context.mjs`: shared Claude/MiniMax/Gemini hook engine.
- `skills/knowledge/SKILL.md`: one portable workflow source.
- `lib/agents.mjs`, `lib/install.mjs`, `bin/dsh-knowledge.mjs`: agent registry and idempotent project installation.
- Root manifests and `hooks/`: small host-specific declarations.
- `dist/`: generated packages, ignored by Git.

No knowledge server, API key, database, extra npm dependencies, or copied per-agent core is required. Protocol tests cover the adapters; real client acceptance should be checked when distributing against a particular client version.
