# Novel-IDE

Novel-IDE 是一个专注于长篇小说创作的本地桌面写作工作台，基于 `Tauri v2 + React + Lexical` 构建。

它不是通用编程 IDE，也不是代码代理外壳，而是围绕小说作者的核心工作流设计：

- 作品与资料管理
- 章节写作与改稿
- AI 规划、审阅与长期记忆
- 人物、关系、线索与连续性维护

## 当前产品形态

### 1. 作品工作区

每个作品目录采用固定结构：

```text
<work>/
  concept/   # 设定、人物、关系等资料（.md）
  outline/   # 大纲与规划资料（.md）
  stories/   # 正文章节（.md）
  .novel/    # 状态、缓存、历史、索引
```

### 2. AI 写作工作台

右侧 AI 栏已经重构为多工作区侧栏，而不是单纯聊天框：

- `Chat`：对话、会话切换、会话筛选、Slash 模板、上下文注入
- `Planner`：规划任务、下一任务执行、任务筛选、任务状态统计
- `Review`：修订建议、单条接受/忽略、按当前文档/待处理过滤
- `Memory`：角色状态索引、伏笔索引、查看/编辑/保存/锁定/恢复自动模式

### 3. AI 上下文质量

当前 AI 系统已支持：

- 长文档摘要缓存
- 最近章节摘要索引
- 角色状态摘要
- 最近线索 / 悬念摘要
- 持久化 Memory 索引
- Review 接受修改后自动刷新 Memory

## 核心能力

- 多标签 Markdown 写作编辑
- 自动保存与预览
- 新建章节 / 设定 / 大纲文件
- AI 续写、改写、润色、规划与一致性检查
- 修订建议审阅与逐条应用
- 人物关系图与作品结构导航
- 版本记录与恢复

## 快速开始

### 环境要求（Windows）

- Node.js 18+
- Rust stable（含 `cargo`）
- Visual Studio Build Tools（Desktop development with C++ / MSVC）
- WebView2 Runtime

### 本地开发

```powershell
pnpm install --frozen-lockfile
pnpm run tauri:dev
```

### 构建

```powershell
pnpm install --frozen-lockfile
pnpm run tauri:build
```

## 常用命令

- `pnpm run dev`：仅启动前端开发服务器
- `pnpm run tauri:dev`：启动桌面开发模式
- `pnpm run build`：构建前端
- `pnpm run tauri:build`：构建桌面应用
- `pnpm run test`：运行 Vitest
- `pnpm run lint`：运行 ESLint

## AI 工作流摘要

### Review-first 默认策略

- AI 改稿默认先生成审阅建议，不直接覆盖正文
- 建议基于原始快照应用，避免连续接受时行号漂移
- 文件内容变化后会阻止脏写入，要求重新生成建议

### Memory 治理

Memory 索引位于：

```text
.novel/state/character-state-index.md
.novel/state/foreshadow-index.md
```

每个索引支持：

- 自动生成 (`source: auto`)
- 手工修订 (`source: manual`)
- 锁定防覆盖 (`locked: true`)
- 恢复自动模式

## 主要存储位置

- App settings: `<install-dir>/config/settings.json`
- Writing assistants: `<install-dir>/data/agents.json`
- Chat history: `<install-dir>/data/chat_history.json`
- Bookshelf state: `<install-dir>/state/last_workspace.json`, `<install-dir>/state/external_projects.json`
- API keys: `<install-dir>/secrets/secrets.json`

## 许可证

GPL-3.0
