use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
pub struct AgentPromptConfig {
  pub builtin_workflow_appendix: String,
  pub runtime_prompt_template: String,
  pub mode_auto_apply: String,
  pub mode_review: String,
}

const AGENT_PROMPTS_RAW: &str = include_str!("../config/agent_prompts.toml");
static AGENT_PROMPTS: OnceLock<AgentPromptConfig> = OnceLock::new();

pub fn agent_prompts() -> &'static AgentPromptConfig {
  AGENT_PROMPTS.get_or_init(|| {
    toml::from_str(AGENT_PROMPTS_RAW)
      .unwrap_or_else(|e| panic!("parse agent prompt config failed: {e}"))
  })
}
