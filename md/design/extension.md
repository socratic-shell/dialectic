# VSCode Extension Design

*This chapter details the design and implementation approach of the VSCode extension component.*

## Goal

The VSCode extension provides intelligent AI integration with two core capabilities:

1. **Review Display** - Present AI-generated code reviews in a dedicated sidebar panel with clickable navigation
2. **Ask Socratic Shell** - Route selected code to AI assistants with intelligent terminal detection and routing

## Architecture

The extension operates as a daemon client and UI component:

```
┌─────────────────┐    Daemon Client    ┌─────────────────┐    VSCode APIs    ┌─────────────────┐
│ Daemon Bus      │ ←─────────────────→ │ VSCode Extension│ ←───────────────→ │   VSCode UI     │
└─────────────────┘                    └─────────────────┘                  └─────────────────┘
                                               │
                                               ▼
                                        ┌─────────────────┐
                                        │Terminal Registry│
                                        └─────────────────┘
```

**Key Responsibilities:**
- Connect to daemon message bus as client
- Maintain terminal registry of AI-enabled terminals
- Process review presentation messages and update UI
- Implement Ask Socratic Shell with intelligent terminal routing
- Provide tree-based review display with clickable navigation

## Core Components

### Daemon Client
Manages connection to the daemon message bus:
- **Connection management** - Connects to daemon Unix socket on activation
- **Message handling** - Processes PresentReview, Polo, Goodbye, and Marco messages
- **Response routing** - Sends success/error responses back through daemon
- **Reconnection logic** - Handles daemon restarts gracefully

### Terminal Registry
Tracks which terminals have active AI assistants:
- **PID tracking** - Maintains `Set<number>` of shell PIDs with active MCP servers
- **Discovery updates** - Updates registry based on Polo/Goodbye messages from daemon
- **Terminal matching** - Maps VSCode terminals to shell PIDs for routing decisions
- **Workspace isolation** - Each window maintains independent registry

### Ask Socratic Shell Integration
Routes selected code to AI assistants:
- **Code selection** - Captures selected text with file location context
- **Terminal detection** - Queries terminal registry for AI-enabled terminals
- **Smart routing** - Auto-routes to single terminal or shows picker for multiple
- **Terminal picker** - VSCode QuickPick with memory and quick access options
- **Message formatting** - Formats code with context for AI consumption

### Review Provider
Displays AI-generated reviews in sidebar:
- **Tree structure** - Hierarchical display of review sections and content
- **Markdown rendering** - Processes markdown with custom link handling
- **Navigation** - Clickable file:line references that jump to code locations
- **Content management** - Supports replace, update, and append modes

## Implementation Details

### Terminal Registry Implementation
```typescript
class DaemonClient {
    private activeTerminals = new Set<number>();
    
    private handlePoloMessage(message: PoloMessage) {
        this.activeTerminals.add(message.shellPid);
        this.outputChannel.appendLine(`Added terminal PID ${message.shellPid} to registry`);
    }
    
    private handleGoodbyeMessage(message: GoodbyeMessage) {
        this.activeTerminals.delete(message.shellPid);
        this.outputChannel.appendLine(`Removed terminal PID ${message.shellPid} from registry`);
    }
}
```

### Ask Socratic Shell Flow
1. **User selects code** - Context menu or quick action triggers command
2. **Query registry** - Get list of terminals with active AI assistants
3. **Route intelligently**:
   - **Single terminal** - Send message directly
   - **Multiple terminals** - Show picker with memory
   - **No terminals** - Display helpful error message
4. **Format message** - Include file location and selected code
5. **Send to terminal** - Use VSCode terminal API to inject formatted text

### Terminal Picker UX
- **Quick access option** - "Use last terminal: [Name]" appears first
- **Visual indicators** - Star icons and "(last used)" labels
- **Natural ordering** - Terminals appear in same order as VSCode terminal list
- **Workspace memory** - Remembers preference per VSCode window
- **Graceful fallbacks** - Handles terminal closures and MCP server disconnections

### Message Processing
The extension filters daemon broadcasts based on shell PID matching:
```typescript
private async handlePresentReviewMessage(message: PresentReviewMessage) {
    // Check if this message is for a terminal in our window
    const matchingTerminal = await this.findTerminalByPID(message.shellPid);
    if (matchingTerminal) {
        // Process the review for our window
        await this.reviewProvider.presentReview(message);
        return { success: true };
    }
    // Ignore - another window will handle it
    return null;
}
```

## Multi-Window Support

Each VSCode window runs an independent extension instance:
- **Separate daemon connections** - Each window connects to the same daemon
- **Independent registries** - Each tracks its own terminals
- **Automatic routing** - Messages route to correct window based on shell PID
- **Isolated preferences** - Terminal picker memory is per-window

## Technology Stack

- **Language**: TypeScript with VSCode Extension API
- **IPC**: Node.js Unix socket client for daemon communication
- **UI**: VSCode TreeView API for review display, QuickPick for terminal selection
- **Terminal Integration**: VSCode Terminal API for message injection
- **State Management**: VSCode workspace state for terminal picker memory

The extension provides seamless AI integration that eliminates configuration while supporting sophisticated multi-window workflows.
- Registers tree view with VSCode's sidebar
- Sets up IPC server for MCP communication
- Registers commands and cleanup handlers

