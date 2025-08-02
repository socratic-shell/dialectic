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

### IPC Communication

The MCP server and VSCode extension communicate via Unix socket IPC using environment variable discovery. The VSCode extension creates a socket server and sets `DIALECTIC_IPC_PATH` for the MCP server to find and connect to.

For detailed information about how the IPC connection is established and what messages are exchanged, see the [Communication Protocol](./protocol.md) chapter.

**Key Design Decisions:**
- **Unix Socket/Named Pipe**: Secure, efficient local IPC following VSCode extension patterns
- **Newline-Delimited JSON**: Simple, debuggable message format with reliable boundaries
- **Promise-Based Tracking**: Supports concurrent operations with unique message IDs
- **Environment Variable Discovery**: Automatic connection without configuration complexity

## Design Philosophy

Dialectic embodies the collaborative patterns from the [socratic shell project](https://socratic-shell.github.io/socratic-shell/). The goal is to enable genuine pair programming partnerships with AI assistants, not create another tool for giving commands to a servant.

**Collaborative Review** - Instead of accepting hunks blindly or micro-managing every change, we work together to understand what was built and why, just like reviewing a colleague's PR.

**Thoughtful Interaction** - The review format encourages narrative explanation and reasoning, not just "what changed" but "how it works" and "why these decisions were made."

**Preserved Context** - Reviews become part of your git history, retaining the collaborative thinking process for future reference and team members.

**Iterative Refinement** - Nothing is right the first time. The review process expects and supports ongoing dialogue, suggestions, and improvements rather than assuming the initial implementation is final.

## Implementation Status

**✅ MVP Complete** - All core features implemented and tested:
- **Review Display**: Tree-based markdown rendering in VSCode sidebar
- **Code Navigation**: Clickable `file:line` references that jump to code locations
- **Content Export**: Copy button to export review content for commit messages
- **IPC Communication**: Full bidirectional communication between AI and extension

**Current State**: Ready for end-to-end testing with real AI assistants in VSCode environments.

**Next Phase**: Package extension for distribution and create installation documentation.

## Technical Stack

- **MCP Server**: TypeScript/Node.js with comprehensive unit testing (49/49 tests passing)
- **VSCode Extension**: TypeScript with VSCode Extension API
- **Communication**: Unix domain sockets (macOS/Linux) and named pipes (Windows)
- **Protocol**: JSON messages with unique ID tracking and timeout protection
- **Testing**: Jest for unit tests with test mode for IPC-free testing

## Component Responsibilities

### MCP Server (`server/`)
- Exposes `present-review` tool to AI assistants
- Validates parameters and handles errors gracefully
- Manages IPC client connection to VSCode extension
- Supports concurrent operations with Promise-based tracking
- See `server/src/index.ts` for main server implementation

### VSCode Extension (`extension/`)
- Creates IPC server and sets environment variables
- Provides tree-based review display in sidebar
- Handles clickable navigation to code locations
- Manages copy-to-clipboard functionality
- See `extension/src/extension.ts` for activation logic

### Shared Types (`server/src/types.ts`)
- Defines communication protocol interfaces
- Ensures type safety across IPC boundary
- Prevents protocol mismatches during development

## Key Implementation Files

- `server/src/index.ts` - Main MCP server with tool handlers
- `server/src/ipc.ts` - IPC client communication logic
- `server/src/validation.ts` - Parameter validation and error handling
- `extension/src/extension.ts` - VSCode extension activation and IPC server
- `extension/src/reviewProvider.ts` - Tree view implementation and markdown parsing
- `server/src/__tests__/` - Comprehensive unit test suite

For detailed implementation specifics, refer to the source code and inline comments marked with `💡` that explain non-obvious design decisions.