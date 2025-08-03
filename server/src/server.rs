//! Dialectic MCP Server implementation using the official rmcp SDK
//! 
//! Provides present_review and get_selection tools for AI assistants
//! to interact with the VSCode extension via IPC.

use anyhow::Result;
use std::future::Future;
use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler,
    handler::server::{router::tool::ToolRouter, tool::Parameters},
    model::*,
    service::RequestContext,
    tool, tool_handler, tool_router,
};
use serde_json;
use tracing::info;

use crate::ipc::IPCCommunicator;
use crate::types::{LogLevel, PresentReviewParams};

/// Dialectic MCP Server
/// 
/// Implements the MCP server protocol and bridges to VSCode extension via IPC.
/// Uses the official rmcp SDK with tool macros for clean implementation.
#[derive(Clone)]
pub struct DialecticServer {
    ipc: IPCCommunicator,
    tool_router: ToolRouter<DialecticServer>,
}

#[tool_router]
impl DialecticServer {
    pub async fn new() -> Result<Self> {
        let mut ipc = IPCCommunicator::new().await?;
        
        // Initialize IPC connection to VSCode extension
        ipc.initialize().await?;
        info!("IPC communication with VSCode extension initialized");
        
        Ok(Self {
            ipc,
            tool_router: Self::tool_router(),
        })
    }

    /// Creates a new DialecticServer in test mode
    /// In test mode, IPC operations are mocked and don't require a VSCode connection
    pub fn new_test() -> Self {
        let ipc = IPCCommunicator::new_test();
        info!("DialecticServer initialized in test mode");
        
        Self {
            ipc,
            tool_router: Self::tool_router(),
        }
    }

    /// Present a code review in the VSCode review panel
    /// 
    /// This tool allows AI assistants to display structured markdown reviews
    /// with clickable file references in the VSCode extension.
    #[tool(
        description = "Display a code review in the VSCode review panel. \
                       Reviews should be structured markdown with clear sections and actionable feedback. \
                       The Dialectic guidance in your context describe link format and overall structure."
    )]
    async fn present_review(
        &self,
        Parameters(params): Parameters<PresentReviewParams>,
    ) -> Result<CallToolResult, McpError> {
        // Log the tool call via IPC (also logs locally)
        self.ipc.send_log(
            LogLevel::Debug,
            format!("Received present_review tool call with params: {:?}", params)
        ).await;

        self.ipc.send_log(
            LogLevel::Debug,
            format!("Parameters: mode={:?}, content length={}", params.mode, params.content.len())
        ).await;

        // Forward to VSCode extension via IPC
        self.ipc.send_log(
            LogLevel::Info,
            "Forwarding review to VSCode extension via IPC...".to_string()
        ).await;

        let result = self.ipc.present_review(params).await.map_err(|e| {
            McpError::internal_error("IPC communication failed", Some(serde_json::json!({
                "error": e.to_string()
            })))
        })?;

        if result.success {
            self.ipc.send_log(
                LogLevel::Info,
                "Review successfully displayed in VSCode".to_string()
            ).await;
            
            let message = result.message.unwrap_or_else(|| 
                "Review successfully displayed in VSCode".to_string()
            );
            
            Ok(CallToolResult::success(vec![Content::text(message)]))
        } else {
            let error_msg = result.message.unwrap_or_else(|| "Unknown error".to_string());
            
            self.ipc.send_log(
                LogLevel::Error,
                format!("Failed to display review: {}", error_msg)
            ).await;
            
            Err(McpError::internal_error("Failed to display review", Some(serde_json::json!({
                "error": format!("Failed to display review: {}", error_msg)
            }))))
        }
    }

    /// Get the currently selected text from any active editor in VSCode
    /// 
    /// Works with source files, review panels, and any other text editor.
    /// Returns null if no text is selected or no active editor is found.
    #[tool(
        description = "Get the currently selected text from any active editor in VSCode. \
                       Works with source files, review panels, and any other text editor. \
                       Returns null if no text is selected or no active editor is found."
    )]
    async fn get_selection(&self) -> Result<CallToolResult, McpError> {
        // Log the tool call via IPC (also logs locally)
        self.ipc.send_log(
            LogLevel::Debug,
            "Received get_selection tool call".to_string()
        ).await;

        // Request current selection from VSCode extension via IPC
        self.ipc.send_log(
            LogLevel::Info,
            "Requesting current selection from VSCode extension...".to_string()
        ).await;

        let result = self.ipc.get_selection().await.map_err(|e| {
            McpError::internal_error("IPC communication failed", Some(serde_json::json!({
                "error": e.to_string()
            })))
        })?;

        let status_msg = if result.selected_text.is_some() { 
            "text selected" 
        } else { 
            "no selection" 
        };
        
        self.ipc.send_log(
            LogLevel::Info,
            format!("Selection retrieved: {}", status_msg)
        ).await;

        // Convert result to JSON and return
        let json_content = Content::json(result).map_err(|e| {
            McpError::internal_error("Serialization failed", Some(serde_json::json!({
                "error": format!("Failed to serialize selection result: {}", e)
            })))
        })?;

        Ok(CallToolResult::success(vec![json_content]))
    }
}

#[tool_handler]
impl ServerHandler for DialecticServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::builder()
                .enable_tools()
                .build(),
            server_info: Implementation {
                name: "dialectic-mcp-server".to_string(),
                version: "0.1.0".to_string(),
            },
            instructions: Some(
                "This server provides tools for AI assistants to display code reviews in VSCode. \
                Use 'present_review' to display structured markdown reviews with file references, \
                and 'get_selection' to retrieve currently selected text from the active editor."
                .to_string()
            ),
        }
    }

    async fn initialize(
        &self,
        _request: InitializeRequestParam,
        _context: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, McpError> {
        info!("MCP client connected and initialized");
        Ok(self.get_info())
    }
}
