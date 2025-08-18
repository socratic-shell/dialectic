//! Dialectic MCP Server implementation using the official rmcp SDK
//!
//! Provides present_review, get_selection, and ide_operation tools for AI assistants
//! to interact with the VSCode extension via IPC.

use anyhow::Result;
use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler,
    handler::server::{router::tool::ToolRouter, tool::Parameters},
    model::*,
    service::RequestContext,
    tool, tool_handler, tool_router,
};
use serde_json;
use std::future::Future;
use tracing::info;

use crate::dialect::DialectInterpreter;
use crate::ipc::IPCCommunicator;
use crate::types::{LogLevel, PresentReviewParams};
use serde::{Deserialize, Serialize};

/// Parameters for the ide_operation tool
// ANCHOR: ide_operation_params
#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
struct IdeOperationParams {
    /// Dialect program to execute
    program: serde_json::Value,
}
// ANCHOR_END: ide_operation_params

/// Dialectic MCP Server
///
/// Implements the MCP server protocol and bridges to VSCode extension via IPC.
/// Uses the official rmcp SDK with tool macros for clean implementation.
#[derive(Clone)]
pub struct DialecticServer {
    ipc: IPCCommunicator,
    interpreter: DialectInterpreter<IPCCommunicator>,
    tool_router: ToolRouter<DialecticServer>,
}

#[tool_router]
impl DialecticServer {
    pub async fn new() -> Result<Self> {
        // First, discover VSCode PID by walking up the process tree
        let current_pid = std::process::id();
        let Some((vscode_pid, shell_pid)) =
            crate::pid_discovery::find_vscode_pid_from_mcp(current_pid).await?
        else {
            anyhow::bail!("Could not discover VSCode PID from process tree");
        };

        info!("Discovered VSCode PID: {vscode_pid} and shell PID: {shell_pid}");

        // Ensure the message bus daemon is running
        Self::ensure_daemon_running(vscode_pid).await?;

        let mut ipc = IPCCommunicator::new(vscode_pid, shell_pid).await?;

        // Initialize IPC connection to message bus daemon (not directly to VSCode)
        ipc.initialize().await?;
        info!("IPC communication with message bus daemon initialized");

        // Send unsolicited Polo message to announce our presence
        ipc.send_polo(shell_pid).await?;
        info!("Sent Polo discovery message with shell PID: {}", shell_pid);

        // Initialize Dialect interpreter with IDE functions
        let mut interpreter = DialectInterpreter::new(ipc.clone());
        interpreter.add_function::<crate::ide::FindDefinitions>();
        interpreter.add_function::<crate::ide::FindReferences>();

        Ok(Self {
            ipc: ipc.clone(),
            interpreter,
            tool_router: Self::tool_router(),
        })
    }

    /// Get a reference to the IPC communicator
    pub fn ipc(&self) -> &IPCCommunicator {
        &self.ipc
    }

    /// Ensure the message bus daemon is running for the given VSCode PID
    async fn ensure_daemon_running(vscode_pid: u32) -> Result<()> {
        crate::daemon::spawn_daemon_process(vscode_pid).await
    }

    /// Creates a new DialecticServer in test mode
    /// In test mode, IPC operations are mocked and don't require a VSCode connection
    pub fn new_test() -> Self {
        let ipc = IPCCommunicator::new_test();
        info!("DialecticServer initialized in test mode");

        // Initialize Dialect interpreter with IDE functions for test mode
        let mut interpreter = DialectInterpreter::new(ipc.clone());
        interpreter.add_function::<crate::ide::FindDefinitions>();
        interpreter.add_function::<crate::ide::FindReferences>();

        Self {
            ipc,
            interpreter,
            tool_router: Self::tool_router(),
        }
    }

    /// Present a code review in the VSCode review panel
    ///
    /// This tool allows AI assistants to display structured markdown reviews
    /// with clickable file references in the VSCode extension.
    // ANCHOR: present_review_tool
    #[tool(description = "Display a code review in the VSCode review panel. \
                       Reviews should be structured markdown with clear sections and actionable feedback. \
                       The Dialectic guidance in your context describe link format and overall structure.")]
    async fn present_review(
        &self,
        Parameters(params): Parameters<PresentReviewParams>,
    ) -> Result<CallToolResult, McpError> {
        // ANCHOR_END: present_review_tool
        // Log the tool call via IPC (also logs locally)
        self.ipc
            .send_log(
                LogLevel::Debug,
                format!(
                    "Received present_review tool call with params: {:?}",
                    params
                ),
            )
            .await;

        self.ipc
            .send_log(
                LogLevel::Debug,
                format!(
                    "Parameters: mode={:?}, content length={}",
                    params.mode,
                    params.content.len()
                ),
            )
            .await;

        // Forward to VSCode extension via IPC
        self.ipc
            .send_log(
                LogLevel::Info,
                "Forwarding review to VSCode extension via IPC...".to_string(),
            )
            .await;

        let result = self.ipc.present_review(params).await.map_err(|e| {
            McpError::internal_error(
                "IPC communication failed",
                Some(serde_json::json!({
                    "error": e.to_string()
                })),
            )
        })?;

        if result.success {
            self.ipc
                .send_log(
                    LogLevel::Info,
                    "Review successfully displayed in VSCode".to_string(),
                )
                .await;

            let message = result
                .message
                .unwrap_or_else(|| "Review successfully displayed in VSCode".to_string());

            Ok(CallToolResult::success(vec![Content::text(message)]))
        } else {
            let error_msg = result
                .message
                .unwrap_or_else(|| "Unknown error".to_string());

            self.ipc
                .send_log(
                    LogLevel::Error,
                    format!("Failed to display review: {}", error_msg),
                )
                .await;

            Err(McpError::internal_error(
                "Failed to display review",
                Some(serde_json::json!({
                    "error": format!("Failed to display review: {}", error_msg)
                })),
            ))
        }
    }

