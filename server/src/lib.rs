//! Dialectic MCP Server Library
//!
//! Rust implementation of the Dialectic MCP server for code review integration.

pub mod daemon;
pub mod dialect;
pub mod ide;
pub mod ipc;
pub mod pid_discovery;
pub mod server;
pub mod types;

pub use server::DialecticServer;
