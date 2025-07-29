// 💡: IPC communication module that handles Unix socket/named pipe communication
// with the VSCode extension. Uses the pattern researched in the communication guide.

import { createConnection, Socket } from 'net';
import { randomUUID } from 'crypto';
import { PresentReviewParams, PresentReviewResult, IPCMessage, IPCResponse, LogParams, GetSelectionResult } from './types.js';

/**
 * Handles IPC communication between MCP server and VSCode extension
 */
export class IPCCommunicator {
  private socket: Socket | null = null;
  private pendingRequests = new Map<string, {
    resolve: (result: any) => void;
    reject: (error: Error) => void;
  }>();
  private testMode: boolean = false;

  constructor(testMode: boolean = false) {
    this.testMode = testMode;
  }

  async initialize(): Promise<void> {
    if (this.testMode) {
      // 💡: In test mode, just log that we're initialized
      console.error('IPC Communicator initialized (test mode)');
      return;
    }

    // 💡: Get the socket path from environment variable set by VSCode extension
    const socketPath = process.env.DIALECTIC_IPC_PATH;
    
    if (!socketPath) {
      throw new Error('DIALECTIC_IPC_PATH environment variable not set. Are you running in VSCode with the Dialectic extension?');
    }

    // 💡: Create connection to the Unix socket created by the VSCode extension
    return new Promise((resolve, reject) => {
      this.socket = createConnection(socketPath, () => {
        console.error('Connected to VSCode extension via IPC');
        resolve();
      });

      this.socket.on('error', (error) => {
        console.error('IPC socket error:', error);
        reject(error);
      });

      this.socket.on('data', (data) => {
        try {
          const response: IPCResponse = JSON.parse(data.toString());
          this.handleResponse(response);
        } catch (error) {
          console.error('Failed to parse IPC response:', error);
        }
      });

      this.socket.on('close', () => {
        console.error('IPC connection closed');
        this.socket = null;
        // Reject any pending requests
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error('IPC connection closed'));
        }
        this.pendingRequests.clear();
      });
    });
  }

  async presentReview(params: PresentReviewParams): Promise<PresentReviewResult> {
    if (this.testMode) {
      // 💡: In test mode, simulate successful review presentation
      console.error('Present review called (test mode):', JSON.stringify(params, null, 2));
      return {
        success: true,
        message: 'Review successfully displayed (test mode)',
      };
    }

    if (!this.socket) {
      throw new Error('IPC not initialized. Call initialize() first.');
    }

    // 💡: Create message with unique ID for response tracking
    const message: IPCMessage = {
      type: 'present_review',
      payload: params,
      id: randomUUID(),
    };

    console.error('Sending present_review message:', JSON.stringify(message, null, 2));

    return this.sendMessage(message);
  }

  async getSelection(): Promise<GetSelectionResult> {
    if (this.testMode) {
      // 💡: In test mode, simulate no selection
      console.error('Get selection called (test mode)');
      return {
        selectedText: null,
        message: 'No selection available (test mode)',
      };
    }

    if (!this.socket) {
      throw new Error('IPC not initialized. Call initialize() first.');
    }

    // 💡: Create message with unique ID for response tracking
    const message: IPCMessage = {
      type: 'get_selection',
      payload: {},
      id: randomUUID(),
    };

    console.error('Sending get_selection message:', JSON.stringify(message, null, 2));

    const result = await this.sendMessage(message);
    
    // 💡: For get_selection, we expect the data in the response
    if (result.success && 'data' in result) {
      return (result as any).data as GetSelectionResult;
    } else {
      return {
        selectedText: null,
        message: result.message || 'Failed to get selection',
      };
    }
  }

  /**
   * Send a log message to the VSCode extension for unified logging
   */
  async sendLog(level: 'info' | 'error' | 'debug', message: string): Promise<void> {
    if (this.testMode) {
      // 💡: In test mode, just log to console
      console.error(`[${level.toUpperCase()}] ${message}`);
      return;
    }

    if (!this.socket) {
      // 💡: If IPC not available, fall back to console logging
      console.error(`[${level.toUpperCase()}] ${message}`);
      return;
    }

    // 💡: Create log message with unique ID
    const logMessage: IPCMessage = {
      type: 'log',
      payload: { level, message },
      id: randomUUID(),
    };

    try {
      await this.sendMessage(logMessage);
    } catch (error) {
      // 💡: If log message fails, fall back to console
      console.error(`[${level.toUpperCase()}] ${message}`);
      console.error('Failed to send log via IPC:', error);
    }
  }

  private async sendMessage(message: IPCMessage): Promise<any> {
    // 💡: Send message and wait for response using Promise-based approach
    return new Promise((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('IPC socket not connected'));
        return;
      }

      // Store the promise resolvers for this message ID
      this.pendingRequests.set(message.id, { resolve, reject });

      // Send the message as JSON
      const messageData = JSON.stringify(message);
      this.socket.write(messageData);

      // Set timeout for the request
      setTimeout(() => {
        if (this.pendingRequests.has(message.id)) {
          this.pendingRequests.delete(message.id);
          reject(new Error('IPC request timeout'));
        }
      }, 5000); // 5 second timeout
    });
  }

  private handleResponse(response: IPCResponse): void {
    // 💡: Handle responses from VSCode extension
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      console.error('Received response for unknown request ID:', response.id);
      return;
    }

    this.pendingRequests.delete(response.id);

    if (response.success) {
      // 💡: For get_selection responses, return the data directly
      if (response.data) {
        pending.resolve(response.data as any);
      } else {
        // 💡: For present_review responses, return success message
        pending.resolve({ 
          success: true,
          message: 'Operation completed successfully'
        });
      }
    } else {
      pending.resolve({
        success: false,
        message: response.error || 'Unknown error from VSCode extension'
      });
    }
  }

  async close(): Promise<void> {
    // 💡: Clean up IPC connection
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    
    // Reject any pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('IPC connection closed'));
    }
    this.pendingRequests.clear();
  }
}
