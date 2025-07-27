# Communication Protocol

*This chapter defines how the MCP server and VSCode extension communicate via Unix socket IPC.*

## Architecture Overview

The communication follows a client-server pattern:
- **VSCode Extension** = IPC Server (creates socket, listens for connections)
- **MCP Server** = IPC Client (connects to socket, sends messages)
- **Discovery** = Environment variable `DIALECTIC_IPC_PATH` set by extension

## Message Flow

1. **VSCode Extension** starts and creates Unix socket/named pipe
2. **VSCode Extension** sets `DIALECTIC_IPC_PATH` environment variable
3. **AI Assistant** calls `present-review` MCP tool with review content
4. **MCP Server** validates parameters and creates IPC message with unique ID
5. **MCP Server** connects to socket (if not already connected) and sends JSON message
6. **VSCode Extension** receives message, processes it, and updates review panel
7. **VSCode Extension** sends JSON response back through socket
8. **MCP Server** receives response, resolves Promise, and returns result to AI

## Socket Management

### Platform Compatibility
- **Unix Domain Sockets** (macOS/Linux): Socket files in VSCode extension storage
- **Named Pipes** (Windows): Windows pipe format with automatic cleanup
- **Discovery**: Extension sets environment variable for MCP server connection

### Connection Lifecycle
- Extension creates socket on activation and sets environment variable
- MCP server connects when first `present-review` tool is called
- Connection persists for multiple operations to avoid reconnection overhead
- Automatic cleanup when extension deactivates or MCP server closes

## Message Protocol

### Request/Response Pattern
All communication uses JSON messages with unique IDs for request/response correlation:

**Request Message Structure:**
- `type`: Message type identifier (currently only 'present-review')
- `payload`: Tool parameters (content, mode, optional section)
- `id`: UUID for response tracking

**Response Message Structure:**
- `id`: Matches request message ID
- `success`: Boolean indicating operation result
- `error`: Optional error message when success is false

### Review Update Modes
- **replace**: Complete content replacement (most common)
- **append**: Add content to end (for incremental reviews)
- **update-section**: Update specific section (MVP: append with header)

## Error Handling

### Connection Errors
- **Missing Environment Variable**: Clear error when not running in VSCode
- **Socket Connection Failed**: Network-level errors propagated to AI
- **Extension Not Running**: Connection refused handled gracefully

### Message Errors
- **Invalid JSON**: Extension responds with error for malformed messages
- **Unknown Message Type**: Error response for unsupported operations
- **Validation Failures**: Parameter validation errors returned clearly

### Timeout Protection
- 5-second timeout prevents hanging requests
- Automatic cleanup of timed-out operations
- Clear error messages for timeout scenarios

## Concurrency Support

### Request Tracking
- Map-based tracking of pending requests by unique ID
- Support for multiple simultaneous `present-review` calls
- Proper cleanup of completed or failed requests

### Resource Management
- Single persistent connection per MCP server instance
- Automatic socket cleanup on extension deactivation
- Proper disposal of VSCode API resources

## Security Considerations

### Local-Only Communication
- Unix sockets and named pipes are local-only by design
- No network exposure or remote access possible
- Socket files created with appropriate permissions

### Input Validation
- All message parameters validated before processing
- TypeScript interfaces provide compile-time type safety
- Runtime validation prevents malformed message processing

## Testing Strategy

### Unit Testing
- Test mode bypasses real socket connections for unit tests
- Mock responses simulate success/error scenarios
- Comprehensive coverage of error conditions and edge cases

### Integration Testing
- Environment detection verification
- Platform-specific socket path generation testing
- Message protocol serialization/deserialization validation

## Implementation References

For specific implementation details, see:
- `server/src/ipc.ts` - IPC client implementation with connection management
- `extension/src/extension.ts` - IPC server setup and message handling
- `server/src/types.ts` - Shared message protocol interfaces
- `server/src/__tests__/ipc.test.ts` - Comprehensive test coverage

The protocol is designed to be simple, reliable, and extensible for future enhancements while maintaining backward compatibility.