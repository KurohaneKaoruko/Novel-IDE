use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 拆书分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookAnalysis {
    pub title: String,
    pub author: Option<String>,
    pub total_words: usize,
    pub chapters: Vec<ChapterInfo>,
    pub outline: BookOutline,
    pub characters: Vec<CharacterInfo>,
    pub settings: Vec<SettingInfo>,
    pub themes: Vec<String>,
    pub style: String,
}

/// 章节信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterInfo {
    pub id: usize,
    pub title: String,
    pub start_line: usize,
    pub end_line: usize,
    pub word_count: usize,
    pub summary: String,
    pub key_events: Vec<String>,
    pub characters_appearing: Vec<String>,
}

/// 大纲信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookOutline {
    pub structure: String, // "线性"/"多线"/"环状"等
    pub acts: Vec<ActInfo>,
    pub arcs: Vec<ArcInfo>,
}

/// 幕信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActInfo {
    pub id: usize,
    pub name: String,
    pub description: String,
    pub chapters: Vec<usize>,
}

/// 故事线信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcInfo {
    pub id: usize,
    pub name: String,
    pub description: String,
    pub characters: Vec<String>,
}

/// 人物信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterInfo {
    pub name: String,
    pub role: String, // "主角"/"配角"/"反派"等
    pub description: String,
    pub appearances: Vec<usize>, // 出现的章节
}

/// 设定信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingInfo {
    pub name: String,
    pub category: String, // "世界观"/"物品"/"组织"等
    pub description: String,
}

/// 拆书配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookSplitConfig {
    pub split_by_chapters: bool,
    pub target_chapter_words: usize, // 目标章节字数
    pub extract_outline: bool,
    pub extract_characters: bool,
    pub extract_settings: bool,
    pub analyze_themes: bool,
    pub analyze_style: bool,
}

impl Default for BookSplitConfig {
    fn default() -> Self {
        Self {
            split_by_chapters: true,
            target_chapter_words: 3000,
            extract_outline: true,
            extract_characters: true,
            extract_settings: true,
            analyze_themes: true,
            analyze_style: true,
        }
    }
}

/// 拆分后的章节
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SplitChapter {
    pub id: usize,
    pub title: String,
    pub content: String,
    pub word_count: usize,
    pub summary: Option<String>,
}

/// 拆书结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookSplitResult {
    pub original_title: String,
    pub chapters: Vec<SplitChapter>,
    pub metadata: HashMap<String, String>,
}

impl BookAnalysis {
    pub fn new(title: &str) -> Self {
        Self {
            title: title.to_string(),
            author: None,
            total_words: 0,
            chapters: vec![],
            outline: BookOutline {
                structure: "未知".to_string(),
                acts: vec![],
                arcs: vec![],
            },
            characters: vec![],
            settings: vec![],
            themes: vec![],
            style: "未知".to_string(),
        }
    }
}
