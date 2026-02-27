use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

use crate::app_data;
use crate::secrets;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
  pub output: OutputSettings,
  pub providers: Vec<ModelProvider>,
  pub active_provider_id: String,
  pub active_agent_id: String,
  pub launch_mode: LaunchMode,
  pub ai_edit_apply_mode: AiEditApplyMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LaunchMode {
  Picker,
  AutoLast,
}

impl Default for LaunchMode {
  fn default() -> Self {
    Self::Picker
  }
}

impl Default for AppSettings {
  fn default() -> Self {
    let providers = vec![
      ModelProvider {
        id: "openai".to_string(),
        name: "OpenAI".to_string(),
        kind: ProviderKind::OpenAI,
        api_key: String::new(),
        base_url: "https://api.openai.com/v1".to_string(),
        model_name: "gpt-4o-mini".to_string(),
      },
      ModelProvider {
        id: "claude".to_string(),
        name: "Claude".to_string(),
        kind: ProviderKind::Anthropic,
        api_key: String::new(),
        base_url: "https://api.anthropic.com".to_string(),
        model_name: "claude-3-5-sonnet-20241022".to_string(),
      },
      ModelProvider {
        id: "deepseek".to_string(),
        name: "DeepSeek".to_string(),
        kind: ProviderKind::OpenAICompatible,
        api_key: String::new(),
        base_url: "https://api.deepseek.com".to_string(),
        model_name: "deepseek-chat".to_string(),
      },
    ];
    Self {
      output: OutputSettings::default(),
      providers,
      active_provider_id: "openai".to_string(),
      active_agent_id: "fantasy".to_string(),
      launch_mode: LaunchMode::default(),
      ai_edit_apply_mode: AiEditApplyMode::default(),
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AiEditApplyMode {
  AutoApply,
  Review,
}

impl Default for AiEditApplyMode {
  fn default() -> Self {
    Self::AutoApply
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct OutputSettings {
  pub use_markdown: bool,
}

impl Default for OutputSettings {
  fn default() -> Self {
    Self { use_markdown: false }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelProvider {
  pub id: String,
  pub name: String,
  pub kind: ProviderKind,
  pub api_key: String,
  pub base_url: String,
  pub model_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ProviderKind {
  OpenAI,
  Anthropic,
  OpenAICompatible, // For Ollama, DeepSeek, etc.
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
struct LegacyAppSettings {
  pub output: OutputSettings,
  pub providers: LegacyProvidersSettings,
  pub active_agent_id: String,
}

impl Default for LegacyAppSettings {
  fn default() -> Self {
    Self {
      output: OutputSettings::default(),
      providers: LegacyProvidersSettings::default(),
      active_agent_id: "fantasy".to_string(),
    }
  }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
struct LegacyProvidersSettings {
  pub active: String,
  pub openai: LegacyOpenAiSettings,
  pub claude: LegacyAnthropicSettings,
  pub wenxin: LegacyOpenAiSettings,
}

impl Default for LegacyProvidersSettings {
  fn default() -> Self {
    Self {
      active: "openai".to_string(),
      openai: LegacyOpenAiSettings::default(),
      claude: LegacyAnthropicSettings::default(),
      wenxin: LegacyOpenAiSettings::default(),
    }
  }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
struct LegacyOpenAiSettings {
  pub api_key: String,
  pub base_url: String,
  pub model: String,
  pub temperature: f32,
  pub max_tokens: u32,
}

impl Default for LegacyOpenAiSettings {
  fn default() -> Self {
    Self {
      api_key: String::new(),
      base_url: "https://api.openai.com/v1".to_string(),
      model: "gpt-4o-mini".to_string(),
      temperature: 0.7,
      max_tokens: 32000,
    }
  }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
struct LegacyAnthropicSettings {
  pub api_key: String,
  pub model: String,
  pub max_tokens: u32,
}

impl Default for LegacyAnthropicSettings {
  fn default() -> Self {
    Self {
      api_key: String::new(),
      model: "claude-3-5-sonnet-20241022".to_string(),
      max_tokens: 32000,
    }
  }
}

fn ensure_sane(mut s: AppSettings) -> AppSettings {
  if s.providers.is_empty() {
    s.providers = AppSettings::default().providers;
  }
  if s.active_provider_id.trim().is_empty() || !s.providers.iter().any(|p| p.id == s.active_provider_id) {
    s.active_provider_id = s.providers[0].id.clone();
  }
  s
}

pub fn load(app: &tauri::AppHandle) -> Result<AppSettings, String> {
  let path = settings_path(app)?;
  if !path.exists() {
    return Ok(ensure_sane(AppSettings::default()));
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read settings failed: {e}"))?;
  match serde_json::from_str::<AppSettings>(&raw) {
    Ok(v) => Ok(ensure_sane(v)),
    Err(new_err) => match serde_json::from_str::<LegacyAppSettings>(&raw) {
      Ok(legacy) => {
        let mut providers = vec![
          ModelProvider {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            kind: ProviderKind::OpenAI,
            api_key: legacy.providers.openai.api_key.clone(),
            base_url: legacy.providers.openai.base_url.clone(),
            model_name: legacy.providers.openai.model.clone(),
          },
          ModelProvider {
            id: "claude".to_string(),
            name: "Claude".to_string(),
            kind: ProviderKind::Anthropic,
            api_key: legacy.providers.claude.api_key.clone(),
            base_url: "https://api.anthropic.com".to_string(),
            model_name: legacy.providers.claude.model.clone(),
          },
          ModelProvider {
            id: "wenxin".to_string(),
            name: "文心一言".to_string(),
            kind: ProviderKind::OpenAICompatible,
            api_key: legacy.providers.wenxin.api_key.clone(),
            base_url: legacy.providers.wenxin.base_url.clone(),
            model_name: legacy.providers.wenxin.model.clone(),
          },
        ];
        if !providers.iter().any(|p| p.id == "deepseek") {
          providers.push(ModelProvider {
            id: "deepseek".to_string(),
            name: "DeepSeek".to_string(),
            kind: ProviderKind::OpenAICompatible,
            api_key: String::new(),
            base_url: "https://api.deepseek.com".to_string(),
            model_name: "deepseek-chat".to_string(),
          });
        }

        let mut migrated = AppSettings {
          output: legacy.output,
          providers,
          active_provider_id: legacy.providers.active,
          active_agent_id: legacy.active_agent_id,
          launch_mode: LaunchMode::default(),
          ai_edit_apply_mode: AiEditApplyMode::default(),
        };
        migrated = ensure_sane(migrated);

        for p in &mut migrated.providers {
          if !p.api_key.trim().is_empty() {
            secrets::set_api_key(app, &p.id, p.api_key.trim())?;
            p.api_key.clear();
          }
        }
        let _ = save(app, &migrated);
        Ok(migrated)
      }
      Err(_) => Err(format!("parse settings failed: {new_err}")),
    },
  }
}

pub fn save(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
  let path = settings_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create settings dir failed: {e}"))?;
  }
  let raw = serde_json::to_string_pretty(settings).map_err(|e| format!("serialize settings failed: {e}"))?;
  fs::write(path, raw).map_err(|e| format!("write settings failed: {e}"))
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  app_data::config_file_path(app, "settings.json")
}
