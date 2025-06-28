import { logger } from '../utils/logger.js';
import { UserManager } from '../auth/UserManager.js';
import { UserSession } from '../auth/UserSession.js';

/**
 * Resource types that can be accessed in the system
 */
export enum ResourceType {
  EMAIL = 'email',
  THREAD = 'thread',
  LABEL = 'label',
  SEARCH = 'search',
  SAVED_SEARCH = 'saved_search',
  ARCHIVE = 'archive',
  ARCHIVE_RULE = 'archive_rule',
  CLEANUP_POLICY = 'cleanup_policy',
  CATEGORY_STATS = 'category_stats',
  USER_PREFERENCE = 'user_preference',
  JOB = 'job',
  SYSTEM_CONFIG = 'system_config'
}

/**
 * Access operation types
 */
export enum Operation {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  EXECUTE = 'execute'
}

/**
 * Interface for audit log entries
 */
export interface AccessAuditLog {
  timestamp: Date;
  userId: string;
  sessionId: string;
  resourceType: ResourceType;
  resourceId: string;
  operation: Operation;
  allowed: boolean;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Manager responsible for access control and resource ownership validation
 */
export class AccessControlManager {
  private auditLogs: AccessAuditLog[] = [];
  private static instance: AccessControlManager;

  /**
   * Create a new AccessControlManager instance
   * @param userManager UserManager instance for user validation
   */
  constructor(private userManager: UserManager) {}

  /**
   * Get or create the singleton instance
   * @param userManager UserManager instance
   */
  public static getInstance(userManager: UserManager): AccessControlManager {
    if (!AccessControlManager.instance) {
      AccessControlManager.instance = new AccessControlManager(userManager);
    }
    return AccessControlManager.instance;
  }

  /**
   * Validate if a user can access a specific resource
   * @param sessionId User session ID
   * @param resourceType Type of resource being accessed
   * @param resourceId ID of the resource
   * @param operation Operation being performed
   * @param resourceOwnerId Optional explicit owner ID of the resource
   */
  public async validateAccess(
    sessionId: string,
    resourceType: ResourceType,
    resourceId: string,
    operation: Operation,
    resourceOwnerId?: string
  ): Promise<boolean> {
    // Get session
    const session = this.userManager.getSession(sessionId);
    if (!session || !session.isValid()) {
      this.logAccessAttempt(
        session?.getSessionData().userId || 'unknown',
        sessionId,
        resourceType,
        resourceId,
        operation,
        false,
        'Invalid or expired session'
      );
      return false;
    }

    const userId = session.getSessionData().userId;
    
    // For system configuration, only allow access to specific admin users
    // This would be expanded with proper role-based permissions in a full implementation
    if (resourceType === ResourceType.SYSTEM_CONFIG) {
      const user = this.userManager.getUserById(userId);
      // Check for admin role instead of a preferences property
      const isAdmin = user?.role === 'admin';
      
      if (!isAdmin) {
        this.logAccessAttempt(
          userId,
          sessionId,
          resourceType,
          resourceId,
          operation,
          false,
          'User is not an administrator'
        );
        return false;
      }
    }

    // If resource owner is specified, ensure it matches the user
    if (resourceOwnerId && resourceOwnerId !== userId) {
      this.logAccessAttempt(
        userId,
        sessionId,
        resourceType,
        resourceId,
        operation,
        false,
        'Resource belongs to different user'
      );
      return false;
    }

    // Log successful access
    this.logAccessAttempt(
      userId,
      sessionId,
      resourceType,
      resourceId,
      operation,
      true
    );
    
    return true;
  }

