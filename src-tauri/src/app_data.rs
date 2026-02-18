use std::fs;
use std::path::PathBuf;
use std::env;

pub fn data_file_path(_app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
  // 使用当前工作目录下的 data 文件夹（便携式设计）
  let base = env::current_dir()
    .map_err(|e| format!("get current dir failed: {e}"))?;

  let data_dir = base.join("data");
  let new_path = data_dir.join(file_name);

  // 确保 data 目录存在
  if !data_dir.exists() {
    fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;
  }

  Ok(new_path)
}
