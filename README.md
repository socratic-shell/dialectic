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
npm run setup
```

Then ask your AI assistant: *"Present a review of the changes you just made"*

## Documentation

Full documentation is available at: [dialectic.dev](https://dialectic.dev)

- [Installation Guide](./md/installation.md)
- [Quick Start](./md/quick-start.md)
- [Architecture Overview](./md/design/overview.md)

## License

MIT
