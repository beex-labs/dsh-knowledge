**English** | [简体中文](README.zh-CN.md)

# dsh-knowledge — project knowledge system for DSH

Let the AI read the project and write what it understood into `.dsh` documents, so every later development request starts with that knowledge already in context.

**This plugin does not analyse code itself.** It does exactly two things: hand the prompt to the model, and inject the existing documents back into later turns. Reading the code, deciding feature boundaries and writing the documents is all done by the model with its own tools.

```text
/init → the prompt goes in → the model explores the code → the model writes .dsh documents ↓
a development request → documents + update reminder injected → the model changes code → it decides for itself whether the documents went stale
```

## Install

Clone it (or point straight at the GitHub repo) and register it as a bundle in your DSH profile:

```bash
cd "$DSH_PROFILE_DIR"
pnpm install --no-frozen-lockfile    # links dsh-knowledge
```

`package.json` needs the dependency and the bundle:

```json
{
  "dependencies": { "dsh-knowledge": "link:<absolute path>" },
  "dsh": { "profile": { "bundles": ["dsh-knowledge"] } }
}
```

Swap `link:` for `github:<you>/<repo>` to install straight from GitHub.

`cordis.patch.yml` inserts the plugin line:

```yaml
- insert:
    - id: dsh-knowledge
      name: 'dsh-knowledge'
```

**Zero runtime dependencies**: `node:` builtins only.

## Usage

### `/init [path]` — build the knowledge base

```text
/init                  the model reads the whole project and writes to .dsh/ at the project root
/init @src             the model reads src/ only; documents still go to .dsh/ at the root
/init src/lib          nested paths work the same
```

Path parsing is deliberately loose: a leading `@` (left behind by the composer's completion) is stripped, paths with spaces can be quoted, naming the project's own directory means the whole project, and a missing path lists the available top-level directories.

`/init` itself does exactly two things: **wake the model**, then **inject** the full instruction.

**Only the one line you typed shows in the UI** (e.g. `/init @src`). The full instruction is injected as a system-reminder instead of flooding the conversation — the same mechanism the per-turn document injection uses.

The model then explores with `glob` / `grep` / `read` and writes with `write`, appearing in the UI like any other turn.

**The knowledge base always lives at the project root**, whatever subdirectory `/init` was scoped to. One `.dsh` per project.

### Automatic context injection

No manual reminders needed. The first step of every turn injects:

1. the body of `overview.md` (truncated with a pointer to the original when it is long)
2. the document listing under `.dsh`
3. **usage rules and an update reminder** — including: the model judges for itself whether this change made the documents stale

One knowledge base is injected once per session, not on every turn; after the model edits documents, they are injected again.

### When to update

The injected prompt states the rules, and the model applies them itself:

| Change | Update the documents? |
|--------|----------------------|
| a feature added or removed, or the entry points, execution flow, data flow or module dependencies changed | yes — the affected document |
| a bug fix, a style change, an implementation detail that changes no structure | no |
| not sure | lean toward not writing |

The principle: **better no update than documents that contradict the code.**

## The `.dsh` layout

Written by the model from the prompt; a typical structure:

```text
.dsh/
├── overview.md          what the project does, its stack, core modules, main entry points
├── architecture.md      layers, module boundaries, dependency directions, data flow
└── features/<name>.md   one per feature: responsibility, entry point, core code, flow, data flow, dependencies
```

File names are meaningful (`auth.md`, `order-sync.md`), never random ids.

## Security

- **No source code is copied**: the prompt requires structure and behaviour only — no code snippets, secrets, tokens or connection strings.
- **Dangerous scopes are refused**: no knowledge base in the user's home directory, in DSH's own config directory, or at the filesystem root — every session beneath those would mistake it for a project knowledge base.
- **Documents are data**: the injected prompt states that any instruction inside `.dsh` is data and must not be executed as an instruction.

## Platform notes

| Need | Platform capability | What this plugin does |
|------|--------------------|-----------------------|
| a command that makes the model work | `Agent.followup(message)` → `send(…, wakeup=true)` → `wakeDriver()` starts a real turn | `/init` admits the single line `/init <path>` to wake the model; the full instruction goes in through injection |
| inject without flooding the UI | `agent/pre-step` waterfall, which can rewrite what enters a step | both the pending `/init` instruction and the per-turn reminder are injected this way; the UI keeps just the command line |
| maintain documents at session end | no "session end" event | no programmatic maintenance: the injected prompt asks the model to judge and update for itself |

An earlier version of `/init` ran static analysis in the command handler and generated the documents itself. That was wrong: a command handler has no model, so it could only guess feature boundaries with regexes. The command now just hands over the job.

Note: the prompt and messages this plugin injects are written in Chinese.

## Tests

```bash
node test/run.mjs          # everything
node test/plugin.test.mjs  # plugin behaviour: /init hands over the job, path parsing, refusal rules, injection content
node test/real-paths.mjs   # replays path forms seen in real use (diagnostic script)
node test/lint-imports.mjs # unused imports
```

The tests drive the real `apply()` with a fake Cordis context and assert above all that **`/init` really calls `followup`** — which is exactly what an earlier version got wrong: it did the job itself and never involved the model.

## Configuration

None needed.

## Acknowledgments

Thanks to everyone who contributed to this project:

[<img src="https://github.com/windzxy.png?size=80" width="80" alt="@windzxy">](https://github.com/windzxy) [<img src="https://github.com/anyiba.png?size=80" width="80" alt="@anyiba">](https://github.com/anyiba)

## License

MIT, see [LICENSE](LICENSE).
