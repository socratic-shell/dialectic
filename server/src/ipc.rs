//! IPC communication module for Dialectic MCP Server
//!
//! Handles Unix socket/named pipe communication with the VSCode extension.
//! Ports the logic from server/src/ipc.ts to Rust with cross-platform support.

use crate::types::{
    FindAllReferencesPayload, GetSelectionResult, GoodbyePayload, IPCMessage, IPCMessageType,
    LogLevel, LogParams, PoloPayload, PresentReviewParams, PresentReviewResult,
    ResolveSymbolByNamePayload, ResponsePayload, SyntheticPRPayload, UserFeedbackPayload,
};
use futures::FutureExt;
use serde_json;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{Mutex, oneshot};
use tracing::{debug, error, info, trace, warn};
use uuid::Uuid;

/// Errors that can occur during IPC communication
#[derive(Error, Debug)]
pub enum IPCError {
    #[error("Environment variable DIALECTIC_IPC_PATH not set")]
    MissingEnvironmentVariable,

    #[error("Failed to connect to socket/pipe at {path}: {source}")]
    ConnectionFailed {
        path: String,
        source: std::io::Error,
    },

    #[error("IPC connection not established")]
    NotConnected,

    #[error("Failed to serialize message: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Failed to write to IPC connection: {0}")]
    WriteError(#[from] std::io::Error),

    #[error("Request timeout after 5 seconds")]
    Timeout,

    #[error("Response channel closed")]
    ChannelClosed,
}

pub type Result<T> = std::result::Result<T, IPCError>;

/// Handles IPC communication between MCP server and VSCode extension
///
/// Mirrors the TypeScript IPCCommunicator class but leverages Rust's
/// type safety and async/await patterns. Uses Arc<Mutex<>> for thread safety
/// since the MCP server requires Clone.
#[derive(Clone)]
pub struct IPCCommunicator {
    inner: Arc<Mutex<IPCCommunicatorInner>>,

    /// When true, disables actual IPC communication and uses only local logging.
    /// Used during unit testing to avoid requiring a running VSCode extension.
    /// Set to false in production to enable real IPC communication with VSCode.
    test_mode: bool,
}

struct IPCCommunicatorInner {
    /// Write half of the Unix socket connection to VSCode extension
    write_half: Option<Arc<Mutex<tokio::net::unix::OwnedWriteHalf>>>,

    /// Tracks outgoing requests awaiting responses from VSCode extension
    /// Key: unique message ID (UUID), Value: channel to send response back to caller
    /// Enables concurrent request/response handling with proper correlation
    pending_requests: HashMap<String, oneshot::Sender<ResponsePayload>>,

    /// Tracks pending user feedback requests for blocking MCP tools
    /// Key: review_id, Value: channel to send UserFeedback back to caller
    pending_feedback: HashMap<String, oneshot::Sender<crate::synthetic_pr::UserFeedback>>,

    /// Flag to track if we have an active connection and reader task
    /// When true, ensure_connection() is a no-op
    connected: bool,

    /// VSCode process PID discovered during initialization
    /// Used to construct socket path: /tmp/dialectic-vscode-{vscode_pid}.sock
    vscode_pid: u32,

    /// Terminal shell PID for this MCP server instance
    /// Reported to extension during handshake for smart terminal selection
    terminal_shell_pid: u32,
}

impl IPCCommunicator {
    pub async fn new(vscode_pid: u32, shell_pid: u32) -> Result<Self> {
        info!("Creating IPC communicator for VSCode PID {vscode_pid} and shell PID {shell_pid}");

        Ok(Self {
            inner: Arc::new(Mutex::new(IPCCommunicatorInner {
                write_half: None,
                pending_requests: HashMap::new(),
                pending_feedback: HashMap::new(),
                connected: false,
                vscode_pid,
                terminal_shell_pid: shell_pid,
            })),
            test_mode: false,
        })
    }

    /// Creates a new IPCCommunicator in test mode
    /// In test mode, all IPC operations are mocked and only local logging occurs
    pub fn new_test() -> Self {
        Self {
            inner: Arc::new(Mutex::new(IPCCommunicatorInner {
                write_half: None,
                pending_requests: HashMap::new(),
                pending_feedback: HashMap::new(),
                connected: false,
                vscode_pid: 0,         // Dummy PID for test mode
                terminal_shell_pid: 0, // Dummy PID for test mode
            })),
            test_mode: true,
        }
    }

