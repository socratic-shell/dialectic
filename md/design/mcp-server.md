# MCP Server Design

*This chapter details the design and implementation approach of the Rust-based MCP server component.*

## Role and Responsibilities

The MCP server acts as a thin communication bridge between AI assistants and the VSCode extension. It does not generate or understand review content - that intelligence stays with the AI assistant.

**Key Responsibilities:**
- Expose the `present-review` tool to AI assistants via MCP protocol
- Validate tool parameters and provide clear error messages
- Establish and maintain IPC connection to VSCode extension
- Forward review content through Unix socket with proper error handling
- Support concurrent operations with unique message tracking

## Architecture

```
┌─────────────────┐    MCP Protocol    ┌─────────────────┐    Unix Socket    ┌─────────────────┐
│   AI Assistant  │ ←─────────────────→ │ Rust MCP Server │ ←─────────────────→ │ VSCode Extension│
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
```

The MCP server operates as:
- **MCP Protocol Server**: Handles stdio communication with AI assistants using the rmcp SDK
- **IPC Client**: Connects to VSCode extension's Unix socket server with cross-platform support
- **Message Bridge**: Translates between MCP tool calls and IPC messages with proper async handling

## Rust Implementation Benefits

**Performance**: Rust's zero-cost abstractions and lack of garbage collection provide better resource efficiency compared to Node.js implementations.

**Memory Safety**: Rust's ownership system prevents memory leaks and data races that could occur in long-running processes.

**Concurrency**: The async/await model with tokio provides true concurrent processing without blocking operations.

**Cross-Platform**: Native support for both Unix sockets (macOS/Linux) and named pipes (Windows) through conditional compilation.

## Core Tool: present-review

The primary tool exposed by the MCP server provides structured guidance to AI assistants:

**Tool Parameters:**
- `content` (required): Markdown review content with structured format
- `mode` (optional): How to handle content - 'replace', 'update-section', or 'append'
- `section` (optional): Section name for update-section mode
- `baseUri` (required): Base directory path for resolving relative file references

**AI Guidance Strategy:**
The tool description provides multi-line structured guidance including:
- Clear purpose and usage instructions
- Content structure recommendations (summary, findings, suggestions)
- Code reference format (`file:line` pattern)
- Parameter usage examples and best practices

## Implementation Approach

### Technology Stack
- **Language**: TypeScript running on Node.js
- **MCP SDK**: Official ModelContextProtocol SDK for protocol handling
- **Transport**: StdioServerTransport for AI assistant communication
- **IPC**: Node.js `net` module for Unix socket communication
- **Testing**: Jest with comprehensive unit test coverage

### Core Components

**DialecticMCPServer**: Main server class orchestrating MCP protocol handling
- Initializes MCP server with tool capabilities
- Sets up IPC communicator for VSCode connection
- Handles tool registration and request routing

**IPCCommunicator**: Manages Unix socket communication with VSCode extension
- Handles connection establishment and lifecycle
- Implements Promise-based request tracking with unique IDs
- Provides timeout protection and error recovery

**Validation Module**: Comprehensive parameter validation
- Type checking and format validation for all tool parameters
- Clear error messages for invalid inputs
- Runtime safety for all user-provided data

### Design Patterns

**Promise-Based Concurrency**: Each request gets a unique ID and Promise for tracking
- Supports multiple simultaneous operations
- Clean async/await patterns throughout
- Proper error propagation and timeout handling

**Test Mode Architecture**: Constructor parameter enables testing without real sockets
- Allows comprehensive unit testing
- Simulates success/error scenarios
- Maintains same interface as production mode

**Environment-Based Configuration**: Uses environment variables for discovery
- VSCode extension sets `DIALECTIC_IPC_PATH`
- Clear error messages when not in VSCode environment
- No hardcoded paths or configuration files

## Error Handling Strategy

### Connection Management
- **Environment Detection**: Clear error when `DIALECTIC_IPC_PATH` not set
- **Socket Failures**: Network-level errors propagated with context
- **Connection Loss**: Automatic detection and graceful degradation

### Message Processing
- **Timeout Protection**: 5-second timeout prevents hanging operations
- **Invalid Responses**: Proper error handling for malformed messages
- **Concurrent Safety**: Request tracking prevents ID collisions

### User Experience
- **Clear Error Messages**: Specific guidance for common issues
- **Graceful Degradation**: Continues operation when possible
- **Debug Information**: Detailed logging for troubleshooting

## Testing Strategy

### Unit Testing Approach
- **Test Mode**: Bypasses real socket connections for isolated testing
- **Mock Scenarios**: Simulates various success/error conditions
- **Edge Cases**: Comprehensive coverage of error conditions
- **Concurrent Operations**: Validates multi-request scenarios

### Integration Testing
- **Environment Validation**: Tests proper error when not in VSCode
- **Protocol Compliance**: Validates MCP protocol adherence
- **Message Serialization**: Tests JSON protocol implementation

## Performance Characteristics

### Memory Management
- **Request Cleanup**: Automatic cleanup of completed/timed-out requests
- **Connection Reuse**: Single persistent socket per server instance
- **Efficient JSON**: Minimal serialization overhead

### Concurrency Support
- **Non-blocking Operations**: Promise-based async patterns
- **Unique Tracking**: UUID-based request correlation
- **Resource Isolation**: Independent state per server instance

## Implementation Files

**Core Implementation:**
- `server/src/index.ts` - Main server class and tool handlers
- `server/src/ipc.ts` - IPC client communication logic
- `server/src/validation.ts` - Parameter validation and error handling
- `server/src/types.ts` - Shared type definitions

**Testing:**
- `server/src/__tests__/` - Comprehensive unit test suite
- `server/test-mcp-server.js` - Integration test script

**Configuration:**
- `server/package.json` - Dependencies and scripts
- `server/tsconfig.json` - TypeScript configuration
- `server/jest.config.js` - Test configuration

## Future Enhancements

### Enhanced Code References
- **Search-Based References**: More resilient than line numbers
- **Multi-File Support**: Handle references across multiple files
- **Context Awareness**: Understand code structure and relationships

### Advanced Review Modes
- **Streaming Updates**: For very large review content
- **Diff-Based Updates**: Minimize data transfer for incremental changes
- **Multi-Review Sessions**: Support multiple concurrent contexts

### Monitoring and Observability
- **Request Metrics**: Track latency and success rates
- **Connection Health**: Monitor IPC stability
- **Error Analytics**: Aggregate patterns for debugging

The MCP server is designed to be simple, reliable, and extensible while maintaining a clear separation of concerns between AI intelligence and communication infrastructure.