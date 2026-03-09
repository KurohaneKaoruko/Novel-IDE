# Services Overview

本目录中的服务现在主要围绕“小说写作工作台”组织，而不是通用 IDE 功能。

## Current Roles

### `DiffService`

- 负责把原文与建议稿转换成结构化修订建议
- 为 `Review` 工作台和修订应用流程提供基础差异数据
- 重点不是代码 diff，而是写作修订颗粒度

### `ModificationService`

- 管理 AI 修订建议的应用、回滚与状态更新
- 所有修订建议都基于原始快照重放，避免行号漂移
- 在文件已变化时阻止脏写入

### `NovelPlannerService`

- 负责大纲、任务队列、连续性索引与长期记忆索引
- 生成 `Planner` 工作台所需的任务和上下文
- 维护：
  - `.novel/state/continuity-index.md`
  - `.novel/state/character-state-index.md`
  - `.novel/state/foreshadow-index.md`

### `documentSummary`

- 为长文档生成轻量摘要缓存
- 生成最近章节摘要、角色状态摘要、线索摘要
- 用于减少 AI prompt 中的长文噪声

### `memoryIndex`

- 处理 Memory 索引的元数据读写
- 支持：`source`、`locked`、`updated_at`
- 为作者可治理的长期记忆提供基础能力

## Product-Oriented Principle

这些服务现在服务于四个 AI 工作区：

- `Chat`
- `Planner`
- `Review`
- `Memory`

如果后续继续扩展，优先考虑：

1. 是否提升小说创作体验
2. 是否帮助 AI 维持长期连续性
3. 是否减少作者的重复操作
4. 是否能被作者理解和控制
