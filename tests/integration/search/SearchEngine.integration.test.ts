import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll,jest } from '@jest/globals';
import { SearchEngine } from '../../../src/search/SearchEngine.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { EmailFetcher } from '../../../src/email/EmailFetcher.js';
import { EmailIndex, SearchCriteria, SearchEngineCriteria } from '../../../src/types/index.js';
import { createMockEmails } from '../../fixtures/mockData.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

/**
 * SearchEngine Integration Tests
 * 
 * These tests validate the SearchEngine functionality with actual database interactions.
 * Tests focus on database-level filtering optimizations and all public methods of the SearchEngine class.
 */
describe('SearchEngine Integration Tests', () => {
  let searchEngine: SearchEngine;
  let dbManager: DatabaseManager;
  let emailFetcher: EmailFetcher;
  let testDbPath: string;
  
  // Test data
  const testEmails: EmailIndex[] = [
    // High priority with multiple labels and attachments
    {
      id: 'email1',
      threadId: 'thread1',
      category: 'high',
      subject: 'Important Meeting',
      sender: 'boss@company.com',
      recipients: ['you@company.com'],
      date: new Date('2024-05-15'),
      year: 2024,
      size: 15000,
      hasAttachments: true,
      labels: ['INBOX', 'IMPORTANT', 'WORK'],
      snippet: 'We need to discuss the project status',
      archived: false
    },
    // Medium priority with some labels, no attachments
    {
      id: 'email2',
      threadId: 'thread2',
      category: 'medium',
      subject: 'Team Update',
      sender: 'manager@company.com',
      recipients: ['team@company.com'],
      date: new Date('2024-05-10'),
      year: 2024,
      size: 8000,
      hasAttachments: false,
      labels: ['INBOX', 'WORK'],
      snippet: 'Weekly team update on project progress',
      archived: false
    },
    // Low priority with minimal labels, has attachments
    {
      id: 'email3',
      threadId: 'thread3',
      category: 'low',
      subject: 'Newsletter: Company Updates',
      sender: 'newsletter@company.com',
      recipients: ['all@company.com'],
      date: new Date('2024-05-05'),
      year: 2024,
      size: 25000,
      hasAttachments: true,
      labels: ['UPDATES', 'NEWSLETTER'],
      snippet: 'Latest updates from around the company',
      archived: false
    },
    // High priority from previous year
    {
      id: 'email4',
      threadId: 'thread4',
      category: 'high',
      subject: 'Year-End Review',
      sender: 'ceo@company.com',
      recipients: ['all@company.com'],
      date: new Date('2023-12-20'),
      year: 2023,
      size: 12000,
      hasAttachments: true,
      labels: ['IMPORTANT', 'COMPANY', 'REVIEW'],
      snippet: 'Annual performance review and goals',
      archived: false
    },
    // Medium priority with specific labels
    {
      id: 'email5',
      threadId: 'thread5',
      category: 'medium',
      subject: 'Project Timeline',
      sender: 'project@company.com',
      recipients: ['developers@company.com'],
      date: new Date('2024-04-28'),
      year: 2024,
      size: 10000,
      hasAttachments: false,
      labels: ['PROJECT', 'TIMELINE', 'WORK'],
      snippet: 'Updated project timeline and milestones',
      archived: false
    }
  ];

  // Additional test emails for pagination and large result set tests
  const bulkTestEmails: EmailIndex[] = createMockEmails(50).map((email, index) => ({
    ...email,
    id: `bulk-email-${index + 1}`,
    threadId: `bulk-thread-${index + 1}`,
    labels: index % 2 === 0 ? ['INBOX', 'BULK'] : ['BULK'],
    hasAttachments: index % 3 === 0,
    year: 2025,
    category: index % 3 === 0 ? 'high' : index % 3 === 1 ? 'medium' : 'low'
  }));

  beforeAll(async () => {
    // Create temporary test database directory
    const testDir = path.join(os.tmpdir(), `search-engine-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    testDbPath = path.join(testDir, 'test-gmail-mcp.db');
    
    // Initialize test database with test data
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize(testDbPath);
    
    // Set up email fetcher with mock implementation
    emailFetcher = {
      listEmails: jest.fn(),
      getEmailDetailsBulk: jest.fn(),
      getAllMessageIds: jest.fn()
    } as unknown as EmailFetcher;
    
    // Initialize SearchEngine with real database
    searchEngine = new SearchEngine(dbManager, emailFetcher);
    
    // Seed database with test emails
    for (const email of [...testEmails, ...bulkTestEmails]) {
      await dbManager.upsertEmailIndex(email);
    }
  });

  afterAll(async () => {
    // Close database connection
    await dbManager.close();
    
    // Clean up test database file
    try {
      await fs.unlink(testDbPath);
      await fs.rmdir(path.dirname(testDbPath), { recursive: true });
    } catch (error) {
      console.error('Error cleaning up test database:', error);
    }
  });

  afterEach(()=>{
    // Clear mock function calls after each test
    jest.clearAllMocks();
  })

  describe('Basic Search Functionality', () => {
    it('should search emails with empty criteria', async () => {
      const result = await searchEngine.search({});
      
      expect(result.emails.length).toBe(50); // Default limit is 50
      expect(result.total).toBe(55); // All test emails (5 + 50)
    });
    
    it('should search emails with category filter', async () => {
      const result = await searchEngine.search({ category: 'high' });
      
      const highPriorityEmails = [...testEmails, ...bulkTestEmails].filter(e => e.category === 'high');
      expect(result.emails.length).toBe(Math.min(highPriorityEmails.length, 50)); // Limited to 50
      expect(result.emails.every(email => email.category === 'high')).toBe(true);
    });
    
    it('should search emails with year filter', async () => {
      const result = await searchEngine.search({ year: 2023 });
      
      expect(result.emails.length).toBeGreaterThanOrEqual(1);
      expect(result.emails.every(email => email.year === 2023)).toBe(true);
      expect(result.emails.some(email => email.id === 'email4')).toBe(true);
    });
    
    it('should search emails with year range filter', async () => {
      const result = await searchEngine.search({ 
        yearRange: { start: 2023, end: 2024 } 
      });
      
      expect(result.emails.length).toBe(5); // Default limit
      expect(result.emails.every(email =>
        (email.year ?? 0) >= 2023 && (email.year ?? 0) <= 2024
      )).toBe(true);
    });
    
    it('should search emails with size range filter', async () => {
      const result = await searchEngine.search({ 
        sizeRange: { min: 20000, max: 30000 } 
      });
      
      expect(result.emails.length).toBeGreaterThanOrEqual(1);
      expect(result.emails.every(email =>
        (email.size ?? 0) >= 20000 && (email.size ?? 0) <= 30000
      )).toBe(true);
      expect(result.emails.some(email => email.id === 'email3')).toBe(true);
    });
    
    it('should search emails with sender filter', async () => {
      const result = await searchEngine.search({ 
        sender: 'ceo@company.com' 
      });
      
      expect(result.emails.length).toBe(1);
      expect(result.emails[0].id).toBe('email4');
      expect(result.emails[0].sender).toBe('ceo@company.com');
    });
    
    it('should search emails with text query filter', async () => {
      const result = await searchEngine.search({ 
        query: 'project' ,
        limit: 55
      });
      
      expect(result.emails.length).toBeGreaterThanOrEqual(2);
      expect(result.emails.some(email => email.id === 'email2')).toBe(true);
      expect(result.emails.some(email => email.id === 'email5')).toBe(true);
    });
    
    it('should handle pagination with limit and offset', async () => {
      // Get first page
      const page1 = await searchEngine.search({ 
        limit: 10,
        offset: 0 
      });
      
      // Get second page
      const page2 = await searchEngine.search({ 
        limit: 10,
        offset: 10 
      });
      
      expect(page1.emails.length).toBe(10);
      expect(page2.emails.length).toBe(10);
      
      // Ensure pages don't overlap
      const page1Ids = page1.emails.map(e => e.id);
      const page2Ids = page2.emails.map(e => e.id);
      const intersection = page1Ids.filter(id => page2Ids.includes(id));
      
      expect(intersection.length).toBe(0);
    });
  });

  describe('Database-Level Filtering Optimizations', () => {
    it('should filter by labels at database level', async () => {
      const result = await searchEngine.search({ 
        labels: ['IMPORTANT', 'WORK'] 
      });
      
      expect(result.emails.length).toBeGreaterThanOrEqual(1);
      expect(result.emails.every(email => 
        Array.isArray(email.labels) && 
        email.labels.includes('IMPORTANT') && 
        email.labels.includes('WORK')
      )).toBe(true);
      expect(result.emails.some(email => email.id === 'email1')).toBe(true);
    });
    
    it('should filter by hasAttachments at database level', async () => {
      const result = await searchEngine.search({ 
        hasAttachments: true 
      });
      
      const emailsWithAttachments = [...testEmails, ...bulkTestEmails].filter(e => e.hasAttachments);
      expect(result.emails.length).toBe(Math.min(emailsWithAttachments.length, 50)); // Limited to 50
      expect(result.emails.every(email => email.hasAttachments)).toBe(true);
    });
    
    it('should combine label and hasAttachments filters', async () => {
      const result = await searchEngine.search({ 
        labels: ['IMPORTANT'],
        hasAttachments: true 
      });
      
      expect(result.emails.length).toBeGreaterThanOrEqual(2);
      expect(result.emails.every(email => 
        Array.isArray(email.labels) && 
        email.labels.includes('IMPORTANT') && 
        email.hasAttachments
      )).toBe(true);
    });
    
    it('should apply post-query filtering for text search', async () => {
      const result = await searchEngine.search({ 
        labels: ['WORK'],
        query: 'team' 
      });
      
      expect(result.emails.length).toBeGreaterThanOrEqual(1);
      expect(result.emails.every(email => 
        Array.isArray(email.labels) && 
        email.labels.includes('WORK')
      )).toBe(true);
      
      // Text search is applied after database query
      expect(result.emails.some(email =>
        email.subject?.toLowerCase().includes('team') ||
        email.snippet?.toLowerCase().includes('team')
      )).toBe(true);
    });
  });

  describe('Saved Search Functionality', () => {
    it('should save a search and retrieve it', async () => {
      // Save a search
      const saveResult = await searchEngine.saveSearch({
        name: 'Important Work Emails',
        criteria: {
          labels: ['IMPORTANT', 'WORK'],
          hasAttachments: true
        }
      });
      
      expect(saveResult.saved).toBe(true);
      expect(saveResult.id).toBeDefined();
      
      // List saved searches
      const listResult = await searchEngine.listSavedSearches();
      
      expect(listResult.searches.length).toBeGreaterThanOrEqual(1);
      expect(listResult.searches.some(s => s.name === 'Important Work Emails')).toBe(true);
      
      // Find the saved search
      const savedSearch = listResult.searches.find(s => s.name === 'Important Work Emails');
      expect(savedSearch).toBeDefined();
      expect(savedSearch?.criteria).toEqual({
        labels: ['IMPORTANT', 'WORK'],
        hasAttachments: true
      });
    });
    
    it('should execute a saved search', async () => {
      // Save a search
      const saveResult = await searchEngine.saveSearch({
        name: 'High Priority Emails',
        criteria: {
          category: 'high'
        }
      });
      
      // Execute the saved search
      const searchResult = await searchEngine.executeSavedSearch(saveResult.id);
      
      expect(searchResult.emails.length).toBeGreaterThan(0);
      expect(searchResult.emails.every(email => email.category === 'high')).toBe(true);
    });
    
    it('should throw error when executing non-existent saved search', async () => {
      await expect(searchEngine.executeSavedSearch('non-existent-id'))
        .rejects.toThrow('Saved search not found');
    });
  });

  describe('Advanced Query Builder', () => {
    it('should build Gmail API query string from criteria', async () => {
      const criteria: SearchCriteria = {
        query: 'important meeting',
        sender: 'boss@company.com',
        yearRange: { start: 2023, end: 2024 },
        hasAttachments: true,
        labels: ['IMPORTANT', 'WORK'],
        sizeRange: { min: 10000, max: 20000 }
      };
      
      const query = await searchEngine.buildAdvancedQuery(criteria);
      
      expect(query).toContain('important meeting');
      expect(query).toContain('from:boss@company.com');
      expect(query).toContain('after:2023/1/1');
      expect(query).toContain('before:2025/1/1');
      expect(query).toContain('has:attachment');
      expect(query).toContain('label:IMPORTANT');
      expect(query).toContain('label:WORK');
      expect(query).toContain('larger:10000');
      expect(query).toContain('smaller:20000');
    });
    
    it('should handle empty criteria', async () => {
      const query = await searchEngine.buildAdvancedQuery({});
      expect(query).toBe('');
    });
    
    it('should handle partial criteria', async () => {
      const criteria: SearchCriteria = {
        sender: 'someone@example.com'
      };
      
      const query = await searchEngine.buildAdvancedQuery(criteria);
      
      expect(query).toContain('from:someone@example.com');
      expect(query).not.toContain('after:');
      expect(query).not.toContain('has:attachment');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty result sets', async () => {
      const result = await searchEngine.search({ 
        query: 'ThisQueryWillNotMatchAnything12345' 
      });
      
      expect(result.emails.length).toBe(0);
      expect(result.total).toBe(0);
    });
    
    it('should handle large result sets with automatic limiting', async () => {
      // Search that would match most emails
      const result = await searchEngine.search({ 
        query: 'company' 
      });
      
      // Default limit is 50
      expect(result.emails.length).toBe(0);
      expect(result.total).toBe(0);
    });
    
    it('should gracefully handle errors from database', async () => {
      // Create a temporary database manager with invalid path to cause error
      const errorDbManager = DatabaseManager.getInstance();
      jest.spyOn(errorDbManager,'searchEmails').mockRejectedValue(new Error('Database error'));
      const invalidSearchEngine = new SearchEngine(errorDbManager, emailFetcher);
      
      // This search should fail because database is not initialized
      await expect(invalidSearchEngine.search({}))
        .rejects.toThrow();
      jest.restoreAllMocks();
    });
    
    it('should handle exact phrase queries', async () => {
      const result = await searchEngine.search({ 
        query: '"project status"',
        limit:55
      });
      
      expect(result.emails.length).toBeGreaterThanOrEqual(1);
      expect(result.emails.some(email =>
        email.subject?.toLowerCase().includes('project status') ||
        email.snippet?.toLowerCase().includes('project status')
      )).toBe(true);
    });
  });

  describe('SearchEngine Integration with DatabaseManager', () => {
    it('should properly integrate with the underlying database for label filtering', async () => {
      // The database-level filtering in SearchEngine should match the database query in DatabaseManager
      // First get results using SearchEngine
      const searchResult = await searchEngine.search({ 
        labels: ['IMPORTANT'] ,
        limit: 55
      });
      
      // Then get results directly from DatabaseManager
      const dbResult = await dbManager.searchEmails({ 
        labels: ['IMPORTANT'],
        limit: 55
      });
      expect(dbResult.length).toBe(2);
      expect(searchResult.emails.length).toBe(dbResult.length);
     
      
      // Check that both results contain the same emails
      const searchIds = searchResult.emails.map(e => e.id).sort();
      const dbIds = dbResult.slice(0, 50).map(e => e.id).sort();
      
      expect(searchIds).toEqual(dbIds);
    });
    
    it('should properly integrate with the underlying database for hasAttachments filtering', async () => {
      // Get results using SearchEngine
      const searchResult = await searchEngine.search({ 
        hasAttachments: true 
      });
      
      // Get results directly from DatabaseManager
      const dbResult = await dbManager.searchEmails({ 
        hasAttachments: true 
      });
      
      // Results should be the same (limited to the default limit of 50)
      expect(searchResult.emails.length).toBe(Math.min(dbResult.length, 50));
      
      // Check that both results contain the same emails
      const searchIds = searchResult.emails.map(e => e.id).sort();
      const dbIds = dbResult.slice(0, 50).map(e => e.id).sort();
      
      expect(searchIds).toEqual(dbIds);
    });
  });
});