import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import * as MarkdownIt from 'markdown-it';
import { openDialecticUrl } from './fileNavigation';

// Placement state for unified link and comment management
interface PlacementState {
    isPlaced: boolean;
    chosenLocation: any; // FileRange, SearchResult, or other location type
    wasAmbiguous: boolean; // Whether this item had multiple possible locations
}

// Reuse types from synthetic PR system
interface FileChange {
    path: string;
    status: string;
    additions: number;
    deletions: number;
    hunks: DiffHunk[];
}

interface DiffHunk {
    old_start: number;
    old_lines: number;
    new_start: number;
    new_lines: number;
    lines: DiffLine[];
}

interface DiffLine {
    line_type: 'Context' | 'Added' | 'Removed';
    old_line_number?: number;
    new_line_number?: number;
    content: string;
}

/**
 * Content provider for walkthrough diff content
 */
class WalkthroughDiffContentProvider implements vscode.TextDocumentContentProvider {
    private contentMap = new Map<string, string>();

    setContent(uri: vscode.Uri, content: string): void {
        this.contentMap.set(uri.toString(), content);
    }

    provideTextDocumentContent(uri: vscode.Uri): string | undefined {
        return this.contentMap.get(uri.toString());
    }
}

type WalkthroughElement =
    | string  // ResolvedMarkdownElement (now serialized as plain string)
    | { comment: any }  // Simplified for now
    | { files: FileChange[] }  // GitDiffElement - named field serializes as {"files": [...]}
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
    private diffContentProvider: WalkthroughDiffContentProvider;
    private currentWalkthrough?: WalkthroughData;
    private placementMemory = new Map<string, PlacementState>(); // Unified placement memory
    private commentController?: vscode.CommentController;
    private commentThreads = new Map<string, vscode.CommentThread>(); // Track comment threads by location key

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly outputChannel: vscode.OutputChannel,
        private daemonClient?: any, // Will be set after daemon client is created
        private context?: vscode.ExtensionContext
    ) {
        this.md = this.setupMarkdownRenderer();
        this.diffContentProvider = new WalkthroughDiffContentProvider();

        // Register diff content provider if context is available
        if (this.context) {
            this.context.subscriptions.push(
                vscode.workspace.registerTextDocumentContentProvider('walkthrough-diff', this.diffContentProvider)
            );
        }
    }

    private setupMarkdownRenderer(): MarkdownIt {
        const md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true
        });

        // Custom renderer rule for file reference links
        const defaultRender = md.renderer.rules.link_open || function (tokens: any, idx: any, options: any, env: any, self: any) {
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.link_open = (tokens: any, idx: any, options: any, env: any, self: any) => {
            const token = tokens[idx];
            const href = token.attrGet('href');

            if (href && href.startsWith('dialectic:')) {
                const linkKey = `link:${href}`;
                const placementState = this.placementMemory?.get(linkKey);

                token.attrSet('href', 'javascript:void(0)');
                token.attrSet('data-dialectic-url', href);
                token.attrSet('class', 'file-ref');

                if (placementState?.isPlaced) {
                    token.attrSet('data-placement-state', 'placed');
                } else {
                    token.attrSet('data-placement-state', 'unplaced');
                }
            }

            return defaultRender(tokens, idx, options, env, self);
        };

        // Custom renderer for link close to add placement icons
        const defaultLinkClose = md.renderer.rules.link_close || function (tokens: any, idx: any, options: any, env: any, self: any) {
            return self.renderToken(tokens, idx, options);
        };

        md.renderer.rules.link_close = (tokens: any, idx: any, options: any, env: any, self: any) => {
            // Find the corresponding link_open token
            let openToken = null;
            for (let i = idx - 1; i >= 0; i--) {
                if (tokens[i].type === 'link_open') {
                    openToken = tokens[i];
                    break;
                }
            }

            if (openToken) {
                const href = openToken.attrGet('href');
                console.log('[RENDERER] Processing link_close for href:', href);
                if (href && href.startsWith('dialectic:')) {
                    const linkKey = `link:${href}`;
                    const placementState = this.placementMemory?.get(linkKey);
                    const isPlaced = placementState?.isPlaced || false;

                    // Choose icon: 📍 for placed, 🔍 for unplaced
                    const icon = isPlaced ? '📍' : '🔍';
                    const action = isPlaced ? 'relocate' : 'place';
                    const title = isPlaced ? 'Relocate this link' : 'Place this link';

                    const result = `</a><button class="placement-icon" data-dialectic-url="${href}" data-action="${action}" title="${title}">${icon}</button>`;
                    console.log('[RENDERER] Generated icon HTML:', result);
                    return result;
                }
            }

            return defaultLinkClose(tokens, idx, options, env, self);
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
                await openDialecticUrl(message.dialecticUrl, this.outputChannel, this.baseUri, this.placementMemory);
                // After placement, update the UI
                this.updateLinkPlacementUI(message.dialecticUrl);
                break;
            case 'relocateLink':
                console.log('Walkthrough: relocateLink command received:', message.dialecticUrl);
                await this.relocateLink(message.dialecticUrl);
                break;
            case 'action':
                console.log('Walkthrough: action received:', message.message);
                this.outputChannel.appendLine(`Action button clicked: ${message.message}`);

                // Send message to active AI terminal
                await this.sendToActiveShell(message.message);
                break;
            case 'showDiff':
                console.log('Walkthrough: showDiff command received:', message.filePath);
                await this.showFileDiff(message.filePath);
                break;
            case 'showComment':
                console.log('Walkthrough: showComment command received:', message.comment);
                await this.showComment(message.comment);
                break;
            case 'ready':
                console.log('Walkthrough webview ready');
                break;
        }
    }

    /**
     * Show comment using VSCode CommentController with context-aware file opening
     */
    /**
     * Place a comment at a specific location, avoiding duplicates
     */
    private async placeComment(comment: any, location: any): Promise<void> {
        const locationKey = `${location.path}:${location.start.line}`;
        
        // Check if comment already exists at this location
        if (this.commentThreads.has(locationKey)) {
            console.log(`[WALKTHROUGH] Comment already exists at ${locationKey}, navigating to it`);
            await this.navigateToExistingComment(location.path, location);
            return;
        }

        await this.createCommentThread(location.path, location, comment);
    }

    /**
     * Navigate to existing comment instead of creating duplicate
     */
    private async navigateToExistingComment(filePath: string, location: any): Promise<void> {
        if (!this.baseUri) return;
        
        try {
            const uri = vscode.Uri.file(path.resolve(this.baseUri.fsPath, filePath));
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);
            
            // Navigate to the line
            const line = Math.max(0, location.start.line - 1);
            const position = new vscode.Position(line, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position));
        } catch (error) {
            console.error(`[WALKTHROUGH] Failed to navigate to comment:`, error);
        }
    }

    private async showComment(comment: any): Promise<void> {
        console.log(`[WALKTHROUGH COMMENT] Starting showComment:`, comment);

        if (!comment.locations || comment.locations.length === 0) {
            vscode.window.showErrorMessage('Comment has no locations');
            return;
        }

        let selectedLocation;
        
        if (comment.locations.length === 1) {
            // Unambiguous - use the single location
            selectedLocation = comment.locations[0];
        } else {
            // Ambiguous - show disambiguation dialog
            const locationItems = comment.locations.map((loc: any, index: number) => ({
                label: `${loc.path}:${loc.start.line}`,
                description: loc.content.substring(0, 80) + (loc.content.length > 80 ? '...' : ''),
                location: loc
            }));
            
            const selected = await vscode.window.showQuickPick(locationItems, {
                placeHolder: 'Choose the location for this comment',
                matchOnDescription: true
            }) as { label: string; description: string; location: any } | undefined;
            
            if (!selected) {
                return; // User cancelled
            }
            
            selectedLocation = selected.location;
        }

        // Use placeComment to handle duplicates
        await this.placeComment(comment, selectedLocation);
    }

    /**
     * Get set of files that appear in gitdiff sections of current walkthrough
     */
    private getFilesInCurrentGitDiff(): Set<string> {
        const filesInDiff = new Set<string>();

        if (!this.currentWalkthrough) return filesInDiff;

        const allSections = [
            ...(this.currentWalkthrough.introduction || []),
            ...(this.currentWalkthrough.highlights || []),
            ...(this.currentWalkthrough.changes || []),
            ...(this.currentWalkthrough.actions || [])
        ];

        for (const item of allSections) {
            if (typeof item === 'object' && 'files' in item) {
                // This is a GitDiffElement
                item.files.forEach((fileChange: FileChange) => {
                    filesInDiff.add(fileChange.path);
                });
            }
        }

        return filesInDiff;
    }

    /**
     * Create comment thread using VSCode CommentController
     */
    private async createCommentThread(filePath: string, location: any, comment: any): Promise<void> {
        console.log(`[WALKTHROUGH COMMENT] Creating comment thread for ${filePath}:${location.start.line}`);
        
        if (!this.baseUri) {
            console.error('[WALKTHROUGH COMMENT] No baseUri set');
            vscode.window.showErrorMessage('Cannot create comment: no base URI set');
            return;
        }
        
        try {
            // Open the file first
            const uri = vscode.Uri.file(path.resolve(this.baseUri.fsPath, filePath));
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
            
            // Create comment controller if it doesn't exist
            if (!this.commentController) {
                this.commentController = vscode.comments.createCommentController(
                    'dialectic-walkthrough',
                    'Dialectic Walkthrough Comments'
                );
            }
            
            // Create range for the comment (convert to 0-based)
            const startLine = Math.max(0, location.start.line - 1);
            const endLine = Math.max(0, (location.end?.line || location.start.line) - 1);
            const range = new vscode.Range(startLine, 0, endLine, Number.MAX_SAFE_INTEGER);
            
            // Create comment thread
            const thread = this.commentController.createCommentThread(uri, range, []);
            thread.label = 'Walkthrough Comment';
            thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded; // Make visible immediately
            
            // Add the comment content as the initial comment
            if (comment.comment && comment.comment.length > 0) {
                const commentBody = new vscode.MarkdownString(comment.comment.join('\n\n'));
                const vscodeComment: vscode.Comment = {
                    body: commentBody,
                    mode: vscode.CommentMode.Preview,
                    author: { name: 'Dialectic Walkthrough' },
                    timestamp: new Date()
                };
                thread.comments = [vscodeComment];
            }
            
            // Track the thread
            const locationKey = `${filePath}:${location.start.line}`;
            this.commentThreads.set(locationKey, thread);
            
            console.log(`[WALKTHROUGH COMMENT] Created comment thread at ${filePath}:${startLine + 1}`);
            
        } catch (error) {
            console.error(`[WALKTHROUGH COMMENT] Failed to create comment thread:`, error);
            vscode.window.showErrorMessage(`Failed to create comment: ${error}`);
        }
    }

    // Placement state management methods

    /**
     * Get placement state for an item (link or comment)
     */
    private getPlacementState(key: string): PlacementState | undefined {
        return this.placementMemory.get(key);
    }

    /**
     * Set placement state for an item
     */
    private setPlacementState(key: string, state: PlacementState): void {
        this.placementMemory.set(key, state);
    }

    /**
     * Mark an item as placed with chosen location
     */
    private placeItem(key: string, location: any, wasAmbiguous: boolean): void {
        this.setPlacementState(key, {
            isPlaced: true,
            chosenLocation: location,
            wasAmbiguous
        });
    }

    /**
     * Mark an item as unplaced (for relocate functionality)
     */
    private unplaceItem(key: string): void {
        const currentState = this.getPlacementState(key);
        if (currentState) {
            this.setPlacementState(key, {
                ...currentState,
                isPlaced: false,
                chosenLocation: null
            });
        }
    }

    /**
     * Clear all placement memory (called when new walkthrough loads)
     */
    private clearPlacementMemory(): void {
        this.placementMemory.clear();
    }
    private async showFileDiff(filePath: string): Promise<void> {
        console.log(`[WALKTHROUGH DIFF] Starting showFileDiff for: ${filePath}`);

        if (!this.currentWalkthrough) {
            console.log('[WALKTHROUGH DIFF] ERROR: No current walkthrough data');
            vscode.window.showErrorMessage('No walkthrough data available');
            return;
        }

        // Find the file change in the walkthrough data
        let fileChange: FileChange | undefined;

        // Search through all sections for gitdiff elements
        const allSections = [
            ...(this.currentWalkthrough.introduction || []),
            ...(this.currentWalkthrough.highlights || []),
            ...(this.currentWalkthrough.changes || []),
            ...(this.currentWalkthrough.actions || [])
        ];

        for (const item of allSections) {
            if (typeof item === 'object' && 'files' in item) {
                // This is a GitDiffElement named field - {"files": FileChange[]}
                fileChange = item.files.find((fc: FileChange) => fc.path === filePath);
                if (fileChange) break;
            }
        }

        if (!fileChange) {
            console.log(`[WALKTHROUGH DIFF] ERROR: File not found in walkthrough: ${filePath}`);
            vscode.window.showErrorMessage(`File not found in walkthrough: ${filePath}`);
            return;
        }

        console.log(`[WALKTHROUGH DIFF] Found file change: ${fileChange.status}, ${fileChange.additions}+/${fileChange.deletions}-, ${fileChange.hunks.length} hunks`);

        try {
            // Get workspace folder
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const absolutePath = vscode.Uri.joinPath(workspaceFolder.uri, filePath);
            console.log(`[WALKTHROUGH DIFF] Resolved absolute path: ${absolutePath.toString()}`);

            // Get "after" content from current file
            const currentDocument = await vscode.workspace.openTextDocument(absolutePath);
            const modifiedContent = currentDocument.getText();
            console.log(`[WALKTHROUGH DIFF] Current file content length: ${modifiedContent.length} chars`);

            // Generate "before" content by reverse-applying hunks
            const originalContent = await this.generateOriginalContent(fileChange, modifiedContent);
            console.log(`[WALKTHROUGH DIFF] Generated original content length: ${originalContent.length} chars`);

            // Create URIs for diff content provider
            const originalUri = vscode.Uri.parse(`walkthrough-diff:${filePath}?original`);
            const modifiedUri = absolutePath; // Use actual file for "after" state
            console.log(`[WALKTHROUGH DIFF] Original URI: ${originalUri.toString()}`);
            console.log(`[WALKTHROUGH DIFF] Modified URI: ${modifiedUri.toString()}`);

            // Store original content in provider
            this.diffContentProvider.setContent(originalUri, originalContent);
            console.log('[WALKTHROUGH DIFF] Stored original content in provider');

            // Show diff using VSCode's native diff viewer with automatic highlighting
            console.log('[WALKTHROUGH DIFF] Calling vscode.diff command...');
            await vscode.commands.executeCommand('vscode.diff',
                originalUri,
                modifiedUri,
                `${filePath} (Walkthrough Diff)`
            );
            console.log('[WALKTHROUGH DIFF] vscode.diff command completed successfully');

        } catch (error) {
            console.error('[WALKTHROUGH DIFF] Failed to show file diff:', error);
            vscode.window.showErrorMessage(`Failed to show diff for ${filePath}`);
        }
    }

    /**
     * Generate original file content by reverse-applying diff hunks
     * Adapted from synthetic PR provider
     */
    private async generateOriginalContent(fileChange: FileChange, modifiedContent: string): Promise<string> {
        try {
            const modifiedLines = modifiedContent.split('\n');
            const originalLines: string[] = [];

            let modifiedIndex = 0;

            for (const hunk of fileChange.hunks) {
                // Add lines before this hunk (unchanged context)
                const contextStart = hunk.new_start - 1; // Convert to 0-based
                while (modifiedIndex < contextStart && modifiedIndex < modifiedLines.length) {
                    originalLines.push(modifiedLines[modifiedIndex]);
                    modifiedIndex++;
                }

                // Process hunk lines
                for (const line of hunk.lines) {
                    switch (line.line_type) {
                        case 'Context':
                            // Context lines appear in both versions
                            originalLines.push(line.content);
                            modifiedIndex++;
                            break;
                        case 'Removed':
                            // Removed lines were in original but not in modified
                            originalLines.push(line.content);
                            // Don't increment modifiedIndex
                            break;
                        case 'Added':
                            // Added lines are in modified but not in original
                            // Skip in original, but advance modified index
                            modifiedIndex++;
                            break;
                    }
                }
            }

            // Add any remaining lines after all hunks
            while (modifiedIndex < modifiedLines.length) {
                originalLines.push(modifiedLines[modifiedIndex]);
                modifiedIndex++;
            }

            return originalLines.join('\n');
        } catch (error) {
            console.error('[WALKTHROUGH DIFF] Failed to generate original content:', error);
            // Fallback to empty content for minimal diff display
            return '';
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

        // Store walkthrough data for diff functionality
        this.currentWalkthrough = walkthrough;

        // Clear placement memory for new walkthrough
        this.clearPlacementMemory();

        // Clear all existing comments
        this.clearAllComments();

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

            // Auto-place unambiguous comments using original walkthrough data
            this.autoPlaceUnambiguousComments(walkthrough);
        } else {
            console.log('ERROR: No webview available');
        }
    }

    /**
     * Clear all existing comment threads
     */
    private clearAllComments(): void {
        if (this.commentController) {
            console.log('[WALKTHROUGH] Clearing all existing comments');
            this.commentController.dispose();
            this.commentController = undefined;
        }
        this.commentThreads.clear();
    }

    /**
     * Auto-place comments that have unambiguous locations (exactly one location)
     */
    private async autoPlaceUnambiguousComments(walkthrough: WalkthroughData): Promise<void> {
        const allSections = [
            ...(walkthrough.introduction || []),
            ...(walkthrough.highlights || []),
            ...(walkthrough.changes || []),
            ...(walkthrough.actions || [])
        ];

        for (const item of allSections) {
            if (typeof item === 'object' && 'comment' in item) {
                const commentItem = item as any;
                if (commentItem.locations && commentItem.locations.length === 1) {
                    await this.placeComment(commentItem, commentItem.locations[0]);
                }
            }
        }
    }

    public setBaseUri(baseUri: string) {
        this.baseUri = vscode.Uri.file(baseUri);
    }

    private processWalkthroughMarkdown(walkthrough: WalkthroughData): WalkthroughData {
        const processSection = (items?: WalkthroughElement[]) => {
            if (!items) return items;
            return items.map(item => {
                if (typeof item === 'string') {
                    // Process plain markdown strings
                    return this.sanitizeHtml(this.md.render(item));
                } else if (typeof item === 'object' && 'files' in item) {
                    // Handle GitDiffElement named field - {"files": FileChange[]}
                    return item; // Keep as-is, will be handled in rendering
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

    private async relocateLink(dialecticUrl: string): Promise<void> {
        // Remove the current placement to force re-disambiguation
        const linkKey = `link:${dialecticUrl}`;
        this.placementMemory?.delete(linkKey);

        // Open the link again - this will show disambiguation
        await openDialecticUrl(dialecticUrl, this.outputChannel, this.baseUri, this.placementMemory);

        // Update UI after relocation
        this.updateLinkPlacementUI(dialecticUrl);
    }

    private updateLinkPlacementUI(dialecticUrl: string): void {
        if (!this._view) return;

        const linkKey = `link:${dialecticUrl}`;
        const placementState = this.placementMemory?.get(linkKey);
        const isPlaced = placementState?.isPlaced || false;

        console.log(`[Walkthrough] Updating UI for ${dialecticUrl}: isPlaced=${isPlaced}, placementState=`, placementState);

        // Send update to webview
        this._view.webview.postMessage({
            type: 'updateLinkPlacement',
            dialecticUrl: dialecticUrl,
            isPlaced: isPlaced
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const nonce = crypto.randomBytes(16).toString('base64');

        let html = `<!DOCTYPE html>
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
                    .gitdiff-container {
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        margin: 8px 0;
                    }
                    .file-diff {
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    .file-diff:last-child {
                        border-bottom: none;
                    }
                    .file-header {
                        display: flex;
                        align-items: center;
                        padding: 8px 12px;
                        background-color: var(--vscode-editor-background);
                        font-family: var(--vscode-editor-font-family);
                        font-size: 0.9em;
                    }
                    .file-path {
                        flex: 1;
                        font-weight: 500;
                    }
                    .clickable-file {
                        cursor: pointer;
                        color: var(--vscode-textLink-foreground);
                        text-decoration: underline;
                    }
                    .clickable-file:hover {
                        color: var(--vscode-textLink-activeForeground);
                    }
                    .file-stats {
                        margin: 0 12px;
                        color: var(--vscode-descriptionForeground);
                        font-size: 0.85em;
                    }
                    .comment-item {
                        display: flex;
                        align-items: flex-start;
                        padding: 8px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        cursor: pointer;
                        background-color: var(--vscode-editor-background);
                    }
                    .comment-item:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }
                    .comment-icon {
                        margin-right: 8px;
                        font-size: 16px;
                    }
                    .comment-content {
                        flex: 1;
                    }
                    .comment-locations {
                        font-weight: 500;
                        color: var(--vscode-textLink-foreground);
                        margin-bottom: 4px;
                    }
                    .comment-location {
                        font-family: var(--vscode-editor-font-family);
                        font-size: 0.9em;
                    }
                    .comment-text {
                        color: var(--vscode-foreground);
                        font-size: 0.9em;
                    }
                    
                    /* Placement UI styles */
                    .file-ref {
                        cursor: pointer;
                        text-decoration: none;
                        display: inline-flex;
                        align-items: center;
                        gap: 4px;
                        color: var(--vscode-textLink-foreground);
                        border-bottom: 1px solid var(--vscode-textLink-foreground);
                    }
                    
                    .file-ref:hover {
                        color: var(--vscode-textLink-activeForeground);
                        border-bottom-color: var(--vscode-textLink-activeForeground);
                    }
                    
                    .placement-icon {
                        background: none;
                        border: none;
                        cursor: pointer;
                        padding: 0;
                        font-size: 0.9em;
                        opacity: 0.8;
                        margin-left: 2px;
                    }
                    
                    .placement-icon:hover {
                        opacity: 1;
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
                    
                    // Handle clicks on dialectic URLs and placement icons
                    document.addEventListener('click', function(event) {
                        const target = event.target;
                        if (!target) return;
                        
                        // Handle placement icon clicks
                        if (target.classList.contains('placement-icon')) {
                            event.preventDefault();
                            const dialecticUrl = target.getAttribute('data-dialectic-url');
                            const action = target.getAttribute('data-action');
                            
                            console.log('[Walkthrough] Placement icon clicked:', dialecticUrl, 'action:', action);
                            
                            if (action === 'relocate') {
                                vscode.postMessage({
                                    command: 'relocateLink',
                                    dialecticUrl: dialecticUrl
                                });
                            } else {
                                vscode.postMessage({
                                    command: 'openFile',
                                    dialecticUrl: dialecticUrl
                                });
                            }
                            return;
                        }
                        
                        // Check if clicked element or parent has dialectic URL (link text clicked)
                        let element = target;
                        while (element && element !== document) {
                            const dialecticUrl = element.getAttribute('data-dialectic-url');
                            if (dialecticUrl && element.classList.contains('file-ref')) {
                                event.preventDefault();
                                console.log('[Walkthrough] Link text clicked - navigating:', dialecticUrl);
                                
                                vscode.postMessage({
                                    command: 'openFile',
                                    dialecticUrl: dialecticUrl
                                });
                                return;
                            }
                            element = element.parentElement;
                        }
                    });
                    
                    // Function to add placement icons to all dialectic links
                    function addPlacementIcons() {
                        console.log('[ICONS] Adding placement icons to dialectic links');
                        const dialecticLinks = document.querySelectorAll('a[data-dialectic-url]');
                        console.log('[ICONS] Found', dialecticLinks.length, 'dialectic links');
                        
                        dialecticLinks.forEach((link, index) => {
                            const dialecticUrl = link.getAttribute('data-dialectic-url');
                            console.log('[ICONS] Processing link', index, 'URL:', dialecticUrl);
                            
                            // Check if ANY placement icon already exists for this URL
                            const existingIcons = document.querySelectorAll('.placement-icon[data-dialectic-url="' + dialecticUrl + '"]');
                            if (existingIcons.length > 0) {
                                console.log('[ICONS] Icon already exists for URL:', dialecticUrl, 'count:', existingIcons.length);
                                return;
                            }
                            
                            // Create placement icon
                            const icon = document.createElement('button');
                            icon.className = 'placement-icon';
                            icon.setAttribute('data-dialectic-url', dialecticUrl);
                            icon.setAttribute('data-action', 'place');
                            icon.setAttribute('title', 'Place this link');
                            icon.textContent = '🔍'; // Default to search icon
                            
                            // Insert icon after the link
                            link.parentNode.insertBefore(icon, link.nextSibling);
                            console.log('[ICONS] Added icon for link', index);
                        });
                    }

                    // Function to update link rendering after placement changes
                    function updateLinkPlacement(dialecticUrl, isPlaced) {
                        console.log('[PLACEMENT] updateLinkPlacement called with:', dialecticUrl, 'isPlaced:', isPlaced);
                        
                        // Debug: show all placement icons in the DOM
                        const allIcons = document.querySelectorAll('.placement-icon');
                        console.log('[PLACEMENT] All placement icons in DOM:', allIcons.length);
                        allIcons.forEach((icon, i) => {
                            console.log('[PLACEMENT] Icon ' + i + ': data-dialectic-url="' + icon.getAttribute('data-dialectic-url') + '" text="' + icon.textContent + '"');
                        });
                        
                        // Update placement icons
                        const icons = document.querySelectorAll('.placement-icon[data-dialectic-url="' + dialecticUrl + '"]');
                        console.log('[PLACEMENT] Found', icons.length, 'icons to update for URL:', dialecticUrl);
                        
                        icons.forEach((icon, index) => {
                            console.log('[PLACEMENT] Updating icon', index, 'current text:', icon.textContent);
                            if (isPlaced) {
                                icon.textContent = '📍';
                                icon.setAttribute('data-action', 'relocate');
                                icon.setAttribute('title', 'Relocate this link');
                                console.log('[PLACEMENT] Set icon to 📍 (relocate)');
                            } else {
                                icon.textContent = '🔍';
                                icon.setAttribute('data-action', 'place');
                                icon.setAttribute('title', 'Place this link');
                                console.log('[PLACEMENT] Set icon to 🔍 (place)');
                            }
                        });
                        
                        // Update link data attributes
                        const links = document.querySelectorAll('.file-ref[data-dialectic-url="' + dialecticUrl + '"]');
                        console.log('[PLACEMENT] Found', links.length, 'links to update');
                        links.forEach(link => {
                            link.setAttribute('data-placement-state', isPlaced ? 'placed' : 'unplaced');
                        });
                    }
                    
                    function renderMarkdown(text) {
                        return text; // Content is already rendered HTML
                    }
                    
                    function renderSection(title, items) {
                        if (!items || items.length === 0) return '';
                        
                        let html = '<div class="section">';
                        html += '<div class="section-title">' + title + '</div>';
                        
                        items.forEach(item => {
                            if (typeof item === 'string') {
                                // ResolvedMarkdownElement now serialized as plain string
                                html += '<div class="content-item">' + renderMarkdown(item) + '</div>';
                            } else if (typeof item === 'object' && 'locations' in item && 'comment' in item) {
                                // ResolvedComment object sent directly (not wrapped)
                                html += '<div class="content-item">';
                                html += '<div class="comment-item" data-comment="' + encodeURIComponent(JSON.stringify(item)) + '">';
                                html += '<div class="comment-icon">💬</div>';
                                html += '<div class="comment-content">';
                                
                                // Smart location display for ambiguous comments
                                html += '<div class="comment-locations">';
                                if (item.locations.length === 1) {
                                    // Unambiguous - show exact location
                                    const loc = item.locations[0];
                                    html += '<span class="comment-location">' + loc.path + ':' + loc.start.line + '</span>';
                                } else {
                                    // Ambiguous - check if all same file
                                    const firstFile = item.locations[0].path;
                                    const allSameFile = item.locations.every(loc => loc.path === firstFile);
                                    
                                    if (allSameFile) {
                                        html += '<span class="comment-location">' + firstFile + ' 🔍</span>';
                                    } else {
                                        html += '<span class="comment-location">(' + item.locations.length + ' possible locations) 🔍</span>';
                                    }
                                }
                                html += '</div>';
                                
                                if (item.comment && item.comment.length > 0) {
                                    html += '<div class="comment-text">' + item.comment.join(' ') + '</div>';
                                }
                                html += '</div>';
                                html += '</div>';
                                html += '</div>';
                            } else if (typeof item === 'object' && 'files' in item) {
                                // GitDiffElement named field - {"files": FileChange[]}
                                html += '<div class="content-item">';
                                html += '<div class="gitdiff-container">';
                                item.files.forEach(fileChange => {
                                    html += '<div class="file-diff">';
                                    html += '<div class="file-header">';
                                    html += '<span class="file-path clickable-file" data-file-path="' + fileChange.path + '">' + fileChange.path + '</span>';
                                    html += '<span class="file-stats">+' + fileChange.additions + ' -' + fileChange.deletions + '</span>';
                                    html += '</div>';
                                    html += '</div>';
                                });
                                html += '</div>';
                                html += '</div>';
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
                        } else if (event.target.classList.contains('clickable-file') && 
                                   event.target.dataset.filePath) {
                            vscode.postMessage({
                                type: 'showDiff',
                                filePath: event.target.dataset.filePath
                            });
                        } else if (event.target.closest('.comment-item')) {
                            const commentItem = event.target.closest('.comment-item');
                            const commentData = JSON.parse(decodeURIComponent(commentItem.dataset.comment));
                            vscode.postMessage({
                                type: 'showComment',
                                comment: commentData
                            });
                        }
                    });
                    
                    window.addEventListener('message', event => {
                        console.log('[WEBVIEW] Received message:', event.data);
                        const message = event.data;
                        if (message.type === 'walkthrough') {
                            console.log('[WALKTHROUGH] Processing message with data:', message.data);
                            const data = message.data;
                            
                            console.log('[SECTIONS] Walkthrough sections:', {
                                introduction: data.introduction?.length || 0,
                                highlights: data.highlights?.length || 0, 
                                changes: data.changes?.length || 0,
                                actions: data.actions?.length || 0
                            });
                            
                            let html = '';
                            
                            html += renderSection('Introduction', data.introduction);
                            html += renderSection('Highlights', data.highlights);
                            html += renderSection('Changes', data.changes);
                            html += renderSection('Actions', data.actions);
                            
                            console.log('[HTML] Generated HTML length:', html.length);
                            const finalHtml = html || '<div class="empty-state">Empty walkthrough</div>';
                            console.log('[UPDATE] Setting innerHTML to content element');
                            
                            const contentElement = document.getElementById('content');
                            if (contentElement) {
                                contentElement.innerHTML = finalHtml;
                                console.log('[SUCCESS] Content updated successfully');
                                
                                // Add placement icons to all dialectic links
                                addPlacementIcons();
                            } else {
                                console.error('[ERROR] Content element not found!');
                            }
                        } else if (message.type === 'updateLinkPlacement') {
                            console.log('[PLACEMENT] Updating link placement:', message.dialecticUrl, 'isPlaced:', message.isPlaced);
                            updateLinkPlacement(message.dialecticUrl, message.isPlaced);
                        } else {
                            console.log('[IGNORE] Ignoring message type:', message.type);
                        }
                    });
                    
                    // Notify extension that webview is ready
                    vscode.postMessage({
                        command: 'ready'
                    });
                </script>
            </body>
            </html>`;

        this.outputChannel.appendLine(`-----------------------------------------`);
        this.outputChannel.appendLine(`WEBVIEW HTML FOLLOWS:`);
        this.outputChannel.appendLine(html);
        this.outputChannel.appendLine(`-----------------------------------------`);

        return html;
    }

    dispose() {
        if (this.commentController) {
            this.commentController.dispose();
            this.commentController = undefined;
        }
    }
}
