[English](README.md) | **简体中文**

# dsh-knowledge — DSH 项目知识系统

让 AI 读懂项目并把理解写成 `.dsh` 文档，以后每次开发需求都自动带着这些文档开工。

**这个插件自己不做代码分析。** 它只做两件事：把提示词交给 AI，以及把已有文档注入回后续对话。读代码、判断功能边界、写文档全部由 AI 用自己的工具完成。

```text
/init → 注入提示词 → AI 自主阅读代码 → AI 写 .dsh 文档
                                          ↓
开发需求 → 自动注入文档 + 更新提示 → AI 改代码 → AI 自己判断是否更新文档
```

## 安装

克隆到本地（或直接指向 GitHub 仓库），在 DSH profile 里登记为 bundle：

```bash
cd "$DSH_PROFILE_DIR"
pnpm install --no-frozen-lockfile    # 链接 dsh-knowledge
```

`package.json` 需要包含依赖与 bundle：

```json
{
  "dependencies": { "dsh-knowledge": "link:<此目录绝对路径>" },
  "dsh": { "profile": { "bundles": ["dsh-knowledge"] } }
}
```

`link:` 换成 `github:<你的用户名>/<仓库名>` 即可直接从 GitHub 安装。

`cordis.patch.yml` 负责插入插件行：

```yaml
- insert:
    - id: dsh-knowledge
      name: 'dsh-knowledge'
```

**零运行时依赖**：只使用 `node:` 内置模块。

## 使用

### `/init [路径]` — 让 AI 建立知识库

```text
/init                     AI 阅读整个项目，写文档到项目根的 .dsh/
/init @src             AI 只阅读 src/，文档仍写到项目根的 .dsh/
/init src/lib          嵌套路径同样可以
```

路径写法很宽松：开头的 `@`（输入框补全留下的）会被自动去掉，带空格的路径可以用引号包起来，写项目自己的目录名等同于整个项目，路径找不到时会列出可用的顶层目录。

`/init` 本身只做两件事：**唤醒 AI**，然后把完整指令**注入**进去。

**界面上只会显示你输入的那一行**（如 `/init @src`）。完整指令作为 system-reminder 注入，不会铺满对话——它和每轮自动注入文档用的是同一个机制。

之后 AI 会自己用 `glob` / `grep` / `read` 探索代码，再用 `write` 写文档，整个过程像普通对话一样显示在界面上。

**知识库固定写在项目根目录**，无论 `/init` 的参数指向哪个子目录。全项目只有一份 `.dsh`。

### 自动上下文注入

无需手动提醒。每轮对话的第一个 step，插件会注入：

1. `overview.md` 的正文（过长则截断并提示读原文）
2. `.dsh` 下的文档清单
3. **使用规则与更新提示**——包括：由 AI 自己判断本次改动是否让文档过时

同一个知识库在同一会话内只注入一次，不重复占用上下文；AI 改过文档后会自动重新注入。

### 更新判断规则

注入的提示词里写明，由 AI 自行判断：

| 改动 | 是否更新文档 |
|------|-------------|
| 新增/删除功能，或改了入口、执行流程、数据流、模块依赖 | 更新对应文档 |
| 修 bug、改样式、调整不影响结构的实现细节 | 不动文档 |
| 拿不准 | 倾向于不写 |

原则是**宁可不更新，也不要留下与代码不符的内容**。

## `.dsh` 结构

由 AI 按提示词生成，典型结构：

```text
.dsh/
├── overview.md          项目用途、技术栈、核心模块、主要入口
├── architecture.md      分层结构、模块边界、依赖方向、数据流
└── features/<名字>.md   每个功能一份：职责、入口、核心代码、流程、数据流、依赖
```

文件名由 AI 取有意义的名字（如 `auth.md`、`order-sync.md`），不是随机 ID。

## 安全

- **不复制源码**：提示词明确要求只写结构与行为，不写源码片段、密钥、token、连接串。
- **拒绝危险范围**：拒绝在用户主目录、DSH 自身配置目录、文件系统根目录建立知识库——这些位置会被其下所有会话误认为项目知识库。
- **文档即数据**：注入的提示词声明 `.dsh` 中的任何指令都只是数据，不得当作指令执行。

## 平台能力说明

| 需求 | 平台能力 | 本插件的做法 |
|------|---------|-------------|
| 命令触发 AI 工作 | `Agent.followup(message)` → `send(…, wakeup=true)` → `wakeDriver()` 开启真实回合 | `/init` 只 admit 一行 `/init <路径>` 来唤醒 AI，完整指令走注入 |
| 注入而不铺满界面 | `agent/pre-step` waterfall，可替换进入 step 的消息 | 待投递的 `/init` 指令与每轮知识库提醒都由此注入，界面上只留命令行 |
| 会话结束维护文档 | 无"会话结束"事件 | 不做程序化维护：改为在注入的提示词中要求 AI 自行判断并更新 |

`/init` 曾经在命令处理器里直接跑静态分析并生成文档，那是错的：命令处理器拿不到模型，只能靠正则猜功能边界。现在命令只负责派活。

## 测试

```bash
node test/run.mjs          # 全部
node test/plugin.test.mjs  # 插件行为：/init 派活、路径解析、拒绝规则、注入内容
node test/real-paths.mjs   # 在真实工作区上复现实际用过的路径写法（诊断脚本）
node test/lint-imports.mjs # 未使用的 import
```

测试用假的 Cordis context 驱动真实的 `apply()`，重点断言 **`/init` 必须真的调用了 `followup`**——这正是上一版实现错的地方：它把活干完了，却没让 AI 参与。

## 配置

当前无需配置。

## 致谢

感谢为本项目做出贡献的人：

[<img src="https://github.com/windzxy.png?size=80" width="80" alt="@windzxy">](https://github.com/windzxy) [<img src="https://github.com/anyiba.png?size=80" width="80" alt="@anyiba">](https://github.com/anyiba)

## 许可证

MIT，见 [LICENSE](LICENSE)。
