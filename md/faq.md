# Frequently asked questions

## MCP Server Connection Issues

**Q: I'm getting "connect ENOENT" errors when starting the MCP server**

**A:** This is usually caused by a race condition during VSCode startup. The MCP server tries to connect before the Dialectic extension has fully activated and created the IPC socket.

**Solution:**
1. Check the VSCode "OUTPUT" tab and select "Dialectic" from the dropdown
2. Verify you see messages like:
   ```
   Dialectic extension is now active
   Setting up IPC server at: /tmp/dialectic-[uuid].sock
   IPC server listening on: /tmp/dialectic-[uuid].sock
   Set DIALECTIC_IPC_PATH environment variable to: /tmp/dialectic-[uuid].sock
   ```
3. Open a **new terminal** in VSCode (`Terminal > New Terminal`)
4. Run `dialectic-mcp-server` from the new terminal

The new terminal will inherit the updated `DIALECTIC_IPC_PATH` environment variable that the extension set after activation.
