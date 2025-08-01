#!/usr/bin/env node

// 💡: Development setup script that creates symlinks for faster iteration
// Uses shared utilities from setup-common.js

const path = require('path');
const {
  ROOT_DIR,
  run,
  buildServer,
  buildExtension,
  packageAndInstallExtension,
  configureAIAssistants
} = require('./setup-common');

function main() {
  console.log('🚀 Setting up Dialectic for development...\n');
  console.log('⚠️  This will overwrite any existing Dialectic installation\n');

  // Step 1: Build Rust server for development
  const serverDir = buildServer();
  
  // For development, we'll install the Rust binary globally but note it's for dev
  console.log('\n🔗 Installing Rust MCP server for development...');
  console.log('📝 Note: Development mode installs the binary globally (same as production)');
  console.log('   For true development workflow, run the binary directly from target/release/');
  
  if (!run('cargo install --path .', { cwd: serverDir })) {
    console.error('Failed to install Rust MCP server');
    console.error('Make sure Rust/Cargo is properly installed and configured');
    process.exit(1);
  }

  // Step 2: Build extension in development mode and install
  const extensionDir = buildExtension('development');
  packageAndInstallExtension(extensionDir, 'dev build');

  // Step 3: Configure AI assistants if available
  const { hasClaude, hasQCli } = configureAIAssistants();

  // Success message
  console.log('\n✅ Development setup complete!\n');

  console.log('🦀 Rust MCP server installed globally as: dialectic-mcp-server');
  console.log('📋 Development workflow:');
  console.log('1. Make changes to the code');
  console.log('2. For server changes: cd server-rs && cargo build --release');
  console.log('3. For extension changes: npm run build:extension && npm run setup-dev');
  console.log('4. Reload VSCode window (Cmd/Ctrl + R) instead of restarting');

  const configured = [];
  if (hasClaude) configured.push('Claude CLI');
  if (hasQCli) configured.push('Q CLI');

  if (configured.length > 0) {
    console.log(`\n🤖 ${configured.join(' and ')} configured - you can start using Dialectic!`);
  } else {
    console.log('\n🤖 Configure your AI assistant:');
    console.log('   For Claude CLI: claude mcp add dialectic dialectic-mcp-server');
    console.log('   For Q CLI: q mcp add --global --name dialectic --command dialectic-mcp-server');
  }

  console.log('\n⚠️  Note: The extension still needs to be reinstalled, but you can use window reload instead of full restart');
}

if (require.main === module) {
  main();
}