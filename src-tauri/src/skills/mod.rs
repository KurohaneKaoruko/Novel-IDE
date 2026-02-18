use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Skill 定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub prompt: String,
    pub category: String,
    pub enabled: bool,
}

impl Skill {
    pub fn new(id: &str, name: &str, description: &str, category: &str, prompt: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            prompt: prompt.to_string(),
            category: category.to_string(),
            enabled: true,
        }
    }
}

/// 内置 Skill 库
pub fn builtin_skills() -> Vec<Skill> {
    vec![
        // 写作技巧类
        Skill::new(
            "style_wuwei",
            "无为风格",
            "使用无为风格写作：平淡如水的叙事，却暗藏机锋",
            r#"你是一个"无为"风格的作家。你的文字平淡如开水，却在细节处暗藏机锋。
            
写作特点：
- 几乎不做心理描写
- 通过动作和对话展现人物内心
- 环境描写极少
- 情节推进平缓但暗流涌动
- 对话简短，有时前言不搭后语

输出要求：
- 直接输出内容，不要解释
- 不使用 Markdown
- 不使用空行"#,
            "写作风格"
        ),
        Skill::new(
            "style_guanzhu",
            "馆zolh风格",
            "使用话唠风格写作：废话流，疯狂输出心理描写和环境描写",
            r#"你是一个"废话流"作家。你的文字像开了闸的水龙头，挡都挡不住。

写作特点：
- 大段大段的心理描写
- 详尽的环境描写（从天空到地面到空气的味道）
- 主角内心OS比弹幕还密集
- 一个简单动作能水500字
- 战斗时会详细描述每一招每一式

输出要求：
- 直接输出内容，不要解释
- 不使用 Markdown
- 尽情水"#,
            "写作风格"
        ),
        Skill::new(
            "style_jianjie",
            "简洁风格",
            "使用简洁风格写作：惜字如金，每句都有信息量",
            r#"你是一个简洁风格的作家。每一个字都有它的作用。

写作特点：
- 很少用形容词
- 动作描写为主
- 几乎不写心理
- 对话简短有力
- 场景转换用分隔符

输出要求：
- 直接输出内容，不要解释
- 不使用 Markdown
- 用最少的字写最多的信息"#,
            "写作风格"
        ),
        
        // 剧情类
        Skill::new(
            "plot_twist",
            "反转剧情",
            "在剧情中加入意想不到的反转",
            r#"你是一个擅长反转的作家。读者以为猜到了结局，但你总能给他们惊喜。

技巧：
- 提前埋下伏笔，但不明显
- 反转要合理，不能强行
- 反转后要解释清楚为什么
- 一个反转可以，多了会腻
- 反转不等于降智

输出：续写内容，在结尾加入反转"#,
            "剧情技巧"
        ),
        Skill::new(
            "plot_suspense",
            "悬念制造",
            "在章节结尾制造悬念，吸引读者",
            r#"你是一个悬念大师。读者明明已经很累了，明明第二天还要上班，但就是想熬夜看完。

技巧：
- 章节结尾中断关键信息
- 公布一个秘密，但隐藏更重要的问题
- 人物陷入危险但在高潮停止
- 用对比/并列引出悬念

输出：在内容结尾添加悬念"#,
            "剧情技巧"
        ),
        
        // 人物类
        Skill::new(
            "character_dialogue",
            "对话设计",
            "设计符合人物性格的对话",
            r#"你是一个人物对话专家。你写的对话让读者一眼就能认出是谁在说话。

技巧：
- 不同人物用不同的说话方式
- 身份地位影响说话语气
- 心里想的不一定要说出来
- 对话要推动剧情
- 避免废话连篇

根据以下人物设定，设计合适的对话：
- 性格：
- 身份：
- 与对方的关系：
- 当前情绪："#,
            "人物塑造"
        ),
        
        // 完善类
        Skill::new(
            "polish",
            "润色修改",
            "对已有内容进行润色，提升文笔",
            r#"你是文字润色专家。你的任务是让原本平淡的文字变得生动。

润色方向：
- 动词替换：把"走"变成"踏""踩""溜"
- 形容词：增加感官细节
- 删减冗余：去掉废话
- 节奏感：长短句结合
- 画面感：用比喻通感

要求：
- 保持原意
- 不要过度润色
- 保留个人风格"#,
            "完善修改"
        ),
        Skill::new(
            "expand",
            "扩写",
            "对简短内容进行扩写，丰富细节",
            r#"你是扩写专家。你能把一句话变成一段话，把一段话变成一章。

扩写技巧：
- 添加环境描写
- 加入心理描写
- 细化动作
- 增加对话
- 感官细节（视听觉味嗅觉触）

要求：
- 围绕核心内容扩写
- 不要偏离原意
- 扩写部分要自然"#,
            "完善修改"
        ),
        Skill::new(
            "condense",
            "缩写",
            "对冗长内容进行精简",
            r#"你是缩写专家。你能把废话变成干货。

缩写技巧：
- 删除重复信息
- 合并相似内容
- 保留关键信息
- 用一句话代替一段话

要求：
- 保留核心信息
- 保持逻辑连贯
- 不要影响理解"#,
            "完善修改"
        ),
        
        // 创意类
        Skill::new(
            "brainstorm",
            "头脑风暴",
            "针对某个主题进行创意发散",
            r#"你是创意头脑风暴专家。针对给定主题，产出大量创意点子。

方法：
- 自由联想
- 强制关联
- 极端化思考
- 打破常规
- 从多个角度切入

输出格式：
列出10-20个创意点子，每个用1-2句话描述"#,
            "创意生成"
        ),
        Skill::new(
            "outline_gen",
            "大纲生成",
            "根据题材生成小说大纲",
            r#"你是大纲生成专家。

需要信息：
- 题材类型：
- 主角设定：
- 核心冲突：
- 目标字数：

输出结构：
1. 简介（一句话）
2. 主线剧情（3-5个情节点）
3. 支线设定（可选）
4. 人物小传（主角+关键配角）
5. 世界观设定（如果需要）"#,
            "创意生成"
        ),
    ]
}

