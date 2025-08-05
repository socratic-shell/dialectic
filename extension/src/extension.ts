import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ReviewWebviewProvider } from './reviewWebview';

// 💡: Types for IPC communication with MCP server
interface IPCMessage {
    type: 'present_review' | 'log' | 'get_selection' | 'response' | 'marco' | 'polo' | 'goodbye';
    payload: {
        content: string;
        mode: 'replace' | 'update-section' | 'append';
        section?: string;
    } | {
        level: 'info' | 'error' | 'debug';
        message: string;
    } | {};
    id: string;
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

    constructor(
        private context: vscode.ExtensionContext,
        private reviewProvider: ReviewWebviewProvider,
        private outputChannel: vscode.OutputChannel
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
        if (message.type === 'present_review') {
            try {
                const reviewPayload = message.payload as {
                    content: string;
                    mode: 'replace' | 'update-section' | 'append';
                    section?: string;
                    baseUri?: string;
                    terminal_shell_pid: number;
                };

                if (await this.isMessageForOurWindow(reviewPayload.terminal_shell_pid)) {
                    this.reviewProvider.updateReview(
                        reviewPayload.content,
                        reviewPayload.mode,
                        reviewPayload.baseUri
                    );

                    // Send success response back through daemon
                    this.sendResponse(message.id, { success: true });
                }
            } catch (error) {
                this.outputChannel.appendLine(`Error handling present_review: ${error}`);
                this.sendResponse(message.id, {
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        } else if (message.type === 'get_selection') {
            try {
                const selectionPayload = message.payload as {
                    terminal_shell_pid: number;
                };

                if (await this.isMessageForOurWindow(selectionPayload.terminal_shell_pid)) {
                    const selectionData = this.getCurrentSelection();
                    this.sendResponse(message.id, {
                        success: true,
                        data: selectionData
                    });
                }
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
                const logPayload = message.payload as {
                    level: string;
                    message: string;
                    terminal_shell_pid: number;
                };

                if (await this.isMessageForOurWindow(logPayload.terminal_shell_pid)) {
                    const levelPrefix = logPayload.level.toUpperCase();
                    this.outputChannel.appendLine(`[${levelPrefix}] ${logPayload.message}`);
                }
            } catch (error) {
                this.outputChannel.appendLine(`Error handling log message: ${error}`);
            }
        } else if (message.type === 'polo') {
            // Handle Polo messages - MCP server announcing presence
            try {
                const poloPayload = message.payload as {
                    terminal_shell_pid: number;
                };

                if (await this.isMessageForOurWindow(poloPayload.terminal_shell_pid)) {
                    this.outputChannel.appendLine(`[DISCOVERY] MCP server connected in terminal PID ${poloPayload.terminal_shell_pid}`);
                    
                    // Add to terminal registry for Ask Socratic Shell integration
                    this.activeTerminals.add(poloPayload.terminal_shell_pid);
                    this.outputChannel.appendLine(`[REGISTRY] Active terminals: [${Array.from(this.activeTerminals).join(', ')}]`);
                }
            } catch (error) {
                this.outputChannel.appendLine(`Error handling polo message: ${error}`);
            }
        } else if (message.type === 'goodbye') {
            // Handle Goodbye messages - MCP server announcing departure
            try {
                const goodbyePayload = message.payload as {
                    terminal_shell_pid: number;
                };

                if (await this.isMessageForOurWindow(goodbyePayload.terminal_shell_pid)) {
                    this.outputChannel.appendLine(`[DISCOVERY] MCP server disconnected from terminal PID ${goodbyePayload.terminal_shell_pid}`);
                    
                    // Remove from terminal registry for Ask Socratic Shell integration
                    this.activeTerminals.delete(goodbyePayload.terminal_shell_pid);
                    this.outputChannel.appendLine(`[REGISTRY] Active terminals: [${Array.from(this.activeTerminals).join(', ')}]`);
                }
            } catch (error) {
                this.outputChannel.appendLine(`Error handling goodbye message: ${error}`);
            }
        } else if (message.type === 'marco') {
            // Ignore Marco messages - these are broadcasts we send, MCP servers respond to them
            // Extensions don't need to respond to Marco broadcasts
        } else if (message.type == 'response') {
            // Ignore this, response messages are messages that WE send to clients.
        } else {
            this.outputChannel.appendLine(`Received unknown message type: ${message.type}`);
            this.sendResponse(message.id, {
                success: false,
                error: `Unknown message type: ${message.type}`
            });
        }
    }

    private extractShellPidFromMessage(message: IPCMessage): number | null {
        try {
            if (message.type === 'present_review' || message.type === 'get_selection' || message.type === 'log') {
                const payload = message.payload as any;
                const shellPid = payload.terminal_shell_pid;

                if (typeof shellPid === 'number') {
                    return shellPid;
                } else {
                    this.outputChannel.appendLine(`Warning: Message ${message.type} missing terminal_shell_pid field`);
                    return null;
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`Error extracting shell PID from message: ${error}`);
        }
        return null;
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

    private sendResponse(messageId: string, response: { success: boolean; error?: string; data?: any }): void {
        if (!this.socket || this.socket.destroyed) {
            this.outputChannel.appendLine(`Cannot send response - socket not connected`);
            return;
        }

        const responseMessage = {
            type: 'response',
            payload: response,
            id: messageId
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

    console.log('Webview provider created successfully');

    // 💡: Set up daemon client connection for message bus communication
    const daemonClient = new DaemonClient(context, reviewProvider, outputChannel);
    daemonClient.start();

    // 💡: Set up universal selection detection for interactive code review
    setupSelectionDetection(context, outputChannel);

    // Register commands
    const showReviewCommand = vscode.commands.registerCommand('dialectic.showReview', () => {
        reviewProvider.showReview();
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

    context.subscriptions.push(showReviewCommand, copyReviewCommand, logPIDsCommand, reviewProvider, daemonClient);

    // Return API for Ask Socratic Shell integration
    return {
        getActiveTerminals: () => daemonClient.getActiveTerminals()
    };
}

// 💡: Set up universal selection detection for interactive code review
function setupSelectionDetection(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): void {
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
    const chatIconCommand = vscode.commands.registerCommand('dialectic.chatAboutSelection', () => {
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
            const targetTerminal = findQChatTerminal(outputChannel);
            if (targetTerminal) {
                const formattedMessage = formatSelectionMessage(selectedText, filePath, startLine, startColumn, endLine, endColumn);
                targetTerminal.sendText(formattedMessage, false); // false = don't execute, just insert text
                targetTerminal.show(); // Bring terminal into focus
                outputChannel.appendLine(`Message injected into terminal: ${targetTerminal.name}`);
            } else {
                outputChannel.appendLine('No suitable Q chat terminal found');
                vscode.window.showWarningMessage('No suitable terminal found. Please ensure you have either: 1) Only one terminal open, or 2) A terminal named "Socratic Shell" or "AI".');
            }
        } else {
            outputChannel.appendLine('Chat action triggered but no current selection found');
        }
    });

    context.subscriptions.push(selectionListener, codeActionProvider, chatIconCommand);
    outputChannel.appendLine('Selection detection with Code Actions setup complete');
}

// 💡: Phase 4 - Simplified terminal detection logic
function findQChatTerminal(outputChannel: vscode.OutputChannel): vscode.Terminal | null {
    const terminals = vscode.window.terminals;
    outputChannel.appendLine(`Found ${terminals.length} open terminals`);

    if (terminals.length === 0) {
        outputChannel.appendLine('No terminals found');
        return null;
    }

    // 💡: Simple case - exactly one terminal
    if (terminals.length === 1) {
        const terminal = terminals[0];
        outputChannel.appendLine(`Using single terminal: ${terminal.name}`);
        return terminal;
    }

    // 💡: Multiple terminals - look for "Socratic Shell" or "AI" named terminal
    const targetTerminal = terminals.find(terminal => {
        const name = terminal.name.toLowerCase();
        return name.includes('socratic shell') || name.includes('ai');
    });

    if (targetTerminal) {
        outputChannel.appendLine(`Found target terminal: ${targetTerminal.name}`);
        return targetTerminal;
    }

    // 💡: Multiple terminals, no clear choice - could present user with options in future
    outputChannel.appendLine('Multiple terminals found, but none named "Socratic Shell" or "AI"');
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