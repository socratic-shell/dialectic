# Design & Implementation Overview

*This section documents the design decisions and implementation details for Dialectic. It serves as both a design document during development and a reference for future contributors.*

## Architecture Summary

Dialectic consists of two main components that communicate via Unix socket IPC:

1. **VSCode Extension** - Provides the review panel UI, handles file navigation, and acts as IPC server
2. **MCP Server** - Acts as a bridge between AI assistants and the VSCode extension via IPC client

The AI assistant generates review content as structured markdown and uses the MCP server's `present-review` tool to display it in the VSCode interface through bidirectional IPC communication.

## Communication Architecture

```
AI Assistant → MCP Tool → Unix Socket → VSCode Extension → Review Panel → User
     ↑                                                                      ↓
     └─────────── Response ←─────── IPC Response ←─────── User Interaction ←┘
```

**Key Design Decisions:**
- **Unix Socket/Named Pipe**: Secure, efficient local IPC following VSCode extension patterns
- **JSON Message Protocol**: Simple, debuggable, and extensible communication format
- **Promise-Based Tracking**: Supports concurrent operations with unique message IDs
- **Environment Variable Discovery**: VSCode extension sets `DIALECTIC_IPC_PATH` for automatic MCP server connection

## Design Philosophy

Dialectic embodies the collaborative patterns from the [socratic shell project](https://socratic-shell.github.io/socratic-shell/). The goal is to enable genuine pair programming partnerships with AI assistants, not create another tool for giving commands to a servant.

**Collaborative Review** - Instead of accepting hunks blindly or micro-managing every change, we work together to understand what was built and why, just like reviewing a colleague's PR.

**Thoughtful Interaction** - The review format encourages narrative explanation and reasoning, not just "what changed" but "how it works" and "why these decisions were made."

**Preserved Context** - Reviews become part of your git history, retaining the collaborative thinking process for future reference and team members.

**Iterative Refinement** - Nothing is right the first time. The review process expects and supports ongoing dialogue, suggestions, and improvements rather than assuming the initial implementation is final.

## Implementation Status

**✅ MVP Complete** - All core features implemented and tested:
- Review Display: Tree-based markdown rendering in VSCode sidebar
- Code Navigation: Clickable `file:line` references that jump to code locations
- Content Export: Copy button to export review content for commit messages
- IPC Communication: Full bidirectional communication between AI and extension

**Current State**: Ready for end-to-end testing with real AI assistants in VSCode environments.

**Next Phase**: Package extension for distribution and create installation documentation.

## Technical Stack

- **MCP Server**: TypeScript/Node.js with comprehensive unit testing (49/49 tests passing)
- **VSCode Extension**: TypeScript with VSCode Extension API
- **Communication**: Unix domain sockets (macOS/Linux) and named pipes (Windows)
- **Protocol**: JSON messages with unique ID tracking and timeout protection
- **Testing**: Jest for unit tests with test mode for IPC-free testing