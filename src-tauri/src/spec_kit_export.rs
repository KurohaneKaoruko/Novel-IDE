use crate::commands::validate_relative_path;
use crate::spec_kit;
use epub_builder::{EpubBuilder, EpubContent, ZipLibrary};
#[cfg(all(windows, target_env = "msvc"))]
use printpdf::{Mm, Op, ParsedFont, PdfDocument, PdfPage, PdfSaveOptions, Point, Pt, TextItem};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Deserialize, Default)]
struct ChapterMetaFile {
  #[serde(default)]
  chapters: Vec<ChapterMeta>,
}

#[derive(Deserialize, Default)]
struct ChapterMeta {
  #[serde(default, rename = "filePath")]
  file_path: String,
  #[serde(default)]
  title: String,
  #[serde(default)]
  order: i64,
}

pub fn export_markdown(root: &Path) -> Result<(String, usize), String> {
  let (title, chapters) = load_book(root)?;
  let mut out = String::new();
  out.push_str(&format!("# {}\n\n", if title.trim().is_empty() { "未命名作品" } else { &title }));

  out.push_str("## 目录\n\n");
  for (i, ch) in chapters.iter().enumerate() {
    out.push_str(&format!("- {}. {}\n", i + 1, ch.title));
  }
  out.push_str("\n---\n\n");

  for ch in chapters {
    out.push_str(&format!("## {}\n\n", ch.title));
    out.push_str(ch.content.trim());
    out.push_str("\n\n");
  }

  let rel_path = "exports/book.md".to_string();
  let abs = root.join(validate_relative_path(&rel_path)?);
  if let Some(parent) = abs.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create export dir failed: {e}"))?;
  }
  fs::write(&abs, &out).map_err(|e| format!("write markdown failed: {e}"))?;
  Ok((rel_path, out.as_bytes().len()))
}

pub fn export_epub(root: &Path) -> Result<(String, usize), String> {
  let (title, chapters) = load_book(root)?;
  let zip = ZipLibrary::new().map_err(|e| format!("epub zip init failed: {e}"))?;
  let mut builder = EpubBuilder::new(zip).map_err(|e| format!("epub init failed: {e}"))?;
  builder
    .metadata("title", if title.trim().is_empty() { "未命名作品" } else { &title })
    .map_err(|e| format!("epub metadata failed: {e}"))?;

  let css = "body { font-family: serif; line-height: 1.6; } p { margin: 0 0 0.8em 0; }";
  builder.stylesheet(css.as_bytes()).map_err(|e| format!("epub stylesheet failed: {e}"))?;

  for (i, ch) in chapters.iter().enumerate() {
    let file = format!("chapter_{:03}.xhtml", i + 1);
    let xhtml = chapter_to_xhtml(&ch.title, &ch.content);
    let content = EpubContent::new(file, xhtml.as_bytes()).title(&ch.title);
    builder.add_content(content).map_err(|e| format!("epub add content failed: {e}"))?;
  }

  let mut epub_bytes: Vec<u8> = vec![];
  builder.generate(&mut epub_bytes).map_err(|e| format!("epub generate failed: {e}"))?;

  let rel_path = "exports/book.epub".to_string();
  let abs = root.join(validate_relative_path(&rel_path)?);
  if let Some(parent) = abs.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create export dir failed: {e}"))?;
  }
  fs::write(&abs, &epub_bytes).map_err(|e| format!("write epub failed: {e}"))?;
  Ok((rel_path, epub_bytes.len()))
}

#[cfg(all(windows, target_env = "msvc"))]
pub fn export_pdf(root: &Path) -> Result<(String, usize), String> {
  let (title, chapters) = load_book(root)?;
  let plain = chapters
    .iter()
    .map(|c| format!("{}\n\n{}\n", c.title, c.content.trim()))
    .collect::<Vec<_>>()
    .join("\n");

  let mut doc = PdfDocument::new(if title.trim().is_empty() { "Book" } else { &title });
  let font = load_system_font().ok_or_else(|| "无法解析系统字体，导出 PDF 失败".to_string())?;
  let font_id = doc.add_font(&font);

  let max_chars_per_line = 42usize;
  let mut lines = wrap_text(&plain, max_chars_per_line);
  if lines.is_empty() {
    lines.push(String::new());
  }
  let lines_per_page = 40usize;

  let mut pages: Vec<PdfPage> = vec![];
  for chunk in lines.chunks(lines_per_page) {
    let mut ops: Vec<Op> = vec![
      Op::SetLineHeight { lh: Pt(14.0) },
      Op::SetTextCursor {
        pos: Point {
          x: Mm(15.0).into(),
          y: Mm(280.0).into(),
        },
      },
    ];
    for line in chunk {
      ops.push(Op::WriteText {
        items: vec![TextItem::Text(line.clone())],
        font: font_id.clone(),
      });
      ops.push(Op::AddLineBreak);
    }
    pages.push(PdfPage::new(Mm(210.0), Mm(297.0), ops));
  }

  let mut warnings = Vec::new();
  let pdf_bytes = doc.with_pages(pages).save(&PdfSaveOptions { subset_fonts: true, ..Default::default() }, &mut warnings);

  let rel_path = "exports/book.pdf".to_string();
  let abs = root.join(validate_relative_path(&rel_path)?);
  if let Some(parent) = abs.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create export dir failed: {e}"))?;
  }
  fs::write(&abs, &pdf_bytes).map_err(|e| format!("write pdf failed: {e}"))?;
  Ok((rel_path, pdf_bytes.len()))
}

