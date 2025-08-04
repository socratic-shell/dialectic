# Summary

<!-- Claude: consult chapters in this file for deeper background on topics as needed -->

- [Introduction](./introduction.md) <!-- 💡: Project overview, problem statement, and relationship to socratic shell ecosystem -->

# User Guide <!-- 💡: End-user documentation for people using Dialectic in their AI development workflow -->

- [Installation](./installation.md) <!-- 💡: Step-by-step setup for both VSCode extension and MCP server components -->
- [Quick start](./quick-start.md) <!-- 💡: Basic workflow example showing AI assistant → review display → navigation cycle -->
- [Review format](./review-format.md) <!-- 💡: Explains file:line syntax, reference-style links [file:line][], and markdown conventions AI assistants should follow -->
- [Frequently asked questions](./faq.md) <!-- 💡: Anticipated user questions about common errors, expected workflow, purpose, comparisons with other tools, etc -->

# Development and contribution guide <!-- 💡: Technical documentation for contributors and people wanting to understand system internals -->

- [Building and testing](./design/build-and-test.md) <!-- 💡: Development environment setup, build process, and testing procedures -->
- [System overview](./design/overview.md) <!-- 💡: High-level architecture showing MCP server ↔ VSCode extension communication via Unix sockets -->
    - [Communication protocol](./design/protocol.md) <!-- 💡: JSON message format, Unix socket/named pipe IPC, and error handling between components -->
    - [Security considerations](./design/security.md) <!-- 💡: CSP headers, DOMPurify sanitization, and secure webview practices for markdown rendering -->
    - [MCP Tool interface](./design/mcp-tool-interface.md) <!-- 💡: API specification for AI assistants calling present_review tool with markdown content -->
    - [AI Guidance design considerations](./design/ai-guidance.md) <!-- 💡: Design decisions made specifically to work well with AI collaboration patterns from socratic shell -->
- [VSCode extension](./design/extension.md) <!-- 💡: Highlights of the VSCode Extension design and implementation: activation, establishing IPC protocol -->
    - [Markdown rendering](./design/markdown-rendering.md) <!-- 💡: markdown-it pipeline, custom renderer rules for file references, and HTML generation process -->

# In-progress RFCs <!-- 💡: Design proposals under active development and discussion -->

- [RFC: Exposing IDE capabilities](./rfcs/ide-capabilities/README.md) <!-- 💡: Proposal for natural language interface to VSCode and LSP features through composable JSON mini-language -->
    - [RFC: Scripting language](./rfcs/ide-capabilities/scripting-language.md) <!-- 💡: JSON mini-language design with function composition and value types -->
        - [RFC: Validation boundaries](./rfcs/ide-capabilities/scripting-language/validation-boundaries.md) <!-- 💡: Where should type checking happen - in the engine or in capability implementations? -->
        - [RFC: Ambiguity resolution](./rfcs/ide-capabilities/scripting-language/ambiguity-resolution.md) <!-- 💡: How functions like {"symbol":{"name":"foo"}} handle multiple matches -->
    - [RFC: Natural language interface](./rfcs/ide-capabilities/natural-language-interface.md) <!-- 💡: How natural language requests get converted to JSON programs -->
    - [RFC: Capability registry](./rfcs/ide-capabilities/capability-registry.md) <!-- 💡: What IDE capabilities to expose initially and their function signatures -->

# References

- [Research reports]() <!-- 💡: Background research that informed design decisions - consult when discussing related technical topics -->
    - [Markdown to HTML in VSCode Extensions](./references/markdown-to-html-in-vscode.md) <!-- 💡: Comprehensive guide on markdown-it dominance (95% of VSCode extensions), custom renderer rules for link handling, multi-layered approach (parser/webview/extension), security with CSP and DOMPurify, command URI patterns. Relevant for: markdown processing, custom link handling, webview security, VSCode extension patterns -->
    - [VSCode Extension Communication Patterns](./references/cli-extension-communication-guide.md) <!-- 💡: Four communication approaches between CLI tools and VSCode extensions: Unix socket/named pipe (recommended), HTTP server, file-based, and remote execution considerations. Covers environmentVariableCollection for discovery, cross-platform compatibility, security best practices. Relevant for: MCP server communication, IPC implementation, CLI-extension integration -->
    - [VSCode Sidebar Panel Research](./references/vscode-extensions-sidebar-panel-research-report.md) <!-- 💡: Complete guide for VSCode extension sidebar panels including TreeDataProvider registration, package.json configuration, debugging strategies. Covers TreeView vs Webview approaches for content display, common configuration issues, and systematic debugging steps. Relevant for: sidebar UI implementation, extension architecture, TreeView/Webview decisions -->
    - [Language Server Protocol Overview](./references/lsp-overview/README.md) <!-- 💡: LSP architecture solving M×N complexity problem with client-server model, JSON-RPC 2.0 messaging, multiple transport options (stdio, sockets, TCP, Node.js IPC). Reduces editor×language integrations from M×N to M+N. Relevant for: protocol design patterns, client-server communication, future LSP integration considerations -->
        - [Base Protocol](./references/lsp-overview/base-protocol.md) <!-- 💡: JSON-RPC 2.0 foundation with HTTP-style headers, Content-Length mandatory for stream communication, request/response/notification model with id correlation, standard and LSP-specific error codes. Relevant for: protocol design, message structure, error handling patterns -->
        - [Language Features](./references/lsp-overview/language-features.md) <!-- 💡: Comprehensive LSP feature catalog including navigation (go-to-definition, find references), information (hover, signature help), code intelligence (completion, actions, lens), formatting, semantic tokens, inlay hints, and diagnostics (push/pull models). Relevant for: code intelligence features, enhanced review experience, future LSP integration -->
        - [Implementation Guide](./references/lsp-overview/implementation-guide.md) <!-- 💡: Practical LSP server/client implementation patterns covering process isolation, message ordering, state management, error handling with exponential backoff, transport configuration (--stdio, --pipe, --socket), three-tier testing strategy, and security considerations (input validation, process isolation, path sanitization). Relevant for: robust IPC implementation, testing strategy, security best practices -->
        - [Message Reference](./references/lsp-overview/message-reference.md) <!-- 💡: Complete LSP message catalog with request/response pairs, notifications, $/prefixed protocol messages, capabilities exchange during initialization, document synchronization (full/incremental), workspace/window features, and proper lifecycle management (initialize → initialized → shutdown → exit). Relevant for: protocol patterns, capability negotiation, document synchronization, future LSP integration -->
    - [Unix IPC Message Bus Implementation Guide](./references/unix-message-bus-architecture.md) <!-- 💡: Comprehensive research on Unix IPC message bus patterns covering Unix domain sockets vs other mechanisms, hub-and-spoke architecture with central broker, epoll-based event handling, process lifecycle management, performance optimization through hybrid approaches, security hardening, and real-world implementations (D-Bus, Redis, nanomsg). Validates Unix sockets as superior foundation for multi-client message buses with concrete implementation patterns. Relevant for: message bus daemon design, IPC architecture decisions, multi-process communication, performance considerations -->
- [Decision documents]()