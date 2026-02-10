use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone)]
pub struct ChatMessage {
  pub role: String,
  pub content: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[allow(dead_code)]
pub struct SelectionInfo {
  pub file_path: String,
  pub start_line: u32,
  pub end_line: u32,
  pub selected_text: String,
}

