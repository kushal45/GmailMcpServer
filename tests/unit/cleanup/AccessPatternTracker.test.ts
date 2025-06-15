import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AccessPatternTracker } from '../../../src/cleanup/AccessPatternTracker.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { EmailAccessEvent, SearchActivityRecord } from '../../../src/types/index.js';

describe('AccessPatternTracker', () => {
  let accessTracker: AccessPatternTracker;
  let mockDatabaseManager: any;

  beforeEach(() => {
    // Create a comprehensive mock of DatabaseManager
    mockDatabaseManager = {
      logEmailAccess: jest.fn<() => Promise<void>>().mockResolvedValue(),
      logSearchActivity: jest.fn<() => Promise<void>>().mockResolvedValue(),
      updateAccessSummary: jest.fn<() => Promise<void>>().mockResolvedValue(),
      getAccessSummary: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      cleanupOldAccessLogs: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      // Use Object.defineProperty to mock private methods
    };

    // Mock private methods using Object.defineProperty
    Object.defineProperty(mockDatabaseManager, 'all', {
      value: jest.fn<() => Promise<any[]>>().mockResolvedValue([]),
      writable: true
    });

    Object.defineProperty(mockDatabaseManager, 'get', {
      value: jest.fn<() => Promise<any>>().mockResolvedValue(null),
      writable: true
    });

    // Mock DatabaseManager.getInstance
    jest.spyOn(DatabaseManager, 'getInstance').mockReturnValue(mockDatabaseManager);
    
    accessTracker = new AccessPatternTracker(mockDatabaseManager);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Email Access Logging', () => {
    test('should log email access event successfully', async () => {
      const accessEvent: EmailAccessEvent = {
        email_id: 'test-email-1',
        access_type: 'direct_view',
        timestamp: new Date(),
        search_query: 'test query',
        user_context: 'test context'
      };

      await accessTracker.logEmailAccess(accessEvent);

      expect(mockDatabaseManager.logEmailAccess).toHaveBeenCalledWith(accessEvent);
      expect(mockDatabaseManager.updateAccessSummary).toHaveBeenCalledWith('test-email-1');
    });

    test('should handle different access types', async () => {
      const accessTypes = ['search_result', 'direct_view', 'thread_view'] as const;
      
      for (const accessType of accessTypes) {
        const accessEvent: EmailAccessEvent = {
          email_id: `test-email-${accessType}`,
          access_type: accessType,
          timestamp: new Date()
        };

        await accessTracker.logEmailAccess(accessEvent);
        
        expect(mockDatabaseManager.logEmailAccess).toHaveBeenCalledWith(
          expect.objectContaining({ access_type: accessType })
        );
      }
    });

    test('should handle access logging errors gracefully', async () => {
      const accessEvent: EmailAccessEvent = {
        email_id: 'test-email-1',
        access_type: 'direct_view',
        timestamp: new Date()
      };

      mockDatabaseManager.logEmailAccess.mockRejectedValue(new Error('Database error'));

      await expect(accessTracker.logEmailAccess(accessEvent)).rejects.toThrow('Database error');
    });

    test('should handle optional fields correctly', async () => {
      const minimalEvent: EmailAccessEvent = {
        email_id: 'test-email-1',
        access_type: 'direct_view',
        timestamp: new Date()
      };

      await accessTracker.logEmailAccess(minimalEvent);

      expect(mockDatabaseManager.logEmailAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          email_id: 'test-email-1',
          access_type: 'direct_view',
          timestamp: expect.any(Date)
        })
      );
      
      // Verify optional fields are not present (not undefined, just absent)
      const calledWith = mockDatabaseManager.logEmailAccess.mock.calls[0][0];
      expect(calledWith).not.toHaveProperty('search_query');
      expect(calledWith).not.toHaveProperty('user_context');
    });
  });

  describe('Search Activity Logging', () => {
    test('should log search activity successfully', async () => {
      const searchRecord: SearchActivityRecord = {
        search_id: 'search-1',
        query: 'test query',
        email_results: ['email-1', 'email-2', 'email-3'],
        result_interactions: ['email-1'],
        timestamp: new Date()
      };

      await accessTracker.logSearchActivity(searchRecord);

      expect(mockDatabaseManager.logSearchActivity).toHaveBeenCalledWith(searchRecord);
      expect(mockDatabaseManager.updateAccessSummary).toHaveBeenCalledTimes(3);
    });

    test('should handle empty search results', async () => {
      const searchRecord: SearchActivityRecord = {
        search_id: 'search-empty',
        query: 'no results',
        email_results: [],
        result_interactions: [],
        timestamp: new Date()
      };

      await accessTracker.logSearchActivity(searchRecord);

      expect(mockDatabaseManager.logSearchActivity).toHaveBeenCalledWith(searchRecord);
      expect(mockDatabaseManager.updateAccessSummary).not.toHaveBeenCalled();
    });

    test('should handle search activity errors', async () => {
      const searchRecord: SearchActivityRecord = {
        search_id: 'search-error',
        query: 'error query',
        email_results: ['email-1'],
        result_interactions: [],
        timestamp: new Date()
      };

      mockDatabaseManager.logSearchActivity.mockRejectedValue(new Error('Search logging failed'));

      await expect(accessTracker.logSearchActivity(searchRecord)).rejects.toThrow('Search logging failed');
    });
  });

  describe('Access Summary Management', () => {
    test('should update access summary successfully', async () => {
      await accessTracker.updateAccessSummary('test-email-1');

      expect(mockDatabaseManager.updateAccessSummary).toHaveBeenCalledWith('test-email-1');
    });

    test('should get access summary successfully', async () => {
      const mockSummary = {
        email_id: 'test-email-1',
        total_accesses: 5,
        last_accessed: new Date(),
        search_appearances: 3,
        search_interactions: 2,
        access_score: 0.75,
        updated_at: new Date()
      };

      mockDatabaseManager.getAccessSummary.mockResolvedValue(mockSummary);

      const result = await accessTracker.getAccessSummary('test-email-1');

      expect(result).toEqual(mockSummary);
      expect(mockDatabaseManager.getAccessSummary).toHaveBeenCalledWith('test-email-1');
    });

    test('should return null for non-existent email', async () => {
      mockDatabaseManager.getAccessSummary.mockResolvedValue(null);

      const result = await accessTracker.getAccessSummary('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('Access Score Calculation', () => {
    test('should calculate access score correctly with full data', async () => {
      const mockSummary = {
        email_id: 'test-email-1',
        total_accesses: 10,
        last_accessed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        search_appearances: 5,
        search_interactions: 3,
        access_score: 0,
        updated_at: new Date()
      };

      mockDatabaseManager.getAccessSummary.mockResolvedValue(mockSummary);

      const score = await accessTracker.calculateAccessScore('test-email-1');

      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(typeof score).toBe('number');
    });

    test('should return 0 for email with no access data', async () => {
      mockDatabaseManager.getAccessSummary.mockResolvedValue(null);

      const score = await accessTracker.calculateAccessScore('no-access-email');

      expect(score).toBe(0);
    });

    test('should handle calculation errors gracefully', async () => {
      mockDatabaseManager.getAccessSummary.mockRejectedValue(new Error('Database error'));

      const score = await accessTracker.calculateAccessScore('error-email');

      expect(score).toBe(0);
    });

    test('should normalize access scores correctly', async () => {
      const highAccessSummary = {
        email_id: 'high-access',
        total_accesses: 100,
        last_accessed: new Date(), // Very recent
        search_appearances: 50,
        search_interactions: 25,
        access_score: 0,
        updated_at: new Date()
      };

      mockDatabaseManager.getAccessSummary.mockResolvedValue(highAccessSummary);

      const score = await accessTracker.calculateAccessScore('high-access');

      expect(score).toBeGreaterThan(0.5);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe('Frequently Accessed Emails', () => {
    test('should get frequently accessed emails', async () => {
      const mockRows = [
        { email_id: 'email-1' },
        { email_id: 'email-2' },
        { email_id: 'email-3' }
      ];

      mockDatabaseManager.all.mockResolvedValue(mockRows);

      const result = await accessTracker.getFrequentlyAccessedEmails(5);

      expect(result).toEqual(['email-1', 'email-2', 'email-3']);
      expect(mockDatabaseManager.all).toHaveBeenCalledWith(
        expect.stringContaining('access_score > 0.5'),
        [5]
      );
    });

    test('should handle empty frequently accessed results', async () => {
      mockDatabaseManager.all.mockResolvedValue([]);

      const result = await accessTracker.getFrequentlyAccessedEmails(10);

      expect(result).toEqual([]);
    });

    test('should handle database errors in frequently accessed', async () => {
      mockDatabaseManager.all.mockRejectedValue(new Error('Database error'));

      const result = await accessTracker.getFrequentlyAccessedEmails(5);

      expect(result).toEqual([]);
    });
  });

  describe('Unused Emails', () => {
    test('should get unused emails correctly', async () => {
      const mockRows = [
        { id: 'email-1' },
        { id: 'email-2' }
      ];

      mockDatabaseManager.all.mockResolvedValue(mockRows);

      const result = await accessTracker.getUnusedEmails(30, 10);

      expect(result).toEqual(['email-1', 'email-2']);
      expect(mockDatabaseManager.all).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN email_access_summary'),
        expect.arrayContaining([expect.any(Number), 10])
      );
    });

    test('should handle unlimited unused emails query', async () => {
      const mockRows = [{ id: 'email-1' }];
      mockDatabaseManager.all.mockResolvedValue(mockRows);

      const result = await accessTracker.getUnusedEmails(30);

      expect(result).toEqual(['email-1']);
    });
  });

  describe('Access Analytics', () => {
    test('should generate comprehensive access analytics', async () => {
      // Mock database responses for analytics
      mockDatabaseManager.get
        .mockResolvedValueOnce({ count: 100 }) // total access events
        .mockResolvedValueOnce({ count: 25 }) // unique emails accessed

      mockDatabaseManager.all
        .mockResolvedValueOnce([ // most accessed emails
          { email_id: 'email-1', access_count: 10 },
          { email_id: 'email-2', access_count: 8 }
        ])
        .mockResolvedValueOnce([ // hourly patterns
          { hour: 9, access_count: 15 },
          { hour: 14, access_count: 20 }
        ]);

      const analytics = await accessTracker.generateAccessAnalytics(30);

      expect(analytics).toEqual({
        total_access_events: 100,
        unique_emails_accessed: 25,
        average_accesses_per_email: 4,
        most_accessed_emails: [
          { email_id: 'email-1', access_count: 10 },
          { email_id: 'email-2', access_count: 8 }
        ],
        access_patterns_by_hour: [
          { hour: 9, access_count: 15 },
          { hour: 14, access_count: 20 }
        ]
      });
    });

    test('should handle analytics generation errors', async () => {
      mockDatabaseManager.get.mockRejectedValue(new Error('Analytics error'));

      const analytics = await accessTracker.generateAccessAnalytics(30);

      expect(analytics).toEqual({
        total_access_events: 0,
        unique_emails_accessed: 0,
        average_accesses_per_email: 0,
        most_accessed_emails: [],
        access_patterns_by_hour: []
      });
    });
  });

  describe('Cleanup Operations', () => {
    test('should cleanup old access logs successfully', async () => {
      mockDatabaseManager.cleanupOldAccessLogs.mockResolvedValue(50);

      const deletedCount = await accessTracker.cleanupOldAccessLogs(90);

      expect(deletedCount).toBe(50);
      expect(mockDatabaseManager.cleanupOldAccessLogs).toHaveBeenCalledWith(90);
    });

    test('should handle cleanup errors gracefully', async () => {
      mockDatabaseManager.cleanupOldAccessLogs.mockRejectedValue(new Error('Cleanup failed'));

      const deletedCount = await accessTracker.cleanupOldAccessLogs(90);

      expect(deletedCount).toBe(0);
    });
  });

  describe('Batch Operations', () => {
    test('should batch update access summaries', async () => {
      const emailIds = ['email-1', 'email-2', 'email-3', 'email-4', 'email-5'];

      await accessTracker.batchUpdateAccessSummaries(emailIds);

      expect(mockDatabaseManager.updateAccessSummary).toHaveBeenCalledTimes(5);
      emailIds.forEach(id => {
        expect(mockDatabaseManager.updateAccessSummary).toHaveBeenCalledWith(id);
      });
    });

    test('should handle batch update errors', async () => {
      const emailIds = ['email-1', 'email-2'];
      mockDatabaseManager.updateAccessSummary
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Update failed'));

      await expect(accessTracker.batchUpdateAccessSummaries(emailIds)).rejects.toThrow('Update failed');
    });

    test('should process large batches correctly', async () => {
      // Create 150 email IDs to test batching (batch size is 50)
      const emailIds = Array.from({ length: 150 }, (_, i) => `email-${i}`);

      await accessTracker.batchUpdateAccessSummaries(emailIds);

      expect(mockDatabaseManager.updateAccessSummary).toHaveBeenCalledTimes(150);
    });
  });

  describe('Edge Cases', () => {
    test('should handle invalid email IDs', async () => {
      const invalidAccessEvent: EmailAccessEvent = {
        email_id: '',
        access_type: 'direct_view',
        timestamp: new Date()
      };

      await accessTracker.logEmailAccess(invalidAccessEvent);

      expect(mockDatabaseManager.logEmailAccess).toHaveBeenCalledWith(invalidAccessEvent);
    });

    test('should handle very old timestamps', async () => {
      const oldTimestamp = new Date('1990-01-01');
      const accessEvent: EmailAccessEvent = {
        email_id: 'test-email',
        access_type: 'direct_view',
        timestamp: oldTimestamp
      };

      await accessTracker.logEmailAccess(accessEvent);

      expect(mockDatabaseManager.logEmailAccess).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: oldTimestamp })
      );
    });

    test('should handle future timestamps', async () => {
      const futureTimestamp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const accessEvent: EmailAccessEvent = {
        email_id: 'test-email',
        access_type: 'direct_view',
        timestamp: futureTimestamp
      };

      await accessTracker.logEmailAccess(accessEvent);

      expect(mockDatabaseManager.logEmailAccess).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: futureTimestamp })
      );
    });

    test('should handle extremely large search results', async () => {
      const largeEmailList = Array.from({ length: 1000 }, (_, i) => `email-${i}`);
      const searchRecord: SearchActivityRecord = {
        search_id: 'large-search',
        query: 'large query',
        email_results: largeEmailList,
        result_interactions: [],
        timestamp: new Date()
      };

      await accessTracker.logSearchActivity(searchRecord);

      expect(mockDatabaseManager.logSearchActivity).toHaveBeenCalledWith(searchRecord);
      // Should call updateAccessSummary for each email
      expect(mockDatabaseManager.updateAccessSummary).toHaveBeenCalledTimes(1000);
    });

    test('should handle Unicode and special characters in queries', async () => {
      const unicodeQuery = 'test 🚀 query with émojis and spëcial chars 中文';
      const searchRecord: SearchActivityRecord = {
        search_id: 'unicode-search',
        query: unicodeQuery,
        email_results: ['email-1'],
        result_interactions: [],
        timestamp: new Date()
      };

      await accessTracker.logSearchActivity(searchRecord);

      expect(mockDatabaseManager.logSearchActivity).toHaveBeenCalledWith(
        expect.objectContaining({ query: unicodeQuery })
      );
    });
  });

  describe('Singleton Pattern', () => {
    test('should maintain singleton instance', () => {
      const instance1 = AccessPatternTracker.getInstance();
      const instance2 = AccessPatternTracker.getInstance();

      expect(instance1).toBe(instance2);
    });

    test('should use provided database manager in constructor', () => {
      const customDbManager = mockDatabaseManager;
      const tracker = new AccessPatternTracker(customDbManager);

      // Since we can't directly test the private property, we test behavior
      expect(tracker).toBeInstanceOf(AccessPatternTracker);
    });
  });
});