# VSCode Extension Design

*This chapter details the design of the VSCode extension component.*

## Goal

The VSCode extension provides a simple, focused interface for displaying and interacting with AI-generated code reviews. It eliminates the need to scroll through terminal output by bringing reviews directly into the IDE as a first-class citizen.

### Core Functionality

The extension enables three essential capabilities:

1. **Review Display** - Pop up a dedicated panel when the AI assistant presents a review, showing the structured markdown content with proper formatting

2. **Code Navigation** - Make `file:line` references in the review clickable, allowing instant navigation to the referenced code locations in the editor

3. **Content Export** - Provide a "Copy" button to copy the review content to the clipboard for use in commit messages, documentation, or sharing

These three features support the core workflow: AI generates review → user reads and navigates → user exports for further use.

## Implementation Approach

### Review Panel
- Add a new panel to VSCode's sidebar (similar to file explorer, source control)
- Render markdown content with VSCode's built-in markdown support
- Show/hide panel automatically when reviews are presented

### Clickable References
- Parse `file:line` patterns in the markdown content
- Convert them to clickable links using VSCode's document link provider API
- Handle navigation using VSCode's editor commands

### Copy Functionality
- Simple button in the panel header
- Copy raw markdown content to system clipboard
- Provide user feedback on successful copy

## Implementation Language

The extension will be implemented in **TypeScript**, which is the standard and recommended language for VSCode extensions. This provides:
- Native VSCode API support with full type safety
- Excellent development experience within VSCode
- Strong typing to catch integration errors early
- Consistency with the MCP server implementation

## Technical Considerations

*TODO: Detail specific VSCode APIs, communication with MCP server, and error handling as implementation proceeds.*