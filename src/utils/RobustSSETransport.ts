import { logger } from "./logger.js";
import { IncomingMessage, ServerResponse } from "http";

/**
 * Enhanced SSE Transport with robust connection handling
 * Addresses premature connection closures and provides better error recovery
 *
 * Note: This is a wrapper around the standard SSE transport to add monitoring
 * and diagnostics without extending the private implementation.
 */
export class RobustSSETransport {
  private connectionId: string;
  private isConnectionStable: boolean = false;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 3;
  private connectionStartTime: number;
  private lastActivityTime: number;
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds
  private readonly CONNECTION_TIMEOUT = 300000; // 5 minutes
  private readonly STABILITY_THRESHOLD = 5000; // 5 seconds
  private response: ServerResponse;
  private request?: IncomingMessage;
  private isStarted: boolean = false;

  constructor(endpoint: string, res: ServerResponse, req?: IncomingMessage) {
    this.response = res;
    this.request = req;
    this.connectionId = this.generateConnectionId();
    this.connectionStartTime = Date.now();
    this.lastActivityTime = Date.now();

    this.setupEnhancedConnectionHandling();
    logger.info(`RobustSSETransport created with ID: ${this.connectionId}`);
  }

  private generateConnectionId(): string {
    return `sse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupEnhancedConnectionHandling() {
    // Configure response for better stability
    this.response.setTimeout(this.CONNECTION_TIMEOUT, () => {
      logger.warn(`SSE connection ${this.connectionId} timed out after ${this.CONNECTION_TIMEOUT}ms`);
      this.handleConnectionTimeout();
    });

    // Set keep-alive headers
    this.response.setHeader('Connection', 'keep-alive');
    this.response.setHeader('Cache-Control', 'no-cache, no-transform');
    this.response.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Handle client disconnect detection
    if (this.request) {
      this.request.on('close', () => {
        logger.info(`Client disconnected for SSE connection ${this.connectionId}`);
        this.handleClientDisconnect();
      });

      this.request.on('error', (error) => {
        logger.error(`Request error for SSE connection ${this.connectionId}:`, error);
        this.handleRequestError(error);
      });
    }

    // Enhanced response error handling
    this.response.on('error', (error: Error) => {
      logger.error(`Response error for SSE connection ${this.connectionId}:`, error);
      this.handleResponseError(error);
    });

    // Handle response close
    this.response.on('close', () => {
      this.handleEnhancedClose();
    });
  }

  async start() {
    try {
      if (this.isStarted) {
        throw new Error("SSEServerTransport already started!");
      }

      this.isStarted = true;

      // Initialize SSE response
      this.response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });

      // Send initial endpoint event (simplified)
      this.response.write(`event: endpoint\ndata: /sse\n\n`);

      // Mark connection as stable after threshold
      setTimeout(() => {
        this.isConnectionStable = true;
        logger.info(`SSE connection ${this.connectionId} marked as stable`);
      }, this.STABILITY_THRESHOLD);

      // Start heartbeat
      this.startHeartbeat();

      logger.info(`RobustSSETransport ${this.connectionId} started successfully`);
    } catch (error) {
      logger.error(`Failed to start RobustSSETransport ${this.connectionId}:`, error);
      throw error;
    }
  }

  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      try {
        this.sendHeartbeat();
      } catch (error) {
        logger.error(`Heartbeat failed for connection ${this.connectionId}:`, error);
        this.handleHeartbeatFailure();
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private sendHeartbeat() {
    if (this.response && !this.response.destroyed) {
      this.response.write(`: heartbeat ${Date.now()}\n\n`);
      this.lastActivityTime = Date.now();
    }
  }

  private handleConnectionTimeout() {
    logger.warn(`Connection ${this.connectionId} timed out`);
    this.cleanup();
  }

  private handleClientDisconnect() {
    logger.info(`Client disconnected for connection ${this.connectionId}`);
    this.cleanup();
  }

  private handleRequestError(error: Error) {
    logger.error(`Request error for connection ${this.connectionId}:`, error.message);
    this.cleanup();
  }

  private handleResponseError(error: Error) {
    logger.error(`Response error for connection ${this.connectionId}:`, error.message);
    this.cleanup();
  }

  private handleHeartbeatFailure() {
    logger.warn(`Heartbeat failed for connection ${this.connectionId}`);
    this.cleanup();
  }

  private handleEnhancedClose() {
    const connectionDuration = Date.now() - this.connectionStartTime;
    const wasStable = this.isConnectionStable;
    
    logger.info(`SSE connection ${this.connectionId} closed`, {
      duration: connectionDuration,
      wasStable,
      reconnectAttempts: this.reconnectAttempts
    });

    this.cleanup();
  }

  private cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    this.isConnectionStable = false;
  }

  async send(message: any) {
    try {
      // Check connection health before sending
      if (!this.response || this.response.destroyed) {
        throw new Error(`SSE connection ${this.connectionId} is not available`);
      }

      // Send the message as SSE format
      this.response.write(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
      this.lastActivityTime = Date.now();

    } catch (error) {
      logger.error(`Failed to send message on connection ${this.connectionId}:`, error);

      // If connection is stable, attempt recovery
      if (this.isConnectionStable && this.reconnectAttempts < this.maxReconnectAttempts) {
        logger.info(`Attempting to recover connection ${this.connectionId}`);
        this.reconnectAttempts++;
        // Note: Actual reconnection would need to be handled at a higher level
        // as it requires re-establishing the HTTP connection
      }

      throw error;
    }
  }

  async close() {
    logger.info(`Closing RobustSSETransport ${this.connectionId}`);
    this.cleanup();
    if (this.response && !this.response.destroyed) {
      this.response.end();
    }
  }

  // Diagnostic methods
  getConnectionInfo() {
    return {
      connectionId: this.connectionId,
      isStable: this.isConnectionStable,
      duration: Date.now() - this.connectionStartTime,
      lastActivity: Date.now() - this.lastActivityTime,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  isHealthy(): boolean {
    const timeSinceLastActivity = Date.now() - this.lastActivityTime;
    return this.response &&
           !this.response.destroyed &&
           timeSinceLastActivity < this.CONNECTION_TIMEOUT;
  }
}

/**
 * Factory function to create robust SSE transports
 */
export function createRobustSSETransport(
  endpoint: string, 
  res: ServerResponse, 
  req?: IncomingMessage
): RobustSSETransport {
  return new RobustSSETransport(endpoint, res, req);
}

/**
 * Connection manager for multiple SSE connections
 */
export class SSEConnectionManager {
  private connections = new Map<string, RobustSSETransport>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Periodic cleanup of dead connections
    this.cleanupInterval = setInterval(() => {
      this.cleanupDeadConnections();
    }, 60000); // Every minute
  }

  addConnection(transport: RobustSSETransport) {
    const info = transport.getConnectionInfo();
    this.connections.set(info.connectionId, transport);
    logger.info(`Added SSE connection ${info.connectionId} to manager`);
  }

  removeConnection(connectionId: string) {
    const transport = this.connections.get(connectionId);
    if (transport) {
      this.connections.delete(connectionId);
      logger.info(`Removed SSE connection ${connectionId} from manager`);
    }
  }

  private cleanupDeadConnections() {
    const deadConnections: string[] = [];
    
    for (const [id, transport] of this.connections.entries()) {
      if (!transport.isHealthy()) {
        deadConnections.push(id);
      }
    }

    for (const id of deadConnections) {
      logger.info(`Cleaning up dead SSE connection ${id}`);
      this.removeConnection(id);
    }
  }

  getConnectionStats() {
    const stats = {
      totalConnections: this.connections.size,
      healthyConnections: 0,
      connections: [] as any[]
    };

    for (const [, transport] of this.connections.entries()) {
      const info = transport.getConnectionInfo();
      const isHealthy = transport.isHealthy();

      if (isHealthy) {
        stats.healthyConnections++;
      }

      stats.connections.push({
        ...info,
        isHealthy
      });
    }

    return stats;
  }

  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Close all connections
    for (const [id, transport] of this.connections.entries()) {
      logger.info(`Shutting down SSE connection ${id}`);
      transport.close().catch(error => {
        logger.error(`Error closing connection ${id}:`, error);
      });
    }

    this.connections.clear();
  }
}
