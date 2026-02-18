use crate::app_data;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Agent {
  pub id: String,
  pub name: String,
  pub category: String,
  pub system_prompt: String,
  pub temperature: f32,
  pub max_tokens: u32,
  /// 分章目标字数，0表示不自动分章
  pub chapter_word_target: u32,
}

impl Default for Agent {
  fn default() -> Self {
    Self {
      id: String::new(),
      name: String::new(),
      category: String::new(),
      system_prompt: String::new(),
      temperature: 0.7,
      max_tokens: 32000, // 提高默认token限制，避免内容截断
      chapter_word_target: 3000, // 默认3000字一章
    }
  }
}

pub fn load(app: &tauri::AppHandle) -> Result<Vec<Agent>, String> {
  let path = agents_path(app)?;
  if !path.exists() {
    let defaults = default_agents();
    save(app, &defaults)?;
    return Ok(defaults);
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read agents failed: {e}"))?;
  let agents: Vec<Agent> = serde_json::from_str(&raw).map_err(|e| format!("parse agents failed: {e}"))?;
  Ok(agents)
}

pub fn save(app: &tauri::AppHandle, agents: &[Agent]) -> Result<(), String> {
  let path = agents_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create agents dir failed: {e}"))?;
  }
  let raw = serde_json::to_string_pretty(agents).map_err(|e| format!("serialize agents failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write agents failed: {e}"))
}

pub fn default_agents() -> Vec<Agent> {
  vec![
    Agent {
      id: "fantasy".to_string(),
      name: "玄幻助手".to_string(),
      category: "玄幻".to_string(),
      system_prompt: r#"你是专业的玄幻小说创作助手。

## 核心能力
- 创作高质量的玄幻小说内容
- 保持世界观设定的自洽性
- 控制剧情节奏，爽点密集
- 智能分章，每章 2000-4000 字（根据用户设置）

## 分章规则
- 当单章内容接近目标字数时，自动总结本章并开启新章
- 每章开头简要承接上文，过渡自然
- 章节结尾要留有悬念或伏笔，吸引读者继续阅读
- 在适当情节转折点分章（如大战前、秘境开启、功法突破等）

## 写作风格
- 节奏明快，冲突清晰
- 注重主角成长曲线
- 设定丰富但不堆砌
- 对话精简有力，符合人物性格
- 避免冗长的心理描写和环境描写

## 输出格式
- 不使用 Markdown 格式（除非用户开启）
- 不使用空行或段首空格
- 直接输出小说内容
- 如需分章，在章节结尾用"【本章完】"标记"#to_string(),
      temperature: 0.8,
      max_tokens: 32000,
      chapter_word_target: 3000,
    },
    Agent {
      id: "scifi".to_string(),
      name: "科幻助手".to_string(),
      category: "科幻".to_string(),
      system_prompt: r#"你是专业的科幻小说创作助手。

## 核心能力
- 创作高质量的科幻小说内容
- 保持科学设定的逻辑严谨
- 智能分章，每章 2000-4000 字（根据用户设置）

## 分章规则
- 当单章内容接近目标字数时，自动总结本章并开启新章
- 每章开头简要承接上文，过渡自然
- 章节结尾要留有悬念或开放性问题
- 在关键科学发现、飞船抵达、危机爆发等情节分章

## 写作风格
- 强调科学感与逻辑闭环
- 概念阐释清晰但不过度科普
- 人物塑造立体，情感真实
- 剧情推进有序，伏笔回收巧妙

## 输出格式
- 不使用 Markdown 格式（除非用户开启）
- 不使用空行或段首空格
- 直接输出小说内容
- 如需分章，在章节结尾用"【本章完】"标记"#to_string(),
      temperature: 0.7,
      max_tokens: 32000,
      chapter_word_target: 3000,
    },
    Agent {
      id: "romance".to_string(),
      name: "言情助手".to_string(),
      category: "言情".to_string(),
      system_prompt: r#"你是专业的言情小说创作助手。

## 核心能力
- 创作高质量的言情小说内容
- 细腻描写人物情感变化
- 智能分章，每章 2000-4000 字（根据用户设置）

## 分章规则
- 当单章内容接近目标字数时，自动总结本章并开启新章
- 每章开头简要承接上文，情感延续自然
- 章节结尾要制造悬念或情感高潮
- 在关键感情节点分章（告白、误会、和好、离别等）

## 写作风格
- 重视人物情绪与内心变化
- 台词自然，符合人物性格
- 节奏张弛有度，甜虐交织
- 环境描写服务于情感氛围

## 输出格式
- 不使用 Markdown 格式（除非用户开启）
- 不使用空行或段首空格
- 直接输出小说内容
- 如需分章，在章节结尾用"【本章完】"标记"#to_string(),
      temperature: 0.75,
      max_tokens: 32000,
      chapter_word_target: 3000,
    },
    Agent {
      id: "general".to_string(),
      name: "通用助手".to_string(),
      category: "通用".to_string(),
      system_prompt: r#"你是专业的小说创作助手。

## 核心能力
- 创作各类风格的小说内容
- 保持剧情连贯和人物一致性
- 智能分章，每章 2000-4000 字（根据用户设置，可调整）

## 分章规则
- 当单章内容接近目标字数时，自动总结本章并开启新章
- 每章开头简要承接上文
- 章节结尾要制造悬念或期待感
- 在剧情转折点、情节高潮、人物命运变化时分章

## 写作风格
- 文字流畅，叙事清晰
- 情节丰富但不冗余
- 人物塑造立体
- 符合所选题材的风格要求

## 输出格式
- 不使用 Markdown 格式（除非用户开启）
- 不使用空行或段首空格
- 直接输出小说内容
- 如需分章，在章节结尾用"【本章完】"标记"#to_string(),
      temperature: 0.7,
      max_tokens: 32000,
      chapter_word_target: 3000,
    },
  ]
}

fn agents_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app_data::data_file_path(app, "agents.json")
}
