//! Integration tests for Dialectic MCP Server
//!
//! Tests the IPC communication layer and message structure

use dialectic_mcp_server::ipc::IPCCommunicator;
use dialectic_mcp_server::types::{IPCMessage, IPCMessageType, PresentReviewParams, ReviewMode};
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
    assert!(matches!(
        message.message_type,
        IPCMessageType::PresentReview
    ));
    assert!(message.payload.is_object());

    // Verify payload can be deserialized back to PresentReviewParams
    let deserialized: PresentReviewParams =
        serde_json::from_value(message.payload.clone()).unwrap();
    assert_eq!(deserialized.content, "# Review Content");
    assert!(matches!(deserialized.mode, ReviewMode::Append));
    assert_eq!(deserialized.base_uri, "/project/root");
}

#[tokio::test]
async fn test_daemon_message_broadcasting() {
    use dialectic_mcp_server::daemon::run_daemon_with_prefix;
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixStream;
    use tokio::sync::Barrier;
    use tokio::time::{timeout, Duration};
    use uuid::Uuid;

    // Initialize tracing for test output
    let _ = tracing_subscriber::fmt::try_init();

    // Use current process PID so daemon won't exit due to "VSCode died"
    let test_pid = std::process::id();
    // Use UUID to ensure unique socket path per test run
    let test_id = Uuid::new_v4();
    let socket_prefix = format!("dialectic-test-{}", test_id);
    let socket_path = format!("/tmp/{}-{}.sock", socket_prefix, test_pid);

    // Clean up any existing socket
    let _ = std::fs::remove_file(&socket_path);

    // Barrier for coordinating when daemon is ready (2 participants: daemon + test)
    let ready_barrier = Arc::new(Barrier::new(2));
    // Barrier for coordinating when both clients are connected and ready (2 participants: clients)
    let client_barrier = Arc::new(Barrier::new(2));

    // Start the full daemon with unique prefix and ready barrier
    let ready_barrier_clone = ready_barrier.clone();
    let daemon_handle = tokio::spawn(async move {
        run_daemon_with_prefix(test_pid, &socket_prefix, Some(ready_barrier_clone)).await
    });

    // Wait for daemon to be ready
    ready_barrier.wait().await;

    // Verify socket was created
    assert!(
        std::path::Path::new(&socket_path).exists(),
        "Daemon should create socket file"
    );

    // Test: Connect two clients and verify message broadcasting
    let socket_path_1 = socket_path.clone();
    let barrier_1 = client_barrier.clone();
    let client1_handle = tokio::spawn(async move {
        let mut stream = UnixStream::connect(&socket_path_1)
            .await
            .expect("Client 1 failed to connect");

        // Wait at barrier until both clients are connected
        barrier_1.wait().await;

        // Client 1 sends first, then waits for response
        stream
            .write_all(b"Hello from client 1\n")
            .await
            .expect("Failed to send message");
        stream.flush().await.expect("Failed to flush");

        // Read response from client 2
        let mut reader = BufReader::new(&mut stream);
        let mut response = String::new();

        match timeout(Duration::from_secs(2), reader.read_line(&mut response)).await {
            Ok(Ok(_)) => response.trim().to_string(),
            _ => "NO_RESPONSE".to_string(),
        }
    });

    let socket_path_2 = socket_path.clone();
    let barrier_2 = client_barrier.clone();
    let client2_handle = tokio::spawn(async move {
        let mut stream = UnixStream::connect(&socket_path_2)
            .await
            .expect("Client 2 failed to connect");

        // Wait at barrier until both clients are connected
        barrier_2.wait().await;

        // Client 2 waits to receive message from client 1, then responds
        let mut reader = BufReader::new(&mut stream);
        let mut message = String::new();

        let received = match timeout(Duration::from_secs(2), reader.read_line(&mut message)).await {
            Ok(Ok(_)) => message.trim().to_string(),
            _ => "NO_MESSAGE".to_string(),
        };

        // Send response back to client 1
        stream
            .write_all(b"Hello from client 2\n")
            .await
            .expect("Failed to send response");
        stream.flush().await.expect("Failed to flush");

        received
    });

    // Wait for both clients to complete
    let (client1_response, client2_received) = tokio::join!(client1_handle, client2_handle);

    // Verify message broadcasting worked
    let client1_response = client1_response.expect("Client 1 task failed");
    let client2_received = client2_received.expect("Client 2 task failed");

    // Client 2 should always receive the message from Client 1
    assert_eq!(
        client2_received, "Hello from client 1",
        "Client 2 should receive message from Client 1"
    );

    // Client 1 might receive either its own message (due to broadcast) or Client 2's response
    // Both are valid in a broadcast system - this verifies the broadcast mechanism works
    assert!(
        client1_response == "Hello from client 1" || client1_response == "Hello from client 2",
        "Client 1 should receive either its own message or Client 2's response, got: '{}'",
        client1_response
    );

    // Clean up
    daemon_handle.abort();
}

