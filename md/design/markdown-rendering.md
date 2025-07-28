# Markdown Rendering Pipeline

*This section documents the markdown-to-HTML conversion system used in the VSCode extension.*

## Architecture Overview

Dialectic uses industry-standard markdown-it for markdown processing, with custom renderer rules for file reference handling and comprehensive security measures. This replaced the previous approach of using fragile VSCode internal APIs.

```
Markdown Content → markdown-it Parser → Custom Renderer Rules → HTML → DOMPurify → Secure Webview
```

## Core Components

### markdown-it Configuration

The markdown parser is configured with standard options and custom renderer rules:

```javascript
// 💡: Using markdown-it aligns with 95% of VSCode extensions and provides
// token-based architecture for precise link control at parsing stage
const md = markdownIt({
    html: true,        // Enable HTML tags in source
    linkify: true,     // Auto-convert URLs to links  
    typographer: true  // Enable smart quotes and other typography
});
```

**Key benefits:**
- **Industry standard**: Used by VSCode itself and 95% of markdown extensions
- **Token-based architecture**: Allows precise control over link handling at parse time
- **Extensive plugin ecosystem**: 2,000+ plugins available for future enhancements
- **Performance**: More efficient than post-processing HTML with regex

### Custom Renderer Rules

#### File Reference Detection

Custom `link_open` renderer rule detects `filename:line` patterns and transforms them into secure, clickable references:

```javascript
md.renderer.rules.link_open = function(tokens, idx, options, env, self) {
    const token = tokens[idx];
    const href = token.attrGet('href');
    
    // Detect file:line pattern
    if (href && /^[^:]+:\d+$/.test(href)) {
        // Transform to secure data attribute
        token.attrSet('data-file-ref', href);
        token.attrSet('href', '#');
        token.attrSet('class', 'file-reference');
    }
    
    return defaultRender(tokens, idx, options, env, self);
};
```

**Design decisions:**
- **Parse-time processing**: More reliable than post-processing HTML
- **Data attributes**: Secure alternative to href manipulation
- **Pattern matching**: Flexible regex allows various file reference formats

#### Reference-Style Link Preprocessing

A core ruler preprocesses markdown source to convert `[filename:line][]` reference-style links into regular markdown links:

```javascript
md.core.ruler.before('normalize', 'file_references', function(state) {
    // Convert [src/auth.ts:23][] → [src/auth.ts:23](src/auth.ts:23)
    state.src = state.src.replace(
        /\[([^\]]+:\d+)\]\[\]/g, 
        '[$1]($1)'
    );
});
```

**Benefits:**
- **Elegant syntax**: Users can write `[file:line][]` without defining references
- **Source-level transformation**: Happens before parsing, integrates naturally
- **Backward compatible**: Regular `[text](file:line)` links still work

## Security Integration

### HTML Sanitization

After markdown-it renders to HTML, DOMPurify sanitizes the output while preserving necessary attributes:

```javascript
const cleanHtml = DOMPurify.sanitize(renderedHtml, {
    ADD_ATTR: ['data-file-ref'],  // Preserve our custom attributes
    FORBID_TAGS: ['script'],      // Block dangerous tags
    FORBID_ATTR: ['onclick']      // Block event handlers
});
```

### Webview Integration

The sanitized HTML is inserted into a secure webview with proper CSP headers:

```javascript
const webviewHtml = `
<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Security-Policy" 
          content="default-src 'none'; script-src 'nonce-${nonce}';">
</head>
<body>
    ${cleanHtml}
    <script nonce="${nonce}">
        // Event delegation for file reference clicks
        document.addEventListener('click', function(e) {
            if (e.target.dataset.fileRef) {
                vscode.postMessage({
                    command: 'openFile',
                    fileRef: e.target.dataset.fileRef
                });
            }
        });
    </script>
</body>
</html>`;
```

## File Reference Handling

### Click Processing

JavaScript in the webview uses event delegation to handle clicks on file references:

1. **Click detection**: Event listener captures clicks on elements with `data-file-ref`
2. **Message passing**: Webview sends structured message to extension host
3. **File opening**: Extension uses VSCode API to open file at specified line

### Navigation Implementation

The extension processes file reference messages:

```javascript
// Handle messages from webview
panel.webview.onDidReceiveMessage(message => {
    if (message.command === 'openFile') {
        const [filename, line] = message.fileRef.split(':');
        const uri = vscode.Uri.file(path.resolve(workspaceRoot, filename));
        
        vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(parseInt(line) - 1, 0, parseInt(line) - 1, 0)
        });
    }
});
```

## Performance Considerations

### Single-Pass Processing

The markdown-it pipeline processes everything in one pass:
- **Parsing**: Tokenization and AST generation
- **Rendering**: Custom rules applied during HTML generation  
- **No post-processing**: Eliminates need for multiple regex operations

### Efficient Token System

markdown-it's token-based architecture is more efficient than string manipulation:
- **Structured data**: Tokens contain metadata for precise processing
- **Minimal overhead**: Only processes relevant tokens
- **Extensible**: Easy to add new link types without performance impact

## Future Enhancements

The markdown-it foundation enables easy extension:

### Syntax Highlighting
```javascript
md.use(require('markdown-it-highlightjs'));
```

### Enhanced Features
- **Tables**: `markdown-it-table` for better table rendering
- **Footnotes**: `markdown-it-footnote` for academic-style references  
- **Math**: `markdown-it-katex` for mathematical expressions
- **Diagrams**: `markdown-it-mermaid` for flowcharts and diagrams

### Custom Extensions
- **Function references**: `function:methodName` links to method definitions
- **Range references**: `file:startLine-endLine` for code blocks
- **Commit references**: `commit:hash` links to git history

The modular architecture makes these additions straightforward without affecting core functionality or security measures.
