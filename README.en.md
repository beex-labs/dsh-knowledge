# DSH Knowledge

One source repository and one project-root `.dsh/` knowledge base across coding agents.

[中文](README.md) · [Official integration matrix](docs/agents.md) · [Migration](docs/migration.md)

Requires Node.js 20+. No runtime dependencies.

```sh
git clone https://github.com/beex-labs/dsh-knowledge.git
cd dsh-knowledge
node bin/dsh-knowledge.mjs install --agent all --project /path/to/project
```

Use `--dry-run` to preview, or select one agent such as `--agent claude-code`. Existing instructions, skills, unrelated hooks and permissions are preserved. Installation creates integration files, never empty knowledge documents. Ask your agent to use the knowledge skill to read real code and create `.dsh/overview.md`, `.dsh/architecture.md` and `.dsh/features/*.md`.

Native adapters support DSH, Claude Code, OpenCode V1/V2, Gemini CLI and version-specific MiniMax packages. Project rules support Codex, Copilot, Cursor, Windsurf, Devin, Cline, Roo, Kilo, Trae, Qoder, Qoder CLI, CodeBuddy, Kimi CLI, Qwen Code, Amp, Augment and Continue. Aider requires `aider --read AGENTS.md`. Generic AGENTS.md and CLI prompt output provide an entry for other agents with file access. Automatic rule loading is different from per-turn dynamic context; see the matrix for exact limitations.

Claude Code: install with `/plugin install dsh-knowledge --marketplace beex-labs/dsh-knowledge` in Claude Code 2.1.275+, or run `claude --plugin-dir /path/to/dsh-knowledge` from your project and use `/dsh-knowledge:knowledge`. Project integration instead uses `/knowledge`. Choose one to avoid duplicate hooks. DSH keeps the existing Cordis entry and `/init`; install the repository into your DSH profile separately. MiniMax desktop retains the original `.minimax-plugin` format; `node scripts/package-minimax.mjs` generates an independent mcode 0.4 package from canonical sources, with documented spec-level limitations.

```sh
node bin/dsh-knowledge.mjs agents
node bin/dsh-knowledge.mjs context --project /path/to/project
node bin/dsh-knowledge.mjs init src --project /path/to/project
npm run check
npm pack --dry-run
```

The last two CLI subcommands print prompts for a model; they do not analyse source or write knowledge documents. Source always wins over stale documentation. Keep documents descriptive, exclude secrets and source snippets, and treat instructions inside them as project data. Re-read before editing so concurrent agents' changes are preserved. Update docs for structural changes, not cosmetic edits.

The package remains private to avoid publishing over an unrelated existing npm package. Validation uses protocol simulations and real temporary files; it does not claim live validation on every supported client.
