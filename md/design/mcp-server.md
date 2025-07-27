# MCP Server Design

*This chapter details the design and implementation of the MCP server component.*

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
│   AI Assistant  │ ←─────────────────→ │   MCP Server    │ ←─────────────────→ │ VSCode Extension│
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
```

The MCP server operates as:
- **MCP Protocol Server**: Handles stdio communication with AI assistants
- **IPC Client**: Connects to VSCode extension's Unix socket server
- **Message Bridge**: Translates between MCP tool calls and IPC messages

## Core Tool: present-review

The primary tool exposed by the MCP server with enhanced structured guidance:

```typescript
{
  name: 'present-review',
  description: [
    'Display a code review in the VSCode review panel.',
    'Reviews should be structured markdown with clear sections and actionable feedback.'
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: [
          'Markdown content of the review. Should include:',
          '1) Brief summary suitable for commit message,',
          '2) Detailed findings with file references,',
          '3) Specific suggestions for improvement.',
          'Use `file:line` format for code references (e.g., `src/main.ts:42`).'
        ].join(' '),
      },
      mode: {
        type: 'string',
        enum: ['replace', 'update-section', 'append'],
        description: [
          'How to handle the review content:',
          'replace (default) - replace entire review,',
          'update-section - update specific section,',
          'append - add to existing review'
        ].join(' '),
        default: 'replace',
      },
      section: {
        type: 'string',
        description: [
          'Section name for update-section mode',
          '(e.g., "Summary", "Security Issues", "Performance")'
        ].join(' '),
      },
    },
    required: ['content'],
  },
}
```

### Tool Description Strategy

The multi-line description provides structured guidance to AI assistants:
- **Clear Purpose**: What the tool does and when to use it
- **Content Structure**: How to format review content for best results
- **Parameter Usage**: Specific examples and use cases for each parameter
- **Code References**: Standard format for linking to specific code locations

## Implementation Details

### Technology Stack
- **Language**: TypeScript running on Node.js
- **MCP SDK**: `@modelcontextprotocol/sdk` for protocol handling
- **Transport**: `StdioServerTransport` for AI assistant communication
- **IPC**: Node.js `net` module for Unix socket communication
- **Testing**: Jest with comprehensive unit test coverage (49/49 tests passing)

### Core Classes

#### DialecticMCPServer
Main server class that orchestrates MCP protocol handling:
```typescript
class DialecticMCPServer {
  private server: Server;
  private ipc: IPCCommunicator;

  constructor() {
    this.server = new Server({
      name: 'dialectic-mcp-server',
      version: '0.1.0',
    }, {
      capabilities: { tools: {} },
    });
    
    this.ipc = new IPCCommunicator();
    this.setupToolHandlers();
  }
}
```

#### IPCCommunicator
Handles all Unix socket communication with the VSCode extension:
```typescript
class IPCCommunicator {
  private socket: Socket | null = null;
  private pendingRequests = new Map<string, {
    resolve: (result: PresentReviewResult) => void;
    reject: (error: Error) => void;
  }>();

  async initialize(): Promise<void> {
    const socketPath = process.env.DIALECTIC_IPC_PATH;
    if (!socketPath) {
      throw new Error('DIALECTIC_IPC_PATH environment variable not set...');
    }
    // ... socket connection logic
  }
}
```

### Parameter Validation

Comprehensive validation using dedicated validation module:
```typescript
export function validatePresentReviewParams(args: unknown): PresentReviewParams {
  if (!args || typeof args !== 'object') {
    throw new ValidationError('Arguments must be an object');
  }

  const params = args as Record<string, unknown>;
  
  // Validate required content parameter
  if (typeof params.content !== 'string') {
    throw new ValidationError('content must be a string');
  }
  
  // Validate optional mode parameter
  const validModes = ['replace', 'update-section', 'append'];
  if (params.mode && !validModes.includes(params.mode as string)) {
    throw new ValidationError(`mode must be one of: ${validModes.join(', ')}`);
  }
  
  // ... additional validation logic
}
```

### Error Handling Strategy

#### Environment Detection
```typescript
async initialize(): Promise<void> {
  const socketPath = process.env.DIALECTIC_IPC_PATH;
  if (!socketPath) {
    throw new Error(
      'DIALECTIC_IPC_PATH environment variable not set. ' +
      'Are you running in VSCode with the Dialectic extension?'
    );
  }
  // ... connection logic
}
```

#### Connection Management
```typescript
this.socket.on('error', (error) => {
  console.error('IPC socket error:', error);
  reject(error);
});

