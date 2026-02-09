use crate::app_settings;
use crate::agents;
use crate::chat_history;
use crate::secrets;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::AppHandle;
use tauri::Emitter;
use tauri::State;

#[tauri::command]
pub fn ping() -> &'static str {
  "pong"
}

#[derive(Serialize)]
pub struct WorkspaceInfo {
  pub root: String,
}

#[tauri::command]
pub fn set_workspace(state: State<'_, AppState>, path: String) -> Result<WorkspaceInfo, String> {
  let root = canonicalize_path(Path::new(&path))?;
  *state.workspace_root.lock().map_err(|_| "workspace lock poisoned")? = Some(root.clone());
  Ok(WorkspaceInfo {
    root: root.to_string_lossy().to_string(),
  })
}

#[tauri::command]
pub fn init_novel(state: State<'_, AppState>) -> Result<(), String> {
  let root = get_workspace_root(&state)?;
  let novel_dir = root.join(".novel");

  let dirs = [
    root.join("concept"),
    root.join("outline"),
    root.join("stories"),
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

  let concept_readme = root.join("concept").join("README.md");
  if !concept_readme.exists() {
    fs::write(
      concept_readme,
      "# Concept\n\n在此目录放置世界观、人物、术语等设定文档（仅 .md）。\n",
    )
    .map_err(|e| format!("write concept readme failed: {e}"))?;
  }

  let characters_md = root.join("concept").join("characters.md");
  if !characters_md.exists() {
    fs::write(characters_md, "# Characters\n\n- 主角\n- 配角\n").map_err(|e| format!("write characters.md failed: {e}"))?;
  }

  let relations_md = root.join("concept").join("relations.md");
  if !relations_md.exists() {
    fs::write(relations_md, "# Relations\n\n主角 -> 配角 : 关系\n").map_err(|e| format!("write relations.md failed: {e}"))?;
  }

  let outline_md = root.join("outline").join("outline.md");
  if !outline_md.exists() {
    fs::write(outline_md, "# Outline\n\n- 第1章：\n- 第2章：\n").map_err(|e| format!("write outline.md failed: {e}"))?;
  }

  let stories_readme = root.join("stories").join("README.md");
  if !stories_readme.exists() {
    fs::write(stories_readme, "# Stories\n\n在此目录放置章节正文（仅 .md）。\n").map_err(|e| format!("write stories readme failed: {e}"))?;
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

  if (rel_norm.starts_with("concept/") || rel_norm.starts_with("outline/") || rel_norm.starts_with("stories/"))
    && !rel_norm.to_lowercase().ends_with(".md")
  {
    return Err("concept/outline/stories 目录仅允许写入 .md 文件".to_string());
  }

  if rel_norm == ".novel/.cache/outline.json" {
    let existing = if target.exists() {
      fs::read_to_string(&target).unwrap_or_default()
    } else {
      String::new()
    };
    validate_outline(&existing, &content)?;
  }

  if let Some(parent) = target.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
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
  let rel_norm = relative_path.replace('\\', "/");
  if (rel_norm.starts_with("concept/") || rel_norm.starts_with("outline/") || rel_norm.starts_with("stories/"))
    && !rel_norm.to_lowercase().ends_with(".md")
  {
    return Err("concept/outline/stories 目录仅允许创建 .md 文件".to_string());
  }
  let target = root.join(rel);
  if let Some(parent) = target.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create dir failed: {e}"))?;
  }
  fs::write(target, "").map_err(|e| format!("create file failed: {e}"))
}

#[tauri::command]
pub fn get_app_settings(app: AppHandle) -> Result<app_settings::AppSettings, String> {
  let mut s = app_settings::load(&app)?;
  s.providers.openai.api_key.clear();
  s.providers.claude.api_key.clear();
  s.providers.wenxin.api_key.clear();
  Ok(s)
}

#[tauri::command]
pub fn set_app_settings(app: AppHandle, settings: app_settings::AppSettings) -> Result<(), String> {
  let mut s = settings.clone();
  if !s.providers.openai.api_key.trim().is_empty() {
    secrets::set_api_key("openai", s.providers.openai.api_key.trim())?;
    s.providers.openai.api_key.clear();
  }
  if !s.providers.claude.api_key.trim().is_empty() {
    secrets::set_api_key("claude", s.providers.claude.api_key.trim())?;
    s.providers.claude.api_key.clear();
  }
  if !s.providers.wenxin.api_key.trim().is_empty() {
    secrets::set_api_key("wenxin", s.providers.wenxin.api_key.trim())?;
    s.providers.wenxin.api_key.clear();
  }
  app_settings::save(&app, &s)
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
    .or_else(|_| git2::Signature::now("Novel-IDE", "novel-ide@local"))
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

#[derive(Deserialize)]
pub struct ChatMessage {
  pub role: String,
  pub content: String,
}

#[tauri::command]
pub fn chat_generate_stream(
  app: AppHandle,
  window: tauri::Window,
  stream_id: String,
  messages: Vec<ChatMessage>,
  use_markdown: bool,
  agent_id: Option<String>,
) -> Result<(), String> {
  let app = app.clone();
  let last_user = messages
    .iter()
    .rev()
    .find(|m| m.role == "user")
    .map(|m| m.content.clone())
    .unwrap_or_default();

  tauri::async_runtime::spawn(async move {
    let payload_start = serde_json::json!({ "streamId": stream_id });
    let _ = window.emit("ai_stream_start", payload_start);

    let settings = app_settings::load(&app).unwrap_or_default();
    let effective_use_markdown = use_markdown || settings.output.use_markdown;
    let agents_list = agents::load(&app).unwrap_or_else(|_| agents::default_agents());
    let effective_agent_id = agent_id.unwrap_or_else(|| settings.active_agent_id.clone());
    let agent = agents_list.iter().find(|a| a.id == effective_agent_id);
    let agent_system = agent.map(|a| a.system_prompt.clone()).unwrap_or_default();
    let agent_temp = agent.map(|a| a.temperature);
    let agent_max = agent.map(|a| a.max_tokens);
    let client = reqwest::Client::new();

    let mut response = match settings.providers.active.as_str() {
      "openai" => {
        call_openai_compatible(
          &client,
          "openai",
          &settings.providers.openai,
          &messages,
          agent_system.as_str(),
          agent_temp,
          agent_max,
        )
        .await
      }
      "wenxin" => {
        call_openai_compatible(
          &client,
          "wenxin",
          &settings.providers.wenxin,
          &messages,
          agent_system.as_str(),
          agent_temp,
          agent_max,
        )
        .await
      }
      "claude" => call_anthropic(&client, "claude", &settings.providers.claude, &messages, agent_system.as_str(), agent_max).await,
      _ => Err("unknown provider".to_string()),
    }
    .unwrap_or_else(|e| format!("模拟回复：{last_user}\n调用失败：{e}"));

    if !effective_use_markdown {
      response = normalize_plaintext(&response);
    }

    let mut offset = 0usize;
    let step = 24usize;
    let bytes = response.as_bytes();
    while offset < bytes.len() {
      let end = std::cmp::min(offset + step, bytes.len());
      let token = String::from_utf8_lossy(&bytes[offset..end]).to_string();
      let payload = serde_json::json!({ "streamId": stream_id, "token": token });
      let _ = window.emit("ai_stream_token", payload);
      offset = end;
      tokio::time::sleep(std::time::Duration::from_millis(15)).await;
    }

    let payload_done = serde_json::json!({ "streamId": stream_id });
    let _ = window.emit("ai_stream_done", payload_done);
  });

  Ok(())
}

async fn call_openai_compatible(
  client: &reqwest::Client,
  secret_name: &str,
  cfg: &app_settings::OpenAiSettings,
  messages: &[ChatMessage],
  system_prompt: &str,
  temperature_override: Option<f32>,
  max_tokens_override: Option<u32>,
) -> Result<String, String> {
  let api_key = secrets::get_api_key(secret_name)
    .ok()
    .flatten()
    .unwrap_or_else(|| cfg.api_key.trim().to_string());
  if api_key.trim().is_empty() {
    return Err("api key is empty".to_string());
  }
  let base = cfg.base_url.trim_end_matches('/');
  let url = format!("{base}/chat/completions");

  let mut out_messages: Vec<serde_json::Value> = Vec::new();
  if !system_prompt.trim().is_empty() {
    out_messages.push(serde_json::json!({"role": "system", "content": system_prompt}));
  }
  out_messages.extend(messages.iter().map(|m| serde_json::json!({"role": m.role, "content": m.content})));

  let body = serde_json::json!({
    "model": cfg.model,
    "messages": out_messages,
    "temperature": temperature_override.unwrap_or(cfg.temperature),
    "max_tokens": max_tokens_override.unwrap_or(cfg.max_tokens),
    "stream": false
  });

  let resp = client
    .post(url)
    .bearer_auth(api_key.trim())
    .json(&body)
    .send()
    .await
    .map_err(|e| format!("request failed: {e}"))?;

  let status = resp.status();
  let value: serde_json::Value = resp.json().await.map_err(|e| format!("decode failed: {e}"))?;
  if !status.is_success() {
    return Err(format!("http {status}: {value}"));
  }
  value["choices"][0]["message"]["content"]
    .as_str()
    .map(|s| s.to_string())
    .ok_or_else(|| "missing choices[0].message.content".to_string())
}

async fn call_anthropic(
  client: &reqwest::Client,
  secret_name: &str,
  cfg: &app_settings::AnthropicSettings,
  messages: &[ChatMessage],
  system_prompt: &str,
  max_tokens_override: Option<u32>,
) -> Result<String, String> {
  let api_key = secrets::get_api_key(secret_name)
    .ok()
    .flatten()
    .unwrap_or_else(|| cfg.api_key.trim().to_string());
  if api_key.trim().is_empty() {
    return Err("api key is empty".to_string());
  }
  let url = "https://api.anthropic.com/v1/messages";
  let body = serde_json::json!({
    "model": cfg.model,
    "max_tokens": max_tokens_override.unwrap_or(cfg.max_tokens),
    "system": system_prompt,
    "messages": messages
      .iter()
      .filter(|m| m.role == "user" || m.role == "assistant")
      .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
      .collect::<Vec<_>>()
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

fn validate_relative_path(relative_path: &str) -> Result<PathBuf, String> {
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

fn update_concept_index(root: &Path, rel_path: &str, content: &str) -> Result<(), String> {
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

fn validate_outline(existing_json: &str, new_json: &str) -> Result<(), String> {
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
    .to_string();

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
