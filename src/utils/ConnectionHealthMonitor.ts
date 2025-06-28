import { logger } from "./logger.js";
import { EventEmitter } from "events";

export interface ConnectionHealth {
  isConnected: boolean;
  connectionType: 'stdio' | 'sse' | 'unknown';
  uptime: number;
  lastActivity: number;
  errorCount: number;
  reconnectAttempts: number;
  quality: 'excellent' | 'good' | 'poor' | 'critical';
}

export interface ConnectionMetrics {
  messagesReceived: number;
  messagesSent: number;
  errorsEncountered: number;
  averageResponseTime: number;
  connectionDrops: number;
}

/**
 * Monitors connection health and provides diagnostics for MCP transports
 */
export class ConnectionHealthMonitor extends EventEmitter {
  private connectionStartTime: number;
  private lastActivityTime: number;
  private errorCount: number = 0;
  private reconnectAttempts: number = 0;
  private isConnected: boolean = false;
  private connectionType: 'stdio' | 'sse' | 'unknown' = 'unknown';
  private metrics: ConnectionMetrics;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly HEALTH_CHECK_INTERVAL = 10000; // 10 seconds
  private readonly ACTIVITY_TIMEOUT = 60000; // 1 minute
  private readonly CRITICAL_ERROR_THRESHOLD = 5;

  constructor() {
    super();
    this.connectionStartTime = Date.now();
    this.lastActivityTime = Date.now();
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      errorsEncountered: 0,
      averageResponseTime: 0,
      connectionDrops: 0
    };
  }

  /**
   * Start monitoring connection health
   */
  startMonitoring() {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.HEALTH_CHECK_INTERVAL);

    logger.info("Connection health monitoring started");
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    logger.info("Connection health monitoring stopped");
  }

  /**
   * Mark connection as established
   */
  onConnectionEstablished(type: 'stdio' | 'sse') {
    this.isConnected = true;
    this.connectionType = type;
    this.connectionStartTime = Date.now();
    this.lastActivityTime = Date.now();
    this.errorCount = 0;
    
    logger.info(`Connection established: ${type}`);
    this.emit('connectionEstablished', { type });
  }

  /**
   * Mark connection as closed
   */
  onConnectionClosed(reason?: string) {
    const wasConnected = this.isConnected;
    this.isConnected = false;
    
    if (wasConnected) {
      this.metrics.connectionDrops++;
      logger.warn(`Connection closed: ${reason || 'unknown reason'}`);
      this.emit('connectionClosed', { reason });
    }
  }

  /**
   * Record message activity
   */
  onMessageReceived() {
    this.metrics.messagesReceived++;
    this.lastActivityTime = Date.now();
    this.emit('messageReceived');
  }

  onMessageSent() {
    this.metrics.messagesSent++;
    this.lastActivityTime = Date.now();
    this.emit('messageSent');
  }

  /**
   * Record error
   */
  onError(error: Error, context?: string) {
    this.errorCount++;
    this.metrics.errorsEncountered++;
    
    logger.error(`Connection error ${context ? `(${context})` : ''}:`, error.message);
    
    if (this.errorCount >= this.CRITICAL_ERROR_THRESHOLD) {
      this.emit('criticalErrorThreshold', { errorCount: this.errorCount });
    }
    
    this.emit('error', { error, context });
  }

  /**
   * Record reconnection attempt
   */
  onReconnectAttempt() {
    this.reconnectAttempts++;
    logger.info(`Reconnection attempt #${this.reconnectAttempts}`);
    this.emit('reconnectAttempt', { attempt: this.reconnectAttempts });
  }

  /**
   * Perform health check
   */
  private performHealthCheck() {
    const health = this.getConnectionHealth();
    
    // Emit health status
    this.emit('healthCheck', health);
    
    // Check for issues
    if (health.quality === 'critical') {
      this.emit('criticalHealth', health);
    } else if (health.quality === 'poor') {
      this.emit('poorHealth', health);
    }

    // Check for activity timeout
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    if (this.isConnected && timeSinceActivity > this.ACTIVITY_TIMEOUT) {
      logger.warn(`No activity for ${timeSinceActivity}ms, connection may be stale`);
      this.emit('activityTimeout', { timeSinceActivity });
    }
  }

  /**
   * Get current connection health
   */
  getConnectionHealth(): ConnectionHealth {
    const uptime = Date.now() - this.connectionStartTime;
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    
    let quality: ConnectionHealth['quality'] = 'excellent';
    
    if (!this.isConnected) {
      quality = 'critical';
    } else if (this.errorCount >= this.CRITICAL_ERROR_THRESHOLD) {
      quality = 'critical';
    } else if (this.errorCount >= 3 || timeSinceActivity > this.ACTIVITY_TIMEOUT) {
      quality = 'poor';
    } else if (this.errorCount >= 1 || timeSinceActivity > this.ACTIVITY_TIMEOUT / 2) {
      quality = 'good';
    }

    return {
      isConnected: this.isConnected,
      connectionType: this.connectionType,
      uptime,
      lastActivity: timeSinceActivity,
      errorCount: this.errorCount,
      reconnectAttempts: this.reconnectAttempts,
      quality
    };
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  /**
   * Get comprehensive diagnostics
   */
  getDiagnostics() {
    const health = this.getConnectionHealth();
    const metrics = this.getMetrics();
    
    return {
      health,
      metrics,
      timestamp: new Date().toISOString(),
      recommendations: this.generateRecommendations(health, metrics)
    };
  }

  /**
   * Generate recommendations based on health and metrics
   */
  private generateRecommendations(health: ConnectionHealth, metrics: ConnectionMetrics): string[] {
    const recommendations: string[] = [];

    if (!health.isConnected) {
      recommendations.push("Connection is down - check server status and network connectivity");
    }

    if (health.errorCount >= this.CRITICAL_ERROR_THRESHOLD) {
      recommendations.push("High error count detected - investigate error patterns and server logs");
    }

    if (health.lastActivity > this.ACTIVITY_TIMEOUT) {
      recommendations.push("No recent activity - connection may be stale, consider reconnecting");
    }

    if (metrics.connectionDrops > 3) {
      recommendations.push("Frequent connection drops detected - check network stability");
    }

    if (health.reconnectAttempts > 5) {
      recommendations.push("Multiple reconnection attempts - investigate underlying connectivity issues");
    }

    if (health.quality === 'poor' || health.quality === 'critical') {
      recommendations.push("Connection quality is degraded - consider restarting the connection");
    }

    if (recommendations.length === 0) {
      recommendations.push("Connection appears healthy");
    }

    return recommendations;
  }

  /**
   * Reset metrics and counters
   */
  reset() {
    this.errorCount = 0;
    this.reconnectAttempts = 0;
    this.connectionStartTime = Date.now();
    this.lastActivityTime = Date.now();
    this.metrics = {
      messagesReceived: 0,
      messagesSent: 0,
      errorsEncountered: 0,
      averageResponseTime: 0,
      connectionDrops: 0
    };
    
    logger.info("Connection health monitor reset");
    this.emit('reset');
  }

  /**
   * Export health data for external monitoring
   */
  exportHealthData() {
    return {
      ...this.getDiagnostics(),
      exportTime: Date.now(),
      monitoringDuration: Date.now() - this.connectionStartTime
    };
  }
}

