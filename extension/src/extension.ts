import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ReviewWebviewProvider } from './reviewWebview';
import { SyntheticPRProvider } from './syntheticPRProvider';
import { WalkthroughWebviewProvider } from './walkthroughWebview';

// TEST TEST TEST 


// 💡: Types for IPC communication with MCP server
interface IPCMessage {
    shellPid: number;
    type: 'present_review' | 'present_walkthrough' | 'log' | 'get_selection' | 'response' | 'marco' | 'polo' | 'goodbye' | 'resolve_symbol_by_name' | 'find_all_references' | 'create_synthetic_pr' | 'update_synthetic_pr' | string; // string allows unknown types
    payload: PresentReviewPayload | PresentWalkthroughPayload | LogPayload | GetSelectionPayload | PoloPayload | GoodbyePayload | ResolveSymbolPayload | FindReferencesPayload | ResponsePayload | SyntheticPRPayload | unknown; // unknown allows any payload
    id: string;
}

interface PresentReviewPayload {
    content: string;
    mode: 'replace' | 'update-section' | 'append';
    section?: string;
    baseUri?: string;
}

interface LogPayload {
    level: 'info' | 'error' | 'debug';
    message: string;
}

interface GetSelectionPayload {
    // Empty payload
}

interface PoloPayload {
    // Shell PID now at top level
}

interface GoodbyePayload {
    // Shell PID now at top level  
}

interface ResolveSymbolPayload {
    name: string;
}

interface FindReferencesPayload {
    symbol: SymbolDef;
}

interface ResponsePayload {
    success: boolean;
    error?: string;
    data?: any;
}

interface SyntheticPRPayload {
    review_id: string;
    title: string;
    description: any;
    commit_range: string;
    files_changed: FileChange[];
    comment_threads: CommentThread[];
    status: string;
}

interface PresentWalkthroughPayload {
    introduction?: WalkthroughElement[];
    highlights?: WalkthroughElement[];
    changes?: WalkthroughElement[];
    actions?: WalkthroughElement[];
    base_uri: string;
}

type WalkthroughElement = 
    | string  // ResolvedMarkdownElement (now serialized as plain string)
    | { comment: ResolvedComment }
    | { files: FileChange[] }  // GitDiffElement - named field serializes as {"files": [...]}
    | { action: ResolvedAction };

interface ResolvedComment {
    locations: FileRange[];
    icon?: string;
    content: WalkthroughElement[];
}

interface ResolvedAction {
    button: string;
    tell_agent?: string;
}

interface FileLocation {
    line: number;
    column: number;
}

interface FileRange {
    path: string;
    start: FileLocation;
    end: FileLocation;
    content?: string;
}

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

interface CommentThread {
    id: string;
    file_path: string;
    line_number: number;
    comment_type: 'insight' | 'question' | 'todo' | 'fixme';
    content: string;
}

interface UserFeedback {
    feedback_type: 'comment' | 'complete_review';
    review_id: string;
    // For Comment variant
    file_path?: string;
    line_number?: number;
    comment_text?: string;
    context_lines?: string[];
    // For CompleteReview variant
    completion_action?: 'request_changes' | 'checkpoint' | 'return';
    additional_notes?: string;
}

// 💡: Corresponds to `dialectic_mcp_server::ide::SymbolRef` in the Rust code
interface SymbolDef {
    name: String,
    kind?: String,
    definedAt: FileRange,
}

// 💡: Corresponds to `dialectic_mcp_server::ide::SymbolRef` in the Rust code
interface SymbolRef {
    definition: SymbolDef,
    referencedAt: FileLocation,
}

// 💡: Corresponds to `dialectic_mcp_server::ide::FileRange` in the Rust code
interface FileRange {
    path: string,
    start: FileLocation,
    end: FileLocation,
    content?: string,
}

// 💡: Corresponds to `dialectic_mcp_server::ide::FileLocation` in the Rust code
interface FileLocation {
    line: number,    // 💡: 1-based, vscode is 0-based
    column: number,  // 💡: 1-based, vscode is 0-based
}

// 💡: Daemon client for connecting to message bus
class DaemonClient implements vscode.Disposable {
    private socket: net.Socket | null = null;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private isDisposed = false;
    private buffer = '';
    private readonly RECONNECT_INTERVAL_MS = 5000; // 5 seconds

    // Terminal registry: track active shell PIDs with MCP servers
    private activeTerminals: Set<number> = new Set();

    // Review feedback handling
    private pendingFeedbackResolvers: Map<string, (feedback: UserFeedback) => void> = new Map();
    private currentReviewId?: string;

    constructor(
        private context: vscode.ExtensionContext,
        private reviewProvider: ReviewWebviewProvider,
        private outputChannel: vscode.OutputChannel,
        private syntheticPRProvider: SyntheticPRProvider,
        private walkthroughProvider: WalkthroughWebviewProvider
    ) { }

    start(): void {
        this.outputChannel.appendLine('Starting daemon client...');
        this.connectToDaemon();
    }

