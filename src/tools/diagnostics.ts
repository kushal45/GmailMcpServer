import { logger } from "../utils/logger.js";
import { globalConnectionMonitor } from "../utils/ConnectionHealthMonitor.js";

/**
 * Diagnostic tools for troubleshooting MCP connection issues
 */

export interface SystemDiagnostics {
  timestamp: string;
  nodeVersion: string;
  platform: string;
  memory: NodeJS.MemoryUsage;
  uptime: number;
  connectionHealth: any;
  processInfo: {
    pid: number;
    ppid: number;
    argv: string[];
    env: Record<string, string>;
  };
  networkInfo: {
    activeHandles: number;
    activeRequests: number;
  };
}

/**
 * Get comprehensive system diagnostics
 */
export function getSystemDiagnostics(): SystemDiagnostics {
  const process = globalThis.process;
  
  return {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    connectionHealth: globalConnectionMonitor.getDiagnostics(),
    processInfo: {
      pid: process.pid,
      ppid: process.ppid || 0,
      argv: process.argv,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'unknown',
        NODE_OPTIONS: process.env.NODE_OPTIONS || 'none',
        MCP_DEBUG: process.env.MCP_DEBUG || 'false',
        MULTI_USER_MODE: process.env.MULTI_USER_MODE || 'false'
      }
    },
    networkInfo: {
      activeHandles: (process as any)._getActiveHandles?.()?.length || 0,
      activeRequests: (process as any)._getActiveRequests?.()?.length || 0
    }
  };
}

/**
 * Analyze potential connection issues
 */
export function analyzeConnectionIssues(): {
  issues: string[];
  recommendations: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
} {
  const diagnostics = getSystemDiagnostics();
  const issues: string[] = [];
  const recommendations: string[] = [];
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';

  // Memory analysis
  const memoryUsageMB = diagnostics.memory.heapUsed / 1024 / 1024;
  if (memoryUsageMB > 500) {
    issues.push(`High memory usage: ${memoryUsageMB.toFixed(2)}MB`);
    recommendations.push("Consider restarting the server or reducing batch sizes");
    severity = 'medium';
  }

  // Connection health analysis
  const health = diagnostics.connectionHealth.health;
  if (!health.isConnected) {
    issues.push("Connection is not established");
    recommendations.push("Check network connectivity and server status");
    severity = 'critical';
  }

  if (health.errorCount > 0) {
    issues.push(`${health.errorCount} connection errors detected`);
    recommendations.push("Check server logs for error details");
    if (health.errorCount >= 5) {
      severity = 'high';
    } else if (severity === 'low') {
      severity = 'medium';
    }
  }

  if (health.lastActivity > 60000) {
    issues.push(`No activity for ${(health.lastActivity / 1000).toFixed(1)} seconds`);
    recommendations.push("Connection may be stale, consider reconnecting");
    if (severity === 'low') {
      severity = 'medium';
    }
  }

  // Network handles analysis
  if (diagnostics.networkInfo.activeHandles > 50) {
    issues.push(`High number of active handles: ${diagnostics.networkInfo.activeHandles}`);
    recommendations.push("Potential resource leak, consider restarting");
    if (severity === 'low') {
      severity = 'medium';
    }
  }

  // Process analysis
  if (diagnostics.uptime < 30) {
    issues.push("Server recently restarted");
    recommendations.push("Allow time for connections to stabilize");
  }

  return { issues, recommendations, severity };
}

/**
 * Generate a diagnostic report
 */
