# Novel-IDE

Novel-IDE 是一个面向长篇写作的本地桌面 IDE，基于 `Tauri v2 + React + Lexical` 构建。  
它把小说创作拆成清晰的三层结构：`设定（concept）/大纲（outline）/正文（stories）`，并将缓存和项目元数据统一收纳到 `.novel/`，减少目录污染。

## 适合谁

- 需要长期维护世界观、人物关系和章节正文的小说作者
- 希望在本地工作流中接入 AI 续写、改写和整理能力的创作者
- 希望项目目录干净、可版本管理、可迁移的写作团队

## 核心能力

- 工作区初始化：自动建立 `concept/`、`outline/`、`stories/`、`.novel/`
- Lexical 编辑器：多标签、自动保存、Markdown 写作与预览
- AI 对话面板：引用选区、流式输出、结果一键插入光标位置
- 多 Provider 支持：OpenAI 兼容接口、Claude、文心一言（兼容模式）
- 智能体（Agent）系统：内置模板，支持自定义与导入导出
- 创作辅助：智能补全（结合上下文与章节目标字数）
- 人物关系图谱：从 `concept/*.md` 抽取并可视化
- Git 面板：初始化、状态、diff、提交与历史查看

## 快速开始

### 1. 环境要求（Windows）

- Node.js 18+
- Rust stable（含 `cargo`）
- Visual Studio Build Tools（Desktop development with C++ / MSVC）
- WebView2 Runtime（Win10/11 通常已内置）

### 2. 本地开发

```powershell
npm install
npm run tauri:dev
```

### 3. 构建发行包

```powershell
npm install
npm run tauri:build
```

构建产物通常位于：

- `src-tauri/target/release/bundle/**`
- `src-tauri/target/release/*.exe`

## 工作区目录约定

```text
<workspace>/
  concept/   # 设定（仅 .md）
  outline/   # 大纲（仅 .md）
  stories/   # 正文（仅 .md）
  .novel/    # 缓存、索引、项目设置等非正文文件
```

### 约束规则

- `concept/outline/stories` 下仅允许写入 `.md`
- 与小说正文无关的项目文件统一放在 `.novel/`

## 常用流程

### 打开工作区

1. 在顶部输入工作区路径（例如 `D:\Novels\MyBook`）
2. 点击“打开”
3. 首次触发 AI 功能时自动完成目录和模板初始化

### 新建章节

- 点击“新建章节”或“开新章”
- 默认路径：`stories/chapter-YYYYMMDD-HHMM.md`

### AI 写作协作

- “引用选区”：把当前选中文本插入到 AI 输入上下文
- `Ctrl+Enter`：发送消息
- “插入到光标”：将 AI 输出插入当前编辑位置
- `Ctrl+Shift+L`：聚焦 AI 输入框

### 人物关系图谱数据来源

- `concept/characters.md`：人物列表（每行 `- 人名`）
- `concept/relations.md`：关系定义（`A -> B : 关系`）

## AI 与数据存储

### Provider 与 Agent 配置

在右侧 AI 面板打开“设置”后可配置：

- Provider（OpenAI 兼容 / Claude / 文心一言兼容）
- 输出格式（纯文本或 Markdown）
- Agent 提示词、温度、最大输出长度

### 配置与密钥保存策略

- 应用设置：`AppData/Novel-IDE/settings.json`
- 智能体库：`AppData/Novel-IDE/agents.json`
- 会话历史：`AppData/Novel-IDE/chat_history.json`
- API Key：写入系统 Keyring（Windows 为 Credential Manager），不明文落盘到 `settings.json`

## 开发脚本

- `npm run dev`：仅启动前端开发服务器（Vite, 1420）
- `npm run tauri:dev`：启动桌面开发模式
- `npm run build`：构建前端
- `npm run tauri:build`：构建桌面发行包
- `npm run test`：运行 Vitest 测试
- `npm run lint`：运行 ESLint
- `npm run clean`：清理构建产物

## 技术栈

- Desktop: Tauri v2（Rust）
- Frontend: React 19 + TypeScript + Vite（rolldown-vite）
- Editor: Lexical
- Network: reqwest
- Git: git2

## License

GPL-3.0
