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
mod spec_kit;
mod spec_kit_export;
mod skills;
mod mcp;

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .manage(state::AppState::default())
    .invoke_handler(tauri::generate_handler![
      commands::ping,
      commands::set_workspace,
      commands::get_last_workspace,
      commands::init_novel,
      commands::list_workspace_tree,
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
      commands::ai_assistance_generate,
      commands::spec_kit_generate_outline,
      commands::spec_kit_validate_story_spec,
      commands::spec_kit_match_character_arcs,
      commands::spec_kit_export_markdown,
      commands::spec_kit_export_epub,
      commands::spec_kit_export_pdf,
      commands::get_skills,
      commands::get_skill_categories,
      commands::get_skills_by_category,
      commands::apply_skill
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
