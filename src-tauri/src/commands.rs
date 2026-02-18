use crate::app_settings;
use crate::agents;
use crate::agent_system;
use crate::ai_types::ChatMessage;
use crate::app_data;
use crate::branding;
use crate::chat_history;
use crate::secrets;
use crate::spec_kit;
use crate::spec_kit_export;
use crate::state::AppState;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::Instant;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;
use notify::{EventKind, RecursiveMode, Watcher};

#[tauri::command]
pub fn ping() -> &'static str {
  "pong"
}

#[derive(Serialize)]
pub struct WorkspaceInfo {
  pub root: String,
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
  app_data::data_file_path(app, "last_workspace.json")
}

fn save_last_workspace(app: &AppHandle, root: &Path) -> Result<(), String> {
  let path = last_workspace_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create last workspace dir failed: {e}"))?;
  }
  let payload = serde_json::json!({ "path": root.to_string_lossy().to_string() }).to_string();
  fs::write(path, payload).map_err(|e| format!("write last workspace failed: {e}"))
}

#[tauri::command]
pub fn init_novel(state: State<'_, AppState>) -> Result<(), String> {
  let root = get_workspace_root(&state)?;
  let novel_dir = root.join(".novel");

  let dirs = [
    novel_dir.join(".settings"),
    novel_dir.join(".cache"),
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
    let raw = serde_json::json!({
      "chapter_word_target": 2000
    })
    .to_string();
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

  spec_kit::ensure_spec_kit_defaults(&novel_dir)?;

  Ok(())
}

#[derive(Serialize, Clone)]
pub struct FsEntry {
  pub name: String,
  pub path: String,
  pub kind: String,
  pub children: Vec<FsEntry>,
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

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<app_settings::AppSettings, String> {
  let mut s = app_settings::load(&app)?;
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
  let list = agents::load(&app)?;
  serde_json::to_string_pretty(&list).map_err(|e| format!("export agents failed: {e}"))
}

#[tauri::command]
pub fn import_agents(app: AppHandle, json: String) -> Result<(), String> {
  let list: Vec<agents::Agent> = serde_json::from_str(&json).map_err(|e| format!("import agents failed: {e}"))?;
  agents::save(&app, &list)
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

  tauri::async_runtime::spawn(async move {
    let payload_start = serde_json::json!({ "streamId": stream_id });
    let _ = window.emit("ai_stream_start", payload_start);

    let settings = match app_settings::load(&app) {
      Ok(v) => v,
      Err(e) => {
        let _ = window.emit(
          "ai_error",
          serde_json::json!({
            "streamId": stream_id,
            "stage": "settings",
            "message": e
          }),
        );
        let _ = window.emit("ai_stream_done", serde_json::json!({ "streamId": stream_id }));
        return;
      }
    };
    let effective_use_markdown = use_markdown || settings.output.use_markdown;
    let agents_list = agents::load(&app).unwrap_or_else(|_| agents::default_agents());
    let effective_agent_id = agent_id.unwrap_or_else(|| settings.active_agent_id.clone());
    let agent = agents_list.iter().find(|a| a.id == effective_agent_id);
    let agent_system = agent.map(|a| a.system_prompt.clone()).unwrap_or_default();
    let agent_temp = agent.map(|a| a.temperature);
    let agent_max = agent.map(|a| a.max_tokens);
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
        let _ = window.emit(
          "ai_error",
          serde_json::json!({ "streamId": stream_id, "stage": "settings", "message": e }),
        );
        let _ = window.emit("ai_stream_done", serde_json::json!({ "streamId": stream_id }));
        return;
      }
    };

    let workspace_root_clone = workspace_root.clone();
    let mut runtime = agent_system::AgentRuntime::new(workspace_root);
    let start = Instant::now();
    let (mut response, perf) = match runtime
      .run_react(messages, agent_system.clone(), |msgs| {
        let provider_cfg = current_provider.clone();
        let client = client.clone();
        let app = app.clone();
        let agent_temp = agent_temp;
        let agent_max = agent_max;
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
              call_openai_compatible(
                &app,
                &client,
                &provider_cfg, // pass full provider config
                &filtered,
                system.as_str(),
                agent_temp,
                agent_max
              ).await
            },
            app_settings::ProviderKind::Anthropic => {
              call_anthropic(
                &app,
                &client,
                &provider_cfg,
                &filtered,
                system.as_str(),
                agent_max
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
          "streamId": stream_id,
          "provider": current_provider.id,
          "stage": stage,
          "message": e
        });
        let _ = window.emit("ai_error", payload);
        let payload_done = serde_json::json!({ "streamId": stream_id });
        let _ = window.emit("ai_stream_done", payload_done);
        return;
      }
    };
    let _ = window.emit(
      "ai_perf",
      serde_json::json!({
        "streamId": stream_id,
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
          "streamId": stream_id,
          "changeSet": cs
        });
        let _ = window.emit("ai_change_set", payload);
        Some(cs)
      }
      Ok(None) => None,
      Err(e) => {
        eprintln!("Failed to parse AI response for modifications: {}", e);
        None
      }
    };

    let step_chars = 48usize;
    let mut buf = String::new();
    let mut count = 0usize;
    for ch in response.chars() {
      buf.push(ch);
      count += 1;
      if count >= step_chars {
        let payload = serde_json::json!({ "streamId": stream_id, "token": buf });
        let _ = window.emit("ai_stream_token", payload);
        buf = String::new();
        count = 0;
        tokio::time::sleep(std::time::Duration::from_millis(15)).await;
      }
    }
    if !buf.is_empty() {
      let payload = serde_json::json!({ "streamId": stream_id, "token": buf });
      let _ = window.emit("ai_stream_token", payload);
    }

    let payload_done = serde_json::json!({ "streamId": stream_id });
    let _ = window.emit("ai_stream_done", payload_done);
  });

  Ok(())
}

