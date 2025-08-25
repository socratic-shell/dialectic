// 💡: Webview-based review provider using markdown-it for secure, extensible markdown rendering
// Follows VSCode extension best practices with custom link handling and proper CSP

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as MarkdownIt from 'markdown-it';
import { parseDialecticUrl, DialecticUrl } from './dialecticUrl';
import { searchInFile, getBestSearchResult, formatSearchResults, needsDisambiguation } from './searchEngine';
import { openDialecticUrl } from './fileNavigation';

// Placement state for unified link and comment management
interface PlacementState {
    isPlaced: boolean;
    chosenLocation: any; // FileRange, SearchResult, or other location type
    wasAmbiguous: boolean; // Whether this item had multiple possible locations
}

export class ReviewWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private reviewContent: string = '';
    private baseUri: vscode.Uri | undefined;
    private md: MarkdownIt;
    private lineHighlightDecoration: vscode.TextEditorDecorationType;
    private placementMemory = new Map<string, PlacementState>(); // Unified placement memory

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
                // Clear placement memory for new review
                this.placementMemory.clear();
                break;
            case 'append':
                this.reviewContent += '\n\n' + content;
                break;
            case 'update-section':
                // For now, treat as replace - could implement section updating later
                this.reviewContent = content;
                // Clear placement memory for new review
                this.placementMemory.clear();
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
                await openDialecticUrl(message.dialecticUrl, this.outputChannel, this.baseUri, this.placementMemory);
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
     * Show disambiguation dialog for multiple search results
     * Similar to VSCode's "Go to References" functionality with live preview
     */
    private async showSearchDisambiguation(
        results: import('./searchEngine').SearchResult[], 
        searchTerm: string, 
        document: vscode.TextDocument
    ): Promise<import('./searchEngine').SearchResult | undefined> {
        // 💡: Create QuickPick items with context
        const items = results.map((result, index) => ({
            label: `Line ${result.line}: ${result.text.trim()}`,
            description: `$(search) Match ${index + 1} of ${results.length}`,
            detail: `Column ${result.column}`,
            result: result
        }));

        const quickPick = vscode.window.createQuickPick();
        quickPick.title = `Multiple matches for "${searchTerm}"`;
        quickPick.placeholder = 'Select the match you want to navigate to (preview updates as you navigate)';
        quickPick.items = items;
        quickPick.canSelectMany = false;

        return new Promise((resolve) => {
            let currentActiveItem: any = null;
            let isResolved = false;

            // 💡: Show live preview as user navigates through options
            quickPick.onDidChangeActive((items) => {
                if (items.length > 0) {
                    currentActiveItem = items[0]; // Track the currently active item
                    const selectedResult = (items[0] as any).result;
                    
                    // 💡: Show preview by revealing the location without committing to it
                    vscode.window.showTextDocument(document, {
                        selection: new vscode.Range(
                            selectedResult.line - 1, 
                            selectedResult.matchStart,
                            selectedResult.line - 1, 
                            selectedResult.matchEnd
                        ),
                        preview: true, // This keeps it as a preview tab
                        preserveFocus: true, // Keep focus on the QuickPick
                        viewColumn: vscode.ViewColumn.One // Ensure it opens in main editor area
                    }).then((editor) => {
                        // 💡: Add line decorations to preview just like final navigation
                        const decorationRanges = this.createDecorationRanges(
                            document, 
                            undefined, // No line constraint for search results
                            selectedResult.line, 
                            selectedResult.column, 
                            selectedResult
                        );
                        if (decorationRanges.length > 0) {
                            editor.setDecorations(this.lineHighlightDecoration, decorationRanges);
                            
                            // 💡: Remove preview highlight after 2 seconds (shorter than final)
                            setTimeout(() => {
                                if (editor && !editor.document.isClosed) {
                                    editor.setDecorations(this.lineHighlightDecoration, []);
                                }
                            }, 2000);
                        }
                    }, (error: any) => {
                        this.outputChannel.appendLine(`Preview failed: ${error}`);
                    });
                }
            });

            quickPick.onDidAccept(() => {
                if (isResolved) {
                    return;
                }

                // 💡: Use the currently active item instead of selectedItems
                const selected = currentActiveItem || quickPick.selectedItems[0];
                
                if (selected && (selected as any).result) {
                    const result = (selected as any).result;
                    isResolved = true;
                    quickPick.dispose();
                    resolve(result);
                    return;
                }
                
                // 💡: Fallback case
                isResolved = true;
                quickPick.dispose();
                resolve(undefined);
            });

            quickPick.onDidHide(() => {
                if (!isResolved) {
                    isResolved = true;
                    quickPick.dispose();
                    resolve(undefined);
                }
            });

            quickPick.show();
        });
    }

    private convertToDialecticUrl(href: string): string {
        // Handle path?regex format for search
        // Allow spaces in search patterns but exclude brackets and parentheses
        const searchMatch = href.match(/^([^\s\[\]()]+)\?([^\[\]()]+)$/);
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
        
        // Handle bare filenames - convert to dialectic: URL
        // This matches file paths that don't contain spaces, brackets, parentheses, or colons
        // Excludes URLs and other schemes by rejecting anything with ':'
        const bareFileMatch = href.match(/^([^\s\[\]():]+)$/);
        if (bareFileMatch) {
            return `dialectic:${bareFileMatch[1]}`;
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
                const stat = await vscode.workspace.fs.stat(candidateUri);
                // 💡: Check if it's a directory - we'll handle this differently
                if (stat.type === vscode.FileType.Directory) {
                    this.outputChannel.appendLine(`Found directory using baseUri: ${candidateUri.fsPath}`);
                    return candidateUri;
                }
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
                const stat = await vscode.workspace.fs.stat(candidateUri);
                // 💡: Check if it's a directory - we'll handle this differently
                if (stat.type === vscode.FileType.Directory) {
                    this.outputChannel.appendLine(`Found directory in workspace: ${candidateUri.fsPath}`);
                    return candidateUri;
                }
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
