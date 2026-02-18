use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn data_file_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
  // 使用 exe 所在目录而不是 AppData 目录
  let base = app
    .path()
    .executable_dir()
    .map_err(|e| format!("exe dir failed: {e}"))?;

  let data_dir = base.join("data");
  let new_path = data_dir.join(file_name);

  // 确保 data 目录存在
  if !data_dir.exists() {
    fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;
  }

  Ok(new_path)
}
