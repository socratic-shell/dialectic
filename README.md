# Dialectic

A high-performance code review MCP tool built with Rust, enabling AI assistants to present structured code reviews directly in VSCode.

## Features

- **🦀 Rust-powered MCP server** for optimal performance and reliability
- **📝 Structured code reviews** with clickable file references
- **🔗 Seamless VSCode integration** via custom webview panel
- **🤖 AI assistant compatibility** with Claude CLI, Q CLI, and other MCP clients
- **⚡ Concurrent processing** with non-blocking IPC communication

## Quick Start

```bash
# Install Rust if needed
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Clone and setup
git clone https://github.com/socratic-shell/dialectic.git
cd dialectic
cargo setup
```

Then ask your AI assistant: *"Present a review of the changes you just made"*

## Setup Options

```bash
# Production setup (installs to PATH)
cargo setup

# Development setup (builds in target/)
cargo setup --dev

# Setup for specific AI assistant
cargo setup --tool claude
cargo setup --tool q
cargo setup --tool both

# Skip extension build (server only)
cargo setup --skip-extension

# Skip MCP registration (build only)
cargo setup --skip-mcp
```

## Documentation

Full documentation is available at: [dialectic.dev](https://dialectic.dev)

- [Installation Guide](./md/installation.md)
- [Quick Start](./md/quick-start.md)
- [Architecture Overview](./md/design/overview.md)

## License

MIT
