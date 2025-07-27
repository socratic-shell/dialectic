import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { ReviewWebviewProvider } from './reviewWebview';

// 💡: Types for IPC communication with MCP server
interface IPCMessage {
    type: 'present_review' | 'log';
    payload: {
        content: string;
        mode: 'replace' | 'update-section' | 'append';
        section?: string;
    } | {
        level: 'info' | 'error' | 'debug';
        message: string;
    };
    id: string;
}

interface IPCResponse {
    id: string;
    success: boolean;
    error?: string;
}

export function activate(context: vscode.ExtensionContext) {
    // 💡: Create dedicated output channel for cleaner logging
    const outputChannel = vscode.window.createOutputChannel('Dialectic');
    outputChannel.appendLine('Dialectic extension is now active');
    console.log('Dialectic extension is now active');

    // Create the webview review provider
    const reviewProvider = new ReviewWebviewProvider(context);

    console.log('Webview provider created successfully');

    // 💡: Set up IPC server for communication with MCP server
    const server = createIPCServer(context, reviewProvider, outputChannel);
    
    // Register commands
    const showReviewCommand = vscode.commands.registerCommand('dialectic.showReview', () => {
        reviewProvider.showReview();
    });

    const copyReviewCommand = vscode.commands.registerCommand('dialectic.copyReview', () => {
        reviewProvider.copyReviewToClipboard();
    });

    context.subscriptions.push(showReviewCommand, copyReviewCommand, {
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
                socket.write(JSON.stringify(response));
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
    // 💡: Use workspace-specific storage to avoid conflicts between projects
    const storageUri = context.storageUri || context.globalStorageUri;
    const socketDir = storageUri.fsPath;
    
    // Ensure directory exists
    if (!fs.existsSync(socketDir)) {
        fs.mkdirSync(socketDir, { recursive: true });
    }
    
    // 💡: Platform-specific socket naming (Windows uses named pipes)
    if (process.platform === 'win32') {
        return `\\\\.\\pipe\\dialectic-${Date.now()}`;
    } else {
        return path.join(socketDir, 'dialectic.sock');
    }
}

function handleIPCMessage(message: IPCMessage, socket: net.Socket, reviewProvider: ReviewWebviewProvider, outputChannel: vscode.OutputChannel): void {
    outputChannel.appendLine(`Processing IPC message: ${message.type} (${message.id})`);
    console.log('Received IPC message:', message.type, message.id);
    
    let response: IPCResponse;
    
    try {
        switch (message.type) {
            case 'present_review':
                // 💡: Update the review provider with new content
                const reviewPayload = message.payload as { content: string; mode: 'replace' | 'update-section' | 'append'; section?: string };
                reviewProvider.updateReview(reviewPayload.content, reviewPayload.mode, reviewPayload.section);
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
    
    socket.write(JSON.stringify(response));
}

export function deactivate() {}