#!/usr/bin/env node

/**
 * MCP Inspector Configuration Helper
 * 
 * This script helps configure the MCP Inspector to properly connect to your Gmail MCP server
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MCPInspectorConfigurator {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
  }

  async configure() {
    console.log('🔧 Configuring MCP Inspector for Gmail MCP Server...\n');

    // Step 1: Show current configuration
    this.showConfiguration();

    // Step 2: Provide connection instructions
    this.showConnectionInstructions();

    // Step 3: Start inspector with proper configuration
    await this.startConfiguredInspector();
  }

  showConfiguration() {
    console.log('📋 **MCP Server Configuration:**');
    console.log('');
    console.log('   Transport Type: STDIO');
    console.log('   Command: node');
    console.log('   Arguments: build/index.js');
    console.log('   Working Directory: ' + this.projectRoot);
    console.log('');
  }

  showConnectionInstructions() {
    console.log('🔗 **Connection Instructions:**');
    console.log('');
    console.log('1. **In the MCP Inspector UI:**');
    console.log('   - Transport Type: STDIO');
    console.log('   - Command: node');
    console.log('   - Arguments: build/index.js');
    console.log('');
    console.log('2. **Environment Variables (if needed):**');
    console.log('   - HOME: ' + process.env.HOME);
    console.log('   - PATH: (current PATH)');
    console.log('');
    console.log('3. **Click "Connect" to establish connection**');
    console.log('');
  }

  async startConfiguredInspector() {
    console.log('🚀 Starting MCP Inspector with configuration...\n');

    // Create a configuration file for the inspector
    const config = {
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['build/index.js'],
        cwd: this.projectRoot,
        env: {
          ...process.env,
          NODE_ENV: 'development'
        }
      },
      server: {
        name: 'Gmail MCP Server',
        description: 'MCP server for Gmail integration'
      }
    };

    // Save configuration
    const configPath = path.join(this.projectRoot, '.mcp-inspector-config.json');
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`💾 Configuration saved to: ${configPath}`);

    // Start the inspector
    console.log('🔄 Starting MCP Inspector...');
    
    const inspector = spawn('npx', ['@modelcontextprotocol/inspector', 'node', 'build/index.js'], {
      cwd: this.projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        MCP_INSPECTOR_AUTO_CONNECT: 'true'
      }
    });

    inspector.on('exit', (code) => {
      console.log(`\n📊 Inspector exited with code: ${code}`);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n🛑 Shutting down inspector...');
      inspector.kill('SIGTERM');
      process.exit(0);
    });

    return new Promise((resolve) => {
      inspector.on('exit', resolve);
    });
  }
}

// Helper function to show manual connection steps
function showManualConnectionSteps() {
  console.log('\n' + '='.repeat(80));
  console.log('📖 MANUAL CONNECTION STEPS');
  console.log('='.repeat(80));
  console.log('');
  console.log('If the automatic connection doesn\'t work, follow these steps:');
  console.log('');
  console.log('1. **Open MCP Inspector in your browser**');
  console.log('   - The inspector should open automatically');
  console.log('   - Or go to: http://localhost:6274');
  console.log('');
  console.log('2. **Configure Connection:**');
  console.log('   - Transport Type: STDIO');
  console.log('   - Command: node');
  console.log('   - Arguments: build/index.js');
  console.log('');
  console.log('3. **Environment Variables (expand section):**');
  console.log('   - Add any required environment variables');
  console.log('   - Usually not needed for basic setup');
  console.log('');
  console.log('4. **Click "Connect"**');
  console.log('   - This will start your Gmail MCP server');
  console.log('   - You should see tools and resources appear');
  console.log('');
  console.log('5. **Verify Connection:**');
  console.log('   - Check that tools are listed (authenticate, search_emails, etc.)');
  console.log('   - Try calling a tool like "get_system_health"');
  console.log('');
  console.log('🔧 **Troubleshooting:**');
  console.log('   - If connection fails, check the console for errors');
  console.log('   - Ensure build/index.js exists and is executable');
  console.log('   - Try running: npm run build');
  console.log('');
  console.log('='.repeat(80));
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const configurator = new MCPInspectorConfigurator();
  
  // Show manual steps first
  showManualConnectionSteps();
  
  // Ask user if they want to start the inspector
  console.log('\n🤔 Would you like to start the MCP Inspector now?');
  console.log('   Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
  
  setTimeout(async () => {
    try {
      await configurator.configure();
    } catch (error) {
      console.error('❌ Configuration failed:', error);
      process.exit(1);
    }
  }, 5000);
}

export default MCPInspectorConfigurator;
