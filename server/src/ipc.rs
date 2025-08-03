//! IPC communication module for Dialectic MCP Server
//! 
//! Handles Unix socket/named pipe communication with the VSCode extension.
//! Ports the logic from server/src/ipc.ts to Rust with cross-platform support.

use serde_json;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use tokio::io::{AsyncWriteExt, AsyncBufReadExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::{oneshot, Mutex};
use tracing::{info, error, debug, warn, trace};
use uuid::Uuid;

use crate::types::{
    IPCMessage, IPCResponse, IPCMessageType, PresentReviewParams, PresentReviewResult,
    LogParams, LogLevel, GetSelectionResult
};
use crate::pid_discovery;

/// Errors that can occur during IPC communication
#[derive(Error, Debug)]
pub enum IPCError {
    #[error("Environment variable DIALECTIC_IPC_PATH not set")]
    MissingEnvironmentVariable,
    
    #[error("Failed to discover VSCode PID: {0}")]
    PidDiscoveryFailed(String),
    
    #[error("Failed to connect to socket/pipe at {path}: {source}")]
    ConnectionFailed { path: String, source: std::io::Error },
    
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
    pending_requests: HashMap<String, oneshot::Sender<IPCResponse>>,
    
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
    pub async fn new() -> Result<Self> {
        // Perform PID discovery once during construction
        let current_pid = std::process::id();
        info!("Starting PID discovery from MCP server PID: {}", current_pid);

        let (vscode_pid, terminal_shell_pid) = match pid_discovery::find_vscode_pid_from_mcp(current_pid).await {
            Ok(Some((vscode_pid, terminal_shell_pid))) => {
                info!("Discovered VSCode PID: {}, Terminal Shell PID: {}", vscode_pid, terminal_shell_pid);
                (vscode_pid, terminal_shell_pid)
            }
            Ok(None) => {
                let error_msg = "Could not find VSCode PID in process tree. \
                                 Ensure MCP server is running from a VSCode terminal.";
                error!("{}", error_msg);
                return Err(IPCError::PidDiscoveryFailed(error_msg.to_string()).into());
            }
            Err(e) => {
                let error_msg = format!("PID discovery failed: {}", e);
                error!("{}", error_msg);
                return Err(IPCError::PidDiscoveryFailed(error_msg).into());
            }
        };

        Ok(Self {
            inner: Arc::new(Mutex::new(IPCCommunicatorInner {
                write_half: None,
                pending_requests: HashMap::new(),
                connected: false,
                vscode_pid,
                terminal_shell_pid,
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
                connected: false,
                vscode_pid: 0, // Dummy PID for test mode
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
        
        info!("Connected to VSCode extension via IPC");
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

        let message = IPCMessage {
            message_type: IPCMessageType::PresentReview,
            payload: serde_json::to_value(params)?,
            id: Uuid::new_v4().to_string(),
        };

        debug!("Sending present_review message: {:?}", message);
        trace!("About to call send_message_with_reply for present_review");

        let response = self.send_message_with_reply(message).await?;
        
        trace!("Received response from send_message_with_reply: {:?}", response);
        
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

        let message = IPCMessage {
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
        let ipc_message = IPCMessage {
            message_type: IPCMessageType::Log,
            payload: match serde_json::to_value(log_params) {
                Ok(payload) => payload,
                Err(e) => {
                    error!("Failed to serialize log message: {}", e);
                    return;
                }
            },
            id: Uuid::new_v4().to_string(),
        };

        // For log messages, we don't need to wait for response
        // Just send and continue (fire-and-forget)
        if let Err(e) = self.send_message_without_reply(ipc_message).await {
            // If IPC fails, we still have local logging above
            debug!("Failed to send log via IPC: {}", e);
        }
    }

    /// Sends an IPC message and waits for a response from VSCode extension
    /// 
    /// Sets up response correlation using the message UUID and waits up to 5 seconds
    /// for the background reader task to deliver the matching response.
    /// Uses the underlying `write_message` primitive to send the data.
    async fn send_message_with_reply(&self, message: IPCMessage) -> Result<IPCResponse> {
        trace!("send_message_with_reply called with message ID: {}", message.id);
        
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
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            rx
        ).await
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
        let connected = {
            let inner = this.lock().await;
            inner.connected
        };
        
        if connected {
            return Ok(()); // Already connected, nothing to do
        }
        
        Self::attempt_connection_with_backoff(Arc::clone(&this)).await
    }
    
    /// Clears dead connection state and attempts fresh reconnection
    /// Called by reader task as "parting gift" when connection dies
    async fn clear_connection_and_reconnect(this: Arc<Mutex<Self>>) -> Result<()> {
        info!("Clearing dead connection state and attempting reconnection");
        
        // Clean up dead connection state
        {
            let mut inner = this.lock().await;
            inner.connected = false;
            inner.write_half = None;
            
            // Clean up orphaned pending requests to fix memory leak
            let orphaned_count = inner.pending_requests.len();
            if orphaned_count > 0 {
                warn!("Cleaning up {} orphaned pending requests", orphaned_count);
                inner.pending_requests.clear();
            }
        }
        
        // Attempt fresh connection
        Self::attempt_connection_with_backoff(this).await
    }
    
    /// Attempts connection with exponential backoff to handle extension restart timing
    async fn attempt_connection_with_backoff(this: Arc<Mutex<Self>>) -> Result<()> {
        const MAX_RETRIES: u32 = 5;
        const BASE_DELAY_MS: u64 = 100;
        
        let socket_path = {
            let inner = this.lock().await;
            format!("/tmp/dialectic-vscode-{}.sock", inner.vscode_pid)
        };
        
        info!("Attempting connection to: {}", socket_path);
        
        for attempt in 1..=MAX_RETRIES {
            match UnixStream::connect(&socket_path).await {
                Ok(stream) => {
                    info!("Successfully connected on attempt {}", attempt);
                    
                    // Split the stream into read and write halves
                    let (read_half, write_half) = stream.into_split();
                    let write_half = Arc::new(Mutex::new(write_half));
                    
                    // Update connection state
                    {
                        let mut inner = this.lock().await;
                        inner.write_half = Some(Arc::clone(&write_half));
                        inner.connected = true;
                    }
                    
                    // Spawn new reader task with shared Arc
                    let inner_clone = Arc::clone(&this);
                    tokio::spawn(async move {
                        IPCCommunicator::response_reader_task(read_half, inner_clone).await;
                    });
                    
                    return Ok(());
                }
                Err(e) if attempt < MAX_RETRIES => {
                    let delay = Duration::from_millis(BASE_DELAY_MS * 2_u64.pow(attempt - 1));
                    warn!("Connection attempt {} failed: {}. Retrying in {:?}", attempt, e, delay);
                    tokio::time::sleep(delay).await;
                }
                Err(e) => {
                    error!("All connection attempts failed. Last error: {}", e);
                    return Err(IPCError::ConnectionFailed { 
                        path: socket_path, 
                        source: e 
                    }.into());
                }
            }
        }
        
        unreachable!("Loop should always return or error")
    }
}

impl IPCCommunicator {
    async fn response_reader_task(
        mut read_half: tokio::net::unix::OwnedReadHalf,
        inner: Arc<Mutex<IPCCommunicatorInner>>,
    ) {
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
                    
                    Self::handle_response_message(&inner, &message_str).await;
                }
                Err(e) => {
                    error!("Error reading from IPC connection: {}", e);
                    break;
                }
            }
        }
        
        info!("IPC response reader task terminated");
    }

    /// Processes incoming response messages from VSCode extension
    /// Matches responses to pending requests by ID and sends results back to callers
    async fn handle_response_message(
        inner: &Arc<Mutex<IPCCommunicatorInner>>,
        message_str: &str,
    ) {
        debug!("Received IPC response: {}", message_str);
        
        // Parse the response message
        let response: IPCResponse = match serde_json::from_str(message_str) {
            Ok(r) => r,
            Err(e) => {
                error!("Failed to parse IPC response: {} - Message: {}", e, message_str);
                return;
            }
        };
        
        // Find the pending request and send the response
        let mut inner_guard = inner.lock().await;
        if let Some(sender) = inner_guard.pending_requests.remove(&response.id) {
            if let Err(_) = sender.send(response) {
                warn!("Failed to send response to caller - receiver dropped");
            }
        } else {
            warn!("Received response for unknown request ID: {}", response.id);
        }
    }
}
