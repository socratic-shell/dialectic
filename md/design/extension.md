# VSCode Extension Design

*This chapter details the design and implementation of the VSCode extension component.*

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

## Implementation Details

### Technology Stack
- **Language**: TypeScript with VSCode Extension API
- **UI Framework**: VSCode TreeView API for hierarchical review display
- **IPC**: Node.js `net` module for Unix socket server
- **Markdown Processing**: Custom parser for tree structure generation
- **Navigation**: VSCode editor commands for file/line jumping

### Core Components

#### Extension Activation (extension.ts)
Main entry point that sets up all extension functionality:
```typescript
export function activate(context: vscode.ExtensionContext) {
  // Create the review provider
  const reviewProvider = new ReviewProvider();
  
  // Register the tree data provider for custom view
  vscode.window.createTreeView('dialecticReviews', {
    treeDataProvider: reviewProvider,
    showCollapseAll: true
  });

  // Set up IPC server for communication with MCP server
  const server = createIPCServer(context, reviewProvider);
  
  // Register commands and cleanup handlers
  context.subscriptions.push(/* ... */);
}
```

#### IPC Server Implementation
Creates platform-specific socket and handles MCP server connections:
```typescript
function createIPCServer(context: vscode.ExtensionContext, reviewProvider: ReviewProvider): net.Server {
  const socketPath = getSocketPath(context);
  
  // Clean up any existing socket file
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }
  
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      try {
        const message: IPCMessage = JSON.parse(data.toString());
        handleIPCMessage(message, socket, reviewProvider);
      } catch (error) {
        // Send error response for invalid JSON
        const response: IPCResponse = {
          id: 'unknown',
          success: false,
          error: 'Invalid JSON message'
        };
        socket.write(JSON.stringify(response));
      }
    });
  });
  
  server.listen(socketPath);
  
  // Set environment variable for MCP server discovery
  context.environmentVariableCollection.replace("DIALECTIC_IPC_PATH", socketPath);
  
  return server;
}
```

#### Platform-Specific Socket Paths
```typescript
function getSocketPath(context: vscode.ExtensionContext): string {
  const storageUri = context.storageUri || context.globalStorageUri;
  const socketDir = storageUri.fsPath;
  
  // Ensure directory exists
  if (!fs.existsSync(socketDir)) {
    fs.mkdirSync(socketDir, { recursive: true });
  }
  
  // Platform-specific socket naming
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\dialectic-${Date.now()}`;
  } else {
    return path.join(socketDir, 'dialectic.sock');
  }
}
```

#### Message Processing
```typescript
function handleIPCMessage(message: IPCMessage, socket: net.Socket, reviewProvider: ReviewProvider): void {
  let response: IPCResponse;
  
  try {
    switch (message.type) {
      case 'present-review':
        // Update the review provider with new content
        reviewProvider.updateReview(
          message.payload.content, 
          message.payload.mode, 
          message.payload.section
        );
        response = {
          id: message.id,
          success: true
        };
        break;
      default:
        response = {
          id: message.id,
          success: false,
          error: `Unknown message type: ${message.type}`
        };
    }
  } catch (error) {
    response = {
      id: message.id,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  
  socket.write(JSON.stringify(response));
}
```

### Review Provider Implementation (reviewProvider.ts)

#### Tree Data Provider
Implements VSCode's TreeDataProvider interface for hierarchical review display:
```typescript
export class ReviewProvider implements vscode.TreeDataProvider<ReviewItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ReviewItem | undefined | null | void> = 
    new vscode.EventEmitter<ReviewItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ReviewItem | undefined | null | void> = 
    this._onDidChangeTreeData.event;

  private reviewContent: string = '';
  private reviewItems: ReviewItem[] = [];

  getTreeItem(element: ReviewItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ReviewItem): Thenable<ReviewItem[]> {
    if (!element) {
      return Promise.resolve(this.reviewItems);
    }
    return Promise.resolve(element.children || []);
  }
}
```

#### Dynamic Content Updates
```typescript
updateReview(content: string, mode: 'replace' | 'update-section' | 'append' = 'replace', section?: string): void {
  switch (mode) {
    case 'replace':
      this.reviewContent = content;
      break;
    case 'append':
      this.reviewContent += '\n\n' + content;
      break;
    case 'update-section':
      if (section) {
        // MVP implementation: append with section header
        this.reviewContent += `\n\n## ${section}\n${content}`;
      } else {
        this.reviewContent += '\n\n' + content;
      }
      break;
  }
  
  // Re-parse content and refresh tree view
  this.reviewItems = this.parseMarkdownToTree(this.reviewContent);
  this.refresh();
}
```

#### Markdown Parsing for Tree Structure
```typescript
private parseMarkdownToTree(markdown: string): ReviewItem[] {
  const lines = markdown.split('\n');
  const items: ReviewItem[] = [];
  let currentSection: ReviewItem | null = null;

  for (const line of lines) {
    if (line.startsWith('# ')) {
      const item = new ReviewItem(
        line.substring(2),
        vscode.TreeItemCollapsibleState.Expanded,
        'title'
      );
      items.push(item);
      currentSection = item;
    } else if (line.startsWith('## ')) {
      const item = new ReviewItem(
        line.substring(3),
        vscode.TreeItemCollapsibleState.Expanded,
        'section'
      );
      items.push(item);
      currentSection = item;
    } else if (line.startsWith('### ')) {
      const item = new ReviewItem(
        line.substring(4),
        vscode.TreeItemCollapsibleState.Collapsed,
        'subsection'
      );
      if (currentSection) {
        if (!currentSection.children) {
          currentSection.children = [];
        }
        currentSection.children.push(item);
      }
    } else if (line.trim().startsWith('- ') || (line.trim() && !line.startsWith('#'))) {
      const content = line.trim().startsWith('- ') ? line.trim().substring(2) : line.trim();
      const item = this.createContentItem(content);
      if (currentSection) {
        if (!currentSection.children) {
          currentSection.children = [];
        }
        currentSection.children.push(item);
      }
    }
  }

  return items;
}
```

#### Clickable Code Navigation
```typescript
private createContentItem(content: string): ReviewItem {
  // Check for file:line references
  const fileRefMatch = content.match(/\(([^:)]+):(\d+)\)/);
  
  const item = new ReviewItem(
    content,
    vscode.TreeItemCollapsibleState.None,
    'content'
  );

  if (fileRefMatch) {
    const fileName = fileRefMatch[1];
    const lineNumber = parseInt(fileRefMatch[2]) - 1; // VSCode uses 0-based line numbers
    
    // Make it clickable by adding a command
    item.command = {
      command: 'vscode.open',
      title: 'Open File',
      arguments: [
        vscode.Uri.file(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath + '/' + fileName),
        {
          selection: new vscode.Range(lineNumber, 0, lineNumber, 0)
        }
      ]
    };
    
    item.tooltip = `Click to open ${fileName}:${lineNumber + 1}`;
  }

  return item;
}
```

#### Copy to Clipboard Functionality
```typescript
copyReviewToClipboard(): void {
  vscode.env.clipboard.writeText(this.reviewContent).then(() => {
    vscode.window.showInformationMessage('Review copied to clipboard!');
  });
}
```

### Review Item Implementation
```typescript
class ReviewItem extends vscode.TreeItem {
  public children?: ReviewItem[];
  public itemType: 'title' | 'section' | 'subsection' | 'content';

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    itemType: 'title' | 'section' | 'subsection' | 'content'
  ) {
    super(label, collapsibleState);

    this.itemType = itemType;
    this.tooltip = this.label;
    
    // Set different icons based on item type
    switch (itemType) {
      case 'title':
        this.iconPath = new vscode.ThemeIcon('file-text');
        break;
      case 'section':
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
        break;
      case 'subsection':
        this.iconPath = new vscode.ThemeIcon('symbol-method');
        break;
      case 'content':
        this.iconPath = new vscode.ThemeIcon('symbol-string');
        break;
    }
  }
}
```

## User Interface Design

### Sidebar Integration
The extension adds a top-level sidebar view (like Explorer, Search, Source Control):
```json
// package.json contribution
"views": {
  "dialecticReviews": [
    {
      "id": "dialecticReviews",
      "name": "Code Reviews",
      "when": "true"
    }
  ]
},
"viewsContainers": {
  "activitybar": [
    {
      "id": "dialecticReviews",
      "title": "Dialectic Reviews",
      "icon": "$(file-text)"
    }
  ]
}
```

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

### Command Integration
```json
// package.json commands
"commands": [
  {
    "command": "dialectic.showReview",
    "title": "Show Review",
    "icon": "$(eye)"
  },
  {
    "command": "dialectic.copyReview",
    "title": "Copy Review",
    "icon": "$(copy)"
  }
]
```

## Error Handling and Robustness

### IPC Error Recovery
```typescript
socket.on('error', (error) => {
  console.error('IPC socket error:', error);
  // Continue operation - extension remains functional even if IPC fails
});

