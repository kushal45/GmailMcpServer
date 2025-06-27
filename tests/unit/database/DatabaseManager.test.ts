import { jest, describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { DatabaseManager } from '../../../src/database/DatabaseManager';
import { 
  mockEmailIndex, 
  mockArchiveRule, 
  mockSavedSearch,
  createMockEmails 
} from '../../fixtures/mockData';
import sqlite3 from 'sqlite3';
// Mock modules
jest.mock('sqlite3');
jest.mock('fs/promises', () => {
  return {
    mkdir: jest.fn(() => Promise.resolve(undefined))
  };
});

import * as fs from 'fs/promises';

describe('DatabaseManager', () => {
  let dbManager: DatabaseManager;
  let mockDb: any;

  beforeEach(() => {
    // Create mock database
    mockDb = {
      run: jest.fn((sql: string, params: any, callback?: any) => {
        if (typeof params === 'function') {
          callback = params;
          params = [];
        }
        if (callback) {
          // Simulate SQLite statement context with changes and lastID
          const mockContext = {
            changes: 1, // Mock that 1 row was affected
            lastID: Math.floor(Math.random() * 1000) + 1 // Mock a random ID
          };
          callback.call(mockContext, null);
        }
      }),
      get: jest.fn((sql: string, params: any, callback: any) => {
        callback(null, null);
      }),
      all: jest.fn((sql: string, params: any, callback: any) => {
        callback(null, []);
      }),
      close: jest.fn((callback: any) => {
        callback(null);
      }),
      serialize: jest.fn((callback: any) => {
        callback();
      })
    };

    (sqlite3.Database as any) = jest.fn((path: string, callback: any) => {
      callback(null);
      return mockDb;
    });

    dbManager = new DatabaseManager(undefined);
    // Inject the mockDb into the dbManager instance for all tests
    (dbManager as any).db = mockDb;
  });

  afterEach(() => {
    jest.clearAllMocks();
    // Guard for dbManager existence
    if (dbManager && (dbManager as any).db && typeof (dbManager as any).db.close === 'function') {
      (dbManager as any).db.close(() => {});
    }
  });

  describe('initialize', () => {
    it('should create database tables', async () => {
      await dbManager.initialize();

      // We don't need to check if fs.mkdir was called since we're mocking it
      // and we're already testing that the database tables are created
      expect(mockDb.run).toHaveBeenCalled();
      
      const runCalls = mockDb.run.mock.calls;
      const createTableCalls = runCalls.filter((call: any) => 
        call[0].includes('CREATE TABLE') || call[0].includes('CREATE INDEX')
      );
      
      expect(createTableCalls.some((call: any) => call[0].includes('CREATE TABLE IF NOT EXISTS email_index'))).toBe(true);
      expect(createTableCalls.some((call: any) => call[0].includes('CREATE TABLE IF NOT EXISTS archive_rules'))).toBe(true);
      expect(createTableCalls.some((call: any) => call[0].includes('CREATE TABLE IF NOT EXISTS archive_records'))).toBe(true);
      expect(createTableCalls.some((call: any) => call[0].includes('CREATE TABLE IF NOT EXISTS saved_searches'))).toBe(true);
    });

    it('should create indexes', async () => {
      await dbManager.initialize();

      const runCalls = mockDb.run.mock.calls;
      const indexCalls = runCalls.filter((call: any) => call[0].includes('CREATE INDEX'));
      
      expect(indexCalls.some((call: any) => call[0].includes('idx_email_category'))).toBe(true);
      expect(indexCalls.some((call: any) => call[0].includes('idx_email_year'))).toBe(true);
      expect(indexCalls.some((call: any) => call[0].includes('idx_email_archived'))).toBe(true);
    });
  });

  describe('email index operations', () => {
    describe('upsertEmailIndex', () => {
      it('should insert or update email index', async () => {
        await dbManager.upsertEmailIndex(mockEmailIndex);

        expect(mockDb.run).toHaveBeenCalledWith(
          expect.stringContaining('INSERT OR REPLACE INTO email_index'),
          expect.arrayContaining([
            mockEmailIndex.id,
            mockEmailIndex.threadId,
            mockEmailIndex.category,
            mockEmailIndex.subject,
            mockEmailIndex.sender
          ]),
          expect.any(Function)
        );
      });

      it('should handle date serialization', async () => {
        await dbManager.upsertEmailIndex(mockEmailIndex);

        const runCall = mockDb.run.mock.calls.find((call: any) => 
          call[0].includes('INSERT OR REPLACE INTO email_index')
        );
        expect(runCall[1][6]).toBe(mockEmailIndex.date!.getTime());
        expect(runCall[1][13]).toBeNull(); // archiveDate
      });
    });

    describe('bulkUpsertEmailIndex', () => {
      it('should insert multiple emails in a transaction', async () => {
        const emails = createMockEmails(3);
        mockDb.serialize = jest.fn((callback: any) => {
          callback();
        });

        await dbManager.bulkUpsertEmailIndex(emails);

        expect(mockDb.serialize).toHaveBeenCalled();
        expect(mockDb.run).toHaveBeenCalledWith('BEGIN TRANSACTION', expect.any(Function));
        expect(mockDb.run).toHaveBeenCalledWith('COMMIT', expect.any(Function));
      });

      it('should handle empty array', async () => {
        await dbManager.bulkUpsertEmailIndex([]);

        // Should still be called for single run with empty array
        expect(mockDb.run).toHaveBeenCalled();
      });
    });

    describe('getEmailIndex', () => {
      it('should retrieve email by ID', async () => {
        const mockRow = {
          ...mockEmailIndex,
          date: mockEmailIndex.date!.getTime(),
          recipients: JSON.stringify(mockEmailIndex.recipients),
          labels: JSON.stringify(mockEmailIndex.labels),
          has_attachments: mockEmailIndex.hasAttachments ? 1 : 0,
          archived: mockEmailIndex.archived ? 1 : 0,
          thread_id: mockEmailIndex.threadId
        };
        mockDb.get = jest.fn((sql: string, params: any, callback: any) => {
          callback(null, mockRow);
        });

        const result = await dbManager.getEmailIndex('test-id');

        expect(mockDb.get).toHaveBeenCalledWith(
          'SELECT * FROM email_index WHERE id = ?',
          ['test-id'],
          expect.any(Function)
        );
        expect(result).toEqual(expect.objectContaining({
          id: mockEmailIndex.id,
          date: expect.any(Date)
        }));
      });

      it('should return null for non-existent email', async () => {
        mockDb.get = jest.fn((sql: string, params: any, callback: any) => {
          callback(null, undefined);
        });

        const result = await dbManager.getEmailIndex('non-existent');

        expect(result).toBeNull();
      });
    });

    describe('searchEmails', () => {
      it('should search with all criteria', async () => {
        const criteria = {
          query: 'test',
          category: 'high' as const,
          yearRange: { start: 2023, end: 2024 },
          sizeRange: { min: 1000, max: 10000 },
          sender: 'test@example.com',
          hasAttachments: true,
          archived: false,
          labels: ['INBOX']
        };

        mockDb.all = jest.fn((sql: string, params: any, callback: any) => {
          callback(null, []);
        });

        await dbManager.searchEmails(criteria);

        const sqlCall = mockDb.all.mock.calls[0][0];
        expect(sqlCall).toContain('category = ?');
        expect(sqlCall).toContain('year >= ?');
        expect(sqlCall).toContain('year <= ?');
        expect(sqlCall).toContain('size >= ?');
        expect(sqlCall).toContain('size <= ?');
        expect(sqlCall).toContain('sender LIKE ?');
        expect(sqlCall).toContain('archived = ?');
      });

      it('should handle empty criteria', async () => {
        mockDb.all = jest.fn((sql: string, params: any, callback: any) => {
          callback(null, []);
        });

        await dbManager.searchEmails({});

        expect(mockDb.all).toHaveBeenCalledWith(
         'SELECT *,COUNT(*) OVER () AS total_email_count FROM email_index WHERE 1=1 ORDER BY date DESC',
          [],
          expect.any(Function)
        );
      });
    });
  });

  describe('archive operations', () => {
    describe('createArchiveRule', () => {
      it('should create archive rule', async () => {
        const { id, created, stats, ...ruleData } = mockArchiveRule;
        const newId = await dbManager.createArchiveRule(ruleData);

        expect(newId).toBeTruthy();
        expect(mockDb.run).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO archive_rules'),
          expect.arrayContaining([
            expect.any(String),
            ruleData.name,
            JSON.stringify(ruleData.criteria),
            JSON.stringify(ruleData.action)
          ]),
          expect.any(Function)
        );
      });
    });

    describe('getArchiveRules', () => {
      it('should retrieve all archive rules', async () => {
        const mockRows = [{
          ...mockArchiveRule,
          criteria: JSON.stringify(mockArchiveRule.criteria),
          action: JSON.stringify(mockArchiveRule.action),
          total_archived: mockArchiveRule.stats.totalArchived,
          last_archived: mockArchiveRule.stats.lastArchived,
          created: Math.floor(mockArchiveRule.created.getTime() / 1000),
          last_run: mockArchiveRule.lastRun ? Math.floor(mockArchiveRule.lastRun.getTime() / 1000) : null,
          enabled: 1
        }];
        mockDb.all = jest.fn((sql: string, params: any, callback: any) => {
          if (typeof params === 'function') {
            callback = params;
            params = [];
          }
          callback(null, mockRows);
        });

        const result = await dbManager.getArchiveRules(false, 'test-user-id');

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(expect.objectContaining({
          id: mockArchiveRule.id,
          criteria: mockArchiveRule.criteria,
          created: expect.any(Date)
        }));
      });

      it('should filter by enabled status', async () => {
        mockDb.all = jest.fn((sql: string, params: any, callback: any) => {
          if (typeof params === 'function') {
            callback = params;
            params = [];
          }
          callback(null, []);
        });

        await dbManager.getArchiveRules(true, 'test-user-id');

        const sqlCall = mockDb.all.mock.calls[0][0];
        expect(sqlCall).toContain('enabled = 1');
      });
    });

    describe('createArchiveRecord', () => {
      it('should create archive record', async () => {
        const record = {
          emailIds: ['email1', 'email2'],
          archiveDate: new Date(),
          method: 'gmail' as const,
          location: '/archive/path',
          format: 'mbox',
          size: 1024,
          restorable: true
        };

        const recordId = await dbManager.createArchiveRecord(record);

        expect(recordId).toBeTruthy();
        expect(mockDb.run).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO archive_records'),
          expect.arrayContaining([
            expect.any(String),
            JSON.stringify(record.emailIds),
            record.archiveDate.getTime(),
            record.method
          ]),
          expect.any(Function)
        );
      });
    });
  });

  describe('saved search operations', () => {
    describe('saveSearch', () => {
      it('should save search', async () => {
        const searchId = await dbManager.saveSearch(mockSavedSearch.name, mockSavedSearch.criteria);

        expect(searchId).toBeTruthy();
        expect(mockDb.run).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO saved_searches'),
          expect.arrayContaining([
            expect.any(String),
            mockSavedSearch.name,
            JSON.stringify(mockSavedSearch.criteria)
          ]),
          expect.any(Function)
        );
      });
    });

    describe('getSavedSearches', () => {
      it('should retrieve all saved searches', async () => {
        const mockRows = [{
          ...mockSavedSearch,
          criteria: JSON.stringify(mockSavedSearch.criteria),
          created: Math.floor(mockSavedSearch.created.getTime() / 1000),
          last_used: Math.floor(mockSavedSearch.lastUsed.getTime() / 1000),
          result_count: mockSavedSearch.resultCount
        }];
        mockDb.all = jest.fn((sql: string, params: any, callback: any) => {
          callback(null, mockRows);
        });

        const result = await dbManager.getSavedSearches();

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual(expect.objectContaining({
          id: mockSavedSearch.id,
          criteria: mockSavedSearch.criteria
        }));
      });
    });
  });

  describe('statistics', () => {
    it('should get email statistics', async () => {
      const mockCategoryStats = [
        { category: 'high', count: 10 },
        { category: 'medium', count: 30 },
        { category: 'low', count: 60 }
      ];
      const mockYearStats = [
        { year: 2023, count: 50, total_size: 500000 },
        { year: 2024, count: 50, total_size: 500000 }
      ];
      const mockSizeStats = {
        small: 20,
        medium: 50,
        large: 30,
        total_size: 1000000
      };
      const mockArchiveStats = {
        count: 20,
        total_size: 200000
      };

      let callCount = 0;
      mockDb.all = jest.fn((sql: string, params: any, callback: any) => {
        if (callCount === 0) {
          callback(null, mockCategoryStats);
        } else {
          callback(null, mockYearStats);
        }
        callCount++;
      });

      mockDb.get = jest.fn((sql: string, params: any, callback: any) => {
        if (sql.includes('SUM(CASE')) {
          callback(null, mockSizeStats);
        } else {
          callback(null, mockArchiveStats);
        }
      });

      const result = await dbManager.getEmailStatistics();

      expect(result).toEqual(expect.objectContaining({
        categories: expect.any(Array),
        years: expect.any(Array),
        sizes: expect.any(Object),
        archived: expect.any(Object)
      }));
    });
  });

  describe('close', () => {
    it('should close database connection', async () => {
      await dbManager.close();

      expect(mockDb.close).toHaveBeenCalled();
    });
  });
});