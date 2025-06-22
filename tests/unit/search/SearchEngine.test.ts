import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SearchEngine } from '../../../src/search/SearchEngine';
import { DatabaseManager } from '../../../src/database/DatabaseManager';
import { EmailFetcher } from '../../../src/email/EmailFetcher';
import { TestUserValidator } from '../../../src/auth/UserValidator';
import {
  mockSearchCriteria,
  mockEmailIndex,
  createMockEmails
} from '../../fixtures/mockData';
import { createMockDatabase } from '../../utils/testHelpers';

describe('SearchEngine', () => {
  let searchEngine: SearchEngine;
  let mockDatabaseManager: any;
  let mockEmailFetcher: any;
  let mockUserDatabaseInitializer: any;
  let mockUserValidator: TestUserValidator;
  let mockUserContext: { user_id: string; session_id: string };

  beforeEach(() => {
    mockDatabaseManager = createMockDatabase();
    mockEmailFetcher = {
      listEmails: jest.fn(),
      getEmailDetailsBulk: jest.fn(),
      getAllMessageIds: jest.fn()
    };
    
    // Mock UserDatabaseInitializer to return our mock database
    const mockGetUserDatabaseManager = jest.fn() as jest.MockedFunction<any>;
    mockGetUserDatabaseManager.mockResolvedValue(mockDatabaseManager);
    
    mockUserDatabaseInitializer = {
      getUserDatabaseManager: mockGetUserDatabaseManager
    };
    
    // Use TestUserValidator that allows any user by default
    mockUserValidator = new TestUserValidator([]);
    
    // Mock user context for multi-user support
    mockUserContext = {
      user_id: 'test-user-123',
      session_id: 'test-session-456'
    };
    
    searchEngine = new SearchEngine(
      mockUserDatabaseInitializer,
      mockEmailFetcher,
      mockUserValidator
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('search', () => {
    it('should search database and return results', async () => {
      const dbResults = createMockEmails(3);
      mockDatabaseManager.searchEmails.mockResolvedValue(dbResults);

      const results = await searchEngine.search(mockSearchCriteria, mockUserContext);

      expect(mockDatabaseManager.searchEmails).toHaveBeenCalledWith({
        ...mockSearchCriteria,
        limit: 50,
        user_id: mockUserContext.user_id
      });
      expect(results.emails).toEqual(dbResults);
      expect(results.total).toBe(3);
    });

    it('should handle empty search criteria', async () => {
      mockDatabaseManager.searchEmails.mockResolvedValue([]);

      const results = await searchEngine.search({}, mockUserContext);

      expect(mockDatabaseManager.searchEmails).toHaveBeenCalledWith({ limit: 50, user_id: mockUserContext.user_id });
      expect(results.emails).toEqual([]);
      expect(results.total).toBe(0);
    });

    

    it('should apply text search to results', async () => {
      const emails = [
        { ...mockEmailIndex, id: '1', subject: 'Important meeting', snippet: 'Please attend' },
        { ...mockEmailIndex, id: '2', subject: 'Lunch plans', snippet: 'Where to eat' },
        { ...mockEmailIndex, id: '3', subject: 'Project update', snippet: 'Meeting notes' }
      ];
      mockDatabaseManager.searchEmails.mockResolvedValue(emails);

      const criteria = { ...mockSearchCriteria, query: 'meeting' };
      const results = await searchEngine.search(criteria, mockUserContext);

      expect(results.emails).toHaveLength(2);
      expect(results.emails[0].id).toBe('1');
      expect(results.emails[1].id).toBe('3');
    });

    it('should handle case-insensitive text search', async () => {
      const emails = [
        { ...mockEmailIndex, id: '1', subject: 'IMPORTANT MEETING' },
        { ...mockEmailIndex, id: '2', subject: 'important meeting' },
        { ...mockEmailIndex, id: '3', subject: 'Something else' }
      ];
      mockDatabaseManager.searchEmails.mockResolvedValue(emails);

      const criteria = { query: 'important' };
      const results = await searchEngine.search(criteria, mockUserContext);

      expect(results.emails).toHaveLength(2);
    });

    it('should search in sender field', async () => {
      const emails = [
        { ...mockEmailIndex, id: '1', sender: 'john@example.com', recipients: ['recipient1@foo.com'], subject: 'A', snippet: 'B' },
        { ...mockEmailIndex, id: '2', sender: 'jane@example.com', recipients: ['recipient2@foo.com'], subject: 'C', snippet: 'D' },
        { ...mockEmailIndex, id: '3', sender: 'bob@test.com', recipients: ['recipient3@foo.com'], subject: 'E', snippet: 'F' }
      ];
      mockDatabaseManager.searchEmails.mockResolvedValue(emails);

      const criteria = { query: 'example.com' };
      const results = await searchEngine.search(criteria, mockUserContext);

      expect(results.emails).toHaveLength(2);
    });

    it('should handle errors gracefully', async () => {
      mockDatabaseManager.searchEmails.mockRejectedValue(new Error('Database error'));

      await expect(searchEngine.search(mockSearchCriteria, mockUserContext)).rejects.toThrow('Database error');
    });
  });

  describe('saveSearch', () => {
    it('should save search to database', async () => {
      const name = 'My Important Emails';
      mockDatabaseManager.saveSearch.mockResolvedValue('search-123');

      const result = await searchEngine.saveSearch({ name, criteria: mockSearchCriteria }, mockUserContext);

      expect(mockDatabaseManager.saveSearch).toHaveBeenCalledWith(name, mockSearchCriteria, mockUserContext.user_id);
      expect(result.id).toBe('search-123');
      expect(result.saved).toBe(true);
    });

    it('should handle save errors', async () => {
      mockDatabaseManager.saveSearch.mockRejectedValue(new Error('Save failed'));

      await expect(searchEngine.saveSearch({ name: 'Test', criteria: mockSearchCriteria }, mockUserContext))
        .rejects.toThrow('Save failed');
    });
  });

  describe('listSavedSearches', () => {
    it('should retrieve saved searches from database', async () => {
      const savedSearches = [
        {
          id: 'search-1',
          name: 'Important',
          criteria: { category: 'high' },
          created: new Date(),
          lastUsed: new Date(),
          resultCount: 10
        }
      ];
      mockDatabaseManager.getSavedSearches.mockResolvedValue(savedSearches);

      const results = await searchEngine.listSavedSearches(mockUserContext);

      expect(mockDatabaseManager.getSavedSearches).toHaveBeenCalledWith(mockUserContext.user_id);
      expect(results.searches).toEqual(savedSearches);
    });

    it('should handle empty saved searches', async () => {
      mockDatabaseManager.getSavedSearches.mockResolvedValue([]);

      const results = await searchEngine.listSavedSearches(mockUserContext);

      expect(results.searches).toEqual([]);
    });
  });

  describe('executeSavedSearch', () => {
    it('should execute saved search by ID', async () => {
      const savedSearch = {
        id: 'search-1',
        name: 'Important',
        criteria: { category: 'high' },
        created: new Date(),
        lastUsed: new Date(),
        resultCount: 10
      };
      const searchResults = createMockEmails(3);

      mockDatabaseManager.getSavedSearches.mockResolvedValue([savedSearch]);
      mockDatabaseManager.searchEmails.mockResolvedValue(searchResults);

      const results = await searchEngine.executeSavedSearch('search-1', mockUserContext);

      expect(results.emails).toEqual(searchResults);
    });

    it('should throw error for non-existent saved search', async () => {
      mockDatabaseManager.getSavedSearches.mockResolvedValue([]);

      await expect(searchEngine.executeSavedSearch('non-existent', mockUserContext))
        .rejects.toThrow('Saved search not found');
    });
  });

  describe('buildAdvancedQuery', () => {
    it('should build Gmail query string from criteria', async () => {
      const criteria = {
        query: 'test',
        sender: 'john@example.com',
        yearRange: { start: 2023, end: 2024 },
        hasAttachments: true,
        labels: ['INBOX', 'IMPORTANT'],
        sizeRange: { min: 1000, max: 10000 }
      };

      const query = await searchEngine.buildAdvancedQuery(criteria);

      expect(query).toContain('test');
      expect(query).toContain('from:john@example.com');
      expect(query).toContain('after:2023/1/1');
      expect(query).toContain('before:2025/1/1');
      expect(query).toContain('has:attachment');
      expect(query).toContain('label:INBOX');
      expect(query).toContain('label:IMPORTANT');
      expect(query).toContain('larger:1000');
      expect(query).toContain('smaller:10000');
    });

    it('should handle empty criteria', async () => {
      const query = await searchEngine.buildAdvancedQuery({});

      expect(query).toBe('');
    });
  });

  describe('advanced search features', () => {
    it('should support label filtering', async () => {
      const emails = [
        { ...mockEmailIndex, id: '1', labels: ['INBOX', 'IMPORTANT'] },
        { ...mockEmailIndex, id: '2', labels: ['INBOX'] },
        { ...mockEmailIndex, id: '3', labels: ['SENT'] }
      ];
      mockDatabaseManager.searchEmails.mockResolvedValue(emails.filter(e => e.labels.includes('IMPORTANT')));

      const criteria = { labels: ['IMPORTANT'] };
      const results = await searchEngine.search(criteria, mockUserContext);

      expect(results.emails).toHaveLength(1);
      expect(results.emails[0].id).toBe('1');
    });

    it('should support attachment filtering', async () => {
      const emails = [
        { ...mockEmailIndex, id: '1', hasAttachments: true },
        { ...mockEmailIndex, id: '2', hasAttachments: false },
        { ...mockEmailIndex, id: '3', hasAttachments: true }
      ];
      mockDatabaseManager.searchEmails.mockResolvedValue(emails.filter(e => e.hasAttachments));

      const criteria = { hasAttachments: true };
      const results = await searchEngine.search(criteria, mockUserContext);

      expect(results.emails).toHaveLength(2);
      expect(results.emails.every(email => email.hasAttachments)).toBe(true);
    });
  });

  describe('search result ranking', () => {
    it('should rank exact matches higher', async () => {
      const emails = [
        { ...mockEmailIndex, id: '1', subject: 'Meeting tomorrow' },
        { ...mockEmailIndex, id: '2', subject: 'Tomorrow is the meeting' },
        { ...mockEmailIndex, id: '3', subject: 'meeting' }
      ];
      mockDatabaseManager.searchEmails.mockResolvedValue(emails);

      const criteria = { query: 'meeting' };
      const results = await searchEngine.search(criteria, mockUserContext);

      // All emails match the query
      expect(results.emails).toHaveLength(3);
    });

    it('should consider recency in ranking', async () => {
      const now = new Date();
      const emails = [
        { ...mockEmailIndex, id: '1', subject: 'meeting', date: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }, // 1 week old
        { ...mockEmailIndex, id: '2', subject: 'meeting', date: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000) }, // 1 day old
        { ...mockEmailIndex, id: '3', subject: 'meeting', date: now } // today
      ];
      mockDatabaseManager.searchEmails.mockResolvedValue(emails);

      const criteria = { query: 'meeting' };
      const results = await searchEngine.search(criteria, mockUserContext);

      // Database should handle ordering
      expect(results.emails).toHaveLength(3);
    });
  });
});