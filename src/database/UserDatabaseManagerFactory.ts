import { DatabaseManager } from './DatabaseManager.js';
import { UserDatabaseInitializer } from './UserDatabaseInitializer.js';
import { logger } from '../utils/logger.js';

/**
 * Factory for creating and managing user-specific database managers
 * Ensures proper isolation between users while maintaining performance
 */
export class UserDatabaseManagerFactory {
  private static instance: UserDatabaseManagerFactory;
  private userDbInitializer: UserDatabaseInitializer;
  private dbManagerCache: Map<string, DatabaseManager> = new Map();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  private cacheTimestamps: Map<string, number> = new Map();

  private constructor() {
    this.userDbInitializer = new UserDatabaseInitializer();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): UserDatabaseManagerFactory {
    if (!UserDatabaseManagerFactory.instance) {
      UserDatabaseManagerFactory.instance = new UserDatabaseManagerFactory();
    }
    return UserDatabaseManagerFactory.instance;
  }

  /**
   * Initialize the factory
   */
  async initialize(): Promise<void> {
    try {
      await this.userDbInitializer.initializeDatabaseSystem();
      logger.info('UserDatabaseManagerFactory initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize UserDatabaseManagerFactory:', error);
      throw error;
    }
  }

  /**
   * Get a database manager for a specific user
   * Uses caching for performance but ensures data isolation
   * @param userId User ID to get database manager for
   */
  async getUserDatabaseManager(userId: string): Promise<DatabaseManager> {
    if (!userId) {
      throw new Error('User ID is required to get database manager');
    }

    // Check cache first
    const cached = this.dbManagerCache.get(userId);
    const cacheTime = this.cacheTimestamps.get(userId);
    
    if (cached && cacheTime && (Date.now() - cacheTime) < this.CACHE_TTL) {
      return cached;
    }

    try {
      // Get or create user database manager
      const dbManager = await this.userDbInitializer.getUserDatabaseManager(userId);
      
      // Cache the result
      this.dbManagerCache.set(userId, dbManager);
      this.cacheTimestamps.set(userId, Date.now());
      
      logger.debug(`Retrieved database manager for user ${userId}`);
      return dbManager;
    } catch (error) {
      logger.error(`Failed to get database manager for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Initialize database for a new user
   * @param userId User ID to initialize database for
   */
  async initializeUserDatabase(userId: string): Promise<DatabaseManager> {
    if (!userId) {
      throw new Error('User ID is required to initialize database');
    }

    try {
      const dbManager = await this.userDbInitializer.initializeUserDatabase(userId);
      
      // Cache the result
      this.dbManagerCache.set(userId, dbManager);
      this.cacheTimestamps.set(userId, Date.now());
      
      logger.info(`Initialized database for user ${userId}`);
      return dbManager;
    } catch (error) {
      logger.error(`Failed to initialize database for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Clear cache for a specific user (useful for testing or when user is deleted)
   * @param userId User ID to clear cache for
   */
  clearUserCache(userId: string): void {
    this.dbManagerCache.delete(userId);
    this.cacheTimestamps.delete(userId);
    logger.debug(`Cleared cache for user ${userId}`);
  }

  /**
   * Clear all cached database managers
   */
  clearAllCache(): void {
    this.dbManagerCache.clear();
    this.cacheTimestamps.clear();
    logger.debug('Cleared all database manager cache');
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): {
    totalCached: number;
    cacheHitRate: number;
    oldestCacheEntry: number | null;
  } {
    const now = Date.now();
    const timestamps = Array.from(this.cacheTimestamps.values());
    const oldestEntry = timestamps.length > 0 ? Math.min(...timestamps) : null;
    
    return {
      totalCached: this.dbManagerCache.size,
      cacheHitRate: 0, // Would need to track hits/misses for accurate calculation
      oldestCacheEntry: oldestEntry ? now - oldestEntry : null
    };
  }

  /**
   * Reset singleton instance (for testing)
   */
  static resetInstance(): void {
    if (UserDatabaseManagerFactory.instance) {
      UserDatabaseManagerFactory.instance.clearAllCache();
    }
    UserDatabaseManagerFactory.instance = null as any;
  }
}

// Export singleton instance for convenience
export const userDatabaseManagerFactory = UserDatabaseManagerFactory.getInstance();