    pub async fn initialize(&mut self) -> Result<()> {
        if self.test_mode {
            info!("IPC Communicator initialized (test mode)");
            return Ok(());
        }

        // Use ensure_connection for initial connection
        IPCCommunicatorInner::ensure_connection(Arc::clone(&self.inner)).await?;

        info!("Connected to message bus daemon via IPC");
        Ok(())
    }

    pub async fn present_review(&self, params: PresentReviewParams) -> Result<PresentReviewResult> {
        if self.test_mode {
            info!("Present review called (test mode): {:?}", params);
            return Ok(PresentReviewResult {
                success: true,
                message: Some("Review successfully displayed (test mode)".to_string()),
            });
        }

        // Ensure connection is established before proceeding
        IPCCommunicatorInner::ensure_connection(Arc::clone(&self.inner)).await?;

        // Create message payload
        let payload = serde_json::to_value(params)?;

        let shell_pid = {
            let inner = self.inner.lock().await;
            inner.terminal_shell_pid
        };

        let message = IPCMessage {
            shell_pid,
            message_type: IPCMessageType::PresentReview,
            payload,
            id: Uuid::new_v4().to_string(),
        };

        debug!("Sending present_review message: {:?}", message);
        trace!("About to call send_message_with_reply for present_review");

        let response = self.send_message_with_reply(message).await?;

        trace!(
            "Received response from send_message_with_reply: {:?}",
            response
        );

        // Convert response to PresentReviewResult
        Ok(PresentReviewResult {
            success: response.success,
            message: response.error.or_else(|| {
                if response.success {
                    Some("Review successfully displayed".to_string())
                } else {
                    Some("Unknown error".to_string())
                }
            }),
        })
    }

    pub async fn get_selection(&self) -> Result<GetSelectionResult> {
        if self.test_mode {
            info!("Get selection called (test mode)");
            return Ok(GetSelectionResult {
                selected_text: None,
                file_path: None,
                start_line: None,
                start_column: None,
                end_line: None,
                end_column: None,
                line_number: None,
                document_language: None,
                is_untitled: None,
                message: Some("No selection available (test mode)".to_string()),
            });
        }

        // Ensure connection is established before proceeding
        IPCCommunicatorInner::ensure_connection(Arc::clone(&self.inner)).await?;

        // Create message payload with shell PID for multi-window filtering
        let shell_pid = {
            let inner = self.inner.lock().await;
            inner.terminal_shell_pid
        };

        let message = IPCMessage {
            shell_pid,
            message_type: IPCMessageType::GetSelection,
            payload: serde_json::json!({}),
            id: Uuid::new_v4().to_string(),
        };

        debug!("Sending get_selection message: {:?}", message);

        let response = self.send_message_with_reply(message).await?;

        if let Some(data) = response.data {
            let selection: GetSelectionResult = serde_json::from_value(data)?;
            Ok(selection)
        } else {
            Ok(GetSelectionResult {
                selected_text: None,
                file_path: None,
                start_line: None,
                start_column: None,
                end_line: None,
                end_column: None,
                line_number: None,
                document_language: None,
                is_untitled: None,
                message: Some("No selection data in response".to_string()),
            })
        }
    }

    pub async fn send_log(&self, level: LogLevel, message: String) {
        // Always log locally using Rust logging infrastructure
        match level {
            LogLevel::Info => info!("{}", message),
            LogLevel::Error => error!("{}", message),
            LogLevel::Debug => debug!("{}", message),
        }

        // In test mode, only do local logging
        if self.test_mode {
            return;
        }

        // Also send to VSCode extension via IPC for unified logging
        let log_params = LogParams { level, message };

        // Create message payload with shell PID added for multi-window filtering
        let payload = match serde_json::to_value(log_params) {
            Ok(payload) => payload,
            Err(e) => {
                error!("Failed to serialize log message: {}", e);
                return;
            }
        };

        let shell_pid = {
            let inner = self.inner.lock().await;
            inner.terminal_shell_pid
        };

        let ipc_message = IPCMessage {
            shell_pid,
            message_type: IPCMessageType::Log,
            payload,
            id: Uuid::new_v4().to_string(),
        };

        // For log messages, we don't need to wait for response
        // Just send and continue (fire-and-forget)
        if let Err(e) = self.send_message_without_reply(ipc_message).await {
            // If IPC fails, we still have local logging above
            debug!("Failed to send log via IPC: {}", e);
        }
    }

