// 💡: Webview-based review provider that renders markdown as HTML using VSCode's built-in renderer
// Replaces the tree-based approach with a more readable HTML presentation

import * as vscode from 'vscode';

export class ReviewWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private reviewContent: string = '';

    constructor(private context: vscode.ExtensionContext) {
        this.loadDummyReview();
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

        // Update the webview content
        this.updateWebviewContent();
    }

    /**
     * Update review content from MCP server via IPC
     */
    public updateReview(content: string, mode: 'replace' | 'update-section' | 'append' = 'replace', section?: string): void {
        switch (mode) {
            case 'replace':
                this.reviewContent = content;
                break;
            case 'append':
                this.reviewContent += '\n\n' + content;
                break;
            case 'update-section':
                if (section) {
                    // 💡: For MVP, just append with section header
                    // Future enhancement could implement smart section replacement
                    this.reviewContent += `\n\n## ${section}\n${content}`;
                } else {
                    // Fallback to append if no section specified
                    this.reviewContent += '\n\n' + content;
                }
                break;
        }

        // Update webview if it's open
        if (this.panel) {
            this.updateWebviewContent();
        } else {
            // Auto-show the review when content is updated
            this.showReview();
        }

        console.log('Review updated via IPC:', mode, section ? `(section: ${section})` : '');
    }

    /**
     * Copy review content to clipboard
     */
    public copyReviewToClipboard(): void {
        vscode.env.clipboard.writeText(this.reviewContent).then(() => {
            vscode.window.showInformationMessage('Review copied to clipboard!');
        });
    }

    /**
     * Handle messages from the webview
     */
    private async handleWebviewMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'openFile':
                await this.openFileAtLine(message.file, message.line);
                break;
            case 'copyReview':
                this.copyReviewToClipboard();
                break;
            case 'ready':
                // Webview is ready, we can send initial content
                console.log('Webview ready');
                break;
        }
    }

    /**
     * Open a file at a specific line number
     */
    private async openFileAtLine(fileName: string, lineNumber: number): Promise<void> {
        try {
            // 💡: Resolve file path relative to workspace
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const filePath = vscode.Uri.joinPath(workspaceFolder.uri, fileName);
            const document = await vscode.workspace.openTextDocument(filePath);
            
            // 💡: Convert to 0-based line number and create selection
            const line = Math.max(0, lineNumber - 1);
            const selection = new vscode.Range(line, 0, line, 0);
            
            await vscode.window.showTextDocument(document, {
                selection,
                viewColumn: vscode.ViewColumn.One
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open ${fileName}:${lineNumber} - ${error}`);
        }
    }

    /**
     * Update the webview content with rendered markdown
     */
    private async updateWebviewContent(): Promise<void> {
        if (!this.panel) {
            return;
        }

        try {
            // 💡: Use VSCode's markdown renderer to convert markdown to HTML
            const renderedHtml = await vscode.commands.executeCommand(
                'markdown.api.render',
                this.reviewContent
            ) as string;

            // 💡: Process the HTML to make file:line references clickable
            const processedHtml = this.processFileReferences(renderedHtml);

            // 💡: Create complete HTML document with styling and scripts
            this.panel.webview.html = this.getWebviewContent(processedHtml);
        } catch (error) {
            console.error('Failed to render markdown:', error);
            // Fallback to plain text
            this.panel.webview.html = this.getWebviewContent(`<pre>${this.reviewContent}</pre>`);
        }
    }

    /**
     * Process HTML to make file:line references clickable
     */
    private processFileReferences(html: string): string {
        // 💡: Find patterns like [`src/main.rs:42`][] (rustdoc-style) and make them clickable
        return html.replace(
            /<code>\[([^:\]]+):(\d+)\]<\/code>\[\]/g,
            '<a href="#" class="file-ref" data-file="$1" data-line="$2"><code>[$1:$2][]</code></a>'
        );
    }

    /**
     * Generate the complete HTML content for the webview
     */
    private getWebviewContent(renderedMarkdown: string): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Review</title>
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
        
        h1 {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        
        h2 {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 4px;
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
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-badge-background);
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.9em;
        }
        
        .file-ref:hover {
            color: var(--vscode-textLink-activeForeground);
            background-color: var(--vscode-badge-foreground);
            color: var(--vscode-badge-background);
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
        
        ul, ol {
            padding-left: 24px;
        }
        
        li {
            margin-bottom: 4px;
        }
        
        blockquote {
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            background-color: var(--vscode-textBlockQuote-background);
            margin: 16px 0;
            padding: 8px 16px;
        }
    </style>
</head>
<body>
    <button class="copy-button" onclick="copyReview()">Copy Review</button>
    <div id="content">
        ${renderedMarkdown}
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        // Handle file reference clicks
        document.addEventListener('click', (event) => {
            if (event.target.classList.contains('file-ref')) {
                event.preventDefault();
                const file = event.target.getAttribute('data-file');
                const line = parseInt(event.target.getAttribute('data-line'));
                
                vscode.postMessage({
                    command: 'openFile',
                    file: file,
                    line: line
                });
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
     * Load dummy review content for testing
     */
    private loadDummyReview(): void {
        this.reviewContent = `# Add user authentication system

## Context
The application needed secure user authentication to protect user data and enable personalized features. This implements a JWT-based authentication system with secure password hashing.

## Changes Made
- Added authentication middleware [\`src/auth/middleware.ts:23\`][]
- Created user login/signup endpoints [\`src/routes/auth.ts:45\`][] 
- Updated user model with password hashing [\`src/models/user.ts:67\`][]
- Added JWT token generation and validation [\`src/utils/jwt.ts:12\`][]

## Implementation Details

### Authentication Flow [\`src/auth/middleware.ts:23\`][]
The middleware intercepts requests and validates JWT tokens. If the token is valid, the user object is attached to the request for downstream handlers to use.

### Password Security [\`src/models/user.ts:67\`][]
Passwords are hashed using bcrypt with a salt factor of 12. The plaintext password is never stored in the database.

## Design Decisions
- Used JWT tokens for stateless authentication
- Chose bcrypt over other hashing algorithms for better security
- Token expiration set to 24 hours for balance of security and UX`;
    }
}
