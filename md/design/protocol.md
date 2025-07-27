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

### Socket Creation (VSCode Extension)
```typescript
function getSocketPath(context: vscode.ExtensionContext): string {
  const storageUri = context.storageUri || context.globalStorageUri;
  const socketDir = storageUri.fsPath;
  
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\dialectic-${Date.now()}`;
  } else {
    return path.join(socketDir, 'dialectic.sock');
  }
}
```

### Environment Variable Setup
```typescript
// VSCode extension sets this for MCP server discovery
context.environmentVariableCollection.replace("DIALECTIC_IPC_PATH", socketPath);
```

### Connection Management (MCP Server)
```typescript
// MCP server connects to the socket
this.socket = createConnection(socketPath, () => {
  console.error('Connected to VSCode extension via IPC');
  resolve();
});
```

## Message Protocol

### Request Message Format
```typescript
interface IPCMessage {
  type: 'present-review';
  payload: PresentReviewParams;
  id: string; // UUID for response correlation
}

interface PresentReviewParams {
  content: string; // Markdown review content
  mode: 'replace' | 'update-section' | 'append';
  section?: string; // Required for update-section mode
}
```

### Response Message Format
```typescript
interface IPCResponse {
  id: string; // Matches request message ID
  success: boolean;
  error?: string; // Present when success is false
}
```

### Example Message Exchange

**Request (MCP Server → VSCode Extension):**
```json
{
  "type": "present-review",
  "payload": {
    "content": "# Authentication Review\n\n## Summary\nImplemented JWT-based auth...",
    "mode": "replace"
  },
  "id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response (VSCode Extension → MCP Server):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "success": true
}
```

## Error Handling

### Connection Errors
- **Missing Environment Variable**: MCP server throws clear error if `DIALECTIC_IPC_PATH` not set
- **Socket Connection Failed**: Network-level connection errors propagated to AI assistant
- **Extension Not Running**: Connection refused when VSCode extension not active

### Message Errors
- **Invalid JSON**: Extension sends error response for malformed messages
- **Unknown Message Type**: Extension responds with error for unsupported message types
- **Validation Failures**: Parameter validation errors returned in response

### Timeout Protection
```typescript
// 5-second timeout prevents hanging requests
setTimeout(() => {
  if (this.pendingRequests.has(message.id)) {
    this.pendingRequests.delete(message.id);
    reject(new Error('IPC request timeout'));
  }
}, 5000);
```

## Concurrency Support

### Request Tracking
The MCP server maintains a map of pending requests to support multiple concurrent operations:

```typescript
private pendingRequests = new Map<string, {
  resolve: (result: PresentReviewResult) => void;
  reject: (error: Error) => void;
}>();
```

### Unique Message IDs
Each request gets a UUID to ensure proper response correlation:
```typescript
const message: IPCMessage = {
  type: 'present-review',
  payload: params,
  id: randomUUID(), // Ensures unique tracking
};
```

## Resource Management

### Socket Cleanup (VSCode Extension)
```typescript
context.subscriptions.push({
  dispose: () => {
    server.close();
    if (fs.existsSync(socketPath)) {
      fs.unlinkSync(socketPath);
    }
  }
});
```

### Connection Cleanup (MCP Server)
```typescript
async close(): Promise<void> {
  if (this.socket) {
    this.socket.end();
    this.socket = null;
  }
  
  // Reject any pending requests
  for (const [id, pending] of this.pendingRequests) {
    pending.reject(new Error('IPC connection closed'));
  }
  this.pendingRequests.clear();
}
```

## Platform Compatibility

### Unix Domain Sockets (macOS/Linux)
- Socket files created in VSCode extension storage directory
- Standard Unix socket permissions and cleanup
- Path format: `/path/to/storage/dialectic.sock`

### Named Pipes (Windows)
- Windows named pipe format: `\\\\.\\pipe\\dialectic-{timestamp}`
- Automatic cleanup on process termination
- Compatible with Node.js `net.createConnection()`

## Security Considerations

### Local-Only Communication
- Unix sockets and named pipes are local-only by design
- No network exposure or remote access possible
- Socket files created with appropriate file permissions

### Input Validation
- All message parameters validated before processing
- TypeScript interfaces provide compile-time type safety
- Runtime validation prevents malformed message processing

## Testing Strategy

### Unit Testing
- **Test Mode**: Constructor parameter bypasses real socket connections
- **Mock Responses**: Simulated success/error responses for comprehensive testing
- **Coverage**: 49/49 tests passing with full error scenario coverage

### Integration Testing
- **Environment Detection**: Verifies proper error when not in VSCode
- **Socket Creation**: Tests platform-specific socket path generation
- **Message Protocol**: Validates JSON serialization/deserialization

## Performance Characteristics

### Latency
- **Local IPC**: Sub-millisecond communication latency
- **JSON Parsing**: Minimal overhead for typical review sizes
- **Connection Reuse**: Single persistent connection per MCP server instance

### Throughput
- **Concurrent Requests**: Supports multiple simultaneous `present-review` calls
- **Large Reviews**: Tested with 1000+ line review content
- **Memory Efficiency**: Automatic cleanup of completed requests

## Future Enhancements

### Protocol Extensions
- **Streaming Updates**: For very large review content
- **Diff-Based Updates**: Minimize data transfer for incremental changes
- **Multi-Review Support**: Handle multiple concurrent review sessions

### Advanced Features
- **Review History**: Maintain previous review versions
- **Bidirectional Updates**: Extension-initiated updates to MCP server
- **Status Notifications**: Real-time status updates during review processing