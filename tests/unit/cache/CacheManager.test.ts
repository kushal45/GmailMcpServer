import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { CacheManager } from '../../../src/cache/CacheManager';
import { mockEmailIndex, mockSearchCriteria } from '../../fixtures/mockData';

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('get and set', () => {
    it('should store and retrieve values', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };

      cacheManager.set(key, value);
      const retrieved = cacheManager.get(key);

      expect(retrieved).toEqual(value);
    });

    it('should return null for non-existent keys', () => {
      const result = cacheManager.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('should handle different data types', () => {
      cacheManager.set('string', 'test string');
      cacheManager.set('number', 42);
      cacheManager.set('boolean', true);
      cacheManager.set('array', [1, 2, 3]);
      cacheManager.set('object', { a: 1, b: 2 });

      expect(cacheManager.get('string')).toBe('test string');
      expect(cacheManager.get('number')).toBe(42);
      expect(cacheManager.get('boolean')).toBe(true);
      expect(cacheManager.get('array')).toEqual([1, 2, 3]);
      expect(cacheManager.get('object')).toEqual({ a: 1, b: 2 });
    });

    it('should respect TTL expiration', async () => {
      const key = 'ttl-test';
      const value = 'test-value';
      const userId = 'test-user';
      const ttl = 100; // 100ms

      cacheManager.set(key, value,userId, ttl);
      
      // Value should exist immediately
      expect(cacheManager.get(key)).toBe(value);

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Value should be gone
      expect(cacheManager.get(key)).toBeNull();
    });

    it('should update existing values', () => {
      const key = 'update-test';
      
      cacheManager.set(key, 'initial');
      expect(cacheManager.get(key)).toBe('initial');

      cacheManager.set(key, 'updated');
      expect(cacheManager.get(key)).toBe('updated');
    });
  });

  describe('delete', () => {
    it('should remove cached values', () => {
      const key = 'delete-test';
      cacheManager.set(key, 'value');

      expect(cacheManager.get(key)).toBe('value');
      
      cacheManager.delete(key);
      
      expect(cacheManager.get(key)).toBeNull();
    });

    it('should handle deleting non-existent keys', () => {
      // Should not throw
      expect(() => cacheManager.delete('non-existent')).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should remove all cached values', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.set('key2', 'value2');
      cacheManager.set('key3', 'value3');

      cacheManager.clear();

      expect(cacheManager.get('key1')).toBeNull();
      expect(cacheManager.get('key2')).toBeNull();
      expect(cacheManager.get('key3')).toBeNull();
    });
  });

  describe('size', () => {
    it('should return the number of cached items', () => {
      expect(cacheManager.size()).toBe(0);

      cacheManager.set('key1', 'value1');
      cacheManager.set('key2', 'value2');

      expect(cacheManager.size()).toBe(2);
    });
  });

  describe('cleanExpired', () => {
    it('should remove expired entries', async () => {
      const userId= 'test-user';
      cacheManager.set('permanent', 'value');
      cacheManager.set('temporary1', 'value',userId, 50);
      cacheManager.set('temporary2', 'value', userId,50);

      expect(cacheManager.size()).toBe(3);

      await new Promise(resolve => setTimeout(resolve, 100));

      cacheManager.cleanExpired();

      expect(cacheManager.size()).toBe(1);
      expect(cacheManager.get('permanent')).toBe('value');
      expect(cacheManager.get('temporary1')).toBeNull();
      expect(cacheManager.get('temporary2')).toBeNull();
    });
  });

  describe('flush', () => {
    it('should be an alias for clear', () => {
      cacheManager.set('key1', 'value1');
      cacheManager.set('key2', 'value2');

      cacheManager.flush();

      expect(cacheManager.size()).toBe(0);
      expect(cacheManager.get('key1')).toBeNull();
      expect(cacheManager.get('key2')).toBeNull();
    });
  });

  describe('static key generators', () => {
    it('should generate email list cache key', () => {
      const options = {
        category: 'high' as const,
        year: 2024,
        limit: 10,
        offset: 0
      };
      const userId=`test-user`;
      const key = CacheManager.emailListKey(userId,options);

      expect(key).toBe(`user:${userId}:email-list:${JSON.stringify(options)}`);
    });

    it('should handle partial options in email list key', () => {
      const options = {
        limit: 20,
        offset: 10
      };
      const userId=`test-user`;
      const key = CacheManager.emailListKey(userId,options);

      expect(key).toBe(`user:${userId}:email-list:${JSON.stringify(options)}`);
    });

    it('should generate email cache key', () => {
      const userId=`test-user`;
      const emailId = 'test-email-123';
      const key = CacheManager.emailKey(userId,emailId);

      expect(key).toBe(`user:${userId}:email:test-email-123`);
    });

    it('should generate category stats cache key', () => {
      const userId=`test-user`;
      const key = CacheManager.categoryStatsKey(userId);

      expect(key).toBe(`user:${userId}:category-stats`);
    });
  });


  describe('type safety', () => {
    it('should preserve types when storing and retrieving', () => {
      const emailIndex = mockEmailIndex;
      const key = 'typed-email';

      cacheManager.set(key, emailIndex);
      const retrieved = cacheManager.get<typeof emailIndex>(key);

      expect(retrieved).toEqual(emailIndex);
      expect(retrieved?.id).toBe(emailIndex.id);
      expect(retrieved?.category).toBe(emailIndex.category);
    });

    it('should handle arrays with type safety', () => {
      const emails = [mockEmailIndex];
      const key = 'email-array';

      cacheManager.set(key, emails);
      const retrieved = cacheManager.get<typeof emails>(key);

      expect(retrieved).toHaveLength(1);
      expect(retrieved?.[0].id).toBe(mockEmailIndex.id);
    });
  });

  describe('concurrent access', () => {
    it('should handle concurrent reads and writes', async () => {
      const promises: Promise<void>[] = [];

      // Simulate concurrent writes
      for (let i = 0; i < 100; i++) {
        promises.push(
          new Promise<void>(resolve => {
            setTimeout(() => {
              cacheManager.set(`key-${i}`, `value-${i}`);
              resolve();
            }, Math.random() * 10);
          })
        );
      }

      // Simulate concurrent reads
      for (let i = 0; i < 100; i++) {
        promises.push(
          new Promise<void>(resolve => {
            setTimeout(() => {
              cacheManager.get(`key-${i}`);
              resolve();
            }, Math.random() * 10);
          })
        );
      }

      await Promise.all(promises);

      // Verify all writes succeeded
      for (let i = 0; i < 100; i++) {
        expect(cacheManager.get(`key-${i}`)).toBe(`value-${i}`);
      }
    });
  });
});