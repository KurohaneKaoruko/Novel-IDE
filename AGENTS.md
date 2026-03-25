# AGENTS.md

本文件为所有 AI Agent（Claude Code、Codex、Cursor 等）在此代码库中工作时提供指导。

## 项目概述

Novel-IDE 是一个基于 **Tauri v2 + React + Lexical** 构建的桌面小说写作工作台。它不是通用 IDE，而是专注于小说作者需求的工具：
- 作品与资料管理
- 章节写作与改稿
- AI 规划、审阅与长期记忆
- 人物、关系、线索与连续性维护

## 开发命令

```bash
# 开发
pnpm run dev              # 仅启动前端开发服务器（端口 1420）
pnpm run tauri:dev        # 完整桌面开发模式（推荐）

# 构建
pnpm run build            # 仅构建前端
pnpm run tauri:build      # 构建桌面应用

# 测试与代码检查
pnpm run test             # 运行 Vitest 测试
pnpm run test:watch       # 监视模式运行测试
pnpm run lint             # 运行 ESLint

# 移动端（如需要）
pnpm run tauri:android:dev
pnpm run tauri:ios:dev
```

## 架构

### 前端 (`src-react/src/`)

- **`App.tsx`** - 主应用组件，包含工作区管理、标签系统和 AI 鰰板集成
- **`components/`** - UI 组件：
  - `LexicalEditor/` - 基于 Lexical 的富文本编辑器
  - `chat/AIChatPanel.tsx` - AI 聊天界面
  - `TabBar.tsx` - 多标签文件管理
  - `FileExplorer.tsx` - 项目文件树
  - `ProjectPickerPage.tsx` - 书架/工作区选择器
- **`services/`** - 业务逻辑：
  - `AIAssistanceService.ts` - AI 集成
  - `ChapterService.ts` - 章节管理
  - `CharacterService.ts` - 人物追踪
  - `PlotLineService.ts` - 情节线管理
  - `autoLongWriteWorkflow.ts` - 自动化写作工作流
  - `plannerQueueWorkflow.ts` - 任务规划工作流
- **`hooks/`** - 自定义 React 钩子：自动保存、导航、聊天会话、记忆工作台
- **`tauri.ts`** - 所有 Tauri 后端命令的 TypeScript 类型绑定

### 后端 (`src-tauri/src/`)

- **`main.rs`** - Tauri 应用入口点，注册所有命令
- **`commands.rs`** - Tauri 命令实现：文件 I/O、工作区管理、设置、聊天历史
- **`agent_system.rs`** - AI 代理运行时，包含工具注册表和记忆存储
- **`skills/mod.rs`** - 内置写作技能（风格：无为/馆zolh/简洁， 剧情技巧， 人物工具）
- **`app_settings.rs`** - 应用设置和提供商配置
- **`secrets.rs`** - API 密钥存储（平台特定：Windows DPAPI，macOS/Linux keyring）
- **`chat_history.rs`** - 聊天会话持久化

### 作品目录结构

每个小说作品使用固定结构：
```
<work>/
  concept/   # 设定、人物、关系等资料（.md）
  outline/   # 大纲与规划资料（.md）
  stories/   # 正文章节（.md）
  .novel/    # 状态、缓存、历史、索引
```

### 应用数据位置

- 设置： `<install-dir>/config/settings.json`
- 写作助手： `<install-dir>/data/agents.json`
- 聊天历史： `<install-dir>/data/chat_history.json`
- 书架状态： `<install-dir>/state/last_workspace.json`, `<install-dir>/state/external_projects.json`
- API 密钥： `<install-dir>/secrets/secrets.json`

## 关键技术细节

### AI 工作流模式

1. **审阅优先**（默认）：AI 生成审阅建议，用户逐条接受/拒绝
2. **自动应用**：AI 修改直接应用到内容

### 记忆索引系统

位于 `.novel/state/`：
- `character-state-index.md` - 人物状态追踪
- `foreshadow-index.md` - 伏笔/线索索引

每个索引支持：
- 自动生成（`source: auto`）
- 手动修订（`source: manual`）
- 锁定保护（`locked: true`）

### 代理系统

Rust 后端包含 AI 代理运行时：
- 工具注册表用于文件操作（`fs_read_text`、`fs_write_text`、`fs_list_dir` 等)
- 记忆存储用于长期上下文
- 内置写作技能通过 `/skills` 命访问

### 前后端通信

所有 Tauri 命令在 `src-react/src/tauri.ts` 中有类型定义。 使用 `@tauri-apps/api/core` 的 `invoke` 函数调用后端命令。

## 代码约定

- React 组件使用 `.tsx` 扩展名
- 服务是模块文件导出的单例实例
- Tauri 命令使用域前缀（如 `set_workspace`、`get_app_settings`）
- 设置变更应通过设置服务进行，不直接操作文件
- AI 响应为流式；通过 `chat_cancel_stream` 处理取消