export function generateDiagnosticReport(): string {
  const diagnostics = getSystemDiagnostics();
  const analysis = analyzeConnectionIssues();
  
  const report = `
# MCP Server Diagnostic Report
Generated: ${diagnostics.timestamp}

## System Information
- Node.js Version: ${diagnostics.nodeVersion}
- Platform: ${diagnostics.platform}
- Process ID: ${diagnostics.processInfo.pid}
- Uptime: ${(diagnostics.uptime / 60).toFixed(1)} minutes

## Memory Usage
- Heap Used: ${(diagnostics.memory.heapUsed / 1024 / 1024).toFixed(2)} MB
- Heap Total: ${(diagnostics.memory.heapTotal / 1024 / 1024).toFixed(2)} MB
- RSS: ${(diagnostics.memory.rss / 1024 / 1024).toFixed(2)} MB
- External: ${(diagnostics.memory.external / 1024 / 1024).toFixed(2)} MB

## Connection Health
- Status: ${diagnostics.connectionHealth.health.isConnected ? '✅ Connected' : '❌ Disconnected'}
- Type: ${diagnostics.connectionHealth.health.connectionType}
- Quality: ${diagnostics.connectionHealth.health.quality}
- Uptime: ${(diagnostics.connectionHealth.health.uptime / 1000).toFixed(1)} seconds
- Last Activity: ${(diagnostics.connectionHealth.health.lastActivity / 1000).toFixed(1)} seconds ago
- Error Count: ${diagnostics.connectionHealth.health.errorCount}
- Reconnect Attempts: ${diagnostics.connectionHealth.health.reconnectAttempts}

## Connection Metrics
- Messages Received: ${diagnostics.connectionHealth.metrics.messagesReceived}
- Messages Sent: ${diagnostics.connectionHealth.metrics.messagesSent}
- Errors Encountered: ${diagnostics.connectionHealth.metrics.errorsEncountered}
- Connection Drops: ${diagnostics.connectionHealth.metrics.connectionDrops}

## Network Information
- Active Handles: ${diagnostics.networkInfo.activeHandles}
- Active Requests: ${diagnostics.networkInfo.activeRequests}

## Environment
- NODE_ENV: ${diagnostics.processInfo.env.NODE_ENV}
- NODE_OPTIONS: ${diagnostics.processInfo.env.NODE_OPTIONS}
- MCP_DEBUG: ${diagnostics.processInfo.env.MCP_DEBUG}
- MULTI_USER_MODE: ${diagnostics.processInfo.env.MULTI_USER_MODE}

## Issue Analysis
Severity: ${analysis.severity.toUpperCase()}

### Issues Detected:
${analysis.issues.length > 0 ? analysis.issues.map(issue => `- ${issue}`).join('\n') : '- No issues detected'}

### Recommendations:
${analysis.recommendations.map(rec => `- ${rec}`).join('\n')}

## Detailed Recommendations:
${diagnostics.connectionHealth.recommendations.map((rec: string) => `- ${rec}`).join('\n')}
`;

  return report.trim();
}

/**
 * Log diagnostic information
 */
export function logDiagnostics() {
  const report = generateDiagnosticReport();
  logger.info("=== MCP SERVER DIAGNOSTICS ===");
  logger.info(report);
  logger.info("=== END DIAGNOSTICS ===");
}

/**
 * Monitor for specific SSE connection issues
 */
export function monitorSSEIssues() {
  // Monitor for common SSE issues
  globalConnectionMonitor.on('connectionClosed', (data) => {
    logger.warn("SSE Connection closed detected:", data);
    logDiagnostics();
  });

  globalConnectionMonitor.on('criticalHealth', (health) => {
    logger.error("Critical connection health detected:", health);
    logDiagnostics();
  });

  globalConnectionMonitor.on('error', (data) => {
    logger.error("Connection error detected:", data);
    
    // Log diagnostics for SSE-specific errors
    if (data.error.message.includes('Not connected') || 
        data.error.message.includes('SSE') ||
        data.error.message.includes('connection closed')) {
      logger.error("SSE-specific error detected, generating diagnostic report");
      logDiagnostics();
    }
  });

  logger.info("SSE issue monitoring enabled");
}

/**
 * Test connection stability
 */
export async function testConnectionStability(duration: number = 30000): Promise<{
  stable: boolean;
  issues: string[];
  metrics: any;
}> {
  logger.info(`Testing connection stability for ${duration}ms`);
  
  const startTime = Date.now();
  const initialMetrics = globalConnectionMonitor.getMetrics();
  const issues: string[] = [];
  
  return new Promise((resolve) => {
    const checkInterval = setInterval(() => {
      const health = globalConnectionMonitor.getConnectionHealth();
      
      if (!health.isConnected) {
        issues.push(`Connection lost at ${Date.now() - startTime}ms`);
      }
      
      if (health.errorCount > 0) {
        issues.push(`Errors detected: ${health.errorCount}`);
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(checkInterval);
      
      const finalMetrics = globalConnectionMonitor.getMetrics();
      const health = globalConnectionMonitor.getConnectionHealth();
      
      const stable = issues.length === 0 && health.isConnected;
      
      resolve({
        stable,
        issues,
        metrics: {
          initial: initialMetrics,
          final: finalMetrics,
          health
        }
      });
    }, duration);
  });
}

/**
 * Export diagnostics for external analysis
 */
export function exportDiagnostics(): any {
  return {
    ...getSystemDiagnostics(),
    analysis: analyzeConnectionIssues(),
    report: generateDiagnosticReport(),
    exportedAt: new Date().toISOString()
  };
}