async fn call_openai_compatible(
  app: &AppHandle,
  client: &reqwest::Client,
  cfg: &app_settings::ModelProvider,
  messages: &[ChatMessage],
  system_prompt: &str,
  temperature_override: Option<f32>,
  max_tokens_override: Option<u32>,
) -> Result<String, String> {
  let api_key = match secrets::get_api_key(app, &cfg.id) {
    Ok(Some(v)) => v,
    Ok(None) => cfg.api_key.trim().to_string(),
    Err(e) => return Err(format!("keyring read failed: {e}")),
  };

  if api_key.trim().is_empty() {
    return Err(format!(
      "api key not found for provider={}; 请在“设置 > 模型配置”中填写 API Key",
      cfg.id
    ));
  }
  let base = cfg.base_url.trim_end_matches('/');
  let url = format!("{base}/chat/completions");
  let model = cfg.model_name.clone();
  let api_key = api_key.trim().to_string();

  let mut out_messages: Vec<serde_json::Value> = Vec::new();
  if !system_prompt.trim().is_empty() {
    out_messages.push(serde_json::json!({"role": "system", "content": system_prompt}));
  }
  out_messages.extend(messages.iter().map(|m| serde_json::json!({"role": m.role, "content": m.content})));

  let max_tokens = max_tokens_override.unwrap_or(32000);
  let temperature = temperature_override.unwrap_or(0.7);

  let send_once = |msgs: Vec<serde_json::Value>| {
    let url = url.clone();
    let model = model.clone();
    let api_key = api_key.clone();
    let client = client.clone();
    async move {
    let body = serde_json::json!({
      "model": model,
      "messages": msgs,
      "temperature": temperature,
      "max_tokens": max_tokens,
      "stream": false
    });
    let resp = client
      .post(url)
      .bearer_auth(api_key.as_str())
      .json(&body)
      .send()
      .await
      .map_err(|e| format!("request failed: {e}"))?;
    let status = resp.status();
    let value: serde_json::Value = resp.json().await.map_err(|e| format!("decode failed: {e}"))?;
    if !status.is_success() {
      return Err(format!("http {status}: {value}"));
    }
    let text = value["choices"][0]["message"]["content"]
      .as_str()
      .map(|s| s.to_string())
      .ok_or_else(|| "missing choices[0].message.content".to_string())?;
    let finish = value["choices"][0]["finish_reason"].as_str().map(|s| s.to_string());
    Ok::<(String, Option<String>), String>((text, finish))
    }
  };

  let (mut text, finish) = send_once(out_messages.clone()).await?;
  if finish.as_deref() == Some("length") {
    let mut cont = out_messages;
    cont.push(serde_json::json!({"role": "assistant", "content": text.clone()}));
    cont.push(serde_json::json!({"role": "user", "content": "继续（从上文末尾继续，不要重复已输出内容）"}));
    let (more, finish2) = send_once(cont).await?;
    if !more.trim().is_empty() {
      text.push_str(more.as_str());
    }
    if finish2.as_deref() == Some("length") {
      text.push_str("\n\n[输出可能因长度限制被截断，可回复“继续”]");
    }
  }
  Ok(text)
}

