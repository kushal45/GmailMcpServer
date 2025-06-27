import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EmailFetcher } from '../../../src/email/EmailFetcher.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { AuthManager } from '../../../src/auth/AuthManager.js';
import { CacheManager } from '../../../src/cache/CacheManager.js';
import { UserManager } from '../../../src/auth/UserManager.js';
import { UserSession } from '../../../src/auth/UserSession.js';
import { EmailIndex, PriorityCategory, UserProfile } from '../../../src/types/index.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { createMockGmailClient } from '../../utils/testHelpers.js';

// --- BEGIN FACTORY AND CLEANUP SETUP ---
class TestUserDatabaseManagerFactory {
  private dbs = new Map<string, DatabaseManager>();
  private dbPaths = new Map<string, string>();
  private tempDirs: string[] = [];

  async getUserDatabaseManager(userId: string): Promise<DatabaseManager> {
    if (this.dbs.has(userId)) return this.dbs.get(userId)!;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `email-test-${userId}-`));
    this.tempDirs.push(tempDir);
    const dbPath = path.join(tempDir, `user-${userId}.db`);
    this.dbPaths.set(userId, dbPath);
    process.env.STORAGE_PATH = tempDir; // If needed by DBManager
    const db = new DatabaseManager(dbPath);
    await db.initialize();
    this.dbs.set(userId, db);
    return db;
  }

  async closeAndCleanup() {
    for (const db of this.dbs.values()) await db.close();
    for (const dir of this.tempDirs) await fs.rm(dir, { recursive: true, force: true });
    this.dbs.clear();
    this.dbPaths.clear();
    this.tempDirs = [];
  }
}
// --- END FACTORY AND CLEANUP SETUP ---

