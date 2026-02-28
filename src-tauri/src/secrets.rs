use base64::{engine::general_purpose, Engine as _};
use crate::app_data;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Default, Serialize, Deserialize)]
struct SecretsFile {
  providers: BTreeMap<String, String>,
}

fn secrets_path(app: &AppHandle) -> Result<PathBuf, String> {
  app_data::secrets_file_path(app, "secrets.json")
}

fn read_secrets_file(app: &AppHandle) -> Result<SecretsFile, String> {
  let path = secrets_path(app)?;
  if !path.exists() {
    return Ok(SecretsFile::default());
  }
  let raw = fs::read_to_string(&path).map_err(|e| format!("read secrets failed: {e}"))?;
  serde_json::from_str(&raw).map_err(|e| format!("parse secrets failed: {e}"))
}

fn write_secrets_file(app: &AppHandle, s: &SecretsFile) -> Result<(), String> {
  let path = secrets_path(app)?;
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("create secrets dir failed: {e}"))?;
  }
  let raw = serde_json::to_string_pretty(s).map_err(|e| format!("serialize secrets failed: {e}"))?;
  fs::write(&path, raw).map_err(|e| format!("write secrets failed: {e}"))
}

#[cfg(windows)]
fn protect_bytes(plaintext: &[u8]) -> Result<Vec<u8>, String> {
  use windows::core::PCWSTR;
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

  if plaintext.is_empty() {
    return Ok(Vec::new());
  }

  let in_blob = CRYPT_INTEGER_BLOB {
    cbData: plaintext.len() as u32,
    pbData: plaintext.as_ptr() as *mut u8,
  };
  let mut out_blob = CRYPT_INTEGER_BLOB::default();

  let res = unsafe {
    CryptProtectData(
      &in_blob,
      PCWSTR::null(),
      None,
      None,
      None,
      CRYPTPROTECT_UI_FORBIDDEN,
      &mut out_blob,
    )
  };

  if let Err(e) = res {
    return Err(format!("dpapi encrypt failed: {e}"));
  }

  let out = unsafe { std::slice::from_raw_parts(out_blob.pbData as *const u8, out_blob.cbData as usize) }.to_vec();
  unsafe {
    let _ = LocalFree(HLOCAL(out_blob.pbData as *mut core::ffi::c_void));
  }
  Ok(out)
}

#[cfg(windows)]
fn unprotect_bytes(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
  use windows::Win32::Foundation::{LocalFree, HLOCAL};
  use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};

  if ciphertext.is_empty() {
    return Ok(Vec::new());
  }

  let in_blob = CRYPT_INTEGER_BLOB {
    cbData: ciphertext.len() as u32,
    pbData: ciphertext.as_ptr() as *mut u8,
  };
  let mut out_blob = CRYPT_INTEGER_BLOB::default();

  let res = unsafe {
    CryptUnprotectData(
      &in_blob,
      None,
      None,
      None,
      None,
      CRYPTPROTECT_UI_FORBIDDEN,
      &mut out_blob,
    )
  };
  if let Err(e) = res {
    return Err(format!("dpapi decrypt failed: {e}"));
  }

  let out = unsafe { std::slice::from_raw_parts(out_blob.pbData as *const u8, out_blob.cbData as usize) }.to_vec();
  unsafe {
    let _ = LocalFree(HLOCAL(out_blob.pbData as *mut core::ffi::c_void));
  }
  Ok(out)
}

#[cfg(not(windows))]
fn protect_bytes(_: &[u8]) -> Result<Vec<u8>, String> {
  Err("fallback secrets not supported on this OS".to_string())
}

#[cfg(not(windows))]
fn unprotect_bytes(_: &[u8]) -> Result<Vec<u8>, String> {
  Err("fallback secrets not supported on this OS".to_string())
}

fn store_fallback(app: &AppHandle, provider: &str, api_key: &str) -> Result<(), String> {
  let mut s = read_secrets_file(app)?;
  let encrypted = protect_bytes(api_key.as_bytes())?;
  let encoded = general_purpose::STANDARD.encode(encrypted);
  s.providers.insert(provider.to_string(), encoded);
  write_secrets_file(app, &s)
}

fn load_fallback(app: &AppHandle, provider: &str) -> Result<Option<String>, String> {
  let s = read_secrets_file(app)?;
  let encoded = match s.providers.get(provider) {
    Some(v) => v,
    None => return Ok(None),
  };
  let decoded = general_purpose::STANDARD
    .decode(encoded)
    .map_err(|e| format!("decode secrets failed: {e}"))?;
  let plaintext = unprotect_bytes(&decoded)?;
  let v = String::from_utf8(plaintext).map_err(|_| "invalid secrets encoding".to_string())?;
  Ok(Some(v))
}

pub fn set_api_key(app: &AppHandle, provider: &str, api_key: &str) -> Result<(), String> {
  let provider = provider.trim();
  if provider.is_empty() {
    return Err("provider empty".to_string());
  }
  let api_key = api_key.trim();
  if api_key.is_empty() {
    return Err("api key empty".to_string());
  }
  store_fallback(app, provider, api_key)
}

pub fn get_api_key(app: &AppHandle, provider: &str) -> Result<Option<String>, String> {
  let provider = provider.trim();
  if provider.is_empty() {
    return Ok(None);
  }

  match load_fallback(app, provider)? {
    Some(v) if !v.trim().is_empty() => Ok(Some(v)),
    _ => Ok(None),
  }
}
