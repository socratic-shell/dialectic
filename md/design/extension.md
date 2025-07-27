# VSCode Extension Design

*This chapter details the design and implementation approach of the VSCode extension component.*

## Goal

The VSCode extension provides a simple, focused interface for displaying and interacting with AI-generated code reviews. It eliminates the need to scroll through terminal output by bringing reviews directly into the IDE as a first-class citizen.

### Core Functionality

The extension enables three essential capabilities:

1. **Review Display** - Pop up a dedicated panel when the AI assistant presents a review, showing the structured markdown content with proper formatting

2. **Code Navigation** - Make `file:line` references in the review clickable, allowing instant navigation to the referenced code locations in the editor

3. **Content Export** - Provide a "Copy" button to copy the review content to the clipboard for use in commit messages, documentation, or sharing

These three features support the core workflow: AI generates review → user reads and navigates → user exports for further use.

## Architecture

The extension operates as both a UI component and an IPC server:

```
┌─────────────────┐    IPC Server     ┌─────────────────┐    Tree View API    ┌─────────────────┐
│   MCP Server    │ ←─────────────────→ │ VSCode Extension│ ←─────────────────→ │   VSCode UI     │
└─────────────────┘                    └─────────────────┘                    └─────────────────┘
```

**Key Responsibilities:**
- Create and manage Unix socket IPC server for MCP communication
- Set environment variables for MCP server discovery
- Process incoming review messages and update UI components
- Provide tree-based review display with clickable navigation
- Handle copy-to-clipboard functionality

## Implementation Approach

### Technology Stack
- **Language**: TypeScript with VSCode Extension API
- **UI Framework**: VSCode TreeView API for hierarchical review display
- **IPC**: Node.js `net` module for Unix socket server
- **Markdown Processing**: Custom parser for tree structure generation
- **Navigation**: VSCode editor commands for file/line jumping

### Core Components

**Extension Activation**: Main entry point that sets up all functionality
- Creates review provider for tree-based display
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