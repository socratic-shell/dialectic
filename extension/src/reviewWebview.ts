// 💡: Webview-based review provider using markdown-it for secure, extensible markdown rendering
// Follows VSCode extension best practices with custom link handling and proper CSP

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as MarkdownIt from 'markdown-it';
import { parseDialecticUrl, DialecticUrl } from './dialecticUrl';
import { searchInFile, getBestSearchResult, formatSearchResults } from './searchEngine';

export class ReviewWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private reviewContent: string = '';
    private baseUri: vscode.Uri | undefined;
    private md: MarkdownIt;
    private lineHighlightDecoration: vscode.TextEditorDecorationType;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        this.md = this.setupMarkdownRenderer();
        this.loadDummyReview();
        
        // 💡: Create decoration type for highlighting target lines
        // Uses theme-aware colors that work in both light and dark themes
        this.lineHighlightDecoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
            isWholeLine: true,
            overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.findMatchForeground'),
            overviewRulerLane: vscode.OverviewRulerLane.Center
        });
    }

    /**
     * Configure markdown-it with custom renderer for file references
     */
    private setupMarkdownRenderer(): MarkdownIt {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true
        });

        // 💡: Custom renderer rule for file reference links [`filename:line`][]
        const defaultRender = md.renderer.rules.link_open || function(tokens: any, idx: any, options: any, env: any, self: any) {
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.link_open = (tokens: any, idx: any, options: any, env: any, self: any) => {
            const token = tokens[idx];
            const href = token.attrGet('href');
            
            if (href) {
                let dialecticUrl = href;
                
                // Convert simplified syntax to dialectic: URLs
                if (!href.startsWith('dialectic:')) {
                    dialecticUrl = this.convertToDialecticUrl(href);
                }
                
                // Handle dialectic: URI scheme for file references
                if (dialecticUrl.startsWith('dialectic:')) {
                    token.attrSet('href', 'javascript:void(0)');
                    token.attrSet('data-dialectic-url', dialecticUrl);
                    token.attrSet('class', 'file-ref');
                    this.outputChannel.appendLine(`Processed dialectic URL: ${dialecticUrl}`);
                }
            }
            
            return defaultRender(tokens, idx, options, env, self);
        };

        return md;
    }

    /**
     * Show the review in a webview panel
     */
    public showReview(): void {
        if (this.panel) {
            // If panel already exists, just reveal it
            this.panel.reveal(vscode.ViewColumn.Beside);
        } else {
            // Create new webview panel
            this.panel = vscode.window.createWebviewPanel(
                'dialecticReview',
                'Dialectic Code Review',
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            // Handle panel disposal
            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });

            // Handle messages from webview
            this.panel.webview.onDidReceiveMessage(
                message => this.handleWebviewMessage(message),
                undefined,
                this.context.subscriptions
            );
        }

        // Update content
        this.updateWebviewContent();
    }

    /**
     * Update review content and refresh webview
     */
    public updateReview(content: string, mode: 'replace' | 'update-section' | 'append' = 'replace', baseUri?: string): void {
        // 💡: Handle baseUri for file resolution
        if (baseUri) {
            const newBaseUri = vscode.Uri.file(baseUri);
            
            // Check for baseUri changes on non-replace operations
            if (mode !== 'replace' && this.baseUri && !this.baseUri.fsPath.startsWith(newBaseUri.fsPath)) {
                vscode.window.showErrorMessage(
                    `Cannot ${mode} review: Base directory changed from ${this.baseUri.fsPath} to ${newBaseUri.fsPath}. Use replace mode instead.`
                );
                return;
            }
            
            this.baseUri = newBaseUri;
            this.outputChannel.appendLine(`Review base URI set to: ${this.baseUri.fsPath}`);
        }

        switch (mode) {
            case 'replace':
                this.reviewContent = content;
                break;
            case 'append':
                this.reviewContent += '\n\n' + content;
                break;
            case 'update-section':
                // For now, treat as replace - could implement section updating later
                this.reviewContent = content;
                break;
        }

        // 💡: Always show the panel when content is updated
        this.showReview();
    }

    /**
     * Handle messages from the webview
     */
    private async handleWebviewMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'openFile':
                await this.openDialecticUrl(message.dialecticUrl);
                break;
            case 'copyReview':
                await vscode.env.clipboard.writeText(this.reviewContent);
                vscode.window.showInformationMessage('Review copied to clipboard');
                break;
            case 'ready':
                this.outputChannel.appendLine('Webview ready');
                break;
        }
    }

    /**
     * Open a file using dialectic URL format with search and line support
     */
    private async openDialecticUrl(dialecticUrlString: string): Promise<void> {
        try {
            // 💡: Parse the dialectic URL to extract components
            const dialecticUrl = parseDialecticUrl(dialecticUrlString);
            if (!dialecticUrl) {
                vscode.window.showErrorMessage(`Invalid dialectic URL: ${dialecticUrlString}`);
                return;
            }

            this.outputChannel.appendLine(`Opening dialectic URL: ${dialecticUrlString}`);
            this.outputChannel.appendLine(`Parsed: path=${dialecticUrl.path}, regex=${dialecticUrl.regex}, line=${JSON.stringify(dialecticUrl.line)}`);

            // 💡: Find the file using existing file resolution logic
            const fileUri = await this.resolveFileUri(dialecticUrl.path);
            if (!fileUri) {
                const baseInfo = this.baseUri ? ` (base: ${this.baseUri.fsPath})` : '';
                vscode.window.showErrorMessage(`File not found: ${dialecticUrl.path}${baseInfo}`);
                return;
            }

            // 💡: Open the document first
            const document = await vscode.workspace.openTextDocument(fileUri);

            let targetLine = 1;
            let targetColumn = 1;

            // 💡: Handle regex if specified
            let bestSearchResult: import('./searchEngine').SearchResult | undefined;
            if (dialecticUrl.regex) {
                try {
                    const searchResults = await searchInFile(fileUri, {
                        regexPattern: dialecticUrl.regex,
                        lineConstraint: dialecticUrl.line
                    });

                    this.outputChannel.appendLine(`Regex search results:\n${formatSearchResults(searchResults)}`);

                    const bestResult = getBestSearchResult(searchResults);
                    if (bestResult) {
                        bestSearchResult = bestResult; // Store for decoration
                        targetLine = bestResult.line;
                        targetColumn = bestResult.column;
                        this.outputChannel.appendLine(`Using regex result: line ${targetLine}, column ${targetColumn}`);
                    } else {
                        vscode.window.showWarningMessage(`Regex pattern "${dialecticUrl.regex}" not found in ${dialecticUrl.path}`);
                        // 💡: Fall back to line parameter if regex fails
                        if (dialecticUrl.line) {
                            targetLine = dialecticUrl.line.startLine;
                            targetColumn = dialecticUrl.line.startColumn || 1;
                        }
                    }
                } catch (error) {
                    this.outputChannel.appendLine(`Regex search failed: ${error}`);
                    vscode.window.showErrorMessage(`Regex search failed: ${error}`);
                    // 💡: Fall back to line parameter if regex fails
                    if (dialecticUrl.line) {
                        targetLine = dialecticUrl.line.startLine;
                        targetColumn = dialecticUrl.line.startColumn || 1;
                    }
                }
            } else if (dialecticUrl.line) {
                // 💡: No regex, just use line parameter
                targetLine = dialecticUrl.line.startLine;
                targetColumn = dialecticUrl.line.startColumn || 1;
            }

            // 💡: Convert to 0-based for VSCode API and create selection
            const line = Math.max(0, targetLine - 1);
            const column = Math.max(0, targetColumn - 1);
            const selection = new vscode.Range(line, column, line, column);

            const editor = await vscode.window.showTextDocument(document, {
                selection,
                viewColumn: vscode.ViewColumn.One
            });
            
            // 💡: Apply highlight decoration using the appropriate ranges
            const decorationRanges = this.createDecorationRanges(document, dialecticUrl.line, targetLine, targetColumn, bestSearchResult);
            if (decorationRanges.length > 0) {
                editor.setDecorations(this.lineHighlightDecoration, decorationRanges);
                
                // 💡: Remove highlight after 3 seconds
                setTimeout(() => {
                    if (vscode.window.activeTextEditor === editor) {
                        editor.setDecorations(this.lineHighlightDecoration, []);
                    }
                }, 3000);
            }

        } catch (error) {
            this.outputChannel.appendLine(`Failed to open dialectic URL: ${error}`);
            vscode.window.showErrorMessage(`Failed to open ${dialecticUrlString} - ${error}`);
        }
    }

    /**
     * Convert simplified URL syntax to dialectic: format
     */
    private convertToDialecticUrl(href: string): string {
        // Handle path?regex format for search
        const searchMatch = href.match(/^([^\s\[\]()]+)\?([^\s\[\]()]+)$/);
        if (searchMatch) {
            return `dialectic:${searchMatch[1]}?regex=${searchMatch[2]}`;
        }
        
        // Handle path#L42-L50 format for line ranges
        const rangeMatch = href.match(/^([^\s\[\]()]+)#L(\d+)-L(\d+)$/);
        if (rangeMatch) {
            return `dialectic:${rangeMatch[1]}?line=${rangeMatch[2]}-${rangeMatch[3]}`;
        }
        
        // Handle path#L42 format for single lines
        const lineMatch = href.match(/^([^\s\[\]()]+)#L(\d+)$/);
        if (lineMatch) {
            return `dialectic:${lineMatch[1]}?line=${lineMatch[2]}`;
        }
        
        // Return unchanged if no patterns match
        return href;
    }

    /**
     * Create decoration ranges based on line specification or search result
     */
    private createDecorationRanges(
        document: vscode.TextDocument, 
        lineSpec?: import('./dialecticUrl').LineSpec, 
        targetLine?: number, 
        targetColumn?: number,
        searchResult?: import('./searchEngine').SearchResult
    ): vscode.Range[] {
        // 💡: If we have a search result, highlight the exact match
        if (searchResult) {
            const line = Math.max(0, searchResult.line - 1); // Convert to 0-based
            const startCol = searchResult.matchStart;
            const endCol = searchResult.matchEnd;
            return [new vscode.Range(line, startCol, line, endCol)];
        }
        
        if (lineSpec) {
            const ranges: vscode.Range[] = [];
            
            switch (lineSpec.type) {
                case 'single':
                    // 💡: Highlight the entire line
                    const singleLine = Math.max(0, lineSpec.startLine - 1);
                    ranges.push(new vscode.Range(singleLine, 0, singleLine, document.lineAt(singleLine).text.length));
                    break;
                    
                case 'single-with-column':
                    // 💡: Highlight from the specified column to end of line
                    const lineWithCol = Math.max(0, lineSpec.startLine - 1);
                    const startCol = Math.max(0, (lineSpec.startColumn || 1) - 1);
                    ranges.push(new vscode.Range(lineWithCol, startCol, lineWithCol, document.lineAt(lineWithCol).text.length));
                    break;
                    
                case 'range':
                    // 💡: Highlight all lines in the range
                    const startLine = Math.max(0, lineSpec.startLine - 1);
                    const endLine = Math.min(document.lineCount - 1, (lineSpec.endLine || lineSpec.startLine) - 1);
                    for (let i = startLine; i <= endLine; i++) {
                        ranges.push(new vscode.Range(i, 0, i, document.lineAt(i).text.length));
                    }
                    break;
                    
                case 'range-with-columns':
                    // 💡: Highlight precise character range
                    const preciseStartLine = Math.max(0, lineSpec.startLine - 1);
                    const preciseEndLine = Math.min(document.lineCount - 1, (lineSpec.endLine || lineSpec.startLine) - 1);
                    const preciseStartCol = Math.max(0, (lineSpec.startColumn || 1) - 1);
                    const preciseEndCol = lineSpec.endColumn ? Math.max(0, lineSpec.endColumn - 1) : document.lineAt(preciseEndLine).text.length;
                    
                    if (preciseStartLine === preciseEndLine) {
                        // Same line - single range
                        ranges.push(new vscode.Range(preciseStartLine, preciseStartCol, preciseEndLine, preciseEndCol));
                    } else {
                        // Multiple lines - highlight from start column to end of first line, 
                        // full middle lines, and start of last line to end column
                        ranges.push(new vscode.Range(preciseStartLine, preciseStartCol, preciseStartLine, document.lineAt(preciseStartLine).text.length));
                        for (let i = preciseStartLine + 1; i < preciseEndLine; i++) {
                            ranges.push(new vscode.Range(i, 0, i, document.lineAt(i).text.length));
                        }
                        ranges.push(new vscode.Range(preciseEndLine, 0, preciseEndLine, preciseEndCol));
                    }
                    break;
            }
            
            return ranges;
        } else if (targetLine !== undefined) {
            // 💡: Fall back to single line highlighting for search results
            const line = Math.max(0, targetLine - 1);
            const startCol = targetColumn ? Math.max(0, targetColumn - 1) : 0;
            return [new vscode.Range(line, startCol, line, document.lineAt(line).text.length)];
        }
        
        return [];
    }
    private async resolveFileUri(fileName: string): Promise<vscode.Uri | undefined> {
        // 💡: Try baseUri first if available
        if (this.baseUri) {
            const candidateUri = vscode.Uri.joinPath(this.baseUri, fileName);
            try {
                await vscode.workspace.fs.stat(candidateUri);
                this.outputChannel.appendLine(`Found file using baseUri: ${candidateUri.fsPath}`);
                return candidateUri;
            } catch {
                this.outputChannel.appendLine(`File not found at baseUri: ${candidateUri.fsPath}`);
            }
        }

        // 💡: Fall back to workspace folder search
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }

        for (const folder of workspaceFolders) {
            const candidateUri = vscode.Uri.joinPath(folder.uri, fileName);
            try {
                await vscode.workspace.fs.stat(candidateUri);
                this.outputChannel.appendLine(`Found file in workspace: ${candidateUri.fsPath}`);
                return candidateUri;
            } catch {
                // File not found in this folder, continue searching
            }
        }

        return undefined;
    }

    /**
     * Update the webview content with rendered markdown
     */
    private async updateWebviewContent(): Promise<void> {
        if (!this.panel) {
            return;
        }

        try {
            this.outputChannel.appendLine('=== MARKDOWN INPUT ===');
            this.outputChannel.appendLine(this.reviewContent);

            // 💡: Use markdown-it to render markdown to HTML with custom file reference handling
            const renderedHtml = this.md.render(this.reviewContent);

            this.outputChannel.appendLine('=== RENDERED HTML ===');
            this.outputChannel.appendLine(renderedHtml);

            // 💡: Sanitize HTML for security using DOMPurify
            const sanitizedHtml = this.sanitizeHtml(renderedHtml);

            this.outputChannel.appendLine('=== SANITIZED HTML ===');
            this.outputChannel.appendLine(sanitizedHtml);

            // 💡: Create complete HTML document with proper CSP and styling
            this.panel.webview.html = this.getWebviewContent(sanitizedHtml);
        } catch (error) {
            this.outputChannel.appendLine(`Failed to render markdown: ${error}`);
            // Fallback to plain text
            this.panel.webview.html = this.getWebviewContent(`<pre>${this.reviewContent}</pre>`);
        }
    }

    /**
     * Sanitize HTML for security
     */
    private sanitizeHtml(html: string): string {
        // 💡: Basic HTML sanitization for VSCode webview context
        // Remove potentially dangerous content while preserving our markdown-generated HTML
        return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                  .replace(/javascript:/gi, '')
                  .replace(/on\w+="[^"]*"/gi, '');
    }

    /**
     * Generate the complete HTML content for the webview with proper CSP
     */
    private getWebviewContent(content: string): string {
        // 💡: Generate nonce for CSP security
        const nonce = crypto.randomBytes(16).toString('base64');
        
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" 
          content="default-src 'none'; 
                   style-src ${this.panel!.webview.cspSource} 'unsafe-inline'; 
                   script-src 'nonce-${nonce}';">
    <title>Dialectic Code Review</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            line-height: 1.6;
            padding: 20px;
            max-width: none;
        }
        
        h1, h2, h3, h4, h5, h6 {
            color: var(--vscode-foreground);
            margin-top: 24px;
            margin-bottom: 16px;
        }
        
        code {
            background-color: var(--vscode-textCodeBlock-background);
            color: var(--vscode-textPreformat-foreground);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
        
        pre {
            background-color: var(--vscode-textCodeBlock-background);
            color: var(--vscode-textPreformat-foreground);
            padding: 16px;
            border-radius: 6px;
            overflow-x: auto;
            font-family: var(--vscode-editor-font-family);
        }
        
        .file-ref {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
            border-bottom: 1px dotted var(--vscode-textLink-foreground);
        }
        
        .file-ref:hover {
            color: var(--vscode-textLink-activeForeground);
            border-bottom: 1px solid var(--vscode-textLink-activeForeground);
        }
        
        .copy-button {
            position: fixed;
            top: 20px;
            right: 20px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
        }
        
        .copy-button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <button class="copy-button" onclick="copyReview()">Copy Review</button>
    <div class="content">
        ${content}
    </div>
    
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Handle file reference clicks using data attributes
        document.addEventListener('click', (event) => {
            const target = event.target.closest('a');
            if (!target) return;
            
            const dialecticUrl = target.getAttribute('data-dialectic-url');
            if (dialecticUrl) {
                event.preventDefault();
                
                console.log('[Webview] Dialectic URL clicked:', dialecticUrl);
                
                vscode.postMessage({
                    command: 'openFile',
                    dialecticUrl: dialecticUrl
                });
                return;
            }
            
            // Handle regular links
            const href = target.getAttribute('href');
            if (href && href !== '#') {
                console.log('[Webview] Regular link clicked:', href);
                // Could open in external browser or handle differently
            }
        });
        
        // Copy review function
        function copyReview() {
            vscode.postMessage({
                command: 'copyReview'
            });
        }
        
        // Notify extension that webview is ready
        vscode.postMessage({
            command: 'ready'
        });
    </script>
</body>
</html>`;
    }

    /**
     * Dispose of resources
     */
    public dispose(): void {
        this.lineHighlightDecoration.dispose();
        this.panel?.dispose();
    }

    /**
     * Load dummy review content for testing
     */
    private loadDummyReview(): void {
        this.reviewContent = `# Add user authentication system

## Context
The application needed secure user authentication to protect user data and enable personalized features. This implements a JWT-based authentication system with secure password hashing.

## Changes Made
- Added authentication middleware [\`src/auth/middleware.ts:23\`][]
- Created user login/signup endpoints [here](dialectic:src/routes/auth.ts?line=45) 
- Updated user model with password hashing [\`src/models/user.ts:67\`][]
- Added JWT token generation and validation [in utils](dialectic:src/utils/jwt.ts?regex=generateToken)

## Implementation Details

### Authentication Flow [\`src/auth/middleware.ts:23\`][]
The middleware intercepts requests and validates JWT tokens. If the token is valid, the user object is attached to the request for downstream handlers to use.

### Password Security [check this](dialectic:src/models/user.ts?regex=hashPassword&line=60-80)
Passwords are hashed using bcrypt with a salt factor of 12. The plaintext password is never stored in the database.

## Design Decisions
- Used JWT tokens for stateless authentication
- Chose bcrypt over other hashing algorithms for better security
- Token expiration set to 24 hours for balance of security and UX`;
    }
}