**IPC Server Implementation**: Creates platform-specific socket and handles connections
- Generates appropriate socket paths for Unix/Windows
- Listens for MCP server connections
- Processes incoming review messages
- Sets environment variables for discovery

**Review Provider**: Implements VSCode's TreeDataProvider interface
- Manages review content and tree structure
- Handles dynamic content updates (replace/append/update-section)
- Provides clickable navigation for code references
- Supports copy-to-clipboard functionality

### Design Patterns

**Tree-Based UI**: Hierarchical display matching markdown structure
- Headers become expandable sections
- Content items become clickable navigation points
- Icons differentiate between content types
- Automatic refresh when content updates

**Platform Compatibility**: Handles different operating systems
- Unix domain sockets for macOS/Linux
- Named pipes for Windows
- Automatic cleanup and resource management

**Event-Driven Updates**: Reactive UI updates
- Tree view refreshes when content changes
- Immediate visual feedback for user actions
- Proper event handling for VSCode integration

## User Interface Design

### Sidebar Integration
The extension adds a top-level sidebar view similar to Explorer or Source Control:
- Dedicated activity bar icon
- Collapsible tree structure
- Context menus and commands
- Integrated with VSCode's theming system

### Tree View Structure
```
📄 Review Title
├── 📁 Summary
│   ├── 🔤 Brief description of changes
│   └── 🔤 Key implementation decisions
├── 📁 Implementation Details
│   ├── 🔧 Authentication Flow (src/auth/middleware.ts:23) [clickable]
│   └── 🔧 Password Security (src/models/user.ts:67) [clickable]
└── 📁 Design Decisions
    ├── 🔤 Used JWT tokens for stateless authentication
    └── 🔤 Chose bcrypt over other hashing algorithms
```

### Interactive Features
- **Clickable References**: `file:line` patterns become navigation links
- **Copy Functionality**: Button to export review content
- **Expand/Collapse**: Tree sections can be expanded or collapsed
- **Tooltips**: Hover information for navigation hints

## Message Processing

### IPC Message Handling
The extension processes incoming messages from the MCP server:
- **JSON Parsing**: Validates and parses incoming messages
- **Message Routing**: Handles different message types appropriately
- **Error Responses**: Sends structured error responses for invalid messages
- **Success Confirmation**: Acknowledges successful operations

### Content Updates
Supports three update modes for dynamic review management:
- **Replace**: Complete content replacement (most common)
- **Append**: Add content to end (for incremental reviews)
- **Update-Section**: Smart section updates (MVP: append with header)

### Navigation Implementation
Converts markdown references to VSCode commands:
- **Pattern Detection**: Identifies `file:line` references in content
- **Command Creation**: Generates VSCode navigation commands
- **Error Handling**: Graceful handling of invalid file references
- **User Feedback**: Clear tooltips and visual indicators

## Error Handling and Robustness

### IPC Error Recovery
- **Connection Failures**: Continues operation even if IPC fails
- **Malformed Messages**: Proper error responses for invalid JSON
- **Socket Cleanup**: Automatic resource cleanup on extension deactivation

### User Experience
- **Clear Error Messages**: Specific guidance for common issues
- **Graceful Degradation**: Extension remains functional during errors
- **Visual Feedback**: Loading states and operation confirmations

### Resource Management
- **Memory Efficiency**: Proper disposal of VSCode API resources
- **Socket Lifecycle**: Clean creation and destruction of IPC sockets
- **Event Cleanup**: Proper removal of event listeners

## Testing and Validation

### Manual Testing Workflow
1. Install extension in VSCode
2. Verify environment variable setup in terminal
3. Test MCP server connection and communication
4. Validate review display, navigation, and copy functionality

### Integration Points
- **VSCode API**: Tree view registration and command handling
- **File System**: Socket file creation and cleanup
- **Clipboard**: System clipboard integration
- **Editor**: File navigation and selection

## Implementation Files

**Core Implementation:**
- `extension/src/extension.ts` - Main activation logic and IPC server setup
- `extension/src/reviewProvider.ts` - Tree view implementation and content management
- `extension/package.json` - Extension manifest and VSCode integration

**Configuration:**
- `extension/tsconfig.json` - TypeScript configuration
- `extension/.vscodeignore` - Files to exclude from extension package

## Performance Considerations

### Efficient Tree Updates
- Only re-parse markdown when content actually changes
- Use VSCode's built-in tree view virtualization
- Minimize DOM updates through proper event handling

### Memory Management
- Automatic cleanup of socket connections
- Efficient string processing for markdown parsing
- Proper disposal of VSCode API resources

## Future Enhancements

### Advanced UI Features
- **Review History**: Navigate between previous review versions
- **Diff View**: Show changes between review iterations
- **Search**: Find specific content within large reviews
- **Custom Themes**: Support for personalized review styling

### Enhanced Navigation
- **Smart References**: Support for search-based code references
- **Multi-File**: Handle references across multiple files
- **Context Preview**: Show code context without leaving review panel

### Collaboration Features
- **Comments**: Add inline comments to review sections
- **Sharing**: Export reviews in various formats
- **Integration**: Connect with external review tools

The extension provides a solid foundation for AI-driven code reviews while maintaining simplicity and focus on the core user experience. The design emphasizes reliability, performance, and seamless integration with VSCode's existing workflows.