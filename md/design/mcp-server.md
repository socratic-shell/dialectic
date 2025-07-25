# MCP Server Design

*This chapter details the design of the MCP server component.*

## Role and Responsibilities

The MCP server acts as a thin communication bridge between AI assistants and the VSCode extension. It does not generate or understand review content - that intelligence stays with the AI assistant.

## Core Tool: present-review

The primary tool exposed by the MCP server:

```json
{
  "name": "present-review",
  "description": "Display a code review in the VSCode review panel",
  "parameters": {
    "content": "string (markdown content of the review)",
    "mode": "string (replace|update-section|append)",
    "section": "string (optional, section name for update-section mode)"
  }
}
```

*TODO: Flesh out parameter details, error handling, and response format.*

## Implementation Language

The MCP server will be implemented in **TypeScript** running on Node.js. This choice provides:
- Strong typing for the MCP protocol and tool definitions
- Shared type definitions with the VSCode extension
- Excellent JSON handling and validation
- Rich ecosystem of MCP libraries and examples

## Shared Type Definitions

Both the MCP server and VSCode extension will use shared TypeScript interfaces to ensure type safety across the communication boundary:

```typescript
interface PresentReviewParams {
  content: string;
  mode: 'replace' | 'update-section' | 'append';
  section?: string;
}
```

This prevents protocol mismatches and provides compile-time verification of the communication contract.

## Implementation Notes

*This section will be expanded as we work through the technical details.*