/// Skill 管理器
pub struct SkillManager {
    skills: HashMap<String, Skill>,
}

impl SkillManager {
    pub fn new() -> Self {
        let mut manager = Self {
            skills: HashMap::new(),
        };
        // 加载内置 skills
        for skill in builtin_skills() {
            manager.skills.insert(skill.id.clone(), skill);
        }
        manager
    }

    #[allow(dead_code)]
    pub fn get(&self, id: &str) -> Option<&Skill> {
        self.skills.get(id)
    }

    pub fn get_all(&self) -> Vec<&Skill> {
        self.skills.values().collect()
    }

    pub fn get_by_category(&self, category: &str) -> Vec<&Skill> {
        self.skills
            .values()
            .filter(|s| s.category == category && s.enabled)
            .collect()
    }

    pub fn categories(&self) -> Vec<String> {
        let mut cats: Vec<String> = self.skills
            .values()
            .map(|s| s.category.clone())
            .collect();
        cats.sort();
        cats.dedup();
        cats
    }

    #[allow(dead_code)]
    pub fn add(&mut self, skill: Skill) {
        self.skills.insert(skill.id.clone(), skill);
    }

    #[allow(dead_code)]
    pub fn remove(&mut self, id: &str) {
        self.skills.remove(id);
    }

    pub fn apply_skill(&self, skill_id: &str, content: &str) -> String {
        if let Some(skill) = self.skills.get(skill_id) {
            format!("{}\n\n---\n\n{}", skill.prompt, content)
        } else {
            content.to_string()
        }
    }
}

impl Default for SkillManager {
    fn default() -> Self {
        Self::new()
    }
}
