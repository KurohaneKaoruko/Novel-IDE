use std::fs;
use std::path::PathBuf;

pub fn data_file_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let data_dir = storage_dir(app, "data")?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

pub fn config_file_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let data_dir = storage_dir(app, "config")?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

pub fn state_file_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let data_dir = storage_dir(app, "state")?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create state dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

pub fn secrets_file_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let data_dir = storage_dir(app, "secrets")?;
  fs::create_dir_all(&data_dir).map_err(|e| format!("create secrets dir failed: {e}"))?;
  Ok(data_dir.join(file_name))
}

fn storage_dir(app: &tauri::AppHandle, category: &str) -> Result<PathBuf, String> {
  Ok(storage_root_dir(app)?.join(category))
}

fn storage_root_dir(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let exe_path = std::env::current_exe().map_err(|e| format!("resolve current exe failed: {e}"))?;
  let exe_dir = exe_path
    .parent()
    .ok_or_else(|| "resolve executable directory failed".to_string())?;
  Ok(exe_dir.to_path_buf())
}
