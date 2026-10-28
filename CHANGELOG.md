# Changelog

## 2.0.0 (2026-10-28)

- Consolidate DSH, Copilot, MiniMax and OpenCode source implementations into one repository and one shared knowledge core.
- Add Claude Code plugin manifest, namespaced skill, per-prompt hooks and context restoration on compaction/resume.
- Add one project installer for 23 named coding agents and a generic AGENTS.md entry, preserving user instructions and settings.
- Register Devin and Qoder CLI and merge their native hook files through the same installer.
- Support official OpenCode V1 and V2 interfaces in one adapter and provide Gemini BeforeAgent injection.
- Generate a separate MiniMax 0.4 package from canonical source while keeping the existing desktop manifest.
- Fix monorepo project roots, Windows cross-drive scope checks, symlink/junction scope escapes and unsafe knowledge paths.
- Add meaningful core, hook, installer, manifest and host package tests. This version is source-only and has not been published to npm.
