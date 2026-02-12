## Spec-Kit（本项目内置写作规范）概览

Spec-Kit 在本项目中被定义为一套“可机读的方法论”：用统一的数据模型（StorySpec）描述故事，并用规则引擎校验三幕结构、角色弧线、情节转折与节奏控制。

### 工作区文件约定

- `.novel/.spec-kit/config.json`：全局方法论配置（类型、字数、章节、文体、节奏、比例、主题）
- `.novel/.spec-kit/archetypes.json`：角色原型库（英雄、导师、反派等）
- `.novel/.spec-kit/plot_nodes.json`：情节节点模板库（钩子、激励事件、转折点、高潮等）
- `.novel/.spec-kit/story_templates/*.json`：故事模板库（按 story_type 提供默认节拍）
- `.novel/.spec-kit/story_spec.json`：StorySpec（整本书的规格源数据）

初始化工作区时会自动生成以上文件（若已存在则不覆盖）。

### StorySpec 的核心字段（高层）

- `story`：题材、主题与文体（视角、时态、语调）
- `structure`：三幕与节拍（每个 beat 给出建议章节范围与叙事目的）
- `characters`：角色弧线（want/need/lie + arc_steps）
- `chapters`：章节与场景列表（每场景必须具备 Goal/Conflict/Stakes/Turn）

### 合规性规则（最小集）

- 结构：必须包含三幕，且关键节拍（hook、inciting_incident、turning_point_1、midpoint、turning_point_2、climax、resolution）至少各出现一次
- 场景：每个场景必须包含 Goal/Conflict/Stakes/Turn 四要素
- 弧线：主角必须有可追踪的 arc_steps，并在 midpoint 与 climax 前后发生明显转变
- 节奏：tension 曲线整体上升且在 midpoint 与 turn2 有跃迁，act3 解决冲突并落地后果

### Schema

- [config.schema.json](file:///d:/\.Programs/\.Program.Project/Novel-IDE/docs/spec-kit/config.schema.json)
- [story_spec.schema.json](file:///d:/\.Programs/\.Program.Project/Novel-IDE/docs/spec-kit/story_spec.schema.json)
