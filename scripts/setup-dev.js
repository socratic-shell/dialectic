#!/usr/bin/env node

// 💡: Development setup script that creates symlinks for faster iteration
// Uses shared utilities from setup-common.js

const path = require('path');
const {
  ROOT_DIR,
  run,
  buildServer,
  buildExtension,
  packageAndInstallExtension
} = require('./setup-common');

function main() {
  console.log('🚀 Setting up Dialectic for development (symlink mode)...\n');
  console.log('⚠️  This will overwrite any existing Dialectic installation\n');

  // Step 1: Build server and link for development
  const serverDir = buildServer();
  
  // Use npm link instead of install -g for development
  console.log('\n🔗 Linking MCP server for development...');
  if (!run('npm link', { cwd: serverDir })) {
    console.error('Failed to link MCP server');
    console.error('You may need to use sudo or configure npm permissions');
    process.exit(1);
  }

  // Step 2: Build extension in development mode and install
  const extensionDir = buildExtension('development');
  packageAndInstallExtension(extensionDir, 'dev build');

  // Success message
  console.log('\n✅ Development setup complete!\n');

  console.log('📋 Development workflow:');
  console.log('1. Make changes to the code');
  console.log('2. For server changes: npm run build:server');
  console.log('3. For extension changes: npm run build:extension && npm run setup-dev');
  console.log('4. Reload VSCode window (Cmd/Ctrl + R) instead of restarting');
  console.log('\n⚠️  Note: The extension still needs to be reinstalled, but you can use window reload instead of full restart');
}

if (require.main === module) {
  main();
}