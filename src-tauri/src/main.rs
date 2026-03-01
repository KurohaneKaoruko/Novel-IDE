#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod ai_types;
mod agent_system;
mod app_data;
mod app_settings;
mod agents;
mod chat_history;
mod branding;
mod secrets;
mod state;
mod modification_types;
mod ai_response_parser;
mod skills;
mod mcp;
mod book_split;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(state::AppState::default())
    .invoke_handler(tauri::generate_handler![
      commands::ping,
      commands::set_workspace,
      commands::get_last_workspace,
      commands::get_project_picker_state,
      commands::remember_external_project,
      commands::forget_external_project,
      commands::set_launch_mode,
      commands::init_novel,
      commands::list_workspace_tree,
      commands::get_project_writing_settings,
      commands::set_project_writing_settings,
      commands::parse_composer_directive,
      commands::resolve_inline_references,
      commands::validate_novel_task_quality,
      commands::read_text,
      commands::write_text,
      commands::create_file,
      commands::create_dir,
      commands::delete_entry,
      commands::rename_entry,
      commands::get_app_settings,
      commands::set_app_settings,
      commands::get_api_key_status,
      commands::set_api_key,
      commands::test_provider_connectivity,
      commands::get_agents,
      commands::set_agents,
      commands::export_agents,
      commands::import_agents,
      commands::save_chat_session,
      commands::list_chat_sessions,
      commands::get_chat_session,
      commands::git_init,
      commands::git_status,
      commands::git_diff,
      commands::git_commit,
      commands::git_log,
      commands::chat_generate_stream,
      commands::chat_cancel_stream,
      commands::ai_assistance_generate,
      commands::risk_scan_content,
      commands::get_skills,
      commands::get_skill_categories,
      commands::get_skills_by_category,
      commands::apply_skill,
      commands::book_analyze,
      commands::book_extract_techniques
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
