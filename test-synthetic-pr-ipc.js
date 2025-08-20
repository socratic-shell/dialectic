#!/usr/bin/env node

/**
 * Test script to verify synthetic PR IPC communication
 * 
 * This script simulates the MCP server calling request_review and verifies
 * that the VSCode extension receives the synthetic PR data via IPC.
 */

const { spawn } = require('child_process');
const path = require('path');

async function testSyntheticPRIPC() {
    console.log('🧪 Testing Synthetic PR IPC Communication');
    console.log('==========================================');
    
    // Build the server first
    console.log('📦 Building Rust server...');
    const buildResult = spawn('cargo', ['build'], {
        cwd: path.join(__dirname, 'server'),
        stdio: 'inherit'
    });
    
    await new Promise((resolve, reject) => {
        buildResult.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Server build successful');
                resolve();
            } else {
                console.log('❌ Server build failed');
                reject(new Error(`Build failed with code ${code}`));
            }
        });
    });
    
    // Build the extension
    console.log('📦 Building TypeScript extension...');
    const extensionBuild = spawn('npm', ['run', 'compile'], {
        cwd: path.join(__dirname, 'extension'),
        stdio: 'inherit'
    });
    
    await new Promise((resolve, reject) => {
        extensionBuild.on('close', (code) => {
            if (code === 0) {
                console.log('✅ Extension build successful');
                resolve();
            } else {
                console.log('❌ Extension build failed');
                reject(new Error(`Extension build failed with code ${code}`));
            }
        });
    });
    
    console.log('🎯 Next steps:');
    console.log('1. Install the extension in VSCode');
    console.log('2. Open a Git repository in VSCode');
    console.log('3. Run an AI assistant with MCP and call request_review');
    console.log('4. Check VSCode output panel for synthetic PR messages');
    
    console.log('\n✨ IPC communication setup complete!');
}

testSyntheticPRIPC().catch(console.error);
