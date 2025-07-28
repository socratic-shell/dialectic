// 💡: Webview-based review provider using markdown-it for secure, extensible markdown rendering
// Follows VSCode extension best practices with custom link handling and proper CSP

import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as MarkdownIt from 'markdown-it';
import * as DOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

export class ReviewWebviewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private reviewContent: string = '';
    private baseUri: vscode.Uri | undefined;
    private md: MarkdownIt;

    constructor(
        private context: vscode.ExtensionContext,
        private outputChannel: vscode.OutputChannel
    ) {
        this.md = this.setupMarkdownRenderer();
        this.loadDummyReview();
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
            
            // Handle dialectic: URI scheme for file references
            if (href && href.startsWith('dialectic:')) {
                const fileRef = href.substring('dialectic:'.length); // Remove dialectic: prefix
                token.attrSet('href', '#');
                token.attrSet('data-file-ref', fileRef);
                token.attrSet('class', 'file-ref');
                this.outputChannel.appendLine(`Processed dialectic file reference: ${fileRef}`);
            }
            
            return defaultRender(tokens, idx, options, env, self);
        };

        // 💡: Handle reference-style links by preprocessing
        md.core.ruler.before('normalize', 'file_references', (state: any) => {
            // Convert [`filename:line`][] to [filename:line](dialectic:filename:line)
            state.src = state.src.replace(/\[`([^:`]+:\d+)`\]\[\]/g, '[$1](dialectic:$1)');
        });

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
                await this.openFileAtLine(message.file, message.line);
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
     * Open a file at a specific line number
     */
    private async openFileAtLine(fileName: string, lineNumber: number): Promise<void> {
        try {
            let fileUri: vscode.Uri | undefined;

            // 💡: Try baseUri first if available
            if (this.baseUri) {
                const candidateUri = vscode.Uri.joinPath(this.baseUri, fileName);
                try {
                    await vscode.workspace.fs.stat(candidateUri);
                    fileUri = candidateUri;
                    this.outputChannel.appendLine(`Found file using baseUri: ${fileUri.fsPath}`);
                } catch {
                    this.outputChannel.appendLine(`File not found at baseUri: ${candidateUri.fsPath}`);
                }
            }

            // 💡: Fall back to workspace folder search if baseUri didn't work
            if (!fileUri) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    vscode.window.showErrorMessage('No workspace folder open and no base URI provided');
                    return;
                }

                // Look for the file in all workspace folders
                for (const folder of workspaceFolders) {
                    const candidateUri = vscode.Uri.joinPath(folder.uri, fileName);
                    try {
                        await vscode.workspace.fs.stat(candidateUri);
                        fileUri = candidateUri;
                        this.outputChannel.appendLine(`Found file in workspace: ${fileUri.fsPath}`);
                        break;
                    } catch {
                        // File not found in this folder, continue searching
                    }
                }
            }

            if (!fileUri) {
                const baseInfo = this.baseUri ? ` (base: ${this.baseUri.fsPath})` : '';
                vscode.window.showErrorMessage(`File not found: ${fileName}${baseInfo}`);
                return;
            }

            // Open the document
            const document = await vscode.workspace.openTextDocument(fileUri);
            
            // Convert to 0-based line number and create selection
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
     * Sanitize HTML using DOMPurify for security
     */
    private sanitizeHtml(html: string): string {
        // 💡: Create JSDOM window for DOMPurify
        const window = new JSDOM('').window;
        const purify = DOMPurify(window as any);
        
        // 💡: Configure DOMPurify to allow our custom data attributes
        return purify.sanitize(html, {
            ADD_ATTR: ['data-file-ref'],
            ADD_TAGS: ['a']
        });
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
            
            const fileRef = target.getAttribute('data-file-ref');
            if (fileRef) {
                event.preventDefault();
                const match = fileRef.match(/^([^:]+):(\\d+)$/);
                if (match) {
                    const file = match[1];
                    const line = parseInt(match[2]);
                    
                    console.log('[Webview] File reference clicked:', file, line);
                    
                    vscode.postMessage({
                        command: 'openFile',
                        file: file,
                        line: line
                    });
                }
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
     * Load dummy review content for testing
     */
    private loadDummyReview(): void {
        this.reviewContent = `# Add user authentication system

## Context
The application needed secure user authentication to protect user data and enable personalized features. This implements a JWT-based authentication system with secure password hashing.

## Changes Made
- Added authentication middleware [\`src/auth/middleware.ts:23\`][]
- Created user login/signup endpoints [here](src/routes/auth.ts:45) 
- Updated user model with password hashing [\`src/models/user.ts:67\`][]
- Added JWT token generation and validation [in utils](src/utils/jwt.ts:12)

## Implementation Details

### Authentication Flow [\`src/auth/middleware.ts:23\`][]
The middleware intercepts requests and validates JWT tokens. If the token is valid, the user object is attached to the request for downstream handlers to use.

### Password Security [check this](src/models/user.ts:67)
Passwords are hashed using bcrypt with a salt factor of 12. The plaintext password is never stored in the database.

## Design Decisions
- Used JWT tokens for stateless authentication
- Chose bcrypt over other hashing algorithms for better security
- Token expiration set to 24 hours for balance of security and UX`;
    }
}
