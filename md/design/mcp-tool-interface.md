# MCP Tool Interface

*Reference documentation for the `present_review` tool exposed to AI assistants.*

## Tool Definition

```rust
{{#include ../../server/src/server.rs:present_review_tool}}
```

## Parameters

### `content` (required)
Markdown content of the review to display with support for clickable file references.

### `mode` (optional, default: "replace")
- `"replace"` - Replace entire review content
- `"update-section"` - Update specific section of existing review  
- `"append"` - Add content to end of existing review

### `baseUri` (required)
Base directory path for resolving relative file references.

### `section` (optional)
Section name for `update-section` mode.

## File Reference Formats

```markdown
[auth.ts](src/auth.ts)                    # Opens file
[auth.ts:42](src/auth.ts#L42)             # Jumps to line 42
[auth.ts:42-50](src/auth.ts#L42-L50)      # Highlights line range
[validateUser](src/auth.ts?validateUser)  # Finds pattern in file
```

## Usage Examples

### Basic Review
```javascript
await use_mcp_tool("present_review", {
    content: "# Code Review\n\nImplemented user authentication...",
    baseUri: "/workspace/myapp"
});
```

### Section Update
```javascript
await use_mcp_tool("present_review", {
    content: "## Updated Error Handling\n\nImproved validation...",
    mode: "update-section",
    section: "Error Handling", 
    baseUri: "/workspace/myapp"
});
```

### Append Mode
```javascript
await use_mcp_tool("present_review", {
    content: "## Next Steps\n\n- Add rate limiting\n- Implement caching",
    mode: "append",
    baseUri: "/workspace/myapp"
});
```
- **Example**: 
  ```markdown
  # Authentication System Implementation
  
  Added user authentication with secure session handling.
  
  ## Key Changes
  - Login endpoint ([`src/auth.ts:23`][])
  - User model updates ([`src/models/user.ts:45`][])
  ```

**`mode` (required)**
- **Type**: `'replace' | 'update-section' | 'append'`
- **Description**: How to handle the review content in the extension
- **Values**:
  - `'replace'`: Replace entire review panel content
  - `'update-section'`: Update specific section (requires `section` parameter)
  - `'append'`: Add content to end of existing review

**`section` (optional)**
- **Type**: `string`
- **Description**: Section name for `update-section` mode
- **Usage**: Allows updating specific parts of a review without replacing everything

**`baseUri` (required)**
- **Type**: `string`  
- **Description**: Base directory path for resolving relative file references
- **Usage**: Ensures file references resolve correctly as clickable links in VSCode

## Response Format

The tool returns a `PresentReviewResult`:

```typescript
{{#include ../../server/src/types.ts:present_review_result}}
```

## Implementation Flow

When an AI assistant calls the tool, the following sequence occurs:

```typescript
{{#include ../../server/src/index.ts:tool_handler}}
```

1. **Parameter Validation**: Input parameters are validated against the schema
2. **IPC Communication**: Valid parameters are forwarded to the VSCode extension via Unix socket
3. **Review Display**: Extension processes the markdown and updates the review panel
4. **Response**: Success/failure result is returned to the AI assistant

## Usage Examples

### Basic Review Display

```json
{
  "name": "present_review",
  "arguments": {
    "content": "# Code Review\n\nImplemented user authentication system.\n\n## Changes\n- Added login endpoint ([`src/auth.ts:23`][])\n- Updated user model ([`src/models/user.ts:45`][])",
    "mode": "replace"
  }
}
```

### Appending Additional Context

```json
{
  "name": "present_review", 
  "arguments": {
    "content": "\n## Security Considerations\n\nThe authentication system uses bcrypt for password hashing ([`src/auth.ts:67`][]).",
    "mode": "append"
  }
}
```

### Updating Specific Section

```json
{
  "name": "present_review",
  "arguments": {
    "content": "## Updated Implementation Details\n\nRefactored the login flow to use JWT tokens ([`src/auth.ts:89`][]).",
    "mode": "update-section",
    "section": "Implementation Details"
  }
}
```

## File Reference Format

File references should use the rustdoc-style format: `[filename:line][]`

**Supported formats:**
- `[`src/auth.ts:23`][]` - Links to line 23 in src/auth.ts
- `[`README.md:1`][]` - Links to line 1 in README.md
- `[`package.json:15`][]` - Links to line 15 in package.json

**Processing:**
1. References are converted to clickable links in the review panel
2. Clicking a reference opens the file at the specified line in VSCode
3. References remain functional even as code changes (line numbers are preserved)

## Error Handling

The tool validates all parameters and returns appropriate error messages:

- **Missing content**: "Content parameter is required"
- **Invalid mode**: "Mode must be 'replace', 'update-section', or 'append'"
- **Missing section**: "Section parameter required for update-section mode"
- **IPC failure**: "Failed to communicate with VSCode extension"

## Best Practices for AI Assistants

### Review Structure
- Start with a clear summary of what was implemented
- Use logical sections (Context, Changes Made, Implementation Details)
- Include file references for all significant code locations
- End with design decisions and rationale

### File References
- Reference the most important lines, not every change
- Use descriptive context around references
- Group related references together
- Prefer function/class entry points over implementation details

### Content Updates
- Use `replace` mode for new reviews
- Use `append` mode to add context or respond to questions
- Use `update-section` mode sparingly, only for targeted updates
- Keep individual tool calls focused and coherent

This tool interface enables rich, interactive code reviews that bridge the gap between AI-generated insights and IDE-native navigation.
