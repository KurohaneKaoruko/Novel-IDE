# AI Workflow

## Overview

Novel-IDE 的 AI 已经从“单纯聊天”重构成一套写作工作流系统：

- `Chat`：对话与即时写作协作
- `Planner`：规划任务与执行队列
- `Review`：修订建议与审阅应用
- `Memory`：长期记忆索引与作者治理

## Edit Flow

### Review-first

- 默认模式下，AI 对正文与资料的修改先以建议形式返回。
- 建议应用基于原始快照重放，而不是在已漂移内容上直接打补丁。
- 若文件在建议生成后又被改动，应用会被阻止，避免脏写入。

### Auto-apply

- 自动应用模式下，AI 通过统一写入路径直接更新文件。
- 自然语言回复不会再被二次解析成额外变更集，避免双轨冲突。

## Sidebar Workbench

### Chat

- 最近会话切换、筛选、置顶、重命名、归档、恢复、删除
- Slash/模板命令
- 当前文档上下文卡
- 上下文来源可视化
- 模型恢复入口

### Planner

- 规划任务状态统计
- 下一任务执行
- 打开任务范围
- 将任务 prompt 注入输入框
- 重试任务 / 标记完成

### Review

- 修订建议按文件展示
- 单条建议接受/忽略
- 当前文档过滤
- 仅待处理过滤
- 文件级接受/忽略

### Memory

- 角色状态索引查看/编辑/保存
- 伏笔索引查看/编辑/保存
- 锁定 / 解锁
- 恢复自动模式
- 一键注入 Chat

## Context Quality

当前 AI 上下文已引入：

- 长文档摘要缓存
- 最近章节摘要索引
- 最近角色状态摘要
- 最近线索 / 悬念摘要

这些摘要会优先进入上下文，减少长文档全量喂给模型时的噪声。

## Memory Governance

长期记忆索引存放在：

```text
.novel/state/character-state-index.md
.novel/state/foreshadow-index.md
```

索引文件带有 front matter 元数据：

```yaml
source: auto | manual
locked: true | false
updated_at: ISO timestamp
```

### 规则

- `locked: true` 时，自动重建不会覆盖该索引
- 手工保存会将 `source` 标记为 `manual`
- 恢复自动模式会切回 `source: auto` 且解除锁定

## Current Safety Guarantees

- AI 写入使用统一写入路径
- 不再对 AI 输出做隐式空白压缩/修剪
- 审阅建议的单条和整组应用都能更新侧栏审阅状态
- Review 接受修改后会自动刷新 Memory 索引