  /**
   * Check if a resource is owned by a specific user
   * @param userId User ID to check ownership for
   * @param resourceType Type of resource
   * @param resourceId ID of the resource
   */
  public async isResourceOwner(
    userId: string,
    resourceType: ResourceType,
    resourceId: string
  ): Promise<boolean> {
    // This method would typically query the database to verify ownership
    // For example, checking if an email belongs to a user
    
    // Placeholder implementation - in a real implementation, this would check the database
    // to verify if the resource belongs to the user
    logger.debug(`Checking if user ${userId} owns resource ${resourceType}:${resourceId}`);

    // Here we would implement database lookups based on resource type
    // Example:
    // if (resourceType === ResourceType.EMAIL) {
    //   const email = await this.databaseManager.getEmailById(resourceId, userId);
    //   return !!email;
    // }

    // Return true for now as a placeholder
    // In a real implementation, we would perform actual ownership verification
    return true;
  }

  /**
   * Generate a user-specific resource ID to ensure proper isolation
   * @param userId User ID
   * @param resourceType Type of resource
   * @param baseId Base resource ID
   */
  public generateUserScopedResourceId(
    userId: string,
    resourceType: ResourceType,
    baseId: string
  ): string {
    return `${userId}:${resourceType}:${baseId}`;
  }

  /**
   * Parse a user-scoped resource ID to extract its components
   * @param scopedId User-scoped resource ID
   */
  public parseUserScopedResourceId(scopedId: string): { userId: string; resourceType: string; baseId: string } | null {
    const parts = scopedId.split(':');
    if (parts.length !== 3) {
      return null;
    }

    return {
      userId: parts[0],
      resourceType: parts[1],
      baseId: parts[2]
    };
  }

  /**
   * Log an access attempt for audit purposes
   * @param userId User ID
   * @param sessionId Session ID
   * @param resourceType Type of resource
   * @param resourceId ID of the resource
   * @param operation Operation performed
   * @param allowed Whether access was allowed
   * @param reason Optional reason if access was denied
   */
  private logAccessAttempt(
    userId: string,
    sessionId: string,
    resourceType: ResourceType,
    resourceId: string,
    operation: Operation,
    allowed: boolean,
    reason?: string
  ): void {
    const logEntry: AccessAuditLog = {
      timestamp: new Date(),
      userId,
      sessionId,
      resourceType,
      resourceId,
      operation,
      allowed,
      reason
    };

    // Add to in-memory log (would be persisted to database in production)
    this.auditLogs.push(logEntry);

    // Log the access attempt
    if (allowed) {
      logger.info(
        `Access granted: User ${userId} performed ${operation} on ${resourceType}:${resourceId}`,
        { userId, operation, resourceType, resourceId }
      );
    } else {
      logger.warn(
        `Access denied: User ${userId} attempted ${operation} on ${resourceType}:${resourceId}: ${reason}`,
        { userId, operation, resourceType, resourceId, reason }
      );
    }
  }

  /**
   * Get audit logs for a specific user
   * @param userId User ID to get logs for
   * @param limit Maximum number of logs to return
   * @param offset Offset for pagination
   */
  public getUserAuditLogs(
    userId: string,
    limit: number = 100,
    offset: number = 0
  ): AccessAuditLog[] {
    // Filter logs for the specified user
    const userLogs = this.auditLogs
      .filter(log => log.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    return userLogs.slice(offset, offset + limit);
  }

  /**
   * Clear audit logs (for testing or maintenance purposes)
   */
  public clearAuditLogs(): void {
    this.auditLogs = [];
    logger.info('Audit logs cleared');
  }

  /**
   * Validate batch resource access (multiple resources at once)
   * @param sessionId User session ID
   * @param resourceType Type of resources being accessed
   * @param resourceIds IDs of the resources
   * @param operation Operation being performed
   */
  public async validateBatchAccess(
    sessionId: string,
    resourceType: ResourceType,
    resourceIds: string[],
    operation: Operation
  ): Promise<string[]> {
    // Get session
    const session = this.userManager.getSession(sessionId);
    if (!session || !session.isValid()) {
      return [];
    }

    const userId = session.getSessionData().userId;
    const allowedResourceIds: string[] = [];

    // Check each resource ID
    for (const resourceId of resourceIds) {
      const allowed = await this.validateAccess(
        sessionId,
        resourceType,
        resourceId,
        operation
      );

      if (allowed) {
        allowedResourceIds.push(resourceId);
      }
    }

    return allowedResourceIds;
  }
}