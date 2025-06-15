import { randomUUID } from 'crypto';
import { DatabaseManager } from '../../../../src/database/DatabaseManager';
import { DatabaseIsolationContext } from './types';
import { logger } from '../../../../src/utils/logger';
import fs from 'fs/promises';
import path from 'path';

/**
 * DatabaseTestManager provides transaction-based database isolation for cleanup tests.
 * 
 * This class ensures complete database state isolation between tests using:
 * - Separate database instances per test
 * - Automatic cleanup and rollback mechanisms
 * - Transaction-based isolation where possible
 * - Resource management and cleanup tracking
 * 
 * Key Features:
 * - Database transaction isolation
 * - Automatic cleanup of test databases
 * - Resource tracking and management
 * - Error handling and recovery
 * - Performance optimization for test execution
 * 
 * @example
 * ```typescript
 * const dbManager = new DatabaseTestManager();
 * const result = await dbManager.withIsolatedDatabase(async (db) => {
 *   // Perform test operations with isolated database
 *   await db.bulkUpsertEmailIndex(testEmails);
 *   return await db.searchEmails({});
 * });
 * ```
 */
export class DatabaseTestManager {
  private activeIsolations: Map<string, DatabaseIsolationContext> = new Map();
  private testDbPaths: Set<string> = new Set();

  constructor() {
    // Register cleanup handler for process exit
    this.registerCleanupHandlers();
  }

