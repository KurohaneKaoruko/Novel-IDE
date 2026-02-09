fn main() {
  ensure_windows_icon();
  tauri_build::build()
}

fn ensure_windows_icon() {
  if !cfg!(target_os = "windows") {
    return;
  }

  let icon_dir = std::path::Path::new("icons");
  let icon_path = icon_dir.join("icon.ico");

  let _ = std::fs::create_dir_all(icon_dir);
  if icon_path.exists() {
    return;
  }

  let size = 64u32;
  let rgba = vec![0u8; (size * size * 4) as usize];

  let image = ico::IconImage::from_rgba_data(size, size, rgba);

  let mut dir = ico::IconDir::new(ico::ResourceType::Icon);
  let entry = match ico::IconDirEntry::encode(&image) {
    Ok(e) => e,
    Err(_) => return,
  };
  dir.add_entry(entry);

  if let Ok(mut file) = std::fs::File::create(icon_path) {
    let _ = dir.write(&mut file);
  }
}
