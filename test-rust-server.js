#!/usr/bin/env node

/**
 * Simple test for Rust MCP server with VSCode extension
 * 
 * Run this in a terminal where DIALECTIC_IPC_PATH is set by the IDE.
 * It will start the MCP server and send a simple review to display.
 */

const { spawn } = require('child_process');
const path = require('path');

// Path to the Rust MCP server binary
const serverPath = path.join(__dirname, 'server-rs', 'target', 'release', 'dialectic-mcp-server');

console.log('🚀 Testing Rust MCP Server...');
console.log('📍 IPC Path:', process.env.DIALECTIC_IPC_PATH || 'NOT SET');
console.log('');

// Simple review content
const reviewContent = `# 🦀 Rust MCP Server Test

## Summary
Testing the Rust MCP server implementation! If you can see this review in VSCode, then our Rust server successfully:
- Connected to VSCode via IPC
- Processed the MCP tool call
- Sent the review data to the extension

## Code Tour

### Server Implementation [here](dialectic:server-rs/src/server.rs?regex=present_review)
The Rust server is now handling this request using the rmcp SDK with async/await.

### IPC Layer [check this](dialectic:server-rs/src/ipc.rs?regex=send_message_with_reply)
This review traveled through our custom IPC implementation with UUID correlation.

## 🎉 Success!
If you're reading this, the Rust migration worked perfectly!`;

// MCP messages - proper protocol flow
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    clientInfo: { name: 'rust-test', version: '1.0.0' }
  }
};

const initialized = {
  jsonrpc: '2.0',
  method: 'notifications/initialized'
};

const presentReview = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: {
    name: 'present_review',
    arguments: {
      content: reviewContent,
      mode: 'replace',
      baseUri: '/Users/nikomat/dev/dialectic',
      section: null
    }
  }
};

// Start the server
const server = spawn(serverPath, [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env // Use current environment (includes DIALECTIC_IPC_PATH)
});

let buffer = '';
let step = 0;

server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const msg = JSON.parse(line);
      console.log('📨 Response:', JSON.stringify(msg, null, 2));
      
      if (msg.id === 1 && step === 0) {
        console.log('\n✅ Initialize response received! Sending initialized notification...\n');
        server.stdin.write(JSON.stringify(initialized) + '\n');
        step = 1;
        
        // Wait a moment then send the review
        setTimeout(() => {
          console.log('📤 Sending review...\n');
          server.stdin.write(JSON.stringify(presentReview) + '\n');
          step = 2;
        }, 100);
        
      } else if (msg.id === 2 && step === 2) {
        console.log('\n🎉 Review sent!');
        if (msg.result && !msg.result.isError) {
          console.log('✅ Success! Check VSCode review panel.');
        } else {
          console.log('❌ Error:', msg.error || msg.result);
        }
        server.kill();
      }
    } catch (e) {
      console.log('📝 Output:', line);
    }
  }
});

server.stderr.on('data', (data) => {
  console.log('🔍 Log:', data.toString().trim());
});

server.on('close', (code) => {
  console.log(`\n🏁 Done (exit ${code})`);
});

server.on('error', (err) => {
  console.error('❌ Error:', err.message);
});

// Start the flow
console.log('📤 Starting server and sending initialize...\n');
server.stdin.write(JSON.stringify(initialize) + '\n');

// Safety timeout
setTimeout(() => {
  console.log('\n⏰ Timeout - killing server');
  server.kill();
}, 15000);
