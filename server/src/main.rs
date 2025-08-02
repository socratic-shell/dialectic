#!/usr/bin/env cargo run --

//! Dialectic MCP Server - Rust Implementation
//!
//! Provides tools for AI assistants to display code reviews in VSCode.
//! Acts as a communication bridge between AI and the VSCode extension via IPC.

use anyhow::Result;
use rmcp::{transport::stdio, ServiceExt};
use tracing::{error, info, trace};
use tracing_subscriber::{self, EnvFilter};

use dialectic_mcp_server::DialecticServer;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging to stderr (MCP uses stdout for protocol)
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .with_ansi(true)
        .init();

    info!("Starting Dialectic MCP Server (Rust)");
    trace!("wtf");

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
