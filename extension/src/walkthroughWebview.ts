import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as MarkdownIt from 'markdown-it';
import { openDialecticUrl } from './fileNavigation';

type WalkthroughElement = 
    | { content: string }  // ResolvedMarkdownElement with processed dialectic: URLs
    | { comment: any }  // Simplified for now
    | { gitdiff: any }  // Simplified for now  
    | { action: { button: string; description?: string; tell_agent?: string } };

interface WalkthroughData {
    introduction?: WalkthroughElement[];
    highlights?: WalkthroughElement[];
    changes?: WalkthroughElement[];
    actions?: WalkthroughElement[];
}

export class WalkthroughWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dialectic.walkthrough';

    private _view?: vscode.WebviewView;
    private md: MarkdownIt;
    private baseUri?: vscode.Uri;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly outputChannel: vscode.OutputChannel,
        private daemonClient?: any // Will be set after daemon client is created
    ) {
        this.md = this.setupMarkdownRenderer();
    }

    private setupMarkdownRenderer(): MarkdownIt {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true
        });

        // Custom renderer rule for file reference links
        const defaultRender = md.renderer.rules.link_open || function(tokens: any, idx: any, options: any, env: any, self: any) {
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.link_open = (tokens: any, idx: any, options: any, env: any, self: any) => {
            const token = tokens[idx];
            const href = token.attrGet('href');
            
            if (href && href.startsWith('dialectic:')) {
                token.attrSet('href', 'javascript:void(0)');
                token.attrSet('data-dialectic-url', href);
                token.attrSet('class', 'file-ref');
            }
            
            return defaultRender(tokens, idx, options, env, self);
        };

        return md;
    }

    private sanitizeHtml(html: string): string {
        // Basic HTML sanitization for VSCode webview context
        // Remove potentially dangerous content while preserving markdown-generated HTML
        return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                  .replace(/javascript:/gi, '')
                  .replace(/on\w+="[^"]*"/gi, '');
    }

    private async handleWebviewMessage(message: any): Promise<void> {
        switch (message.command || message.type) {
            case 'openFile':
                console.log('Walkthrough: openFile command received:', message.dialecticUrl);
                await openDialecticUrl(message.dialecticUrl, this.outputChannel, this.baseUri);
                break;
            case 'action':
                console.log('Walkthrough: action received:', message.message);
                this.outputChannel.appendLine(`Action button clicked: ${message.message}`);
                
                // Send message to active AI terminal
                await this.sendToActiveShell(message.message);
                break;
            case 'ready':
                console.log('Walkthrough webview ready');
                break;
        }
    }

    /**
     * Set the daemon client after it's created
     */
    setDaemonClient(daemonClient: any): void {
        this.daemonClient = daemonClient;
    }

    /**
     * Send a message to the active AI terminal (shared with Ask Socratic Shell)
     */
    private async sendToActiveShell(message: string): Promise<void> {
        if (!this.daemonClient) {
            vscode.window.showErrorMessage('Daemon client not available. Please ensure Dialectic is properly connected.');
            return;
        }

        const terminals = vscode.window.terminals;
        if (terminals.length === 0) {
            vscode.window.showWarningMessage('No terminals found. Please open a terminal with an active AI assistant.');
            return;
        }

        // Get active terminals with MCP servers from registry
        const activeTerminals = this.daemonClient.getActiveTerminals();
        this.outputChannel.appendLine(`Active MCP server terminals: [${Array.from(activeTerminals).join(', ')}]`);

        if (activeTerminals.size === 0) {
            vscode.window.showWarningMessage('No terminals with active MCP servers found. Please ensure you have a terminal with an active AI assistant (like Q chat or Claude CLI) running.');
            return;
        }

        // Filter terminals to only those with active MCP servers
        const terminalChecks = await Promise.all(
            terminals.map(async (terminal) => {
                const shellPID = await terminal.processId;
                const isAiEnabled = shellPID && activeTerminals.has(shellPID);
                return { terminal, isAiEnabled };
            })
        );

        const aiEnabledTerminals = terminalChecks
            .filter(check => check.isAiEnabled)
            .map(check => check.terminal);

        if (aiEnabledTerminals.length === 0) {
            vscode.window.showWarningMessage('No AI-enabled terminals found. Please ensure you have a terminal with an active MCP server running.');
            return;
        }

        // Simple case - exactly one AI-enabled terminal
        if (aiEnabledTerminals.length === 1) {
            const terminal = aiEnabledTerminals[0];
            terminal.sendText(message, false); // false = don't execute, just insert text
            terminal.show(); // Bring terminal into focus
            this.outputChannel.appendLine(`Message sent to terminal: ${terminal.name}`);
            vscode.window.showInformationMessage(`Message sent to ${terminal.name}`);
            return;
        }

        // Multiple terminals - show picker (simplified version)
        const selectedTerminal = await vscode.window.showQuickPick(
            aiEnabledTerminals.map(terminal => ({
                label: terminal.name,
                description: 'Terminal with active AI assistant',
                terminal: terminal
            })),
            {
                placeHolder: 'Select terminal for AI message',
                title: 'Multiple AI-enabled terminals found'
            }
        );

        if (selectedTerminal) {
            selectedTerminal.terminal.sendText(message, false);
            selectedTerminal.terminal.show();
            this.outputChannel.appendLine(`Message sent to terminal: ${selectedTerminal.terminal.name}`);
            vscode.window.showInformationMessage(`Message sent to ${selectedTerminal.terminal.name}`);
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        console.log('WalkthroughWebviewProvider.resolveWebviewView called');
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(
            message => this.handleWebviewMessage(message),
            undefined
        );

        console.log('Setting webview HTML');
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        console.log('Webview HTML set, webview should be ready');
    }

    public showWalkthrough(walkthrough: WalkthroughData) {
        console.log('WalkthroughWebviewProvider.showWalkthrough called with:', walkthrough);
        if (this._view) {
            console.log('Webview exists, showing and posting message');
            this._view.show?.(true);
            
            // Pre-render markdown content
            const processedWalkthrough = this.processWalkthroughMarkdown(walkthrough);
            
            this._view.webview.postMessage({
                type: 'walkthrough',
                data: processedWalkthrough
            });
            console.log('Message posted to webview');
        } else {
            console.log('ERROR: No webview available');
        }
    }

    public setBaseUri(baseUri: string) {
        this.baseUri = vscode.Uri.file(baseUri);
    }

    private processWalkthroughMarkdown(walkthrough: WalkthroughData): WalkthroughData {
        const processSection = (items?: WalkthroughElement[]) => {
            if (!items) return items;
            return items.map(item => {
                if (typeof item === 'object' && 'content' in item) {
                    return { content: this.sanitizeHtml(this.md.render(item.content)) };
                }
                return item;
            });
        };

        return {
            introduction: processSection(walkthrough.introduction),
            highlights: processSection(walkthrough.highlights),
            changes: processSection(walkthrough.changes),
            actions: processSection(walkthrough.actions)
        };
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = crypto.randomBytes(16).toString('base64');
        
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>Walkthrough</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        margin: 0;
                        padding: 16px;
                        line-height: 1.5;
                    }
                    .section {
                        margin-bottom: 24px;
                    }
                    .section-title {
                        font-size: 1.1em;
                        font-weight: 600;
                        color: var(--vscode-textLink-foreground);
                        margin-bottom: 12px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding-bottom: 4px;
                    }
                    .content-item {
                        margin-bottom: 8px;
                        padding: 4px 0;
                    }
                    .action-button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin: 4px 0;
                        font-size: 0.9em;
                    }
                    .action-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .action-description {
                        font-size: 0.85em;
                        color: var(--vscode-descriptionForeground);
                        margin-top: 4px;
                    }
                    pre {
                        background-color: var(--vscode-textCodeBlock-background);
                        padding: 12px;
                        border-radius: 4px;
                        overflow-x: auto;
                        font-family: var(--vscode-editor-font-family);
                    }
                    code {
                        background-color: var(--vscode-textCodeBlock-background);
                        padding: 2px 4px;
                        border-radius: 2px;
                        font-family: var(--vscode-editor-font-family);
                    }
                    .empty-state {
                        text-align: center;
                        color: var(--vscode-descriptionForeground);
                        font-style: italic;
                        padding: 32px 16px;
                    }
                </style>
            </head>
            <body>
                <div id="content">
                    <div class="empty-state">No walkthrough loaded</div>
                </div>
                <script nonce="${nonce}">
                    console.log('Walkthrough webview JavaScript loaded');
                    const vscode = acquireVsCodeApi();
                    console.log('VSCode API acquired');
                    
                    // Handle clicks on dialectic URLs
                    document.addEventListener('click', function(event) {
                        const target = event.target;
                        if (!target) return;
                        
                        // Check if clicked element or parent has dialectic URL
                        let element = target;
                        while (element && element !== document) {
                            const dialecticUrl = element.getAttribute('data-dialectic-url');
                            if (dialecticUrl) {
                                event.preventDefault();
                                console.log('[Walkthrough] Dialectic URL clicked:', dialecticUrl);
                                
                                vscode.postMessage({
                                    command: 'openFile',
                                    dialecticUrl: dialecticUrl
                                });
                                return;
                            }
                            element = element.parentElement;
                        }
                    });
                    
                    function renderMarkdown(text) {
                        return text; // Content is already rendered HTML
                    }
                    
                    function renderSection(title, items) {
                        if (!items || items.length === 0) return '';
                        
                        let html = '<div class="section">';
                        html += '<div class="section-title">' + title + '</div>';
                        
                        items.forEach(item => {
                            if (typeof item === 'object' && 'content' in item) {
                                // ResolvedMarkdownElement with processed dialectic: URLs
                                html += '<div class="content-item">' + renderMarkdown(item.content) + '</div>';
                            } else if (item.Action && item.Action.button) {
                                // Action wrapper object
                                html += '<div class="content-item">';
                                html += '<button class="action-button" data-tell-agent="' + 
                                       (item.Action.tell_agent || '').replace(/"/g, '&quot;') + '">' + 
                                       item.Action.button + '</button>';
                                if (item.Action.description) {
                                    html += '<div class="action-description">' + item.Action.description + '</div>';
                                }
                                html += '</div>';
                            } else if (item.button) {
                                // Direct action object with button property
                                html += '<div class="content-item">';
                                html += '<button class="action-button" data-tell-agent="' + 
                                       (item.tell_agent || '').replace(/"/g, '&quot;') + '">' + 
                                       item.button + '</button>';
                                if (item.description) {
                                    html += '<div class="action-description">' + item.description + '</div>';
                                }
                                html += '</div>';
                            }
                        });
                        
                        html += '</div>';
                        return html;
                    }
                    
                    function handleAction(message) {
                        if (message) {
                            vscode.postMessage({
                                type: 'action',
                                message: message
                            });
                        }
                    }

                    // Add event listener for action button clicks (CSP-compliant)
                    document.addEventListener('click', (event) => {
                        if (event.target.tagName === 'BUTTON' && 
                            event.target.classList.contains('action-button') && 
                            event.target.dataset.tellAgent) {
                            handleAction(event.target.dataset.tellAgent);
                        }
                    });
                    
                    window.addEventListener('message', event => {
                        console.log('Webview received message:', event.data);
                        const message = event.data;
                        if (message.type === 'walkthrough') {
                            console.log('Processing walkthrough message with data:', message.data);
                            const data = message.data;
                            let html = '';
                            
                            html += renderSection('Introduction', data.introduction);
                            html += renderSection('Highlights', data.highlights);
                            html += renderSection('Changes', data.changes);
                            html += renderSection('Actions', data.actions);
                            
                            console.log('Generated HTML:', html);
                            const finalHtml = html || '<div class="empty-state">Empty walkthrough</div>';
                            console.log('Setting innerHTML to:', finalHtml);
                            document.getElementById('content').innerHTML = finalHtml;
                            console.log('Content updated');
                        } else {
                            console.log('Ignoring message type:', message.type);
                        }
                    });
                    
                    // Notify extension that webview is ready
                    vscode.postMessage({
                        command: 'ready'
                    });
                </script>
            </body>
            </html>`;
    }
}