async fn call_anthropic(
  app: &AppHandle,
  client: &reqwest::Client,
  cfg: &app_settings::ModelProvider,
  messages: &[ChatMessage],
  system_prompt: &str,
  max_tokens_override: Option<u32>,
) -> Result<String, String> {
  let api_key = match secrets::get_api_key(app, &cfg.id) {
    Ok(Some(v)) => v,
    Ok(None) => cfg.api_key.trim().to_string(),
    Err(e) => return Err(format!("keyring read failed: {e}")),
  };
  if api_key.trim().is_empty() {
    return Err(format!(
      "api key not found for provider={}; 请在“设置 > 模型配置”中填写 API Key",
      cfg.id
    ));
  }
  let url = "https://api.anthropic.com/v1/messages";
  let body = serde_json::json!({
    "model": cfg.model_name,
    "max_tokens": max_tokens_override.unwrap_or(32000),
    "system": system_prompt,
    "messages": messages.iter().map(|m| serde_json::json!({"role": m.role, "content": m.content})).collect::<Vec<_>>()
  });

  let resp = client
    .post(url)
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
  value["content"][0]["text"]
    .as_str()
    .map(|s| s.to_string())
    .ok_or_else(|| "missing content[0].text".to_string())
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
      call_openai_compatible(
        &app,
        &client,
        current_provider,
        &messages,
        "",
        None,
        None
      ).await
    },
    app_settings::ProviderKind::Anthropic => {
      call_anthropic(
        &app,
        &client,
        current_provider,
        &messages,
        "",
        None
      ).await
    }
  }
}

#[tauri::command]
pub fn spec_kit_generate_outline(state: State<'_, AppState>) -> Result<spec_kit::StorySpec, String> {
  let root = get_workspace_root(&state)?;
  let novel_dir = root.join(".novel");
  spec_kit::ensure_spec_kit_defaults(&novel_dir)?;

  let config = spec_kit::load_config(&novel_dir)?;
  let template = spec_kit::load_story_template(&novel_dir, &config.story_type)?;
  let spec = spec_kit::generate_story_spec_from_config(&config, &template);

  let spec_path = novel_dir.join(".spec-kit").join("story_spec.json");
  let raw = serde_json::to_string_pretty(&spec).map_err(|e| format!("serialize story spec failed: {e}"))?;
  fs::write(spec_path, raw).map_err(|e| format!("write story spec failed: {e}"))?;

  let _ = append_spec_kit_log(
    &root,
    serde_json::json!({
      "ts": Utc::now().to_rfc3339(),
      "event": "generate_outline",
      "story_type": config.story_type,
      "chapter_count": spec.chapters.len()
    }),
  );

  Ok(spec)
}

#[tauri::command]
pub fn spec_kit_validate_story_spec(state: State<'_, AppState>) -> Result<spec_kit::ValidationReport, String> {
  let root = get_workspace_root(&state)?;
  let novel_dir = root.join(".novel");
  let config = spec_kit::load_config(&novel_dir).ok();

  let spec_path = novel_dir.join(".spec-kit").join("story_spec.json");
  let raw = fs::read_to_string(&spec_path).map_err(|e| format!("read story spec failed: {e}"))?;
  let spec: spec_kit::StorySpec = serde_json::from_str(&raw).map_err(|e| format!("parse story spec failed: {e}"))?;

  let mut report = spec_kit::validate_story_spec(&spec, config.as_ref());

  let outline_path = novel_dir.join(".cache").join("outline.json");
  if outline_path.exists() {
    if let Ok(outline_raw) = fs::read_to_string(&outline_path) {
      if let Err(msg) = validate_outline("", &outline_raw) {
        report.issues.push(spec_kit::ValidationIssue {
          severity: "error".to_string(),
          code: "timeline.conflict".to_string(),
          message: msg,
          path: ".novel/.cache/outline.json".to_string(),
        });
      }
    }
  }

  let err_count = report.issues.iter().filter(|i| i.severity == "error").count();
  let warn_count = report.issues.iter().filter(|i| i.severity == "warning").count();
  let _ = append_spec_kit_log(
    &root,
    serde_json::json!({
      "ts": Utc::now().to_rfc3339(),
      "event": "validate_story_spec",
      "errors": err_count,
      "warnings": warn_count
    }),
  );

  Ok(report)
}

