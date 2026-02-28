use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::async_runtime::JoinHandle;

pub struct AppState {
  pub workspace_root: Mutex<Option<PathBuf>>,
  pub fs_watcher: Mutex<Option<notify::RecommendedWatcher>>,
  pub ai_stream_tasks: Mutex<HashMap<String, JoinHandle<()>>>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      workspace_root: Mutex::new(None),
      fs_watcher: Mutex::new(None),
      ai_stream_tasks: Mutex::new(HashMap::new()),
    }
  }
}