    /// Send Marco discovery message. In normal workflow,
    /// this is actually sent by the *extension* to broadcast
    /// "who's out there?" -- but we include it for testing purposes.
    pub async fn send_marco(&self) -> Result<()> {
        if self.test_mode {
            info!("Marco discovery message sent (test mode)");
            return Ok(());
        }

        let message = IPCMessage {
            shell_pid: 0, // Marco messages are broadcasts, no specific shell PID
            message_type: IPCMessageType::Marco,
            payload: serde_json::json!({}),
            id: Uuid::new_v4().to_string(),
        };

        debug!("Sending Marco discovery message");
        self.send_message_without_reply(message).await
    }

    /// Send Polo discovery message (MCP server announces presence with shell PID)
    pub async fn send_polo(&self, terminal_shell_pid: u32) -> Result<()> {
        if self.test_mode {
            info!(
                "Polo discovery message sent (test mode) with shell PID: {}",
                terminal_shell_pid
            );
            return Ok(());
        }

        let payload = PoloPayload {};
        let message = IPCMessage {
            shell_pid: terminal_shell_pid,
            message_type: IPCMessageType::Polo,
            payload: serde_json::to_value(payload)?,
            id: Uuid::new_v4().to_string(),
        };

        debug!(
            "Sending Polo discovery message with shell PID: {}",
            terminal_shell_pid
        );
        self.send_message_without_reply(message).await
    }

    /// Send Goodbye discovery message (MCP server announces departure with shell PID)
    pub async fn send_goodbye(&self, terminal_shell_pid: u32) -> Result<()> {
        if self.test_mode {
            info!(
                "Goodbye discovery message sent (test mode) with shell PID: {}",
                terminal_shell_pid
            );
            return Ok(());
        }

        let payload = GoodbyePayload {};
        let message = IPCMessage {
            shell_pid: terminal_shell_pid,
            message_type: IPCMessageType::Goodbye,
            payload: serde_json::to_value(payload)?,
            id: Uuid::new_v4().to_string(),
        };

        debug!(
            "Sending Goodbye discovery message with shell PID: {}",
            terminal_shell_pid
        );
        self.send_message_without_reply(message).await
    }

    /// Send synthetic PR data to VSCode extension
    pub async fn send_create_synthetic_pr(&self, review_response: &crate::synthetic_pr::ReviewResponse) -> Result<()> {
        if self.test_mode {
            info!("Synthetic PR creation message sent (test mode)");
            return Ok(());
        }

        let shell_pid = {
            let inner_guard = self.inner.lock().await;
            inner_guard.terminal_shell_pid
        };

        let payload = crate::types::SyntheticPRPayload {
            review_id: review_response.review_id.clone(),
            title: review_response.title.clone(),
            description: review_response.description.clone(),
            commit_range: review_response.commit_range.clone(),
            files_changed: review_response.files_changed.clone(),
            comment_threads: review_response.comment_threads.clone(),
            status: review_response.status.clone(),
        };

        let message = IPCMessage {
            shell_pid,
            message_type: IPCMessageType::CreateSyntheticPr,
            payload: serde_json::to_value(payload)?,
            id: Uuid::new_v4().to_string(),
        };

        debug!("Sending create_synthetic_pr message for review: {}", review_response.review_id);
        self.send_message_without_reply(message).await
    }

