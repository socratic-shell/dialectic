#!/usr/bin/env node

// 💡: Setup script for local development
// Builds and installs both components as self-contained packages

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT_DIR = path.join(__dirname, '..');

function run(command, options = {}) {
  console.log(`Running: ${command}`);
  try {
    execSync(command, { stdio: 'inherit', ...options });
    return true;
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    console.error(error.message);
    return false;
  }
}

function runQuiet(command, options = {}) {
  try {
    const result = execSync(command, { stdio: 'pipe', ...options });
    return { success: true, output: result.toString().trim() };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function checkClaude() {
  const claudeDir = path.join(os.homedir(), '.claude');
  if (fs.existsSync(claudeDir)) {
    console.log(`📋 Detected Claude CLI installation at: ${claudeDir}`);
    const result = runQuiet('claude --version');
    if (result.success) {
      console.log(`   Claude CLI version: ${result.output}`);
    }
    return true;
  }
  return false;
}

function checkQCli() {
  const result = runQuiet('q --version');
  if (result.success) {
    console.log(`📋 Detected Q CLI: ${result.output}`);
    return true;
  }
  return false;
}

function main() {
  console.log('🚀 Setting up Dialectic for development...\n');

  // Step 1: Install and build server
  console.log('📦 Building MCP server...');
  const serverDir = path.join(ROOT_DIR, 'server');

  if (!run('npm install', { cwd: serverDir })) {
    console.error('Failed to install server dependencies');
    process.exit(1);
  }

  if (!run('npm run build', { cwd: serverDir })) {
    console.error('Failed to build server');
    process.exit(1);
  }

  // Step 2: Install server globally (self-contained)
  console.log('\n📥 Installing MCP server globally...');
  if (!run('npm install -g .', { cwd: serverDir })) {
    console.error('Failed to install MCP server globally');
    console.error('You may need to use sudo or configure npm permissions');
    process.exit(1);
  }

  // Step 3: Install and build extension
  console.log('\n📦 Building VSCode extension...');
  const extensionDir = path.join(ROOT_DIR, 'extension');

  if (!run('npm install', { cwd: extensionDir })) {
    console.error('Failed to install extension dependencies');
    process.exit(1);
  }

  if (!run('npm run webpack', { cwd: extensionDir })) {
    console.error('Failed to build extension with webpack');
    process.exit(1);
  }

  // Step 4: Package and install extension
  console.log('\n📦 Packaging VSCode extension...');
  if (!run('npx vsce package --no-dependencies', { cwd: extensionDir })) {
    console.error('Failed to package VSCode extension');
    process.exit(1);
  }

  // Find the generated .vsix file
  const vsixFiles = fs.readdirSync(extensionDir).filter(f => f.endsWith('.vsix'));
  if (vsixFiles.length === 0) {
    console.error('No .vsix file generated');
    process.exit(1);
  }
  const vsixFile = vsixFiles[0];

  console.log('\n📥 Installing VSCode extension...');
  if (!run(`code --install-extension ${vsixFile}`, { cwd: extensionDir })) {
    console.error('Failed to install VSCode extension');
    console.error('Make sure VSCode is installed and the "code" command is available');
    process.exit(1);
  }

  // Step 5: Configure AI assistants if available
  const hasClaude = checkClaude();
  if (hasClaude) {
    console.log('\n⚙️  Configuring Claude CLI...');
    if (run('claude mcp add --scope user dialectic dialectic-mcp-server')) {
      console.log('✅ Claude CLI configured successfully!');
    } else {
      console.error('❌ Failed to configure Claude CLI automatically');
      console.log('You can manually add the MCP server with:');
      console.log('  claude mcp add dialectic dialectic-mcp-server');
    }
  }

  const hasQCli = checkQCli();
  if (hasQCli) {
    console.log('\n⚙️  Configuring Q CLI...');
    if (run('q mcp add --global --name dialectic --command dialectic-mcp-server')) {
      console.log('✅ Q CLI configured successfully!');
    } else {
      console.error('❌ Failed to configure Q CLI automatically');
      console.log('You can manually add the MCP server with:');
      console.log('  q mcp add --name dialectic --command dialectic-mcp-server');
    }
  }

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