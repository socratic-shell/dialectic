# MCP Tool Interface

*This section documents the `present_review` tool that AI assistants use to display code reviews in VSCode.*

## Tool Overview

The `present_review` tool is the primary interface between AI assistants and the Dialectic system. It accepts markdown content and displays it in the VSCode review panel with clickable file references and proper formatting.

## Tool Definition

The tool is registered with the MCP server and exposed to AI assistants:

```typescript
{{#include ../../server/src/index.ts:tool_definition}}
```

## Parameters

The tool accepts parameters defined by the `PresentReviewParams` interface:

```typescript
{{#include ../../server/src/types.ts:present_review_params}}
```

### Parameter Details

**`content` (required)**
- **Type**: `string`
- **Description**: Markdown content of the review to display
- **Format**: Standard markdown with support for file references using `[filename:line][]` syntax
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

**`baseUri` (optional)**
- **Type**: `string`  
- **Description**: Base directory path for resolving relative file references
- **Default**: Current workspace root
- **Usage**: Ensures file references resolve correctly in different workspace contexts

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
