//! Integration tests for Dialectic MCP Server
//! 
//! Tests the IPC communication layer and message structure

use dialectic_mcp_server::types::{IPCMessage, IPCMessageType, PresentReviewParams, ReviewMode};
use dialectic_mcp_server::ipc::IPCCommunicator;
use serde_json;

#[tokio::test]
async fn test_ipc_communicator_test_mode() {
    // Initialize tracing for test output
    let _ = tracing_subscriber::fmt::try_init();

    // Create IPC communicator in test mode
    let ipc = IPCCommunicator::new_test();
    
    let params = PresentReviewParams {
        content: "# Test Review\n\nThis is a test review with some content.".to_string(),
        mode: ReviewMode::Replace,
        section: None,
        base_uri: "/test/project".to_string(),
    };

    // Test present_review in test mode
    let result = ipc.present_review(params).await;
    assert!(result.is_ok());
    
    let review_result = result.unwrap();
    assert!(review_result.success);
    assert!(review_result.message.is_some());
    assert!(review_result.message.unwrap().contains("test mode"));
}

#[tokio::test]
async fn test_get_selection_test_mode() {
    let _ = tracing_subscriber::fmt::try_init();

    let ipc = IPCCommunicator::new_test();
    
    // Test get_selection in test mode
    let result = ipc.get_selection().await;
    assert!(result.is_ok());
    
    let selection_result = result.unwrap();
    assert!(selection_result.selected_text.is_none());
    assert!(selection_result.message.is_some());
    assert!(selection_result.message.unwrap().contains("test mode"));
}

#[tokio::test]
async fn test_present_review_with_update_section_mode() {
    let _ = tracing_subscriber::fmt::try_init();

    let ipc = IPCCommunicator::new_test();
    
    let params = PresentReviewParams {
        content: "## Updated Section\n\nThis section has been updated.".to_string(),
        mode: ReviewMode::UpdateSection,
        section: Some("Summary".to_string()),
        base_uri: "/test/project".to_string(),
    };

    let result = ipc.present_review(params).await;
    assert!(result.is_ok());
    
    let review_result = result.unwrap();
    assert!(review_result.success);
}

#[tokio::test]
async fn test_ipc_message_structure() {
    let _ = tracing_subscriber::fmt::try_init();

    // This test verifies that the IPC message structure is correct
    use uuid::Uuid;
    
    let params = PresentReviewParams {
        content: "# Review Content".to_string(),
        mode: ReviewMode::Append,
        section: None,
        base_uri: "/project/root".to_string(),
    };

    // Create an IPC message like the server would
    let message = IPCMessage {
        message_type: IPCMessageType::PresentReview,
        payload: serde_json::to_value(&params).unwrap(),
        id: Uuid::new_v4().to_string(),
    };

    // Verify IPC message structure
    assert!(!message.id.is_empty());
    assert!(Uuid::parse_str(&message.id).is_ok());
    assert!(matches!(message.message_type, IPCMessageType::PresentReview));
    assert!(message.payload.is_object());
    
    // Verify payload can be deserialized back to PresentReviewParams
    let deserialized: PresentReviewParams = serde_json::from_value(message.payload.clone()).unwrap();
    assert_eq!(deserialized.content, "# Review Content");
    assert!(matches!(deserialized.mode, ReviewMode::Append));
    assert_eq!(deserialized.base_uri, "/project/root");
}
