#!/usr/bin/env node

/**
 * MCP Connection Tester
 * 
 * This script tests the connection between the MCP Inspector and your MCP server
 * to diagnose and fix connection issues.
 */

import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MCPConnectionTester {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.serverProcess = null;
    this.inspectorProcess = null;
  }

  async test() {
    console.log('🔍 Testing MCP Server Connection...\n');

    try {
      // Step 1: Verify build
      await this.verifyBuild();
      
      // Step 2: Test server startup
      await this.testServerStartup();
      
      // Step 3: Test inspector connection
      await this.testInspectorConnection();
      
      console.log('\n✅ All tests passed! MCP connection should work.');
      
    } catch (error) {
      console.error('\n❌ Connection test failed:', error.message);
      await this.provideSolution(error);
    } finally {
      await this.cleanup();
    }
  }

  async verifyBuild() {
    console.log('📦 Verifying build...');
    
    const buildPath = path.join(this.projectRoot, 'build', 'index.js');
    if (!fs.existsSync(buildPath)) {
      console.log('⚠️  Build not found, building project...');
      await this.execCommand('npm run build');
      console.log('✅ Project built successfully');
    } else {
      console.log('✅ Build verified');
    }
  }

  async testServerStartup() {
    console.log('\n🚀 Testing MCP server startup...');
    
    return new Promise((resolve, reject) => {
      this.serverProcess = spawn('node', ['build/index.js'], {
        cwd: this.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let hasStarted = false;

      const timeout = setTimeout(() => {
        if (!hasStarted) {
          reject(new Error('Server startup timeout - server may not be starting properly'));
        }
      }, 10000);

      this.serverProcess.stdout.on('data', (data) => {
        output += data.toString();
        console.log('📝 Server output:', data.toString().trim());
        
        // Check for successful startup indicators
        if (output.includes('Gmail MCP server connected') || 
            output.includes('Server started') ||
            output.includes('listening') ||
            output.includes('ready')) {
          hasStarted = true;
          clearTimeout(timeout);
          console.log('✅ MCP server started successfully');
          resolve();
        }
      });

      this.serverProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.log('⚠️  Server stderr:', errorOutput.trim());
        
        // Check for critical errors
        if (errorOutput.includes('Error:') || errorOutput.includes('EADDRINUSE')) {
          clearTimeout(timeout);
          reject(new Error(`Server startup error: ${errorOutput}`));
        }
      });

      this.serverProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && !hasStarted) {
          reject(new Error(`Server exited with code ${code} before startup completed`));
        }
      });

      // Send a test message to see if server responds
      setTimeout(() => {
        if (this.serverProcess && !this.serverProcess.killed) {
          try {
            // Send a simple JSON-RPC message to test connectivity
            const testMessage = JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "connection-tester", version: "1.0.0" }
              }
            }) + '\n';
            
            this.serverProcess.stdin.write(testMessage);
          } catch (error) {
            console.log('ℹ️  Could not send test message:', error.message);
          }
        }
      }, 2000);
    });
  }

  async testInspectorConnection() {
    console.log('\n🔗 Testing Inspector connection...');
    
    // Kill the server process since inspector will start its own
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      await this.sleep(1000);
    }

    return new Promise((resolve, reject) => {
      this.inspectorProcess = spawn('npm', ['run', 'inspector'], {
        cwd: this.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let hasConnected = false;

      const timeout = setTimeout(() => {
        if (!hasConnected) {
          reject(new Error('Inspector connection timeout - could not establish connection to MCP server'));
        }
      }, 15000);

      this.inspectorProcess.stdout.on('data', (data) => {
        output += data.toString();
        console.log('📝 Inspector output:', data.toString().trim());
        
        // Check for successful connection
        if (output.includes('MCP Inspector is up and running') ||
            output.includes('Created server transport') ||
            output.includes('Connected to MCP server')) {
          hasConnected = true;
          clearTimeout(timeout);
          console.log('✅ Inspector connected to MCP server successfully');
          resolve();
        }
      });

      this.inspectorProcess.stderr.on('data', (data) => {
        const errorOutput = data.toString();
        console.log('⚠️  Inspector stderr:', errorOutput.trim());
        
        // Check for connection errors
        if (errorOutput.includes('Connection Error') || 
            errorOutput.includes('ECONNREFUSED') ||
            errorOutput.includes('proxy token is correct')) {
          clearTimeout(timeout);
          reject(new Error(`Inspector connection error: ${errorOutput}`));
        }
      });

      this.inspectorProcess.on('exit', (code) => {
        clearTimeout(timeout);
        if (code !== 0 && !hasConnected) {
          reject(new Error(`Inspector exited with code ${code} before connection established`));
        }
      });
    });
  }

  async provideSolution(error) {
    console.log('\n🔧 Providing solution based on error...\n');
    
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes('timeout') || errorMessage.includes('connection')) {
      console.log('💡 **Connection Issue Solutions:**');
      console.log('');
      console.log('1. **Use the Robust Inspector (Recommended):**');
      console.log('   npm run inspector:robust');
      console.log('');
      console.log('2. **Manual Steps:**');
      console.log('   a) Clean up processes: npm run inspector:cleanup');
      console.log('   b) Build project: npm run build');
      console.log('   c) Start robust inspector: npm run inspector:robust');
      console.log('');
      console.log('3. **Check for port conflicts:**');
      console.log('   lsof -i :6274');
      console.log('   lsof -i :6277');
      console.log('');
      console.log('4. **Verify MCP server configuration:**');
      console.log('   - Check that build/index.js exists and is executable');
      console.log('   - Verify no syntax errors in the server code');
      console.log('   - Ensure all dependencies are installed');
    }
    
    if (errorMessage.includes('build') || errorMessage.includes('module')) {
      console.log('💡 **Build Issue Solutions:**');
      console.log('');
      console.log('1. **Rebuild the project:**');
      console.log('   npm run build');
      console.log('');
      console.log('2. **Check for TypeScript errors:**');
      console.log('   npx tsc --noEmit');
      console.log('');
      console.log('3. **Reinstall dependencies:**');
      console.log('   npm install');
    }
    
    if (errorMessage.includes('port') || errorMessage.includes('eaddrinuse')) {
      console.log('💡 **Port Conflict Solutions:**');
      console.log('');
      console.log('1. **Kill processes using the ports:**');
      console.log('   ./scripts/cleanup-inspector.sh');
      console.log('');
      console.log('2. **Use different ports:**');
      console.log('   node scripts/robust-inspector.js --port 6275 --proxy-port 6278');
    }
    
    console.log('\n🎯 **Quick Fix Command:**');
    console.log('npm run inspector:robust');
    console.log('');
    console.log('This will automatically handle most connection issues.');
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test processes...');
    
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
    }
    
    if (this.inspectorProcess) {
      this.inspectorProcess.kill('SIGTERM');
    }
    
    // Wait for processes to exit
    await this.sleep(1000);
    
    console.log('✅ Cleanup completed');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  execCommand(command) {
    return new Promise((resolve, reject) => {
      exec(command, { cwd: this.projectRoot }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new MCPConnectionTester();
  tester.test().catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

export default MCPConnectionTester;
