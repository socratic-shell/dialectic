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
  console.log('🚀 Setting up Dialectic for development...\n');

  // Step 1: Build server and install globally (self-contained)
  const serverDir = buildServer();

  console.log('\n📥 Installing MCP server globally...');
  if (!run('npm install -g .', { cwd: serverDir })) {
    console.error('Failed to install MCP server globally');
    console.error('You may need to use sudo or configure npm permissions');
    process.exit(1);
  }

  // Step 2: Build and install extension  
  const extensionDir = buildExtension('production');
  packageAndInstallExtension(extensionDir);

  // Step 3: Configure AI assistants if available
  const { hasClaude, hasQCli } = configureAIAssistants();

  // Success message
  console.log('\n✅ Setup complete!\n');

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
    console.log('   For Q CLI: q mcp add --name dialectic --command dialectic-mcp-server');
  }

  console.log('\n3. Test by asking your AI assistant to present a code review');
  console.log('\n📝 Note: The installed components are self-contained and independent of this directory.');
}

if (require.main === module) {
  main();
}