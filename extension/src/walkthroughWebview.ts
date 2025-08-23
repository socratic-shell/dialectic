import * as vscode from 'vscode';

export class WalkthroughWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'dialectic.walkthrough';

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    public showWalkthrough(walkthrough: any) {
        if (this._view) {
            this._view.show?.(true);
            this._view.webview.postMessage({
                type: 'walkthrough',
                data: walkthrough
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Walkthrough</title>
            </head>
            <body>
                <div id="content">
                    <p>Walkthrough received - rendering coming soon!</p>
                </div>
                <script>
                    const vscode = acquireVsCodeApi();
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'walkthrough') {
                            document.getElementById('content').innerHTML = 
                                '<h3>Walkthrough Received</h3><pre>' + 
                                JSON.stringify(message.data, null, 2) + 
                                '</pre>';
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}