#[cfg(not(all(windows, target_env = "msvc")))]
pub fn export_pdf(_: &Path) -> Result<(String, usize), String> {
  Err("PDF 导出仅支持 MSVC 构建".to_string())
}

struct BookChapter {
  title: String,
  content: String,
}

fn load_book(root: &Path) -> Result<(String, Vec<BookChapter>), String> {
  let novel_dir = root.join(".novel");
  spec_kit::ensure_spec_kit_defaults(&novel_dir)?;

  let story_title = read_story_title(&novel_dir).unwrap_or_default();
  let chapters = load_chapters(root)?;
  Ok((story_title, chapters))
}

fn read_story_title(novel_dir: &Path) -> Option<String> {
  let p = novel_dir.join(".spec-kit").join("story_spec.json");
  let raw = fs::read_to_string(p).ok()?;
  let spec: spec_kit::StorySpec = serde_json::from_str(&raw).ok()?;
  Some(spec.story.title)
}

fn load_chapters(root: &Path) -> Result<Vec<BookChapter>, String> {
  let meta_path = root.join(".novel").join(".settings").join("chapters.json");
  if meta_path.exists() {
    let raw = fs::read_to_string(&meta_path).map_err(|e| format!("read chapters meta failed: {e}"))?;
    let mut meta: ChapterMetaFile = serde_json::from_str(&raw).map_err(|e| format!("parse chapters meta failed: {e}"))?;
    meta.chapters.sort_by_key(|c| c.order);
    let mut out = vec![];
    for c in meta.chapters {
      if c.file_path.trim().is_empty() {
        continue;
      }
      let abs = root.join(PathBuf::from(c.file_path.replace('\\', "/")));
      if !abs.exists() {
        continue;
      }
      let content = fs::read_to_string(abs).unwrap_or_default();
      out.push(BookChapter {
        title: if c.title.trim().is_empty() { c.file_path.clone() } else { c.title },
        content,
      });
    }
    return Ok(out);
  }

  let stories = root.join("stories");
  if !stories.exists() {
    return Ok(vec![]);
  }
  let mut files = fs::read_dir(stories)
    .map_err(|e| format!("read stories dir failed: {e}"))?
    .filter_map(|e| e.ok())
    .filter(|e| e.path().is_file())
    .map(|e| e.path())
    .collect::<Vec<_>>();
  files.sort();

  let mut out = vec![];
  for (i, p) in files.iter().enumerate() {
    let content = fs::read_to_string(p).unwrap_or_default();
    out.push(BookChapter {
      title: format!("第{}章", i + 1),
      content,
    });
  }
  Ok(out)
}

fn escape_xhtml(s: &str) -> String {
  s.replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
    .replace('\'', "&apos;")
}

fn chapter_to_xhtml(title: &str, content: &str) -> String {
  let mut body = String::new();
  for p in content.lines() {
    let t = p.trim_end();
    if t.trim().is_empty() {
      continue;
    }
    body.push_str("<p>");
    body.push_str(&escape_xhtml(t));
    body.push_str("</p>");
  }
  format!(
    r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head>
    <title>{}</title>
    <meta charset="utf-8" />
  </head>
  <body>
    <h2>{}</h2>
    {}
  </body>
</html>"#,
    escape_xhtml(title),
    escape_xhtml(title),
    body
  )
}

#[cfg(all(windows, target_env = "msvc"))]
fn wrap_text(s: &str, max_chars: usize) -> Vec<String> {
  let mut lines = vec![];
  for raw in s.lines() {
    let mut buf = String::new();
    for ch in raw.chars() {
      buf.push(ch);
      if buf.chars().count() >= max_chars {
        lines.push(buf);
        buf = String::new();
      }
    }
    if !buf.is_empty() {
      lines.push(buf);
    }
    lines.push(String::new());
  }
  lines
}

#[cfg(all(windows, target_env = "msvc"))]
fn load_system_font() -> Option<ParsedFont> {
  let candidates = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyh.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\arial.ttf",
  ];
  for p in candidates {
    if let Ok(bytes) = fs::read(p) {
      let mut warnings = Vec::new();
      for index in 0..4 {
        if let Some(parsed) = ParsedFont::from_bytes(&bytes, index, &mut warnings) {
          return Some(parsed);
        }
      }
    }
  }
  None
}
