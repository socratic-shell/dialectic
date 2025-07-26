#!/usr/bin/env node

// 💡: Main MCP server entry point that provides the present-review tool for AI assistants
// to display code reviews in VSCode. Acts as a thin bridge between AI and the extension.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { validatePresentReviewParams, ValidationError } from './validation.js';
import { PresentReviewParams, PresentReviewResult } from './types.js';
import { IPCCommunicator } from './ipc.js';

/**
 * Dialectic MCP Server
 * 
 * Provides tools for AI assistants to display code reviews in VSCode.
 * The server acts as a communication bridge and does not generate or
 * understand review content - that intelligence stays with the AI.
 */
class DialecticMCPServer {
  private server: Server;
  private ipc: IPCCommunicator;

  constructor() {
    this.server = new Server(
      {
        name: 'dialectic-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.ipc = new IPCCommunicator();
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    // 💡: Register the present-review tool that AI assistants can call
    // to display code reviews in the VSCode extension
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'present-review',
            description: [
              'Display a code review in the VSCode review panel.',
              'Reviews should be structured markdown with clear sections and actionable feedback.'
            ].join(' '),
            inputSchema: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: [
                    'Markdown content of the review. Should include:',
                    '1) Brief summary suitable for commit message,',
                    '2) Detailed findings with file references,',
                    '3) Specific suggestions for improvement.',
                    'Use `file:line` format for code references (e.g., `src/main.ts:42`).'
                  ].join(' '),
                },
                mode: {
                  type: 'string',
                  enum: ['replace', 'update-section', 'append'],
                  description: [
                    'How to handle the review content:',
                    'replace (default) - replace entire review,',
                    'update-section - update specific section,',
                    'append - add to existing review'
                  ].join(' '),
                  default: 'replace',
                },
                section: {
                  type: 'string',
                  description: [
                    'Section name for update-section mode',
                    '(e.g., "Summary", "Security Issues", "Performance")'
                  ].join(' '),
                },
              },
              required: ['content'],
            },
          } satisfies Tool,
        ],
      };
    });

    // 💡: Handle present-review tool calls by forwarding to VSCode extension via IPC
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === 'present-review') {
        try {
          // Validate and extract parameters
          const params = validatePresentReviewParams(args);
          
          // Forward to VSCode extension via IPC
          const result = await this.ipc.presentReview(params);
          
          return {
            content: [
              {
                type: 'text',
                text: result.success 
                  ? `Review successfully displayed in VSCode${result.message ? ': ' + result.message : ''}`
                  : `Failed to display review: ${result.message || 'Unknown error'}`,
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error presenting review: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          };
        }
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  async start(): Promise<void> {
    // 💡: Initialize IPC communication with VSCode extension
    await this.ipc.initialize();
    
    // 💡: Start MCP server with stdio transport for AI assistant communication
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    
    console.error('Dialectic MCP Server started successfully');
  }
}

// Start the server
const server = new DialecticMCPServer();
server.start().catch((error) => {
  console.error('Failed to start Dialectic MCP Server:', error);
  process.exit(1);
});