this.socket.on('close', () => {
  console.error('IPC connection closed');
  this.socket = null;
  // Reject any pending requests
  for (const [id, pending] of this.pendingRequests) {
    pending.reject(new Error('IPC connection closed'));
  }
  this.pendingRequests.clear();
});
```

#### Timeout Protection
```typescript
// 5-second timeout prevents hanging requests
setTimeout(() => {
  if (this.pendingRequests.has(message.id)) {
    this.pendingRequests.delete(message.id);
    reject(new Error('IPC request timeout'));
  }
}, 5000);
```

## Message Protocol Implementation

### Request Creation
```typescript
async presentReview(params: PresentReviewParams): Promise<PresentReviewResult> {
  const message: IPCMessage = {
    type: 'present-review',
    payload: params,
    id: randomUUID(), // Unique tracking ID
  };

  return this.sendMessage(message);
}
```

### Response Handling
```typescript
private handleResponse(response: IPCResponse): void {
  const pending = this.pendingRequests.get(response.id);
  if (!pending) {
    console.error('Received response for unknown request ID:', response.id);
    return;
  }

  this.pendingRequests.delete(response.id);

  if (response.success) {
    pending.resolve({ 
      success: true,
      message: 'Review successfully displayed in VSCode'
    });
  } else {
    pending.resolve({
      success: false,
      message: response.error || 'Unknown error from VSCode extension'
    });
  }
}
```

## Testing Strategy

### Test Mode Implementation
```typescript
constructor(testMode: boolean = false) {
  this.testMode = testMode;
}

async presentReview(params: PresentReviewParams): Promise<PresentReviewResult> {
  if (this.testMode) {
    // Simulate successful review presentation for testing
    return {
      success: true,
      message: 'Review successfully displayed (test mode)',
    };
  }
  // ... real implementation
}
```

### Unit Test Coverage
- **Parameter Validation**: 100% coverage of all validation scenarios
- **IPC Communication**: Mock-based testing of socket operations
- **Error Handling**: Comprehensive error condition testing
- **Concurrent Operations**: Multi-request scenario validation

### Integration Testing
```javascript
// test-mcp-server.js - Standalone verification script
const server = spawn('node', [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });

// Test 1: Verify server starts and detects missing VSCode environment
// Test 2: Validate MCP protocol tool listing
// Test 3: Confirm proper error handling for missing environment
```

## Performance Characteristics

### Memory Management
- **Request Cleanup**: Automatic cleanup of completed/timed-out requests
- **Connection Reuse**: Single persistent socket connection per server instance
- **Efficient JSON**: Minimal serialization overhead for typical review sizes

### Concurrency Support
- **Promise-Based**: Non-blocking operations with proper async/await patterns
- **Unique Tracking**: UUID-based request correlation supports concurrent calls
- **Resource Isolation**: Each server instance maintains independent state

## Deployment Considerations

### Startup Sequence
1. **MCP Server** starts via AI assistant (stdio transport)
2. **Environment Check**: Validates `DIALECTIC_IPC_PATH` is set
3. **Socket Connection**: Establishes IPC connection to VSCode extension
4. **Tool Registration**: Exposes `present-review` tool to AI assistant
5. **Ready State**: Server ready to handle tool calls

### Error Recovery
- **Connection Loss**: Automatic detection and error propagation
- **Extension Restart**: Graceful handling of VSCode extension restarts
- **Invalid Messages**: Clear error responses for malformed requests

## Future Enhancements

### Enhanced Code References
Current implementation uses `file:line` format. Planned enhancement for search-based references:
```typescript
// Future: search://file?query=text format
// More resilient to code changes than line numbers
```

### Advanced Review Modes
- **Streaming Updates**: For very large review content
- **Diff-Based Updates**: Minimize data transfer for incremental changes
- **Multi-Review Sessions**: Support multiple concurrent review contexts

### Monitoring and Observability
- **Request Metrics**: Track request latency and success rates
- **Connection Health**: Monitor IPC connection stability
- **Error Analytics**: Aggregate error patterns for debugging

## Shared Type Definitions

Both the MCP server and VSCode extension use shared TypeScript interfaces:

```typescript
// types.ts - Shared between server and extension
export interface PresentReviewParams {
  content: string;
  mode: 'replace' | 'update-section' | 'append';
  section?: string;
}

export interface PresentReviewResult {
  success: boolean;
  message?: string;
}

export interface IPCMessage {
  type: 'present-review';
  payload: PresentReviewParams;
  id: string;
}

export interface IPCResponse {
  id: string;
  success: boolean;
  error?: string;
}
```

This ensures type safety across the communication boundary and prevents protocol mismatches during development.