    /// Wait for user feedback on a specific review
    /// This method blocks until the user provides feedback via the VSCode extension
    pub async fn wait_for_user_feedback(&self, review_id: &str) -> Result<crate::synthetic_pr::UserFeedback> {
        if self.test_mode {
            info!("Wait for user feedback called (test mode) for review: {}", review_id);
            // Return mock feedback for testing
            return Ok(crate::synthetic_pr::UserFeedback {
                review_id: Some(review_id.to_string()),
                feedback_type: "comment".to_string(),
                file_path: Some("test.rs".to_string()),
                line_number: Some(42),
                comment_text: Some("This is a test comment".to_string()),
                completion_action: None,
                additional_notes: None,
                context_lines: Some(vec!["fn test() {".to_string(), "    // Line 42".to_string(), "}".to_string()]),
            });
        }

        // Create a channel to receive the user feedback
        let (sender, receiver) = oneshot::channel();

        // Register the pending feedback request
        {
            let mut inner = self.inner.lock().await;
            inner.pending_feedback.insert(review_id.to_string(), sender);
        }

        info!("Waiting for user feedback on review: {}", review_id);

        // Block until user feedback arrives via IPC message
        match receiver.await {
            Ok(feedback) => {
                info!("Received user feedback for review: {}", review_id);
                Ok(feedback)
            }
            Err(_) => {
                // Channel was dropped, remove from pending requests
                let mut inner = self.inner.lock().await;
                inner.pending_feedback.remove(review_id);
                Err(IPCError::ConnectionFailed {
                    path: "user_feedback".to_string(),
                    source: std::io::Error::new(std::io::ErrorKind::BrokenPipe, "User feedback channel closed")
                })
            }
        }
    }

    /// Gracefully shutdown the IPC communicator, sending Goodbye discovery message
    pub async fn shutdown(&self) -> Result<()> {
        if self.test_mode {
            info!("IPC shutdown (test mode)");
            return Ok(());
        }

        let shell_pid = {
            let inner_guard = self.inner.lock().await;
            inner_guard.terminal_shell_pid
        };

        self.send_goodbye(shell_pid).await?;
        info!("Sent Goodbye discovery message during shutdown");
        Ok(())
    }

    /// Sends an IPC message and waits for a response from VSCode extension
    ///
    /// Sets up response correlation using the message UUID and waits up to 5 seconds
    /// for the background reader task to deliver the matching response.
    /// Uses the underlying `write_message` primitive to send the data.
    async fn send_message_with_reply(&self, message: IPCMessage) -> Result<ResponsePayload> {
        debug!(
            "Sending IPC message with ID: {} (PID: {})",
            message.id,
            std::process::id()
        );

        let (tx, rx) = oneshot::channel();

        // Store the response channel
        {
            let mut inner = self.inner.lock().await;
            trace!("Storing response channel for message ID: {}", message.id);
            inner.pending_requests.insert(message.id.clone(), tx);
            trace!("Pending requests count: {}", inner.pending_requests.len());
        }

        // Send the message
        let message_data = serde_json::to_string(&message)?;
        trace!("Serialized message data: {}", message_data);
        trace!("About to call write_message");

        self.write_message(&message_data).await?;
        trace!("write_message completed successfully");

        trace!("Waiting for response with 5 second timeout...");

        // Wait for response with timeout
        let response = tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .map_err(|_| {
                // Clean up the leaked entry on timeout to fix memory leak
                let inner_clone = Arc::clone(&self.inner);
                let message_id = message.id.clone();
                tokio::spawn(async move {
                    let mut inner = inner_clone.lock().await;
                    inner.pending_requests.remove(&message_id);
                });
                error!("Timeout waiting for response to message ID: {}", message.id);
                IPCError::Timeout
            })?
            .map_err(|_| IPCError::ChannelClosed)?;

        Ok(response)
    }

    /// Sends an IPC message without waiting for a response (fire-and-forget)
    ///
    /// Used for operations like logging where we don't need confirmation from VSCode.
    /// Uses the underlying `write_message` primitive to send the data.
    async fn send_message_without_reply(&self, message: IPCMessage) -> Result<()> {
        let message_data = serde_json::to_string(&message)?;
        self.write_message(&message_data).await
    }

