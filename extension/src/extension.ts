import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ReviewWebviewProvider } from './reviewWebview';

// 💡: Types for IPC communication with MCP server
interface IPCMessage {
    type: 'present_review' | 'log' | 'get_selection';
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

interface IPCResponse {
    id: string;
    success: boolean;
    error?: string;
    data?: any;
}

export function activate(context: vscode.ExtensionContext) {
    // 💡: Create dedicated output channel for cleaner logging
    const outputChannel = vscode.window.createOutputChannel('Dialectic');
    outputChannel.appendLine('Dialectic extension is now active');
    console.log('Dialectic extension is now active');

    // Create the webview review provider
    const reviewProvider = new ReviewWebviewProvider(context, outputChannel);

    console.log('Webview provider created successfully');

    // 💡: Set up IPC server for communication with MCP server
    const server = createIPCServer(context, reviewProvider, outputChannel);

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

    context.subscriptions.push(showReviewCommand, copyReviewCommand, reviewProvider, {
        dispose: () => {
            server.close();
        }
    });
}

function createIPCServer(context: vscode.ExtensionContext, reviewProvider: ReviewWebviewProvider, outputChannel: vscode.OutputChannel): net.Server {
    const socketPath = getSocketPath(context);
    outputChannel.appendLine(`Setting up IPC server at: ${socketPath}`);

    // 💡: Clean up any existing socket file
    if (fs.existsSync(socketPath)) {
        outputChannel.appendLine('Cleaning up existing socket file');
        fs.unlinkSync(socketPath);
    }

    const server = net.createServer((socket) => {
        outputChannel.appendLine('MCP server connected via IPC');
        console.log('MCP server connected via IPC');

        socket.on('data', (data) => {
            try {
                const message: IPCMessage = JSON.parse(data.toString());
                outputChannel.appendLine(`Received IPC message: ${message.type} (${message.id})`);
                handleIPCMessage(message, socket, reviewProvider, outputChannel);
            } catch (error) {
                const errorMsg = `Failed to parse IPC message: ${error}`;
                outputChannel.appendLine(errorMsg);
                console.error(errorMsg);
                const response: IPCResponse = {
                    id: 'unknown',
                    success: false,
                    error: 'Invalid JSON message'
                };
                socket.write(JSON.stringify(response) + '\n');
            }
        });

        socket.on('error', (error) => {
            const errorMsg = `IPC socket error: ${error}`;
            outputChannel.appendLine(errorMsg);
            console.error(errorMsg);
        });

        socket.on('close', () => {
            outputChannel.appendLine('MCP server disconnected from IPC');
            console.log('MCP server disconnected from IPC');
        });
    });

    server.listen(socketPath);
    outputChannel.appendLine(`IPC server listening on: ${socketPath}`);
    console.log('IPC server listening on:', socketPath);

    // 💡: Set environment variable so MCP server can find the socket
    context.environmentVariableCollection.replace("DIALECTIC_IPC_PATH", socketPath);
    outputChannel.appendLine(`Set DIALECTIC_IPC_PATH environment variable to: ${socketPath}`);

    return server;
}

function getSocketPath(context: vscode.ExtensionContext): string {
    // 💡: Use UUID-based filename to avoid path length limits and ensure uniqueness
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\dialectic-${crypto.randomUUID()}`;
    } else {
        // Use /tmp with UUID for short, unique socket path
        return `/tmp/dialectic-${crypto.randomUUID()}.sock`;
    }
}

function handleIPCMessage(message: IPCMessage, socket: net.Socket, reviewProvider: ReviewWebviewProvider, outputChannel: vscode.OutputChannel): void {
    outputChannel.appendLine(`Processing IPC message: ${message.type} (${message.id})`);
    console.log('Received IPC message:', message.type, message.id);

    let response: IPCResponse;

    try {
        switch (message.type) {
            case 'present_review':
                // 💡: Update the review provider with new content and optional baseUri
                const reviewPayload = message.payload as {
                    content: string;
                    mode: 'replace' | 'update-section' | 'append';
                    section?: string;
                    baseUri?: string;
                };
                reviewProvider.updateReview(reviewPayload.content, reviewPayload.mode, reviewPayload.baseUri);
                response = {
                    id: message.id,
                    success: true
                };
                break;
            case 'log':
                // 💡: Handle log messages from MCP server
                const logPayload = message.payload as { level: 'info' | 'error' | 'debug'; message: string };
                const logPrefix = `[MCP-${logPayload.level.toUpperCase()}]`;
                outputChannel.appendLine(`${logPrefix} ${logPayload.message}`);
                response = {
                    id: message.id,
                    success: true
                };
                break;
            case 'get_selection':
                // 💡: Get current selection from active editor
                const activeEditor = vscode.window.activeTextEditor;

                if (!activeEditor) {
                    response = {
                        id: message.id,
                        success: true,
                        data: {
                            selectedText: null,
                            message: 'No active editor found'
                        }
                    };
                } else {
                    const selection = activeEditor.selection;

                    if (selection.isEmpty) {
                        response = {
                            id: message.id,
                            success: true,
                            data: {
                                selectedText: null,
                                filePath: activeEditor.document.fileName,
                                documentLanguage: activeEditor.document.languageId,
                                isUntitled: activeEditor.document.isUntitled,
                                message: 'No text selected in active editor'
                            }
                        };
                    } else {
                        const selectedText = activeEditor.document.getText(selection);
                        const startLine = selection.start.line + 1; // Convert to 1-based
                        const startColumn = selection.start.character + 1; // Convert to 1-based
                        const endLine = selection.end.line + 1;
                        const endColumn = selection.end.character + 1;

                        response = {
                            id: message.id,
                            success: true,
                            data: {
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
                            }
                        };
                    }
                }
                break;
            default:
                response = {
                    id: message.id,
                    success: false,
                    error: `Unknown message type: ${message.type}`
                };
        }
    } catch (error) {
        response = {
            id: message.id,
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }

    socket.write(JSON.stringify(response) + '\n');
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
            const selectedText = event.textEditor.document.getText(selection);

            outputChannel.appendLine(`Selection detected: "${selectedText}" in ${event.textEditor.document.fileName}`);

            // Store current selection state
            currentSelection = {
                editor: event.textEditor,
                selection: selection
            };
        } else {
            currentSelection = null;
            outputChannel.appendLine('Selection cleared');
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

                    outputChannel.appendLine('Code action provided for selection');
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

export function deactivate() { }