#!/usr/bin/env node

// 💡: Simple test script to verify the MCP server can start and respond to tool calls
// This simulates what an AI assistant would do when calling the present-review tool

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testMCPServer() {
  console.log('Testing Dialectic MCP Server...');
  
  // Start the MCP server
  const serverPath = join(__dirname, 'dist', 'index.js');
  const server = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverOutput = '';
  server.stderr.on('data', (data) => {
    serverOutput += data.toString();
    console.log('Server:', data.toString().trim());
  });

  server.stdout.on('data', (data) => {
    console.log('Response:', data.toString().trim());
  });

  // Wait a moment for server to start
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 1: List tools
  console.log('\n--- Test 1: List Tools ---');
  const listToolsRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list'
  };
  
  server.stdin.write(JSON.stringify(listToolsRequest) + '\n');

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 500));

  // Test 2: Call present-review tool (this will fail without VSCode but should show proper error)
  console.log('\n--- Test 2: Call present-review tool ---');
  const presentReviewRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'present-review',
      arguments: {
        content: '# Test Review\n\nThis is a test review from the MCP server test script.',
        mode: 'replace'
      }
    }
  };
  
  server.stdin.write(JSON.stringify(presentReviewRequest) + '\n');

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Clean up
  server.kill();
  
  console.log('\n--- Test Complete ---');
  console.log('Server output:', serverOutput);
}

testMCPServer().catch(console.error);

testMCPServer().catch(console.error);
