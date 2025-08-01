// 💡: Shared utilities for setup scripts
// Contains common functionality used by both setup.js and setup-dev.js

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

function buildServer() {
  console.log('📦 Building Rust MCP server...');
  const serverDir = path.join(ROOT_DIR, 'server-rs');

  // Check if Rust is installed
  if (!run('cargo --version', { cwd: serverDir, quiet: true })) {
    console.error('❌ Rust/Cargo not found. Please install Rust from https://rustup.rs/');
    process.exit(1);
  }

  console.log('🔨 Building Rust server in release mode...');
  if (!run('cargo build --release', { cwd: serverDir })) {
    console.error('Failed to build Rust server');
    process.exit(1);
  }

  console.log('✅ Rust MCP server built successfully');
  return serverDir;
}

function buildExtension(mode = 'production') {
  console.log(`\n📦 Building VSCode extension${mode === 'development' ? ' (development mode)' : ''}...`);
  const extensionDir = path.join(ROOT_DIR, 'extension');

  if (!run('npm install', { cwd: extensionDir })) {
    console.error('Failed to install extension dependencies');
    process.exit(1);
  }

  const buildCommand = mode === 'development' ? 'npm run webpack-dev' : 'npm run webpack';
  if (!run(buildCommand, { cwd: extensionDir })) {
    console.error(`Failed to build extension with ${buildCommand}`);
    process.exit(1);
  }

  return extensionDir;
}

function packageAndInstallExtension(extensionDir, buildType = '') {
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

  console.log(`\n📥 Installing VSCode extension${buildType ? ` (${buildType})` : ''}...`);
  if (!run(`code --install-extension ${vsixFile}`, { cwd: extensionDir })) {
    console.error('Failed to install VSCode extension');
    console.error('Make sure VSCode is installed and the "code" command is available');
    process.exit(1);
  }
}

function configureAIAssistants() {
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
    if (run('q mcp add --name dialectic --command dialectic-mcp-server')) {
      console.log('✅ Q CLI configured successfully!');
    } else {
      console.error('❌ Failed to configure Q CLI automatically');
      console.log('You can manually add the MCP server with:');
      console.log('  q mcp add --name dialectic --command dialectic-mcp-server');
    }
  }

  return { hasClaude, hasQCli };
}

module.exports = {
  ROOT_DIR,
  run,
  runQuiet,
  checkClaude,
  checkQCli,
  buildServer,
  buildExtension,
  packageAndInstallExtension,
  configureAIAssistants
};