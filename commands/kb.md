---
description: 建立或增量更新项目共享知识库（.dsh）：让 AI 读真实代码后写成文档
argument-hint: "[路径] — 留空则整个项目"
allowed-tools: Bash(node:*), Read, Glob, Grep, Write, Edit
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/dsh-knowledge.mjs" init "$ARGUMENTS"`

以上是这次任务的全部指令，严格照做。它要求停止时，只向用户说明原因，不要建任何文件。

如果上面是空的（脚本没跑起来，通常是 `node` 不在 PATH 上），按 `knowledge` 技能自己确定项目根目录，并把范围告诉用户。
