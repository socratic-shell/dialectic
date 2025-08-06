# Terminal Registry

The terminal registry tracks which terminals have active MCP servers, enabling intelligent routing for [Ask Socratic Shell](../ask-socratic-shell.md) integration.

## Core Concept

Each VSCode extension maintains a `Set<number>` of shell PIDs that have active MCP servers. This registry is updated in real-time as MCP servers connect and disconnect.

```typescript
class DaemonClient {
    private activeTerminals = new Set<number>();
    
    getActiveTerminals(): Set<number> {
        return new Set(this.activeTerminals);
    }
}
```

## PID Discovery

MCP servers discover their shell PID by walking the process tree:

1. **Get parent PID** - Start with the MCP server's process ID
2. **Walk upward** - Follow parent processes until finding a shell
3. **Identify shell** - Look for processes named `bash`, `zsh`, `fish`, etc.
4. **Announce presence** - Send Polo message with discovered PID

## Registry Updates

The registry is maintained through daemon message bus events:

### Polo Message (Server Startup)
```rust
// MCP server announces presence
daemon.send(PoloMessage { shell_pid: 12345 });

// Extension updates registry
self.active_terminals.insert(shell_pid);
```

### Goodbye Message (Server Shutdown)
```rust
// MCP server announces departure  
daemon.send(GoodbyeMessage { shell_pid: 12345 });

// Extension updates registry
self.active_terminals.remove(&shell_pid);
```

## Terminal Matching

Ask Socratic Shell uses the registry to find AI-enabled terminals:

```typescript
// Get shell PID from VSCode terminal
const shellPID = await terminal.processId;

// Check if terminal has active MCP server
if (shellPID && activeTerminals.has(shellPID)) {
    // This terminal can handle AI requests
    return terminal;
}
```

## Multi-Window Support

Each VSCode window maintains its own terminal registry, but all receive the same daemon broadcasts. This enables:

- **Window isolation** - Each window tracks its own terminals
- **Cross-window awareness** - All windows know about all MCP servers
- **Intelligent routing** - Messages route to the correct window automatically

The terminal registry eliminates the need for users to name terminals or manually configure routing, providing seamless AI integration that "just works".
