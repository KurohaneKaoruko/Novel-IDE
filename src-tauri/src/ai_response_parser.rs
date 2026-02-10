use crate::modification_types::{
    ChangeSet, FileModification, FileModificationStatus, Modification, ModificationStatus,
    ModificationType,
};
use regex::Regex;
use std::path::PathBuf;

/// Parse AI response text to extract file modification instructions
/// 
/// Expected format:
/// ```
/// <file_edit path="stories/chapter-001.txt">
/// <replace lines="10-15">
/// New content here
/// </replace>
/// </file_edit>
/// ```
pub fn parse_ai_response(
    response: &str,
    workspace_root: &PathBuf,
) -> Result<Option<ChangeSet>, String> {
    // Check if response contains file edit instructions
    if !response.contains("<file_edit") {
        return Ok(None);
    }

    let file_modifications = parse_file_edits(response, workspace_root)?;
    
    if file_modifications.is_empty() {
        return Ok(None);
    }

    Ok(Some(ChangeSet::new(file_modifications)))
}

fn parse_file_edits(
    response: &str,
    workspace_root: &PathBuf,
) -> Result<Vec<FileModification>, String> {
    let file_edit_regex = Regex::new(
        r#"<file_edit\s+path="([^"]+)">(.*?)</file_edit>"#
    ).map_err(|e| format!("Failed to compile regex: {}", e))?;

    let mut file_modifications = Vec::new();

    for cap in file_edit_regex.captures_iter(response) {
        let file_path = cap.get(1)
            .ok_or("Missing file path")?
            .as_str()
            .to_string();
        
        let edit_content = cap.get(2)
            .ok_or("Missing edit content")?
            .as_str();

        // Read original file content
        let full_path = workspace_root.join(&file_path);
        let original_content = std::fs::read_to_string(&full_path)
            .map_err(|e| format!("Failed to read file {}: {}", file_path, e))?;

        // Parse modifications within this file
        let modifications = parse_modifications(edit_content)?;

        if !modifications.is_empty() {
            file_modifications.push(FileModification {
                file_path,
                original_content,
                modifications,
                status: FileModificationStatus::Pending,
            });
        }
    }

    Ok(file_modifications)
}

fn parse_modifications(edit_content: &str) -> Result<Vec<Modification>, String> {
    let mut modifications = Vec::new();
    let mut mod_counter = 0;

    // Parse <replace> tags
    let replace_regex = Regex::new(
        r#"<replace\s+lines="(\d+)-(\d+)">(.*?)</replace>"#
    ).map_err(|e| format!("Failed to compile replace regex: {}", e))?;

    for cap in replace_regex.captures_iter(edit_content) {
        let line_start: u32 = cap.get(1)
            .ok_or("Missing line start")?
            .as_str()
            .parse()
            .map_err(|e| format!("Invalid line start: {}", e))?;
        
        let line_end: u32 = cap.get(2)
            .ok_or("Missing line end")?
            .as_str()
            .parse()
            .map_err(|e| format!("Invalid line end: {}", e))?;
        
        let modified_text = cap.get(3)
            .ok_or("Missing modified text")?
            .as_str()
            .trim()
            .to_string();

        modifications.push(Modification {
            id: format!("mod-{}-{}", chrono::Utc::now().timestamp_millis(), mod_counter),
            mod_type: ModificationType::Modify,
            line_start,
            line_end,
            original_text: None, // Will be filled by frontend
            modified_text: Some(modified_text),
            status: ModificationStatus::Pending,
        });
        
        mod_counter += 1;
    }

    // Parse <insert> tags
    let insert_regex = Regex::new(
        r#"<insert\s+at="(\d+)">(.*?)</insert>"#
    ).map_err(|e| format!("Failed to compile insert regex: {}", e))?;

    for cap in insert_regex.captures_iter(edit_content) {
        let line_at: u32 = cap.get(1)
            .ok_or("Missing line position")?
            .as_str()
            .parse()
            .map_err(|e| format!("Invalid line position: {}", e))?;
        
        let modified_text = cap.get(2)
            .ok_or("Missing insert text")?
            .as_str()
            .trim()
            .to_string();

        modifications.push(Modification {
            id: format!("mod-{}-{}", chrono::Utc::now().timestamp_millis(), mod_counter),
            mod_type: ModificationType::Add,
            line_start: line_at,
            line_end: line_at,
            original_text: None,
            modified_text: Some(modified_text),
            status: ModificationStatus::Pending,
        });
        
        mod_counter += 1;
    }

    // Parse <delete> tags
    let delete_regex = Regex::new(
        r#"<delete\s+lines="(\d+)-(\d+)"\s*/>"#
    ).map_err(|e| format!("Failed to compile delete regex: {}", e))?;

    for cap in delete_regex.captures_iter(edit_content) {
        let line_start: u32 = cap.get(1)
            .ok_or("Missing line start")?
            .as_str()
            .parse()
            .map_err(|e| format!("Invalid line start: {}", e))?;
        
        let line_end: u32 = cap.get(2)
            .ok_or("Missing line end")?
            .as_str()
            .parse()
            .map_err(|e| format!("Invalid line end: {}", e))?;

        modifications.push(Modification {
            id: format!("mod-{}-{}", chrono::Utc::now().timestamp_millis(), mod_counter),
            mod_type: ModificationType::Delete,
            line_start,
            line_end,
            original_text: None, // Will be filled by frontend
            modified_text: None,
            status: ModificationStatus::Pending,
        });
        
        mod_counter += 1;
    }

    Ok(modifications)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_modifications_replace() {
        let content = r#"<replace lines="10-15">
New content for lines 10-15
</replace>"#;

        let mods = parse_modifications(content).unwrap();
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].line_start, 10);
        assert_eq!(mods[0].line_end, 15);
        assert!(matches!(mods[0].mod_type, ModificationType::Modify));
    }

    #[test]
    fn test_parse_modifications_insert() {
        let content = r#"<insert at="5">
New line to insert
</insert>"#;

        let mods = parse_modifications(content).unwrap();
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].line_start, 5);
        assert!(matches!(mods[0].mod_type, ModificationType::Add));
    }

    #[test]
    fn test_parse_modifications_delete() {
        let content = r#"<delete lines="20-25" />"#;

        let mods = parse_modifications(content).unwrap();
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].line_start, 20);
        assert_eq!(mods[0].line_end, 25);
        assert!(matches!(mods[0].mod_type, ModificationType::Delete));
    }

    #[test]
    fn test_parse_modifications_multiple() {
        let content = r#"
<replace lines="10-15">
New content
</replace>
<insert at="20">
Inserted line
</insert>
<delete lines="30-35" />
"#;

        let mods = parse_modifications(content).unwrap();
        assert_eq!(mods.len(), 3);
    }
}
