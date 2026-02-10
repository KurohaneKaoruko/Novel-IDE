use serde::{Deserialize, Serialize};

/// Represents a single modification to a file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Modification {
    pub id: String,
    #[serde(rename = "type")]
    pub mod_type: ModificationType,
    #[serde(rename = "lineStart")]
    pub line_start: u32,
    #[serde(rename = "lineEnd")]
    pub line_end: u32,
    #[serde(rename = "originalText", skip_serializing_if = "Option::is_none")]
    pub original_text: Option<String>,
    #[serde(rename = "modifiedText", skip_serializing_if = "Option::is_none")]
    pub modified_text: Option<String>,
    pub status: ModificationStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModificationType {
    Add,
    Delete,
    Modify,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModificationStatus {
    Pending,
    Accepted,
    Rejected,
}

/// Represents modifications to a single file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileModification {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "originalContent")]
    pub original_content: String,
    pub modifications: Vec<Modification>,
    pub status: FileModificationStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileModificationStatus {
    Pending,
    Partial,
    Accepted,
    Rejected,
}

/// Represents a set of changes across multiple files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeSet {
    pub id: String,
    pub timestamp: u64,
    pub files: Vec<FileModification>,
    pub status: ChangeSetStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeSetStatus {
    Pending,
    Partial,
    Accepted,
    Rejected,
}

impl ChangeSet {
    pub fn new(files: Vec<FileModification>) -> Self {
        let id = format!(
            "changeset-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis(),
            uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("unknown")
        );
        
        Self {
            id,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs(),
            files,
            status: ChangeSetStatus::Pending,
        }
    }
}
