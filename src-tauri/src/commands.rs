use crate::app_settings;
use crate::agents;
use crate::agent_system;
use crate::ai_types::ChatMessage;
use crate::app_data;
use crate::branding;
use crate::chat_history;
use crate::secrets;
use crate::skills::{Skill, SkillManager};
use crate::state::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use notify::{EventKind, RecursiveMode, Watcher};
use futures_util::StreamExt;
use regex::Regex;

#[tauri::command]
pub fn ping() -> &'static str {
  "pong"
}

#[derive(Serialize)]
pub struct WorkspaceInfo {
  pub root: String,
}

#[derive(Serialize, Clone)]
pub struct ProjectItem {
  pub name: String,
  pub path: String,
  pub source: String,
  pub is_valid_workspace: bool,
  pub last_opened_at: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct ProjectPickerState {
  pub default_root: String,
  pub default_projects: Vec<ProjectItem>,
  pub external_projects: Vec<ProjectItem>,
  pub last_workspace: Option<String>,
  pub launch_mode: app_settings::LaunchMode,
}

#[derive(Serialize, Deserialize, Default)]
struct ExternalProjectsStore {
  #[serde(default)]
  projects: Vec<ExternalProjectRecord>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ExternalProjectRecord {
  path: String,
  added_at: i64,
}

#[tauri::command]
pub fn set_workspace(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<WorkspaceInfo, String> {
  let root = canonicalize_path(Path::new(&path))?;
  *state.workspace_root.lock().map_err(|_| "workspace lock poisoned")? = Some(root.clone());
  if let Ok(mut w) = state.fs_watcher.lock() {
    *w = None;
  }
  if let Err(e) = start_fs_watcher(&app, &state, root.clone()) {
    eprintln!("fs_watcher_start_error: {e}");
    let _ = app.emit("fs_watch_error", serde_json::json!({ "message": e }));
  }
  if let Err(e) = save_last_workspace(&app, &root) {
    eprintln!("save_last_workspace_failed: {e}");
  }
  Ok(WorkspaceInfo {
    root: root.to_string_lossy().to_string(),
  })
}

#[tauri::command]
pub fn get_last_workspace(app: AppHandle) -> Result<Option<String>, String> {
  get_last_workspace_internal(&app)
}

fn get_last_workspace_internal(app: &AppHandle) -> Result<Option<String>, String> {
  let path = last_workspace_path(&app)?;
  if !path.exists() {
    return Ok(None);
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read last workspace failed: {e}"))?;
  #[derive(Deserialize)]
  struct LastWorkspace {
    path: String,
  }
  let v: LastWorkspace = serde_json::from_str(&raw).map_err(|e| format!("parse last workspace failed: {e}"))?;
  let p = v.path.trim().to_string();
  if p.is_empty() {
    return Ok(None);
  }
  if !Path::new(&p).exists() {
    return Ok(None);
  }
  Ok(Some(p))
}

fn last_workspace_path(app: &AppHandle) -> Result<PathBuf, String> {
  app_data::state_file_path(app, "last_workspace.json")
}

fn save_last_workspace(app: &AppHandle, root: &Path) -> Result<(), String> {
  let path = last_workspace_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create last workspace dir failed: {e}"))?;
  }
  let payload = serde_json::json!({ "path": root.to_string_lossy().to_string() }).to_string();
  fs::write(path, payload).map_err(|e| format!("write last workspace failed: {e}"))
}

fn external_projects_path(app: &AppHandle) -> Result<PathBuf, String> {
  app_data::state_file_path(app, "external_projects.json")
}

fn load_external_projects(app: &AppHandle) -> Result<Vec<ExternalProjectRecord>, String> {
  let path = external_projects_path(app)?;
  if !path.exists() {
    return Ok(Vec::new());
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read external projects failed: {e}"))?;
  let parsed = serde_json::from_str::<ExternalProjectsStore>(&raw)
    .map_err(|e| format!("parse external projects failed: {e}"))?;
  Ok(parsed.projects)
}

fn save_external_projects(app: &AppHandle, records: &[ExternalProjectRecord]) -> Result<(), String> {
  let path = external_projects_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create external projects dir failed: {e}"))?;
  }
  let payload = ExternalProjectsStore {
    projects: records.to_vec(),
  };
  let raw = serde_json::to_string_pretty(&payload).map_err(|e| format!("serialize external projects failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write external projects failed: {e}"))
}

fn default_projects_root() -> Result<PathBuf, String> {
  let exe = std::env::current_exe().map_err(|e| format!("resolve current executable failed: {e}"))?;
  let install_dir = exe
    .parent()
    .ok_or_else(|| "resolve install directory failed".to_string())?;
  Ok(install_dir.join("projects"))
}

fn is_valid_workspace_root(path: &Path) -> bool {
  path.join("concept").is_dir() || path.join("outline").is_dir() || path.join("stories").is_dir()
}

fn to_project_item(path: &Path, source: &str, last_opened_at: Option<i64>) -> ProjectItem {
  let name = path
    .file_name()
    .map(|v| v.to_string_lossy().to_string())
    .unwrap_or_else(|| path.to_string_lossy().to_string());
  ProjectItem {
    name,
    path: path.to_string_lossy().to_string(),
    source: source.to_string(),
    is_valid_workspace: is_valid_workspace_root(path),
    last_opened_at,
  }
}

fn list_default_projects(root: &Path) -> Result<Vec<ProjectItem>, String> {
  let mut projects: Vec<ProjectItem> = Vec::new();
  if !root.exists() {
    return Ok(projects);
  }
  for entry in fs::read_dir(root).map_err(|e| format!("read default projects failed: {e}"))? {
    let entry = entry.map_err(|e| format!("read default project entry failed: {e}"))?;
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }
    let canonical = canonicalize_path(&path).unwrap_or(path);
    projects.push(to_project_item(&canonical, "default", None));
  }
  projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
  Ok(projects)
}

fn parse_launch_mode(mode: &str) -> Result<app_settings::LaunchMode, String> {
  match mode.trim() {
    "picker" => Ok(app_settings::LaunchMode::Picker),
    "auto_last" => Ok(app_settings::LaunchMode::AutoLast),
    _ => Err("invalid launch mode".to_string()),
  }
}

#[tauri::command]
pub fn get_project_picker_state(app: AppHandle) -> Result<ProjectPickerState, String> {
  let default_root = default_projects_root()?;
  let default_projects = list_default_projects(&default_root)?;
  let settings = app_settings::load(&app)?;
  let last_workspace = get_last_workspace_internal(&app)?;

  let mut seen_paths: HashSet<String> = HashSet::new();
  for item in &default_projects {
    seen_paths.insert(item.path.to_lowercase());
  }

  let mut external_projects: Vec<ProjectItem> = Vec::new();
  for record in load_external_projects(&app)? {
    let path = PathBuf::from(&record.path);
    if !path.exists() || !path.is_dir() {
      continue;
    }
    let canonical = canonicalize_path(&path).unwrap_or(path);
    let path_key = canonical.to_string_lossy().to_lowercase();
    if seen_paths.contains(&path_key) {
      continue;
    }
    seen_paths.insert(path_key);
    external_projects.push(to_project_item(&canonical, "external", Some(record.added_at)));
  }
  external_projects.sort_by(|a, b| match (a.last_opened_at, b.last_opened_at) {
    (Some(a_ts), Some(b_ts)) => b_ts.cmp(&a_ts),
    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
  });

  Ok(ProjectPickerState {
    default_root: default_root.to_string_lossy().to_string(),
    default_projects,
    external_projects,
    last_workspace,
    launch_mode: settings.launch_mode,
  })
}

#[tauri::command]
pub fn remember_external_project(app: AppHandle, path: String) -> Result<(), String> {
  let canonical = canonicalize_path(Path::new(path.trim()))?;
  let metadata = fs::metadata(&canonical).map_err(|e| format!("stat project path failed: {e}"))?;
  if !metadata.is_dir() {
    return Err("external project path must be a directory".to_string());
  }
  let canonical_str = canonical.to_string_lossy().to_string();
  let now = Utc::now().timestamp();

  let mut records = load_external_projects(&app)?;
  if let Some(existing) = records
    .iter_mut()
    .find(|v| v.path.eq_ignore_ascii_case(&canonical_str))
  {
    existing.added_at = now;
  } else {
    records.push(ExternalProjectRecord {
      path: canonical_str,
      added_at: now,
    });
  }
  records.sort_by(|a, b| b.added_at.cmp(&a.added_at));
  save_external_projects(&app, &records)
}

#[tauri::command]
pub fn forget_external_project(app: AppHandle, path: String) -> Result<(), String> {
  let trimmed = path.trim();
  if trimmed.is_empty() {
    return Ok(());
  }
  let canonical = canonicalize_path(Path::new(trimmed))
    .ok()
    .map(|v| v.to_string_lossy().to_string());
  let mut records = load_external_projects(&app)?;
  records.retain(|v| {
    if let Some(canon) = &canonical {
      !v.path.eq_ignore_ascii_case(canon)
    } else {
      !v.path.eq_ignore_ascii_case(trimmed)
    }
  });
  save_external_projects(&app, &records)
}

#[tauri::command]
pub fn set_launch_mode(app: AppHandle, mode: String) -> Result<(), String> {
  let mut settings = app_settings::load(&app)?;
  settings.launch_mode = parse_launch_mode(&mode)?;
  app_settings::save(&app, &settings)
}

#[tauri::command]
pub fn init_novel(state: State<'_, AppState>) -> Result<(), String> {
  let root = get_workspace_root(&state)?;
  let novel_dir = root.join(".novel");

  let dirs = [
    novel_dir.join(".settings"),
    novel_dir.join(".cache"),
    novel_dir.join("plans"),
    novel_dir.join("tasks"),
    novel_dir.join("state"),
  ];

  for d in dirs {
    fs::create_dir_all(d).map_err(|e| format!("create dir failed: {e}"))?;
  }

  let concept_index = novel_dir.join(".cache").join("concept_index.json");
  if !concept_index.exists() {
    let raw = serde_json::json!({
      "revision": 0,
      "updated_at": "",
      "files": {}
    })
    .to_string();
    fs::write(concept_index, raw).map_err(|e| format!("write concept index failed: {e}"))?;
  }

  let outline_path = novel_dir.join(".cache").join("outline.json");
  if !outline_path.exists() {
    let raw = serde_json::json!({ "events": [] }).to_string();
    fs::write(outline_path, raw).map_err(|e| format!("write outline failed: {e}"))?;
  }

  let project_settings = novel_dir.join(".settings").join("project.json");
  if !project_settings.exists() {
    let raw = serde_json::to_string_pretty(&ProjectWritingSettings::default())
      .map_err(|e| format!("serialize default project settings failed: {e}"))?;
    fs::write(project_settings, raw).map_err(|e| format!("write project settings failed: {e}"))?;
  }

  let characters_path = novel_dir.join(".cache").join("characters.json");
  if !characters_path.exists() {
    let raw = serde_json::json!({ "characters": [] }).to_string();
    fs::write(characters_path, raw).map_err(|e| format!("write characters failed: {e}"))?;
  }

  let relations_path = novel_dir.join(".cache").join("relations.json");
  if !relations_path.exists() {
    let raw = serde_json::json!({ "relations": [] }).to_string();
    fs::write(relations_path, raw).map_err(|e| format!("write relations failed: {e}"))?;
  }

  let session_state = novel_dir.join("state").join("session-state.json");
  if !session_state.exists() {
    let raw = serde_json::json!({ "sessions": {} }).to_string();
    fs::write(session_state, raw).map_err(|e| format!("write session state failed: {e}"))?;
  }

  let continuity_index = novel_dir.join("state").join("continuity-index.md");
  if !continuity_index.exists() {
    let raw = "# Continuity Index\n\n用于记录角色、时间线、伏笔回收等连续性信息。";
    fs::write(continuity_index, raw).map_err(|e| format!("write continuity index failed: {e}"))?;
  }

  Ok(())
}

#[derive(Serialize, Clone)]
pub struct FsEntry {
  pub name: String,
  pub path: String,
  pub kind: String,
  pub children: Vec<FsEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProjectWritingSettings {
  pub chapter_word_target: u32,
  pub auto_min_chars: u32,
  pub auto_max_chars: u32,
  pub auto_max_rounds: u32,
  pub auto_max_chapter_advances: u32,
}

impl Default for ProjectWritingSettings {
  fn default() -> Self {
    Self {
      chapter_word_target: 2000,
      auto_min_chars: 500,
      auto_max_chars: 2400,
      auto_max_rounds: 120,
      auto_max_chapter_advances: 24,
    }
  }
}

#[derive(Deserialize, Default)]
struct PartialProjectWritingSettings {
  chapter_word_target: Option<u32>,
  auto_min_chars: Option<u32>,
  auto_max_chars: Option<u32>,
  auto_max_rounds: Option<u32>,
  auto_max_chapter_advances: Option<u32>,
}

#[derive(Deserialize)]
pub struct NovelTaskQualityTask {
  pub id: String,
  pub target_words: u32,
  pub scope: String,
  #[serde(default)]
  pub depends_on: Vec<String>,
  #[serde(default)]
  pub acceptance_checks: Vec<String>,
}

#[derive(Deserialize)]
pub struct NovelTaskQualityRequest {
  pub task: NovelTaskQualityTask,
  pub assistant_text: String,
  #[serde(default)]
  pub task_pool: Vec<NovelTaskQualityTask>,
}

#[derive(Serialize)]
pub struct NovelTaskQualityResult {
  pub ok: bool,
  pub reason: Option<String>,
}

#[derive(Serialize)]
pub struct ComposerDirectiveParseResult {
  pub requested_mode: Option<String>,
  pub auto_action: Option<String>,
  pub content: String,
  pub matched: bool,
}

#[derive(Deserialize)]
pub struct ResolveInlineReferencesRequest {
  pub input: String,
  pub selection_text: Option<String>,
  pub active_file_path: Option<String>,
  pub active_file_content: Option<String>,
}

#[derive(Serialize)]
pub struct ResolveInlineReferencesResult {
  pub resolved_input: String,
  pub blocks_added: usize,
}

fn normalize_project_writing_settings(mut v: ProjectWritingSettings) -> ProjectWritingSettings {
  v.chapter_word_target = v.chapter_word_target.clamp(0, 200_000);
  v.auto_min_chars = v.auto_min_chars.clamp(120, 20_000);
  v.auto_max_chars = v.auto_max_chars.clamp(180, 60_000);
  if v.auto_max_chars < v.auto_min_chars {
    v.auto_max_chars = v.auto_min_chars;
  }
  v.auto_max_rounds = v.auto_max_rounds.clamp(1, 1_000);
  v.auto_max_chapter_advances = v.auto_max_chapter_advances.clamp(0, 200);
  v
}

fn project_settings_path(root: &Path) -> PathBuf {
  root.join(".novel").join(".settings").join("project.json")
}

fn load_project_writing_settings_internal(root: &Path) -> Result<ProjectWritingSettings, String> {
  let path = project_settings_path(root);
  let mut settings = ProjectWritingSettings::default();
  if path.exists() {
    let raw = fs::read_to_string(&path).map_err(|e| format!("read project settings failed: {e}"))?;
    let parsed = serde_json::from_str::<PartialProjectWritingSettings>(&raw)
      .map_err(|e| format!("parse project settings failed: {e}"))?;
    if let Some(v) = parsed.chapter_word_target {
      settings.chapter_word_target = v;
    }
    if let Some(v) = parsed.auto_min_chars {
      settings.auto_min_chars = v;
    }
    if let Some(v) = parsed.auto_max_chars {
      settings.auto_max_chars = v;
    }
    if let Some(v) = parsed.auto_max_rounds {
      settings.auto_max_rounds = v;
    }
    if let Some(v) = parsed.auto_max_chapter_advances {
      settings.auto_max_chapter_advances = v;
    }
  }
  Ok(normalize_project_writing_settings(settings))
}

fn save_project_writing_settings_internal(root: &Path, settings: &ProjectWritingSettings) -> Result<(), String> {
  let path = project_settings_path(root);
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create project settings dir failed: {e}"))?;
  }
  let normalized = normalize_project_writing_settings(settings.clone());
  let raw = serde_json::to_string_pretty(&normalized).map_err(|e| format!("serialize project settings failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write project settings failed: {e}"))
}

fn normalize_no_whitespace(input: &str) -> String {
  input.chars().filter(|ch| !ch.is_whitespace()).collect()
}

fn normalize_rel_path_for_read(path: &str) -> Result<PathBuf, String> {
  validate_relative_path(path)
}

fn parse_writer_mode_alias(token: &str) -> Option<&'static str> {
  let lower = token.trim().to_lowercase();
  match lower.as_str() {
    "normal" | "普通" => Some("normal"),
    "plan" | "大纲" => Some("plan"),
    "spec" | "细纲" => Some("spec"),
    _ => None,
  }
}

#[tauri::command]
pub fn parse_composer_directive(input: String) -> ComposerDirectiveParseResult {
  let trimmed = input.trim();
  if !trimmed.starts_with('/') {
    return ComposerDirectiveParseResult {
      requested_mode: None,
      auto_action: None,
      content: trimmed.to_string(),
      matched: false,
    };
  }

  let mut chars = trimmed.chars();
  let _slash = chars.next();
  let after_slash = chars.as_str();
  let mut parts = after_slash.splitn(2, char::is_whitespace);
  let command = parts.next().unwrap_or("").trim();
  let rest = parts.next().unwrap_or("").trim();

  if command.eq_ignore_ascii_case("auto") {
    let arg = rest
      .split_whitespace()
      .next()
      .unwrap_or("")
      .trim()
      .to_lowercase();
    let auto_action = match arg.as_str() {
      "on" => Some("on".to_string()),
      "off" => Some("off".to_string()),
      _ => Some("toggle".to_string()),
    };
    return ComposerDirectiveParseResult {
      requested_mode: None,
      auto_action,
      content: String::new(),
      matched: true,
    };
  }

  if let Some(mode) = parse_writer_mode_alias(command) {
    return ComposerDirectiveParseResult {
      requested_mode: Some(mode.to_string()),
      auto_action: None,
      content: rest.to_string(),
      matched: true,
    };
  }

  ComposerDirectiveParseResult {
    requested_mode: None,
    auto_action: None,
    content: trimmed.to_string(),
    matched: false,
  }
}

#[tauri::command]
pub fn resolve_inline_references(
  state: State<'_, AppState>,
  payload: ResolveInlineReferencesRequest,
) -> Result<ResolveInlineReferencesResult, String> {
  let source = payload.input.trim().to_string();
  if !source.contains('#') {
    return Ok(ResolveInlineReferencesResult {
      resolved_input: source,
      blocks_added: 0,
    });
  }

  let selection_regex = Regex::new(r"#(?:选区|selection)\b").map_err(|e| format!("selection regex invalid: {e}"))?;
  let current_file_regex =
    Regex::new(r"#(?:当前文件|current_file|current)\b").map_err(|e| format!("current file regex invalid: {e}"))?;
  let file_prefix_regex = Regex::new(r"#(?:文件|file):([^\s#]+)").map_err(|e| format!("file prefix regex invalid: {e}"))?;
  let file_path_regex =
    Regex::new(r"#([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]{1,16})").map_err(|e| format!("file path regex invalid: {e}"))?;

  let mut blocks: Vec<String> = Vec::new();
  let mut file_refs: Vec<String> = Vec::new();
  let mut seen_file_refs: HashSet<String> = HashSet::new();
  let mut cleaned = source.clone();

  let mut push_block = |title: String, body: String| {
    let normalized = body.trim().to_string();
    let final_body = if normalized.is_empty() { "(empty)".to_string() } else { normalized };
    blocks.push(format!("[{title}]\n{final_body}"));
  };

  if selection_regex.is_match(source.as_str()) {
    let selected = payload.selection_text.unwrap_or_default().trim().to_string();
    let body = if selected.is_empty() {
      "(no selection detected; select text in editor first)".to_string()
    } else {
      selected
    };
    push_block("selection".to_string(), body);
    cleaned = selection_regex.replace_all(cleaned.as_str(), "").to_string();
  }

  if current_file_regex.is_match(source.as_str()) {
    if let Some(path) = payload.active_file_path.as_ref() {
      let content = payload.active_file_content.unwrap_or_default();
      push_block(format!("current file {path}"), content);
    } else {
      push_block("current file".to_string(), "(no active file)".to_string());
    }
    cleaned = current_file_regex.replace_all(cleaned.as_str(), "").to_string();
  }

  for captures in file_prefix_regex.captures_iter(source.as_str()) {
    let Some(value) = captures.get(1) else {
      continue;
    };
    let reference = value.as_str().trim().replace('\\', "/");
    if reference.is_empty() {
      continue;
    }
    let key = reference.to_lowercase();
    if seen_file_refs.insert(key) {
      file_refs.push(reference);
    }
  }

  for captures in file_path_regex.captures_iter(source.as_str()) {
    let Some(value) = captures.get(1) else {
      continue;
    };
    let reference = value.as_str().trim().replace('\\', "/");
    if reference.is_empty() {
      continue;
    }
    let key = reference.to_lowercase();
    if seen_file_refs.insert(key) {
      file_refs.push(reference);
    }
  }

  cleaned = file_prefix_regex.replace_all(cleaned.as_str(), "").to_string();
  cleaned = file_path_regex.replace_all(cleaned.as_str(), "").to_string();
  cleaned = cleaned.trim().to_string();

  let root = get_workspace_root(&state).ok();
  for reference in file_refs {
    let normalized_ref = reference.trim_start_matches("./").trim_start_matches('/');
    if normalized_ref.is_empty() {
      continue;
    }
    if root.is_none() {
      push_block(
        format!("file {normalized_ref}"),
        "(project files are unavailable in current environment)".to_string(),
      );
      continue;
    }
    let relative = match validate_relative_path(normalized_ref) {
      Ok(value) => value,
      Err(err) => {
        push_block(format!("file {normalized_ref}"), format!("read failed: {err}"));
        continue;
      }
    };
    let Some(root_path) = root.as_ref() else {
      continue;
    };
    let absolute = root_path.join(relative);
    match fs::read_to_string(&absolute) {
      Ok(content) => push_block(format!("file {normalized_ref}"), content),
      Err(err) => push_block(format!("file {normalized_ref}"), format!("read failed: {err}")),
    }
  }

  if blocks.is_empty() {
    return Ok(ResolveInlineReferencesResult {
      resolved_input: source,
      blocks_added: 0,
    });
  }

  let resolved_input = if cleaned.is_empty() {
    format!(
      "Please continue writing based on the following references.\n\n{}",
      blocks.join("\n\n")
    )
  } else {
    format!("{cleaned}\n\n[References]\n{}", blocks.join("\n\n"))
  };

  Ok(ResolveInlineReferencesResult {
    resolved_input,
    blocks_added: blocks.len(),
  })
}

#[tauri::command]
pub fn validate_novel_task_quality(
  state: State<'_, AppState>,
  payload: NovelTaskQualityRequest,
) -> Result<NovelTaskQualityResult, String> {
  let root = get_workspace_root(&state)?;
  let task = payload.task;
  let text = payload.assistant_text.trim();
  if text.is_empty() {
    return Ok(NovelTaskQualityResult {
      ok: false,
      reason: Some("AI returned empty content".to_string()),
    });
  }
  if !text.contains(&format!("TASK_DONE: {}", task.id)) {
    return Ok(NovelTaskQualityResult {
      ok: false,
      reason: Some(format!("Missing completion tag TASK_DONE: {}", task.id)),
    });
  }

  let scope_rel = normalize_rel_path_for_read(task.scope.as_str())?;
  let scope_path = root.join(scope_rel);
  let content = fs::read_to_string(&scope_path)
    .map_err(|_| format!("target file is missing or unreadable: {}", task.scope))?;
  let compact = normalize_no_whitespace(content.as_str());
  let min_length = std::cmp::max(600usize, ((task.target_words as f32) * 0.42_f32) as usize);
  if compact.len() < min_length {
    return Ok(NovelTaskQualityResult {
      ok: false,
      reason: Some(format!("file content is too short ({}/{})", compact.len(), min_length)),
    });
  }

  let lowered = content.to_lowercase();
  let placeholder_tokens = ["todo", "lorem", "xxx", "[待写]", "待补全", "待完善", "待续"];
  if placeholder_tokens.iter().any(|token| lowered.contains(token)) {
    return Ok(NovelTaskQualityResult {
      ok: false,
      reason: Some("chapter contains placeholder text".to_string()),
    });
  }

  if !content.trim().is_empty()
    && task.acceptance_checks.iter().any(|check| check.contains("钩子"))
  {
    let tail: String = content.chars().rev().take(80).collect::<String>().chars().rev().collect();
    let has_hook_end = tail.chars().any(|ch| ['?', '!', '.', '？', '！', '。', '…'].contains(&ch));
    if !has_hook_end {
      return Ok(NovelTaskQualityResult {
        ok: false,
        reason: Some("chapter ending lacks a valid hook/closure sentence".to_string()),
      });
    }
  }

  if let Some(dep_id) = task.depends_on.first() {
    if let Some(dep_task) = payload.task_pool.iter().find(|item| item.id == *dep_id) {
      if dep_task.scope != task.scope {
        if let Ok(dep_rel) = normalize_rel_path_for_read(dep_task.scope.as_str()) {
          if let Ok(dep_content) = fs::read_to_string(root.join(dep_rel)) {
            let current_head: String = normalize_no_whitespace(content.as_str()).chars().take(140).collect();
            let dep_head: String = normalize_no_whitespace(dep_content.as_str()).chars().take(140).collect();
            if current_head.len() > 80 && dep_head.len() > 80 && current_head == dep_head {
              return Ok(NovelTaskQualityResult {
                ok: false,
                reason: Some("chapter opening is highly duplicated from dependency task".to_string()),
              });
            }
          }
        }
      }
    }
  }

  Ok(NovelTaskQualityResult {
    ok: true,
    reason: None,
  })
}

#[tauri::command]
pub fn get_project_writing_settings(state: State<'_, AppState>) -> Result<ProjectWritingSettings, String> {
  let root = get_workspace_root(&state)?;
  let settings = load_project_writing_settings_internal(&root)?;
  save_project_writing_settings_internal(&root, &settings)?;
  Ok(settings)
}

#[tauri::command]
pub fn set_project_writing_settings(
  state: State<'_, AppState>,
  settings: ProjectWritingSettings,
) -> Result<ProjectWritingSettings, String> {
  let root = get_workspace_root(&state)?;
  let normalized = normalize_project_writing_settings(settings);
  save_project_writing_settings_internal(&root, &normalized)?;
  Ok(normalized)
}

#[tauri::command]
pub fn list_workspace_tree(state: State<'_, AppState>, max_depth: usize) -> Result<FsEntry, String> {
  let root = get_workspace_root(&state)?;
  build_tree(&root, &root, max_depth)
}

#[tauri::command]
pub fn read_text(state: State<'_, AppState>, relative_path: String) -> Result<String, String> {
  let root = get_workspace_root(&state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  fs::read_to_string(target).map_err(|e| format!("read failed: {e}"))
}

#[tauri::command]
pub fn write_text(
  state: State<'_, AppState>,
  relative_path: String,
  content: String,
) -> Result<(), String> {
  let root = get_workspace_root(&state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  let rel_norm = relative_path.replace('\\', "/");

  if rel_norm == ".novel/.cache/outline.json" {
    let existing = if target.exists() {
      fs::read_to_string(&target).unwrap_or_default()
    } else {
      String::new()
    };
    validate_outline(&existing, &content)?;
  }

  if let Some(parent) = target.parent() {
    if !parent.exists() {
      return Err("parent directory does not exist; create it first".to_string());
    }
  }
  fs::write(&target, &content).map_err(|e| format!("write failed: {e}"))?;

  if rel_norm.starts_with("concept/") && rel_norm.to_lowercase().ends_with(".md") {
    update_concept_index(&root, &rel_norm, &content)?;
  }

  Ok(())
}

#[tauri::command]
pub fn create_file(state: State<'_, AppState>, relative_path: String) -> Result<(), String> {
  let root = get_workspace_root(&state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  if let Some(parent) = target.parent() {
    if !parent.exists() {
      return Err("parent directory does not exist; create it first".to_string());
    }
  }
  fs::write(target, "").map_err(|e| format!("create file failed: {e}"))
}

#[tauri::command]
pub fn create_dir(state: State<'_, AppState>, relative_path: String) -> Result<(), String> {
  if relative_path.trim().is_empty() {
    return Err("empty path is not allowed".to_string());
  }
  let root = get_workspace_root(&state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  fs::create_dir_all(target).map_err(|e| format!("create dir failed: {e}"))
}

#[tauri::command]
pub fn delete_entry(state: State<'_, AppState>, relative_path: String) -> Result<(), String> {
  if relative_path.trim().is_empty() {
    return Err("empty path is not allowed".to_string());
  }
  let root = get_workspace_root(&state)?;
  let rel = validate_relative_path(&relative_path)?;
  let target = root.join(rel);
  let md = fs::metadata(&target).map_err(|e| format!("stat failed: {e}"))?;
  if md.is_dir() {
    fs::remove_dir_all(target).map_err(|e| format!("delete dir failed: {e}"))
  } else {
    fs::remove_file(target).map_err(|e| format!("delete file failed: {e}"))
  }
}

#[tauri::command]
pub fn rename_entry(state: State<'_, AppState>, from_relative_path: String, to_relative_path: String) -> Result<(), String> {
  if from_relative_path.trim().is_empty() || to_relative_path.trim().is_empty() {
    return Err("empty path is not allowed".to_string());
  }
  let root = get_workspace_root(&state)?;
  let from_rel = validate_relative_path(&from_relative_path)?;
  let to_rel = validate_relative_path(&to_relative_path)?;
  let from = root.join(from_rel);
  let to = root.join(to_rel);
  if let Some(parent) = to.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
  }
  fs::rename(from, to).map_err(|e| format!("rename failed: {e}"))
}

fn normalize_active_agent_id(app: &AppHandle, settings: &mut app_settings::AppSettings) {
  let agents_list = agents::load(app).unwrap_or_else(|_| agents::default_agents());
  if agents_list.is_empty() {
    settings.active_agent_id.clear();
    return;
  }
  let current = settings.active_agent_id.trim();
  let exists = !current.is_empty() && agents_list.iter().any(|a| a.id == current);
  if exists {
    settings.active_agent_id = current.to_string();
    return;
  }
  let fallback = agents_list
    .iter()
    .find(|a| a.id == "general")
    .or_else(|| agents_list.first())
    .map(|a| a.id.clone())
    .unwrap_or_default();
  settings.active_agent_id = fallback;
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<app_settings::AppSettings, String> {
  let mut s = app_settings::load(&app)?;
  let prev_agent_id = s.active_agent_id.clone();
  normalize_active_agent_id(&app, &mut s);
  if s.active_agent_id != prev_agent_id {
    let _ = app_settings::save(&app, &s);
  }
  // Clear keys for display security
  for p in &mut s.providers {
    p.api_key.clear();
  }
  Ok(s)
}

#[tauri::command]
pub fn set_app_settings(app: AppHandle, settings: app_settings::AppSettings) -> Result<(), String> {
  let mut s = settings.clone();

  if s.providers.is_empty() {
    s.providers = app_settings::AppSettings::default().providers;
  }
  if s.active_provider_id.trim().is_empty() || !s.providers.iter().any(|p| p.id == s.active_provider_id) {
    s.active_provider_id = s.providers[0].id.clone();
  }
  normalize_active_agent_id(&app, &mut s);

  // Save API keys to secrets if present
  for p in &mut s.providers {
    if !p.api_key.trim().is_empty() {
      secrets::set_api_key(&app, &p.id, p.api_key.trim())?;
      p.api_key.clear();
    }
  }
  
  app_settings::save(&app, &s)
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn get_api_key_status(app: AppHandle, providerId: Option<String>, provider_id: Option<String>) -> Result<bool, String> {
  let pid = providerId
    .or(provider_id)
    .unwrap_or_default();
  match secrets::get_api_key(&app, pid.trim()) {
    Ok(Some(v)) => Ok(!v.trim().is_empty()),
    Ok(None) => Ok(false),
    Err(e) => Err(e),
  }
}

#[allow(non_snake_case)]
#[tauri::command]
pub fn set_api_key(
  app: AppHandle,
  providerId: Option<String>,
  provider_id: Option<String>,
  apiKey: Option<String>,
  api_key: Option<String>,
) -> Result<(), String> {
  let pid = providerId.or(provider_id).unwrap_or_default();
  let pid = pid.trim();
  if pid.is_empty() {
    return Err("provider_id 不能为空".to_string());
  }
  let key = apiKey.or(api_key).unwrap_or_default();
  let key = key.trim();
  if key.is_empty() {
    return Err("API Key 不能为空".to_string());
  }
  secrets::set_api_key(&app, pid, key)
}

#[tauri::command]
pub fn get_agents(app: AppHandle) -> Result<Vec<agents::Agent>, String> {
  agents::load(&app)
}

#[tauri::command]
pub fn set_agents(app: AppHandle, agents_list: Vec<agents::Agent>) -> Result<(), String> {
  agents::save(&app, &agents_list)
}

#[tauri::command]
pub fn export_agents(app: AppHandle) -> Result<String, String> {
  let list = agents::load_custom(&app)?;
  serde_json::to_string_pretty(&list).map_err(|e| format!("export agents failed: {e}"))
}

#[tauri::command]
pub fn import_agents(app: AppHandle, json: String) -> Result<(), String> {
  let list: Vec<agents::Agent> = serde_json::from_str(&json).map_err(|e| format!("import agents failed: {e}"))?;
  agents::save_custom(&app, &list)
}

#[tauri::command]
pub fn save_chat_session(app: AppHandle, session: chat_history::ChatSession) -> Result<(), String> {
  let mut sessions = chat_history::load(&app)?;
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs() as i64;

  let mut incoming = session.clone();
  if incoming.created_at <= 0 {
    incoming.created_at = now;
  }
  incoming.updated_at = now;

  if let Some(pos) = sessions.iter().position(|s| s.id == incoming.id) {
    sessions[pos] = incoming;
  } else {
    sessions.push(incoming);
  }

  sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
  if sessions.len() > 50 {
    sessions.truncate(50);
  }

  chat_history::save(&app, &sessions)
}

#[tauri::command]
pub fn list_chat_sessions(app: AppHandle, workspace_root: Option<String>) -> Result<Vec<chat_history::ChatSessionSummary>, String> {
  let sessions = chat_history::load(&app)?;
  let mut out: Vec<chat_history::ChatSessionSummary> = Vec::new();
  for s in sessions {
    if let Some(root) = &workspace_root {
      if &s.workspace_root != root {
        continue;
      }
    }
    out.push(chat_history::ChatSessionSummary {
      id: s.id,
      workspace_root: s.workspace_root,
      updated_at: s.updated_at,
      message_count: s.messages.len(),
    });
  }
  Ok(out)
}

#[tauri::command]
pub fn get_chat_session(app: AppHandle, id: String) -> Result<chat_history::ChatSession, String> {
  let sessions = chat_history::load(&app)?;
  sessions.into_iter().find(|s| s.id == id).ok_or_else(|| "session not found".to_string())
}

#[derive(Serialize)]
pub struct GitStatusItem {
  pub path: String,
  pub status: String,
}

#[tauri::command]
pub fn git_init(state: State<'_, AppState>) -> Result<(), String> {
  let root = get_workspace_root(&state)?;
  git2::Repository::init(root).map(|_| ()).map_err(|e| format!("git init failed: {e}"))
}

#[tauri::command]
pub fn git_status(state: State<'_, AppState>) -> Result<Vec<GitStatusItem>, String> {
  let root = get_workspace_root(&state)?;
  let repo = git2::Repository::open(root).map_err(|e| format!("open repo failed: {e}"))?;
  let mut opts = git2::StatusOptions::new();
  opts.include_untracked(true)
    .recurse_untracked_dirs(true)
    .include_ignored(false)
    .renames_head_to_index(true)
    .renames_index_to_workdir(true);
  let statuses = repo.statuses(Some(&mut opts)).map_err(|e| format!("status failed: {e}"))?;

  let mut out: Vec<GitStatusItem> = Vec::new();
  for entry in statuses.iter() {
    let st = entry.status();
    let path = entry.path().unwrap_or("").to_string();
    if path.is_empty() {
      continue;
    }
    out.push(GitStatusItem {
      path,
      status: format_status(st),
    });
  }

  out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
  Ok(out)
}

#[tauri::command]
pub fn git_diff(state: State<'_, AppState>, path: String) -> Result<String, String> {
  let root = get_workspace_root(&state)?;
  let repo = git2::Repository::open(root).map_err(|e| format!("open repo failed: {e}"))?;
  let mut opts = git2::DiffOptions::new();
  opts.pathspec(path);
  let diff = repo
    .diff_index_to_workdir(None, Some(&mut opts))
    .map_err(|e| format!("diff failed: {e}"))?;

  let mut out = String::new();
  diff
    .print(git2::DiffFormat::Patch, |_d, _h, line| {
      out.push_str(std::str::from_utf8(line.content()).unwrap_or_default());
      true
    })
    .map_err(|e| format!("diff print failed: {e}"))?;

  Ok(out)
}

#[tauri::command]
pub fn git_commit(state: State<'_, AppState>, message: String) -> Result<String, String> {
  let root = get_workspace_root(&state)?;
  let repo = git2::Repository::open(root).map_err(|e| format!("open repo failed: {e}"))?;
  let mut index = repo.index().map_err(|e| format!("open index failed: {e}"))?;
  index
    .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
    .map_err(|e| format!("stage failed: {e}"))?;
  index.write().map_err(|e| format!("index write failed: {e}"))?;

  let tree_oid = index.write_tree().map_err(|e| format!("write tree failed: {e}"))?;
  let tree = repo.find_tree(tree_oid).map_err(|e| format!("find tree failed: {e}"))?;

  let sig = repo
    .signature()
    .or_else(|_| git2::Signature::now(branding::GIT_SIGNATURE_NAME, branding::GIT_SIGNATURE_EMAIL))
    .map_err(|e| format!("signature failed: {e}"))?;

  let parent = repo
    .head()
    .ok()
    .and_then(|h| h.target())
    .and_then(|oid| repo.find_commit(oid).ok());

  let oid = if let Some(parent) = parent {
    repo
      .commit(Some("HEAD"), &sig, &sig, message.trim(), &tree, &[&parent])
      .map_err(|e| format!("commit failed: {e}"))?
  } else {
    repo
      .commit(Some("HEAD"), &sig, &sig, message.trim(), &tree, &[])
      .map_err(|e| format!("commit failed: {e}"))?
  };

  Ok(oid.to_string())
}

#[derive(Serialize)]
pub struct GitCommitInfo {
  pub id: String,
  pub summary: String,
  pub author: String,
  pub time: i64,
}

#[tauri::command]
pub fn git_log(state: State<'_, AppState>, max: usize) -> Result<Vec<GitCommitInfo>, String> {
  let root = get_workspace_root(&state)?;
  let repo = git2::Repository::open(root).map_err(|e| format!("open repo failed: {e}"))?;
  let mut walk = repo.revwalk().map_err(|e| format!("revwalk failed: {e}"))?;
  walk.push_head().map_err(|e| format!("push head failed: {e}"))?;
  let mut out: Vec<GitCommitInfo> = Vec::new();
  for oid in walk.take(max) {
    let oid = oid.map_err(|e| format!("revwalk oid failed: {e}"))?;
    let commit = repo.find_commit(oid).map_err(|e| format!("find commit failed: {e}"))?;
    let author = commit.author();
    out.push(GitCommitInfo {
      id: oid.to_string(),
      summary: commit.summary().unwrap_or("").to_string(),
      author: author.name().unwrap_or("").to_string(),
      time: commit.time().seconds(),
    });
  }
  Ok(out)
}

fn format_status(st: git2::Status) -> String {
  let mut parts: Vec<&str> = Vec::new();
  if st.contains(git2::Status::INDEX_NEW) {
    parts.push("A");
  }
  if st.contains(git2::Status::INDEX_MODIFIED) {
    parts.push("M");
  }
  if st.contains(git2::Status::INDEX_DELETED) {
    parts.push("D");
  }
  if st.contains(git2::Status::WT_NEW) {
    parts.push("?")
  }
  if st.contains(git2::Status::WT_MODIFIED) {
    parts.push("M")
  }
  if st.contains(git2::Status::WT_DELETED) {
    parts.push("D")
  }
  if parts.is_empty() {
    " ".to_string()
  } else {
    parts.join("")
  }
}

fn emit_stream_status(window: &tauri::Window, stream_id: &str, phase: &str) {
  let _ = window.emit(
    "ai_stream_status",
    serde_json::json!({
      "streamId": stream_id,
      "phase": phase
    }),
  );
}

fn emit_stream_done(window: &tauri::Window, stream_id: &str, cancelled: bool) {
  let _ = window.emit(
    "ai_stream_done",
    serde_json::json!({
      "streamId": stream_id,
      "cancelled": cancelled
    }),
  );
}

fn clear_stream_task(app: &AppHandle, stream_id: &str) {
  let app_state = app.state::<AppState>();
  let mut tasks = match app_state.ai_stream_tasks.lock() {
    Ok(v) => v,
    Err(_) => return,
  };
  tasks.remove(stream_id);
}

#[tauri::command]
pub fn chat_cancel_stream(
  window: tauri::Window,
  state: State<'_, AppState>,
  stream_id: String,
) -> Result<(), String> {
  let handle = {
    let mut tasks = state
      .ai_stream_tasks
      .lock()
      .map_err(|_| "stream tasks lock poisoned".to_string())?;
    tasks.remove(&stream_id)
  };
  if let Some(task) = handle {
    task.abort();
  }
  emit_stream_done(&window, &stream_id, true);
  Ok(())
}

#[derive(Clone)]
struct LiveStreamSession {
  window: tauri::Window,
  stream_id: String,
  emitted_any: Arc<AtomicBool>,
}

impl LiveStreamSession {
  fn new(window: tauri::Window, stream_id: String) -> Self {
    Self {
      window,
      stream_id,
      emitted_any: Arc::new(AtomicBool::new(false)),
    }
  }

  fn emit_token(&self, token: &str) {
    if token.is_empty() {
      return;
    }
    self.emitted_any.store(true, Ordering::Relaxed);
    let _ = self.window.emit(
      "ai_stream_token",
      serde_json::json!({
        "streamId": self.stream_id,
        "token": token
      }),
    );
  }

  fn has_emitted(&self) -> bool {
    self.emitted_any.load(Ordering::Relaxed)
  }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LiveEmitMode {
  Unknown,
  Emit,
  Suppress,
}

struct LiveEmitGate {
  mode: LiveEmitMode,
  probe: String,
}

fn action_prefix_state(text: &str) -> (bool, bool) {
  let trimmed = text.trim_start();
  if trimmed.is_empty() {
    return (false, false);
  }
  let mut head = String::new();
  for ch in trimmed.chars().take(7) {
    head.push(ch.to_ascii_uppercase());
  }
  let action = "ACTION:";
  let is_possible_prefix = action.starts_with(head.as_str());
  let is_full = head == action;
  (is_possible_prefix, is_full)
}

impl LiveEmitGate {
  fn new() -> Self {
    Self {
      mode: LiveEmitMode::Unknown,
      probe: String::new(),
    }
  }

  fn push(&mut self, session: Option<&LiveStreamSession>, text: &str) {
    if text.is_empty() {
      return;
    }
    match self.mode {
      LiveEmitMode::Emit => {
        if let Some(s) = session {
          s.emit_token(text);
        }
      }
      LiveEmitMode::Suppress => {}
      LiveEmitMode::Unknown => {
        self.probe.push_str(text);
        let (action_prefix_possible, action_prefix_full) = action_prefix_state(&self.probe);
        if action_prefix_full {
          self.mode = LiveEmitMode::Suppress;
          self.probe.clear();
          return;
        }
        if action_prefix_possible {
          return;
        }
        self.mode = LiveEmitMode::Emit;
        if let Some(s) = session {
          s.emit_token(&self.probe);
        }
        self.probe.clear();
      }
    }
  }

  fn finalize(&mut self, session: Option<&LiveStreamSession>) {
    if self.probe.is_empty() {
      return;
    }
    let (_, action_prefix_full) = action_prefix_state(&self.probe);
    if self.mode != LiveEmitMode::Suppress && !action_prefix_full {
      if let Some(s) = session {
        s.emit_token(&self.probe);
      }
    }
    self.probe.clear();
  }
}

fn sse_take_line(buffer: &mut String) -> Option<String> {
  let pos = buffer.find('\n')?;
  let mut line = buffer[..pos].to_string();
  if line.ends_with('\r') {
    line.pop();
  }
  buffer.drain(..=pos);
  Some(line)
}

#[tauri::command]
pub fn chat_generate_stream(
  app: AppHandle,
  window: tauri::Window,
  state: State<'_, AppState>,
  stream_id: String,
  messages: Vec<ChatMessage>,
  use_markdown: bool,
  agent_id: Option<String>,
) -> Result<(), String> {
  let app = app.clone();
  let workspace_root = get_workspace_root(&state)?;
  let stream_id_for_task = stream_id.clone();
  let window_for_task = window.clone();
  let app_for_task = app.clone();
  let live_session = LiveStreamSession::new(window_for_task.clone(), stream_id_for_task.clone());
  let live_session_for_task = live_session.clone();

  let task = tauri::async_runtime::spawn(async move {
    let payload_start = serde_json::json!({ "streamId": stream_id_for_task });
    let _ = window_for_task.emit("ai_stream_start", payload_start);
    emit_stream_status(&window_for_task, &stream_id_for_task, "initializing");

    let settings = match app_settings::load(&app) {
      Ok(v) => v,
      Err(e) => {
        let _ = window_for_task.emit(
          "ai_error",
          serde_json::json!({
            "streamId": stream_id_for_task,
            "stage": "settings",
            "message": e
          }),
        );
        clear_stream_task(&app_for_task, &stream_id_for_task);
        emit_stream_done(&window_for_task, &stream_id_for_task, false);
        return;
      }
    };
    let effective_use_markdown = use_markdown || settings.output.use_markdown;
    let agents_list = agents::load(&app).unwrap_or_else(|_| agents::default_agents());
    let effective_agent_id = agent_id.unwrap_or_else(|| settings.active_agent_id.clone());
    let agent = agents_list
      .iter()
      .find(|a| a.id == effective_agent_id)
      .or_else(|| agents_list.iter().find(|a| a.id == "general"))
      .or_else(|| agents_list.first());
    let agent_system = agent.map(|a| a.system_prompt.clone()).unwrap_or_default();
    let agent_temp = agent.map(|a| a.temperature);
    let ai_edit_apply_mode = settings.ai_edit_apply_mode.clone();
    let client = reqwest::Client::new();

    let active_provider_id = settings.active_provider_id.clone();
    let providers = settings.providers.clone();
    let current_provider = providers
      .iter()
      .find(|p| p.id == active_provider_id)
      .ok_or_else(|| "provider not found".to_string());
    
    // Fail early if provider config is missing
    let current_provider = match current_provider {
      Ok(p) => p.clone(),
      Err(e) => {
        eprintln!("ai_error: {}", e);
        let _ = window_for_task.emit(
          "ai_error",
          serde_json::json!({ "streamId": stream_id_for_task, "stage": "settings", "message": e }),
        );
        clear_stream_task(&app_for_task, &stream_id_for_task);
        emit_stream_done(&window_for_task, &stream_id_for_task, false);
        return;
      }
    };

    let workspace_root_clone = workspace_root.clone();
    let mut runtime = agent_system::AgentRuntime::new(workspace_root);
    let start = Instant::now();
    emit_stream_status(&window_for_task, &stream_id_for_task, "thinking");
    let (mut response, perf) = match runtime
      .run_react(messages, agent_system.clone(), ai_edit_apply_mode, |msgs| {
        let provider_cfg = current_provider.clone();
        let client = client.clone();
        let app = app.clone();
        let agent_temp = agent_temp;
        let live = live_session_for_task.clone();
        async move {
          let mut system = String::new();
          for m in msgs.iter().filter(|m| m.role == "system") {
            if !system.is_empty() {
              system.push('\n');
            }
            system.push_str(m.content.as_str());
          }
          let filtered = msgs.into_iter().filter(|m| m.role != "system").collect::<Vec<_>>();
          
          match provider_cfg.kind {
            app_settings::ProviderKind::OpenAI | app_settings::ProviderKind::OpenAICompatible => {
              emit_stream_status(&live.window, &live.stream_id, "responding");
              call_openai_unbounded(
                &app,
                &client,
                &provider_cfg, // pass full provider config
                &filtered,
                system.as_str(),
                agent_temp,
                Some(&live),
              ).await
            },
            app_settings::ProviderKind::Anthropic => {
              emit_stream_status(&live.window, &live.stream_id, "responding");
              call_anthropic_unbounded(
                &app,
                &client,
                &provider_cfg,
                &filtered,
                system.as_str(),
                Some(&live),
              ).await
            },
          }
        }
      })
      .await
    {
      Ok(v) => v,
      Err(e) => {
        eprintln!("ai_error provider={} err={}", current_provider.id, e);
        let stage = if e.contains("api key")
          || e.contains("keyring")
          || e.contains("request failed")
          || e.contains("decode failed")
          || e.contains("http ")
        {
          "provider"
        } else {
          "agent"
        };
        let payload = serde_json::json!({
          "streamId": stream_id_for_task,
          "provider": current_provider.id,
          "stage": stage,
          "message": e
        });
        let _ = window_for_task.emit("ai_error", payload);
        clear_stream_task(&app_for_task, &stream_id_for_task);
        emit_stream_done(&window_for_task, &stream_id_for_task, false);
        return;
      }
    };
    let _ = window_for_task.emit(
      "ai_perf",
      serde_json::json!({
        "streamId": stream_id_for_task,
        "elapsed_ms": start.elapsed().as_millis(),
        "steps": perf.steps,
        "model_ms": perf.model_ms,
        "tool_ms": perf.tool_ms
      }),
    );

    if !effective_use_markdown {
      response = normalize_plaintext(&response);
    }

    // Parse AI response for file modification instructions
    let _change_set = match crate::ai_response_parser::parse_ai_response(&response, &workspace_root_clone) {
      Ok(Some(cs)) => {
        // Emit the ChangeSet to the frontend
        let payload = serde_json::json!({
          "streamId": stream_id_for_task,
          "changeSet": cs
        });
        let _ = window_for_task.emit("ai_change_set", payload);
        Some(cs)
      }
      Ok(None) => None,
      Err(e) => {
        eprintln!("Failed to parse AI response for modifications: {}", e);
        None
      }
    };

    if !live_session_for_task.has_emitted() {
      emit_stream_status(&window_for_task, &stream_id_for_task, "responding");
      let step_chars = 48usize;
      let mut buf = String::new();
      let mut count = 0usize;
      for ch in response.chars() {
        buf.push(ch);
        count += 1;
        if count >= step_chars {
          let payload = serde_json::json!({ "streamId": stream_id_for_task, "token": buf });
          let _ = window_for_task.emit("ai_stream_token", payload);
          buf = String::new();
          count = 0;
          tokio::time::sleep(std::time::Duration::from_millis(15)).await;
        }
      }
      if !buf.is_empty() {
        let payload = serde_json::json!({ "streamId": stream_id_for_task, "token": buf });
        let _ = window_for_task.emit("ai_stream_token", payload);
      }
    }

    clear_stream_task(&app_for_task, &stream_id_for_task);
    emit_stream_done(&window_for_task, &stream_id_for_task, false);
  });

  {
    let mut tasks = state
      .ai_stream_tasks
      .lock()
      .map_err(|_| "stream tasks lock poisoned".to_string())?;
    if let Some(prev) = tasks.insert(stream_id, task) {
      prev.abort();
    }
  }

  Ok(())
}

fn append_chunk_with_overlap(full_text: &mut String, chunk: &str) -> (usize, String) {
  const MAX_OVERLAP_CHARS: usize = 4096;
  if chunk.is_empty() {
    return (0, String::new());
  }
  if full_text.is_empty() {
    full_text.push_str(chunk);
    return (0, chunk.to_string());
  }

  let mut tail = full_text
    .chars()
    .rev()
    .take(MAX_OVERLAP_CHARS)
    .collect::<Vec<char>>();
  tail.reverse();
  let head = chunk.chars().take(MAX_OVERLAP_CHARS).collect::<Vec<char>>();
  let max_overlap = tail.len().min(head.len());

  let mut overlap = 0usize;
  for len in (1..=max_overlap).rev() {
    if tail[tail.len() - len..] == head[..len] {
      overlap = len;
      break;
    }
  }

  if overlap == 0 {
    full_text.push_str(chunk);
    return (0, chunk.to_string());
  }

  let suffix = chunk.chars().skip(overlap).collect::<String>();
  full_text.push_str(&suffix);
  (overlap, suffix)
}

async fn call_openai_unbounded(
  app: &AppHandle,
  client: &reqwest::Client,
  cfg: &app_settings::ModelProvider,
  messages: &[ChatMessage],
  system_prompt: &str,
  temperature_override: Option<f32>,
  live_stream: Option<&LiveStreamSession>,
) -> Result<String, String> {
  let api_key = match secrets::get_api_key(app, &cfg.id) {
    Ok(Some(v)) => v,
    Ok(None) => cfg.api_key.trim().to_string(),
    Err(e) => return Err(format!("keyring read failed: {e}")),
  };
  if api_key.trim().is_empty() {
    return Err(format!("api key not found for provider={}", cfg.id));
  }

  let base = cfg.base_url.trim_end_matches('/');
  let url = format!("{base}/chat/completions");
  let temperature = temperature_override.unwrap_or(0.7);
  let mut out_messages: Vec<serde_json::Value> = Vec::new();
  if !system_prompt.trim().is_empty() {
    out_messages.push(serde_json::json!({
      "role": "system",
      "content": system_prompt
    }));
  }
  out_messages.extend(
    messages
      .iter()
      .map(|m| serde_json::json!({"role": m.role, "content": m.content})),
  );

  const MAX_CONTINUATIONS: usize = 64;
  const FALLBACK_CHUNK_MAX_TOKENS: u32 = 32000;
  const CONTINUE_PROMPT: &str =
    "Continue from exactly where you stopped. Do not repeat prior text.";

  let mut full_text = String::new();
  let mut gate = LiveEmitGate::new();
  let mut stream_supported = true;
  for round in 0..=MAX_CONTINUATIONS {
    let mut use_fallback_chunk_limit = false;
    let (chunk, finish_reason, stream_applied): (String, Option<String>, bool) = loop {
      if stream_supported {
        let mut body = serde_json::json!({
          "model": cfg.model_name,
          "messages": out_messages,
          "temperature": temperature,
          "stream": true
        });
        if use_fallback_chunk_limit {
          body["max_tokens"] = serde_json::json!(FALLBACK_CHUNK_MAX_TOKENS);
        }
        let resp = client
          .post(url.as_str())
          .bearer_auth(api_key.trim())
          .json(&body)
          .send()
          .await
          .map_err(|e| format!("request failed: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
          let raw = resp.text().await.map_err(|e| format!("decode failed: {e}"))?;
          let lowered = raw.to_lowercase();
          let looks_like_missing_max_tokens = status.is_client_error()
            && !use_fallback_chunk_limit
            && lowered.contains("max_tokens");
          if looks_like_missing_max_tokens {
            use_fallback_chunk_limit = true;
            continue;
          }
          let stream_unsupported = lowered.contains("stream")
            && (lowered.contains("not support")
              || lowered.contains("unsupported")
              || lowered.contains("invalid")
              || lowered.contains("unknown"));
          if stream_unsupported {
            stream_supported = false;
            continue;
          }
          return Err(format!("http {status}: {raw}"));
        }

        let mut sse_buf = String::new();
        let mut round_unique = String::new();
        let mut finish_reason: Option<String> = None;
        let mut body_stream = resp.bytes_stream();
        while let Some(item) = body_stream.next().await {
          let bytes = item.map_err(|e| format!("stream read failed: {e}"))?;
          sse_buf.push_str(&String::from_utf8_lossy(&bytes));
          while let Some(line) = sse_take_line(&mut sse_buf) {
            if let Some(data) = line.strip_prefix("data:") {
              let data = data.trim();
              if data.is_empty() || data == "[DONE]" {
                continue;
              }
              let value: serde_json::Value =
                serde_json::from_str(data).map_err(|e| format!("stream parse failed: {e}; data={data}"))?;
              if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
                finish_reason = Some(reason.to_string());
              }
              if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
                let (_, unique_piece) = append_chunk_with_overlap(&mut full_text, content);
                if !unique_piece.is_empty() {
                  round_unique.push_str(unique_piece.as_str());
                  gate.push(live_stream, unique_piece.as_str());
                }
              }
            }
          }
        }
        if !sse_buf.trim().is_empty() {
          let line = sse_buf.trim();
          if let Some(data) = line.strip_prefix("data:") {
            let data = data.trim();
            if !data.is_empty() && data != "[DONE]" {
              let value: serde_json::Value =
                serde_json::from_str(data).map_err(|e| format!("stream parse failed: {e}; data={data}"))?;
              if let Some(reason) = value["choices"][0]["finish_reason"].as_str() {
                finish_reason = Some(reason.to_string());
              }
              if let Some(content) = value["choices"][0]["delta"]["content"].as_str() {
                let (_, unique_piece) = append_chunk_with_overlap(&mut full_text, content);
                if !unique_piece.is_empty() {
                  round_unique.push_str(unique_piece.as_str());
                  gate.push(live_stream, unique_piece.as_str());
                }
              }
            }
          }
        }
        if round_unique.is_empty() && finish_reason.is_none() {
          stream_supported = false;
          continue;
        }
        break (round_unique, finish_reason, true);
      } else {
        let mut body = serde_json::json!({
          "model": cfg.model_name,
          "messages": out_messages,
          "temperature": temperature,
          "stream": false
        });
        if use_fallback_chunk_limit {
          body["max_tokens"] = serde_json::json!(FALLBACK_CHUNK_MAX_TOKENS);
        }

        let resp = client
          .post(url.as_str())
          .bearer_auth(api_key.trim())
          .json(&body)
          .send()
          .await
          .map_err(|e| format!("request failed: {e}"))?;

        let status = resp.status();
        let value: serde_json::Value = resp.json().await.map_err(|e| format!("decode failed: {e}"))?;
        if status.is_success() {
          let chunk = value["choices"][0]["message"]["content"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "missing choices[0].message.content".to_string())?;
          let finish_reason = value["choices"][0]["finish_reason"].as_str().map(|s| s.to_string());
          break (chunk, finish_reason, false);
        }

        let looks_like_missing_max_tokens = status.is_client_error()
          && !use_fallback_chunk_limit
          && value.to_string().to_lowercase().contains("max_tokens");
        if looks_like_missing_max_tokens {
          use_fallback_chunk_limit = true;
          continue;
        }
        return Err(format!("http {status}: {value}"));
      }
    };

    if stream_applied && chunk.is_empty() && finish_reason.is_none() {
      stream_supported = false;
      continue;
    }

    let unique_chunk = if stream_applied {
      chunk
    } else {
      let (overlap, unique_chunk) = append_chunk_with_overlap(&mut full_text, chunk.as_str());
      if overlap > 0 {
        eprintln!(
          "continuation overlap dedup provider={} round={} overlap_chars={}",
          cfg.id, round, overlap
        );
      }
      gate.push(live_stream, unique_chunk.as_str());
      unique_chunk
    };

    if finish_reason.as_deref() != Some("length") {
      gate.finalize(live_stream);
      return Ok(full_text);
    }
    if round == MAX_CONTINUATIONS {
      full_text.push_str("\n\n[output may be truncated after repeated continuations]");
      gate.push(live_stream, "\n\n[output may be truncated after repeated continuations]");
      gate.finalize(live_stream);
      return Ok(full_text);
    }

    out_messages.push(serde_json::json!({
      "role": "assistant",
      "content": unique_chunk
    }));
    out_messages.push(serde_json::json!({
      "role": "user",
      "content": CONTINUE_PROMPT
    }));
  }

  gate.finalize(live_stream);
  Ok(full_text)
}

async fn call_anthropic_unbounded(
  app: &AppHandle,
  client: &reqwest::Client,
  cfg: &app_settings::ModelProvider,
  messages: &[ChatMessage],
  system_prompt: &str,
  live_stream: Option<&LiveStreamSession>,
) -> Result<String, String> {
  let api_key = match secrets::get_api_key(app, &cfg.id) {
    Ok(Some(v)) => v,
    Ok(None) => cfg.api_key.trim().to_string(),
    Err(e) => return Err(format!("keyring read failed: {e}")),
  };
  if api_key.trim().is_empty() {
    return Err(format!("api key not found for provider={}", cfg.id));
  }

  let mut out_messages: Vec<serde_json::Value> = messages
    .iter()
    .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
    .collect();
  let base = cfg.base_url.trim_end_matches('/');
  let endpoint = if base.is_empty() {
    "https://api.anthropic.com/v1/messages".to_string()
  } else if base.ends_with("/messages") {
    base.to_string()
  } else {
    format!("{base}/messages")
  };

  const MAX_CONTINUATIONS: usize = 64;
  const CHUNK_MAX_TOKENS: u32 = 32000;
  const CONTINUE_PROMPT: &str =
    "Continue from exactly where you stopped. Do not repeat prior text.";

  let mut full_text = String::new();
  let mut gate = LiveEmitGate::new();
  let mut stream_supported = true;
  for round in 0..=MAX_CONTINUATIONS {
    let (chunk, stop_reason, stream_applied): (String, Option<String>, bool) = if stream_supported {
      let body = serde_json::json!({
        "model": cfg.model_name,
        "max_tokens": CHUNK_MAX_TOKENS,
        "system": system_prompt,
        "messages": out_messages,
        "stream": true
      });

      let resp = client
        .post(endpoint.as_str())
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

      let status = resp.status();
      if !status.is_success() {
        let raw = resp.text().await.map_err(|e| format!("decode failed: {e}"))?;
        let lowered = raw.to_lowercase();
        let stream_unsupported = lowered.contains("stream")
          && (lowered.contains("not support")
            || lowered.contains("unsupported")
            || lowered.contains("invalid")
            || lowered.contains("unknown"));
        if stream_unsupported {
          stream_supported = false;
          continue;
        }
        return Err(format!("http {status}: {raw}"));
      }

      let mut sse_buf = String::new();
      let mut round_unique = String::new();
      let mut stop_reason: Option<String> = None;
      let mut body_stream = resp.bytes_stream();
      while let Some(item) = body_stream.next().await {
        let bytes = item.map_err(|e| format!("stream read failed: {e}"))?;
        sse_buf.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(line) = sse_take_line(&mut sse_buf) {
          if let Some(data) = line.strip_prefix("data:") {
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
              continue;
            }
            let value: serde_json::Value =
              serde_json::from_str(data).map_err(|e| format!("stream parse failed: {e}; data={data}"))?;
            match value["type"].as_str().unwrap_or_default() {
              "content_block_delta" => {
                if let Some(text) = value["delta"]["text"].as_str() {
                  let (_, unique_piece) = append_chunk_with_overlap(&mut full_text, text);
                  if !unique_piece.is_empty() {
                    round_unique.push_str(unique_piece.as_str());
                    gate.push(live_stream, unique_piece.as_str());
                  }
                }
              }
              "message_delta" => {
                if let Some(reason) = value["delta"]["stop_reason"].as_str() {
                  stop_reason = Some(reason.to_string());
                }
              }
              _ => {}
            }
          }
        }
      }
      if round_unique.is_empty() && stop_reason.is_none() {
        stream_supported = false;
        continue;
      }
      (round_unique, stop_reason, true)
    } else {
      let body = serde_json::json!({
        "model": cfg.model_name,
        "max_tokens": CHUNK_MAX_TOKENS,
        "system": system_prompt,
        "messages": out_messages
      });

      let resp = client
        .post(endpoint.as_str())
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

      let status = resp.status();
      let value: serde_json::Value = resp.json().await.map_err(|e| format!("decode failed: {e}"))?;
      if !status.is_success() {
        return Err(format!("http {status}: {value}"));
      }

      let chunk = value["content"]
        .as_array()
        .map(|arr| {
          arr
            .iter()
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join("")
        })
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing content[].text".to_string())?;
      let stop_reason = value["stop_reason"].as_str().map(|s| s.to_string());
      (chunk, stop_reason, false)
    };

    if stream_applied && chunk.is_empty() && stop_reason.is_none() {
      stream_supported = false;
      continue;
    }

    let unique_chunk = if stream_applied {
      chunk
    } else {
      let (overlap, unique_chunk) = append_chunk_with_overlap(&mut full_text, chunk.as_str());
      if overlap > 0 {
        eprintln!(
          "continuation overlap dedup provider={} round={} overlap_chars={}",
          cfg.id, round, overlap
        );
      }
      gate.push(live_stream, unique_chunk.as_str());
      unique_chunk
    };
    if stop_reason.as_deref() != Some("max_tokens") {
      gate.finalize(live_stream);
      return Ok(full_text);
    }
    if round == MAX_CONTINUATIONS {
      full_text.push_str("\n\n[output may be truncated after repeated continuations]");
      gate.push(live_stream, "\n\n[output may be truncated after repeated continuations]");
      gate.finalize(live_stream);
      return Ok(full_text);
    }

    out_messages.push(serde_json::json!({
      "role": "assistant",
      "content": unique_chunk
    }));
    out_messages.push(serde_json::json!({
      "role": "user",
      "content": CONTINUE_PROMPT
    }));
  }

  gate.finalize(live_stream);
  Ok(full_text)
}

#[tauri::command]
pub async fn ai_assistance_generate(
  app: AppHandle,
  _state: State<'_, AppState>,
  prompt: String,
) -> Result<String, String> {
  let settings = app_settings::load(&app)?;
  let client = reqwest::Client::new();
  
  let active_provider_id = settings.active_provider_id.clone();
  let providers = settings.providers.clone();
  let current_provider = providers
    .iter()
    .find(|p| p.id == active_provider_id)
    .ok_or_else(|| "provider not found".to_string())?;
  
  // Create a simple message for AI assistance
  let messages = vec![ChatMessage {
    role: "user".to_string(),
    content: prompt,
  }];
  
  // Call the appropriate AI provider
  match current_provider.kind {
    app_settings::ProviderKind::OpenAI | app_settings::ProviderKind::OpenAICompatible => {
      call_openai_unbounded(
        &app,
        &client,
        current_provider,
        &messages,
        "",
        None,
        None,
      ).await
    },
    app_settings::ProviderKind::Anthropic => {
      call_anthropic_unbounded(
        &app,
        &client,
        current_provider,
        &messages,
        "",
        None,
      ).await
    }
  }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct RiskFinding {
  pub level: String,
  pub category: String,
  pub excerpt: String,
  pub reason: String,
  pub suggestion: String,
  pub line_start: Option<usize>,
  pub line_end: Option<usize>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RiskScanResult {
  pub summary: String,
  pub overall_level: String,
  pub findings: Vec<RiskFinding>,
  pub scanned_chars: usize,
}

#[derive(Deserialize, Default)]
struct RiskFindingRaw {
  #[serde(default)]
  level: String,
  #[serde(default)]
  category: String,
  #[serde(default)]
  excerpt: String,
  #[serde(default)]
  reason: String,
  #[serde(default)]
  suggestion: String,
  #[serde(default)]
  line_start: Option<usize>,
  #[serde(default)]
  line_end: Option<usize>,
}

#[derive(Deserialize, Default)]
struct RiskScanResultRaw {
  #[serde(default)]
  summary: String,
  #[serde(default)]
  overall_level: String,
  #[serde(default)]
  findings: Vec<RiskFindingRaw>,
}

fn normalize_risk_level(level: &str) -> String {
  match level.trim().to_ascii_lowercase().as_str() {
    "high" | "critical" | "严重" | "高" => "high".to_string(),
    "medium" | "moderate" | "中" | "中等" => "medium".to_string(),
    _ => "low".to_string(),
  }
}

fn risk_level_rank(level: &str) -> u8 {
  match level {
    "high" => 3,
    "medium" => 2,
    _ => 1,
  }
}

fn clamp_text(text: &str, max_chars: usize) -> String {
  if max_chars == 0 {
    return String::new();
  }
  let mut out = String::new();
  for (idx, ch) in text.chars().enumerate() {
    if idx >= max_chars {
      out.push_str("...");
      break;
    }
    out.push(ch);
  }
  out
}

fn extract_json_block(raw: &str) -> Option<&str> {
  let start = raw.find('{')?;
  let end = raw.rfind('}')?;
  if end <= start {
    return None;
  }
  Some(&raw[start..=end])
}

fn trim_for_risk_scan(content: &str, max_chars: usize) -> String {
  let total = content.chars().count();
  if total <= max_chars {
    return content.to_string();
  }
  let half = max_chars / 2;
  let head = content.chars().take(half).collect::<String>();
  let tail = content
    .chars()
    .rev()
    .take(max_chars.saturating_sub(half))
    .collect::<Vec<_>>()
    .into_iter()
    .rev()
    .collect::<String>();
  format!(
    "{head}\n\n...[中间内容已省略，约 {} 字符]...\n\n{tail}",
    total.saturating_sub(max_chars)
  )
}

fn collect_related_chapter_snippets(root: &Path, current_file: Option<&str>) -> Vec<(String, String)> {
  let stories_dir = root.join("stories");
  if !stories_dir.is_dir() {
    return Vec::new();
  }

  let current_norm = current_file.map(|p| p.replace('\\', "/"));
  let mut files: Vec<(String, PathBuf)> = Vec::new();

  if let Ok(entries) = fs::read_dir(&stories_dir) {
    for entry in entries.flatten() {
      let path = entry.path();
      if !path.is_file() {
        continue;
      }
      let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
      if ext != "md" && ext != "txt" {
        continue;
      }
      let rel = path
        .strip_prefix(root)
        .unwrap_or(&path)
        .to_string_lossy()
        .to_string()
        .replace('\\', "/");
      if current_norm.as_deref() == Some(rel.as_str()) {
        continue;
      }
      files.push((rel, path));
    }
  }

  files.sort_by(|a, b| a.0.cmp(&b.0));
  files
    .into_iter()
    .take(3)
    .filter_map(|(rel, path)| {
      fs::read_to_string(path)
        .ok()
        .map(|raw| (rel, trim_for_risk_scan(raw.trim(), 1200)))
    })
    .collect()
}

fn parse_risk_scan_result(raw: &str, scanned_chars: usize) -> RiskScanResult {
  let parsed = extract_json_block(raw)
    .and_then(|json| serde_json::from_str::<RiskScanResultRaw>(json).ok())
    .or_else(|| serde_json::from_str::<RiskScanResultRaw>(raw).ok());

  if let Some(parsed) = parsed {
    let findings = parsed
      .findings
      .into_iter()
      .map(|it| RiskFinding {
        level: normalize_risk_level(it.level.as_str()),
        category: {
          let v = it.category.trim();
          if v.is_empty() {
            "other".to_string()
          } else {
            clamp_text(v, 48)
          }
        },
        excerpt: clamp_text(it.excerpt.trim(), 200),
        reason: clamp_text(it.reason.trim(), 240),
        suggestion: clamp_text(it.suggestion.trim(), 240),
        line_start: it.line_start.filter(|v| *v > 0),
        line_end: it.line_end.filter(|v| *v > 0),
      })
      .filter(|it| !(it.excerpt.is_empty() && it.reason.is_empty()))
      .take(24)
      .collect::<Vec<_>>();

    let overall_level = {
      let explicit = normalize_risk_level(parsed.overall_level.as_str());
      if parsed.overall_level.trim().is_empty() {
        findings
          .iter()
          .map(|it| it.level.as_str())
          .max_by_key(|lvl| risk_level_rank(lvl))
          .unwrap_or("low")
          .to_string()
      } else {
        explicit
      }
    };

    let summary = {
      let value = parsed.summary.trim();
      if !value.is_empty() {
        clamp_text(value, 280)
      } else if findings.is_empty() {
        "未发现明显高风险片段，建议人工复核。".to_string()
      } else {
        format!("检测到 {} 条潜在风险，请优先处理高风险项。", findings.len())
      }
    };

    return RiskScanResult {
      summary,
      overall_level,
      findings,
      scanned_chars,
    };
  }

  RiskScanResult {
    summary: clamp_text(raw.trim(), 280),
    overall_level: "medium".to_string(),
    findings: Vec::new(),
    scanned_chars,
  }
}

fn append_risk_scan_log(root: &Path, entry: serde_json::Value) -> Result<(), String> {
  let log_dir = root.join(".novel").join(".logs");
  fs::create_dir_all(&log_dir).map_err(|e| format!("create log dir failed: {e}"))?;
  let path = log_dir.join("risk_scan.jsonl");
  let mut line = entry.to_string();
  line.push('\n');
  fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)
    .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()))
    .map_err(|e| format!("append risk log failed: {e}"))
}

#[tauri::command]
pub async fn risk_scan_content(
  app: AppHandle,
  state: State<'_, AppState>,
  file_path: Option<String>,
  content: String,
) -> Result<RiskScanResult, String> {
  let root = get_workspace_root(&state)?;
  let trimmed = content.trim();
  if trimmed.is_empty() {
    return Err("content is empty".to_string());
  }

  let settings = app_settings::load(&app)?;
  let current_provider = settings
    .providers
    .iter()
    .find(|p| p.id == settings.active_provider_id)
    .cloned()
    .ok_or_else(|| "provider not found".to_string())?;
  let client = reqwest::Client::new();
  let scanned_chars = content.chars().count();
  let payload_text = trim_for_risk_scan(trimmed, 30_000);
  let snippets = collect_related_chapter_snippets(&root, file_path.as_deref());

  let mut prompt = String::new();
  prompt.push_str("请对以下小说内容做合规风险检测，重点识别违法违规、过度暴力血腥、未成年人不当内容、仇恨歧视、色情露骨、现实敏感风险等问题。\n");
  prompt.push_str("请返回 JSON，字段必须完整：\n");
  prompt.push_str("{\"summary\":\"...\",\"overall_level\":\"low|medium|high\",\"findings\":[{\"level\":\"low|medium|high\",\"category\":\"...\",\"excerpt\":\"...\",\"reason\":\"...\",\"suggestion\":\"...\",\"line_start\":1,\"line_end\":1}]}\n");
  prompt.push_str("要求：\n");
  prompt.push_str("- 仅返回 JSON，不要 Markdown。\n");
  prompt.push_str("- 若没有明显问题，findings 返回空数组，overall_level=low。\n");
  prompt.push_str("- excerpt 必须引用原文中的短片段，避免过长。\n");
  prompt.push_str("- suggestion 给出可执行改写建议。\n\n");
  if let Some(path) = file_path.as_ref().filter(|p| !p.trim().is_empty()) {
    prompt.push_str(format!("当前文件: {}\n\n", path.trim()).as_str());
  }
  if !snippets.is_empty() {
    prompt.push_str("相关章节上下文（用于避免误判，非必须逐条点评）：\n");
    for (idx, (path, text)) in snippets.iter().enumerate() {
      prompt.push_str(format!("【上下文{}】{}\n{}\n\n", idx + 1, path, text).as_str());
    }
  }
  prompt.push_str("待检测正文：\n");
  prompt.push_str(payload_text.as_str());

  let system_prompt = "你是严格的中文小说合规审校助手，输出务必是可解析 JSON，不得包含解释文字。";
  let messages = vec![ChatMessage {
    role: "user".to_string(),
    content: prompt,
  }];

  let raw = match current_provider.kind {
    app_settings::ProviderKind::OpenAI | app_settings::ProviderKind::OpenAICompatible => {
      call_openai_unbounded(
        &app,
        &client,
        &current_provider,
        &messages,
        system_prompt,
        Some(0.2),
        None,
      )
      .await?
    }
    app_settings::ProviderKind::Anthropic => {
      call_anthropic_unbounded(
        &app,
        &client,
        &current_provider,
        &messages,
        system_prompt,
        None,
      )
      .await?
    }
  };

  let result = parse_risk_scan_result(raw.as_str(), scanned_chars);
  let _ = append_risk_scan_log(
    &root,
    serde_json::json!({
      "ts": Utc::now().to_rfc3339(),
      "provider": current_provider.id,
      "model": current_provider.model_name,
      "file_path": file_path,
      "scanned_chars": result.scanned_chars,
      "overall_level": result.overall_level,
      "findings": result.findings.len(),
    }),
  );
  Ok(result)
}

fn get_workspace_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
  state
    .workspace_root
    .lock()
    .map_err(|_| "workspace lock poisoned")?
    .clone()
    .ok_or_else(|| "workspace not set".to_string())
}

fn canonicalize_path(path: &Path) -> Result<PathBuf, String> {
  fs::canonicalize(path).map_err(|e| format!("invalid path: {e}"))
}

fn start_fs_watcher(app: &AppHandle, state: &State<'_, AppState>, root: PathBuf) -> Result<(), String> {
  let app_handle = app.clone();
  let root_for_strip = root.clone();
  let mut watcher =
    notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| match res {
      Ok(event) => {
        let kind = match event.kind {
          EventKind::Create(_) => "create",
          EventKind::Modify(_) => "modify",
          EventKind::Remove(_) => "remove",
          EventKind::Access(_) => "access",
          EventKind::Other => "other",
          EventKind::Any => "any",
        };
        for p in event.paths {
          let rel = p
            .strip_prefix(&root_for_strip)
            .unwrap_or(&p)
            .to_string_lossy()
            .to_string()
            .replace('\\', "/");
          let _ = app_handle.emit("fs_changed", serde_json::json!({ "kind": kind, "path": rel }));
        }
      }
      Err(e) => {
        let _ = app_handle.emit("fs_watch_error", serde_json::json!({ "message": e.to_string() }));
      }
    })
    .map_err(|e| format!("create watcher failed: {e}"))?;
  watcher
    .watch(&root, RecursiveMode::Recursive)
    .map_err(|e| format!("watch failed: {e}"))?;
  *state.fs_watcher.lock().map_err(|_| "watcher lock poisoned")? = Some(watcher);
  Ok(())
}

pub(crate) fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
  let p = PathBuf::from(relative_path);
  if p.is_absolute() {
    return Err("absolute path is not allowed".to_string());
  }
  for c in p.components() {
    match c {
      Component::Normal(_) | Component::CurDir => {}
      _ => return Err("invalid relative path".to_string()),
    }
  }
  Ok(p)
}

fn normalize_plaintext(s: &str) -> String {
  let mut out: Vec<&str> = Vec::new();
  for line in s.lines() {
    let trimmed = line.trim_start_matches(|c: char| c == ' ' || c == '\t');
    if trimmed.is_empty() {
      continue;
    }
    out.push(trimmed);
  }
  out.join("\n").trim().to_string()
}

pub(crate) fn update_concept_index(root: &Path, rel_path: &str, content: &str) -> Result<(), String> {
  #[derive(Serialize, Deserialize, Default)]
  struct ConceptIndex {
    revision: u64,
    updated_at: String,
    files: std::collections::BTreeMap<String, ConceptFileInfo>,
  }

  #[derive(Serialize, Deserialize, Default)]
  struct ConceptFileInfo {
    hash: String,
    revision: u64,
    updated_at: String,
  }

  let index_path = root.join(".novel").join(".cache").join("concept_index.json");
  let mut index: ConceptIndex = if index_path.exists() {
    let raw = fs::read_to_string(&index_path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
  } else {
    ConceptIndex::default()
  };

  let hash = blake3::hash(content.as_bytes()).to_hex().to_string();
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
    .to_string();

  let changed = index.files.get(rel_path).map(|f| f.hash.as_str() != hash).unwrap_or(true);
  if changed {
    index.revision = index.revision.saturating_add(1);
    index.updated_at = now.clone();
    index.files.insert(
      rel_path.to_string(),
      ConceptFileInfo {
        hash,
        revision: index.revision,
        updated_at: now,
      },
    );
  }

  if let Some(parent) = index_path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create concept index dir failed: {e}"))?;
  }
  let raw = serde_json::to_string_pretty(&index).map_err(|e| format!("serialize concept index failed: {e}"))?;
  fs::write(index_path, raw).map_err(|e| format!("write concept index failed: {e}"))
}

pub(crate) fn validate_outline(existing_json: &str, new_json: &str) -> Result<(), String> {
  #[derive(Deserialize, Default)]
  struct Outline {
    #[serde(default)]
    events: Vec<Event>,
  }

  #[derive(Deserialize, Default)]
  struct Event {
    #[serde(default)]
    id: String,
    #[serde(default)]
    time: String,
    #[serde(default)]
    location: String,
    #[serde(default)]
    characters: Vec<String>,
    #[serde(default)]
    #[allow(dead_code)]
    description: String,
  }

  let existing: Outline = if existing_json.trim().is_empty() {
    Outline::default()
  } else {
    serde_json::from_str(existing_json).unwrap_or_default()
  };
  let incoming: Outline = serde_json::from_str(new_json).map_err(|e| format!("outline json invalid: {e}"))?;

  let mut combined = Vec::new();
  combined.extend(existing.events.into_iter());
  combined.extend(incoming.events.into_iter());

  let mut id_set = std::collections::BTreeMap::<String, usize>::new();
  let mut conflicts: Vec<String> = Vec::new();

  for (idx, ev) in combined.iter().enumerate() {
    if !ev.id.trim().is_empty() {
      if let Some(prev) = id_set.insert(ev.id.clone(), idx) {
        conflicts.push(format!("事件 id 重复：{}（{} 与 {}）", ev.id, prev + 1, idx + 1));
      }
    }
  }

  let mut per_character: std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>> =
    std::collections::BTreeMap::new();

  for ev in combined {
    if ev.time.trim().is_empty() {
      continue;
    }
    if ev.characters.is_empty() {
      continue;
    }
    for ch in ev.characters {
      let by_time = per_character.entry(ch.clone()).or_default();
      if let Some(prev_loc) = by_time.get(&ev.time) {
        if !ev.location.trim().is_empty() && prev_loc != &ev.location {
          conflicts.push(format!("时间线冲突：{} 在 {} 同时出现在 {} 与 {}", ch, ev.time, prev_loc, ev.location));
        }
      } else if !ev.location.trim().is_empty() {
        by_time.insert(ev.time.clone(), ev.location.clone());
      }
    }
  }

  if conflicts.is_empty() {
    Ok(())
  } else {
    Err(conflicts.join("\n"))
  }
}

fn build_tree(root: &Path, path: &Path, max_depth: usize) -> Result<FsEntry, String> {
  let meta = fs::metadata(path).map_err(|e| format!("metadata failed: {e}"))?;
  let name = if path == root {
    root
      .file_name()
      .map(|s| s.to_string_lossy().to_string())
      .unwrap_or_else(|| root.to_string_lossy().to_string())
  } else {
    path
      .file_name()
      .map(|s| s.to_string_lossy().to_string())
      .unwrap_or_else(|| path.to_string_lossy().to_string())
  };
  let rel_path = path
    .strip_prefix(root)
    .unwrap_or(path)
    .to_string_lossy()
    .to_string()
    .replace('\\', "/");

  if meta.is_dir() {
    if max_depth == 0 {
      return Ok(FsEntry {
        name,
        path: rel_path,
        kind: "dir".to_string(),
        children: vec![],
      });
    }

    let mut children: Vec<FsEntry> = vec![];
    for entry in fs::read_dir(path).map_err(|e| format!("read dir failed: {e}"))? {
      let entry = entry.map_err(|e| format!("read dir entry failed: {e}"))?;
      let child_path = entry.path();
      let child = build_tree(root, &child_path, max_depth - 1)?;
      children.push(child);
    }

    children.sort_by(|a, b| match (a.kind.as_str(), b.kind.as_str()) {
      ("dir", "file") => std::cmp::Ordering::Less,
      ("file", "dir") => std::cmp::Ordering::Greater,
      _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(FsEntry {
      name,
      path: rel_path,
      kind: "dir".to_string(),
      children,
    })
  } else {
    Ok(FsEntry {
      name,
      path: rel_path,
      kind: "file".to_string(),
      children: vec![],
    })
  }
}

// ============ Skill Commands ============

#[tauri::command]
pub fn get_skills() -> Vec<Skill> {
    let manager = SkillManager::new();
    manager.get_all().into_iter().cloned().collect()
}

#[tauri::command]
pub fn get_skill_categories() -> Vec<String> {
    let manager = SkillManager::new();
    manager.categories()
}

#[tauri::command]
pub fn get_skills_by_category(category: String) -> Vec<Skill> {
    let manager = SkillManager::new();
    manager.get_by_category(&category).into_iter().cloned().collect()
}

#[tauri::command]
pub fn apply_skill(skill_id: String, content: String) -> String {
    let manager = SkillManager::new();
    manager.apply_skill(&skill_id, &content)
}

// ============ Book Split Commands ============

use crate::book_split::{BookAnalysis, BookSplitConfig, BookSplitResult, ChapterInfo, SplitChapter};

#[allow(dead_code)]
#[tauri::command]
pub async fn analyze_book(content: String, title: String) -> Result<BookAnalysis, String> {
    // 简单分析实现
    let words = content.chars().filter(|c| !c.is_whitespace()).count();
    let lines: Vec<&str> = content.lines().collect();
    
    let mut analysis = BookAnalysis::new(&title);
    analysis.total_words = words;
    
    // 尝试识别章节
    let mut chapter_count = 0;
    let mut current_chapter = String::new();
    let mut chapter_start = 0;
    
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        // 检测章节标题模式
        if trimmed.starts_with("第") && (trimmed.contains("章") || trimmed.contains("节") || trimmed.contains("回")) {
            if chapter_count > 0 {
                // 保存上一章
                let chapter_words = current_chapter.chars().filter(|c| !c.is_whitespace()).count();
                analysis.chapters.push(ChapterInfo {
                    id: chapter_count,
                    title: format!("第{}章", chapter_count),
                    start_line: chapter_start,
                    end_line: i - 1,
                    word_count: chapter_words,
                    summary: format!("第{}章内容，约{}字", chapter_count, chapter_words),
                    key_events: vec![],
                    characters_appearing: vec![],
                });
            }
            chapter_count += 1;
            chapter_start = i;
            current_chapter = String::new();
        } else if chapter_count > 0 {
            current_chapter.push_str(line);
            current_chapter.push('\n');
        }
    }
    
    // 保存最后一章
    if chapter_count > 0 && !current_chapter.is_empty() {
        let chapter_words = current_chapter.chars().filter(|c| !c.is_whitespace()).count();
        analysis.chapters.push(ChapterInfo {
            id: chapter_count,
            title: format!("第{}章", chapter_count),
            start_line: chapter_start,
            end_line: lines.len() - 1,
            word_count: chapter_words,
            summary: format!("最后一章，约{}字", chapter_words),
            key_events: vec![],
            characters_appearing: vec![],
        });
    }
    
    // 如果没有识别到章节，按字数拆分
    if analysis.chapters.is_empty() {
        let target_words = 3000;
        let mut chapter_content = String::new();
        let mut chapter_id = 1;
        
        for line in &lines {
            chapter_content.push_str(line);
            chapter_content.push('\n');
            
            let current_words = chapter_content.chars().filter(|c| !c.is_whitespace()).count();
            if current_words >= target_words {
                analysis.chapters.push(ChapterInfo {
                    id: chapter_id,
                    title: format!("第{}章", chapter_id),
                    start_line: 0,
                    end_line: 0,
                    word_count: current_words,
                    summary: format!("自动拆分章节，约{}字", current_words),
                    key_events: vec![],
                    characters_appearing: vec![],
                });
                chapter_id += 1;
                chapter_content = String::new();
            }
        }
        
        // 最后一章
        if !chapter_content.is_empty() {
            let current_words = chapter_content.chars().filter(|c| !c.is_whitespace()).count();
            if current_words > 100 {
                analysis.chapters.push(ChapterInfo {
                    id: chapter_id,
                    title: format!("第{}章", chapter_id),
                    start_line: 0,
                    end_line: 0,
                    word_count: current_words,
                    summary: format!("自动拆分章节，约{}字", current_words),
                    key_events: vec![],
                    characters_appearing: vec![],
                });
            }
        }
    }
    
    analysis.outline.structure = if chapter_count > 10 { "多线复杂结构".to_string() } else { "线性结构".to_string() };
    analysis.themes = vec!["待分析".to_string()];
    analysis.style = "待分析".to_string();
    
    Ok(analysis)
}

#[allow(dead_code)]
#[tauri::command]
pub async fn split_book(content: String, title: String, config: BookSplitConfig) -> Result<BookSplitResult, String> {
    let words: Vec<&str> = content.lines().collect();
    let target_words = config.target_chapter_words;
    
    let mut chapters: Vec<SplitChapter> = vec![];
    let mut current_content = String::new();
    let mut chapter_id = 1;
    let mut current_words = 0;
    
    for line in words {
        current_content.push_str(line);
        current_content.push('\n');
        current_words += line.chars().filter(|c| !c.is_whitespace()).count();
        
        if current_words >= target_words {
            // 查找合适的断点（句号、段落结束）
            let mut break_point = current_content.len();
            for (i, c) in current_content.chars().rev().enumerate() {
                if c == '。' || c == '！' || c == '？' || c == '\n' {
                    break_point = current_content.len() - i;
                    break;
                }
            }
            
            let chapter_content = current_content[..break_point].to_string();
            let chapter_words = chapter_content.chars().filter(|c| !c.is_whitespace()).count();
            
            chapters.push(SplitChapter {
                id: chapter_id,
                title: format!("第{}章", chapter_id),
                content: chapter_content,
                word_count: chapter_words,
                start_index: 0,
                end_index: 0,
                summary: None,
            });
            
            current_content = current_content[break_point..].to_string();
            current_words = current_content.chars().filter(|c| !c.is_whitespace()).count();
            chapter_id += 1;
        }
    }
    
    // 处理剩余内容
    if !current_content.is_empty() {
        let chapter_words = current_content.chars().filter(|c| !c.is_whitespace()).count();
        if chapter_words > 50 {
            chapters.push(SplitChapter {
                id: chapter_id,
                title: format!("第{}章", chapter_id),
                content: current_content,
                word_count: chapter_words,
                start_index: 0,
                end_index: 0,
                summary: None,
            });
        }
    }

    let total_words: usize = chapters.iter().map(|c| c.word_count).sum();
    let mut metadata = HashMap::new();
    metadata.insert("total_chapters".to_string(), chapters.len().to_string());
    metadata.insert("target_words_per_chapter".to_string(), target_words.to_string());

    Ok(BookSplitResult {
        title: title.clone(),
        original_title: title,
        chapters,
        total_words,
        metadata,
    })
}

#[allow(dead_code)]
#[tauri::command]
pub async fn extract_chapters(content: String) -> Result<Vec<ChapterInfo>, String> {
    let lines: Vec<&str> = content.lines().collect();
    let mut chapters: Vec<ChapterInfo> = vec![];
    let mut chapter_id = 0;
    let mut current_title = String::new();
    let mut current_content = String::new();
    let mut start_line = 0;
    
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        
        // 检测章节标题
        let is_chapter_title = trimmed.starts_with("第") 
            && (trimmed.contains("章") || trimmed.contains("节") || trimmed.contains("回"))
            && trimmed.len() < 50;
        
        if is_chapter_title {
            // 保存上一章
            if chapter_id > 0 && !current_content.is_empty() {
                let word_count = current_content.chars().filter(|c| !c.is_whitespace()).count();
                chapters.push(ChapterInfo {
                    id: chapter_id,
                    title: current_title,
                    start_line,
                    end_line: i - 1,
                    word_count,
                    summary: format!("约{}字", word_count),
                    key_events: vec![],
                    characters_appearing: vec![],
                });
            }
            
            chapter_id += 1;
            current_title = trimmed.to_string();
            current_content = String::new();
            start_line = i;
        } else if chapter_id > 0 {
            current_content.push_str(line);
            current_content.push('\n');
        }
    }
    
    // 保存最后一章
    if chapter_id > 0 && !current_content.is_empty() {
        let word_count = current_content.chars().filter(|c| !c.is_whitespace()).count();
        chapters.push(ChapterInfo {
            id: chapter_id,
            title: current_title,
            start_line,
            end_line: lines.len() - 1,
            word_count,
            summary: format!("约{}字", word_count),
            key_events: vec![],
            characters_appearing: vec![],
        });
    }
    
    Ok(chapters)
}

// ============ AI Book Analysis Commands ============

#[allow(dead_code)]
#[tauri::command]
pub async fn ai_analyze_book_deep(
    content: String,
    title: String,
    _openai_key: String,
) -> Result<String, String> {
    let _prompt = format!(r#"请分析以下小说内容，提供详细的书本结构分析：

书籍标题：{}

要求分析：
1. 故事结构（起承转合）
2. 主要人物及其性格特点
3. 核心主题
4. 世界观/设定
5. 每章的内容概要

小说内容：
{}

请用JSON格式返回分析结果，格式如下：
{{
    "structure": "故事结构描述",
    "themes": ["主题1", "主题2"],
    "characters": [
        {{"name": "人物名", "role": "角色", "description": "描述"}}
    ],
    "chapters_summary": [
        {{"title": "章节名", "summary": "章节概要"}}
    ]
}}"#, title, content);
    
    // 这里需要调用OpenAI API
    // 简化版本返回提示信息
    Ok("AI分析功能需要配置API Key".to_string())
}

#[allow(dead_code)]
#[tauri::command]
pub async fn ai_split_by_ai(
    content: String,
    _title: String,
    target_words: u32,
    _openai_key: String,
) -> Result<String, String> {
    let _prompt = format!(r#"请将以下小说内容拆分成章节，每章大约{}字：

要求：
1. 在合适的断点分割（句号、段落结束）
2. 为每个章节起一个标题
3. 输出JSON格式

小说内容：
{}

输出格式：
{{
    "chapters": [
        {{"title": "章节标题", "content": "章节内容"}}
    ]
}}"#, target_words, content);
    
    Ok("AI拆分功能需要配置API Key".to_string())
}

// ============ Book Analysis Commands ============

use crate::book_split::{BookAnalysisResult, Act, TurningPoint, PowerMoment, CharacterAnalysis, WritingTechnique};

#[tauri::command]
pub async fn book_analyze(content: String, title: String) -> Result<BookAnalysisResult, String> {
    let mut result = BookAnalysisResult::new(&title);
    let word_count = content.chars().filter(|c| !c.is_whitespace()).count();
    let lines: Vec<&str> = content.lines().collect();
    
    // 估算章节数（假设每章3000字）
    let estimated_chapters = (word_count / 3000).max(1);
    
    // 分析章节标题模式
    let mut chapter_count = 0;

    for line in lines.iter() {
        let trimmed = line.trim();
        // 检测章节标题
        if trimmed.starts_with("第") && (trimmed.contains("章") || trimmed.contains("节") || trimmed.contains("回")) {
            chapter_count += 1;
        }
    }
    
    let actual_chapters = if chapter_count > 0 { chapter_count } else { estimated_chapters };
    
    // 生成结构分析
    result.structure.r#type = if actual_chapters > 100 {
        "长篇多线结构".to_string()
    } else if actual_chapters > 50 {
        "中长篇结构".to_string()
    } else {
        "中短篇结构".to_string()
    };
    
    // Estimate act structure
    let chapters_per_act = (actual_chapters as f32 / 4.0).ceil() as usize;
    result.structure.acts = vec![
        Act { id: 1, name: "opening".to_string(), chapters: (1..=chapters_per_act).collect(), description: "setup and introduction".to_string() },
        Act { id: 2, name: "development".to_string(), chapters: (chapters_per_act+1..=chapters_per_act*2).collect(), description: "develop and deepen".to_string() },
        Act { id: 3, name: "climax".to_string(), chapters: (chapters_per_act*2+1..=chapters_per_act*3).collect(), description: "turning point and climax".to_string() },
        Act { id: 4, name: "conclusion".to_string(), chapters: (chapters_per_act*3+1..=actual_chapters).collect(), description: "resolution and ending".to_string() },
    ];
    
    // 节奏分析
    result.rhythm.average_chapter_length = word_count / actual_chapters.max(1);
    result.rhythm.conflict_density = if result.rhythm.average_chapter_length > 4000 {
        "高".to_string()
    } else if result.rhythm.average_chapter_length > 2000 {
        "中".to_string()
    } else {
        "低".to_string()
    };
    
    // Add some sample turning points
    if actual_chapters > 10 {
        result.rhythm.turning_points = vec![
            TurningPoint {
                chapter: actual_chapters / 4,
                r#type: "minor_climax".to_string(),
                description: "First conflict resolution".to_string()
            },
            TurningPoint {
                chapter: actual_chapters / 2,
                r#type: "major_turn".to_string(),
                description: "Core conflict erupts".to_string()
            },
            TurningPoint {
                chapter: (actual_chapters as f32 * 0.75) as usize,
                r#type: "climax".to_string(),
                description: "Final battle".to_string()
            },
        ];
    }
    
    // 章尾钩子类型
    result.rhythm.chapter_hooks = vec![
        "悬念型".to_string(), // 战斗胜负未分
        "意外型".to_string(), // 突然出现强敌
        "反转型".to_string(), // 真相出人意料
        "期待型".to_string(), // 修炼突破在即
    ];
    
    // Analyze common web novel power moments
    result.power_moments = vec![
        PowerMoment { chapter: actual_chapters / 5, r#type: "face_slap".to_string(), description: "Protagonist shames the antagonist".to_string(), frequency: "high".to_string() },
        PowerMoment { chapter: actual_chapters / 3, r#type: "reversal".to_string(), description: "Weak to strong, defeats powerful enemy".to_string(), frequency: "medium".to_string() },
        PowerMoment { chapter: actual_chapters / 2, r#type: "gain".to_string(), description: "Obtain treasure/legacy".to_string(), frequency: "high".to_string() },
    ];
    
    // Character analysis (sample)
    result.characters = vec![
        CharacterAnalysis {
            name: "protagonist".to_string(),
            role: "protagonist".to_string(),
            archetype: "loser_reversal".to_string(),
            growth: "Weak to strong growth curve".to_string(),
            main_moments: vec!["First victory".to_string(), "Major breakthrough".to_string()],
            relationships: vec!["Conflict with antagonist".to_string(), "Bond with companions".to_string()],
        },
    ];
    
    // Writing techniques summary
    result.techniques = vec![
        WritingTechnique {
            category: "narrative".to_string(),
            technique: "Omniscient perspective".to_string(),
            example: "All-knowing perspective".to_string(),
            application: "Good for beginners".to_string()
        },
        WritingTechnique {
            category: "pacing".to_string(),
            technique: "Continuous minor climaxes".to_string(),
            example: "One power moment every 3-5 chapters".to_string(),
            application: "Maintain reader interest".to_string()
        },
        WritingTechnique {
            category: "dialogue".to_string(),
            technique: "Plot-advancing dialogue".to_string(),
            example: "Less filler, more information".to_string(),
            application: "Avoid padding".to_string()
        },
    ];

    // Learnable points
    result.learnable_points = vec![
        "Pacing: ~{} words/chapter".replace("{}", &result.rhythm.average_chapter_length.to_string()),
        "Structure: Four-act structure".to_string(),
        "Power moment design: Face-slap - Reversal - Gain".to_string(),
        "Character growth: Classic loser-to-hero route".to_string(),
        "Chapter hooks: Leave suspense at end of each chapter".to_string(),
    ];
    
    result.summary = format!(
        "\"{}\" has about {} words, {} chapters, belongs to {}. \
        Pacing is {}, conflict density is {}. \
        Main power moment types: face-slap, reversal, gain. \
        Learnable points: pacing control, power moment design, character growth curve.",
        title,
        word_count,
        actual_chapters,
        result.structure.r#type,
        result.rhythm.conflict_density,
        result.rhythm.conflict_density
    );
    
    Ok(result)
}

#[tauri::command]
pub async fn book_extract_techniques(content: String) -> Result<Vec<WritingTechnique>, String> {
    let mut techniques = vec![];
    
    // Simple analysis of common writing patterns
    if content.contains("只见") || content.contains("那道") || content.contains("此人") {
        techniques.push(WritingTechnique {
            category: "description".to_string(),
            technique: "appearance description".to_string(),
            example: "just see this person...".to_string(),
            application: "character introduction".to_string()
        });
    }
    
    if content.contains("修为") || content.contains("灵气") || content.contains("功法") {
        techniques.push(WritingTechnique {
            category: "setting".to_string(),
            technique: "cultivation system".to_string(),
            example: "spiritual energy - technique - cultivation".to_string(),
            application: "fantasy power system".to_string()
        });
    }
    
    if content.contains("冷笑") || content.contains("不屑") || content.contains("讥讽") {
        techniques.push(WritingTechnique {
            category: "dialogue".to_string(),
            technique: "antagonist mockery".to_string(),
            example: "cold laugh...".to_string(),
            application: "create conflict".to_string()
        });
    }
    
    if content.contains("系统") || content.contains("叮") || content.contains("恭喜") {
        techniques.push(WritingTechnique {
            category: "golden_finger".to_string(),
            technique: "system stream".to_string(),
            example: "system issues task".to_string(),
            application: "protagonist gets strong quickly".to_string()
        });
    }
    
    // Default technique
    if techniques.is_empty() {
        techniques.push(WritingTechnique {
            category: "narrative".to_string(),
            technique: "progressive narrative".to_string(),
            example: "clear main plot".to_string(),
            application: "keep story moving".to_string()
        });
    }
    
    Ok(techniques)
}
