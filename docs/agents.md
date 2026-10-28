# Agent 接入方式与官方依据

所有客户端读写项目根目录的同一份 `.dsh/`。源代码和知识库核心只有一份；客户端目录中的小型规则文件负责指向它。`install --agent all` 安装下面列出的接入文件，并不表示每种客户端都有自动注入 hook。

```powershell
node bin/dsh-knowledge.mjs agents
node bin/dsh-knowledge.mjs install --agent all --project 'D:/Projects/example' --dry-run
node bin/dsh-knowledge.mjs install --agent all --project 'D:/Projects/example'
```

也可把 `all` 换成一个 ID 或逗号分隔的多个 ID，例如 `claude-code,codex,gemini`。项目安装器合并带管理标记的指令块，保留已有规则与配置；不会读取源码来自动建立知识库。需要建立时，让当前 agent 使用 `knowledge` 技能，或将 `init` 命令打印的提示交给 agent。

## 当前注册表

本表对应 `lib/agents.mjs` 的 ID 和生成路径。规则文件中的路径是阅读提示，不能等同于把知识文档全文自动加入模型上下文。支持项目文件阅读的 agent 仍需实际读取 `.dsh/overview.md` 与相关专题，再核对源码。

| ID | 项目接入文件 | 加载方式与官方依据 |
| --- | --- | --- |
| `dsh` | `AGENTS.md`；DSH 自身仍加载根 Cordis 插件 | 保留 DSH 原生适配，由统一核心生成知识上下文。 |
| `claude-code` | `CLAUDE.md`、`.claude/skills/knowledge/SKILL.md`、`.claude/settings.json` | 原生 `UserPromptSubmit` 注入、`SessionEnd` 清理缓存；静态规则和技能同时可用。[Hooks](https://code.claude.com/docs/en/hooks)、[插件布局](https://code.claude.com/docs/en/plugins-reference)。 |
| `codex` | `AGENTS.md`、`.agents/skills/knowledge/SKILL.md`、`.codex/hooks.json` | 项目指令、技能，以及分组 hook。项目层 hook 需要客户端信任确认后才会执行。[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Hooks](https://learn.chatgpt.com/docs/hooks)。 |
| `copilot` | `.github/copilot-instructions.md`、`.github/skills/knowledge/SKILL.md`、`.github/hooks/dsh-knowledge.json` | 项目指令和技能仍会加载。Hook 监听 `userPromptTransformed`，保留原 `transformedPrompt` 再追加知识；不安装会被丢弃输出的 `userPromptSubmitted`。[Hooks](https://docs.github.com/en/copilot/reference/hooks-reference)。 |
| `minimaxcode` | `AGENTS.md` | 项目指令是基础接入；旧桌面插件与 mcode 0.4 包的边界见下文。不会向项目设置安装一个未经确认的 MiniMax hook。 |
| `opencode` | `AGENTS.md`、`.opencode/plugins/dsh-knowledge.js` | 只安装指向本仓库 adapter 的项目插件，不写 `.opencode/commands/knowledge.md`。`/knowledge` 由 adapter 提供，源目录需要保留在原位置。[插件](https://opencode.ai/docs/plugins/)、[项目规则](https://opencode.ai/docs/rules/)。 |
| `gemini` | `GEMINI.md`、`.gemini/skills/knowledge/SKILL.md`、`.gemini/settings.json` | 原生 `BeforeAgent` 注入本轮上下文，`SessionEnd` 清理缓存。[Hooks](https://geminicli.com/docs/hooks/reference/)、[GEMINI.md](https://geminicli.com/docs/cli/gemini-md/)。 |
| `cursor` | `.cursor/rules/dsh-knowledge.mdc` | `alwaysApply: true`。Cursor 项目规则必须用 `.mdc`，放入同目录的普通 `.md` 不会被识别。[Rules](https://cursor.com/docs/rules)。 |
| `windsurf` | `.windsurf/rules/dsh-knowledge.md` | `trigger: always_on`；当前官方站推荐新路径 `.devin/rules/`，仍保留 `.windsurf/rules/` 兼容路径。[Memories & Rules](https://docs.devin.ai/desktop/cascade/memories)。 |
| `devin` | `AGENTS.md`、`.agents/skills/knowledge/SKILL.md`、`.devin/hooks.v1.json` | 文件根就是事件 map。与 Claude Code 一起安装时只写 `PostCompaction`，其余监听沿用 Claude hooks；单独安装才写完整事件。[Hooks](https://docs.devin.ai/cli/extensibility/hooks/overview)。 |
| `cline` | `.clinerules/dsh-knowledge.md` | 普通 Markdown 项目规则；也支持 `.cline/rules/` 与 `AGENTS.md`。[Rules](https://docs.cline.bot/customization/cline-rules)。 |
| `roo` | `.roo/rules/dsh-knowledge.md` | 普通 Markdown workspace rules，项目规则优先于全局规则。[Custom instructions](https://roocodeinc.github.io/Roo-Code/features/custom-instructions/)。 |
| `kilo` | `AGENTS.md` | 当前官方推荐的项目指令格式；旧 `.kilocode` 规则不是唯一入口。[AGENTS.md](https://kilo.ai/docs/customize/agents-md)。 |
| `trae` | `.trae/rules/dsh-knowledge.md` | `alwaysApply: true`。原生规则避免依赖“Include AGENTS.md in the context”用户开关。[Rules](https://docs.trae.ai/ide/rules)。 |
| `qoder` | `AGENTS.md`、`.qoder/commands/knowledge.md`、`.qoder/skills/knowledge/SKILL.md`、`.qoder/settings.json` | 官方明确支持 AGENTS.md。单独安装时写入 IDE hook；与 `qoder-cli` 一起安装时，hook 改由 CLI profile 负责。[Rules](https://docs.qoder.com/user-guide/rules)。 |
| `qoder-cli` | `AGENTS.md`、`.qoder/commands/knowledge.md`、`.qoder/skills/knowledge/SKILL.md`、`.qoder/settings.json` | 与 Qoder IDE 共用命令、技能和设置。同时选择两者时只保留 CLI 更完整的 hook，IDE 忽略自己不实现的事件。[CLI hooks](https://docs.qoder.com/cli/hooks.md)。 |
| `codebuddy` | `CODEBUDDY.md`、`.codebuddy/rules/dsh-knowledge/RULE.mdc` | CLI 使用 CODEBUDDY.md；IDE 规则带 `alwaysApply: true`、`enabled: true`。CLI 的 AGENTS.md fallback 在 CODEBUDDY.md 存在时不生效。[CLI memory](https://www.codebuddy.ai/docs/cli/memory)、[IDE Rules](https://www.codebuddy.ai/docs/ide/User-guide/Rules)。 |
| `kimi` | `AGENTS.md` | Kimi CLI 合并项目根到工作目录的 AGENTS 指令。[Agents](https://moonshotai.github.io/kimi-cli/en/customization/agents.html)。 |
| `qwen` | `QWEN.md` | 原生项目 memory；当前 Qwen Code 也支持 AGENTS.md。[Memory](https://qwenlm.github.io/qwen-code-docs/en/users/features/memory/)。 |
| `amp` | `AGENTS.md` | 当前目录与父目录的指令自动包含；子目录指令按访问范围加载。[AGENTS.md](https://ampcode.com/docs/customize/agents-md)。 |
| `auggie` | `.augment/rules/dsh-knowledge.md` | `type: always_apply`；Augment/Auggie 还支持 AGENTS.md 与 CLAUDE.md。[Rules](https://docs.augmentcode.com/cli/rules.md)。 |
| `continue` | `.continue/rules/dsh-knowledge.md` | `name: DSH Knowledge`、`alwaysApply: true`；作用于 Agent、Chat、Edit，不作用于 autocomplete 或 apply。[Rules](https://docs.continue.dev/customize/deep-dives/rules)。 |
| `aider` | `AGENTS.md` | 文件生成后仍需 `aider --read AGENTS.md`，或自行在已有 `.aider.conf.yml` 的 `read` 中添加该文件；安装器不会改写 YAML。[Conventions](https://aider.chat/docs/usage/conventions.html)。 |
| `generic` | `AGENTS.md` | 给支持 AGENTS.md 或能主动读取项目文件的其他 agent；不承诺未知客户端自动发现这个文件。 |

注册表支持 `claude` / `claudecode`、`gemini-cli`、`minimax` / `minimax-code`、`roo-code`、`kilo-code`、`kimi-cli`、`qwen-code`、`augment`、`github-copilot` 别名。未来客户端如果没有原生指令发现机制，可把 `node bin/dsh-knowledge.mjs context --project <项目路径>` 的输出作为本轮上下文交给它；该命令只输出提示，不生成知识文档。

## Hook 协议边界

Claude 的 `UserPromptSubmit` 收到 JSON stdin，包含 `cwd`、`prompt`、`session_id`、`hook_event_name`。脚本返回 `hookSpecificOutput.hookEventName` 与 `hookSpecificOutput.additionalContext`。Claude 将超过 10,000 字符的 hook context 写入文件，因此普通知识注入保持在该阈值以下；详细文档由 agent 按需读取。[官方协议](https://code.claude.com/docs/en/hooks)。

Gemini 的 `BeforeAgent` 同样通过 stdin/stdout JSON 交互，`hookSpecificOutput.additionalContext` 仅追加到当前 turn；其 `timeout` 单位为毫秒，Claude 使用秒。安装器对每个生成的 JSON hook 先移除 `command` 或 `powershell` 里带 `--dsh-knowledge-managed` 的旧 handler，保留其余配置和用户 handler，再追加本次生成结果。生成路径包括 `.codex/hooks.json`、`.github/hooks/dsh-knowledge.json`、`.cursor/hooks.json`、`.gemini/settings.json`、`.qoder/settings.json` 和 `.devin/hooks.v1.json`，不是只合并 Claude 与 Gemini。命令引用本仓库的绝对路径；移动仓库后应重新运行安装。客户端需允许本地 hook，已有会话可能需要重启才能加载新设置。[Gemini hooks](https://geminicli.com/docs/hooks/reference/)。

Copilot 不安装会被丢弃输出的 `userPromptSubmitted`。它的项目 hook 在 `.github/hooks/dsh-knowledge.json`，监听 `userPromptTransformed`，保留原来的 `transformedPrompt` 再追加知识上下文。[Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)。

## MiniMax 旧桌面与 mcode 0.4

保留仓库根目录的 `.minimax-plugin/plugin.json` 和 `hooks/minimax.json` 是现有 MiniMax 桌面本地插件 profile。原安装目录可能是 `~/.minimax/plugins/dsh-knowledge-minimaxcode`。这是与当前用户本机旧桌面安装对应的兼容入口，不能把目录名推断为所有 mcode 版本的官方规范。不要同时加载旧副本与保留仓库副本，否则可能重复注入；迁移时保留自己的项目 `.dsh/`，只替换插件来源。

mcode 0.4 的发布包由相同源码生成：

```powershell
node scripts/package-minimax.mjs
```

输出固定为 `dist/minimaxcode/`。生成器仅接管空目录或带自身生成标记的输出目录；拒绝符号链接、junction 与未归属目录，不接受任意输出路径，不递归删除内容。再次执行会从统一核心、hook 脚本和技能刷新已知文件，保留输出目录中的其他文件。不要手动维护生成副本。

0.4 包使用 `.claude-plugin/plugin.json`，hook inline 放入 manifest；handler 是 `command: "node"` 加独立 `args`，其中脚本路径为 `${PLUGIN_ROOT}/scripts/context.mjs`，随后传入 `--agent minimax`。这与 Claude 的 `${CLAUDE_PLUGIN_ROOT}` 变量不同。[MiniMax compatibility](https://github.com/MiniMax-AI/MiniMax-Code-Plugins/blob/main/docs/plugin-compatibility.md)、[0.4 规范](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-Code-Plugins/main/proposals/hooks-v0.4-spec.md)。

官方 0.4 文档要求 skills 路径以 `./` 开始、相对 `.claude-plugin/`，示例却把技能放在插件根 `skills/`；这是文档歧义。生成器将同一份 canonical skill 自动复制到 `.claude-plugin/skills/knowledge/SKILL.md`，使用 `./skills/knowledge/SKILL.md`，同时保留常规根 `skills/knowledge/SKILL.md`。两份生成文件必须来自相同源码，不另维护知识核心。测试验证 manifest 相对路径能解析到包内文件，但不能替代真实 runtime 的发现测试。

0.4 hooks 文档仍以 proposal 形式发布，官方材料对 portable 旧 manifest 的兼容描述也不完全一致；`UserPromptSubmit` 的上下文交付缺少可复现的官方 conformance 证据。这里提供的是 **规范层面的发行适配**，尚未确认 0.4 实际加载和注入。若目标 runtime 不接收此包，使用已验证的旧桌面 profile，或显式加载知识技能／项目指令，再读取同一份 `.dsh/`，不要通过复制核心源码创建另一个仓库。[旧 hook 规范与证据范围](https://raw.githubusercontent.com/MiniMax-AI/MiniMax-Code-Plugins/main/proposals/hooks-detailed-spec.md)。

## 验证范围

仓库测试验证核心行为、安装合并、hook JSON 协议、OpenCode adapter，以及生成包的独立运行和路径完整性。它们使用测试 fixture 与模拟宿主，不表示上表所有品牌和版本都已经在真实客户端运行。客户端禁用指令／技能／hook、云端无法读取本地文件、版本协议变化或项目未获信任，都需要在目标客户端检查。未来 agent 至少需要项目文件访问或接收 CLI context 的能力，才能使用这份知识库。
