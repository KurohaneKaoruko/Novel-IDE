# ModificationService

`ModificationService` 负责管理 AI 生成的修订建议，并把这些建议安全地应用到作品文件中。

## Current Model

### `ChangeSet`

一个 `ChangeSet` 代表某个文件的一组修订建议：

- `filePath`
- `modifications`
- `status`
- `stats`

它现在主要服务于 `Review` 工作台，而不是传统代码 diff 面板。

### `Modification`

单条修订建议仍保留 `add / delete / modify` 类型，但在产品语义上应理解为：

- 插入句段
- 删除句段
- 改写句段

## Safety Rules

### 1. Snapshot-based apply

- 所有接受操作都基于最初快照重放
- 不在已经漂移的当前内容上逐条硬改

### 2. Dirty-write protection

- 如果文件在建议生成后又被改动，应用会失败
- 用户需要重新生成建议，而不是在未知状态上强行覆盖

### 3. Review-first default

- 正文和资料修改默认先进入审阅流
- 由用户确认后再写入文件

## Tauri Commands Used

- `read_text`
- `write_text`

这些路径都相对于当前作品根目录。

## Product Context

`ModificationService` 当前与以下界面直接相关：

- `Review` 标签
- 右侧修订审阅面板
- AI 内联润色 / 扩写 / 压缩

## Why It Exists

它解决的是小说创作场景下最关键的问题之一：

- AI 的建议要能看
- 能逐条接受
- 能整组接受
- 能安全回滚
- 不能把作者后续改动误覆盖