#[tokio::test]
async fn test_daemon_multiple_clients() {
    use dialectic_mcp_server::daemon::run_daemon_with_prefix;
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::UnixStream;
    use tokio::sync::Barrier;
    use tokio::time::{timeout, Duration};
    use uuid::Uuid;

    // Initialize tracing for test output
    let _ = tracing_subscriber::fmt::try_init();

    // Use current process PID
    let test_pid = std::process::id();
    // Use UUID to ensure unique socket path per test run
    let test_id = Uuid::new_v4();
    let socket_prefix = format!("dialectic-test-{}", test_id);
    let socket_path = format!("/tmp/{}-{}.sock", socket_prefix, test_pid);

    // Clean up any existing socket
    let _ = std::fs::remove_file(&socket_path);

    // Barrier for coordinating when daemon is ready (2 participants: daemon + test)
    let ready_barrier = Arc::new(Barrier::new(2));
    // Barrier for coordinating when all clients are connected (1 sender + 2 receivers = 3)
    let client_barrier = Arc::new(Barrier::new(3));

    // Start the full daemon with unique prefix and ready barrier
    let ready_barrier_clone = ready_barrier.clone();
    let daemon_handle = tokio::spawn(async move {
        run_daemon_with_prefix(test_pid, &socket_prefix, Some(ready_barrier_clone)).await
    });

    // Wait for daemon to be ready
    ready_barrier.wait().await;

    // Verify socket was created
    assert!(
        std::path::Path::new(&socket_path).exists(),
        "Daemon should create socket file"
    );

    // Test: One sender, multiple receivers
    let socket_path_sender = socket_path.clone();
    let barrier_sender = client_barrier.clone();
    let sender_handle = tokio::spawn(async move {
        let mut stream = UnixStream::connect(&socket_path_sender)
            .await
            .expect("Sender failed to connect");

        // Wait at barrier until all clients are connected
        barrier_sender.wait().await;

        // All clients are now connected and ready, send broadcast message
        stream
            .write_all(b"Broadcast message\n")
            .await
            .expect("Failed to send message");
        stream.flush().await.expect("Failed to flush");
    });

    let socket_path_r1 = socket_path.clone();
    let barrier_r1 = client_barrier.clone();
    let receiver1_handle = tokio::spawn(async move {
        let mut stream = UnixStream::connect(&socket_path_r1)
            .await
            .expect("Receiver 1 failed to connect");

        // Wait at barrier until all clients are connected
        barrier_r1.wait().await;

        // Wait for broadcast message from sender
        let mut reader = BufReader::new(&mut stream);
        let mut message = String::new();

        match timeout(Duration::from_secs(2), reader.read_line(&mut message)).await {
            Ok(Ok(_)) => message.trim().to_string(),
            _ => "NO_MESSAGE".to_string(),
        }
    });

    let socket_path_r2 = socket_path.clone();
    let barrier_r2 = client_barrier.clone();
    let receiver2_handle = tokio::spawn(async move {
        let mut stream = UnixStream::connect(&socket_path_r2)
            .await
            .expect("Receiver 2 failed to connect");

        // Wait at barrier until all clients are connected
        barrier_r2.wait().await;

        // Wait for broadcast message from sender
        let mut reader = BufReader::new(&mut stream);
        let mut message = String::new();

        match timeout(Duration::from_secs(2), reader.read_line(&mut message)).await {
            Ok(Ok(_)) => message.trim().to_string(),
            _ => "NO_MESSAGE".to_string(),
        }
    });

    // Wait for all tasks
    let (_, receiver1_msg, receiver2_msg) =
        tokio::join!(sender_handle, receiver1_handle, receiver2_handle);

    // Verify both receivers got the message
    let receiver1_msg = receiver1_msg.expect("Receiver 1 task failed");
    let receiver2_msg = receiver2_msg.expect("Receiver 2 task failed");

    assert_eq!(
        receiver1_msg, "Broadcast message",
        "Receiver 1 should get broadcast"
    );
    assert_eq!(
        receiver2_msg, "Broadcast message",
        "Receiver 2 should get broadcast"
    );

    // Clean up
    daemon_handle.abort();
}

#[tokio::test]
async fn test_daemon_socket_claiming() {
    use dialectic_mcp_server::daemon::run_daemon_with_prefix;
    use std::sync::Arc;
    use tokio::sync::Barrier;
    use uuid::Uuid;

    // Initialize tracing for test output
    let _ = tracing_subscriber::fmt::try_init();

    // Use actual test process PID (so daemon won't exit due to "process died")
    let test_pid = std::process::id();
    // Use UUID to ensure unique socket path per test run
    let test_id = Uuid::new_v4();
    let socket_prefix = format!("dialectic-test-{}", test_id);
    let socket_path = format!("/tmp/{}-{}.sock", socket_prefix, test_pid);

    // Clean up any existing socket
    let _ = std::fs::remove_file(&socket_path);

    // Barrier for coordinating when first daemon is ready (2 participants: daemon + test)
    let ready_barrier = Arc::new(Barrier::new(2));

    // Start first daemon with ready barrier
    let socket_prefix_1 = socket_prefix.clone();
    let ready_barrier_clone = ready_barrier.clone();
    let daemon1_handle = tokio::spawn(async move {
        run_daemon_with_prefix(test_pid, &socket_prefix_1, Some(ready_barrier_clone)).await
    });

    // Wait for first daemon to be ready
    ready_barrier.wait().await;

    // Verify socket was created
    assert!(
        std::path::Path::new(&socket_path).exists(),
        "First daemon should create socket file"
    );

    // Try to start second daemon with same PID and prefix (should fail)
    let socket_prefix_2 = socket_prefix.clone();
    let daemon2_result =
        tokio::spawn(async move { run_daemon_with_prefix(test_pid, &socket_prefix_2, None).await })
            .await;

    // Second daemon should fail due to socket conflict
    assert!(daemon2_result.is_ok(), "Task should complete");
    let daemon2_inner_result = daemon2_result.unwrap();
    assert!(
        daemon2_inner_result.is_err(),
        "Second daemon should fail due to socket conflict"
    );

    // Clean up first daemon
    daemon1_handle.abort();
}