/**
 * Global connection health monitor instance
 */
export const globalConnectionMonitor = new ConnectionHealthMonitor();

/**
 * Utility function to setup connection monitoring for MCP servers
 */
export function setupConnectionMonitoring(server: any) {
  const monitor = globalConnectionMonitor;
  
  // Start monitoring
  monitor.startMonitoring();
  
  // Setup event handlers
  monitor.on('criticalHealth', (health) => {
    logger.error("Critical connection health detected:", health);
  });
  
  monitor.on('connectionClosed', ({ reason }) => {
    logger.warn(`Connection closed: ${reason}`);
  });
  
  monitor.on('criticalErrorThreshold', ({ errorCount }) => {
    logger.error(`Critical error threshold reached: ${errorCount} errors`);
  });

  // Setup server event handlers if available
  if (server.onclose) {
    const originalOnClose = server.onclose;
    server.onclose = () => {
      monitor.onConnectionClosed('server close event');
      if (originalOnClose) {
        originalOnClose.call(server);
      }
    };
  }

  if (server.onerror) {
    const originalOnError = server.onerror;
    server.onerror = (error: Error) => {
      monitor.onError(error, 'server error');
      if (originalOnError) {
        originalOnError.call(server, error);
      }
    };
  }

  // Cleanup on process exit
  process.on('exit', () => {
    monitor.stopMonitoring();
  });

  return monitor;
}