    /// Get the currently selected text from any active editor in VSCode
    ///
    /// Works with source files, review panels, and any other text editor.
    /// Returns null if no text is selected or no active editor is found.
    // ANCHOR: get_selection_tool
    #[tool(
        description = "Get the currently selected text from any active editor in VSCode. \
                       Works with source files, review panels, and any other text editor. \
                       Returns null if no text is selected or no active editor is found."
    )]
    async fn get_selection(&self) -> Result<CallToolResult, McpError> {
        // ANCHOR_END: get_selection_tool
        // Log the tool call via IPC (also logs locally)
        self.ipc
            .send_log(
                LogLevel::Debug,
                "Received get_selection tool call".to_string(),
            )
            .await;

        // Request current selection from VSCode extension via IPC
        self.ipc
            .send_log(
                LogLevel::Info,
                "Requesting current selection from VSCode extension...".to_string(),
            )
            .await;

        let result = self.ipc.get_selection().await.map_err(|e| {
            McpError::internal_error(
                "IPC communication failed",
                Some(serde_json::json!({
                    "error": e.to_string()
                })),
            )
        })?;

        let status_msg = if result.selected_text.is_some() {
            "text selected"
        } else {
            "no selection"
        };

        self.ipc
            .send_log(
                LogLevel::Info,
                format!("Selection retrieved: {}", status_msg),
            )
            .await;

        // Convert result to JSON and return
        let json_content = Content::json(result).map_err(|e| {
            McpError::internal_error(
                "Serialization failed",
                Some(serde_json::json!({
                    "error": format!("Failed to serialize selection result: {}", e)
                })),
            )
        })?;

        Ok(CallToolResult::success(vec![json_content]))
    }

    /// Execute IDE operations using Dialect mini-language
    ///
    /// Provides access to VSCode's Language Server Protocol (LSP) capabilities
    /// through a composable function system for symbol resolution and reference finding.
    // ANCHOR: ide_operation_tool
    #[tool(
        description = "Execute IDE operations using a structured JSON mini-language. \
                       This tool provides access to VSCode's Language Server Protocol (LSP) capabilities \
                       through a composable function system.\n\n\
                       Common operations:\n\
                       - {\"findDefinitions\": \"MyFunction\"} - list of locations where a symbol named `MyFunction` is defined\n\
                       - {\"findReferences\": \"MyFunction\"} - list of locations where a symbol named `MyFunction` is referenced\n\
                       "
    )]
    async fn ide_operation(
        &self,
        Parameters(params): Parameters<IdeOperationParams>,
    ) -> Result<CallToolResult, McpError> {
        // ANCHOR_END: ide_operation_tool
        // Log the tool call via IPC (also logs locally)
        self.ipc
            .send_log(
                LogLevel::Debug,
                format!(
                    "Received ide_operation tool call with program: {:?}",
                    params.program
                ),
            )
            .await;

        // Execute the Dialect program using spawn_blocking to handle non-Send future
        self.ipc
            .send_log(
                LogLevel::Info,
                "Executing Dialect program...".to_string(),
            )
            .await;

        let program = params.program;
        let mut interpreter = self.interpreter.clone();

        let result = tokio::task::spawn_blocking(move || {
            tokio::runtime::Handle::current()
                .block_on(async move { interpreter.evaluate(program).await })
        })
        .await
        .map_err(|e| {
            McpError::internal_error(
                "Task execution failed",
                Some(serde_json::json!({
                    "error": e.to_string()
                })),
            )
        })?
        .map_err(|e| {
            McpError::internal_error(
                "Dialect execution failed",
                Some(serde_json::json!({
                    "error": e.to_string()
                })),
            )
        })?;

        self.ipc
            .send_log(
                LogLevel::Info,
                format!("Dialect execution completed successfully"),
            )
            .await;

        // Convert result to JSON and return
        let json_content = Content::json(result).map_err(|e| {
            McpError::internal_error(
                "Serialization failed",
                Some(serde_json::json!({
                    "error": format!("Failed to serialize Dialect result: {}", e)
                })),
            )
        })?;

        Ok(CallToolResult::success(vec![json_content]))
    }
}

#[tool_handler]
impl ServerHandler for DialecticServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::V_2024_11_05,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "dialectic-mcp-server".to_string(),
                version: "0.1.0".to_string(),
            },
            instructions: Some(
                "This server provides tools for AI assistants to display code reviews and perform IDE operations in VSCode. \
                Use 'present_review' to display structured markdown reviews with file references, \
                'get_selection' to retrieve currently selected text from the active editor, \
                and 'ide_operation' to execute IDE operations like finding symbol definitions and references using Dialect."
                    .to_string(),
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
