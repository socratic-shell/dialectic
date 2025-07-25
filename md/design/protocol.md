# Communication Protocol

*This chapter defines how the MCP server and VSCode extension communicate.*

## Message Flow

1. **AI Assistant** generates review markdown
2. **AI Assistant** calls `present-review` MCP tool 
3. **MCP Server** receives tool call, validates parameters
4. **MCP Server** forwards review data to VSCode extension
5. **VSCode Extension** renders review in panel, converts links to bookmarks

## Data Formats

*TODO: Define the specific JSON schemas for communication between server and extension.*

## Error Handling

*TODO: Define error conditions and recovery strategies.*

## Synchronization

*TODO: Detail how the extension keeps bookmarks synchronized with code changes.*

## Implementation Notes

*This section will be expanded as we work through the technical details.*