# MCP Server Design

*This chapter details the design of the MCP server component.*

## Role and Responsibilities

The MCP server acts as a thin communication bridge between AI assistants and the VSCode extension. It does not generate or understand review content - that intelligence stays with the AI assistant.

## Core Tool: present-review

The primary tool exposed by the MCP server:

```json
{
  "name": "present-review",
  "description": "Display a code review in the VSCode review panel. Reviews should be structured markdown with clear sections and actionable feedback.",
  "parameters": {
    "content": "string (markdown content with structured review format)",
    "mode": "string (replace|update-section|append)",
    "section": "string (optional, section name for update-section mode)"
  }
}
```

### Review Structure Guidelines

The tool description guides AI assistants to create well-structured reviews:

1. **Brief Summary**: Suitable for commit messages
2. **Detailed Findings**: With file references using `file:line` format
3. **Specific Suggestions**: Actionable improvement recommendations

### Code Reference Format

Currently uses `file:line` format (e.g., `src/main.ts:42`). Future enhancement planned for search-based references (`search://file?query=text`) to improve resilience to code changes.

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