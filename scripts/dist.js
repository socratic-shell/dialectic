#!/usr/bin/env node

// 💡: Using Node.js script instead of shell script for cross-platform compatibility
// This script builds both components and creates a distribution directory

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

function run(command, cwd = ROOT_DIR) {
  console.log(`Running: ${command} (in ${cwd})`);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    process.exit(1);
  }
}

function main() {
  console.log('🏗️  Building Dialectic distribution...\n');

  // Clean and create dist directory
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR);

  // Build both components
  console.log('📦 Building server...');
  run('npm run build', path.join(ROOT_DIR, 'server'));

  console.log('📦 Building extension...');
  run('npm run compile', path.join(ROOT_DIR, 'extension'));

  // Package server as tarball
  console.log('📦 Packaging server...');
  run('npm pack', path.join(ROOT_DIR, 'server'));
  
  // Move server tarball to dist
  const serverTarball = fs.readdirSync(path.join(ROOT_DIR, 'server'))
    .find(file => file.endsWith('.tgz'));
  if (serverTarball) {
    fs.renameSync(
      path.join(ROOT_DIR, 'server', serverTarball),
      path.join(DIST_DIR, serverTarball)
    );
  }

  // Package extension as VSIX
  console.log('📦 Packaging extension...');
  run('npx vsce package --out ../dist/', path.join(ROOT_DIR, 'extension'));

  // Create install script
  console.log('📝 Creating install script...');
  createInstallScript();

  // Create README
  console.log('📝 Creating distribution README...');
  createDistributionReadme();

  console.log('\n✅ Distribution created in dist/');
  console.log('📁 Contents:');
  fs.readdirSync(DIST_DIR).forEach(file => {
    console.log(`   ${file}`);
  });
}

function createInstallScript() {
  const installScript = `#!/usr/bin/env node

// 💡: Install script for Dialectic distribution
// Handles both VSCode extension and MCP server installation

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function run(command, options = {}) {
  console.log(\`Running: \${command}\`);
  try {
    execSync(command, { stdio: 'inherit', ...options });
    return true;
  } catch (error) {
    console.error(\`❌ Command failed: \${command}\`);
    console.error(error.message);
    return false;
  }
}

function findFile(pattern) {
  const files = fs.readdirSync(__dirname);
  return files.find(file => file.match(pattern));
}

function main() {
  console.log('🚀 Installing Dialectic...');
  
  // Find the packaged files
  const vsixFile = findFile(/dialectic.*\\.vsix$/);
  const tgzFile = findFile(/dialectic-mcp-server.*\\.tgz$/);
  
  if (!vsixFile) {
    console.error('❌ VSCode extension (.vsix) file not found');
    process.exit(1);
  }
  
  if (!tgzFile) {
    console.error('❌ MCP server (.tgz) file not found');
    process.exit(1);
  }
  
  console.log(\`📦 Found extension: \${vsixFile}\`);
  console.log(\`📦 Found server: \${tgzFile}\`);
  
  // Install VSCode extension
  console.log('\\n📥 Installing VSCode extension...');
  if (!run(\`code --install-extension \${vsixFile}\`)) {
    console.error('❌ Failed to install VSCode extension');
    console.error('Make sure VSCode is installed and the "code" command is available');
    process.exit(1);
  }
  
  // Install MCP server globally
  console.log('\\n📥 Installing MCP server...');
  if (!run(\`npm install -g \${tgzFile}\`)) {
    console.error('❌ Failed to install MCP server');
    console.error('Make sure Node.js and npm are installed');
    process.exit(1);
  }
  
  console.log('\\n✅ Installation complete!');
  console.log('\\n📋 Next steps:');
  console.log('1. Restart VSCode to activate the extension');
  console.log('2. Add this to your Q CLI MCP configuration:');
  console.log('');
  console.log('   {');
  console.log('     "mcpServers": {');
  console.log('       "dialectic": {');
  console.log('         "command": "dialectic-mcp-server",');
  console.log('         "args": []');
  console.log('       }');
  console.log('     }');
  console.log('   }');
  console.log('');
  console.log('3. Test by asking your AI assistant to present a code review');
}

if (require.main === module) {
  main();
}
`;

  fs.writeFileSync(path.join(DIST_DIR, 'install.js'), installScript);
  fs.chmodSync(path.join(DIST_DIR, 'install.js'), 0o755);
}

function createDistributionReadme() {
  const readme = `# Dialectic Distribution

This directory contains a complete Dialectic installation package.

## Quick Install

\`\`\`bash
node install.js
\`\`\`

This will install both the VSCode extension and MCP server.

## Contents

- \`dialectic-*.vsix\` - VSCode extension package
- \`dialectic-mcp-server-*.tgz\` - MCP server package  
- \`install.js\` - Installation script
- \`README.md\` - This file

## Manual Installation

If the install script doesn't work, you can install manually:

### VSCode Extension
\`\`\`bash
code --install-extension dialectic-*.vsix
\`\`\`

### MCP Server
\`\`\`bash
npm install -g dialectic-mcp-server-*.tgz
\`\`\`

## Configuration

Add to your Q CLI MCP configuration:

\`\`\`json
{
  "mcpServers": {
    "dialectic": {
      "command": "dialectic-mcp-server",
      "args": []
    }
  }
}
\`\`\`

## Support

For issues and documentation, see: https://github.com/socratic-shell/dialectic
`;

  fs.writeFileSync(path.join(DIST_DIR, 'README.md'), readme);
}

if (require.main === module) {
  main();
}
