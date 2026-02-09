use crate::ai_types::ChatMessage;
use crate::commands;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Clone)]
pub struct ToolContext {
  pub workspace_root: PathBuf,
}

pub type ToolFn = Box<dyn Fn(&ToolContext, Value) -> Result<Value, String> + Send + Sync>;

pub struct ToolRegistry {
  tools: HashMap<String, ToolFn>,
}

impl ToolRegistry {
  pub fn new() -> Self {
    Self { tools: HashMap::new() }
  }

  pub fn register<F>(&mut self, name: &str, f: F)
  where
    F: Fn(&ToolContext, Value) -> Result<Value, String> + Send + Sync + 'static,
  {
    self.tools.insert(name.to_string(), Box::new(f));
  }

  pub fn call(&self, ctx: &ToolContext, name: &str, args: Value) -> Result<Value, String> {
    let f = self.tools.get(name).ok_or_else(|| format!("unknown tool: {name}"))?;
    f(ctx, args)
  }

  pub fn list(&self) -> Vec<String> {
    let mut out = self.tools.keys().cloned().collect::<Vec<_>>();
    out.sort();
    out
  }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct MemoryItem {
  pub key: String,
  pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct MemoryStoreData {
  pub long_term: Vec<MemoryItem>,
}

pub struct MemoryStore {
  path: PathBuf,
  data: MemoryStoreData,
}

impl MemoryStore {
  pub fn load(workspace_root: &Path) -> Self {
    let path = workspace_root.join(".novel").join(".cache").join("agent_memory.json");
    let data = fs::read_to_string(&path)
      .ok()
      .and_then(|raw| serde_json::from_str::<MemoryStoreData>(&raw).ok())
      .unwrap_or_default();
    Self { path, data }
  }

  pub fn save(&self) -> Result<(), String> {
    if let Some(parent) = self.path.parent() {
      fs::create_dir_all(parent).map_err(|e| format!("create memory dir failed: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(&self.data).map_err(|e| format!("serialize memory failed: {e}"))?;
    fs::write(&self.path, raw).map_err(|e| format!("write memory failed: {e}"))
  }

  pub fn upsert(&mut self, key: &str, value: &str) {
    if let Some(it) = self.data.long_term.iter_mut().find(|x| x.key == key) {
      it.value = value.to_string();
      return;
    }
    self.data.long_term.push(MemoryItem {
      key: key.to_string(),
      value: value.to_string(),
    });
  }

  pub fn search(&self, query: &str, limit: usize) -> Vec<MemoryItem> {
    let q = query.to_lowercase();
    self.data
      .long_term
      .iter()
      .filter(|it| it.key.to_lowercase().contains(&q) || it.value.to_lowercase().contains(&q))
      .take(limit)
      .cloned()
      .collect()
  }

  pub fn render(&self, limit: usize) -> String {
    let mut out = String::new();
    for it in self.data.long_term.iter().take(limit) {
      out.push_str("- ");
      out.push_str(it.key.trim());
      out.push_str(": ");
      out.push_str(it.value.trim());
      out.push('\n');
    }
    out.trim().to_string()
  }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AgentPerf {
  pub steps: u32,
  pub model_ms: u128,
  pub tool_ms: u128,
}

pub struct AgentRuntime {
  ctx: ToolContext,
  tools: ToolRegistry,
  memory: MemoryStore,
}

impl AgentRuntime {
  pub fn new(workspace_root: PathBuf) -> Self {
    let ctx = ToolContext {
      workspace_root: workspace_root.clone(),
    };
    let memory = MemoryStore::load(&workspace_root);
    let mut tools = ToolRegistry::new();
    tools.register("fs_read_text", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      let raw = fs::read_to_string(target).map_err(|e| format!("read failed: {e}"))?;
      Ok(serde_json::json!({ "text": raw }))
    });
    tools.register("fs_list_dir", |ctx, args| {
      let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
      let rel = if path.trim().is_empty() {
        PathBuf::from("")
      } else {
        commands::validate_relative_path(path)?
      };
      let target = ctx.workspace_root.join(rel);
      let mut items: Vec<Value> = Vec::new();
      for e in fs::read_dir(target).map_err(|e| format!("read dir failed: {e}"))? {
        let e = e.map_err(|e| format!("read entry failed: {e}"))?;
        let p = e.path();
        let name = p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let kind = if p.is_dir() { "dir" } else { "file" };
        items.push(serde_json::json!({ "name": name, "kind": kind }));
      }
      Ok(serde_json::json!({ "items": items }))
    });
    tools.register("fs_exists", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      let md = match fs::metadata(&target) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
          return Ok(serde_json::json!({ "exists": false }))
        }
        Err(e) => return Err(format!("stat failed: {e}")),
      };
      let kind = if md.is_dir() { "dir" } else { "file" };
      Ok(serde_json::json!({ "exists": true, "kind": kind }))
    });
    tools.register("fs_create_dir", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      fs::create_dir_all(&target).map_err(|e| format!("create dir failed: {e}"))?;
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("fs_create_file", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel_norm = path.replace('\\', "/");
      if (rel_norm.starts_with("concept/") || rel_norm.starts_with("outline/") || rel_norm.starts_with("stories/"))
        && !rel_norm.to_lowercase().ends_with(".md")
      {
        return Err("concept/outline/stories 目录仅允许 .md 文件".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      if let Some(parent) = target.parent() {
        if !parent.exists() {
          return Err("parent directory does not exist; create it first".to_string());
        }
      }
      if !target.exists() {
        fs::write(&target, "").map_err(|e| format!("create file failed: {e}"))?;
      }
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("fs_delete_entry", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      if !target.exists() {
        return Ok(serde_json::json!({ "ok": true }));
      }
      let md = fs::metadata(&target).map_err(|e| format!("stat failed: {e}"))?;
      if md.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("remove dir failed: {e}"))?;
      } else {
        fs::remove_file(&target).map_err(|e| format!("remove file failed: {e}"))?;
      }
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("fs_rename_entry", |ctx, args| {
      let from = args
        .get("from")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.from".to_string())?;
      let to = args
        .get("to")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.to".to_string())?;
      if from.trim().is_empty() || to.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let to_norm = to.replace('\\', "/");
      if (to_norm.starts_with("concept/") || to_norm.starts_with("outline/") || to_norm.starts_with("stories/"))
        && !to_norm.to_lowercase().ends_with(".md")
      {
        return Err("concept/outline/stories 目录仅允许 .md 文件".to_string());
      }
      let from_rel = commands::validate_relative_path(from)?;
      let to_rel = commands::validate_relative_path(to)?;
      let from_abs = ctx.workspace_root.join(from_rel);
      let to_abs = ctx.workspace_root.join(to_rel);
      if let Some(parent) = to_abs.parent() {
        if !parent.exists() {
          return Err("parent directory does not exist; create it first".to_string());
        }
      }
      fs::rename(from_abs, to_abs).map_err(|e| format!("rename failed: {e}"))?;
      Ok(serde_json::json!({ "ok": true }))
    });
    tools.register("fs_write_text", |ctx, args| {
      let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing args.path".to_string())?;
      let text = args
        .get("text")
        .or_else(|| args.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
      if path.trim().is_empty() {
        return Err("empty path".to_string());
      }
      let rel_norm = path.replace('\\', "/");
      if (rel_norm.starts_with("concept/") || rel_norm.starts_with("outline/") || rel_norm.starts_with("stories/"))
        && !rel_norm.to_lowercase().ends_with(".md")
      {
        return Err("concept/outline/stories 目录仅允许写入 .md 文件".to_string());
      }
      let rel = commands::validate_relative_path(path)?;
      let target = ctx.workspace_root.join(rel);
      if rel_norm == ".novel/.cache/outline.json" {
        let existing = if target.exists() {
          fs::read_to_string(&target).unwrap_or_default()
        } else {
          String::new()
        };
        commands::validate_outline(&existing, text)?;
      }
      if let Some(parent) = target.parent() {
        if !parent.exists() {
          return Err("parent directory does not exist; create it first".to_string());
        }
      }
      fs::write(&target, text).map_err(|e| format!("write failed: {e}"))?;
      if rel_norm.starts_with("concept/") && rel_norm.to_lowercase().ends_with(".md") {
        commands::update_concept_index(&ctx.workspace_root, &rel_norm, text)?;
      }
      Ok(serde_json::json!({ "ok": true }))
    });
    Self { ctx, tools, memory }
  }

  pub fn tools(&self) -> Vec<String> {
    let mut out = self.tools.list();
    out.push("memory_upsert".to_string());
    out.push("memory_search".to_string());
    out.sort();
    out
  }

  pub async fn run_react<F, Fut>(
    &mut self,
    base_messages: Vec<ChatMessage>,
    agent_system_prompt: String,
    call_model: F,
  ) -> Result<(String, AgentPerf), String>
  where
    F: Fn(Vec<ChatMessage>) -> Fut,
    Fut: Future<Output = Result<String, String>>,
  {
    let mut perf = AgentPerf::default();
    let tool_list = self.tools();
    let memory_text = self.memory.render(50);
    let mut messages: Vec<ChatMessage> = Vec::new();
    let react_prompt = format!(
      "{sys}\n\n可用工具：{tools}\n\n当你需要调用工具时，严格使用三行格式：\\nACTION: tool_name\\nINPUT: {{...json...}}\\n然后等待 OBSERVATION。若无需工具，直接给出最终回答。\n\n文件系统规则：\n1) 所有 path 必须是相对路径，禁止绝对路径与 ..。\n2) 写文件不会自动创建父目录；若目录不存在，先用 fs_exists 检查，再用 fs_create_dir 创建。\n3) concept/、outline/、stories/ 下仅允许 .md 文件。",
      sys = agent_system_prompt.trim(),
      tools = tool_list.join(", ")
    );
    messages.push(ChatMessage {
      role: "system".to_string(),
      content: if memory_text.is_empty() {
        react_prompt
      } else {
        format!("{react_prompt}\n\n长期记忆：\n{memory_text}")
      },
    });
    messages.extend(base_messages);
    let mut step = 0u32;
    let max_steps = 10u32;
    loop {
      if step >= max_steps {
        let last = messages
          .iter()
          .rev()
          .find(|m| m.role == "assistant")
          .map(|m| m.content.clone())
          .unwrap_or_default();
        if parse_tool_call(&last).is_some() {
          return Ok((
            "已多次执行工具调用，但模型未输出最终回答。你可以让 AI 用一句话总结刚才的改动，或直接查看文件树确认结果。".to_string(),
            perf,
          ));
        }
        return Ok((last, perf));
      }
      step += 1;
      perf.steps = step;
      let t0 = Instant::now();
      let out = call_model(messages.clone()).await?;
      perf.model_ms += t0.elapsed().as_millis();
      if let Some(call) = parse_tool_call(&out) {
        let t1 = Instant::now();
        let result = if call.tool == "memory_upsert" {
          let key = call
            .args
            .get("key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing args.key".to_string())
            .and_then(|s| if s.trim().is_empty() { Err("empty args.key".to_string()) } else { Ok(s) });
          let value = call
            .args
            .get("value")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing args.value".to_string());
          match (key, value) {
            (Ok(k), Ok(v)) => {
              self.memory.upsert(k, v);
              let _ = self.memory.save();
              Ok(serde_json::json!({ "ok": true }))
            }
            (Err(e), _) | (_, Err(e)) => Err(e),
          }
        } else if call.tool == "memory_search" {
          let query = call
            .args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "missing args.query".to_string())?;
          let limit = call.args.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;
          let hits = self.memory.search(query, limit);
          Ok(serde_json::to_value(hits).unwrap_or_else(|_| serde_json::json!([])))
        } else {
          self.tools.call(&self.ctx, &call.tool, call.args.clone())
        };
        perf.tool_ms += t1.elapsed().as_millis();
        let obs = match result {
          Ok(v) => v,
          Err(e) => serde_json::json!({ "error": e }),
        };
        let obs_text = serde_json::to_string_pretty(&obs).unwrap_or_else(|_| obs.to_string());
        messages.push(ChatMessage {
          role: "assistant".to_string(),
          content: out,
        });
        messages.push(ChatMessage {
          role: "user".to_string(),
          content: format!("OBSERVATION:\n{obs_text}"),
        });
        continue;
      }
      return Ok((out, perf));
    }
  }
}

#[derive(Clone)]
pub struct ParsedToolCall {
  pub tool: String,
  pub args: Value,
}

fn extract_json_value(input: &str) -> Option<String> {
  let s = input.trim();
  let start = s.find('{').or_else(|| s.find('['))?;
  let bytes = s.as_bytes();
  let mut i = start;
  let mut depth_brace = 0i32;
  let mut depth_bracket = 0i32;
  let mut in_string = false;
  let mut escape = false;
  while i < bytes.len() {
    let ch = bytes[i] as char;
    if in_string {
      if escape {
        escape = false;
      } else if ch == '\\' {
        escape = true;
      } else if ch == '"' {
        in_string = false;
      }
      i += 1;
      continue;
    }
    match ch {
      '"' => in_string = true,
      '{' => depth_brace += 1,
      '}' => {
        depth_brace -= 1;
        if depth_brace == 0 && depth_bracket == 0 {
          return Some(s[start..=i].to_string());
        }
      }
      '[' => depth_bracket += 1,
      ']' => {
        depth_bracket -= 1;
        if depth_brace == 0 && depth_bracket == 0 {
          return Some(s[start..=i].to_string());
        }
      }
      _ => {}
    }
    i += 1;
  }
  None
}

pub fn parse_tool_call(text: &str) -> Option<ParsedToolCall> {
  let mut tool: Option<String> = None;
  let mut input_joined: Option<String> = None;
  let mut collecting_input = false;
  for line in text.lines() {
    let t = line.trim_end();
    if t.trim_start().to_ascii_uppercase().starts_with("ACTION:") {
      tool = Some(t.splitn(2, ':').nth(1)?.trim().to_string());
      continue;
    }
    if t.trim_start().to_ascii_uppercase().starts_with("INPUT:") {
      collecting_input = true;
      let rest = t.splitn(2, ':').nth(1)?.trim().to_string();
      input_joined = Some(rest);
      continue;
    }
    if collecting_input {
      input_joined = Some(match input_joined {
        Some(mut v) => {
          v.push('\n');
          v.push_str(t);
          v
        }
        None => t.to_string(),
      });
    }
  }
  let tool = tool?;
  let input = input_joined?;
  let json_text = extract_json_value(&input).unwrap_or_else(|| input.trim().to_string());
  let args: Value = serde_json::from_str(&json_text)
    .ok()
    .or_else(|| Some(serde_json::json!({ "raw": input.trim() })))?;
  Some(ParsedToolCall { tool, args })
}

#[allow(dead_code)]
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct SkillDefinition {
  pub id: String,
  pub name: String,
  pub system_prompt: String,
}

#[allow(dead_code)]
pub fn default_skills() -> Vec<SkillDefinition> {
  vec![
    SkillDefinition {
      id: "writing.outline".to_string(),
      name: "生成章节大纲".to_string(),
      system_prompt: "你是写作教练，产出结构清晰的章节大纲，并给出关键冲突与转折。".to_string(),
    },
    SkillDefinition {
      id: "writing.polish".to_string(),
      name: "润色改写".to_string(),
      system_prompt: "你是文字编辑，在不改变含义的前提下优化表达、节奏与语气。".to_string(),
    },
  ]
}

#[allow(dead_code)]
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct McpKnowledgeItem {
  pub id: String,
  pub kind: String,
  pub content: String,
}

#[allow(dead_code)]
#[derive(Default)]
pub struct McpBroker {
  items: HashMap<String, McpKnowledgeItem>,
}

#[allow(dead_code)]
impl McpBroker {
  pub fn upsert(&mut self, item: McpKnowledgeItem) {
    self.items.insert(item.id.clone(), item);
  }

  pub fn list(&self, limit: usize) -> Vec<McpKnowledgeItem> {
    self.items.values().take(limit).cloned().collect()
  }
}
