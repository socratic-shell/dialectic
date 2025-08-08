//! Shared types for Dialectic MCP Server
//!
//! Mirrors the TypeScript types from server/src/types.ts to ensure
//! protocol compatibility across the IPC boundary.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

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

/// Payload for Polo discovery messages (MCP server announces presence)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PoloPayload {
    /// Shell PID of the terminal where this MCP server is running
    pub terminal_shell_pid: u32,
}

/// Payload for Goodbye discovery messages (MCP server announces departure)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GoodbyePayload {
    /// Shell PID of the terminal where this MCP server was running
    pub terminal_shell_pid: u32,
}

/// Payload for ResolveSymbolByName messages
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResolveSymbolByNamePayload {
    /// The symbol name to resolve (e.g., "User", "validateToken")
    pub name: String,
}

/// Payload for FindAllReferences messages
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FindAllReferencesPayload {
    /// The resolved symbol to find references for
    pub symbol: crate::ide::SymbolDef,
}

/// Payload for Response messages (replaces IPCResponse struct)
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ResponsePayload {
    /// Whether the operation succeeded
    pub success: bool,

    /// Optional error message
    pub error: Option<String>,

    /// Optional data payload for responses like get_selection
    pub data: Option<serde_json::Value>,
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
    /// Extension broadcasts "who's out there?" to discover active MCP servers
    Marco,
    /// MCP server announces presence with shell PID (response to Marco or unsolicited)
    Polo,
    /// MCP server announces departure with shell PID
    Goodbye,
    /// Response to any message (replaces IPCResponse struct)
    Response,
    /// Resolve symbol by name - returns Vec<ResolvedSymbol>
    ResolveSymbolByName,
    /// Find all references to a symbol - returns Vec<FileLocation>
    FindAllReferences,
}