    /// Low-level primitive for writing raw JSON data to the IPC connection (Unix)
    ///
    /// This is the underlying method used by both `send_message_with_reply` and
    /// `send_message_without_reply`. It handles the platform-specific socket writing
    /// and adds newline delimiters for message boundaries.
    ///
    /// ## Known Edge Case: Write Failure Race Condition
    ///
    /// There's a rare race condition where the extension restarts between the time
    /// `ensure_connection()` checks `connected: true` and when this method attempts
    /// to write. In this case:
    ///
    /// 1. `ensure_connection()` sees stale `connected: true` state (reader hasn't detected failure yet)
    /// 2. `write_message()` fails with "Broken pipe" or similar
    /// 3. Error is returned to user (operation fails)
    /// 4. Reader task detects failure and reconnects in background
    /// 5. User's retry succeeds
    ///
    /// This is acceptable because:
    /// - The race window is very small (reader task detects failures quickly)
    /// - The failure is transient and self-healing
    /// - Multiple recovery mechanisms provide eventual consistency
    /// - Adding write error recovery would significantly complicate the code
    async fn write_message(&self, data: &str) -> Result<()> {
        trace!("write_message called with data length: {}", data.len());

        let inner = self.inner.lock().await;
        if let Some(ref write_half) = inner.write_half {
            trace!("Got write half, writing to Unix socket");
            let mut writer = write_half.lock().await;

            trace!("Writing message data to socket");
            writer.write_all(data.as_bytes()).await?;

            trace!("Writing newline delimiter");
            writer.write_all(b"\n").await?; // Add newline delimiter

            trace!("write_message completed successfully");
            Ok(())
        } else {
            error!("write_message called but no connection available");
            Err(IPCError::NotConnected)
        }
    }
}

impl IPCCommunicatorInner {
    /// Ensures connection is established, connecting if necessary
    /// Idempotent - safe to call multiple times, only connects if not already connected
    async fn ensure_connection(this: Arc<Mutex<Self>>) -> Result<()> {
        let mut inner = this.lock().await;
        if inner.connected {
            return Ok(()); // Already connected, nothing to do
        }

        inner.attempt_connection_with_backoff(&this).await
    }

    /// Clears dead connection state and attempts fresh reconnection
    /// Called by reader task as "parting gift" when connection dies
    async fn clear_connection_and_reconnect(this: Arc<Mutex<Self>>) {
        info!("Clearing dead connection state and attempting reconnection");

        let mut inner = this.lock().await;

        // Clean up dead connection state
        inner.connected = false;
        inner.write_half = None;

        // Clean up orphaned pending requests to fix memory leak
        let orphaned_count = inner.pending_requests.len();
        if orphaned_count > 0 {
            warn!("Cleaning up {} orphaned pending requests", orphaned_count);
            inner.pending_requests.clear();
        }

        // Attempt fresh connection
        match inner.attempt_connection_with_backoff(&this).await {
            Ok(()) => {
                info!("Reader task successfully reconnected");
            }
            Err(e) => {
                error!("Reader task failed to reconnect: {}", e);
                info!("Next MCP operation will retry connection");
            }
        }
    }