socket.on('close', () => {
  console.log('MCP server disconnected from IPC');
  // Socket cleanup handled automatically
});
```

### Malformed Message Handling
```typescript
socket.on('data', (data) => {
  try {
    const message: IPCMessage = JSON.parse(data.toString());
    handleIPCMessage(message, socket, reviewProvider);
  } catch (error) {
    console.error('Failed to parse IPC message:', error);
    const response: IPCResponse = {
      id: 'unknown',
      success: false,
      error: 'Invalid JSON message'
    };
    socket.write(JSON.stringify(response));
  }
});
```

### Resource Cleanup
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

## Performance Considerations

### Efficient Tree Updates
- Only re-parse markdown when content actually changes
- Use VSCode's built-in tree view virtualization for large reviews
- Minimize DOM updates through proper event handling

### Memory Management
- Automatic cleanup of socket connections
- Efficient string processing for markdown parsing
- Proper disposal of VSCode API resources

## Testing and Validation

### Manual Testing Workflow
1. Install extension in VSCode
2. Open terminal and verify `DIALECTIC_IPC_PATH` environment variable is set
3. Run MCP server and verify connection establishment
4. Test review display, navigation, and copy functionality

### Integration Points
- **VSCode API**: Tree view registration and command handling
- **File System**: Socket file creation and cleanup
- **Clipboard**: System clipboard integration
- **Editor**: File navigation and selection

## Future Enhancements

### Advanced UI Features
- **Review History**: Maintain and navigate between previous review versions
- **Diff View**: Show changes between review iterations
- **Search**: Find specific content within large reviews
- **Themes**: Support for custom review styling

### Enhanced Navigation
- **Smart References**: Support for search-based code references
- **Multi-File**: Handle references across multiple files simultaneously
- **Context Preview**: Show code context without leaving review panel

### Collaboration Features
- **Comments**: Add inline comments to review sections
- **Sharing**: Export reviews in various formats (PDF, HTML, etc.)
- **Integration**: Connect with external review tools and workflows

The extension provides a solid foundation for AI-driven code reviews while maintaining simplicity and focus on the core user experience.