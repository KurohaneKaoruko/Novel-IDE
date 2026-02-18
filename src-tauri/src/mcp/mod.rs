use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// MCP Server 配置
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub enabled: bool,
}

/// MCP Tool 定义
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// MCP Resource 定义
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpResource {
    pub uri: String,
    pub name: String,
    pub description: String,
    pub mime_type: String,
}

/// MCP Server 运行时状态
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerStatus {
    pub server_id: String,
    pub connected: bool,
    pub tools: Vec<McpTool>,
    pub resources: Vec<McpResource>,
    pub error: Option<String>,
}

/// 预配置的 MCP Servers
#[allow(dead_code)]
pub fn default_mcp_servers() -> Vec<McpServer> {
    vec![
        // 可以添加默认的 MCP 服务器配置
        // 例如：文件系统、数据库等
    ]
}

impl McpServer {
    #[allow(dead_code)]
    pub fn new(id: &str, name: &str, command: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            command: command.to_string(),
            args: vec![],
            env: HashMap::new(),
            enabled: true,
        }
    }
}