    /// Attempts connection with exponential backoff to handle extension restart timing
    ///
    /// Runs while holding the lock to avoid races where multiple concurrent attempts
    /// try to re-establish the connection. This ensures only one connection attempt
    /// happens at a time, preventing duplicate reader tasks or connection state corruption.
    async fn attempt_connection_with_backoff(&mut self, this: &Arc<Mutex<Self>>) -> Result<()> {
        // Precondition: we should only be called when disconnected
        assert!(
            !self.connected,
            "attempt_connection_with_backoff called while already connected"
        );
        assert!(
            self.write_half.is_none(),
            "attempt_connection_with_backoff called with existing write_half"
        );

        const MAX_RETRIES: u32 = 5;
        const BASE_DELAY_MS: u64 = 100;

        let socket_path = format!("/tmp/dialectic-daemon-{}.sock", self.vscode_pid);
        info!(
            "Attempting connection to message bus daemon: {}",
            socket_path
        );

        for attempt in 1..=MAX_RETRIES {
            match UnixStream::connect(&socket_path).await {
                Ok(stream) => {
                    info!("Successfully connected on attempt {}", attempt);

                    // Split the stream into read and write halves
                    let (read_half, write_half) = stream.into_split();
                    let write_half = Arc::new(Mutex::new(write_half));

                    // Update connection state (we already hold the lock)
                    self.write_half = Some(Arc::clone(&write_half));
                    self.connected = true;

                    // Spawn new reader task with cloned Arc
                    let inner_clone = Arc::clone(this);
                    tokio::spawn(async move {
                        IPCCommunicator::response_reader_task(read_half, inner_clone).await;
                    });

                    return Ok(());
                }
                Err(e) if attempt < MAX_RETRIES => {
                    let delay = Duration::from_millis(BASE_DELAY_MS * 2_u64.pow(attempt - 1));
                    warn!(
                        "Connection attempt {} failed: {}. Retrying in {:?}",
                        attempt, e, delay
                    );
                    tokio::time::sleep(delay).await;
                }
                Err(e) => {
                    error!("All connection attempts failed. Last error: {}", e);
                    return Err(IPCError::ConnectionFailed {
                        path: socket_path,
                        source: e,
                    }
                    .into());
                }
            }
        }

        unreachable!("Loop should always return or error")
    }
}

impl IPCCommunicator {
    fn response_reader_task(
        mut read_half: tokio::net::unix::OwnedReadHalf,
        inner: Arc<Mutex<IPCCommunicatorInner>>,
    ) -> Pin<Box<dyn Future<Output = ()> + Send>> {
        async move {
            info!("Starting IPC response reader task (Unix)");

            let mut reader = BufReader::new(&mut read_half);

            loop {
                let mut buffer = Vec::new();

                trace!("response_reader_task: About to read from connection");

                // Read a line from the connection
                let read_result = reader.read_until(b'\n', &mut buffer).await;

                match read_result {
                    Ok(0) => {
                        warn!("IPC connection closed by VSCode extension");
                        break;
                    }
                    Ok(_) => {
                        // Remove the newline delimiter
                        if buffer.ends_with(&[b'\n']) {
                            buffer.pop();
                        }

                        let message_str = match String::from_utf8(buffer) {
                            Ok(s) => s,
                            Err(e) => {
                                error!("Received invalid UTF-8 from VSCode extension: {}", e);
                                continue;
                            }
                        };

                        Self::handle_incoming_message(&inner, &message_str).await;
                    }
                    Err(e) => {
                        error!("Error reading from IPC connection: {}", e);
                        break;
                    }
                }
            }

            // Reader task's "parting gift" - attempt reconnection before terminating
            info!("Reader task attempting reconnection as parting gift...");

            // Spawn the reconnection attempt to avoid blocking reader task termination
            let inner_for_reconnect = Arc::clone(&inner);
            tokio::spawn(IPCCommunicatorInner::clear_connection_and_reconnect(
                inner_for_reconnect,
            ));

            info!("IPC response reader task terminated");
        }
        .boxed()
    }

