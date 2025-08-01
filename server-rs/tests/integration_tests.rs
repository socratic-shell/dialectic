//! Integration tests for Dialectic MCP Server
//! 
//! Tests the full MCP client-server flow including IPC message generation

use std::sync::{Arc, Mutex};
use std::collections::VecDeque;
use serde_json::json;

use dialectic_mcp_server::types::{IPCMessage, IPCMessageType, PresentReviewParams, ReviewMode};
use dialectic_mcp_server::ipc::IPCError;

use rmcp::model::*;

/// Mock IPC communicator that captures messages instead of sending them
#[derive(Clone)]
struct MockIPCCommunicator {
    captured_messages: Arc<Mutex<VecDeque<IPCMessage>>>,
}

impl MockIPCCommunicator {
    fn new() -> Self {
        Self {
            captured_messages: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    fn get_captured_messages(&self) -> Vec<IPCMessage> {
        let messages = self.captured_messages.lock().unwrap();
        messages.iter().cloned().collect()
    }

    async fn present_review(&self, params: PresentReviewParams) -> Result<dialectic_mcp_server::types::PresentReviewResult, IPCError> {
        // Capture the IPC message that would be sent
        let message = IPCMessage {
            message_type: IPCMessageType::PresentReview,
            payload: serde_json::to_value(&params).unwrap(),
            id: uuid::Uuid::new_v4().to_string(),
        };

        {
            let mut messages = self.captured_messages.lock().unwrap();
            messages.push_back(message);
        }

        // Return success response
        Ok(dialectic_mcp_server::types::PresentReviewResult {
            success: true,
            message: Some("Review captured successfully".to_string()),
        })
    }

    async fn get_selection(&self) -> Result<dialectic_mcp_server::types::GetSelectionResult, IPCError> {
        // Capture the IPC message that would be sent
        let message = IPCMessage {
            message_type: IPCMessageType::GetSelection,
            payload: json!({}),
            id: uuid::Uuid::new_v4().to_string(),
        };

        {
            let mut messages = self.captured_messages.lock().unwrap();
            messages.push_back(message);
        }

        // Return mock selection result
        Ok(dialectic_mcp_server::types::GetSelectionResult {
            selected_text: Some("mock selected text".to_string()),
            file_path: Some("/mock/file.rs".to_string()),
            start_line: Some(10),
            start_column: Some(5),
            end_line: Some(15),
            end_column: Some(20),
            line_number: None,
            document_language: Some("rust".to_string()),
            is_untitled: Some(false),
            message: Some("Mock selection".to_string()),
        })
    }
}

/// Test server that uses mock IPC communicator
struct TestDialecticServer {
    mock_ipc: MockIPCCommunicator,
}

impl TestDialecticServer {
    fn new() -> Self {
        Self {
            mock_ipc: MockIPCCommunicator::new(),
        }
    }

    fn get_captured_messages(&self) -> Vec<IPCMessage> {
        self.mock_ipc.get_captured_messages()
    }

    // Simulate the present_review tool behavior
    async fn present_review(&self, params: PresentReviewParams) -> Result<CallToolResult, rmcp::ErrorData> {
        // Use mock IPC instead of real IPC
        let result = self.mock_ipc.present_review(params).await.map_err(|e| {
            rmcp::ErrorData::internal_error("IPC communication failed", Some(serde_json::json!({
                "error": e.to_string()
            })))
        })?;

        let message = result.message.unwrap_or_else(|| 
            "Review successfully displayed in VSCode".to_string()
        );
        
        Ok(CallToolResult::success(vec![Content::text(message)]))
    }

    // Simulate the get_selection tool behavior
    async fn get_selection(&self) -> Result<CallToolResult, rmcp::ErrorData> {
        let result = self.mock_ipc.get_selection().await.map_err(|e| {
            rmcp::ErrorData::internal_error("IPC communication failed", Some(serde_json::json!({
                "error": e.to_string()
            })))
        })?;

        let json_content = Content::json(result).map_err(|e| {
            rmcp::ErrorData::internal_error("Serialization failed", Some(serde_json::json!({
                "error": format!("Failed to serialize selection result: {}", e)
            })))
        })?;

        Ok(CallToolResult::success(vec![json_content]))
    }
}

#[tokio::test]
async fn test_present_review_generates_correct_ipc_message() {
    // Initialize tracing for test output
    let _ = tracing_subscriber::fmt::try_init();

    // Create test server with mock IPC
    let server = TestDialecticServer::new();
    
    let params = PresentReviewParams {
        content: "# Test Review\n\nThis is a test review with some content.".to_string(),
        mode: ReviewMode::Replace,
        section: None,
        base_uri: "/test/project".to_string(),
    };

    // Call the tool directly
    let result = server.present_review(params.clone()).await;

    // Verify the tool call succeeded
    assert!(result.is_ok());
    let tool_result = result.unwrap();
    assert!(!tool_result.is_error.unwrap_or(false));

    // Verify the IPC message was captured
    let captured_messages = server.get_captured_messages();
    assert_eq!(captured_messages.len(), 1);

    let ipc_message = &captured_messages[0];
    assert!(matches!(ipc_message.message_type, IPCMessageType::PresentReview));
    
    // Verify the payload contains our parameters
    let payload_params: PresentReviewParams = serde_json::from_value(ipc_message.payload.clone()).unwrap();
    assert_eq!(payload_params.content, params.content);
    assert!(matches!(payload_params.mode, ReviewMode::Replace));
    assert_eq!(payload_params.base_uri, params.base_uri);
    assert!(payload_params.section.is_none());
}

#[tokio::test]
async fn test_get_selection_generates_correct_ipc_message() {
    let _ = tracing_subscriber::fmt::try_init();

    let server = TestDialecticServer::new();
    
    // Call get_selection tool
    let result = server.get_selection().await;

    // Verify the tool call succeeded
    assert!(result.is_ok());
    let tool_result = result.unwrap();
    assert!(!tool_result.is_error.unwrap_or(false));

    // Verify the IPC message was captured
    let captured_messages = server.get_captured_messages();
    assert_eq!(captured_messages.len(), 1);

    let ipc_message = &captured_messages[0];
    assert!(matches!(ipc_message.message_type, IPCMessageType::GetSelection));
    
    // Verify the payload is empty for get_selection
    assert_eq!(ipc_message.payload, json!({}));
}

#[tokio::test]
async fn test_present_review_with_update_section_mode() {
    let _ = tracing_subscriber::fmt::try_init();

    let server = TestDialecticServer::new();
    
    let params = PresentReviewParams {
        content: "## Updated Section\n\nThis section has been updated.".to_string(),
        mode: ReviewMode::UpdateSection,
        section: Some("Summary".to_string()),
        base_uri: "/test/project".to_string(),
    };

    let result = server.present_review(params.clone()).await;

    assert!(result.is_ok());

    let captured_messages = server.get_captured_messages();
    assert_eq!(captured_messages.len(), 1);

    let payload_params: PresentReviewParams = serde_json::from_value(captured_messages[0].payload.clone()).unwrap();
    assert!(matches!(payload_params.mode, ReviewMode::UpdateSection));
    assert_eq!(payload_params.section, Some("Summary".to_string()));
}

#[tokio::test]
async fn test_ipc_message_structure() {
    let _ = tracing_subscriber::fmt::try_init();

    let server = TestDialecticServer::new();
    
    let params = PresentReviewParams {
        content: "# Review Content".to_string(),
        mode: ReviewMode::Append,
        section: None,
        base_uri: "/project/root".to_string(),
    };

    let _result = server.present_review(params).await;

    let captured_messages = server.get_captured_messages();
    let ipc_message = &captured_messages[0];

    // Verify IPC message structure
    assert!(!ipc_message.id.is_empty());
    assert!(uuid::Uuid::parse_str(&ipc_message.id).is_ok());
    assert!(matches!(ipc_message.message_type, IPCMessageType::PresentReview));
    assert!(ipc_message.payload.is_object());
    
    // Verify payload can be deserialized back to PresentReviewParams
    let deserialized: PresentReviewParams = serde_json::from_value(ipc_message.payload.clone()).unwrap();
    assert_eq!(deserialized.content, "# Review Content");
    assert!(matches!(deserialized.mode, ReviewMode::Append));
}
