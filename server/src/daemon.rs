//! Message bus daemon for multi-window support
//!
//! Provides a Unix domain socket-based message bus that allows multiple
//! MCP servers and VSCode extensions to communicate through a central daemon.

use anyhow::Result;
use std::collections::HashMap;
use std::os::unix::net::UnixListener;
use std::path::Path;
use tokio::time::{interval, Duration};
use tracing::{error, info};

/// Run the message bus daemon for multi-window support
pub async fn run_daemon(vscode_pid: u32) -> Result<()> {
    run_daemon_with_prefix(vscode_pid, "dialectic-daemon", None).await
}

/// Run the message bus daemon with custom socket path prefix
/// If ready_barrier is provided, it will be signaled when the daemon is ready to accept connections
pub async fn run_daemon_with_prefix(
    vscode_pid: u32, 
    socket_prefix: &str,
    ready_barrier: Option<std::sync::Arc<tokio::sync::Barrier>>
) -> Result<()> {
    use std::os::unix::net::UnixListener;
    use std::path::Path;
    
    let socket_path = format!("/tmp/{}-{}.sock", socket_prefix, vscode_pid);
    info!("Attempting to claim socket: {}", socket_path);

    // Try to bind to the socket first - this is our "claim" operation
    let _listener = match UnixListener::bind(&socket_path) {
        Ok(listener) => {
            info!("✅ Successfully claimed socket: {}", socket_path);
            listener
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                error!("❌ Failed to claim socket {}: {}", socket_path, e);
                error!("Another daemon is already running for VSCode PID {}", vscode_pid);
            } else {
                error!("❌ Failed to claim socket {}: {}", socket_path, e);
            }
            return Err(e.into());
        }
    };

    info!("🚀 Message bus daemon started for VSCode PID {}", vscode_pid);
    info!("📡 Listening on socket: {}", socket_path);

    // Convert std::os::unix::net::UnixListener to tokio::net::UnixListener
    _listener.set_nonblocking(true)?;
    let listener = tokio::net::UnixListener::from_std(_listener)?;

    // Run the message bus loop
    run_message_bus(listener, vscode_pid, ready_barrier).await?;

    // Clean up socket file on exit
    if Path::new(&socket_path).exists() {
        std::fs::remove_file(&socket_path)?;
        info!("🧹 Cleaned up socket file: {}", socket_path);
    }

    info!("🛑 Daemon shutdown complete");
    Ok(())
}

/// Run the message bus loop - accept connections, broadcast messages, monitor VSCode
pub async fn run_message_bus(
    listener: tokio::net::UnixListener, 
    vscode_pid: u32,
    ready_barrier: Option<std::sync::Arc<tokio::sync::Barrier>>
) -> Result<()> {
    use tokio::sync::broadcast;
    use tokio::time::{interval, Duration};

    info!("Starting message bus loop");
    
    // Signal that daemon is ready to accept connections
    if let Some(barrier) = ready_barrier {
        barrier.wait().await;
    }
    
    // Broadcast channel for distributing messages to all clients
    let (tx, _rx) = broadcast::channel::<String>(1000);
    
    // Track connected clients
    let mut clients: HashMap<usize, tokio::task::JoinHandle<()>> = HashMap::new();
    let mut next_client_id = 0;

    // VSCode process monitoring timer
    let mut vscode_check_interval = interval(Duration::from_secs(5));

    loop {
        tokio::select! {
            // Accept new client connections
            result = listener.accept() => {
                match result {
                    Ok((stream, _addr)) => {
                        let client_id = next_client_id;
                        next_client_id += 1;
                        
                        info!("Client {} connected", client_id);
                        
                        // Spawn task to handle this client
                        let tx_clone = tx.clone();
                        let rx = tx.subscribe();
                        let handle = tokio::spawn(handle_client(client_id, stream, tx_clone, rx));
                        clients.insert(client_id, handle);
                    }
                    Err(e) => {
                        error!("Failed to accept client connection: {}", e);
                    }
                }
            }
            
            // Check if VSCode process is still alive
            _ = vscode_check_interval.tick() => {
                match nix::sys::signal::kill(nix::unistd::Pid::from_raw(vscode_pid as i32), None) {
                    Ok(_) => {
                        // Process exists, continue
                    }
                    Err(nix::errno::Errno::ESRCH) => {
                        info!("VSCode process {} has died, shutting down daemon", vscode_pid);
                        break;
                    }
                    Err(e) => {
                        error!("Error checking VSCode process {}: {}", vscode_pid, e);
                    }
                }
            }
            
            // Clean up finished client tasks
            _ = tokio::time::sleep(Duration::from_secs(1)) => {
                clients.retain(|&client_id, handle| {
                    if handle.is_finished() {
                        info!("Client {} disconnected", client_id);
                        false
                    } else {
                        true
                    }
                });
            }
        }
    }

    // Shutdown: wait for all client tasks to finish
    info!("Shutting down message bus, waiting for {} clients", clients.len());
    for (client_id, handle) in clients {
        handle.abort();
        info!("Disconnected client {}", client_id);
    }

    Ok(())
}

/// Handle a single client connection - read messages and broadcast them
pub async fn handle_client(
    client_id: usize,
    mut stream: tokio::net::UnixStream,
    tx: tokio::sync::broadcast::Sender<String>,
    mut rx: tokio::sync::broadcast::Receiver<String>,
) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    
    let (reader, mut writer) = stream.split();
    let mut reader = BufReader::new(reader);
    let mut line = String::new();

    loop {
        tokio::select! {
            // Read messages from this client
            result = reader.read_line(&mut line) => {
                match result {
                    Ok(0) => {
                        // EOF - client disconnected
                        info!("Client {} disconnected (EOF)", client_id);
                        break;
                    }
                    Ok(_) => {
                        let message = line.trim().to_string();
                        if !message.is_empty() {
                            info!("Client {} sent: {}", client_id, message);
                            
                            // Broadcast message to all other clients
                            if let Err(e) = tx.send(message) {
                                error!("Failed to broadcast message from client {}: {}", client_id, e);
                            }
                        }
                        line.clear();
                    }
                    Err(e) => {
                        error!("Error reading from client {}: {}", client_id, e);
                        break;
                    }
                }
            }
            
            // Receive broadcasts from other clients
            result = rx.recv() => {
                match result {
                    Ok(message) => {
                        // Send message to this client
                        let message_with_newline = format!("{}\n", message);
                        if let Err(e) = writer.write_all(message_with_newline.as_bytes()).await {
                            error!("Failed to send message to client {}: {}", client_id, e);
                            break;
                        }
                        if let Err(e) = writer.flush().await {
                            error!("Failed to flush message to client {}: {}", client_id, e);
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        info!("Broadcast channel closed, disconnecting client {}", client_id);
                        break;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        // Client is too slow, skip lagged messages
                        continue;
                    }
                }
            }
        }
    }
    
    info!("Client {} handler finished", client_id);
}
