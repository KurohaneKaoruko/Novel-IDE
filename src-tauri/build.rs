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
  let size = 256u32;
  let mut rgba = vec![0u8; (size * size * 4) as usize];

  // Speech bubble body.
  fill_rounded_rect(
    &mut rgba,
    size,
    18,
    24,
    238,
    190,
    34,
    [24, 105, 228, 255],
  );
  fill_rounded_rect(
    &mut rgba,
    size,
    26,
    30,
    230,
    182,
    30,
    [52, 142, 255, 255],
  );
  fill_triangle(
    &mut rgba,
    size,
    (84, 182),
    (146, 182),
    (102, 234),
    [24, 105, 228, 255],
  );

  // Open book pages.
  fill_rounded_rect(
    &mut rgba,
    size,
    72,
    82,
    130,
    178,
    10,
    [255, 255, 255, 255],
  );
  fill_rounded_rect(
    &mut rgba,
    size,
    126,
    82,
    184,
    178,
    10,
    [255, 255, 255, 255],
  );
  fill_rect(&mut rgba, size, 126, 86, 130, 174, [214, 225, 255, 255]);

  // Chat dots.
  fill_circle(&mut rgba, size, 86, 58, 8, [255, 255, 255, 255]);
  fill_circle(&mut rgba, size, 108, 58, 8, [255, 255, 255, 255]);
  fill_circle(&mut rgba, size, 130, 58, 8, [255, 255, 255, 255]);

  // Page lines.
  fill_rect(&mut rgba, size, 90, 104, 118, 108, [170, 192, 255, 255]);
  fill_rect(&mut rgba, size, 90, 120, 118, 124, [170, 192, 255, 255]);
  fill_rect(&mut rgba, size, 90, 136, 118, 140, [170, 192, 255, 255]);
  fill_rect(&mut rgba, size, 140, 104, 168, 108, [170, 192, 255, 255]);
  fill_rect(&mut rgba, size, 140, 120, 168, 124, [170, 192, 255, 255]);
  fill_rect(&mut rgba, size, 140, 136, 168, 140, [170, 192, 255, 255]);

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

fn set_pixel(rgba: &mut [u8], size: u32, x: i32, y: i32, color: [u8; 4]) {
  if x < 0 || y < 0 || x >= size as i32 || y >= size as i32 {
    return;
  }
  let idx = ((y as u32 * size + x as u32) * 4) as usize;
  rgba[idx] = color[0];
  rgba[idx + 1] = color[1];
  rgba[idx + 2] = color[2];
  rgba[idx + 3] = color[3];
}

fn fill_rect(rgba: &mut [u8], size: u32, x0: i32, y0: i32, x1: i32, y1: i32, color: [u8; 4]) {
  for y in y0..=y1 {
    for x in x0..=x1 {
      set_pixel(rgba, size, x, y, color);
    }
  }
}

fn fill_circle(rgba: &mut [u8], size: u32, cx: i32, cy: i32, radius: i32, color: [u8; 4]) {
  let r2 = radius * radius;
  for y in (cy - radius)..=(cy + radius) {
    for x in (cx - radius)..=(cx + radius) {
      let dx = x - cx;
      let dy = y - cy;
      if dx * dx + dy * dy <= r2 {
        set_pixel(rgba, size, x, y, color);
      }
    }
  }
}

fn fill_rounded_rect(
  rgba: &mut [u8],
  size: u32,
  x0: i32,
  y0: i32,
  x1: i32,
  y1: i32,
  radius: i32,
  color: [u8; 4],
) {
  let left = x0 + radius;
  let right = x1 - radius;
  let top = y0 + radius;
  let bottom = y1 - radius;

  for y in y0..=y1 {
    for x in x0..=x1 {
      let inside_core = (x >= left && x <= right) || (y >= top && y <= bottom);
      if inside_core {
        set_pixel(rgba, size, x, y, color);
        continue;
      }

      let cx = if x < left { left } else { right };
      let cy = if y < top { top } else { bottom };
      let dx = x - cx;
      let dy = y - cy;
      if dx * dx + dy * dy <= radius * radius {
        set_pixel(rgba, size, x, y, color);
      }
    }
  }
}

fn fill_triangle(
  rgba: &mut [u8],
  size: u32,
  a: (i32, i32),
  b: (i32, i32),
  c: (i32, i32),
  color: [u8; 4],
) {
  let min_x = a.0.min(b.0).min(c.0);
  let max_x = a.0.max(b.0).max(c.0);
  let min_y = a.1.min(b.1).min(c.1);
  let max_y = a.1.max(b.1).max(c.1);

  for y in min_y..=max_y {
    for x in min_x..=max_x {
      if point_in_triangle((x, y), a, b, c) {
        set_pixel(rgba, size, x, y, color);
      }
    }
  }
}

fn point_in_triangle(p: (i32, i32), a: (i32, i32), b: (i32, i32), c: (i32, i32)) -> bool {
  let area = |p1: (i32, i32), p2: (i32, i32), p3: (i32, i32)| -> i32 {
    (p1.0 * (p2.1 - p3.1) + p2.0 * (p3.1 - p1.1) + p3.0 * (p1.1 - p2.1)).abs()
  };

  let total = area(a, b, c);
  let a1 = area(p, b, c);
  let a2 = area(a, p, c);
  let a3 = area(a, b, p);

  a1 + a2 + a3 <= total + 1
}
