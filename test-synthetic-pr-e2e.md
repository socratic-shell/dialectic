# End-to-End Test: Synthetic PR Workflow

## Test Setup

1. **Install Extension**: Build and install the Dialectic extension in VSCode
2. **Open Git Repository**: Open a repository with some commits in VSCode
3. **Start MCP Server**: Run the Dialectic MCP server in a terminal

## Test Steps

### Step 1: Verify MCP Server Connection
```bash
# In VSCode terminal
dialectic-mcp-server
```

Expected: Server starts and connects to VSCode extension via IPC

### Step 2: Call request_review Tool
```json
{
  "tool": "request_review",
  "params": {
    "commit_range": "HEAD~1",
    "title": "Test Synthetic PR",
    "description": "Testing the synthetic PR workflow"
  }
}
```

Expected: 
- MCP server generates diff and extracts AI comments
- Server sends `create_synthetic_pr` message to VSCode extension
- Extension creates CommentController with AI insight comments
- Comments appear in VSCode editor at appropriate line numbers

### Step 3: Verify Comment Display
- Open files that were changed in the commit range
- Look for comment threads with AI insights (💡❓📝🔧 icons)
- Verify comments are positioned at correct line numbers
- Check that comment content matches extracted AI insights

### Step 4: Test Update Workflow
```json
{
  "tool": "update_review", 
  "params": {
    "wait_for_feedback": {
      "review_id": "<review_id_from_step_2>"
    }
  }
}
```

Expected:
- Tool waits for user feedback
- User can interact with comments in VSCode
- Feedback flows back to MCP server

## Success Criteria

✅ **IPC Communication**: MCP server successfully sends synthetic PR data to VSCode
✅ **Comment Creation**: VSCode creates comment threads for AI insights  
✅ **Visual Display**: Comments appear with correct icons and formatting
✅ **File Navigation**: Clicking comments navigates to correct file locations
✅ **Error Handling**: Graceful handling of invalid file paths or line numbers

## Current Status

**Phase 2 Implementation Complete**:
- ✅ IPC message types added (`create_synthetic_pr`, `update_synthetic_pr`)
- ✅ MCP server sends synthetic PR data via IPC
- ✅ VSCode extension receives and processes synthetic PR messages
- ✅ SyntheticPRProvider creates CommentController for AI insights
- ✅ Comments display with appropriate icons and formatting

**Ready for Testing**: The basic synthetic PR workflow is now implemented and ready for end-to-end testing with real Git repositories and AI assistants.

## Next Steps

1. **Manual Testing**: Test with real Git repositories and MCP clients
2. **UI Polish**: Improve comment formatting and add more interactive features
3. **Feedback Loop**: Implement `wait_for_feedback` interactive workflow
4. **TreeDataProvider**: Add PR file navigation sidebar
5. **WebView Integration**: Connect with existing Dialectic review system
