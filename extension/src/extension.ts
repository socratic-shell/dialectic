import * as vscode from 'vscode';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';
import { ReviewProvider } from './reviewProvider';

// 💡: Types for IPC communication with MCP server
interface IPCMessage {
    type: 'present-review';
    payload: {
        content: string;
        mode: 'replace' | 'update-section' | 'append';
        section?: string;
    };
    id: string;
}

interface IPCResponse {
    id: string;
    success: boolean;
    error?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Dialectic extension is now active');

    // Create the review provider
    const reviewProvider = new ReviewProvider();
    
    // Register the tree data provider for our custom view
    vscode.window.createTreeView('dialecticReviews', {
        treeDataProvider: reviewProvider,
        showCollapseAll: true
    });

    console.log('TreeView registered successfully');

    // 💡: Set up IPC server for communication with MCP server
    const server = createIPCServer(context, reviewProvider);
    
    // Register commands
    const showReviewCommand = vscode.commands.registerCommand('dialectic.showReview', () => {
        reviewProvider.showDummyReview();
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

function createIPCServer(context: vscode.ExtensionContext, reviewProvider: ReviewProvider): net.Server {
    const socketPath = getSocketPath(context);
    
    // 💡: Clean up any existing socket file
    if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
    }
    
    const server = net.createServer((socket) => {
        console.log('MCP server connected via IPC');
        
        socket.on('data', (data) => {
            try {
                const message: IPCMessage = JSON.parse(data.toString());
                handleIPCMessage(message, socket, reviewProvider);
            } catch (error) {
                console.error('Failed to parse IPC message:', error);
                const response: IPCResponse = {
                    id: 'unknown',
                    success: false,
                    error: 'Invalid JSON message'
                };
                socket.write(JSON.stringify(response));
            }
        });
        
        socket.on('error', (error) => {
            console.error('IPC socket error:', error);
        });

        socket.on('close', () => {
            console.log('MCP server disconnected from IPC');
        });
    });
    
    server.listen(socketPath);
    console.log('IPC server listening on:', socketPath);
    
    // 💡: Set environment variable so MCP server can find the socket
    context.environmentVariableCollection.replace("DIALECTIC_IPC_PATH", socketPath);
    
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

function handleIPCMessage(message: IPCMessage, socket: net.Socket, reviewProvider: ReviewProvider): void {
    console.log('Received IPC message:', message.type, message.id);
    
    let response: IPCResponse;
    
    try {
        switch (message.type) {
            case 'present-review':
                // 💡: Update the review provider with new content
                reviewProvider.updateReview(message.payload.content, message.payload.mode, message.payload.section);
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