#!/usr/bin/env cargo run --

//! Dialectic MCP Server - Rust Implementation
//!
//! Provides tools for AI assistants to display code reviews in VSCode.
//! Acts as a communication bridge between AI and the VSCode extension via IPC.

use anyhow::Result;
use clap::Parser;
use rmcp::{transport::stdio, ServiceExt};
use tracing::{error, info};
use tracing_subscriber::{self, EnvFilter};

use dialectic_mcp_server::{pid_discovery, DialecticServer};

#[derive(Parser)]
#[command(name = "dialectic-mcp-server")]
#[command(about = "Dialectic MCP Server for VSCode integration")]
struct Args {
    /// Run PID discovery probe and exit (for testing)
    #[arg(long, global = true)]
    probe: bool,

    /// Enable development logging to /tmp/dialectic-mcp-server.log
    #[arg(long, global = true)]
    dev_log: bool,

    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Parser)]
enum Command {
    /// Run as message bus daemon for multi-window support
    Daemon {
        /// VSCode process ID to monitor
        vscode_pid: u32,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let mut flush_guard = None;

    // Initialize logging to stderr (MCP uses stdout for protocol)
    // In dev mode, also log to file for debugging
    if args.dev_log {
        use std::fs::OpenOptions;
        use tracing_appender::non_blocking;

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open("/tmp/dialectic-mcp-server.log")
            .expect("Failed to open log file");

        let (file_writer, _guard) = non_blocking(file);
        flush_guard = Some(_guard);

        tracing_subscriber::fmt()
            .with_env_filter(EnvFilter::from_default_env())
            .with_writer(file_writer)
            .with_ansi(false) // No ANSI codes in file
            .init();

        // Also log to stderr for immediate feedback
        eprintln!("Development logging enabled - writing to /tmp/dialectic-mcp-server.log (PID: {})", std::process::id());
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(EnvFilter::from_default_env())
            .with_writer(std::io::stderr)
            .with_ansi(true)
            .init();
    }

    if args.probe {
        info!("🔍 PROBE MODE DETECTED - Running PID discovery probe...");
        run_pid_probe().await?;
        info!("🔍 PROBE MODE COMPLETE - Exiting");
        return Ok(());
    }

    match args.command {
        Some(Command::Daemon { vscode_pid }) => {
            info!("🚀 DAEMON MODE - Starting message bus daemon for VSCode PID {}", vscode_pid);
            run_daemon(vscode_pid).await?;
        }
        None => {
            info!("Starting Dialectic MCP Server (Rust)");

            // Create our server instance
            let server = DialecticServer::new().await?;

            // Start the MCP server with stdio transport
            let service = server.serve(stdio()).await.inspect_err(|e| {
                error!("MCP server error: {:?}", e);
            })?;

            info!("Dialectic MCP Server is ready and listening");

            // Wait for the service to complete
            service.waiting().await?;

            info!("Dialectic MCP Server shutting down");
        }
    }
    std::mem::drop(flush_guard);
    Ok(())
}

/// Run the message bus daemon for multi-window support
async fn run_daemon(vscode_pid: u32) -> Result<()> {
    use std::os::unix::net::UnixListener;
    use std::path::Path;
    
    let socket_path = format!("/tmp/dialectic-vscode-{}.sock", vscode_pid);
    info!("Attempting to claim socket: {}", socket_path);

    // Try to bind to the socket first - this is our "claim" operation
    let _listener = match UnixListener::bind(&socket_path) {
        Ok(listener) => {
            info!("✅ Successfully claimed socket: {}", socket_path);
            listener
        }
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            error!("❌ Failed to claim socket {}: {}", socket_path, e);
            error!("Another daemon is already running for VSCode PID {}", vscode_pid);
            return Err(e.into());
        }
        Err(e) => {
            // Other error - maybe stale socket file, try to remove and retry once
            if Path::new(&socket_path).exists() {
                std::fs::remove_file(&socket_path)?;
                info!("Removed stale socket file, retrying bind");
                
                // Retry binding once
                match UnixListener::bind(&socket_path) {
                    Ok(listener) => {
                        info!("✅ Successfully claimed socket after cleanup: {}", socket_path);
                        listener
                    }
                    Err(e) => {
                        error!("❌ Failed to claim socket {} even after cleanup: {}", socket_path, e);
                        return Err(e.into());
                    }
                }
            } else {
                error!("❌ Failed to claim socket {}: {}", socket_path, e);
                return Err(e.into());
            }
        }
    };

    info!("🚀 Message bus daemon started for VSCode PID {}", vscode_pid);
    info!("📡 Listening on socket: {}", socket_path);

    // TODO: Implement the actual message bus loop
    // For now, just keep the socket claimed and monitor the VSCode process
    loop {
        // Check if VSCode process is still alive
        match nix::sys::signal::kill(nix::unistd::Pid::from_raw(vscode_pid as i32), None) {
            Ok(_) => {
                // Process exists, continue
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
            Err(nix::errno::Errno::ESRCH) => {
                info!("VSCode process {} has died, shutting down daemon", vscode_pid);
                break;
            }
            Err(e) => {
                error!("Error checking VSCode process {}: {}", vscode_pid, e);
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        }
    }

    // Clean up socket file on exit
    if Path::new(&socket_path).exists() {
        std::fs::remove_file(&socket_path)?;
        info!("🧹 Cleaned up socket file: {}", socket_path);
    }

    info!("🛑 Daemon shutdown complete");
    Ok(())
}

/// Run PID discovery probe for testing
async fn run_pid_probe() -> Result<()> {
    use std::process;
    use tracing::{error, info};

    info!("=== DIALECTIC MCP SERVER PID PROBE ===");

    let current_pid = process::id();
    info!("MCP Server PID: {}", current_pid);

    // Try to walk up the process tree to find VSCode
    match pid_discovery::find_vscode_pid_from_mcp(current_pid).await {
        Ok(Some((vscode_pid, terminal_shell_pid))) => {
            info!("✅ SUCCESS: Found VSCode PID: {}", vscode_pid);
            info!("✅ SUCCESS: Terminal Shell PID: {}", terminal_shell_pid);
            info!("🎯 RESULT: MCP server can connect to VSCode via PID-based discovery");
        }
        Ok(None) => {
            error!("❌ FAILED: Could not find VSCode PID in process tree");
            info!("💡 This might mean:");
            info!("   - MCP server not running from VSCode terminal");
            info!("   - Process tree structure is different than expected");
        }
        Err(e) => {
            error!("❌ ERROR: PID discovery failed: {}", e);
        }
    }

    info!("=== END PID PROBE ===");
    Ok(())
}
