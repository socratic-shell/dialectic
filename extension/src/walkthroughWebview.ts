import * as vscode from 'vscode';

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

    constructor(private readonly _extensionUri: vscode.Uri) {}

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

        console.log('Setting webview HTML');
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        console.log('Webview HTML set, webview should be ready');
    }

    public showWalkthrough(walkthrough: WalkthroughData) {
        console.log('WalkthroughWebviewProvider.showWalkthrough called with:', walkthrough);
        if (this._view) {
            console.log('Webview exists, showing and posting message');
            this._view.show?.(true);
            this._view.webview.postMessage({
                type: 'walkthrough',
                data: walkthrough
            });
            console.log('Message posted to webview');
        } else {
            console.log('ERROR: No webview available');
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                <script>
                    console.log('Walkthrough webview JavaScript loaded');
                    const vscode = acquireVsCodeApi();
                    console.log('VSCode API acquired');
                    
                    function renderMarkdown(text) {
                        return text; // Just return plain text for now
                    }
                    
                    function renderSection(title, items) {
                        if (!items || items.length === 0) return '';
                        
                        let html = '<div class="section">';
                        html += '<div class="section-title">' + title + '</div>';
                        
                        items.forEach(item => {
                            if (typeof item === 'object' && 'content' in item) {
                                // ResolvedMarkdownElement with processed dialectic: URLs
                                html += '<div class="content-item">' + renderMarkdown(item.content) + '</div>';
                            } else if (item.action) {
                                html += '<div class="content-item">';
                                html += '<button class="action-button" onclick="handleAction(' + 
                                       JSON.stringify(item.action.tell_agent || '') + ')">' + 
                                       item.action.button + '</button>';
                                if (item.action.description) {
                                    html += '<div class="action-description">' + item.action.description + '</div>';
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
                </script>
            </body>
            </html>`;
    }
}