    /// Processes incoming messages from the daemon
    /// Handles both responses to our requests and incoming messages (like Marco)
    async fn handle_incoming_message(inner: &Arc<Mutex<IPCCommunicatorInner>>, message_str: &str) {
        debug!(
            "Received IPC message (PID: {}): {}",
            std::process::id(),
            message_str
        );

        // Parse as unified IPCMessage
        let message: IPCMessage = match serde_json::from_str(message_str) {
            Ok(msg) => msg,
            Err(e) => {
                error!(
                    "Failed to parse incoming message: {} - Message: {}",
                    e, message_str
                );
                return;
            }
        };

        match message.message_type {
            IPCMessageType::Response => {
                // Handle response to our request
                let response_payload: ResponsePayload =
                    match serde_json::from_value(message.payload) {
                        Ok(payload) => payload,
                        Err(e) => {
                            error!("Failed to parse response payload: {}", e);
                            return;
                        }
                    };

                let mut inner_guard = inner.lock().await;
                if let Some(sender) = inner_guard.pending_requests.remove(&message.id) {
                    if let Err(_) = sender.send(response_payload) {
                        warn!("Failed to send response to caller - receiver dropped");
                    }
                } else {
                    // Every message (including the ones we send...) gets rebroadcast to everyone,
                    // so this is (hopefully) to some other MCP server. Just ignore it.
                    debug!(
                        "Received response for unknown request ID: {} (PID: {})",
                        message.id,
                        std::process::id()
                    );
                }
            }
            IPCMessageType::Marco => {
                info!("Received Marco discovery message, responding with Polo");

                // Get shell PID from inner state
                let shell_pid = {
                    let inner_guard = inner.lock().await;
                    inner_guard.terminal_shell_pid
                };

                // Create a temporary IPCCommunicator to send Polo response
                let temp_communicator = IPCCommunicator {
                    inner: Arc::clone(inner),
                    test_mode: false,
                };

                if let Err(e) = temp_communicator.send_polo(shell_pid).await {
                    error!("Failed to send Polo response to Marco: {}", e);
                }
            }
            IPCMessageType::UserFeedback => {
                info!("Received user feedback message");

                // Parse the user feedback payload
                let feedback_payload: UserFeedbackPayload = match serde_json::from_value(message.payload) {
                    Ok(payload) => payload,
                    Err(e) => {
                        error!("Failed to parse user feedback payload: {}", e);
                        return;
                    }
                };

                // Convert to UserFeedback struct
                let user_feedback = crate::synthetic_pr::UserFeedback {
                    review_id: Some(feedback_payload.review_id.clone()),
                    feedback_type: feedback_payload.feedback_type,
                    file_path: feedback_payload.file_path,
                    line_number: feedback_payload.line_number,
                    comment_text: feedback_payload.comment_text,
                    completion_action: feedback_payload.completion_action,
                    additional_notes: feedback_payload.additional_notes,
                    context_lines: feedback_payload.context_lines,
                };

                // Send to waiting MCP tool
                let mut inner_guard = inner.lock().await;
                if let Some(sender) = inner_guard.pending_feedback.remove(&feedback_payload.review_id) {
                    if let Err(_) = sender.send(user_feedback) {
                        warn!("Failed to send user feedback to waiting MCP tool - receiver dropped");
                    }
                } else {
                    warn!("Received user feedback for unknown review ID: {}", feedback_payload.review_id);
                }
            }
            _ => {
                // Every message (including the ones we send...) gets rebroadcast to everyone,
                // so we can just ignore anything else.
                debug!(
                    "Received unhandled message type: {:?}",
                    message.message_type
                );
            }
        }
    }
}

// Implementation of IpcClient trait for IDE operations
impl crate::ide::IpcClient for IPCCommunicator {
    async fn resolve_symbol_by_name(
        &mut self,
        name: &str,
    ) -> anyhow::Result<Vec<crate::ide::SymbolDef>> {
        if self.test_mode {
            // Return empty result in test mode
            return Ok(vec![]);
        }

        let payload = ResolveSymbolByNamePayload {
            name: name.to_string(),
        };

        let shell_pid = {
            let inner = self.inner.lock().await;
            inner.terminal_shell_pid
        };

        let message = IPCMessage {
            shell_pid,
            message_type: IPCMessageType::ResolveSymbolByName,
            payload: serde_json::to_value(payload)?,
            id: Uuid::new_v4().to_string(),
        };

        let response = self.send_message_with_reply(message).await?;

        if !response.success {
            return Err(anyhow::anyhow!(
                "VSCode extension failed to resolve symbol '{}': {}",
                name,
                response
                    .error
                    .unwrap_or_else(|| "Unknown error".to_string())
            ));
        }

        // Parse the response data as Vec<ResolvedSymbol>
        let symbols: Vec<crate::ide::SymbolDef> = match response.data {
            Some(data) => serde_json::from_value(data)?,
            None => vec![],
        };

        Ok(symbols)
    }

    async fn find_all_references(
        &mut self,
        symbol: &crate::ide::SymbolDef,
    ) -> anyhow::Result<Vec<crate::ide::FileRange>> {
        if self.test_mode {
            // Return empty result in test mode
            return Ok(vec![]);
        }

        let payload = FindAllReferencesPayload {
            symbol: symbol.clone(),
        };

        let shell_pid = {
            let inner = self.inner.lock().await;
            inner.terminal_shell_pid
        };

        let message = IPCMessage {
            shell_pid,
            message_type: IPCMessageType::FindAllReferences,
            payload: serde_json::to_value(payload)?,
            id: Uuid::new_v4().to_string(),
        };

        let response = self.send_message_with_reply(message).await?;

        if !response.success {
            return Err(anyhow::anyhow!(
                "VSCode extension failed to find references for symbol '{}': {}",
                symbol.name,
                response
                    .error
                    .unwrap_or_else(|| "Unknown error".to_string())
            ));
        }

        // Parse the response data as Vec<FileLocation>
        let locations: Vec<crate::ide::FileRange> = match response.data {
            Some(data) => serde_json::from_value(data)?,
            None => vec![],
        };

        Ok(locations)
    }
}

#[cfg(test)]
mod test {
    //! Integration tests for Dialectic MCP Server
    //!
    //! Tests the IPC communication layer and message structure

    use crate::ipc::IPCCommunicator;
    use crate::types::{IPCMessage, IPCMessageType, PresentReviewParams, ReviewMode};
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
            shell_pid: 12345,
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
}
