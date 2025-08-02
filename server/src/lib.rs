//! Dialectic MCP Server Library
//! 
//! Rust implementation of the Dialectic MCP server for code review integration.

pub mod types;
pub mod ipc;
pub mod server;
pub mod pid_discovery;

pub use server::DialecticServer;
