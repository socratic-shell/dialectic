//! Shared types for Dialectic MCP Server
//! 
//! Mirrors the TypeScript types from server/src/types.ts to ensure
//! protocol compatibility across the IPC boundary.

use serde::{Deserialize, Serialize};
use schemars::JsonSchema;

/// Parameters for the present-review MCP tool
/// 
/// Matches PresentReviewParams from TypeScript implementation
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub struct PresentReviewParams {
    /// Markdown content of the review to display
    pub content: String,
    
    /// How to handle the review content in the extension
    pub mode: ReviewMode,
    
    /// Optional section name for update-section mode
    pub section: Option<String>,
    
    /// Base directory path for resolving relative file references
    #[serde(rename = "baseUri")]
    pub base_uri: String,
}

/// Review display modes
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ReviewMode {
    Replace,
    UpdateSection,
    Append,
}

impl Default for ReviewMode {
    fn default() -> Self {
        ReviewMode::Replace
    }
}

/// Response from the present-review tool
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PresentReviewResult {
    /// Whether the review was successfully presented
    pub success: bool,
    
    /// Optional message about the operation
    pub message: Option<String>,
}

/// Parameters for log messages sent via IPC
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LogParams {
    /// Log level
    pub level: LogLevel,
    
    /// Log message content
    pub message: String,
}

/// Log levels for IPC communication
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Error,
    Debug,
}

/// Response from the get-selection tool
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GetSelectionResult {
    /// Currently selected text, null if no selection
    #[serde(rename = "selectedText")]
    pub selected_text: Option<String>,
    
    /// File path of the active editor, if available
    #[serde(rename = "filePath")]
    pub file_path: Option<String>,
    
    /// Starting line number (1-based)
    #[serde(rename = "startLine")]
    pub start_line: Option<u32>,
    
    /// Starting column number (1-based)
    #[serde(rename = "startColumn")]
    pub start_column: Option<u32>,
    
    /// Ending line number (1-based)
    #[serde(rename = "endLine")]
    pub end_line: Option<u32>,
    
    /// Ending column number (1-based)
    #[serde(rename = "endColumn")]
    pub end_column: Option<u32>,
    
    /// Single line number if selection is on one line
    #[serde(rename = "lineNumber")]
    pub line_number: Option<u32>,
    
    /// Language ID of the document
    #[serde(rename = "documentLanguage")]
    pub document_language: Option<String>,
    
    /// Whether the document is untitled
    #[serde(rename = "isUntitled")]
    pub is_untitled: Option<bool>,
    
    /// Message explaining the selection state
    pub message: Option<String>,
}

/// IPC message sent from MCP server to VSCode extension
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IPCMessage {
    /// Message type identifier
    #[serde(rename = "type")]
    pub message_type: IPCMessageType,
    
    /// Message payload
    pub payload: serde_json::Value,
    
    /// Unique message ID for response tracking
    pub id: String,
}

/// IPC message types
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum IPCMessageType {
    PresentReview,
    Log,
    GetSelection,
}

/// IPC response sent from VSCode extension back to MCP server
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct IPCResponse {
    /// Response to message with this ID
    pub id: String,
    
    /// Whether the operation succeeded
    pub success: bool,
    
    /// Optional error message
    pub error: Option<String>,
    
    /// Optional data payload for get_selection responses
    pub data: Option<serde_json::Value>,
}
