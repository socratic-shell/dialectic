# Building and Testing

*This section covers development environment setup, build processes, and testing procedures for contributors.*

## Development Environment Setup

### Prerequisites

- **Node.js**: Version 18 or later
- **npm**: Version 8 or later  
- **VSCode**: Version 1.74.0 or later (for extension development)
- **Git**: For version control

### Repository Structure

```
dialectic/
├── extension/          # VSCode extension
│   ├── src/           # TypeScript source
│   ├── package.json   # Extension manifest
│   └── tsconfig.json  # TypeScript config
├── server/            # MCP server
│   ├── src/           # TypeScript source  
│   ├── package.json   # Server package
│   └── tsconfig.json  # TypeScript config
├── md/                # Documentation (mdbook)
└── book.toml          # mdbook configuration
```

### Initial Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/socratic-shell/dialectic.git
   cd dialectic
   ```

2. **Install dependencies**:
   ```bash
   # Install extension dependencies
   cd extension
   npm install
   
   # Install server dependencies  
   cd ../server
   npm install
   
   # Return to root
   cd ..
   ```

3. **Install development tools**:
   ```bash
   # Install mdbook for documentation
   cargo install mdbook
   
   # Install VSCode extension CLI (optional)
   npm install -g @vscode/vsce
   ```

## Building

### VSCode Extension

```bash
cd extension
npm run compile        # Compile TypeScript
npm run watch         # Watch mode for development
npm run package       # Create .vsix package
```

**Build outputs**:
- `out/`: Compiled JavaScript files
- `dialectic-*.vsix`: Installable extension package

### MCP Server

```bash
cd server  
npm run build         # Compile TypeScript
npm run dev          # Development mode with auto-restart
npm run package      # Create distributable package
```

**Build outputs**:
- `dist/`: Compiled JavaScript files
- `dialectic-mcp-server-*.tgz`: npm package

### Documentation

```bash
mdbook build          # Build static documentation
mdbook serve          # Serve with live reload
```

**Build outputs**:
- `book/`: Static HTML documentation

## Testing

### Unit Tests

**Extension tests**:
```bash
cd extension
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

**Server tests**:
```bash
cd server
npm test              # Run all tests  
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

### Integration Tests

**End-to-end workflow**:
```bash
# Terminal 1: Start extension in debug mode
cd extension
npm run watch

# Terminal 2: Start MCP server in debug mode  
cd server
npm run dev

# Terminal 3: Test with AI assistant
q chat --trust-all-tools
```

**Test scenarios**:
1. **Basic review display**: AI calls `present_review` → content appears in VSCode
2. **File navigation**: Click file references → VSCode opens correct files/lines
3. **Content modes**: Test replace/append/update-section modes
4. **Error handling**: Invalid parameters, IPC failures, malformed content
5. **Security**: Malicious markdown content, script injection attempts

### Manual Testing Checklist

**Extension functionality**:
- [ ] Extension loads without errors
- [ ] Sidebar panel appears and shows "Ready" status
- [ ] IPC server starts and creates socket file
- [ ] Environment variable `DIALECTIC_IPC_PATH` is set

**MCP server functionality**:
- [ ] Server starts and registers `present_review` tool
- [ ] Parameter validation works correctly
- [ ] IPC connection to extension succeeds
- [ ] Error messages are clear and helpful

**Review display**:
- [ ] Markdown renders correctly with proper formatting
- [ ] File references become clickable links
- [ ] Clicking references opens correct files at right lines
- [ ] Security measures prevent script execution
- [ ] Large content doesn't crash the extension

**Cross-platform compatibility**:
- [ ] Unix sockets work on macOS/Linux
- [ ] Named pipes work on Windows
- [ ] File path resolution works across platforms

## Debugging

### VSCode Extension Debugging

1. **Open extension in VSCode**:
   ```bash
   cd extension
   code .
   ```

2. **Start debug session**:
   - Press F5 or go to Run → Start Debugging
   - This opens a new VSCode window with the extension loaded
   - Set breakpoints in TypeScript source files

3. **View debug output**:
   - Help → Toggle Developer Tools → Console
   - Output panel → "Dialectic" channel

### MCP Server Debugging

1. **Enable debug logging**:
   ```bash
   cd server
   npm run dev -- --log-level debug
   ```

2. **Use Node.js debugger**:
   ```bash
   node --inspect dist/index.js
   ```
   Then connect with Chrome DevTools or VSCode debugger

3. **Test IPC communication**:
   ```bash
   # Send test message to socket
   echo '{"type":"present_review","payload":{"content":"# Test","mode":"replace"},"id":"test"}' | nc -U /path/to/socket
   ```

### Common Issues

**Extension not loading**:
- Check TypeScript compilation errors: `npm run compile`
- Verify package.json activation events and contributions
- Check VSCode version compatibility

**IPC connection failures**:
- Verify socket file permissions and location
- Check environment variable is set correctly
- Ensure both processes are running

**File references not working**:
- Verify workspace root detection
- Check file path resolution logic
- Test with different file path formats

## Performance Testing

### Load Testing

Test with large review content:
```javascript
// Generate large review for testing
const largeContent = Array(1000).fill(0).map((_, i) => 
  `## Section ${i}\nContent for section ${i} with [file${i}.ts:${i}][] reference.`
).join('\n\n');
```

### Memory Profiling

Monitor memory usage during development:
```bash
# Extension memory usage
code --inspect-extensions=9229

# Server memory usage  
node --inspect --max-old-space-size=4096 dist/index.js
```

## Continuous Integration

### GitHub Actions

The repository includes CI workflows for:
- **Build verification**: Ensure all components compile
- **Test execution**: Run unit and integration tests
- **Security scanning**: Check for vulnerabilities
- **Documentation**: Verify mdbook builds successfully

### Pre-commit Hooks

Install pre-commit hooks to ensure code quality:
```bash
npm install -g husky
husky install
```

**Hooks include**:
- TypeScript compilation check
- ESLint code style validation
- Unit test execution
- Documentation link validation

## Release Process

### Version Management

1. **Update version numbers**:
   ```bash
   # Extension
   cd extension && npm version patch
   
   # Server  
   cd server && npm version patch
   ```

2. **Build release packages**:
   ```bash
   cd extension && npm run package
   cd server && npm run package
   ```

3. **Test release packages**:
   - Install extension from .vsix file
   - Install server from .tgz file
   - Verify end-to-end functionality

4. **Create GitHub release**:
   - Tag version in git
   - Upload packages to release
   - Update documentation

### Distribution

- **VSCode Extension**: Published to VSCode Marketplace
- **MCP Server**: Published to npm registry
- **Documentation**: Deployed to GitHub Pages

This development workflow ensures reliable builds, comprehensive testing, and smooth releases for both contributors and users.
