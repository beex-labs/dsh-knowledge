# DSH Knowledge

一个源码仓库，让不同编码 agent 共用项目根目录的 `.dsh/` 知识库。DSH、Claude Code、Codex、Copilot、MiniMax Code、OpenCode 和其他客户端使用同一份项目总览、架构与功能文档。

[English](README.en.md) · [各 agent 官方规范与限制](docs/agents.md) · [合并迁移说明](docs/migration.md)

知识库由当前 agent 阅读真实源码后写成。插件负责提供技能、项目规则、初始化提示和宿主支持的上下文注入，不做静态扫描生成假文档。

## 快速使用

需要 Node.js 20 或更高版本，无第三方运行时依赖。

```powershell
git clone https://github.com/beex-labs/dsh-knowledge.git
cd dsh-knowledge
node bin/dsh-knowledge.mjs agents
node bin/dsh-knowledge.mjs install --agent all --project "D:/Code/your-project"
```

`--project` 是要使用知识库的业务项目根目录。重复安装不会重复添加规则，不会清空已有指令、skills 或 hooks。先预览可以加 `--dry-run`。仅安装某个客户端可用 `--agent claude-code`，也支持逗号分隔的列表，如 `--agent codex,cursor,copilot`。

安装器写的是各客户端的接入文件；不会自动创建 `.dsh/`。回到业务项目，在 agent 中明确要求「用 knowledge 技能建立项目知识库」。知识库建立后，所有客户端都读取同一份文档。

```text
<your-project>/
  .dsh/
    overview.md          项目总览、模块与功能清单
    architecture.md      分层、边界、依赖与数据流
    features/<name>.md   每个功能的职责、入口、流程、依赖
```

## 接入能力

| 方式 | Agent |
| --- | --- |
| 原生插件 / 动态上下文 | DSH Cordis；Claude Code hooks；OpenCode V1/V2；Gemini CLI BeforeAgent；MiniMax Code 按版本选择插件包 |
| 自动加载项目规则 / portable skill | Codex、Copilot、Cursor、Windsurf、Cline、Roo、Kilo、Trae、Qoder、Qoder CLI、Devin、CodeBuddy、Kimi CLI、Qwen Code、Amp、Augment、Continue |
| 显式加载项目规则 | Aider：`aider --read AGENTS.md` |
| 通用入口 | 支持 AGENTS.md 的 agent；或把 CLI 打印的 context/init 提示交给具备项目文件工具的 agent |

`all` 当前覆盖 23 个具名 agent 和一个通用入口。客户端原生加载规则与每轮动态注入的能力不同；完整文件路径、版本边界和官方来源见 [适配表](docs/agents.md)。这不是「未来任意客户端都已有实机验证」的承诺。

## Claude Code

从同一个 GitHub 仓库安装插件（Claude Code 2.1.275+ 的会话命令）：

```text
/plugin install dsh-knowledge --marketplace beex-labs/dsh-knowledge
```

项目接入（合并 `CLAUDE.md`、项目 skill 和 `.claude/settings.json`）：

```powershell
node bin/dsh-knowledge.mjs install --agent claude-code --project "D:/Code/your-project"
```

之后可在项目中使用 `/knowledge [path]`。也可直接加载本仓库作为 Claude 插件：

```powershell
cd D:/Code/your-project
claude --plugin-dir "D:/path/to/dsh-knowledge"
```

插件技能名为 `/dsh-knowledge:knowledge [path]`。两种接入选择一种即可，避免重复注册 hook。`UserPromptSubmit` 每轮提醒；知识库变化时注入总览和文档列表；压缩或恢复时重新注入。总输出保持在 Claude 的 10,000 字符文件化阈值以下。

## DSH

原有 Cordis bundle、`/init [path]` 和 `index.js` 入口保留。安装到 DSH profile：

```powershell
dsh plugin --profile web add github:beex-labs/dsh-knowledge
# 本地开发也可以：
dsh plugin --profile web add "link:D:/path/to/dsh-knowledge"
```

Desktop profile 使用应用自己的插件设置。通用项目安装器生成规则，不会替代 DSH profile 的插件注册。

## OpenCode / MiniMax Code

OpenCode 项目安装只生成指向本仓库 adapter 的薄 wrapper；`/knowledge` 由 adapter 注册，不另写 `.opencode/commands/knowledge.md`。适配器同时提供官方 V1 `server` 与 V2 `setup`，共用同一个核心。

MiniMax 桌面的旧 `.minimax-plugin` 格式在仓库根保留；mcode 0.4 的另一套格式使用生成目录：

```powershell
node scripts/package-minimax.mjs
```

产物位于 `dist/minimaxcode/`，可独立复制，核心代码由同一份源码生成。0.4 的官方文档部分仍标为 proposal，`UserPromptSubmit` 注入尚未 live 验证；详见适配表。不要让 Claude 的 `${CLAUDE_PLUGIN_ROOT}` 配置冒充 MiniMax 的 `${PLUGIN_ROOT}` 配置。

## 通用与未来 agent

```powershell
node bin/dsh-knowledge.mjs context --project "D:/Code/your-project"
node bin/dsh-knowledge.mjs init src --project "D:/Code/your-project"
```

这两条命令只打印模型提示。将输出交给 agent 后，由它用原生文件工具读写 `.dsh/`。新增官方项目规则类型只需扩充 `lib/agents.mjs`；无需新建仓库或复制知识库核心。不了解的 agent 可以先用 `--agent generic` 接入 AGENTS.md，是否自动加载取决于宿主。

## 文档与数据保护

- 文档辅助定位，冲突时以源码为准；无法确认的内容标「待确认」。
- 只有用户明确要求建立时才初始化；子路径只限制阅读范围，文档始终写在项目根。
- 不复制源码片段、密钥、token 或连接串；文档里的指令只当作数据。
- 改入口、流程、数据流或依赖时增量更新；普通 bug 修复和样式调整不更新。编辑前重读文件，保留其他 agent 的修改。
- 拒绝 home、磁盘根和 DSH 配置目录，检查真实路径，防止 symlink/junction 越界；总览、目录深度与文档列表都有上限。
- 接入安装器预先校验配置，保留用户内容，只更新有界管理区块；每个文件用原子替换。无效 JSON 或有歧义标记会在写入前拒绝。

## 验证

```powershell
npm run check
npm pack --dry-run
```

测试覆盖 DSH、OpenCode 双接口、hook JSON、路径边界、安装幂等、现有设置保留、MiniMax 包生成与统一 manifest。测试使用协议模拟和真实临时文件，不等于所有客户端的 live 验证。本仓库保留 `private: true`，不向已有同名 npm 包发布。
