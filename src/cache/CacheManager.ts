import { logger } from '../utils/logger.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  userId?: string; // User who owns this cache entry
}

/**
 * Cache manager with support for user-specific caching and data isolation
 */
export class CacheManager {
  private cache: Map<string, CacheEntry<any>>;
  private defaultTTL: number;

  constructor(defaultTTL: number = 3600000) { // Default 1 hour
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }



  /**
   * Generate cache key for email list with user context
   * @param userId User ID for isolation
   * @param options Email list options
   */
  static emailListKey(userId: string, options: any): string {
    return `user:${userId}:email-list:${JSON.stringify(options)}`;
  }

  static async initialize(){
    // using in-memory cache for now
    return new CacheManager();
  }

  /**
   * Generate cache key for email details with user context
   * @param userId User ID for isolation
   * @param messageId Email message ID
   */
  static emailKey(userId: string, messageId: string): string {
    return `user:${userId}:email:${messageId}`;
  }

  /**
   * Generate cache key for category stats with user context
   * @param userId User ID for isolation
   */
  static categoryStatsKey(userId: string): string {
    return `user:${userId}:category-stats`;
  }

  /**
   * Generate a namespaced key for any cache entry
   * @param userId User ID for isolation
   * @param keyType Type of cache entry
   * @param identifier Specific identifier
   */
  static userScopedKey(userId: string, keyType: string, identifier?: string): string {
    return identifier
      ? `user:${userId}:${keyType}:${identifier}`
      : `user:${userId}:${keyType}`;
  }
  
  /**
   * Check if cache has a key
   * @param key Cache key to check
   * @param userId Optional user ID for access validation
   */
  has(key: string, userId?: string): boolean {
    const entry = this.cache.get(key);
    
    // If userId is provided, validate ownership
    if (entry && userId && entry.userId && entry.userId !== userId) {
      logger.warn(`User ${userId} attempted to access cache entry owned by ${entry.userId}`);
      return false;
    }
    
    return this.cache.has(key);
  }
  
  /**
   * Get cache statistics
   * @param userId Optional user ID to get stats for specific user
   */
  stats(userId?: string) {
    if (!userId) {
      return {
        keys: this.cache.size,
        hits: 0,  // Not tracked in this implementation
        misses: 0, // Not tracked in this implementation
        size: 0    // Memory size not tracked
      };
    }
    
    // Count entries belonging to this user
    let userKeys = 0;
    for (const [_, entry] of this.cache.entries()) {
      if (entry.userId === userId) {
        userKeys++;
      }
    }
    
    return {
      keys: userKeys,
      hits: 0,  // Not tracked in this implementation
      misses: 0, // Not tracked in this implementation
      size: 0    // Memory size not tracked
    };
  }

  /**
   * Get item from cache with user validation
   * @param key Cache key
   * @param userId Optional user ID for access validation
   */
  get<T>(key: string, userId?: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() > entry.timestamp + entry.ttl) {
      this.cache.delete(key);
      logger.debug(`Cache expired for key: ${key}`);
      return null;
    }
    
    // If userId is provided, validate ownership
    if (userId && entry.userId && entry.userId !== userId) {
      logger.warn(`User ${userId} attempted to access cache entry owned by ${entry.userId}`);
      return null;
    }

    logger.debug(`Cache hit for key: ${key}${userId ? ` for user ${userId}` : ''}`);
    return entry.data as T;
  }

  /**
   * Set item in cache with user context
   * @param key Cache key
   * @param data Data to cache
   * @param userId Optional user ID for ownership
   * @param ttl Optional TTL in ms
   */
  set<T>(key: string, data: T, userId?: string, ttl?: number): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL,
      userId // Add user context to entry
    };

    this.cache.set(key, entry);
    logger.debug(`Cached data for key: ${key}${userId ? ` for user ${userId}` : ''}`);
  }

  /**
   * Delete item from cache with user validation
   * @param key Cache key
   * @param userId Optional user ID for access validation
   */
  delete(key: string, userId?: string): boolean {
    // If userId is provided, validate ownership before deleting
    if (userId) {
      const entry = this.cache.get(key);
      if (entry && entry.userId && entry.userId !== userId) {
        logger.warn(`User ${userId} attempted to delete cache entry owned by ${entry.userId}`);
        return false;
      }
    }
    
    return this.cache.delete(key);
  }

  /**
   * Clear all cache or just entries for a specific user
   * @param userId Optional user ID to clear only user-specific cache
   */
  clear(userId?: string): void {
    if (!userId) {
      // Clear all cache if no user specified
      this.cache.clear();
      logger.info('Cache cleared completely');
      return;
    }
    
    // Clear only cache entries for specific user
    let cleared = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.userId === userId) {
        this.cache.delete(key);
        cleared++;
      }
    }
    
    logger.info(`Cleared ${cleared} cache entries for user ${userId}`);
  }

  /**
   * Get cache size, optionally for a specific user
   * @param userId Optional user ID to get size for specific user
   */
  size(userId?: string): number {
    if (!userId) {
      return this.cache.size;
    }
    
    // Count entries belonging to this user
    let count = 0;
    for (const [_, entry] of this.cache.entries()) {
      if (entry.userId === userId) {
        count++;
      }
    }
    
    return count;
  }

  /**
   * Clean expired entries, optionally only for a specific user
   * @param userId Optional user ID to clean only user-specific entries
   */
  cleanExpired(userId?: string): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      // Skip entries not belonging to the specified user if userId is provided
      if (userId && entry.userId !== userId) {
        continue;
      }
      
      if (now > entry.timestamp + entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} expired cache entries${userId ? ` for user ${userId}` : ''}`);
    }
  }

  /**
   * Flush all cache or just entries for a specific user (alias for clear)
   * @param userId Optional user ID to flush only user-specific cache
   */
  flush(userId?: string): void {
    this.clear(userId);
  }

  /**
   * Get all keys belonging to a specific user
   * @param userId User ID to get keys for
   */
  getUserKeys(userId: string): string[] {
    const keys: string[] = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.userId === userId) {
        keys.push(key);
      }
    }
    
    return keys;
  }
}