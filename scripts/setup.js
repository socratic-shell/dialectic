#!/usr/bin/env node

// 💡: Setup script that installs production versions globally
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
  console.log('🚀 Setting up Dialectic for production...\n');

  // Step 1: Build Rust server
  const serverDir = buildServer();

  console.log('\n📥 Installing Rust MCP server globally...');
  // For Rust, we use cargo install to build and install globally
  if (!run('cargo install --path .', { cwd: serverDir })) {
    console.error('Failed to install Rust MCP server globally');
    console.error('Make sure Rust/Cargo is properly installed and configured');
    process.exit(1);
  }

  // Step 2: Build and install extension  
  const extensionDir = buildExtension('production');
  packageAndInstallExtension(extensionDir);

  // Step 3: Configure AI assistants if available
  const { hasClaude, hasQCli } = configureAIAssistants();

  // Success message
  console.log('\n✅ Setup complete!\n');

  console.log('🦀 Rust MCP server installed globally as: dialectic-mcp-server');
  console.log('📋 Next steps:');
  console.log('1. Restart VSCode to activate the extension');

  const configured = [];
  if (hasClaude) configured.push('Claude CLI');
  if (hasQCli) configured.push('Q CLI');

  if (configured.length > 0) {
    console.log(`2. ${configured.join(' and ')} configured - you can start using Dialectic!`);
  } else {
    console.log('2. Configure your AI assistant:');
    console.log('   For Claude CLI: claude mcp add dialectic dialectic-mcp-server');
    console.log('   For Q CLI: q mcp add --name dialectic --command dialectic-mcp-server --force');
  }

  console.log('\n3. Test by asking your AI assistant to present a code review');
  console.log('\n📝 Note: The installed components are self-contained and independent of this directory.');
}

if (require.main === module) {
  main();
}