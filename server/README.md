# Dialectic MCP Server

MCP server component for the Dialectic code review system. Provides tools for AI assistants to display code reviews in VSCode.

## Architecture

The MCP server acts as a thin communication bridge:
- **AI Assistant** calls `present-review` tool
- **MCP Server** forwards review data to VSCode extension via IPC
- **VSCode Extension** displays review in sidebar panel

## Setup

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server
npm start
```

## Development

```bash
# Watch mode for development
npm run dev
```

## Tools Provided

### present-review

Display a code review in the VSCode review panel.

**Parameters:**
- `content` (string, required): Markdown content of the review
- `mode` (string, optional): How to handle content - 'replace' (default), 'update-section', or 'append'  
- `section` (string, optional): Section name for 'update-section' mode

**Example:**
```json
{
  "content": "# Code Review\n\n## Summary\nLooks good overall...",
  "mode": "replace"
}
```

## Current Status

- ✅ Basic MCP server skeleton implemented
- ✅ `present-review` tool registered and validated
- ✅ Shared types defined for type safety
- 🚧 IPC communication with VSCode extension (placeholder)
- ⏳ Full end-to-end workflow testing

The server currently returns success responses without actual IPC communication, allowing testing of the MCP tool interface before implementing the full communication layer.