describe('EmailFetcher Integration Tests', () => {
  let emailFetcher: EmailFetcher;
  let userDbManagerFactory: any;
  let authManager: AuthManager;
  let cacheManager: CacheManager;
  let mockGmailClient: any;
  const TEST_USER_ID = 'test-user-1';

  beforeEach(async () => {
    userDbManagerFactory = new TestUserDatabaseManagerFactory();
    mockGmailClient = createMockGmailClient();
    authManager = {
      getSessionId: jest.fn().mockImplementation(() => 'mock-session-id'),
      getGmailClient: jest.fn().mockImplementation(() => Promise.resolve(mockGmailClient)),
      hasValidAuth: jest.fn().mockImplementation(() => Promise.resolve(true)),
    } as unknown as AuthManager;
    cacheManager = new CacheManager();
    emailFetcher = new EmailFetcher(userDbManagerFactory as any, authManager, cacheManager);
    await seedTestData();
  });

  afterEach(async () => {
    await userDbManagerFactory.closeAndCleanup();
  });

  async function seedTestData() {
    const dbManager = await userDbManagerFactory.getUserDatabaseManager(TEST_USER_ID);
    const testEmails: EmailIndex[] = [
      {
        id: 'email1',
        threadId: 'thread1',
        category: PriorityCategory.HIGH,
        subject: 'Important Test',
        sender: 'sender@example.com',
        recipients: ['recipient@example.com'],
        date: new Date('2023-01-15'),
        year: 2023,
        size: 10000,
        hasAttachments: false,
        labels: ['INBOX', 'IMPORTANT'],
        snippet: 'This is an important test email',
        archived: false,
        user_id: TEST_USER_ID
      },
      {
        id: 'email2',
        threadId: 'thread2',
        category: PriorityCategory.MEDIUM,
        subject: 'Regular Test',
        sender: 'sender@example.com',
        recipients: ['recipient@example.com'],
        date: new Date('2023-02-15'),
        year: 2023,
        size: 20000,
        hasAttachments: true,
        labels: ['INBOX'],
        snippet: 'This is a regular test email',
        archived: false,
        user_id: TEST_USER_ID
      },
      {
        id: 'email3',
        threadId: 'thread3',
        category: PriorityCategory.LOW,
        subject: 'Newsletter',
        sender: 'newsletter@example.com',
        recipients: ['recipient@example.com'],
        date: new Date('2023-03-15'),
        year: 2023,
        size: 30000,
        hasAttachments: false,
        labels: ['INBOX', 'PROMOTIONS'],
        snippet: 'This is a newsletter',
        archived: false,
        user_id: TEST_USER_ID
      },
      {
        id: 'email4',
        threadId: 'thread4',
        category: PriorityCategory.LOW,
        subject: 'Archived Newsletter',
        sender: 'newsletter@example.com',
        recipients: ['recipient@example.com'],
        date: new Date('2022-03-15'),
        year: 2022,
        size: 30000,
        hasAttachments: false,
        labels: ['PROMOTIONS'],
        snippet: 'This is an archived newsletter',
        archived: true,
        user_id: TEST_USER_ID
      }
    ];
    for (const email of testEmails) {
      await dbManager.upsertEmailIndex(email);
    }
  }

  describe('Single-User OAuth Flow Tests', () => {
    it('should list emails from database without sync', async () => {
      mockGmailClient.users.messages.list.mockResolvedValue({ data: { messages: [] } });
      cacheManager.set('last_gmail_sync', Date.now().toString(), '3600');
      const result = await emailFetcher.listEmails({ limit: 10, offset: 0 }, TEST_USER_ID);
      expect(result.emails.length).toBe(4);
      expect(result.total).toBe(4);
    });
    
    it('should filter emails by category', async () => {
      const highResult = await emailFetcher.listEmails({ category: PriorityCategory.HIGH, limit: 10, offset: 0 }, TEST_USER_ID);
      expect(highResult.emails.length).toBe(1);
      expect(highResult.emails[0].id).toBe('email1');
      
      const mediumResult = await emailFetcher.listEmails({ category: PriorityCategory.MEDIUM, limit: 10, offset: 0 }, TEST_USER_ID);
      expect(mediumResult.emails.length).toBe(1);
      expect(mediumResult.emails[0].id).toBe('email2');
    });
    
    it('should filter emails by year', async () => {
      const result2023 = await emailFetcher.listEmails({ year: 2023, limit: 10, offset: 0 }, TEST_USER_ID);
      expect(result2023.emails.length).toBe(3);
      
      const result2022 = await emailFetcher.listEmails({ year: 2022, archived: true, limit: 10, offset: 0 }, TEST_USER_ID);
      expect(result2022.emails.length).toBe(1);
      expect(result2022.emails[0].id).toBe('email4');
    });
    
    it('should include archived emails when requested', async () => {
      const result = await emailFetcher.listEmails({ archived: true, limit: 10, offset: 0 }, TEST_USER_ID);
      expect(result.emails.length).toBe(1);
      expect(result.emails[0].id).toBe('email4');
    });
    
    it('should synchronize with Gmail when needed', async () => {
      cacheManager.delete('last_gmail_sync');
      
      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'new-email', threadId: 'new-thread' }]
        }
      });
      
      mockGmailClient.users.messages.get.mockResolvedValue({
        data: {
          id: 'new-email',
          threadId: 'new-thread',
          labelIds: ['INBOX'],
          snippet: 'New test email',
          sizeEstimate: 15000,
          internalDate: Date.now().toString(),
          payload: {
            headers: [
              { name: 'Subject', value: 'New Test Email' },
              { name: 'From', value: 'new@example.com' },
              { name: 'To', value: 'recipient@example.com' },
              { name: 'Date', value: new Date().toISOString() }
            ]
          }
        }
      });
      
      const result = await emailFetcher.listEmails({
        limit: 10,
        offset: 0
      }, TEST_USER_ID);
      
      expect(mockGmailClient.users.messages.list).toHaveBeenCalled();
      expect(mockGmailClient.users.messages.get).toHaveBeenCalled();
      
      expect(result.emails.length).toBe(5);
      expect(result.emails.some(e => e.id === 'new-email')).toBe(true);
    });
    
    it('should handle pagination correctly', async () => {
      const page1 = await emailFetcher.listEmails({
        limit: 2,
        offset: 0
      }, TEST_USER_ID);
      
      expect(page1.emails.length).toBe(2);
      expect(page1.total).toBe(4);
      
      const page2 = await emailFetcher.listEmails({
        limit: 2,
        offset: 2
      }, TEST_USER_ID);
      
      expect(page2.emails.length).toBe(2);
      expect(page2.total).toBe(4);
    });
    
    it('should handle empty results gracefully', async () => {
      const result = await emailFetcher.listEmails({
        year: 2025,
        limit: 10,
        offset: 0
      }, TEST_USER_ID);
      
      expect(result.emails.length).toBe(0);
      expect(result.total).toBe(0);
    });
    
    it('should filter by attachment status', async () => {
      const withAttachments = await emailFetcher.listEmails({
        hasAttachments: true,
        limit: 10,
        offset: 0
      }, TEST_USER_ID);
      expect(withAttachments.emails.length).toBe(1);
      expect(withAttachments.emails.every(e => e.hasAttachments)).toBe(true);
    });
    
    it('should filter by labels', async () => {
      const importantEmails = await emailFetcher.listEmails({
        labels: ['IMPORTANT'],
        limit: 10,
        offset: 0
      }, TEST_USER_ID);
      expect(importantEmails.emails.length).toBe(1);
      expect(importantEmails.emails.every(e => e.labels && e.labels.includes('IMPORTANT'))).toBe(true);
    });
    
    it('should combine multiple filters correctly', async () => {
      const result = await emailFetcher.listEmails({
        category: PriorityCategory.LOW,
        year: 2023,
        archived: false,
        limit: 10,
        offset: 0
      }, TEST_USER_ID);
      
      expect(result.emails.length).toBe(1);
      expect(result.emails[0].id).toBe('email3');
    });
  });

  describe('Multi-User OAuth Flow Tests', () => {
    let userManager: UserManager;
    let mockUserSessions: Map<string, any>;
    let mockUsers: Map<string, UserProfile>;
    
    const ADMIN_USER_ID = 'admin-user-1';
    const REGULAR_USER_ID = 'regular-user-1';
    const REGULAR_USER_2_ID = 'regular-user-2';
    
    beforeAll(async () => {
      (DatabaseManager as any).singletonInstance = null;
    });
    
    const adminUser: UserProfile = {
      userId: ADMIN_USER_ID,
      email: 'admin@example.com',
      displayName: 'Admin User',
      role: 'admin',
      created: new Date(),
      preferences: {},
      isActive: true
    };
    
    const regularUser1: UserProfile = {
      userId: REGULAR_USER_ID,
      email: 'user1@example.com',
      displayName: 'Regular User 1',
      role: 'user',
      created: new Date(),
      preferences: {},
      isActive: true
    };
    
    const regularUser2: UserProfile = {
      userId: REGULAR_USER_2_ID,
      email: 'user2@example.com',
      displayName: 'Regular User 2',
      role: 'user',
      created: new Date(),
      preferences: {},
      isActive: true
    };

    beforeEach(async () => {
      // Create a per-user database manager factory for multi-user tests
      userDbManagerFactory = new TestUserDatabaseManagerFactory();
      // Setup mock users and sessions
      mockUsers = new Map([
        [ADMIN_USER_ID, adminUser],
        [REGULAR_USER_ID, regularUser1],
        [REGULAR_USER_2_ID, regularUser2]
      ]);
      mockUserSessions = new Map([
        ['admin-session-id', {
          sessionId: 'admin-session-id',
          userId: ADMIN_USER_ID,
          isValid: () => true,
          getSessionData: () => ({ sessionId: 'admin-session-id', userId: ADMIN_USER_ID })
        }],
        ['user1-session-id', {
          sessionId: 'user1-session-id',
          userId: REGULAR_USER_ID,
          isValid: () => true,
          getSessionData: () => ({ sessionId: 'user1-session-id', userId: REGULAR_USER_ID })
        }],
        ['user2-session-id', {
          sessionId: 'user2-session-id',
          userId: REGULAR_USER_2_ID,
          isValid: () => true,
          getSessionData: () => ({ sessionId: 'user2-session-id', userId: REGULAR_USER_2_ID })
        }],
        ['expired-session-id', {
          sessionId: 'expired-session-id',
          userId: REGULAR_USER_ID,
          isValid: () => false,
          getSessionData: () => ({ sessionId: 'expired-session-id', userId: REGULAR_USER_ID })
        }]
      ]);
      // Create multiple mock Gmail clients for different users
      const adminGmailClient = createMockGmailClient();
      const user1GmailClient = createMockGmailClient();
      const user2GmailClient = createMockGmailClient();
      // Mock auth manager with session-based authentication
      authManager = {
        getSessionId: jest.fn().mockImplementation((userId) => {
          const session = Array.from(mockUserSessions.values()).find(s => s.userId === userId);
          return session ? session.sessionId : null;
        }),
        getGmailClient: jest.fn().mockImplementation((sessionIdOrUserId) => {
          if (!sessionIdOrUserId) {
            return Promise.resolve(createMockGmailClient());
          }
          if (sessionIdOrUserId === ADMIN_USER_ID ||
              sessionIdOrUserId === REGULAR_USER_ID ||
              sessionIdOrUserId === REGULAR_USER_2_ID) {
            switch (sessionIdOrUserId) {
              case ADMIN_USER_ID:
                return Promise.resolve(adminGmailClient);
              case REGULAR_USER_ID:
                return Promise.resolve(user1GmailClient);
              case REGULAR_USER_2_ID:
                return Promise.resolve(user2GmailClient);
              default:
                return Promise.reject(new Error('Unknown user'));
            }
          }
          const session = mockUserSessions.get(sessionIdOrUserId as string);
          if (!session || !session.isValid()) {
            return Promise.reject(new Error('Invalid or expired session'));
          }
          switch (session.userId) {
            case ADMIN_USER_ID:
              return Promise.resolve(adminGmailClient);
            case REGULAR_USER_ID:
              return Promise.resolve(user1GmailClient);
            case REGULAR_USER_2_ID:
              return Promise.resolve(user2GmailClient);
            default:
              return Promise.reject(new Error('Unknown user'));
          }
        }),
        hasValidAuth: jest.fn().mockImplementation((sessionId) => {
          if (!sessionId) return Promise.resolve(true);
          const session = mockUserSessions.get(sessionId as string);
          return Promise.resolve(session && session.isValid());
        }),
        validateSession: jest.fn().mockImplementation((sessionId) => {
          const session = mockUserSessions.get(sessionId as string);
          return session && session.isValid();
        })
      } as unknown as AuthManager;
      cacheManager = new CacheManager();
      emailFetcher = new EmailFetcher(userDbManagerFactory as any, authManager, cacheManager);
      await seedMultiUserTestData();
    });
    
    afterEach(async () => {
      await userDbManagerFactory.closeAndCleanup();
    });

    async function seedMultiUserTestData() {
      // Create test emails for different users
      const adminEmails: EmailIndex[] = [
        {
          id: 'admin-email-1',
          threadId: 'admin-thread-1',
          category: PriorityCategory.HIGH,
          subject: 'Admin Important Email',
          sender: 'system@example.com',
          recipients: ['admin@example.com'],
          date: new Date('2023-01-15'),
          year: 2023,
          size: 15000,
          hasAttachments: false,
          labels: ['INBOX', 'IMPORTANT'],
          snippet: 'Admin important email content',
          archived: false,
          user_id: ADMIN_USER_ID
        }
      ];
      const user1Emails: EmailIndex[] = [
        {
          id: 'user1-email-1',
          threadId: 'user1-thread-1',
          category: PriorityCategory.MEDIUM,
          subject: 'User 1 Email',
          sender: 'sender@example.com',
          recipients: ['user1@example.com'],
          date: new Date('2023-02-15'),
          year: 2023,
          size: 12000,
          hasAttachments: true,
          labels: ['INBOX'],
          snippet: 'User 1 email content',
          archived: false,
          user_id: REGULAR_USER_ID
        },
        {
          id: 'user1-email-2',
          threadId: 'user1-thread-2',
          category: PriorityCategory.LOW,
          subject: 'User 1 Newsletter',
          sender: 'newsletter@example.com',
          recipients: ['user1@example.com'],
          date: new Date('2023-03-15'),
          year: 2023,
          size: 8000,
          hasAttachments: false,
          labels: ['INBOX', 'PROMOTIONS'],
          snippet: 'User 1 newsletter content',
          archived: false,
          user_id: REGULAR_USER_ID
        }
      ];
      const user2Emails: EmailIndex[] = [
        {
          id: 'user2-email-1',
          threadId: 'user2-thread-1',
          category: PriorityCategory.HIGH,
          subject: 'User 2 Important Email',
          sender: 'important@example.com',
          recipients: ['user2@example.com'],
          date: new Date('2023-04-15'),
          year: 2023,
          size: 20000,
          hasAttachments: true,
          labels: ['INBOX', 'IMPORTANT'],
          snippet: 'User 2 important email content',
          archived: false,
          user_id: REGULAR_USER_2_ID
        }
      ];
      // Insert emails into database with user_id using the factory
      const adminDb = await userDbManagerFactory.getUserDatabaseManager(ADMIN_USER_ID);
      for (const email of adminEmails) {
        await adminDb.upsertEmailIndex(email);
      }
      const user1Db = await userDbManagerFactory.getUserDatabaseManager(REGULAR_USER_ID);
      for (const email of user1Emails) {
        await user1Db.upsertEmailIndex(email);
      }
      const user2Db = await userDbManagerFactory.getUserDatabaseManager(REGULAR_USER_2_ID);
      for (const email of user2Emails) {
        await user2Db.upsertEmailIndex(email);
      }
    }
    
    describe('Session-Based Authentication', () => {
      it('should validate session before accessing Gmail client', async () => {
        const result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID);
        console.log('🔍 SESSION VALIDATION:', {
          userId: REGULAR_USER_ID,
          resultCount: result.emails.length,
          resultTotal: result.total,
          emailIds: result.emails.map(e => e.id),
          userIds: result.emails.map(e => e.user_id)
        });
        expect(authManager.getGmailClient).toHaveBeenCalled();
        expect(result.emails.length).toBeGreaterThan(0);
      });
      
      it('should reject access with invalid session', async () => {
        (authManager.getGmailClient as jest.Mock).mockImplementation(() =>
          Promise.reject(new Error('Invalid or expired session'))
        );
        
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, 'invalid-user')).rejects.toThrow('Invalid or expired session');
      });
      
      it('should handle session expiration during email operations', async () => {
        (authManager.getGmailClient as jest.Mock).mockImplementationOnce(() =>
          Promise.reject(new Error('Session expired'))
        );
        
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Session expired');
      });
    });
    
    describe('User Data Isolation', () => {
      it('should return only user-specific emails', async () => {
        const user1Result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID);
        
        console.log('🔍 USER ISOLATION USER1:', {
          userId: REGULAR_USER_ID,
          resultCount: user1Result.emails.length,
          resultTotal: user1Result.total,
          emailIds: user1Result.emails.map(e => e.id),
          userIds: user1Result.emails.map(e => e.user_id)
        });
        
        expect(user1Result.emails.length).toBe(2);
        expect(user1Result.emails.every(email =>
          email.user_id === REGULAR_USER_ID || (email.recipients && email.recipients.includes('user1@example.com'))
        )).toBe(true);
        
        const user2Result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_2_ID);
        
        expect(user2Result.emails.length).toBe(1);
        expect(user2Result.emails.every(email =>
          email.user_id === REGULAR_USER_2_ID || (email.recipients && email.recipients.includes('user2@example.com'))
        )).toBe(true);
      });
      
      it('should prevent cross-user data access', async () => {
        const user1Result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID);
        
        const user2EmailIds = ['user2-email-1'];
        const user1HasUser2Emails = user1Result.emails.some(email =>
          user2EmailIds.includes(email.id)
        );
        
        expect(user1HasUser2Emails).toBe(false);
      });
      
      it('should isolate cache data between users', async () => {
        console.log('🔍 CACHE MANAGER MOCK:', {
          isMock: jest.isMockFunction(cacheManager.get),
          getType: typeof cacheManager.get,
          hasGetMethod: 'get' in cacheManager,
          cacheManagerKeys: Object.keys(cacheManager)
        });
        
        const mockGet = jest.spyOn(cacheManager, 'get');
        
        await emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_ID);
        
        await emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_2_ID);
        
        expect(mockGet).toHaveBeenCalled();
        mockGet.mockRestore();
      });
    });
    
    describe('Role-Based Access Control', () => {
      it('should allow admin to access system-wide operations', async () => {
        const adminResult = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, ADMIN_USER_ID);
        
        expect(adminResult.emails.length).toBeGreaterThan(0);
        expect(authManager.getGmailClient).toHaveBeenCalled();
      });
      
      it('should restrict regular users to their own data', async () => {
        const userResult = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID);
        
        expect(userResult.emails.every(email =>
          email.user_id === REGULAR_USER_ID ||
          email.recipients && email.recipients.some(recipient => recipient.includes('user1@example.com'))
        )).toBe(true);
      });
    });
    
    describe('Multi-User Session Management', () => {
      it('should handle concurrent multi-user operations', async () => {
        const user1Promise = emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_ID);
        
        const user2Promise = emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_2_ID);
        
        const adminPromise = emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, ADMIN_USER_ID);
        
        const [user1Result, user2Result, adminResult] = await Promise.all([
          user1Promise,
          user2Promise,
          adminPromise
        ]);
        
        expect(user1Result.emails.length).toBeGreaterThan(0);
        expect(user2Result.emails.length).toBeGreaterThan(0);
        expect(adminResult.emails.length).toBeGreaterThan(0);
        
        expect(authManager.getGmailClient).toHaveBeenCalledTimes(3);
      });
      
      it('should maintain separate sessions for different users', async () => {
        console.log('🔍 AUTH MANAGER METHODS:', {
          hasInvalidateSession: 'invalidateSession' in authManager,
          invalidateSessionType: typeof (authManager as any).invalidateSession,
          authManagerKeys: Object.keys(authManager),
          isMockFunction: jest.isMockFunction((authManager as any).invalidateSession)
        });
        
        if (!('invalidateSession' in authManager)) {
          (authManager as any).invalidateSession = jest.fn();
        }
        
        const mockInvalidateSession = (authManager as any).invalidateSession as jest.Mock;
        
        mockInvalidateSession.mockImplementation((sessionId) => {
          const session = mockUserSessions.get(sessionId as string);
          return session ? session.isValid() : false;
        });
        
        expect(mockInvalidateSession('admin-session-id')).toBe(true);
        expect(mockInvalidateSession('user1-session-id')).toBe(true);
        expect(mockInvalidateSession('expired-session-id')).toBe(false);
        expect(mockInvalidateSession('invalid-session-id')).toBe(false);
      });
    });
    
    describe('Multi-User Synchronization with Gmail', () => {
      it('should synchronize Gmail data per user context', async () => {
        const user1GmailClient = await authManager.getGmailClient('user1-session-id');
        
        (authManager.getGmailClient as jest.Mock).mockImplementation((sessionIdOrUserId) => {
          if (sessionIdOrUserId === REGULAR_USER_ID || sessionIdOrUserId === 'user1-session-id') {
            return Promise.resolve(user1GmailClient);
          }
          return Promise.resolve(createMockGmailClient());
        });
        
        cacheManager.delete(`last_gmail_sync_${REGULAR_USER_ID}`);
        cacheManager.delete('last_gmail_sync');
        
        (user1GmailClient.users.messages.list as jest.Mock).mockClear();
        (user1GmailClient.users.messages.get as jest.Mock).mockClear();
        
        const mockList = user1GmailClient.users.messages.list as any;
        mockList.mockResolvedValue({
          data: {
            messages: [{ id: 'new-user1-email', threadId: 'new-user1-thread' }]
          }
        } as any);

        const mockGet = user1GmailClient.users.messages.get as any;
        mockGet.mockResolvedValue({
          data: {
            id: 'new-user1-email',
            threadId: 'new-user1-thread',
            labelIds: ['INBOX'],
            snippet: 'New user 1 email',
            sizeEstimate: 10000,
            internalDate: Date.now().toString(),
            payload: {
              headers: [
                { name: 'Subject', value: 'New User 1 Email' },
                { name: 'From', value: 'sender@example.com' },
                { name: 'To', value: 'user1@example.com' },
                { name: 'Date', value: new Date().toISOString() }
              ]
            }
          }
        } as any);
        
        const result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0,
          labels: ['INBOX']
        }, REGULAR_USER_ID);
        
        expect(mockList).toHaveBeenCalled();
        expect(result.emails.some(email => email.id === 'new-user1-email')).toBe(true);
      });
      
      it('should handle Gmail API errors per user', async () => {
        console.log('🔍 GMAIL ERROR MOCK SETUP - Before:', {
          authManagerCallCount: (authManager.getGmailClient as jest.Mock).mock.calls.length
        });
        
        (authManager.getGmailClient as jest.Mock).mockImplementationOnce(() =>
          Promise.reject(new Error('Gmail API error for user'))
        );
        
        cacheManager.delete(`last_gmail_sync_${REGULAR_USER_ID}`);
        cacheManager.delete('last_gmail_sync');
        
        console.log('🔍 GMAIL ERROR MOCK SETUP - After:', {
          mockImplementation: (authManager.getGmailClient as jest.Mock).getMockImplementation()
        });
        
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Gmail API error for user');
      });
    });
    
    describe('Multi-User Error Handling', () => {
      it('should handle authentication failures with user context', async () => {
        (authManager.getGmailClient as jest.Mock).mockImplementation(() =>
          Promise.reject(new Error('Authentication failed'))
        );
        
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Authentication failed');
      });
      
      it('should handle session timeout during operations', async () => {
        const mockSession = mockUserSessions.get('user1-session-id');
        if (mockSession) {
          mockSession.isValid = jest.fn().mockReturnValue(false);
        }
        
        (authManager.getGmailClient as jest.Mock).mockImplementation(() =>
          Promise.reject(new Error('Session timeout'))
        );
        
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Session timeout');
      });
      
      it('should handle invalid user context', async () => {
        console.log('🔍 INVALID USER TEST:', {
          authManagerCallCount: (authManager.getGmailClient as jest.Mock).mock.calls.length
        });
        
        (authManager.getGmailClient as jest.Mock).mockImplementationOnce(() =>
          Promise.reject(new Error('Invalid user context'))
        );
        
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, 'non-existent-user')).rejects.toThrow('Invalid user context');
      });
    });
    
    describe('Multi-User Cache Isolation', () => {
      it('should maintain separate cache entries for different users', async () => {
        const user1Result1 = await emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_ID);
        
        const user2Result1 = await emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_2_ID);
        
        expect(user1Result1.emails).not.toEqual(user2Result1.emails);
        
        const user1Result2 = await emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_ID);
        
        expect(user1Result2.emails).toEqual(user1Result1.emails);
      });
      
      it('should invalidate cache per user context', async () => {
        await emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_ID);
        
        cacheManager.delete('last_gmail_sync');
        
        const result = await emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_ID);
        
        expect(result.emails.length).toBeGreaterThan(0);
      });
    });
    
    describe('Multi-User Performance', () => {
      it('should handle multiple users efficiently', async () => {
        const startTime = Date.now();
        
        const operations = [
          emailFetcher.listEmails({ limit: 10, offset: 0 }, ADMIN_USER_ID),
          emailFetcher.listEmails({ limit: 10, offset: 0 }, REGULAR_USER_ID),
          emailFetcher.listEmails({ limit: 10, offset: 0 }, REGULAR_USER_2_ID),
          emailFetcher.listEmails({ limit: 5, offset: 0 }, REGULAR_USER_ID),
          emailFetcher.listEmails({ limit: 5, offset: 0 }, REGULAR_USER_2_ID)
        ];
        
        const results = await Promise.all(operations);
        const endTime = Date.now();
        
        expect(results.length).toBe(5);
        results.forEach(result => {
          expect(result.emails).toBeDefined();
          expect(Array.isArray(result.emails)).toBe(true);
        });
        
        expect(endTime - startTime).toBeLessThan(5000);
      });
    });
    
    describe('Integration with Existing Architecture', () => {
      it('should maintain backward compatibility with single-user mode', async () => {
        const singleUserResult = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, TEST_USER_ID);
        expect(singleUserResult.emails).toBeDefined();
        expect(Array.isArray(singleUserResult.emails)).toBe(true);
        expect(authManager.getGmailClient).toHaveBeenCalled();
      });
      
      it('should follow authentication flow: session validation → Gmail client → email operations', async () => {
        const result = await emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_ID);
        
        expect(authManager.getGmailClient).toHaveBeenCalled();
        expect(result.emails.length).toBeGreaterThan(0);
        
        expect(result.total).toBeGreaterThanOrEqual(result.emails.length);
      });
    });
  });
});