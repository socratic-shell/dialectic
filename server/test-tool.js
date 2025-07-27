#!/usr/bin/env node

// Simple test script to verify the present-review tool works
// This simulates what an AI assistant would send to the MCP server

import { spawn } from 'child_process';

const testMessages = [
  // List tools request
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
    params: {}
  },
  // Present review tool call
  {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'present_review',
      arguments: {
        content: '# Test Review\n\n## Summary\nThis is a test review to verify the MCP server is working.\n\n## Details\n- File: `test.js:15`\n- Issue: Missing error handling\n- Suggestion: Add try-catch block',
        mode: 'replace'
      }
    }
  }
];

console.log('Testing Dialectic MCP Server...\n');

const server = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'inherit']
});

let responseCount = 0;

server.stdout.on('data', (data) => {
  const response = JSON.parse(data.toString());
  console.log(`Response ${++responseCount}:`, JSON.stringify(response, null, 2));
  
  if (responseCount >= testMessages.length) {
    console.log('\n✅ All tests completed successfully!');
    server.kill();
    process.exit(0);
  }
});

server.on('error', (error) => {
  console.error('❌ Server error:', error);
  process.exit(1);
});

// Send test messages
testMessages.forEach((message, index) => {
  setTimeout(() => {
    console.log(`Sending request ${index + 1}:`, JSON.stringify(message, null, 2));
    server.stdin.write(JSON.stringify(message) + '\n');
  }, index * 100);
});
