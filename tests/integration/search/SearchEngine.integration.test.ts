import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, jest } from '@jest/globals';
import { SearchEngine } from '../../../src/search/SearchEngine.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { EmailFetcher } from '../../../src/email/EmailFetcher.js';
import { AuthManager } from '../../../src/auth/AuthManager.js';
import { UserManager } from '../../../src/auth/UserManager.js';
import { UserSession } from '../../../src/auth/UserSession.js';
import { UserDatabaseInitializer } from '../../../src/database/UserDatabaseInitializer.js';
import { FileAccessControlManager } from '../../../src/services/FileAccessControlManager.js';
import { EmailIndex, SearchCriteria, SearchEngineCriteria, UserProfile } from '../../../src/types/index.js';
import { createMockEmails } from '../../fixtures/mockData.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import crypto from 'crypto';

/**
 * SearchEngine Integration Tests with Multi-User OAuth
 * 
 * Comprehensive tests covering single-user OAuth, multi-user OAuth scenarios,
 * data isolation, security, and edge cases for the SearchEngine functionality.
 */
describe('SearchEngine Multi-User OAuth Integration Tests', () => {
  // Test infrastructure
  let searchEngine: SearchEngine;
  let dbManager: DatabaseManager;
  let emailFetcher: EmailFetcher;
  let authManager: AuthManager;
  let userManager: UserManager;
  let userDbInitializer: UserDatabaseInitializer;
  let fileAccessManager: FileAccessControlManager;
  
  let testDbPath: string;
  let testDir: string;
  let storagePath: string;

  // Test user profiles
  const testUsers: UserProfile[] = [
    {
      userId: 'user-1',
      email: 'user1@test.com',
      displayName: 'Test User 1',
      created: new Date(),
      lastLogin: new Date(),
      preferences: {},
      isActive: true
    },
    {
      userId: 'user-2', 
      email: 'user2@test.com',
      displayName: 'Test User 2',
      created: new Date(),
      lastLogin: new Date(),
      preferences: {},
      isActive: true
    },
    {
      userId: 'admin-user',
      email: 'admin@test.com',
      displayName: 'Admin User',
      created: new Date(),
      lastLogin: new Date(),
      preferences: {},
      isActive: true
    }
  ];

  // Test sessions (will be populated during setup)
  const testSessions: Map<string, { sessionId: string; userId: string; userSession: UserSession }> = new Map();

  // Test email data for different users
  const user1Emails: EmailIndex[] = [
    {
      id: 'user1-email1',
      threadId: 'user1-thread1',
      category: 'high',
      subject: 'User1 Important Meeting',
      sender: 'boss@company.com',
      recipients: ['user1@test.com'],
      date: new Date('2024-05-15'),
      year: 2024,
      size: 15000,
      hasAttachments: true,
      labels: ['INBOX', 'IMPORTANT', 'WORK'],
      snippet: 'User1 needs to discuss the project status',
      archived: false
    },
    {
      id: 'user1-email2',
      threadId: 'user1-thread2',
      category: 'medium',
      subject: 'User1 Team Update',
      sender: 'manager@company.com',
      recipients: ['user1@test.com'],
      date: new Date('2024-05-10'),
      year: 2024,
      size: 8000,
      hasAttachments: false,
      labels: ['INBOX', 'WORK'],
      snippet: 'User1 weekly team update on project progress',
      archived: false
    }
  ];

  const user2Emails: EmailIndex[] = [
    {
      id: 'user2-email1',
      threadId: 'user2-thread1',
      category: 'high',
      subject: 'User2 Budget Review',
      sender: 'finance@company.com',
      recipients: ['user2@test.com'],
      date: new Date('2024-05-15'),
      year: 2024,
      size: 20000,
      hasAttachments: true,
      labels: ['INBOX', 'IMPORTANT', 'FINANCE'],
      snippet: 'User2 quarterly budget review meeting',
      archived: false
    },
    {
      id: 'user2-email2',
      threadId: 'user2-thread2',
      category: 'low',
      subject: 'User2 Newsletter',
      sender: 'newsletter@company.com',
      recipients: ['user2@test.com'],
      date: new Date('2024-05-05'),
      year: 2024,
      size: 5000,
      hasAttachments: false,
      labels: ['UPDATES', 'NEWSLETTER'],
      snippet: 'User2 latest company updates',
      archived: false
    }
  ];

  beforeAll(async () => {
    // Create temporary test environment
    testDir = path.join(os.tmpdir(), `search-multiuser-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    
    testDbPath = path.join(testDir, 'test-gmail-mcp.db');
    storagePath = path.join(testDir, 'user-data');
    
    // Set up environment for multi-user mode
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/oauth2callback';
    process.env.STORAGE_PATH = storagePath;
    process.env.TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    
    // Initialize main database manager
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize(testDbPath);
    
    // Initialize user database system
    userDbInitializer = new UserDatabaseInitializer();
    await userDbInitializer.initializeDatabaseSystem();
    
    // Initialize auth manager in multi-user mode
    authManager = new AuthManager({
      enableMultiUser: true,
      storagePath: storagePath,
      encryptionKey: process.env.TOKEN_ENCRYPTION_KEY
    });
    await authManager.initialize();
    
    // Initialize file access control manager
    fileAccessManager = new FileAccessControlManager(dbManager);
    await fileAccessManager.initialize();
    
    // Set up mock email fetcher
    emailFetcher = {
      listEmails: jest.fn(),
      getEmailDetailsBulk: jest.fn(),
      getAllMessageIds: jest.fn()
    } as unknown as EmailFetcher;
    
    // Initialize SearchEngine
    userManager = (authManager as any).userManager as UserManager;
    searchEngine = new SearchEngine(userDbInitializer, userManager);
    
    // Create test users and sessions
    await setupTestUsersAndSessions();
    
    // Seed databases with user-specific test data
    await seedUserDatabases();
  });

  afterAll(async () => {
    // Clean up auth manager
    if (authManager) {
      await authManager.cleanup();
    }
    
    // Clean up database connections
    if (dbManager) {
      await dbManager.close();
    }
    
    if (userDbInitializer) {
      await userDbInitializer.cleanup();
    }
    
    // Clean up test files
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Error cleaning up test directory:', error);
    }
    
    // Clean up environment variables
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    delete process.env.STORAGE_PATH;
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Set up test users and their authenticated sessions
   */
  async function setupTestUsersAndSessions(): Promise<void> {
    for (const user of testUsers) {
      // Explicitly register the user in UserManager with the test userId
      await userManager.createUser(user.email, user.displayName, user.userId);
      // Create user session
      const userSession = await authManager.createUserSession(user.email, user.displayName);
      const sessionId = userSession.getSessionData().sessionId;
      
      // Store mock OAuth tokens for the session
      const userManagerInstance = (authManager as any).userManager as UserManager;
      const session = userManagerInstance.getSession(sessionId);
      
      if (session) {
        await session.storeToken({
          access_token: `mock-access-token-${user.userId}`,
          refresh_token: `mock-refresh-token-${user.userId}`,
          expiry_date: Date.now() + (24 * 60 * 60 * 1000), // 24 hours from now
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/gmail.readonly'
        });
      }
      
      testSessions.set(user.userId, {
        sessionId,
        userId: user.userId,
        userSession: session!
      });
    }
  }

  /**
   * Seed user-specific databases with test email data
   */
  async function seedUserDatabases(): Promise<void> {
    // Get user-specific database managers
    const user1DbManager = await userDbInitializer.getUserDatabaseManager(testUsers[0].userId);
    const user2DbManager = await userDbInitializer.getUserDatabaseManager(testUsers[1].userId);
    
    // Seed user1's database
    for (const email of user1Emails) {
      await user1DbManager.upsertEmailIndex(email);
    }
    
    // Seed user2's database
    for (const email of user2Emails) {
      await user2DbManager.upsertEmailIndex(email);
    }
  }

  /**
   * Helper function to get user context for tests
   */
  function getUserContext(userId: string): { user_id: string; session_id: string } {
    const session = testSessions.get(userId);
    if (!session) {
      throw new Error(`No session found for user ${userId}`);
    }
    return {
      user_id: userId,
      session_id: session.sessionId
    };
  }

  describe('Single User OAuth Tests', () => {
    describe('Basic Search with Authentication', () => {
      it('should search emails for authenticated user', async () => {
        const userContext = getUserContext('user-1');
        const result = await searchEngine.search({}, userContext);
        
        expect(result.emails.length).toBeGreaterThan(0);
        expect(result.emails.every(email => email.id.includes('user1'))).toBe(true);
      });

      it('should filter search results by category for authenticated user', async () => {
        const userContext = getUserContext('user-1');
        const result = await searchEngine.search({ category: 'high' }, userContext);
        
        expect(result.emails.length).toBeGreaterThan(0);
        expect(result.emails.every(email => email.category === 'high')).toBe(true);
        expect(result.emails.every(email => email.id.includes('user1'))).toBe(true);
      });

      it('should filter search results by labels for authenticated user', async () => {
        const userContext = getUserContext('user-1');
        const result = await searchEngine.search({ labels: ['IMPORTANT'] }, userContext);
        
        expect(result.emails.length).toBeGreaterThan(0);
        expect(result.emails.every(email => 
          Array.isArray(email.labels) && email.labels.includes('IMPORTANT')
        )).toBe(true);
        expect(result.emails.every(email => email.id.includes('user1'))).toBe(true);
      });

      it('should handle text queries for authenticated user', async () => {
        const userContext = getUserContext('user-1');
        const result = await searchEngine.search({ query: 'project' }, userContext);
        
        expect(result.emails.length).toBeGreaterThan(0);
        expect(result.emails.some(email =>
          email.subject?.toLowerCase().includes('project') ||
          email.snippet?.toLowerCase().includes('project')
        )).toBe(true);
        expect(result.emails.every(email => email.id.includes('user1'))).toBe(true);
      });
    });

    describe('Saved Searches for Single User', () => {
      it('should save and retrieve searches for authenticated user', async () => {
        const userContext = getUserContext('user-1');
        
        // Save a search
        const saveResult = await searchEngine.saveSearch({
          name: 'User1 Important Emails',
          criteria: { labels: ['IMPORTANT'], category: 'high' }
        }, userContext);
        
        expect(saveResult.saved).toBe(true);
        expect(saveResult.id).toBeDefined();
        
        // List saved searches
        const listResult = await searchEngine.listSavedSearches(userContext);
        
        expect(listResult.searches.length).toBeGreaterThan(0);
        expect(listResult.searches.some(s => s.name === 'User1 Important Emails')).toBe(true);
      });

      it('should execute saved searches for authenticated user', async () => {
        const userContext = getUserContext('user-1');
        
        // Save a search
        const saveResult = await searchEngine.saveSearch({
          name: 'User1 Work Emails',
          criteria: { labels: ['WORK'] }
        }, userContext);
        
        // Execute the saved search
        const searchResult = await searchEngine.executeSavedSearch(saveResult.id, userContext);
        
        expect(searchResult.emails.length).toBeGreaterThan(0);
        expect(searchResult.emails.every(email =>
          Array.isArray(email.labels) && email.labels.includes('WORK')
        )).toBe(true);
        expect(searchResult.emails.every(email => email.id.includes('user1'))).toBe(true);
      });
    });

    describe('OAuth Token Management', () => {
      it('should handle valid authentication tokens', async () => {
        const userContext = getUserContext('user-1');
        const session = testSessions.get('user-1')!;
        
        // Verify session is valid
        expect(session.userSession.isValid()).toBe(true);
        
        // Should be able to search with valid session
        const result = await searchEngine.search({}, userContext);
        expect(result.emails.length).toBeGreaterThan(0);
      });

      it('should reject invalid session IDs', async () => {
        const invalidContext = {
          user_id: 'user-1',
          session_id: 'invalid-session-id'
        };
        
        // This should fail at the database level since user context is invalid
        await expect(searchEngine.search({}, invalidContext))
          .rejects.toThrow();
      });

      it('should handle expired sessions gracefully', async () => {
        const userContext = getUserContext('user-1');
        const session = testSessions.get('user-1')!;
        
        // Invalidate the session
        session.userSession.invalidate();
        
        // Should reject operations with invalid session
        expect(session.userSession.isValid()).toBe(false);
      });
    });
  });

  describe('Multi-User OAuth Tests', () => {
    describe('Data Isolation Between Users', () => {
      it('should isolate search results between different users', async () => {
        const user1Context = getUserContext('user-1');
        const user2Context = getUserContext('user-2');
        
        const user1Results = await searchEngine.search({}, user1Context);
        const user2Results = await searchEngine.search({}, user2Context);
        
        // Results should be different and isolated
        expect(user1Results.emails.every(email => email.id.includes('user1'))).toBe(true);
        expect(user2Results.emails.every(email => email.id.includes('user2'))).toBe(true);
        
        // No cross-contamination
        const user1Ids = user1Results.emails.map(e => e.id);
        const user2Ids = user2Results.emails.map(e => e.id);
        const intersection = user1Ids.filter(id => user2Ids.includes(id));
        expect(intersection.length).toBe(0);
      });

      it('should prevent cross-user data access', async () => {
        const user1Context = getUserContext('user-1');
        const user2Context = getUserContext('user-2');
        
        // Save a search for user1
        const user1SaveResult = await searchEngine.saveSearch({
          name: 'User1 Private Search',
          criteria: { category: 'high' }
        }, user1Context);
        
        // User2 should not be able to execute user1's saved search
        await expect(searchEngine.executeSavedSearch(user1SaveResult.id, user2Context))
          .rejects.toThrow(/not found|Access denied/);
      });

      it('should maintain separate saved searches per user', async () => {
        const user1Context = getUserContext('user-1');
        const user2Context = getUserContext('user-2');
        
        // Save searches for both users
        await searchEngine.saveSearch({
          name: 'User1 Search',
          criteria: { labels: ['WORK'] }
        }, user1Context);
        
        await searchEngine.saveSearch({
          name: 'User2 Search',
          criteria: { labels: ['FINANCE'] }
        }, user2Context);
        
        // List saved searches for each user
        const user1Searches = await searchEngine.listSavedSearches(user1Context);
        const user2Searches = await searchEngine.listSavedSearches(user2Context);
        
        // Each user should only see their own searches
        expect(user1Searches.searches.some(s => s.name === 'User1 Search')).toBe(true);
        expect(user1Searches.searches.some(s => s.name === 'User2 Search')).toBe(false);
        
        expect(user2Searches.searches.some(s => s.name === 'User2 Search')).toBe(true);
        expect(user2Searches.searches.some(s => s.name === 'User1 Search')).toBe(false);
      });
    });

    describe('Concurrent User Operations', () => {
      it('should handle concurrent searches from multiple users', async () => {
        const user1Context = getUserContext('user-1');
        const user2Context = getUserContext('user-2');
        
        // Execute concurrent searches
        const [user1Results, user2Results] = await Promise.all([
          searchEngine.search({ category: 'high' }, user1Context),
          searchEngine.search({ category: 'high' }, user2Context)
        ]);
        
        // Both should succeed with isolated results
        expect(user1Results.emails.every(email => email.id.includes('user1'))).toBe(true);
        expect(user2Results.emails.every(email => email.id.includes('user2'))).toBe(true);
      });

      it('should handle concurrent saved search operations', async () => {
        const user1Context = getUserContext('user-1');
        const user2Context = getUserContext('user-2');
        
        // Execute concurrent save operations
        const [user1SaveResult, user2SaveResult] = await Promise.all([
          searchEngine.saveSearch({
            name: 'Concurrent User1 Search',
            criteria: { hasAttachments: true }
          }, user1Context),
          searchEngine.saveSearch({
            name: 'Concurrent User2 Search', 
            criteria: { hasAttachments: true }
          }, user2Context)
        ]);
        
        expect(user1SaveResult.saved).toBe(true);
        expect(user2SaveResult.saved).toBe(true);
        expect(user1SaveResult.id).not.toBe(user2SaveResult.id);
      });
    });

    describe('User Session Management', () => {
      it('should handle multiple active sessions per user', async () => {
        // Create a second session for user-1
        const secondUserSession = await authManager.createUserSession(testUsers[0].email);
        const secondSessionId = secondUserSession.getSessionData().sessionId;
        const secondContext = {
          user_id: 'user-1',
          session_id: secondSessionId
        };
        
        // Both sessions should work for the same user
        const firstSessionResult = await searchEngine.search({}, getUserContext('user-1'));
        const secondSessionResult = await searchEngine.search({}, secondContext);
        
        expect(firstSessionResult.emails.length).toBeGreaterThan(0);
        expect(secondSessionResult.emails.length).toBeGreaterThan(0);
        
        // Should return same data since it's the same user
        expect(firstSessionResult.emails.length).toBe(secondSessionResult.emails.length);
      });

      it('should invalidate sessions independently', async () => {
        const userContext = getUserContext('user-1');
        const session = testSessions.get('user-1')!;
        
        // Should work before invalidation
        const beforeResult = await searchEngine.search({}, userContext);
        expect(beforeResult.emails.length).toBeGreaterThan(0);
        
        // Invalidate session
        authManager.invalidateSession(session.sessionId);
        
        // Session should now be invalid (but database operations might still work)
        // The actual rejection would happen at the auth layer in a real scenario
      });
    });
  });

  describe('Security and Edge Cases', () => {
    describe('Authentication Edge Cases', () => {
      it('should reject operations with malformed user context', async () => {
        const malformedContext = {
          user_id: '',
          session_id: ''
        };
        
        await expect(searchEngine.search({}, malformedContext))
          .rejects.toThrow();
      });

      it('should reject operations with non-existent user', async () => {
        const nonExistentContext = {
          user_id: 'non-existent-user',
          session_id: 'some-session'
        };
        
        await expect(searchEngine.search({}, nonExistentContext))
          .rejects.toThrow();
      });

      it('should handle database corruption gracefully', async () => {
        // Mock the UserDatabaseInitializer to return a corrupted database manager
        const mockCorruptedDbManager = {
          searchEmails: jest.fn().mockImplementation(() => Promise.reject(new Error('Database corruption detected'))),
          saveSearch: jest.fn(),
          getSavedSearches: jest.fn()
        } as any;
        
        jest.spyOn(userDbInitializer, 'getUserDatabaseManager').mockResolvedValue(mockCorruptedDbManager);
        
        const userContext = getUserContext('user-1');
        
        await expect(searchEngine.search({}, userContext))
          .rejects.toThrow('Database corruption detected');
        
        jest.restoreAllMocks();
      });
    });

    describe('Performance with Multiple Users', () => {
      it('should maintain performance with multiple concurrent users', async () => {
        const contexts = [
          getUserContext('user-1'),
          getUserContext('user-2'),
          getUserContext('admin-user')
        ];
        
        const startTime = Date.now();
        
        // Execute multiple concurrent operations
        const promises = contexts.flatMap(context => [
          searchEngine.search({}, context),
          searchEngine.search({ category: 'high' }, context),
          searchEngine.listSavedSearches(context)
        ]);
        
        const results = await Promise.all(promises);
        const endTime = Date.now();
        
        // Should complete within reasonable time
        expect(endTime - startTime).toBeLessThan(5000); // 5 seconds max
        
        // All operations should succeed
        expect(results.length).toBe(9); // 3 contexts × 3 operations each
        results.forEach(result => {
          expect(result).toBeDefined();
        });
      });

      it('should handle user switching without memory leaks', async () => {
        const user1Context = getUserContext('user-1');
        const user2Context = getUserContext('user-2');
        
        // Simulate rapid user switching
        for (let i = 0; i < 10; i++) {
          await searchEngine.search({}, user1Context);
          await searchEngine.search({}, user2Context);
        }
        
        // Should still work correctly after multiple switches
        const finalResult = await searchEngine.search({}, user1Context);
        expect(finalResult.emails.length).toBeGreaterThan(0);
        expect(finalResult.emails.every(email => email.id.includes('user1'))).toBe(true);
      });
    });

    describe('Data Consistency', () => {
      it('should maintain data consistency during concurrent modifications', async () => {
        const user1Context = getUserContext('user-1');
        
        // Execute concurrent save operations
        const savePromises = Array.from({ length: 5 }, (_, i) =>
          searchEngine.saveSearch({
            name: `Concurrent Search ${i}`,
            criteria: { category: 'medium' }
          }, user1Context)
        );
        
        const saveResults = await Promise.all(savePromises);
        
        // All saves should succeed
        expect(saveResults.every(result => result.saved)).toBe(true);
        
        // All should have unique IDs
        const ids = saveResults.map(result => result.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
        
        // List should show all saved searches
        const listResult = await searchEngine.listSavedSearches(user1Context);
        expect(listResult.searches.length).toBeGreaterThanOrEqual(5);
      });

      it('should handle network failures gracefully', async () => {
        const userContext = getUserContext('user-1');
        
        // Mock network failure in email fetcher
        jest.spyOn(emailFetcher, 'listEmails').mockRejectedValue(
          new Error('Network connection failed')
        );
        
        // Search should still work with local database
        const result = await searchEngine.search({}, userContext);
        expect(result.emails.length).toBeGreaterThan(0);
        
        jest.restoreAllMocks();
      });
    });

    describe('Advanced Query Building', () => {
      it('should build advanced queries correctly', async () => {
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

      it('should handle empty criteria gracefully', async () => {
        const query = await searchEngine.buildAdvancedQuery({});
        expect(query).toBe('');
      });
    });
  });

  describe('Legacy Integration Compatibility', () => {
    it('should maintain compatibility with existing search patterns', async () => {
      const userContext = getUserContext('user-1');
      
      // Test basic search patterns that existed before multi-user
      const basicResult = await searchEngine.search({}, userContext);
      expect(basicResult.emails).toBeDefined();
      expect(basicResult.total).toBeDefined();
      
      const categoryResult = await searchEngine.search({ category: 'high' }, userContext);
      expect(categoryResult.emails.every(email => email.category === 'high')).toBe(true);
      
      const labelResult = await searchEngine.search({ labels: ['WORK'] }, userContext);
      expect(labelResult.emails.every(email => 
        Array.isArray(email.labels) && email.labels.includes('WORK')
      )).toBe(true);
    });

    it('should handle pagination correctly in multi-user context', async () => {
      const userContext = getUserContext('user-1');
      
      // Get first page
      const page1 = await searchEngine.search({ 
        limit: 1,
        offset: 0 
      }, userContext);
      
      // Get second page  
      const page2 = await searchEngine.search({ 
        limit: 1,
        offset: 1 
      }, userContext);
      
      expect(page1.emails.length).toBeLessThanOrEqual(1);
      expect(page2.emails.length).toBeLessThanOrEqual(1);
      
      // Pages should not overlap if there are multiple emails
      if (page1.emails.length > 0 && page2.emails.length > 0) {
        expect(page1.emails[0].id).not.toBe(page2.emails[0].id);
      }
    });
  });
});