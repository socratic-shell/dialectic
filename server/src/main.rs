#!/usr/bin/env cargo run --

//! Dialectic MCP Server - Rust Implementation
//!
//! Provides tools for AI assistants to display code reviews in VSCode.
//! Acts as a communication bridge between AI and the VSCode extension via IPC.

use anyhow::Result;
use clap::Parser;
use rmcp::{transport::stdio, ServiceExt};
use tracing::{error, info, trace};
use tracing_subscriber::{self, EnvFilter};

use dialectic_mcp_server::{DialecticServer, pid_discovery};

#[derive(Parser)]
#[command(name = "dialectic-mcp-server")]
#[command(about = "Dialectic MCP Server for VSCode integration")]
struct Args {
    /// Run PID discovery probe and exit (for testing)
    #[arg(long)]
    probe: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging to stderr (MCP uses stdout for protocol)
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .with_ansi(true)
        .init();

    if args.probe {
        info!("🔍 PROBE MODE DETECTED - Running PID discovery probe...");
        run_pid_probe().await?;
        info!("🔍 PROBE MODE COMPLETE - Exiting");
        return Ok(());
    }

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
    Ok(())
}

/// Run PID discovery probe for testing
async fn run_pid_probe() -> Result<()> {
    use std::process;
    use tracing::{info, error};
    
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
