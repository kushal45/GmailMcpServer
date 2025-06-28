#!/usr/bin/env node

/**
 * Robust MCP Inspector Launcher
 * 
 * This script provides a more stable way to run the MCP Inspector
 * with automatic recovery from SSE connection issues.
 * 
 * Usage:
 *   node scripts/robust-inspector.js [options]
 * 
 * Options:
 *   --port PORT       Inspector port (default: 6274)
 *   --proxy-port PORT Proxy port (default: 6277)
 *   --auto-restart    Automatically restart on crashes
 *   --max-restarts N  Maximum restart attempts (default: 5)
 *   --restart-delay N Delay between restarts in ms (default: 2000)
 */

import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class RobustInspectorLauncher {
  constructor(options = {}) {
    this.options = {
      port: 6274,
      proxyPort: 6277,
      autoRestart: true,
      maxRestarts: 5,
      restartDelay: 2000,
      ...options
    };

    this.restartCount = 0;
    this.isRunning = false;
    this.process = null;
    this.projectRoot = path.resolve(__dirname, '..');
    this.sessionToken = null; // Store session token for reuse
    this.inspectorUrl = null; // Store the complete URL
    this.tokenFile = path.join(this.projectRoot, '.inspector-session-token');
  }

  async launch() {
    console.log('🚀 Starting Robust MCP Inspector...');
    console.log(`   Port: ${this.options.port}`);
    console.log(`   Proxy Port: ${this.options.proxyPort}`);
    console.log(`   Auto-restart: ${this.options.autoRestart}`);
    console.log(`   Max restarts: ${this.options.maxRestarts}`);

    // Load existing session token if available
    await this.loadSessionToken();

    // Ensure project is built
    await this.ensureBuilt();

    // Clean up any existing processes
    await this.cleanup();

    // Start the inspector
    await this.startInspector();

    // Setup signal handlers
    this.setupSignalHandlers();
  }

  async ensureBuilt() {
    const buildPath = path.join(this.projectRoot, 'build', 'index.js');
    if (!fs.existsSync(buildPath)) {
      console.log('📦 Building project...');
      await this.execCommand('npm run build');
    }
  }

  async cleanup() {
    console.log('🧹 Cleaning up existing processes...');

    try {
      // Kill any existing inspector processes
      await this.execCommand('pkill -f "mcp.*inspector" || true');
      await this.execCommand('pkill -f "inspector.*mcp" || true');
      await this.execCommand('pkill -f "gmail-mcp-server" || true');
      await this.execCommand('pkill -f "build/index.js" || true');
      await this.execCommand('pkill -f "npx.*inspector" || true');

      // Kill any processes using the ports
      await this.execCommand(`lsof -ti:${this.options.port} | xargs kill -9 2>/dev/null || true`);
      await this.execCommand(`lsof -ti:${this.options.proxyPort} | xargs kill -9 2>/dev/null || true`);

      // Wait for cleanup
      await this.sleep(2000);

      // Verify ports are free
      await this.verifyPortsAreFree();

    } catch (error) {
      console.log('⚠️  Cleanup completed with warnings:', error.message);
    }
  }

  async verifyPortsAreFree() {
    try {
      const { stdout: port1 } = await this.execCommand(`lsof -i:${this.options.port} || echo "free"`);
      const { stdout: port2 } = await this.execCommand(`lsof -i:${this.options.proxyPort} || echo "free"`);

      if (port1.includes('free')) {
        console.log(`✅ Port ${this.options.port} is free`);
      } else {
        console.log(`⚠️  Port ${this.options.port} still in use, forcing cleanup...`);
        await this.execCommand(`lsof -ti:${this.options.port} | xargs kill -9 2>/dev/null || true`);
      }

      if (port2.includes('free')) {
        console.log(`✅ Port ${this.options.proxyPort} is free`);
      } else {
        console.log(`⚠️  Port ${this.options.proxyPort} still in use, forcing cleanup...`);
        await this.execCommand(`lsof -ti:${this.options.proxyPort} | xargs kill -9 2>/dev/null || true`);
      }
    } catch (error) {
      console.log('ℹ️  Port verification completed with warnings');
    }
  }

  async startInspector() {
    return new Promise((resolve, reject) => {
      console.log('🔄 Starting MCP Inspector...');
      
      const args = ['run', 'inspector'];
      const env = {
        ...process.env,
        MCP_INSPECTOR_PORT: this.options.port.toString(),
        MCP_PROXY_PORT: this.options.proxyPort.toString(),
        NODE_OPTIONS: '--max-old-space-size=2048'
      };

      // Log session token info
      if (this.sessionToken) {
        console.log(`🔄 Will reuse session token: ${this.sessionToken}`);
      } else {
        console.log(`🆕 Will capture new session token for persistence`);
      }

      this.process = spawn('npm', args, {
        cwd: this.projectRoot,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });

      this.isRunning = true;
      let startupComplete = false;

      // Handle stdout
      this.process.stdout.on('data', (data) => {
        const output = data.toString();
        process.stdout.write(data);

        // Extract and store session token for reuse
        this.extractSessionToken(output);

        // Check for successful startup
        if (output.includes('MCP Inspector is up and running') ||
            output.includes('Proxy server listening')) {
          if (!startupComplete) {
            startupComplete = true;
            console.log('✅ Inspector started successfully');

            // Display persistent session info after a short delay to ensure token is captured
            setTimeout(() => {
              this.displaySessionInfo();
            }, 1000);

            resolve();
          }
        }
      });

      // Handle stderr
      this.process.stderr.on('data', (data) => {
        const output = data.toString();
        process.stderr.write(data);
        
        // Check for SSE connection issues
        if (output.includes('SSE connection closed') ||
            output.includes('Not connected')) {
          console.log('⚠️  SSE connection issue detected');
          // Handle SSE issue asynchronously to avoid blocking
          this.handleSSEIssue().catch(error => {
            console.error('❌ Error handling SSE issue:', error);
          });
        }
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        this.isRunning = false;
        console.log(`\n📊 Inspector process exited with code ${code}, signal ${signal}`);
        
        if (this.options.autoRestart && this.restartCount < this.options.maxRestarts) {
          this.scheduleRestart();
        } else {
          console.log('🛑 Maximum restart attempts reached or auto-restart disabled');
        }
      });

      // Handle process error
      this.process.on('error', (error) => {
        console.error('❌ Inspector process error:', error);
        if (!startupComplete) {
          reject(error);
        }
      });

      // Timeout for startup
      setTimeout(() => {
        if (!startupComplete) {
          console.log('⏰ Startup timeout, assuming success');
          resolve();
        }
      }, 10000);
    });
  }

  async loadSessionToken() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        const tokenData = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
        this.sessionToken = tokenData.token;
        this.inspectorUrl = tokenData.url;
        console.log(`🔄 Loaded existing session token: ${this.sessionToken}`);
        console.log(`🔗 Inspector URL: ${this.inspectorUrl}`);
      }
    } catch (error) {
      console.log('ℹ️  No existing session token found, will generate new one');
    }
  }

  async saveSessionToken() {
    try {
      const tokenData = {
        token: this.sessionToken,
        url: this.inspectorUrl,
        created: new Date().toISOString(),
        port: this.options.port,
        proxyPort: this.options.proxyPort
      };
      fs.writeFileSync(this.tokenFile, JSON.stringify(tokenData, null, 2));
      console.log(`💾 Session token saved for future use`);
    } catch (error) {
      console.log('⚠️  Could not save session token:', error.message);
    }
  }

  generateSessionToken() {
    // Generate a 64-character hex token (same format as MCP Inspector)
    return crypto.randomBytes(32).toString('hex');
  }

  displaySessionInfo() {
    if (this.sessionToken && this.inspectorUrl) {
      console.log('\n' + '='.repeat(80));
      console.log('🔗 MCP INSPECTOR CONNECTION GUIDE');
      console.log('='.repeat(80));
      console.log(`📋 Session Token: ${this.sessionToken}`);
      console.log(`🌐 Inspector URL:  ${this.inspectorUrl}`);
      console.log('');
      console.log('🎯 **STEP-BY-STEP CONNECTION:**');
      console.log('');
      console.log('1. **Open Inspector URL** (copy the URL above)');
      console.log('   ⚠️  Remove any #fragments from URL if present');
      console.log('');
      console.log('2. **Configure Connection in Inspector UI:**');
      console.log('   ┌─────────────────────────────┐');
      console.log('   │ Transport Type: [STDIO    ▼]│');
      console.log('   │ Command: [node            ] │');
      console.log('   │ Arguments: [build/index.js] │');
      console.log('   │ [▶ Connect]                 │');
      console.log('   └─────────────────────────────┘');
      console.log('');
      console.log('3. **Fill Configuration:**');
      console.log('   • Transport Type: Select "STDIO"');
      console.log('   • Command: Type "node"');
      console.log('   • Arguments: Type "build/index.js"');
      console.log('   • Environment Variables: Leave empty');
      console.log('');
      console.log('4. **Click "Connect" Button**');
      console.log('');
      console.log('5. **Verify Success:**');
      console.log('   ✅ Should see 32 tools (authenticate, search_emails, etc.)');
      console.log('   ✅ Resources section populated');
      console.log('   ✅ "Connected" status indicator');
      console.log('');
      console.log('🔧 **Troubleshooting:**');
      console.log('   • Connection Error? Run: npm run inspector:connect');
      console.log('   • URL issues? Remove #fragments from URL');
      console.log('   • Server issues? Check: node build/index.js');
      console.log('');
      console.log('✨ **Features:**');
      console.log('   • Automatic restart on SSE connection issues');
      console.log('   • Enhanced error handling and recovery');
      console.log('   • Session token preserved across restarts');
      console.log('='.repeat(80) + '\n');
    }
  }

  extractSessionToken(output) {
    // Extract session token from output
    const tokenMatch = output.match(/Session token: ([a-f0-9]{64})/);
    if (tokenMatch) {
      const detectedToken = tokenMatch[1];

      // Always use the actual token generated by the inspector for validity
      this.sessionToken = detectedToken;
      console.log(`🔑 Session token captured: ${this.sessionToken}`);
    }

    // Extract and build the inspector URL
    const urlMatch = output.match(/http:\/\/localhost:\d+\/\?MCP_PROXY_AUTH_TOKEN=([a-f0-9]{64})/);
    if (urlMatch) {
      // Use the actual valid token from the inspector (clean URL without fragments)
      this.inspectorUrl = `http://localhost:${this.options.port}/?MCP_PROXY_AUTH_TOKEN=${this.sessionToken}`;
      console.log(`🔗 Inspector URL (clean, no fragments): ${this.inspectorUrl}`);

      // Save the token for future use
      this.saveSessionToken();

      // Provide immediate connection guidance
      console.log('');
      console.log('🎯 **Ready to Connect!**');
      console.log('   1. Open the URL above in your browser');
      console.log('   2. Configure: STDIO → node → build/index.js');
      console.log('   3. Click Connect to access your Gmail MCP server');
      console.log('');
    }
  }

  async handleSSEIssue() {
    console.log('🔧 Handling SSE connection issue...');

    // Log diagnostic information
    this.logDiagnostics();

    // Perform immediate cleanup to prevent port conflicts
    await this.performEmergencyCleanup();

    // If auto-restart is enabled, restart the process
    if (this.options.autoRestart && this.restartCount < this.options.maxRestarts) {
      console.log('🔄 Restarting inspector due to SSE issue...');
      await this.restart();
    }
  }

  async performEmergencyCleanup() {
    console.log('🚨 Performing emergency cleanup...');

    try {
      // Kill the current process more aggressively
      if (this.process && !this.process.killed) {
        this.process.kill('SIGKILL');
      }

      // Clean up any zombie processes
      await this.execCommand('pkill -9 -f "inspector" || true');
      await this.execCommand('pkill -9 -f "mcp" || true');

      // Force free the ports
      await this.execCommand(`lsof -ti:${this.options.port} | xargs kill -9 2>/dev/null || true`);
      await this.execCommand(`lsof -ti:${this.options.proxyPort} | xargs kill -9 2>/dev/null || true`);

      // Wait longer for emergency cleanup
      await this.sleep(3000);

      console.log('✅ Emergency cleanup completed');
    } catch (error) {
      console.log('⚠️  Emergency cleanup had issues:', error.message);
    }
  }

  async restart() {
    if (!this.isRunning) {
      return;
    }

    console.log(`🔄 Restarting inspector (attempt ${this.restartCount + 1}/${this.options.maxRestarts})...`);

    // Kill current process more aggressively for SSE issues
    if (this.process) {
      this.process.kill('SIGTERM');

      // Force kill if needed (shorter timeout for faster recovery)
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 2000);
    }

    // Wait for process to exit
    await this.sleep(this.options.restartDelay);

    // Increment restart count
    this.restartCount++;

    // Perform thorough cleanup before restart
    await this.cleanup();

    // Additional verification before restart
    await this.verifySystemReady();

    // Start inspector
    await this.startInspector();
  }

  async verifySystemReady() {
    console.log('🔍 Verifying system is ready for restart...');

    try {
      // Check memory usage
      const memUsage = process.memoryUsage();
      const memUsedMB = memUsage.heapUsed / 1024 / 1024;

      if (memUsedMB > 200) {
        console.log(`⚠️  High memory usage: ${memUsedMB.toFixed(2)}MB - forcing garbage collection`);
        if (global.gc) {
          global.gc();
        }
      }

      // Verify MCP server build exists
      await this.verifyMCPServerBuild();

      // Verify ports are truly free
      await this.verifyPortsAreFree();

      // Check for any remaining processes
      const { stdout } = await this.execCommand('ps aux | grep -E "(inspector|mcp)" | grep -v grep || echo "clean"');
      if (!stdout.includes('clean')) {
        console.log('⚠️  Found remaining processes, cleaning up...');
        await this.performEmergencyCleanup();
      }

      console.log('✅ System ready for restart');
    } catch (error) {
      console.log('⚠️  System verification completed with warnings:', error.message);
    }
  }

  async verifyMCPServerBuild() {
    try {
      const buildPath = path.join(this.projectRoot, 'build', 'index.js');
      if (!fs.existsSync(buildPath)) {
        console.log('⚠️  MCP server build not found, building...');
        await this.execCommand('npm run build');
        console.log('✅ MCP server built successfully');
      } else {
        console.log('✅ MCP server build verified');
      }
    } catch (error) {
      console.log('❌ Failed to verify/build MCP server:', error.message);
      console.log('💡 Try running: npm run build');
    }
  }

  scheduleRestart() {
    console.log(`⏰ Scheduling restart in ${this.options.restartDelay}ms...`);

    setTimeout(async () => {
      try {
        this.restartCount++;

        // Perform thorough cleanup before scheduled restart
        await this.performEmergencyCleanup();
        await this.cleanup();
        await this.verifySystemReady();

        // Start inspector
        await this.startInspector();
      } catch (error) {
        console.error('❌ Failed to restart inspector:', error);

        // If restart fails, try one more time with longer delay
        if (this.restartCount < this.options.maxRestarts) {
          console.log('🔄 Attempting final restart with extended delay...');
          setTimeout(async () => {
            try {
              await this.performEmergencyCleanup();
              await this.startInspector();
            } catch (finalError) {
              console.error('❌ Final restart attempt failed:', finalError);
            }
          }, this.options.restartDelay * 2);
        }
      }
    }, this.options.restartDelay);
  }

  logDiagnostics() {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      restartCount: this.restartCount,
      isRunning: this.isRunning,
      processId: this.process?.pid,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
    
    console.log('📊 Diagnostic Information:');
    console.log(JSON.stringify(diagnostics, null, 2));
  }

  setupSignalHandlers() {
    const cleanup = async () => {
      console.log('\n🛑 Shutting down inspector...');
      this.options.autoRestart = false; // Disable auto-restart

      // Keep the session token file for next startup
      console.log('💾 Session token preserved for next startup');

      if (this.process) {
        this.process.kill('SIGTERM');

        // Force kill if needed
        setTimeout(() => {
          if (this.process && !this.process.killed) {
            this.process.kill('SIGKILL');
          }
          process.exit(0);
        }, 5000);
      } else {
        process.exit(0);
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error);
      cleanup();
    });
  }

  // Method to clear session token (for manual cleanup)
  clearSessionToken() {
    try {
      if (fs.existsSync(this.tokenFile)) {
        fs.unlinkSync(this.tokenFile);
        console.log('🗑️  Session token file removed');
      }
      this.sessionToken = null;
      this.inspectorUrl = null;
    } catch (error) {
      console.log('⚠️  Could not remove session token file:', error.message);
    }
  }

  // Utility methods
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  execCommand(command) {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--port':
        options.port = parseInt(args[++i]);
        break;
      case '--proxy-port':
        options.proxyPort = parseInt(args[++i]);
        break;
      case '--auto-restart':
        options.autoRestart = true;
        break;
      case '--no-auto-restart':
        options.autoRestart = false;
        break;
      case '--max-restarts':
        options.maxRestarts = parseInt(args[++i]);
        break;
      case '--restart-delay':
        options.restartDelay = parseInt(args[++i]);
        break;
      case '--clear-session':
        options.clearSession = true;
        break;
      case '--help':
        console.log(`
Robust MCP Inspector Launcher

Usage: node scripts/robust-inspector.js [options]

Options:
  --port PORT           Inspector port (default: 6274)
  --proxy-port PORT     Proxy port (default: 6277)
  --auto-restart        Automatically restart on crashes (default: true)
  --no-auto-restart     Disable auto-restart
  --max-restarts N      Maximum restart attempts (default: 5)
  --restart-delay N     Delay between restarts in ms (default: 2000)
  --clear-session       Clear saved session token and generate new one
  --help               Show this help message
        `);
        process.exit(0);
    }
  }
  
  return options;
}

// Main execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs();
  const launcher = new RobustInspectorLauncher(options);

  // Handle clear session option
  if (options.clearSession) {
    console.log('🗑️  Clearing saved session token...');
    launcher.clearSessionToken();
    console.log('✅ Session token cleared. New token will be generated on next start.');
    process.exit(0);
  }

  launcher.launch().catch(error => {
    console.error('❌ Failed to launch robust inspector:', error);
    process.exit(1);
  });
}

export default RobustInspectorLauncher;
