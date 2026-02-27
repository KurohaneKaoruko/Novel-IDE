use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub fn data_file_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("resolve app data dir failed: {e}"))?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

pub fn config_file_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("resolve app data dir failed: {e}"))?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}
