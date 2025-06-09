import { logger } from '../utils/logger.js';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry<any>>;
  private defaultTTL: number;

  constructor(defaultTTL: number = 3600000) { // Default 1 hour
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }

  /**
   * Generate cache key for email list
   */
  static emailListKey(options: any): string {
    return `email-list:${JSON.stringify(options)}`;
  }

  static initialize(){
     
  }

  /**
   * Generate cache key for email details
   */
  static emailKey(messageId: string): string {
    return `email:${messageId}`;
  }

  /**
   * Generate cache key for category stats
   */
  static categoryStatsKey(): string {
    return 'category-stats';
  }

  /**
   * Get item from cache
   */
  get<T>(key: string): T | null {
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

    logger.debug(`Cache hit for key: ${key}`);
    return entry.data as T;
  }

  /**
   * Set item in cache
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    };

    this.cache.set(key, entry);
    logger.debug(`Cached data for key: ${key}`);
  }

  /**
   * Delete item from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clean expired entries
   */
  cleanExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.timestamp + entry.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} expired cache entries`);
    }
  }

  /**
   * Flush all cache (alias for clear)
   */
  flush(): void {
    this.clear();
  }
}