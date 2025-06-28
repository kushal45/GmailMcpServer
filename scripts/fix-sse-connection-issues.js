#!/usr/bin/env node

/**
 * SSE Connection Issues Fix Script
 * 
 * This script provides comprehensive solutions for SSE connection close issues
 * in the MCP Inspector and other SSE-based transports.
 * 
 * Usage:
 *   node scripts/fix-sse-connection-issues.js [options]
 * 
 * Options:
 *   --diagnose    Run diagnostics only
 *   --fix         Apply fixes
 *   --monitor     Start monitoring mode
 *   --test        Run connection stability test
 */

import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SSEConnectionFixer {
  constructor() {
    this.projectRoot = path.resolve(__dirname, '..');
    this.fixes = [];
    this.diagnostics = {};
  }

  async run() {
    const args = process.argv.slice(2);
    
    console.log('🔧 SSE Connection Issues Fix Script');
    console.log('=====================================\n');

    if (args.includes('--diagnose')) {
      await this.runDiagnostics();
    } else if (args.includes('--fix')) {
      await this.applyFixes();
    } else if (args.includes('--monitor')) {
      await this.startMonitoring();
    } else if (args.includes('--test')) {
      await this.testConnection();
    } else {
      await this.runComplete();
    }
  }

  async runDiagnostics() {
    console.log('🔍 Running SSE Connection Diagnostics...\n');

    // Check Node.js version
    const nodeVersion = process.version;
    console.log(`Node.js Version: ${nodeVersion}`);
    
    if (this.compareVersions(nodeVersion, 'v18.0.0') < 0) {
      this.fixes.push('upgrade-node');
      console.log('⚠️  Node.js version is below recommended v18.0.0');
    } else {
      console.log('✅ Node.js version is compatible');
    }

    // Check MCP SDK version
    const packageJson = this.readPackageJson();
    const mcpSdkVersion = packageJson.dependencies?.['@modelcontextprotocol/sdk'];
    console.log(`\nMCP SDK Version: ${mcpSdkVersion || 'not found'}`);

    // Check for common issues
    await this.checkCommonIssues();

    // Check system resources
    this.checkSystemResources();

    // Generate recommendations
    this.generateRecommendations();
  }

  async checkCommonIssues() {
    console.log('\n🔍 Checking for common SSE issues...');

    // Check for multiple inspector instances
    try {
      const { stdout } = await this.execCommand('lsof -i :6274 2>/dev/null || echo "No process found"');
      if (stdout.includes('node')) {
        console.log('⚠️  MCP Inspector port 6274 is in use');
        this.fixes.push('kill-inspector-processes');
      } else {
        console.log('✅ MCP Inspector port is available');
      }
    } catch (error) {
      console.log('ℹ️  Could not check port usage (lsof not available)');
    }

    // Check for zombie processes
    try {
      const { stdout } = await this.execCommand('ps aux | grep "mcp\\|inspector" | grep -v grep || echo "No processes found"');
      const processes = stdout.split('\n').filter(line => line.trim() && !line.includes('No processes found'));
      if (processes.length > 0) {
        console.log(`⚠️  Found ${processes.length} MCP-related processes`);
        processes.forEach(proc => console.log(`   ${proc.trim()}`));
        this.fixes.push('cleanup-processes');
      } else {
        console.log('✅ No zombie MCP processes found');
      }
    } catch (error) {
      console.log('ℹ️  Could not check for zombie processes');
    }

    // Check file descriptors
    try {
      const { stdout } = await this.execCommand('ulimit -n');
      const fdLimit = parseInt(stdout.trim());
      if (fdLimit < 1024) {
        console.log(`⚠️  Low file descriptor limit: ${fdLimit}`);
        this.fixes.push('increase-fd-limit');
      } else {
        console.log(`✅ File descriptor limit is adequate: ${fdLimit}`);
      }
    } catch (error) {
      console.log('ℹ️  Could not check file descriptor limit');
    }
  }

  checkSystemResources() {
    console.log('\n🔍 Checking system resources...');

    const memUsage = process.memoryUsage();
    const memUsedMB = memUsage.heapUsed / 1024 / 1024;
    
    console.log(`Memory Usage: ${memUsedMB.toFixed(2)} MB`);
    
    if (memUsedMB > 500) {
      console.log('⚠️  High memory usage detected');
      this.fixes.push('optimize-memory');
    } else {
      console.log('✅ Memory usage is normal');
    }

    // Check uptime
    const uptimeSeconds = process.uptime();
    console.log(`Process Uptime: ${(uptimeSeconds / 60).toFixed(1)} minutes`);
    
    if (uptimeSeconds < 30) {
      console.log('ℹ️  Process recently started, connections may still be stabilizing');
    }
  }

  async applyFixes() {
    console.log('🔧 Applying SSE Connection Fixes...\n');

    for (const fix of this.fixes) {
      await this.applyFix(fix);
    }

    if (this.fixes.length === 0) {
      console.log('✅ No fixes needed - system appears healthy');
    }
  }

  async applyFix(fixType) {
    console.log(`\n🔧 Applying fix: ${fixType}`);

    switch (fixType) {
      case 'kill-inspector-processes':
        await this.killInspectorProcesses();
        break;
      case 'cleanup-processes':
        await this.cleanupProcesses();
        break;
      case 'increase-fd-limit':
        this.increaseFDLimit();
        break;
      case 'optimize-memory':
        this.optimizeMemory();
        break;
      case 'upgrade-node':
        this.suggestNodeUpgrade();
        break;
      default:
        console.log(`❓ Unknown fix type: ${fixType}`);
    }
  }

  async killInspectorProcesses() {
    try {
      await this.execCommand('pkill -f "mcp.*inspector" || true');
      await this.execCommand('pkill -f "inspector.*mcp" || true');
      console.log('✅ Killed existing inspector processes');
      
      // Wait a moment for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log('⚠️  Could not kill inspector processes:', error.message);
    }
  }

  async cleanupProcesses() {
    try {
      // Kill any hanging MCP processes
      await this.execCommand('pkill -f "gmail-mcp-server" || true');
      await this.execCommand('pkill -f "build/index.js" || true');
      console.log('✅ Cleaned up MCP processes');
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.log('⚠️  Could not cleanup processes:', error.message);
    }
  }

  increaseFDLimit() {
    console.log('ℹ️  To increase file descriptor limit, run:');
    console.log('   ulimit -n 4096');
    console.log('   Or add to ~/.bashrc or ~/.zshrc:');
    console.log('   export ULIMIT_FD=4096');
  }

  optimizeMemory() {
    console.log('ℹ️  Memory optimization suggestions:');
    console.log('   - Restart the MCP server periodically');
    console.log('   - Reduce batch sizes in operations');
    console.log('   - Clear caches regularly');
    console.log('   - Set NODE_OPTIONS="--max-old-space-size=2048"');
  }

  suggestNodeUpgrade() {
    console.log('ℹ️  Node.js upgrade recommended:');
    console.log('   - Current version may have SSE stability issues');
    console.log('   - Upgrade to Node.js v18+ or v20+ for better SSE support');
    console.log('   - Use nvm: nvm install 20 && nvm use 20');
  }

  async startMonitoring() {
    console.log('📊 Starting SSE Connection Monitoring...\n');
    
    // Build the project first
    console.log('Building project...');
    await this.execCommand('npm run build');
    
    // Start monitoring
    const monitorScript = `
const { globalConnectionMonitor } = require('./build/utils/ConnectionHealthMonitor.js');
const { monitorSSEIssues, logDiagnostics } = require('./build/tools/diagnostics.js');

console.log('🔍 SSE Connection Monitor Started');
console.log('Press Ctrl+C to stop monitoring\\n');

// Setup monitoring
monitorSSEIssues();
globalConnectionMonitor.startMonitoring();

// Log initial diagnostics
logDiagnostics();

// Periodic health checks
setInterval(() => {
  const health = globalConnectionMonitor.getConnectionHealth();
  console.log(\`[\${new Date().toISOString()}] Connection Health: \${health.quality} - \${health.isConnected ? 'Connected' : 'Disconnected'}\`);
}, 10000);

process.on('SIGINT', () => {
  console.log('\\n🛑 Stopping monitor...');
  globalConnectionMonitor.stopMonitoring();
  process.exit(0);
});
`;

    fs.writeFileSync(path.join(this.projectRoot, 'temp-monitor.js'), monitorScript);
    
    try {
      await this.execCommand('node temp-monitor.js');
    } finally {
      // Cleanup
      try {
        fs.unlinkSync(path.join(this.projectRoot, 'temp-monitor.js'));
      } catch (e) {}
    }
  }

  async testConnection() {
    console.log('🧪 Testing SSE Connection Stability...\n');
    
    // Build first
    await this.execCommand('npm run build');
    
    console.log('Starting MCP Inspector for testing...');
    
    const inspector = spawn('npm', ['run', 'inspector'], {
      cwd: this.projectRoot,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    inspector.stdout.on('data', (data) => {
      output += data.toString();
      process.stdout.write(data);
    });

    inspector.stderr.on('data', (data) => {
      output += data.toString();
      process.stderr.write(data);
    });

    // Wait for startup
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check for SSE connection issues in output
    if (output.includes('SSE connection closed')) {
      console.log('\n❌ SSE connection issues detected during test');
    } else {
      console.log('\n✅ No immediate SSE connection issues detected');
    }

    // Cleanup
    inspector.kill('SIGTERM');
    
    setTimeout(() => {
      if (!inspector.killed) {
        inspector.kill('SIGKILL');
      }
    }, 2000);
  }

  async runComplete() {
    await this.runDiagnostics();
    
    if (this.fixes.length > 0) {
      console.log('\n🔧 Fixes recommended. Run with --fix to apply them.');
    }
    
    console.log('\n📋 Available commands:');
    console.log('  --diagnose  : Run diagnostics only');
    console.log('  --fix       : Apply recommended fixes');
    console.log('  --monitor   : Start connection monitoring');
    console.log('  --test      : Test connection stability');
  }

  generateRecommendations() {
    console.log('\n📋 Recommendations:');
    
    if (this.fixes.length === 0) {
      console.log('✅ No immediate issues detected');
      console.log('ℹ️  If you\'re still experiencing SSE connection issues:');
      console.log('   1. Run: node scripts/fix-sse-connection-issues.js --monitor');
      console.log('   2. Check browser console for client-side errors');
      console.log('   3. Verify network connectivity and firewall settings');
    } else {
      console.log('⚠️  Issues detected that may cause SSE connection problems:');
      this.fixes.forEach(fix => {
        console.log(`   - ${fix}`);
      });
      console.log('\n🔧 Run with --fix to apply recommended fixes');
    }
  }

  // Utility methods
  readPackageJson() {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.projectRoot, 'package.json'), 'utf8'));
    } catch (error) {
      return {};
    }
  }

  compareVersions(version1, version2) {
    const v1 = version1.replace('v', '').split('.').map(Number);
    const v2 = version2.replace('v', '').split('.').map(Number);
    
    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const a = v1[i] || 0;
      const b = v2[i] || 0;
      if (a > b) return 1;
      if (a < b) return -1;
    }
    return 0;
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

// Run the fixer
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixer = new SSEConnectionFixer();
  fixer.run().catch(error => {
    console.error('❌ Error running SSE connection fixer:', error);
    process.exit(1);
  });
}

export default SSEConnectionFixer;
