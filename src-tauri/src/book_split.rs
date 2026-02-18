use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Book analysis result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookAnalysisResult {
    pub title: String,
    pub author: Option<String>,
    pub source: String, // source: original/fanfic/outline etc
    
    // structure analysis
    pub structure: BookStructure,
    pub plot_arcs: Vec<PlotLine>,
    
    // rhythm analysis
    pub rhythm: RhythmAnalysis,
    pub climax_points: Vec<ClimaxPoint>,
    
    // power moments analysis
    pub power_moments: Vec<PowerMoment>,
    
    // character analysis
    pub characters: Vec<CharacterAnalysis>,
    pub character_relationships: Vec<CharacterRelationship>,
    
    // world view
    pub world_settings: Vec<WorldSetting>,
    pub power_system: Vec<PowerSystem>,
    
    // writing techniques
    pub techniques: Vec<WritingTechnique>,
    
    // summary
    pub summary: String,
    pub learnable_points: Vec<String>,
}

/// Book structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookStructure {
    pub type: String, // linear/multi-threaded/circular/flashback etc
    pub acts: Vec<Act>,
    pub pacing: String, // fast/medium/slow
    pub audience: String, // target audience
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Act {
    pub id: usize,
    pub name: String, // setup/develop/climax/ending
    pub chapters: Vec<usize>,
    pub description: String,
}

/// Plot line
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlotLine {
    pub name: String,
    pub main: bool,
    pub chapters: Vec<usize>,
    pub description: String,
}

/// Rhythm analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RhythmAnalysis {
    pub average_chapter_length: usize, // average chapter word count
    pub conflict_density: String, // conflict density: high/medium/low
    pub turning_points: Vec<TurningPoint>,
    pub chapter_hooks: Vec<String>, // chapter hook types
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TurningPoint {
    pub chapter: usize,
    pub type: String, // major turn/小高潮/意外 etc
    pub description: String,
}

/// Climax point
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClimaxPoint {
    pub chapter: usize,
    pub type: String, // battle/emotion/reveal etc
    pub intensity: u8, // 1-10
    pub description: String,
}

/// Power moment / Thrilling moment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerMoment {
    pub chapter: usize,
    pub type: String, // face-slapping/revenge/harem/system reward etc
    pub description: String,
    pub frequency: String, // occurrence frequency
}

/// Character analysis
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterAnalysis {
    pub name: String,
    pub role: String, // protagonist/antagonist/supporting/tool
    pub archetype: String, // character archetype
    pub growth: String, // growth curve
    pub main_moments: Vec<String>, // highlight moments
    pub relationships: Vec<String>, // relationships with other characters
}

/// Character relationship
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterRelationship {
    pub from: String,
    pub to: String,
    pub type: String, // enemy/lover/brother/master-disciple etc
    pub description: String,
}

/// World setting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorldSetting {
    pub name: String,
    pub category: String, // geography/faction/item/rule etc
    pub importance: String, // core/important/auxiliary
    pub description: String,
}

/// Power system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PowerSystem {
    pub name: String,
    pub levels: Vec<String>, // level hierarchy
    pub cultivation_method: String, // cultivation method
    pub resources: Vec<String>, // resources/items
}

/// Writing technique
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WritingTechnique {
    pub category: String, // narrative/dialogue/description/rhythm etc
    pub technique: String,
    pub example: String,
    pub application: String, // how to apply
}

/// Book analysis config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookAnalysisConfig {
    pub target_words_per_chapter: usize,
    pub analyze_rhythm: bool,
    pub analyze_climax: bool,
    pub analyze_power_moments: bool,
    pub extract_characters: bool,
    pub extract_world: bool,
    pub extract_techniques: bool,
}

impl Default for BookAnalysisConfig {
    fn default() -> Self {
        Self {
            target_words_per_chapter: 3000,
            analyze_rhythm: true,
            analyze_climax: true,
            analyze_power_moments: true,
            extract_characters: true,
            extract_world: true,
            extract_techniques: true,
        }
    }
}

impl BookAnalysisResult {
    pub fn new(title: &str) -> Self {
        Self {
            title: title.to_string(),
            author: None,
            source: "unknown".to_string(),
            structure: BookStructure {
                type: "pending".to_string(),
                acts: vec![],
                pacing: "pending".to_string(),
                audience: "pending".to_string(),
            },
            plot_arcs: vec![],
            rhythm: RhythmAnalysis {
                average_chapter_length: 0,
                conflict_density: "pending".to_string(),
                turning_points: vec![],
                chapter_hooks: vec![],
            },
            climax_points: vec![],
            power_moments: vec![],
            characters: vec![],
            character_relationships: vec![],
            world_settings: vec![],
            power_system: vec![],
            techniques: vec![],
            summary: String::new(),
            learnable_points: vec![],
        }
    }
}
