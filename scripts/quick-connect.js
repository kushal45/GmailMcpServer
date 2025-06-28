#!/usr/bin/env node

/**
 * Quick Connect Helper for MCP Inspector
 * 
 * This script provides the exact steps to connect your MCP Inspector to the Gmail MCP server
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class QuickConnectHelper {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.tokenFile = path.join(this.projectRoot, '.inspector-session-token');
  }

  async showConnectionSteps() {
    console.log('🔗 MCP Inspector Quick Connect Guide\n');

    // Get current session info
    const sessionInfo = this.getSessionInfo();
    
    if (!sessionInfo) {
      console.log('❌ No session token found. Please start the robust inspector first:');
      console.log('   npm run inspector:robust\n');
      return;
    }

    console.log('✅ Session token found!\n');
    
    // Show current status
    this.showCurrentStatus(sessionInfo);
    
    // Show connection steps
    this.showDetailedSteps(sessionInfo);
    
    // Show troubleshooting
    this.showTroubleshooting();
  }

  getSessionInfo() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        return JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
      }
    } catch (error) {
      console.log('⚠️  Could not read session token file');
    }
    return null;
  }

  showCurrentStatus(sessionInfo) {
    console.log('📊 **Current Session Status:**');
    console.log(`   Token: ${sessionInfo.token}`);
    console.log(`   Created: ${new Date(sessionInfo.created).toLocaleString()}`);
    console.log(`   Inspector Port: ${sessionInfo.port}`);
    console.log(`   Proxy Port: ${sessionInfo.proxyPort}`);
    console.log('');
  }

  showDetailedSteps(sessionInfo) {
    console.log('🎯 **Step-by-Step Connection Guide:**\n');
    
    console.log('**Step 1: Open Inspector URL**');
    console.log(`   ${sessionInfo.url}`);
    console.log('   (Copy and paste this URL into your browser)\n');
    
    console.log('**Step 2: Configure Connection in Inspector UI**');
    console.log('   In the left panel, you should see:');
    console.log('   ┌─────────────────────────────┐');
    console.log('   │ Transport Type: [STDIO    ▼]│');
    console.log('   │ Command: [node            ] │');
    console.log('   │ Arguments: [build/index.js] │');
    console.log('   │ [▶ Connect]                 │');
    console.log('   └─────────────────────────────┘\n');
    
    console.log('**Step 3: Fill in the Configuration**');
    console.log('   • Transport Type: Select "STDIO"');
    console.log('   • Command: Type "node"');
    console.log('   • Arguments: Type "build/index.js"');
    console.log('   • Leave Environment Variables empty (unless needed)\n');
    
    console.log('**Step 4: Click Connect**');
    console.log('   • Click the "Connect" button');
    console.log('   • Wait for connection to establish');
    console.log('   • You should see tools appear in the interface\n');
    
    console.log('**Step 5: Verify Connection**');
    console.log('   You should see:');
    console.log('   • 32 tools listed (authenticate, search_emails, etc.)');
    console.log('   • Resources section populated');
    console.log('   • "Connected" status indicator');
    console.log('');
  }

  showTroubleshooting() {
    console.log('🔧 **Troubleshooting:**\n');
    
    console.log('**If you see "Connection Error":**');
    console.log('   1. Make sure the Inspector is running:');
    console.log('      npm run inspector:robust');
    console.log('   2. Verify the build exists:');
    console.log('      ls -la build/index.js');
    console.log('   3. Test the server manually:');
    console.log('      node build/index.js');
    console.log('      (Should wait for input - press Ctrl+C to exit)\n');
    
    console.log('**If the URL doesn\'t work:**');
    console.log('   1. Remove any #fragments from the URL');
    console.log('   2. Try without the token first: http://localhost:6274');
    console.log('   3. Check if inspector is running on the correct port\n');
    
    console.log('**If connection times out:**');
    console.log('   1. Check that build/index.js exists and is executable');
    console.log('   2. Try using full node path:');
    console.log('      /Users/macbook/.nvm/versions/node/v20.19.2/bin/node');
    console.log('   3. Restart the inspector: npm run inspector:robust\n');
    
    console.log('**Common Configuration Issues:**');
    console.log('   ❌ Command: "npm run start" (wrong)');
    console.log('   ✅ Command: "node" (correct)');
    console.log('   ❌ Arguments: "start" (wrong)');
    console.log('   ✅ Arguments: "build/index.js" (correct)\n');
  }

  async testConnection() {
    console.log('🧪 **Testing MCP Server Connection...**\n');
    
    const { spawn } = await import('child_process');
    
    return new Promise((resolve) => {
      console.log('Starting MCP server test...');
      
      const server = spawn('node', ['build/index.js'], {
        cwd: this.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      
      server.stdout.on('data', (data) => {
        output += data.toString();
      });

      server.stderr.on('data', (data) => {
        output += data.toString();
      });

      // Send a test message
      setTimeout(() => {
        const testMessage = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0.0" }
          }
        }) + '\n';
        
        server.stdin.write(testMessage);
      }, 1000);

      // Check response
      setTimeout(() => {
        server.kill('SIGTERM');
        
        if (output.includes('"result"') && output.includes('gmail-mcp-server')) {
          console.log('✅ MCP server is working correctly!');
          console.log('   The server responds to JSON-RPC messages properly.');
        } else {
          console.log('⚠️  MCP server test inconclusive.');
          console.log('   Output:', output.substring(0, 200) + '...');
        }
        
        resolve();
      }, 3000);
    });
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const helper = new QuickConnectHelper();
  
  const args = process.argv.slice(2);
  
  if (args.includes('--test')) {
    helper.testConnection().then(() => {
      console.log('\n🎯 Use the connection steps above to connect in the Inspector UI.');
    });
  } else {
    helper.showConnectionSteps();
  }
}

export default QuickConnectHelper;
