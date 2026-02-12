use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Serialize, Deserialize, Clone)]
pub struct SpecKitConfig {
  pub spec_kit_version: String,
  pub story_type: String,
  pub target_words: u32,
  pub chapter_count: u32,
  pub chapter_word_target: u32,
  pub style: SpecKitStyleConfig,
  pub rhythm: SpecKitRhythmConfig,
  pub ratios: SpecKitRatioConfig,
  pub theme: SpecKitThemeConfig,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SpecKitStyleConfig {
  pub pov: String,
  pub tense: String,
  pub tone: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SpecKitRhythmConfig {
  pub act1_ratio: f32,
  pub act2_ratio: f32,
  pub act3_ratio: f32,
  pub tension_baseline: u8,
  pub tension_peak: u8,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SpecKitRatioConfig {
  pub dialogue: f32,
  pub action: f32,
  pub description: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SpecKitThemeConfig {
  pub statement: String,
  pub keywords: Vec<String>,
}

impl Default for SpecKitConfig {
  fn default() -> Self {
    Self {
      spec_kit_version: "1.0.0".to_string(),
      story_type: "coming_of_age".to_string(),
      target_words: 100_000,
      chapter_count: 30,
      chapter_word_target: 3_500,
      style: SpecKitStyleConfig {
        pov: "third_limited".to_string(),
        tense: "past".to_string(),
        tone: "serious".to_string(),
      },
      rhythm: SpecKitRhythmConfig {
        act1_ratio: 0.25,
        act2_ratio: 0.50,
        act3_ratio: 0.25,
        tension_baseline: 20,
        tension_peak: 95,
      },
      ratios: SpecKitRatioConfig {
        dialogue: 0.35,
        action: 0.25,
        description: 0.40,
      },
      theme: SpecKitThemeConfig {
        statement: "".to_string(),
        keywords: vec![],
      },
    }
  }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ArchetypeDb {
  pub spec_kit_version: String,
  pub archetypes: Vec<Archetype>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Archetype {
  pub id: String,
  pub name: String,
  pub role: String,
  pub core_want: String,
  pub core_need: String,
  pub shadow: String,
}

impl Default for ArchetypeDb {
  fn default() -> Self {
    Self {
      spec_kit_version: "1.0.0".to_string(),
      archetypes: vec![
        Archetype {
          id: "hero".to_string(),
          name: "英雄".to_string(),
          role: "protagonist".to_string(),
          core_want: "获得或达成一个明确目标".to_string(),
          core_need: "完成内在成长并纠正自我谎言".to_string(),
          shadow: "固执、自负或逃避责任".to_string(),
        },
        Archetype {
          id: "mentor".to_string(),
          name: "导师".to_string(),
          role: "support".to_string(),
          core_want: "把经验传承下去或弥补过去遗憾".to_string(),
          core_need: "学会放手与信任主角".to_string(),
          shadow: "操控欲或过度保护".to_string(),
        },
        Archetype {
          id: "antagonist".to_string(),
          name: "反派".to_string(),
          role: "antagonist".to_string(),
          core_want: "维护自身利益或秩序".to_string(),
          core_need: "面对自身的恐惧或缺失".to_string(),
          shadow: "极端化、以手段替代目的".to_string(),
        },
      ],
    }
  }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PlotNodeTemplateDb {
  pub spec_kit_version: String,
  pub nodes: Vec<PlotNodeTemplate>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PlotNodeTemplate {
  pub id: String,
  pub name: String,
  pub act: String,
  pub purpose: String,
  pub required_fields: Vec<String>,
}

impl Default for PlotNodeTemplateDb {
  fn default() -> Self {
    Self {
      spec_kit_version: "1.0.0".to_string(),
      nodes: vec![
        PlotNodeTemplate {
          id: "hook".to_string(),
          name: "开场钩子".to_string(),
          act: "act1".to_string(),
          purpose: "迅速制造好奇心与期待".to_string(),
          required_fields: vec!["conflict".to_string(), "question".to_string()],
        },
        PlotNodeTemplate {
          id: "inciting_incident".to_string(),
          name: "激励事件".to_string(),
          act: "act1".to_string(),
          purpose: "打破旧平衡，迫使主角行动".to_string(),
          required_fields: vec!["change".to_string(), "stakes".to_string()],
        },
        PlotNodeTemplate {
          id: "turning_point_1".to_string(),
          name: "第一转折点".to_string(),
          act: "act1".to_string(),
          purpose: "进入新局面，承诺主线冲突".to_string(),
          required_fields: vec!["decision".to_string(), "new_goal".to_string()],
        },
        PlotNodeTemplate {
          id: "midpoint".to_string(),
          name: "中点".to_string(),
          act: "act2".to_string(),
          purpose: "信息翻转或价值翻转，使主角策略改变".to_string(),
          required_fields: vec!["revelation".to_string(), "shift".to_string()],
        },
        PlotNodeTemplate {
          id: "turning_point_2".to_string(),
          name: "第二转折点".to_string(),
          act: "act2".to_string(),
          purpose: "代价提升到不可退让的程度".to_string(),
          required_fields: vec!["loss".to_string(), "point_of_no_return".to_string()],
        },
        PlotNodeTemplate {
          id: "climax".to_string(),
          name: "高潮".to_string(),
          act: "act3".to_string(),
          purpose: "终极对决，解决核心冲突".to_string(),
          required_fields: vec!["final_choice".to_string(), "resolution".to_string()],
        },
        PlotNodeTemplate {
          id: "resolution".to_string(),
          name: "结局/尾声".to_string(),
          act: "act3".to_string(),
          purpose: "兑现主题，交代后果与新平衡".to_string(),
          required_fields: vec!["new_normal".to_string()],
        },
      ],
    }
  }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StoryTemplate {
  pub spec_kit_version: String,
  pub template_id: String,
  pub display_name: String,
  pub story_type: String,
  pub default_theme_statement: String,
  pub beats: Vec<TemplateBeat>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TemplateBeat {
  pub beat_id: String,
  pub act: String,
  pub summary: String,
}

pub fn default_story_templates() -> Vec<StoryTemplate> {
  vec![
    StoryTemplate {
      spec_kit_version: "1.0.0".to_string(),
      template_id: "coming_of_age".to_string(),
      display_name: "成长".to_string(),
      story_type: "coming_of_age".to_string(),
      default_theme_statement: "成长往往伴随代价，但选择塑造自我。".to_string(),
      beats: vec![
        TemplateBeat {
          beat_id: "hook".to_string(),
          act: "act1".to_string(),
          summary: "展示主角当下困境与缺口。".to_string(),
        },
        TemplateBeat {
          beat_id: "inciting_incident".to_string(),
          act: "act1".to_string(),
          summary: "外部事件迫使主角离开舒适区。".to_string(),
        },
        TemplateBeat {
          beat_id: "turning_point_1".to_string(),
          act: "act1".to_string(),
          summary: "主角做出承诺式决定，进入新世界。".to_string(),
        },
        TemplateBeat {
          beat_id: "midpoint".to_string(),
          act: "act2".to_string(),
          summary: "真相揭示，主角的策略与自我认知改变。".to_string(),
        },
        TemplateBeat {
          beat_id: "turning_point_2".to_string(),
          act: "act2".to_string(),
          summary: "重大损失，迫使主角直面内在谎言。".to_string(),
        },
        TemplateBeat {
          beat_id: "climax".to_string(),
          act: "act3".to_string(),
          summary: "终极选择，完成成长并解决外部冲突。".to_string(),
        },
        TemplateBeat {
          beat_id: "resolution".to_string(),
          act: "act3".to_string(),
          summary: "新平衡确立，主题回声收束。".to_string(),
        },
      ],
    },
    StoryTemplate {
      spec_kit_version: "1.0.0".to_string(),
      template_id: "revenge".to_string(),
      display_name: "复仇".to_string(),
      story_type: "revenge".to_string(),
      default_theme_statement: "复仇会吞噬人，也会照亮人。".to_string(),
      beats: vec![
        TemplateBeat {
          beat_id: "hook".to_string(),
          act: "act1".to_string(),
          summary: "展示伤害与不公的余波。".to_string(),
        },
        TemplateBeat {
          beat_id: "inciting_incident".to_string(),
          act: "act1".to_string(),
          summary: "复仇目标出现或线索浮现。".to_string(),
        },
        TemplateBeat {
          beat_id: "turning_point_1".to_string(),
          act: "act1".to_string(),
          summary: "主角越界，选择复仇路线。".to_string(),
        },
        TemplateBeat {
          beat_id: "midpoint".to_string(),
          act: "act2".to_string(),
          summary: "主角接近目标，同时暴露更深阴谋。".to_string(),
        },
        TemplateBeat {
          beat_id: "turning_point_2".to_string(),
          act: "act2".to_string(),
          summary: "代价失控，主角失去重要之物。".to_string(),
        },
        TemplateBeat {
          beat_id: "climax".to_string(),
          act: "act3".to_string(),
          summary: "终局对决，复仇与救赎二选一。".to_string(),
        },
        TemplateBeat {
          beat_id: "resolution".to_string(),
          act: "act3".to_string(),
          summary: "后果落地，主角付出或放下。".to_string(),
        },
      ],
    },
    StoryTemplate {
      spec_kit_version: "1.0.0".to_string(),
      template_id: "romance".to_string(),
      display_name: "爱情".to_string(),
      story_type: "romance".to_string(),
      default_theme_statement: "亲密需要勇气与边界。".to_string(),
      beats: vec![
        TemplateBeat {
          beat_id: "hook".to_string(),
          act: "act1".to_string(),
          summary: "主角的情感缺口与关系困境。".to_string(),
        },
        TemplateBeat {
          beat_id: "inciting_incident".to_string(),
          act: "act1".to_string(),
          summary: "邂逅与碰撞，建立吸引与障碍。".to_string(),
        },
        TemplateBeat {
          beat_id: "turning_point_1".to_string(),
          act: "act1".to_string(),
          summary: "两人被迫绑定或做出情感承诺。".to_string(),
        },
        TemplateBeat {
          beat_id: "midpoint".to_string(),
          act: "act2".to_string(),
          summary: "关系升温与真相揭示并行。".to_string(),
        },
        TemplateBeat {
          beat_id: "turning_point_2".to_string(),
          act: "act2".to_string(),
          summary: "误解/背叛/代价，关系濒临破裂。".to_string(),
        },
        TemplateBeat {
          beat_id: "climax".to_string(),
          act: "act3".to_string(),
          summary: "终极选择：坦白、牺牲或共同成长。".to_string(),
        },
        TemplateBeat {
          beat_id: "resolution".to_string(),
          act: "act3".to_string(),
          summary: "关系新平衡与主题回声。".to_string(),
        },
      ],
    },
  ]
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorySpec {
  pub spec_kit_version: String,
  pub story: StorySpecStory,
  pub structure: StorySpecStructure,
  pub characters: Vec<StorySpecCharacter>,
  pub chapters: Vec<StorySpecChapter>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorySpecStory {
  pub title: String,
  pub logline: String,
  pub story_type: String,
  pub target_words: u32,
  pub theme_statement: String,
  pub theme_keywords: Vec<String>,
  pub style: SpecKitStyleConfig,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorySpecStructure {
  pub acts: Vec<StorySpecAct>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorySpecAct {
  pub id: String,
  pub name: String,
  pub beats: Vec<StorySpecBeat>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorySpecBeat {
  pub id: String,
  pub name: String,
  pub target_chapter_range: [u32; 2],
  pub purpose: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorySpecCharacter {
  pub id: String,
  pub name: String,
  pub archetype_id: String,
  pub want: String,
  pub need: String,
  pub lie: String,
  pub arc_steps: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorySpecChapter {
  pub id: String,
  pub title: String,
  pub act: String,
  pub target_words: u32,
  pub beat_id: String,
  pub scenes: Vec<StorySpecScene>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct StorySpecScene {
  pub id: String,
  pub goal: String,
  pub conflict: String,
  pub stakes: String,
  pub turn: String,
  pub pov: String,
  pub location: String,
  pub characters: Vec<String>,
}

impl Default for StorySpec {
  fn default() -> Self {
    let config = SpecKitConfig::default();
    let chapter_count = config.chapter_count.max(1);
    let act1_end = ((chapter_count as f32) * config.rhythm.act1_ratio).round().max(1.0) as u32;
    let act3_start = (chapter_count as i32 - ((chapter_count as f32) * config.rhythm.act3_ratio).round() as i32)
      .max(1) as u32;
    let beat_defaults = PlotNodeTemplateDb::default();

    let beats = beat_defaults
      .nodes
      .into_iter()
      .map(|n| StorySpecBeat {
        id: n.id.clone(),
        name: n.name,
        target_chapter_range: match n.act.as_str() {
          "act1" => [1, act1_end],
          "act2" => [act1_end.saturating_add(1), act3_start.saturating_sub(1).max(act1_end.saturating_add(1))],
          _ => [act3_start, chapter_count],
        },
        purpose: n.purpose,
      })
      .collect::<Vec<_>>();

    let acts = vec![
      StorySpecAct {
        id: "act1".to_string(),
        name: "第一幕".to_string(),
        beats: beats.iter().cloned().filter(|b| b.target_chapter_range[0] <= act1_end).collect(),
      },
      StorySpecAct {
        id: "act2".to_string(),
        name: "第二幕".to_string(),
        beats: beats
          .iter()
          .cloned()
          .filter(|b| b.target_chapter_range[0] > act1_end && b.target_chapter_range[0] < act3_start)
          .collect(),
      },
      StorySpecAct {
        id: "act3".to_string(),
        name: "第三幕".to_string(),
        beats: beats.iter().cloned().filter(|b| b.target_chapter_range[0] >= act3_start).collect(),
      },
    ];

    Self {
      spec_kit_version: "1.0.0".to_string(),
      story: StorySpecStory {
        title: "".to_string(),
        logline: "".to_string(),
        story_type: config.story_type.clone(),
        target_words: config.target_words,
        theme_statement: config.theme.statement.clone(),
        theme_keywords: config.theme.keywords.clone(),
        style: config.style.clone(),
      },
      structure: StorySpecStructure { acts },
      characters: vec![],
      chapters: vec![
        StorySpecChapter {
          id: "chapter-1".to_string(),
          title: "第一章".to_string(),
          act: "act1".to_string(),
          target_words: config.chapter_word_target,
          beat_id: "hook".to_string(),
          scenes: vec![StorySpecScene {
            id: "scene-1".to_string(),
            goal: "".to_string(),
            conflict: "".to_string(),
            stakes: "".to_string(),
            turn: "".to_string(),
            pov: config.style.pov.clone(),
            location: "".to_string(),
            characters: vec![],
          }],
        },
      ],
    }
  }
}

pub fn ensure_spec_kit_defaults(novel_dir: &Path) -> Result<(), String> {
  let spec_dir = novel_dir.join(".spec-kit");
  let template_dir = spec_dir.join("story_templates");

  fs::create_dir_all(&template_dir).map_err(|e| format!("create spec-kit dir failed: {e}"))?;

  write_if_missing(
    &spec_dir.join("config.json"),
    &serde_json::to_string_pretty(&SpecKitConfig::default()).map_err(|e| format!("serialize spec-kit config failed: {e}"))?,
  )?;

  write_if_missing(
    &spec_dir.join("archetypes.json"),
    &serde_json::to_string_pretty(&ArchetypeDb::default()).map_err(|e| format!("serialize archetypes failed: {e}"))?,
  )?;

  write_if_missing(
    &spec_dir.join("plot_nodes.json"),
    &serde_json::to_string_pretty(&PlotNodeTemplateDb::default())
      .map_err(|e| format!("serialize plot nodes failed: {e}"))?,
  )?;

  write_if_missing(
    &spec_dir.join("story_spec.json"),
    &serde_json::to_string_pretty(&StorySpec::default()).map_err(|e| format!("serialize story spec failed: {e}"))?,
  )?;

  for t in default_story_templates() {
    let path = template_dir.join(format!("{}.json", t.template_id));
    let raw = serde_json::to_string_pretty(&t).map_err(|e| format!("serialize story template failed: {e}"))?;
    write_if_missing(&path, &raw)?;
  }

  Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ValidationIssue {
  pub severity: String,
  pub code: String,
  pub message: String,
  pub path: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ValidationReport {
  pub issues: Vec<ValidationIssue>,
}

pub fn load_config(novel_dir: &Path) -> Result<SpecKitConfig, String> {
  let path = novel_dir.join(".spec-kit").join("config.json");
  let raw = fs::read_to_string(&path).map_err(|e| format!("read spec-kit config failed: {e}"))?;
  serde_json::from_str(&raw).map_err(|e| format!("parse spec-kit config failed: {e}"))
}

pub fn load_story_template(novel_dir: &Path, template_id: &str) -> Result<StoryTemplate, String> {
  let path = novel_dir
    .join(".spec-kit")
    .join("story_templates")
    .join(format!("{template_id}.json"));
  if path.exists() {
    let raw = fs::read_to_string(&path).map_err(|e| format!("read story template failed: {e}"))?;
    return serde_json::from_str(&raw).map_err(|e| format!("parse story template failed: {e}"));
  }
  default_story_templates()
    .into_iter()
    .find(|t| t.template_id == template_id)
    .ok_or_else(|| format!("story template not found: {template_id}"))
}

pub fn generate_story_spec_from_config(config: &SpecKitConfig, template: &StoryTemplate) -> StorySpec {
  let chapter_count = config.chapter_count.max(1);
  let mut act1_count = ((chapter_count as f32) * config.rhythm.act1_ratio).round() as i32;
  act1_count = act1_count.clamp(1, chapter_count as i32 - 2);
  let mut act3_count = ((chapter_count as f32) * config.rhythm.act3_ratio).round() as i32;
  act3_count = act3_count.clamp(1, chapter_count as i32 - act1_count - 1);
  let mut act2_count = chapter_count as i32 - act1_count - act3_count;
  if act2_count < 1 {
    act2_count = 1;
    act3_count = chapter_count as i32 - act1_count - act2_count;
    if act3_count < 1 {
      act3_count = 1;
      act1_count = (chapter_count as i32 - act2_count - act3_count).clamp(1, chapter_count as i32 - 2);
    }
  }

  let act1_end = act1_count as u32;
  let act2_end = (chapter_count as i32 - act3_count) as u32;
  let act3_start = act2_end.saturating_add(1);

  let inciting = (chapter_count as f32 * 0.12).round().max(1.0) as u32;
  let inciting_ch = inciting.clamp(1, act1_end.max(1));
  let tp1_ch = act1_end;
  let midpoint_ch = (act1_end as i32 + (act2_count / 2).max(1)) as u32;
  let midpoint_ch = midpoint_ch.clamp(act1_end.saturating_add(1), act2_end.max(act1_end.saturating_add(1)));
  let tp2_ch = act2_end.max(act1_end.saturating_add(1));
  let climax_ch = act3_start.min(chapter_count);
  let resolution_ch = chapter_count;

  let mut beat_by_chapter = std::collections::BTreeMap::<u32, String>::new();
  beat_by_chapter.insert(1, "hook".to_string());
  beat_by_chapter.insert(inciting_ch, "inciting_incident".to_string());
  beat_by_chapter.insert(tp1_ch, "turning_point_1".to_string());
  beat_by_chapter.insert(midpoint_ch, "midpoint".to_string());
  beat_by_chapter.insert(tp2_ch, "turning_point_2".to_string());
  beat_by_chapter.insert(climax_ch, "climax".to_string());
  beat_by_chapter.insert(resolution_ch, "resolution".to_string());

  let chapters = (1..=chapter_count)
    .map(|idx| {
      let act = if idx <= act1_end {
        "act1"
      } else if idx <= act2_end {
        "act2"
      } else {
        "act3"
      };

      let beat_id = beat_by_chapter
        .get(&idx)
        .cloned()
        .unwrap_or_else(|| match act {
          "act1" => "act1_progress".to_string(),
          "act2" => "act2_escalation".to_string(),
          _ => "act3_fallout".to_string(),
        });

      StorySpecChapter {
        id: format!("chapter-{idx}"),
        title: format!("第{idx}章"),
        act: act.to_string(),
        target_words: config.chapter_word_target,
        beat_id,
        scenes: vec![StorySpecScene {
          id: format!("scene-{idx}-1"),
          goal: "".to_string(),
          conflict: "".to_string(),
          stakes: "".to_string(),
          turn: "".to_string(),
          pov: config.style.pov.clone(),
          location: "".to_string(),
          characters: vec![],
        }],
      }
    })
    .collect::<Vec<_>>();

  let beats = template
    .beats
    .iter()
    .map(|b| StorySpecBeat {
      id: b.beat_id.clone(),
      name: beat_name(&b.beat_id),
      target_chapter_range: match b.act.as_str() {
        "act1" => [1, act1_end],
        "act2" => [act1_end.saturating_add(1), act2_end],
        _ => [act3_start, chapter_count],
      },
      purpose: b.summary.clone(),
    })
    .collect::<Vec<_>>();

  let mut acts = vec![
    StorySpecAct {
      id: "act1".to_string(),
      name: "第一幕".to_string(),
      beats: vec![],
    },
    StorySpecAct {
      id: "act2".to_string(),
      name: "第二幕".to_string(),
      beats: vec![],
    },
    StorySpecAct {
      id: "act3".to_string(),
      name: "第三幕".to_string(),
      beats: vec![],
    },
  ];

  for b in beats {
    if b.target_chapter_range[0] <= act1_end {
      acts[0].beats.push(b);
    } else if b.target_chapter_range[0] <= act2_end {
      acts[1].beats.push(b);
    } else {
      acts[2].beats.push(b);
    }
  }

  StorySpec {
    spec_kit_version: "1.0.0".to_string(),
    story: StorySpecStory {
      title: "".to_string(),
      logline: "".to_string(),
      story_type: config.story_type.clone(),
      target_words: config.target_words,
      theme_statement: if config.theme.statement.trim().is_empty() {
        template.default_theme_statement.clone()
      } else {
        config.theme.statement.clone()
      },
      theme_keywords: config.theme.keywords.clone(),
      style: config.style.clone(),
    },
    structure: StorySpecStructure { acts },
    characters: vec![],
    chapters,
  }
}

pub fn validate_story_spec(spec: &StorySpec, config: Option<&SpecKitConfig>) -> ValidationReport {
  let mut issues: Vec<ValidationIssue> = vec![];

  let required_beats = [
    "hook",
    "inciting_incident",
    "turning_point_1",
    "midpoint",
    "turning_point_2",
    "climax",
    "resolution",
  ];

  let act_ids = spec.structure.acts.iter().map(|a| a.id.as_str()).collect::<Vec<_>>();
  for a in ["act1", "act2", "act3"] {
    if !act_ids.iter().any(|id| *id == a) {
      issues.push(ValidationIssue {
        severity: "error".to_string(),
        code: "structure.missing_act".to_string(),
        message: format!("缺少幕：{a}"),
        path: "structure.acts".to_string(),
      });
    }
  }

  if spec.characters.is_empty() {
    issues.push(ValidationIssue {
      severity: "warning".to_string(),
      code: "character.none".to_string(),
      message: "未定义角色，无法进行弧线匹配".to_string(),
      path: "characters".to_string(),
    });
  } else {
    let hero_count = spec.characters.iter().filter(|c| c.archetype_id == "hero").count();
    if hero_count == 0 {
      issues.push(ValidationIssue {
        severity: "error".to_string(),
        code: "character.missing_hero".to_string(),
        message: "缺少主角（archetype_id=hero）".to_string(),
        path: "characters".to_string(),
      });
    }
    for (i, c) in spec.characters.iter().enumerate() {
      if c.archetype_id == "hero" && c.arc_steps.len() < 5 {
        issues.push(ValidationIssue {
          severity: "warning".to_string(),
          code: "character.arc_too_short".to_string(),
          message: format!("主角弧线步骤过少：{}", c.arc_steps.len()),
          path: format!("characters[{i}].arc_steps"),
        });
      }
    }
  }

  let mut beat_present = std::collections::BTreeMap::<String, bool>::new();
  for b in required_beats {
    beat_present.insert(b.to_string(), false);
  }
  for (i, ch) in spec.chapters.iter().enumerate() {
    if beat_present.contains_key(&ch.beat_id) {
      beat_present.insert(ch.beat_id.clone(), true);
    }

    let scene = ch.scenes.get(0);
    if scene.is_none() {
      issues.push(ValidationIssue {
        severity: "warning".to_string(),
        code: "chapter.no_scenes".to_string(),
        message: "章节缺少场景".to_string(),
        path: format!("chapters[{i}].scenes"),
      });
      continue;
    }
    let s = scene.unwrap();
    let missing = [
      ("goal", s.goal.trim().is_empty()),
      ("conflict", s.conflict.trim().is_empty()),
      ("stakes", s.stakes.trim().is_empty()),
      ("turn", s.turn.trim().is_empty()),
    ]
    .into_iter()
    .filter(|(_, v)| *v)
    .map(|(k, _)| k)
    .collect::<Vec<_>>();
    if !missing.is_empty() {
      issues.push(ValidationIssue {
        severity: "warning".to_string(),
        code: "scene.missing_gcsT".to_string(),
        message: format!("场景缺少要素：{}", missing.join(", ")),
        path: format!("chapters[{i}].scenes[0]"),
      });
    }
  }

  for (beat, ok) in beat_present {
    if !ok {
      issues.push(ValidationIssue {
        severity: "error".to_string(),
        code: "structure.missing_beat".to_string(),
        message: format!("缺少关键节拍：{beat}"),
        path: "chapters[].beat_id".to_string(),
      });
    }
  }

  let act_rank = |act: &str| match act {
    "act1" => 1,
    "act2" => 2,
    "act3" => 3,
    _ => 99,
  };

  let mut prev_rank = 0;
  for (i, ch) in spec.chapters.iter().enumerate() {
    let r = act_rank(&ch.act);
    if r < prev_rank {
      issues.push(ValidationIssue {
        severity: "error".to_string(),
        code: "structure.act_order".to_string(),
        message: format!("章节幕顺序倒退：{}（第{}章）", ch.act, i + 1),
        path: format!("chapters[{i}].act"),
      });
    }
    prev_rank = prev_rank.max(r);
  }

  let mut beat_pos = std::collections::BTreeMap::<&str, usize>::new();
  for (i, ch) in spec.chapters.iter().enumerate() {
    let b = ch.beat_id.as_str();
    if required_beats.iter().any(|x| *x == b) && !beat_pos.contains_key(b) {
      beat_pos.insert(b, i);
    }
  }

  let ordered = [
    "hook",
    "inciting_incident",
    "turning_point_1",
    "midpoint",
    "turning_point_2",
    "climax",
    "resolution",
  ];
  for w in ordered.windows(2) {
    let a = w[0];
    let b = w[1];
    if let (Some(pa), Some(pb)) = (beat_pos.get(a), beat_pos.get(b)) {
      if pa >= pb {
        issues.push(ValidationIssue {
          severity: "error".to_string(),
          code: "pacing.beat_order".to_string(),
          message: format!("节拍顺序错误：{a} 应在 {b} 之前"),
          path: "chapters[].beat_id".to_string(),
        });
      }
    }
  }

  let expected_act_for_beat = |beat: &str| match beat {
    "hook" | "inciting_incident" | "turning_point_1" => "act1",
    "midpoint" | "turning_point_2" => "act2",
    "climax" | "resolution" => "act3",
    _ => "",
  };
  for (beat, idx) in beat_pos.iter() {
    let exp = expected_act_for_beat(beat);
    if !exp.is_empty() && spec.chapters.get(*idx).is_some_and(|c| c.act != exp) {
      let actual = &spec.chapters[*idx].act;
      issues.push(ValidationIssue {
        severity: "error".to_string(),
        code: "pacing.beat_act_mismatch".to_string(),
        message: format!("节拍所在幕不匹配：{beat} 期望 {exp}，实际 {actual}"),
        path: format!("chapters[{}].act", idx),
      });
    }
  }

  if let Some(cfg) = config {
    let chapter_count = spec.chapters.len() as i32;
    if chapter_count > 0 {
      let target_act1 = (chapter_count as f32 * cfg.rhythm.act1_ratio).round() as i32;
      let target_act3 = (chapter_count as f32 * cfg.rhythm.act3_ratio).round() as i32;
      let target_act2 = chapter_count - target_act1 - target_act3;

      let actual_act1 = spec.chapters.iter().filter(|c| c.act == "act1").count() as i32;
      let actual_act2 = spec.chapters.iter().filter(|c| c.act == "act2").count() as i32;
      let actual_act3 = spec.chapters.iter().filter(|c| c.act == "act3").count() as i32;

      let deltas = [
        ("act1", actual_act1 - target_act1),
        ("act2", actual_act2 - target_act2),
        ("act3", actual_act3 - target_act3),
      ];
      for (act, d) in deltas {
        if d.abs() >= 2 {
          issues.push(ValidationIssue {
            severity: "warning".to_string(),
            code: "pacing.act_ratio_drift".to_string(),
            message: format!("幕章节比例偏离：{act} 偏离 {d} 章"),
            path: "chapters[].act".to_string(),
          });
        }
      }

      let act1_end = spec
        .chapters
        .iter()
        .rposition(|c| c.act == "act1")
        .map(|i| i as i32)
        .unwrap_or(-1);
      let act2_end = spec
        .chapters
        .iter()
        .rposition(|c| c.act == "act2")
        .map(|i| i as i32)
        .unwrap_or(act1_end);

      let baseline = cfg.rhythm.tension_baseline as f32;
      let peak = cfg.rhythm.tension_peak.max(cfg.rhythm.tension_baseline) as f32;

      let tension_at = |idx0: i32| -> f32 {
        let idx = idx0.max(0) as f32;
        let n = (chapter_count - 1).max(1) as f32;
        if idx0 <= act1_end && act1_end >= 0 {
          let t = if act1_end == 0 { 1.0 } else { idx / (act1_end as f32) };
          baseline + (baseline + 25.0 - baseline) * t
        } else if idx0 <= act2_end && act2_end > act1_end {
          let denom = (act2_end - act1_end).max(1) as f32;
          let t = (idx0 - act1_end) as f32 / denom;
          let mid_bump = if (t - 0.5).abs() < 0.15 { 10.0 } else { 0.0 };
          (baseline + 30.0) + (peak - 15.0 - (baseline + 30.0)) * t + mid_bump
        } else {
          let t = idx / n;
          (peak - 5.0) - (peak - baseline - 10.0) * t
        }
      };

      let act1_avg = if act1_end >= 0 {
        let sum: f32 = (0..=act1_end).map(tension_at).sum();
        sum / ((act1_end + 1) as f32)
      } else {
        baseline
      };
      let act2_avg = if act2_end > act1_end {
        let sum: f32 = ((act1_end + 1)..=act2_end).map(tension_at).sum();
        sum / ((act2_end - act1_end) as f32)
      } else {
        baseline
      };

      if act2_avg + 1.0 < act1_avg + 8.0 {
        issues.push(ValidationIssue {
          severity: "warning".to_string(),
          code: "pacing.tension_flat".to_string(),
          message: "第二幕冲突升级不明显（张力曲线偏平）".to_string(),
          path: "chapters[]".to_string(),
        });
      }
    }
  }

  ValidationReport { issues }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ArcMap {
  pub spec_kit_version: String,
  pub character_maps: Vec<ArcCharacterMap>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ArcCharacterMap {
  pub character_id: String,
  pub character_name: String,
  pub archetype_id: String,
  pub beat_to_arc_step_index: std::collections::BTreeMap<String, usize>,
}

pub fn generate_arc_map_and_fill_defaults(spec: &mut StorySpec) -> ArcMap {
  let ordered = [
    "hook",
    "inciting_incident",
    "turning_point_1",
    "midpoint",
    "turning_point_2",
    "climax",
    "resolution",
  ];

  for ch in spec.characters.iter_mut() {
    if !ch.arc_steps.is_empty() {
      continue;
    }
    ch.arc_steps = default_arc_steps_for_archetype(&ch.archetype_id);
  }

  let mut beat_pos = std::collections::BTreeMap::<&str, usize>::new();
  for (i, ch) in spec.chapters.iter().enumerate() {
    let b = ch.beat_id.as_str();
    if ordered.iter().any(|x| *x == b) && !beat_pos.contains_key(b) {
      beat_pos.insert(b, i);
    }
  }

  let mut character_maps = vec![];
  for ch in spec.characters.iter() {
    let mut map = std::collections::BTreeMap::<String, usize>::new();
    if ch.arc_steps.is_empty() {
      character_maps.push(ArcCharacterMap {
        character_id: ch.id.clone(),
        character_name: ch.name.clone(),
        archetype_id: ch.archetype_id.clone(),
        beat_to_arc_step_index: map,
      });
      continue;
    }

    let last = ch.arc_steps.len().saturating_sub(1);
    let hero = ch.archetype_id == "hero";
    let key_pairs: Vec<(&str, usize)> = if hero {
      vec![
        ("hook", 0),
        ("inciting_incident", 1.min(last)),
        ("turning_point_1", 2.min(last)),
        ("midpoint", 3.min(last)),
        ("turning_point_2", 4.min(last)),
        ("climax", 5.min(last)),
        ("resolution", last),
      ]
    } else if ch.archetype_id == "antagonist" {
      vec![
        ("inciting_incident", 0),
        ("turning_point_1", 1.min(last)),
        ("midpoint", 2.min(last)),
        ("turning_point_2", 3.min(last)),
        ("climax", last),
      ]
    } else {
      vec![("turning_point_1", 0), ("midpoint", 1.min(last)), ("climax", last)]
    };

    for (beat, step_idx) in key_pairs {
      if beat_pos.contains_key(beat) {
        map.insert(beat.to_string(), step_idx);
      }
    }

    character_maps.push(ArcCharacterMap {
      character_id: ch.id.clone(),
      character_name: ch.name.clone(),
      archetype_id: ch.archetype_id.clone(),
      beat_to_arc_step_index: map,
    });
  }

  ArcMap {
    spec_kit_version: "1.0.0".to_string(),
    character_maps,
  }
}

fn default_arc_steps_for_archetype(archetype_id: &str) -> Vec<String> {
  match archetype_id {
    "hero" => vec![
      "旧世界：被谎言束缚".to_string(),
      "被迫行动：目标明确但方法粗糙".to_string(),
      "承诺：踏入新局面".to_string(),
      "翻转：认知改变，代价显现".to_string(),
      "低谷：失去与自责".to_string(),
      "选择：放下谎言，承担责任".to_string(),
      "新平衡：以新自我生活".to_string(),
    ],
    "antagonist" => vec![
      "现状：以目标/秩序为正当性".to_string(),
      "加压：升级手段".to_string(),
      "反击：占据优势或制造误导".to_string(),
      "失控：代价回噬".to_string(),
      "终局：败北或付出代价".to_string(),
    ],
    "mentor" => vec![
      "引导：提供方向与工具".to_string(),
      "试炼：逼主角独立选择".to_string(),
      "放手：相信主角能完成".to_string(),
    ],
    _ => vec!["起点".to_string(), "变化".to_string(), "结局".to_string()],
  }
}

fn beat_name(beat_id: &str) -> String {
  match beat_id {
    "hook" => "开场钩子",
    "inciting_incident" => "激励事件",
    "turning_point_1" => "第一转折点",
    "midpoint" => "中点",
    "turning_point_2" => "第二转折点",
    "climax" => "高潮",
    "resolution" => "结局/尾声",
    _ => beat_id,
  }
  .to_string()
}

fn write_if_missing(path: &Path, content: &str) -> Result<(), String> {
  if path.exists() {
    return Ok(());
  }
  fs::write(path, content).map_err(|e| format!("write file failed: {e}"))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn generate_default_outline_contains_required_beats() {
    let config = SpecKitConfig::default();
    let template = default_story_templates()
      .into_iter()
      .find(|t| t.template_id == config.story_type)
      .unwrap();
    let spec = generate_story_spec_from_config(&config, &template);

    let mut beats = std::collections::BTreeSet::<String>::new();
    for c in spec.chapters.iter() {
      beats.insert(c.beat_id.clone());
    }

    for b in [
      "hook",
      "inciting_incident",
      "turning_point_1",
      "midpoint",
      "turning_point_2",
      "climax",
      "resolution",
    ] {
      assert!(beats.contains(b), "missing beat {b}");
    }
  }

  #[test]
  fn validate_default_outline_has_no_beat_order_errors() {
    let config = SpecKitConfig::default();
    let template = default_story_templates()
      .into_iter()
      .find(|t| t.template_id == config.story_type)
      .unwrap();
    let spec = generate_story_spec_from_config(&config, &template);
    let report = validate_story_spec(&spec, Some(&config));
    let has_beat_order_error = report.issues.iter().any(|i| i.code == "pacing.beat_order");
    assert!(!has_beat_order_error, "unexpected beat order error");
  }
}
