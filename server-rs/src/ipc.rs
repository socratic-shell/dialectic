//! IPC communication module for Dialectic MCP Server
//! 
//! Handles Unix socket/named pipe communication with the VSCode extension.
//! Ports the logic from server/src/ipc.ts to Rust with cross-platform support.

use serde_json;
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::sync::{oneshot, Mutex};
use tracing::{info, error, debug};
use uuid::Uuid;

use crate::types::{
    IPCMessage, IPCResponse, IPCMessageType, PresentReviewParams, PresentReviewResult,
    LogParams, LogLevel, GetSelectionResult
};

// Cross-platform imports
#[cfg(unix)]
use tokio::net::UnixStream;

#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;

/// Errors that can occur during IPC communication
#[derive(Error, Debug)]
pub enum IPCError {
    #[error("Environment variable DIALECTIC_IPC_PATH not set")]
    MissingEnvironmentVariable,
    
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
    /// Unix domain socket connection to VSCode extension (macOS/Linux)
    /// Set by connect() when DIALECTIC_IPC_PATH points to a socket file
    #[cfg(unix)]
    socket: Option<UnixStream>,
    
    /// Named pipe connection to VSCode extension (Windows)
    /// Set by connect() when DIALECTIC_IPC_PATH points to a pipe name
    #[cfg(windows)]
    pipe: Option<tokio::net::windows::named_pipe::NamedPipeClient>,
    
    /// Tracks outgoing requests awaiting responses from VSCode extension
    /// Key: unique message ID (UUID), Value: channel to send response back to caller
    /// Enables concurrent request/response handling with proper correlation
    pending_requests: HashMap<String, oneshot::Sender<IPCResponse>>,
}

impl IPCCommunicator {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(IPCCommunicatorInner {
                #[cfg(unix)]
                socket: None,
                
                #[cfg(windows)]
                pipe: None,
                
                pending_requests: HashMap::new(),
            })),
            test_mode: false,
        }
    }

    pub async fn initialize(&mut self) -> Result<()> {
        if self.test_mode {
            info!("IPC Communicator initialized (test mode)");
            return Ok(());
        }

        // Get the socket path from environment variable set by VSCode extension
        let socket_path = std::env::var("DIALECTIC_IPC_PATH")
            .map_err(|_| IPCError::MissingEnvironmentVariable)?;

        info!("Connecting to VSCode extension at: {}", socket_path);

        // Create cross-platform connection
        self.connect(&socket_path).await?;
        
        info!("Connected to VSCode extension via IPC");
        Ok(())
    }

    #[cfg(unix)]
    async fn connect(&mut self, socket_path: &str) -> Result<()> {
        let stream = UnixStream::connect(socket_path).await
            .map_err(|e| IPCError::ConnectionFailed { 
                path: socket_path.to_string(), 
                source: e 
            })?;
        
        let mut inner = self.inner.lock().await;
        inner.socket = Some(stream);
        Ok(())
    }

    #[cfg(windows)]
    async fn connect(&mut self, pipe_path: &str) -> Result<()> {
        let client = ClientOptions::new()
            .open(pipe_path)
            .map_err(|e| IPCError::ConnectionFailed { 
                path: pipe_path.to_string(), 
                source: e 
            })?;
        
        let mut inner = self.inner.lock().await;
        inner.pipe = Some(client);
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

        let message = IPCMessage {
            message_type: IPCMessageType::PresentReview,
            payload: serde_json::to_value(params)?,
            id: Uuid::new_v4().to_string(),
        };

        debug!("Sending present_review message: {:?}", message);

        let response = self.send_message(message).await?;
        
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

        let message = IPCMessage {
            message_type: IPCMessageType::GetSelection,
            payload: serde_json::json!({}),
            id: Uuid::new_v4().to_string(),
        };

        debug!("Sending get_selection message: {:?}", message);

        let response = self.send_message(message).await?;
        
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
        if let Err(e) = self.send_message_no_wait(ipc_message).await {
            // If IPC fails, we still have local logging above
            debug!("Failed to send log via IPC: {}", e);
        }
    }

    async fn send_message(&self, message: IPCMessage) -> Result<IPCResponse> {
        let (tx, rx) = oneshot::channel();
        
        // Store the response channel
        {
            let mut inner = self.inner.lock().await;
            inner.pending_requests.insert(message.id.clone(), tx);
        }
        
        // Send the message
        let message_data = serde_json::to_string(&message)?;
        self.write_message(&message_data).await?;
        
        // Wait for response with timeout
        let response = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            rx
        ).await
        .map_err(|_| IPCError::Timeout)?
        .map_err(|_| IPCError::ChannelClosed)?;
        
        Ok(response)
    }

    async fn send_message_no_wait(&self, message: IPCMessage) -> Result<()> {
        let message_data = serde_json::to_string(&message)?;
        self.write_message(&message_data).await
    }

    #[cfg(unix)]
    async fn write_message(&self, data: &str) -> Result<()> {
        let mut inner = self.inner.lock().await;
        if let Some(ref mut socket) = inner.socket {
            socket.write_all(data.as_bytes()).await?;
            Ok(())
        } else {
            Err(IPCError::NotConnected)
        }
    }

    #[cfg(windows)]
    async fn write_message(&self, data: &str) -> Result<()> {
        let mut inner = self.inner.lock().await;
        if let Some(ref mut pipe) = inner.pipe {
            pipe.write_all(data.as_bytes()).await?;
            Ok(())
        } else {
            Err(IPCError::NotConnected)
        }
    }

    // TODO: Implement message reading and response handling
    // This will require spawning a background task to read from the socket/pipe
    // and match responses to pending requests by ID
}