    private connectToDaemon(): void {
        if (this.isDisposed) return;

        const socketPath = this.getDaemonSocketPath();
        this.outputChannel.appendLine(`Attempting to connect to daemon: ${socketPath}`);

        this.socket = new net.Socket();

        // Set up all socket handlers immediately when socket is created
        this.setupSocketHandlers();

        this.socket.on('connect', () => {
            this.outputChannel.appendLine('✅ Connected to message bus daemon');
            this.clearReconnectTimer();

            // Send Marco broadcast to discover existing MCP servers
            this.sendMarco();
        });

        this.socket.on('error', (error) => {
            // Only log at debug level to avoid spam during normal startup
            this.outputChannel.appendLine(`Daemon connection failed: ${error.message} (will retry in ${this.RECONNECT_INTERVAL_MS / 1000}s)`);
            this.scheduleReconnect();
        });

        this.socket.on('close', () => {
            this.outputChannel.appendLine('Daemon connection closed, reconnecting...');
            this.scheduleReconnect();
        });

        this.socket.connect(socketPath);
    }

    private setupSocketHandlers(): void {
        if (!this.socket) return;

        this.socket.on('data', (data) => {
            this.buffer += data.toString();

            // Process all complete messages (ending with \n)
            let lines = this.buffer.split('\n');
            this.buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.trim()) { // Skip empty lines
                    try {
                        const message: IPCMessage = JSON.parse(line);
                        this.outputChannel.appendLine(`Received message: ${message.type} (${message.id})`);
                        // Handle message asynchronously for shell PID filtering
                        this.handleIncomingMessage(message).catch(error => {
                            this.outputChannel.appendLine(`Error handling message: ${error}`);
                        });
                    } catch (error) {
                        const errorMsg = `Failed to parse message: ${error}`;
                        this.outputChannel.appendLine(errorMsg);
                        console.error(errorMsg);
                    }
                }
            }
        });
    }

    private async handleIncomingMessage(message: IPCMessage): Promise<void> {
        // First check: is this message for our window?
        // Marco messages (shellPid = 0) are broadcasts that everyone should ignore
        if (message.shellPid !== 0 && !await this.isMessageForOurWindow(message.shellPid)) {
            return; // Silently ignore messages for other windows
        }

        // Forward compatibility: only process known message types
        if (message.type === 'present_review') {
            try {
                const reviewPayload = message.payload as PresentReviewPayload;

                this.reviewProvider.updateReview(
                    reviewPayload.content,
                    reviewPayload.mode,
                    reviewPayload.baseUri
                );

                // Send success response back through daemon
                this.sendResponse(message.id, { success: true });
            } catch (error) {
                this.outputChannel.appendLine(`Error handling present_review: ${error}`);
                this.sendResponse(message.id, {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else if (message.type === 'present_walkthrough') {
            try {
                const walkthroughPayload = message.payload as PresentWalkthroughPayload;
                
                this.outputChannel.appendLine(`Received walkthrough with base_uri: ${walkthroughPayload.base_uri}`);
                this.outputChannel.appendLine(`Walkthrough sections: ${Object.keys(walkthroughPayload).filter(k => k !== 'base_uri' && walkthroughPayload[k as keyof PresentWalkthroughPayload]).join(', ')}`);
                
                // Set base URI for file resolution
                if (walkthroughPayload.base_uri) {
                    this.walkthroughProvider.setBaseUri(walkthroughPayload.base_uri);
                }
                
                // Show walkthrough in webview
                this.walkthroughProvider.showWalkthrough({
                    introduction: walkthroughPayload.introduction,
                    highlights: walkthroughPayload.highlights,
                    changes: walkthroughPayload.changes,
                    actions: walkthroughPayload.actions
                });
                
                // Send success response back through daemon
                this.sendResponse(message.id, { success: true });
            } catch (error) {
                this.outputChannel.appendLine(`Error handling present_walkthrough: ${error}`);
                this.sendResponse(message.id, {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else if (message.type === 'get_selection') {
            try {
                const selectionData = this.getCurrentSelection();
                this.sendResponse(message.id, {
                    success: true,
                    data: selectionData
                });
            } catch (error) {
                this.outputChannel.appendLine(`Error handling get_selection: ${error}`);
                this.sendResponse(message.id, {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else if (message.type === 'log') {
            // Handle log messages - no response needed, just display in output channel
            try {
                const logPayload = message.payload as LogPayload;

                const levelPrefix = logPayload.level.toUpperCase();
                this.outputChannel.appendLine(`[${levelPrefix}] ${logPayload.message}`);
            } catch (error) {
                this.outputChannel.appendLine(`Error handling log message: ${error}`);
            }
        } else if (message.type === 'polo') {
            // Handle Polo messages - MCP server announcing presence
            try {
                this.outputChannel.appendLine(`[DISCOVERY] MCP server connected in terminal PID ${message.shellPid}`);

                // Add to terminal registry for Ask Socratic Shell integration
                this.activeTerminals.add(message.shellPid);
                this.outputChannel.appendLine(`[REGISTRY] Active terminals: [${Array.from(this.activeTerminals).join(', ')}]`);
            } catch (error) {
                this.outputChannel.appendLine(`Error handling polo message: ${error}`);
            }
        } else if (message.type === 'goodbye') {
            // Handle Goodbye messages - MCP server announcing departure
            try {
                this.outputChannel.appendLine(`[DISCOVERY] MCP server disconnected from terminal PID ${message.shellPid}`);

                // Remove from terminal registry for Ask Socratic Shell integration
                this.activeTerminals.delete(message.shellPid);
                this.outputChannel.appendLine(`[REGISTRY] Active terminals: [${Array.from(this.activeTerminals).join(', ')}]`);
            } catch (error) {
                this.outputChannel.appendLine(`Error handling goodbye message: ${error}`);
            }
        } else if (message.type === 'marco') {
            // Ignore Marco messages - these are broadcasts we send, MCP servers respond to them
            // Extensions don't need to respond to Marco broadcasts
        } else if (message.type === 'resolve_symbol_by_name') {
            // Handle symbol resolution requests from MCP server
            try {
                const symbolPayload = message.payload as ResolveSymbolPayload;

                this.outputChannel.appendLine(`[LSP] Resolving symbol: ${symbolPayload.name}`);

                // Call VSCode's LSP to find symbol definitions
                const symbols = await this.resolveSymbolByName(symbolPayload.name);

                this.sendResponse(message.id, {
                    success: true,
                    data: symbols
                });
            } catch (error) {
                this.outputChannel.appendLine(`Error handling resolve_symbol_by_name: ${error}`);
                this.sendResponse(message.id, {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else if (message.type === 'find_all_references') {
            // Handle find references requests from MCP server
            try {
                const referencesPayload = message.payload as FindReferencesPayload;

                this.outputChannel.appendLine(`[LSP] Finding references for symbol: ${referencesPayload.symbol.name}`);

                // Call VSCode's LSP to find all references
                const references = await this.findAllReferences(referencesPayload.symbol);

                this.sendResponse(message.id, {
                    success: true,
                    data: references
                });
            } catch (error) {
                this.outputChannel.appendLine(`Error handling find_all_references: ${error}`);
                this.sendResponse(message.id, {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else if (message.type === 'create_synthetic_pr') {
            // Handle synthetic PR creation
            const startTime = Date.now();
            this.outputChannel.appendLine(`[SYNTHETIC PR] ${Date.now() - startTime}ms: Received create_synthetic_pr message`);
            try {
                const prPayload = message.payload as SyntheticPRPayload;
                this.outputChannel.appendLine(`[SYNTHETIC PR] ${Date.now() - startTime}ms: Creating PR: ${prPayload.title}`);

                // Create PR UI using SyntheticPRProvider
                this.outputChannel.appendLine(`[SYNTHETIC PR] ${Date.now() - startTime}ms: Calling syntheticPRProvider.createSyntheticPR`);
                await this.syntheticPRProvider.createSyntheticPR(prPayload);
                this.outputChannel.appendLine(`[SYNTHETIC PR] ${Date.now() - startTime}ms: syntheticPRProvider.createSyntheticPR completed`);

                // Collect user feedback
                this.outputChannel.appendLine(`[SYNTHETIC PR] ${Date.now() - startTime}ms: Collecting user feedback`);
                const userFeedback = await this.collectUserFeedback(prPayload.review_id);
                this.outputChannel.appendLine(`[SYNTHETIC PR] ${Date.now() - startTime}ms: User feedback collected`);

                this.outputChannel.appendLine(`[SYNTHETIC PR] ${Date.now() - startTime}ms: Sending feedback response`);
                this.sendResponse(message.id, { success: true, data: userFeedback });
                this.outputChannel.appendLine(`[SYNTHETIC PR] ${Date.now() - startTime}ms: Feedback response sent`);
            } catch (error) {
                this.outputChannel.appendLine(`Error handling create_synthetic_pr: ${error}`);
                this.sendResponse(message.id, {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else if (message.type === 'update_synthetic_pr') {
            // Handle synthetic PR updates
            try {
                const prPayload = message.payload as SyntheticPRPayload;
                this.outputChannel.appendLine(`[SYNTHETIC PR] Updating PR: ${prPayload.review_id}`);

                // Update PR UI using SyntheticPRProvider
                await this.syntheticPRProvider.updateSyntheticPR(prPayload);

                // Collect user feedback
                const userFeedback = await this.collectUserFeedback(prPayload.review_id);

                this.sendResponse(message.id, { success: true, data: userFeedback });
            } catch (error) {
                this.outputChannel.appendLine(`Error handling update_synthetic_pr: ${error}`);
                this.sendResponse(message.id, {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else if (message.type === 'response') {
            // Ignore this, response messages are messages that WE send to clients.
        } else {
            // Forward compatibility: silently ignore unknown message types for our window
            // Only log if this was actually meant for us (not a broadcast)
            if (message.shellPid !== 0) {
                this.outputChannel.appendLine(`Received unknown message type: ${message.type} (ignoring for forward compatibility)`);
            }
        }
    }

    private extractShellPidFromMessage(message: IPCMessage): number | null {
        return message.shellPid || null;
    }

    private async isMessageForOurWindow(shellPid: number): Promise<boolean> {
        try {
            // Get all terminal PIDs in the current VSCode window
            const terminals = vscode.window.terminals;

            for (const terminal of terminals) {
                try {
                    const terminalPid = await terminal.processId;
                    if (terminalPid === shellPid) {
                        this.outputChannel.appendLine(`Debug: shell PID ${shellPid} is in our window`);
                        return true;
                    }
                } catch (error) {
                    // Some terminals might not have accessible PIDs, skip them
                    continue;
                }
            }

            this.outputChannel.appendLine(`Debug: shell PID ${shellPid} is not in our window`);
            return false;
        } catch (error) {
            this.outputChannel.appendLine(`Error checking if message is for our window: ${error}`);
            // On error, default to processing the message (fail open)
            return true;
        }
    }

    private getCurrentSelection(): any {
        const activeEditor = vscode.window.activeTextEditor;

        if (!activeEditor) {
            return {
                selectedText: null,
                message: 'No active editor found'
            };
        }

        const selection = activeEditor.selection;

        if (selection.isEmpty) {
            return {
                selectedText: null,
                filePath: activeEditor.document.fileName,
                documentLanguage: activeEditor.document.languageId,
                isUntitled: activeEditor.document.isUntitled,
                message: 'No text selected in active editor'
            };
        }

        const selectedText = activeEditor.document.getText(selection);
        const startLine = selection.start.line + 1; // Convert to 1-based
        const startColumn = selection.start.character + 1; // Convert to 1-based
        const endLine = selection.end.line + 1;
        const endColumn = selection.end.character + 1;

        return {
            selectedText,
            filePath: activeEditor.document.fileName,
            startLine,
            startColumn,
            endLine,
            endColumn,
            lineNumber: startLine === endLine ? startLine : undefined,
            documentLanguage: activeEditor.document.languageId,
            isUntitled: activeEditor.document.isUntitled,
            message: `Selected ${selectedText.length} characters from ${startLine === endLine ? `line ${startLine}, columns ${startColumn}-${endColumn}` : `lines ${startLine}:${startColumn} to ${endLine}:${endColumn}`}`
        };
    }

    /**
     * Handle comment feedback from diff view
     */
    public handleCommentFeedback(comment: string, filePath: string, lineNumber: number): void {
        const reviewId = this.currentReviewId;
        if (!reviewId) {
            vscode.window.showErrorMessage('No active review found');
            return;
        }

        const resolver = this.pendingFeedbackResolvers.get(reviewId);
        if (!resolver) {
            vscode.window.showErrorMessage('No pending feedback request found');
            return;
        }

        // Resolve with comment feedback
        resolver({
            feedback_type: 'comment',
            review_id: reviewId,
            comment_text: comment,
            file_path: filePath,
            line_number: lineNumber
        });

        // Clear tree view and cleanup
        this.syntheticPRProvider.clearPR();
        this.pendingFeedbackResolvers.delete(reviewId);
    }

    /**
     * Handle review action from tree view button click
     */
    public handleReviewAction(action: string): void {
        const reviewId = this.currentReviewId;
        if (!reviewId) {
            vscode.window.showErrorMessage('No active review found');
            return;
        }

        const resolver = this.pendingFeedbackResolvers.get(reviewId);
        if (!resolver) {
            vscode.window.showErrorMessage('No pending feedback request found');
            return;
        }

        this.handleSpecificAction(action, reviewId, resolver);
    }

    private async handleSpecificAction(action: string, reviewId: string, resolver: (feedback: UserFeedback) => void): Promise<void> {
        if (action === 'comment') {
            const commentText = await vscode.window.showInputBox({
                prompt: 'Enter your comment',
                placeHolder: 'Type your comment here...',
                ignoreFocusOut: true
            });

            resolver({
                feedback_type: 'comment',
                review_id: reviewId,
                comment_text: commentText || '',
                file_path: 'review',
                line_number: 1
            });
        } else if (action === 'request_changes' || action === 'checkpoint') {
            const additionalNotes = await vscode.window.showInputBox({
                prompt: 'Any additional notes? (optional)',
                placeHolder: 'Additional instructions or context...',
                ignoreFocusOut: true
            });

            resolver({
                feedback_type: 'complete_review',
                review_id: reviewId,
                completion_action: action as 'request_changes' | 'checkpoint',
                additional_notes: additionalNotes
            });
        } else {
            resolver({
                feedback_type: 'complete_review',
                review_id: reviewId,
                completion_action: 'return'
            });
        }

        // Clear tree view after action
        this.syntheticPRProvider.clearPR();
        this.pendingFeedbackResolvers.delete(reviewId);
    }

    /**
     * Collect user feedback for a review
     * This method blocks until the user provides feedback via tree view buttons
     */
    private async collectUserFeedback(reviewId: string): Promise<UserFeedback> {
        this.currentReviewId = reviewId;

        // Automatically show the review
        vscode.commands.executeCommand('dialectic.showReview');

        return new Promise<UserFeedback>((resolve) => {
            this.pendingFeedbackResolvers.set(reviewId, resolve);
        });
    }

    private sendResponse(messageId: string, response: ResponsePayload): void {
        if (!this.socket || this.socket.destroyed) {
            this.outputChannel.appendLine(`Cannot send response - socket not connected`);
            return;
        }

        const responseMessage: IPCMessage = {
            type: 'response',
            payload: response,
            id: messageId,
            shellPid: 0,
        };

        try {
            this.socket.write(JSON.stringify(responseMessage) + '\n');
        } catch (error) {
            this.outputChannel.appendLine(`Failed to send response: ${error}`);
        }
    }

    private sendMarco(): void {
        if (!this.socket || this.socket.destroyed) {
            this.outputChannel.appendLine(`Cannot send Marco - socket not connected`);
            return;
        }

        const marcoMessage = {
            type: 'marco',
            payload: {},
            id: crypto.randomUUID()
        };

        try {
            this.socket.write(JSON.stringify(marcoMessage) + '\n');
            this.outputChannel.appendLine('[DISCOVERY] Sent Marco broadcast to discover MCP servers');
        } catch (error) {
            this.outputChannel.appendLine(`Failed to send Marco: ${error}`);
        }
    }

    private getDaemonSocketPath(): string {
        const discoveredPid = findVSCodePID(this.outputChannel);
        const vscodePid = discoveredPid || (() => {
            this.outputChannel.appendLine('Warning: Could not discover VSCode PID, using fallback');
            return crypto.randomUUID();
        })();

        return `/tmp/dialectic-daemon-${vscodePid}.sock`;
    }

    private scheduleReconnect(): void {
        if (this.isDisposed) return;

        this.clearReconnectTimer();
        this.reconnectTimer = setTimeout(() => {
            this.connectToDaemon();
        }, this.RECONNECT_INTERVAL_MS);
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Resolve symbol by name using VSCode's LSP
     */
    private async resolveSymbolByName(symbolName: string): Promise<SymbolDef[]> {
        try {
            // Get all workspace symbols matching the name
            const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
                'vscode.executeWorkspaceSymbolProvider',
                symbolName
            );

            if (!symbols || symbols.length === 0) {
                return [];
            }

            // Convert VSCode symbols to our format
            const resolvedSymbols: SymbolDef[] = symbols.map(symbol => this.vscodeSymbolToSymbolDef(symbol));

            return resolvedSymbols;
        } catch (error) {
            this.outputChannel.appendLine(`Error in resolveSymbolByName: ${error}`);
            throw error;
        }
    }

    private vscodeSymbolToSymbolDef(symbol: vscode.SymbolInformation): SymbolDef {
        let definedAt = symbol.location
        let result: SymbolDef = {
            name: symbol.name,
            definedAt: this.vscodeLocationToRange(symbol.location),
        };

        switch (symbol.kind) {
            case vscode.SymbolKind.File: result.kind = "File"; break;
            case vscode.SymbolKind.Module: result.kind = "Module"; break;
            case vscode.SymbolKind.Namespace: result.kind = "Namespace"; break;
            case vscode.SymbolKind.Package: result.kind = "Package"; break;
            case vscode.SymbolKind.Class: result.kind = "Class"; break;
            case vscode.SymbolKind.Method: result.kind = "Method"; break;
            case vscode.SymbolKind.Property: result.kind = "Property"; break;
            case vscode.SymbolKind.Field: result.kind = "Field"; break;
            case vscode.SymbolKind.Constructor: result.kind = "Constructor"; break;
            case vscode.SymbolKind.Enum: result.kind = "Enum"; break;
            case vscode.SymbolKind.Interface: result.kind = "Interface"; break;
            case vscode.SymbolKind.Function: result.kind = "Function"; break;
            case vscode.SymbolKind.Variable: result.kind = "Variable"; break;
            case vscode.SymbolKind.Constant: result.kind = "Constant"; break;
            case vscode.SymbolKind.String: result.kind = "String"; break;
            case vscode.SymbolKind.Number: result.kind = "Number"; break;
            case vscode.SymbolKind.Boolean: result.kind = "Boolean"; break;
            case vscode.SymbolKind.Array: result.kind = "Array"; break;
            case vscode.SymbolKind.Object: result.kind = "Object"; break;
            case vscode.SymbolKind.Key: result.kind = "Key"; break;
            case vscode.SymbolKind.Null: result.kind = "Null"; break;
            case vscode.SymbolKind.EnumMember: result.kind = "EnumMember"; break;
            case vscode.SymbolKind.Struct: result.kind = "Struct"; break;
            case vscode.SymbolKind.Event: result.kind = "Event"; break;
            case vscode.SymbolKind.Operator: result.kind = "Operator"; break;
            case vscode.SymbolKind.TypeParameter: result.kind = "TypeParameter"; break;
        }

        return result;
    }

    private vscodeLocationToRange(location: vscode.Location): FileRange {
        return {
            path: location.uri.fsPath,
            start: {
                line: location.range.start.line + 1,
                column: location.range.start.character + 1,
            },
            end: {
                line: location.range.end.line + 1,
                column: location.range.end.character + 1,
            },
        };
    }


    /**
     * Find all references to a symbol using VSCode's LSP
     */
    private async findAllReferences(symbol: SymbolDef): Promise<FileRange[]> {
        try {
            // Convert relative path back to URI
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error('No workspace folder found');
            }

            // Find all references using LSP
            this.outputChannel.appendLine(`workspaceFolder.uri: ${workspaceFolder.uri}`);
            this.outputChannel.appendLine(`symbol.definedAt.path: ${symbol.definedAt.path}`);
            const locations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeReferenceProvider',
                vscode.Uri.file(path.isAbsolute(symbol.definedAt.path)
                    ? symbol.definedAt.path
                    : path.resolve(workspaceFolder.uri.fsPath, symbol.definedAt.path)),
                new vscode.Position(symbol.definedAt.start.line - 1, symbol.definedAt.start.column - 1)
            );

            return locations.map(location => this.vscodeLocationToRange(location));
        } catch (error) {
            this.outputChannel.appendLine(`Error in findAllReferences: ${error}`);
            throw error;
        }
    }

    dispose(): void {
        this.isDisposed = true;
        this.clearReconnectTimer();

        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }

        this.outputChannel.appendLine('Daemon client disposed');
    }

    /**
     * Get the set of active terminal shell PIDs with MCP servers
     * For Ask Socratic Shell integration
     */
    getActiveTerminals(): Set<number> {
        return new Set(this.activeTerminals); // Return a copy to prevent external modification
    }
}

export function activate(context: vscode.ExtensionContext) {

    // 💡: Create dedicated output channel for cleaner logging
    const outputChannel = vscode.window.createOutputChannel('Dialectic');
    outputChannel.appendLine('Dialectic extension is now active');
    console.log('Dialectic extension is now active');

    // 💡: PID Discovery Testing - Log VSCode and terminal PIDs
    logPIDDiscovery(outputChannel).catch(error => {
        outputChannel.appendLine(`Error in PID discovery: ${error}`);
    });

    // Create the webview review provider
    const reviewProvider = new ReviewWebviewProvider(context, outputChannel);

    // Create synthetic PR provider for AI-generated pull requests
    const syntheticPRProvider = new SyntheticPRProvider(context);

    // Create walkthrough webview provider
    const walkthroughProvider = new WalkthroughWebviewProvider(context.extensionUri, outputChannel, undefined, context);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(WalkthroughWebviewProvider.viewType, walkthroughProvider)
    );

    console.log('Webview provider created successfully');

    // 💡: Set up daemon client connection for message bus communication
    const daemonClient = new DaemonClient(context, reviewProvider, outputChannel, syntheticPRProvider, walkthroughProvider);
    
    // Set daemon client on walkthrough provider for terminal access
    walkthroughProvider.setDaemonClient(daemonClient);
    daemonClient.start();

    // Set up comment callback to send comments as feedback
    syntheticPRProvider.setCommentCallback((comment: string, filePath: string, lineNumber: number) => {
        daemonClient.handleCommentFeedback(comment, filePath, lineNumber);
    });

    // 💡: Set up universal selection detection for interactive code review
    setupSelectionDetection(context, outputChannel, daemonClient);

    // Register commands
    const showReviewCommand = vscode.commands.registerCommand('dialectic.showReview', () => {
        reviewProvider.showReview();
    });

    // Register review action command for tree view buttons
    const reviewActionCommand = vscode.commands.registerCommand('dialectic.reviewAction', (action: string) => {
        daemonClient.handleReviewAction(action);
    });

    // 💡: Copy review command is now handled via webview postMessage
    const copyReviewCommand = vscode.commands.registerCommand('dialectic.copyReview', () => {
        vscode.window.showInformationMessage('Use the Copy Review button in the review panel');
    });

    // 💡: PID discovery command for testing
    const logPIDsCommand = vscode.commands.registerCommand('dialectic.logPIDs', async () => {
        outputChannel.show(); // Bring output channel into focus
        await logPIDDiscovery(outputChannel);
        vscode.window.showInformationMessage('PID information logged to Dialectic output channel');
    });

    context.subscriptions.push(showReviewCommand, reviewActionCommand, copyReviewCommand, logPIDsCommand, reviewProvider, syntheticPRProvider, daemonClient);

    // Return API for Ask Socratic Shell integration
    return {
        getActiveTerminals: () => daemonClient.getActiveTerminals()
    };
}

// 💡: Set up universal selection detection for interactive code review
function setupSelectionDetection(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel, daemonClient: DaemonClient): void {
    outputChannel.appendLine('Setting up universal selection detection...');

    // 💡: Track current selection state
    let currentSelection: {
        editor: vscode.TextEditor;
        selection: vscode.Selection;
    } | null = null;

    // 💡: Listen for selection changes to track current selection
    const selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.selections.length > 0 && !event.selections[0].isEmpty) {
            const selection = event.selections[0];

            // Store current selection state
            currentSelection = {
                editor: event.textEditor,
                selection: selection
            };
        } else {
            currentSelection = null;
        }
    });

    // 💡: Register Code Action Provider for "Socratic Shell" section
    const codeActionProvider = vscode.languages.registerCodeActionsProvider(
        '*', // All file types
        {
            provideCodeActions(document, range, context) {
                // Only show when there's a non-empty selection
                if (!range.isEmpty) {
                    const action = new vscode.CodeAction(
                        'Ask Socratic Shell',
                        vscode.CodeActionKind.QuickFix
                    );
                    action.command = {
                        command: 'dialectic.chatAboutSelection',
                        title: 'Ask Socratic Shell'
                    };
                    action.isPreferred = true; // Show at top of list

                    return [action];
                }
                return [];
            }
        },
        {
            providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        }
    );

    // 💡: Register command for when user clicks the code action
    const chatIconCommand = vscode.commands.registerCommand('dialectic.chatAboutSelection', async () => {
        if (currentSelection) {
            const selectedText = currentSelection.editor.document.getText(currentSelection.selection);
            const filePath = currentSelection.editor.document.fileName;
            const startLine = currentSelection.selection.start.line + 1;
            const startColumn = currentSelection.selection.start.character + 1;
            const endLine = currentSelection.selection.end.line + 1;
            const endColumn = currentSelection.selection.end.character + 1;

            outputChannel.appendLine(`CHAT ICON CLICKED!`);
            outputChannel.appendLine(`Selected: "${selectedText}"`);
            outputChannel.appendLine(`Location: ${filePath}:${startLine}:${startColumn}-${endLine}:${endColumn}`);

            // 💡: Phase 4 & 5: Find Q chat terminal and inject formatted message
            const targetTerminal = await findQChatTerminal(outputChannel, daemonClient, context);
            if (targetTerminal) {
                const formattedMessage = formatSelectionMessage(selectedText, filePath, startLine, startColumn, endLine, endColumn);
                targetTerminal.sendText(formattedMessage, false); // false = don't execute, just insert text
                targetTerminal.show(); // Bring terminal into focus
                outputChannel.appendLine(`Message injected into terminal: ${targetTerminal.name}`);
            } else {
                outputChannel.appendLine('No suitable Q chat terminal found');
                vscode.window.showWarningMessage('No suitable terminal found. Please ensure you have a terminal with an active MCP server (like Q chat) running.');
            }
        } else {
            outputChannel.appendLine('Chat action triggered but no current selection found');
        }
    });

    context.subscriptions.push(selectionListener, codeActionProvider, chatIconCommand);
    outputChannel.appendLine('Selection detection with Code Actions setup complete');
}

// 💡: Phase 4 - Intelligent terminal detection using registry
async function findQChatTerminal(outputChannel: vscode.OutputChannel, daemonClient: DaemonClient, context: vscode.ExtensionContext): Promise<vscode.Terminal | null> {
    const terminals = vscode.window.terminals;
    outputChannel.appendLine(`Found ${terminals.length} open terminals`);

    if (terminals.length === 0) {
        outputChannel.appendLine('No terminals found');
        return null;
    }

    // Get active terminals with MCP servers from registry
    const activeTerminals = daemonClient.getActiveTerminals();
    outputChannel.appendLine(`Active MCP server terminals: [${Array.from(activeTerminals).join(', ')}]`);

    if (activeTerminals.size === 0) {
        outputChannel.appendLine('No terminals with active MCP servers found');
        return null;
    }

    // Filter terminals to only those with active MCP servers (async)
    const terminalChecks = await Promise.all(
        terminals.map(async (terminal) => {
            // Extract the shell PID from the terminal (async)
            const shellPID = await terminal.processId;

            // Log terminal for debugging
            outputChannel.appendLine(`  Checking terminal: "${terminal.name}" (PID: ${shellPID})`);

            // Check if this terminal's shell PID is in our active registry
            if (shellPID && activeTerminals.has(shellPID)) {
                outputChannel.appendLine(`    ✅ Terminal "${terminal.name}" has active MCP server (PID: ${shellPID})`);
                return { terminal, isAiEnabled: true };
            } else {
                outputChannel.appendLine(`    ❌ Terminal "${terminal.name}" has no active MCP server (PID: ${shellPID})`);
                return { terminal, isAiEnabled: false };
            }
        })
    );

    // Extract only the AI-enabled terminals
    const aiEnabledTerminals = terminalChecks
        .filter(check => check.isAiEnabled)
        .map(check => check.terminal);

    outputChannel.appendLine(`AI-enabled terminals found: ${aiEnabledTerminals.length}`);

    // 💡: Simple case - exactly one AI-enabled terminal
    if (aiEnabledTerminals.length === 1) {
        const terminal = aiEnabledTerminals[0];
        outputChannel.appendLine(`Using single AI-enabled terminal: ${terminal.name}`);
        return terminal;
    }

    // 💡: Multiple AI-enabled terminals - show picker UI with memory
    if (aiEnabledTerminals.length > 1) {
        outputChannel.appendLine(`Multiple AI-enabled terminals found: ${aiEnabledTerminals.length}`);

        // Get previously selected terminal PID from workspace state
        const lastSelectedPID = context.workspaceState.get<number>('dialectic.lastSelectedTerminalPID');
        outputChannel.appendLine(`Last selected terminal PID: ${lastSelectedPID}`);

        // Create picker items with terminal info
        interface TerminalQuickPickItem extends vscode.QuickPickItem {
            terminal: vscode.Terminal;
            pid: number | undefined;
        }

        const terminalItems: TerminalQuickPickItem[] = await Promise.all(
            aiEnabledTerminals.map(async (terminal): Promise<TerminalQuickPickItem> => {
                const pid = await terminal.processId;
                const isLastSelected = pid === lastSelectedPID;
                return {
                    label: isLastSelected ? `$(star-full) ${terminal.name}` : terminal.name,
                    description: `PID: ${pid}${isLastSelected ? ' (last used)' : ''}`,
                    detail: 'Terminal with active MCP server',
                    terminal: terminal,
                    pid: pid
                };
            })
        );

        // Keep natural terminal order - don't sort, just use visual indicators

        // Find the last selected terminal for the quick option
        const lastSelectedItem = terminalItems.find(item => item.pid === lastSelectedPID);

        // Create picker items with optional "use last" entry at top
        const pickerItems: TerminalQuickPickItem[] = [];

        // Add "use last terminal" option if we have a previous selection
        if (lastSelectedItem) {
            pickerItems.push({
                label: `$(history) Use last terminal: ${lastSelectedItem.terminal.name}`,
                description: `PID: ${lastSelectedItem.pid}`,
                detail: 'Quick access to your previously used terminal',
                terminal: lastSelectedItem.terminal,
                pid: lastSelectedItem.pid
            });

            // Add separator
            pickerItems.push({
                label: '$(dash) All available terminals',
                description: '',
                detail: '',
                terminal: null as any, // This won't be selectable
                pid: undefined,
                kind: vscode.QuickPickItemKind.Separator
            });
        }

        // Add all terminals (keeping natural order)
        pickerItems.push(...terminalItems);

        // Show the picker to user
        const selectedItem = await vscode.window.showQuickPick(pickerItems, {
            placeHolder: lastSelectedItem
                ? 'Select terminal for AI chat (first option = quick access to last used)'
                : 'Select terminal for AI chat',
            title: 'Multiple AI-enabled terminals found'
        });

        if (selectedItem) {
            // Safety check - ignore separator selections
            if (selectedItem.kind === vscode.QuickPickItemKind.Separator || !selectedItem.terminal) {
                outputChannel.appendLine('User selected separator or invalid item, ignoring');
                return null;
            }

            outputChannel.appendLine(`User selected terminal: ${selectedItem.terminal.name} (PID: ${selectedItem.pid})`);

            // Remember this selection for next time
            await context.workspaceState.update('dialectic.lastSelectedTerminalPID', selectedItem.pid);
            outputChannel.appendLine(`Saved terminal PID ${selectedItem.pid} as last selected`);

            return selectedItem.terminal;
        } else {
            outputChannel.appendLine('User cancelled terminal selection');
            return null;
        }
    }

    // 💡: No AI-enabled terminals found - fall back to old logic for compatibility
    outputChannel.appendLine('No AI-enabled terminals found, falling back to name-based detection');

    if (terminals.length === 1) {
        const terminal = terminals[0];
        outputChannel.appendLine(`Using single terminal (fallback): ${terminal.name}`);
        return terminal;
    }

    const targetTerminal = terminals.find(terminal => {
        const name = terminal.name.toLowerCase();
        return name.includes('socratic shell') || name.includes('ai');
    });

    if (targetTerminal) {
        outputChannel.appendLine(`Found target terminal (fallback): ${targetTerminal.name}`);
        return targetTerminal;
    }

    outputChannel.appendLine('Multiple terminals found, but none are AI-enabled or named appropriately');
    return null;
}

// 💡: Phase 5 - Format selection context for Q chat injection
function formatSelectionMessage(
    selectedText: string,
    filePath: string,
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number
): string {
    // 💡: Create a formatted message that provides context to the AI
    const relativePath = vscode.workspace.asRelativePath(filePath);
    const location = startLine === endLine
        ? `${relativePath}:${startLine}:${startColumn}-${endColumn}`
        : `${relativePath}:${startLine}:${startColumn}-${endLine}:${endColumn}`;

    // 💡: Format as a natural message that user can continue typing after
    // 💡: Show just first 30 chars with escaped newlines for concise terminal display
    const escapedText = selectedText.replace(/\n/g, '\\n');
    const truncatedText = escapedText.length > 30
        ? escapedText.substring(0, 30) + '...'
        : escapedText;

    const message = `<context>looking at this code from ${location} <content>${truncatedText}</content></context> `;

    return message;
}

// 💡: PID Discovery Testing - Log all relevant PIDs for debugging
async function logPIDDiscovery(outputChannel: vscode.OutputChannel): Promise<void> {
    outputChannel.appendLine('=== PID DISCOVERY TESTING ===');

    // Extension process info
    outputChannel.appendLine(`Extension process PID: ${process.pid}`);
    outputChannel.appendLine(`Extension parent PID: ${process.ppid}`);

    // Try to find VSCode PID by walking up the process tree
    const vscodePid = findVSCodePID(outputChannel);
    if (vscodePid) {
        outputChannel.appendLine(`Found VSCode PID: ${vscodePid}`);
    } else {
        outputChannel.appendLine('Could not find VSCode PID');
    }

    // Log terminal PIDs (handle the Promise properly)
    const terminals = vscode.window.terminals;
    outputChannel.appendLine(`Found ${terminals.length} terminals:`);

    for (let i = 0; i < terminals.length; i++) {
        const terminal = terminals[i];
        try {
            // terminal.processId returns a Promise in newer VSCode versions
            const pid = await terminal.processId;
            outputChannel.appendLine(`  Terminal ${i}: name="${terminal.name}", PID=${pid}`);
        } catch (error) {
            outputChannel.appendLine(`  Terminal ${i}: name="${terminal.name}", PID=<error: ${error}>`);
        }
    }

    // Set up terminal monitoring
    const terminalListener = vscode.window.onDidOpenTerminal(async (terminal) => {
        try {
            const pid = await terminal.processId;
            outputChannel.appendLine(`NEW TERMINAL: name="${terminal.name}", PID=${pid}`);
        } catch (error) {
            outputChannel.appendLine(`NEW TERMINAL: name="${terminal.name}", PID=<error: ${error}>`);
        }
    });

    outputChannel.appendLine('=== END PID DISCOVERY ===');
}

// 💡: Attempt to find VSCode PID by walking up process tree
function findVSCodePID(outputChannel: vscode.OutputChannel): number | null {
    const { execSync } = require('child_process');

    try {
        let currentPid = process.pid;

        // Walk up the process tree
        for (let i = 0; i < 10; i++) { // Safety limit
            try {
                // Get process info (works on macOS/Linux)
                const psOutput = execSync(`ps -p ${currentPid} -o pid,ppid,comm,args`, { encoding: 'utf8' });
                const lines = psOutput.trim().split('\n');

                if (lines.length < 2) break;

                const processLine = lines[1].trim();
                const parts = processLine.split(/\s+/);
                const pid = parseInt(parts[0]);
                const ppid = parseInt(parts[1]);
                const command = parts.slice(3).join(' '); // Full command line

                // Check if this looks like the main VSCode process (not helper processes)
                if ((command.includes('Visual Studio Code') || command.includes('Code.app') || command.includes('Electron'))
                    && !command.includes('Code Helper')) {
                    outputChannel.appendLine(`Found VSCode PID: ${pid}`);
                    return pid;
                }

                currentPid = ppid;
                if (ppid <= 1) break; // Reached init process

            } catch (error) {
                break;
            }
        }

        outputChannel.appendLine('Could not find VSCode PID in process tree');
        return null;

    } catch (error) {
        outputChannel.appendLine(`PID discovery error: ${error}`);
        return null;
    }
}

export function deactivate() { }