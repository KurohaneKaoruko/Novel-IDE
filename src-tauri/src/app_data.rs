use std::env;
use std::fs;
use std::path::PathBuf;

pub fn data_file_path(_app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let cwd = env::current_dir().map_err(|e| format!("get current dir failed: {e}"))?;

  // In `tauri dev`, cwd is usually `<repo>/src-tauri`.
  // Writing runtime files there triggers Tauri source watching and causes rebuild loops.
  // Store runtime data at project root instead.
  let (data_dir, legacy_dir): (PathBuf, Option<PathBuf>) = match cwd.file_name().and_then(|v| v.to_str()) {
    Some("src-tauri") => {
      let project_root = cwd
        .parent()
        .ok_or_else(|| "resolve project root from src-tauri cwd failed".to_string())?
        .to_path_buf();
      (project_root.join(".runtime-data"), Some(cwd.join("data")))
    }
    _ => (cwd.join("data"), None),
  };

  if !data_dir.exists() {
    fs::create_dir_all(&data_dir).map_err(|e| format!("create data dir failed: {e}"))?;
  }

  let path = data_dir.join(file_name);

  // One-time migration from legacy dev path (`src-tauri/data/<file>`).
  if !path.exists() {
    if let Some(legacy) = legacy_dir {
      let old_path = legacy.join(file_name);
      if old_path.exists() {
        fs::copy(&old_path, &path).map_err(|e| format!("migrate data file failed: {e}"))?;
      }
    }
  }

  Ok(path)
}