#[tauri::command]
pub fn spec_kit_match_character_arcs(state: State<'_, AppState>) -> Result<spec_kit::ArcMap, String> {
  let root = get_workspace_root(&state)?;
  let novel_dir = root.join(".novel");

  let spec_path = novel_dir.join(".spec-kit").join("story_spec.json");
  let raw = fs::read_to_string(&spec_path).map_err(|e| format!("read story spec failed: {e}"))?;
  let mut spec: spec_kit::StorySpec = serde_json::from_str(&raw).map_err(|e| format!("parse story spec failed: {e}"))?;

  let arc_map = spec_kit::generate_arc_map_and_fill_defaults(&mut spec);

  let spec_raw = serde_json::to_string_pretty(&spec).map_err(|e| format!("serialize story spec failed: {e}"))?;
  fs::write(&spec_path, spec_raw).map_err(|e| format!("write story spec failed: {e}"))?;

  let arc_map_path = novel_dir.join(".spec-kit").join("arc_map.json");
  let arc_raw = serde_json::to_string_pretty(&arc_map).map_err(|e| format!("serialize arc map failed: {e}"))?;
  fs::write(arc_map_path, arc_raw).map_err(|e| format!("write arc map failed: {e}"))?;

  let _ = append_spec_kit_log(
    &root,
    serde_json::json!({
      "ts": Utc::now().to_rfc3339(),
      "event": "match_character_arcs",
      "characters": spec.characters.len()
    }),
  );

  Ok(arc_map)
}

#[tauri::command]
pub fn spec_kit_export_markdown(state: State<'_, AppState>) -> Result<String, String> {
  let root = get_workspace_root(&state)?;
  let (path, bytes) = spec_kit_export::export_markdown(&root)?;
  append_spec_kit_log(
    &root,
    serde_json::json!({
      "ts": Utc::now().to_rfc3339(),
      "event": "export_markdown",
      "path": path,
      "bytes": bytes
    }),
  )?;
  Ok(path)
}

#[tauri::command]
pub fn spec_kit_export_epub(state: State<'_, AppState>) -> Result<String, String> {
  let root = get_workspace_root(&state)?;
  let (path, bytes) = spec_kit_export::export_epub(&root)?;
  append_spec_kit_log(
    &root,
    serde_json::json!({
      "ts": Utc::now().to_rfc3339(),
      "event": "export_epub",
      "path": path,
      "bytes": bytes
    }),
  )?;
  Ok(path)
}

#[tauri::command]
pub fn spec_kit_export_pdf(state: State<'_, AppState>) -> Result<String, String> {
  let root = get_workspace_root(&state)?;
  let (path, bytes) = spec_kit_export::export_pdf(&root)?;
  append_spec_kit_log(
    &root,
    serde_json::json!({
      "ts": Utc::now().to_rfc3339(),
      "event": "export_pdf",
      "path": path,
      "bytes": bytes
    }),
  )?;
  Ok(path)
}

fn append_spec_kit_log(root: &Path, entry: serde_json::Value) -> Result<(), String> {
  let log_dir = root.join(".novel").join(".logs");
  fs::create_dir_all(&log_dir).map_err(|e| format!("create log dir failed: {e}"))?;
  let path = log_dir.join("spec_kit.jsonl");
  let mut line = entry.to_string();
  line.push('\n');
  fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)
    .and_then(|mut f| std::io::Write::write_all(&mut f, line.as_bytes()))
    .map_err(|e| format!("append log failed: {e}"))
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
pub fn get_skills() -> Vec<skills::Skill> {
    let manager = skills::SkillManager::new();
    manager.get_all().into_iter().cloned().collect()
}

#[tauri::command]
pub fn get_skill_categories() -> Vec<String> {
    let manager = skills::SkillManager::new();
    manager.categories()
}

#[tauri::command]
pub fn get_skills_by_category(category: String) -> Vec<skills::Skill> {
    let manager = skills::SkillManager::new();
    manager.get_by_category(&category).into_iter().cloned().collect()
}

#[tauri::command]
pub fn apply_skill(skill_id: String, content: String) -> String {
    let manager = skills::SkillManager::new();
    manager.apply_skill(&skill_id, &content)
}

// ============ Book Split Commands ============

use crate::book_split::{BookAnalysis, BookSplitConfig, BookSplitResult, ChapterInfo, CharacterInfo, SettingInfo, SplitChapter};

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
            for (i, c) in current_content.char().rev().enumerate() {
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
                summary: None,
            });
        }
    }
    
    let mut metadata = HashMap::new();
    metadata.insert("total_chapters".to_string(), chapters.len().to_string());
    metadata.insert("target_words_per_chapter".to_string(), target_words.to_string());
    
    Ok(BookSplitResult {
        original_title: title,
        chapters,
        metadata,
    })
}

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