  /**
   * Execute a function with an isolated database instance
   * 
   * @param callback - Function to execute with isolated database
   * @returns Result of the callback function
   */
  async withIsolatedDatabase<T>(
    callback: (database: DatabaseManager) => Promise<T>
  ): Promise<T> {
    const isolationId = randomUUID();
    let dbManager: DatabaseManager | null = null;
    let testDbPath: string | null = null;

    try {
      logger.debug('Creating isolated database', { isolation_id: isolationId });

      // Create isolated database instance
      const { database, dbPath } = await this.createIsolatedDatabase(isolationId);
      dbManager = database;
      testDbPath = dbPath;

      // Track the isolation context
      const context: DatabaseIsolationContext = {
        transactionId: isolationId,
        startTime: new Date(),
        rollbackFunctions: [
          async () => await this.cleanupDatabase(dbManager!),
          async () => await this.removeTestDatabase(testDbPath!)
        ],
        isActive: true
      };

      this.activeIsolations.set(isolationId, context);

      // Execute callback with isolated database
      const result = await callback(dbManager);

      logger.debug('Isolated database operation completed', {
        isolation_id: isolationId,
        success: true
      });

      return result;

    } catch (error) {
      logger.error('Isolated database operation failed', {
        isolation_id: isolationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;

    } finally {
      // Always cleanup, even on error
      if (isolationId && this.activeIsolations.has(isolationId)) {
        await this.rollbackIsolation(isolationId);
      }
    }
  }

  /**
   * Create a persistent isolated database that must be manually cleaned up
   * This is used when database isolation needs to persist beyond a single callback
   *
   * @returns Object containing database manager and cleanup function
   */
  async createPersistentIsolation(): Promise<{
    database: DatabaseManager;
    isolationId: string;
    cleanup: () => Promise<void>;
  }> {
    const isolationId = randomUUID();
    let dbManager: DatabaseManager | null = null;
    let testDbPath: string | null = null;

    try {
      logger.debug('Creating persistent isolated database', { isolation_id: isolationId });

      // Create isolated database instance
      const { database, dbPath } = await this.createIsolatedDatabase(isolationId);
      dbManager = database;
      testDbPath = dbPath;

      // Track the isolation context (but don't auto-cleanup)
      const context: DatabaseIsolationContext = {
        transactionId: isolationId,
        startTime: new Date(),
        rollbackFunctions: [
          async () => await this.cleanupDatabase(dbManager!),
          async () => await this.removeTestDatabase(testDbPath!)
        ],
        isActive: true
      };

      this.activeIsolations.set(isolationId, context);

      // Return database and manual cleanup function
      const cleanup = async () => {
        if (this.activeIsolations.has(isolationId)) {
          await this.rollbackIsolation(isolationId);
        }
      };

      logger.debug('Persistent isolated database created', {
        isolation_id: isolationId,
        success: true
      });

      return {
        database: dbManager,
        isolationId,
        cleanup
      };

    } catch (error) {
      logger.error('Failed to create persistent isolated database', {
        isolation_id: isolationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Clean up on failure
      if (isolationId && this.activeIsolations.has(isolationId)) {
        await this.rollbackIsolation(isolationId);
      }

      throw error;
    }
  }

  /**
   * Create an isolated database instance for testing
   */
  private async createIsolatedDatabase(isolationId: string): Promise<{
    database: DatabaseManager;
    dbPath: string;
  }> {
    try {
      // Create unique test database path using Node.js compatible approach
      const dataPath = `data/${isolationId}-test-cleanup`;
      const testDbDir = path.resolve(process.cwd(), dataPath);
      const testDbPath = path.join(testDbDir, 'test-cleanup.db');

      // Track test database path for cleanup
      this.testDbPaths.add(testDbDir);

      // Reset the singleton instance to force creation of a new one
      (DatabaseManager as any).instance = null;

      // Set the storage path environment variable to our test directory
      process.env.STORAGE_PATH = testDbDir;

      // Create and initialize database manager
      const dbManager = DatabaseManager.getInstance();
      await dbManager.initialize();

      logger.debug('Isolated database created', {
        isolation_id: isolationId,
        db_path: testDbPath
      });

      return {
        database: dbManager,
        dbPath: testDbDir
      };

    } catch (error) {
      logger.error('Failed to create isolated database', {
        isolation_id: isolationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Clean up database resources
   */
  async cleanupDatabase(dbManager: DatabaseManager): Promise<void> {
    try {
      if (dbManager) {
        // Clear cleanup policies using public methods
        try {
          const allPolicies = await dbManager.getAllPolicies();
          for (const policy of allPolicies) {
            await dbManager.deleteCleanupPolicy(policy.id);
          }
          logger.debug('Cleared cleanup policies from test database');
        } catch (error) {
          logger.warn('Warning: Failed to clear cleanup policies', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }

        // Close database connection
        await dbManager.close();
        logger.debug('Database connection closed');
      }

      // Reset the singleton instance to ensure complete cleanup
      (DatabaseManager as any).instance = null;

    } catch (error) {
      logger.error('Failed to cleanup database', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Remove test database directory
   */
  private async removeTestDatabase(testDbDir: string): Promise<void> {
    try {
      const resolvedTestDbDir = path.resolve(testDbDir);
      
      logger.debug('Attempting to remove test database directory', {
        path: resolvedTestDbDir
      });

      await fs.rm(resolvedTestDbDir, { recursive: true, force: true });
      
      // Remove from tracking set
      this.testDbPaths.delete(testDbDir);
      
      logger.debug('Successfully removed test database directory', {
        path: resolvedTestDbDir
      });

    } catch (error: any) {
      // Log error details but don't throw for cleanup operations
      logger.warn('Failed to remove test database directory', {
        path: testDbDir,
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
          syscall: error.syscall,
          path: error.path
        }
      });

      // If ENOENT (no such file or directory), consider it already cleaned
      if (error.code === 'ENOENT') {
        logger.debug('Directory already removed or never existed', {
          path: testDbDir
        });
        this.testDbPaths.delete(testDbDir);
      }
    }
  }

  /**
   * Rollback an isolation context
   */
  private async rollbackIsolation(isolationId: string): Promise<void> {
    const context = this.activeIsolations.get(isolationId);
    if (!context) {
      logger.warn('Attempted to rollback unknown isolation', { isolation_id: isolationId });
      return;
    }

    try {
      logger.debug('Rolling back database isolation', { isolation_id: isolationId });

      // Execute rollback functions in reverse order
      for (const rollbackFn of context.rollbackFunctions.reverse()) {
        try {
          await rollbackFn();
        } catch (error) {
          logger.warn('Rollback function failed', {
            isolation_id: isolationId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Mark context as inactive
      context.isActive = false;

      // Remove from active isolations
      this.activeIsolations.delete(isolationId);

      logger.debug('Database isolation rolled back successfully', {
        isolation_id: isolationId
      });

    } catch (error) {
      logger.error('Failed to rollback database isolation', {
        isolation_id: isolationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Register cleanup handlers for process exit
   */
  private registerCleanupHandlers(): void {
    // Handle graceful shutdown
    process.on('SIGINT', () => this.emergencyCleanup());
    process.on('SIGTERM', () => this.emergencyCleanup());
    
    // Handle unexpected exits
    process.on('beforeExit', () => this.emergencyCleanup());
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception during database test', {
        error: error.message
      });
      this.emergencyCleanup();
    });
  }

  /**
   * Emergency cleanup of all active isolations and test databases
   */
  async emergencyCleanup(): Promise<void> {
    try {
      logger.info('Performing emergency cleanup of test databases', {
        active_isolations: this.activeIsolations.size,
        test_db_paths: this.testDbPaths.size
      });

      // Cleanup all active isolations
      const isolationPromises = Array.from(this.activeIsolations.keys()).map(
        isolationId => this.rollbackIsolation(isolationId)
      );
      await Promise.allSettled(isolationPromises);

      // Clean up any remaining test database directories
      const cleanupPromises = Array.from(this.testDbPaths).map(
        dbPath => this.removeTestDatabase(dbPath)
      );
      await Promise.allSettled(cleanupPromises);

      // Reset singleton instance
      (DatabaseManager as any).instance = null;

      logger.info('Emergency cleanup completed');

    } catch (error) {
      logger.error('Emergency cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get statistics about active database isolations
   */
  getIsolationStats(): {
    activeIsolations: number;
    testDatabases: number;
    oldestIsolation?: Date;
    totalDuration?: number;
  } {
    const contexts = Array.from(this.activeIsolations.values());
    const now = new Date();

    let oldestIsolation: Date | undefined;
    let totalDuration = 0;

    contexts.forEach(context => {
      if (!oldestIsolation || context.startTime < oldestIsolation) {
        oldestIsolation = context.startTime;
      }
      totalDuration += now.getTime() - context.startTime.getTime();
    });

    return {
      activeIsolations: this.activeIsolations.size,
      testDatabases: this.testDbPaths.size,
      oldestIsolation,
      totalDuration: totalDuration > 0 ? totalDuration : undefined
    };
  }

  /**
   * Force cleanup of a specific isolation (for emergency scenarios)
   */
  async forceCleanupIsolation(isolationId: string): Promise<boolean> {
    if (!this.activeIsolations.has(isolationId)) {
      return false;
    }

    try {
      await this.rollbackIsolation(isolationId);
      return true;
    } catch (error) {
      logger.error('Force cleanup failed', {
        isolation_id: isolationId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Check if an isolation is still active
   */
  isIsolationActive(isolationId: string): boolean {
    const context = this.activeIsolations.get(isolationId);
    return context?.isActive || false;
  }

  /**
   * Clean up all resources (for test teardown)
   */
  async dispose(): Promise<void> {
    logger.info('Disposing database test manager');
    await this.emergencyCleanup();
  }
}