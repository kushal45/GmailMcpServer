import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { EmailFetcher } from '../../../src/email/EmailFetcher.js';
import { PriorityCategory } from '../../../src/types/index.js';
import { mockGmailMessages, mockListResponse } from './fixtures/mockGmailResponses.js';
import { createMockDatabase, createMockCache, createMockGmailClient } from '../../utils/testHelpers';



describe('EmailFetcher Edge Cases', () => {
  // Test users for multi-user scenarios
  const ADMIN_USER_ID = 'admin-user-edge-1';
  const REGULAR_USER_ID = 'regular-user-edge-1';
  const REGULAR_USER_2_ID = 'regular-user-edge-2';
  const ADMIN_SESSION_ID = 'admin-session-edge-1';
  const REGULAR_USER_SESSION_ID = 'regular-user-session-edge-1';
  const REGULAR_USER_2_SESSION_ID = 'regular-user-2-session-edge-1';
  
  // User profile constants removed as they were unused in the tests
  // Tests use user IDs directly for better clarity and reduced complexity

  describe('Single-User Edge Cases', () => {
    let emailFetcher: EmailFetcher;
    let mockDbManager: any;
    let mockAuthManager: { getGmailClient: jest.Mock; getSessionId: jest.Mock };
    let mockCacheManager: any;
    let mockGmailClient: any;
    let mockUserDbManagerFactory: any;

    beforeEach(() => {
      mockDbManager = createMockDatabase() as any;
      mockCacheManager = createMockCache();
      mockGmailClient = createMockGmailClient();
      mockAuthManager = {
        getGmailClient: jest.fn().mockImplementation(() => Promise.resolve(mockGmailClient)),
        getSessionId: jest.fn().mockImplementation(() => Promise.resolve('mock-session-id'))
      };

      mockUserDbManagerFactory = {
        //@ts-ignore
        getUserDatabaseManager: jest.fn().mockResolvedValue(mockDbManager)
      };

      emailFetcher = new EmailFetcher(
        mockUserDbManagerFactory as any,
        mockAuthManager as any,
        mockCacheManager
      );

      mockDbManager.searchEmails.mockResolvedValue([]);
      mockDbManager.getEmailCount.mockResolvedValue(0);
      mockDbManager.upsertEmailIndex.mockResolvedValue(undefined);
      mockCacheManager.get.mockReturnValue(null);
      mockCacheManager.set.mockImplementation(() => {});
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('Error Handling', () => {
    it('should handle Gmail API connection errors', async () => {
      // Force sync by returning old sync time
      mockCacheManager.get = jest.fn()
        .mockReturnValueOnce(null) // No cache for emails
        .mockReturnValueOnce(0);   // Old sync time
      
      // Simulate network error
      mockGmailClient.users.messages.list.mockRejectedValue(
        new Error('Network error')
      );
      
      // Expect error to be propagated
      await expect(emailFetcher.listEmails({
        limit: 10,
        offset: 0
      }, REGULAR_USER_ID)).rejects.toThrow('Network error');
    });
    
    it('should handle malformed Gmail API list response', async () => {
      // Force sync
      mockCacheManager.get = jest.fn()
        .mockReturnValueOnce(null) // No cache for emails
        .mockReturnValueOnce(0);   // Old sync time
      
      // Return malformed response
      mockGmailClient.users.messages.list.mockResolvedValue(
        mockListResponse.malformed
      );
      
      // Should not throw but return empty results
      const result = await emailFetcher.listEmails({
        limit: 10,
        offset: 0
      }, REGULAR_USER_ID);
      
      expect(result.emails).toEqual([]);
      expect(result.total).toBe(0);
    });
    
    it('should handle errors in individual message processing', async () => {
      // Force sync
      mockCacheManager.get = jest.fn()
        .mockReturnValueOnce(null) // No cache for emails
        .mockReturnValueOnce(0);   // Old sync time
      
      // Return list with multiple messages
      mockGmailClient.users.messages.list.mockResolvedValue(mockListResponse.normal);
      
      // First message throws error, second succeeds
      mockGmailClient.users.messages.get
        .mockRejectedValueOnce(new Error('Message fetch error'))
        .mockResolvedValueOnce({ data: mockGmailMessages.simple });
      
      // Should continue processing after error
      await emailFetcher.listEmails({
        limit: 10,
        offset: 0
      }, REGULAR_USER_ID);
      
      // Verify second message was still processed
      expect(mockDbManager.upsertEmailIndex).toHaveBeenCalledTimes(1);
    });
    
    it('should handle malformed message data', async () => {
      // Force sync
      mockCacheManager.get = jest.fn()
        .mockReturnValueOnce(null) // No cache for emails
        .mockReturnValueOnce(0);   // Old sync time
      // Return list with one message
      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'malformed-message' }]
        }
      });
      // Return malformed message
      mockGmailClient.users.messages.get.mockResolvedValue({
        data: mockGmailMessages.malformed
      });
      // Should handle malformed data without crashing
      await emailFetcher.listEmails({
        limit: 10,
        offset: 0
      }, REGULAR_USER_ID);
      // Should NOT call upsertEmailIndex for malformed message
      expect(mockDbManager.upsertEmailIndex).not.toHaveBeenCalled();
    });
    
    it('should handle database errors during synchronization', async () => {
      // Force sync
      mockCacheManager.get = jest.fn()
        .mockReturnValueOnce(null) // No cache for emails
        .mockReturnValueOnce(0);   // Old sync time
      
      // Return list with one message
      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: 'simple-message' }]
        }
      });
      
      // Return valid message
      mockGmailClient.users.messages.get.mockResolvedValue({
        data: mockGmailMessages.simple
      });
      
      // Database throws error during upsert
      mockDbManager.upsertEmailIndex.mockRejectedValue(
        new Error('Database error')
      );
      
      // Should handle error gracefully and not throw
      const result = await emailFetcher.listEmails({
        limit: 10,
        offset: 0
      }, REGULAR_USER_ID);
      expect(result.emails).toEqual([]);
      expect(result.total).toBe(0);
    });
    });
    
    describe('Attachment Detection', () => {
    it('should detect direct attachments', async () => {
      // Access private method using any type
      const checkMethod = (emailFetcher as any).checkForAttachments.bind(emailFetcher);
      
      // Check payload with direct attachment
      const result = checkMethod({
        filename: 'document.pdf',
        mimeType: 'application/pdf'
      });
      
      expect(result).toBe(true);
    });
    
    it('should detect attachments in parts', async () => {
      // Access private method using any type
      const checkMethod = (emailFetcher as any).checkForAttachments.bind(emailFetcher);
      
      // Check payload with attachment in parts
      const result = checkMethod(mockGmailMessages.withAttachment.payload);
      
      expect(result).toBe(true);
    });
    
    it('should detect nested attachments', async () => {
      // Access private method using any type
      const checkMethod = (emailFetcher as any).checkForAttachments.bind(emailFetcher);
      
      // Check payload with nested attachment
      const result = checkMethod(mockGmailMessages.withNestedParts.payload);
      
      expect(result).toBe(true);
    });
    
    it('should handle malformed parts', async () => {
      // Access private method using any type
      const checkMethod = (emailFetcher as any).checkForAttachments.bind(emailFetcher);
      
      // Check payload with malformed parts
      const result = checkMethod(mockGmailMessages.malformed.payload);
      
      expect(result).toBe(false);
    });
    });
    
    describe('Message Conversion', () => {
    it('should convert simple message correctly', async () => {
      // Access private method using any type
      const convertMethod = (emailFetcher as any).convertToEmailIndex.bind(emailFetcher);
      
      // Convert simple message
      const result = convertMethod(mockGmailMessages.simple);
      
      // Verify conversion
      expect(result).toEqual(expect.objectContaining({
        id: 'simple-message',
        threadId: 'simple-thread',
        subject: 'Simple Test',
        sender: 'sender@example.com',
        recipients: ['recipient@example.com'],
        category: PriorityCategory.MEDIUM,
        size: 5000,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: 'This is a simple test message',
        archived: false
      }));
    });
    
    it('should detect attachments during conversion', async () => {
      // Access private method using any type
      const convertMethod = (emailFetcher as any).convertToEmailIndex.bind(emailFetcher);
      
      // Convert message with attachment
      const result = convertMethod(mockGmailMessages.withAttachment);
      
      // Verify attachment detection
      expect(result.hasAttachments).toBe(true);
    });
    
    it('should handle missing fields with fallbacks', async () => {
      // Access private method using any type
      const convertMethod = (emailFetcher as any).convertToEmailIndex.bind(emailFetcher);
      
      // Convert incomplete message
      const result = convertMethod(mockGmailMessages.incomplete);
      
      // Verify fallbacks
      expect(result).toEqual(expect.objectContaining({
        id: 'incomplete-message',
        threadId: 'incomplete-thread',
        subject: 'Incomplete Message',
        sender: '',
        recipients: [],
        size: 0,
        hasAttachments: false,
        labels: [],
        archived: true // No INBOX label
      }));
    });
    
    it('should throw error for completely invalid message', async () => {
      // Access private method using any type
      const convertMethod = (emailFetcher as any).convertToEmailIndex.bind(emailFetcher);
      
      // Expect error for null message
      expect(() => convertMethod(null)).toThrow();
      
      // Expect error for message without payload
      expect(() => convertMethod({ id: 'no-payload' })).toThrow();
    });
    });
  });

  describe('Multi-User Edge Cases', () => {
    let dbManagers: Record<string, any>;
    let mockUserDbManagerFactory: any;
    let mockAuthManager: any;
    let mockCacheManager: any;
    let user1GmailClient: any;
    let user2GmailClient: any;
    let adminGmailClient: any;
    let emailFetcher: EmailFetcher;

    beforeEach(() => {
      dbManagers = {
        [ADMIN_USER_ID]: createMockDatabase(),
        [REGULAR_USER_ID]: createMockDatabase(),
        [REGULAR_USER_2_ID]: createMockDatabase(),
      };
      // [FIX] Ensure all dbManagers return valid values for searchEmails, getEmailCount, upsertEmailIndex
      Object.values(dbManagers).forEach(db => {
        db.searchEmails.mockResolvedValue([]);
        db.getEmailCount.mockResolvedValue(0);
        db.upsertEmailIndex.mockResolvedValue(undefined);
      });
      mockUserDbManagerFactory = {
        getUserDatabaseManager: jest.fn().mockImplementation((userId: any) => {
          if (!dbManagers[userId]) throw new Error('User not found');
          return Promise.resolve(dbManagers[userId]);
        })
      };
      // [FIX] Create persistent Gmail client mocks for each user
      user1GmailClient = createMockGmailClient();
      user1GmailClient.metadata="kushal";
      user2GmailClient = createMockGmailClient();
      adminGmailClient = createMockGmailClient();
      mockAuthManager = {
        // [FIX] Always return the same Gmail client instance for each user
        getGmailClient: jest.fn().mockImplementation((sessionId) => {
          if (sessionId === REGULAR_USER_SESSION_ID) return Promise.resolve(user1GmailClient);
          if (sessionId === REGULAR_USER_2_SESSION_ID) return Promise.resolve(user2GmailClient);
          if (sessionId === ADMIN_SESSION_ID) return Promise.resolve(adminGmailClient);
          return Promise.resolve(createMockGmailClient());
        }),
        getSessionId: jest.fn().mockImplementation((userId) => {
          if (userId === REGULAR_USER_ID) return REGULAR_USER_SESSION_ID;
          if (userId === REGULAR_USER_2_ID) return REGULAR_USER_2_SESSION_ID;
          if (userId === ADMIN_USER_ID) return ADMIN_SESSION_ID;
        }),
        // [FIX] Add validateSession mock for session invalidation tests
        validateSession: jest.fn()
      };
      mockCacheManager = createMockCache();
      emailFetcher = new EmailFetcher(
        mockUserDbManagerFactory as any,
        mockAuthManager,
        mockCacheManager
      );
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('Multi-User OAuth Token Expiration', () => {
      it('should handle OAuth token expiration during Gmail API calls', async () => {
        // Force sync by returning old sync time
        mockCacheManager.get = jest.fn()
          .mockReturnValueOnce(null) // No cache for emails
          .mockReturnValueOnce(0);   // Old sync time

        user1GmailClient.users.messages.list.mockReset();
        user1GmailClient.users.messages.list.mockRejectedValueOnce(
          new Error('Invalid Credentials: Token has been expired or revoked')
        );

        // Expect error to be propagated with user context
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Invalid Credentials: Token has been expired or revoked');

        // Verify the correct user's Gmail client was called
        expect(mockAuthManager.getGmailClient).toHaveBeenCalledWith(REGULAR_USER_SESSION_ID);
      });

      it('should handle token refresh failure during operation', async () => {
        // Force sync
        mockCacheManager.get = jest.fn()
          .mockReturnValueOnce(null) // No cache for emails
          .mockReturnValueOnce(0);   // Old sync time

        // Mock token refresh failure
        mockAuthManager.getGmailClient.mockImplementationOnce(() =>
          Promise.reject(new Error('Token refresh failed'))
        );

        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Token refresh failed');
      });

      it('should isolate token expiration errors between users', async () => {
        // Force sync for both users
        mockCacheManager.get = jest.fn()
          .mockReturnValue(null); // No cache
        
        // User 1 has expired token
        const user1GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_SESSION_ID);
        user1GmailClient.users.messages.list.mockRejectedValue(
          new Error('Token expired for user 1')
        );

        // User 2 has valid token
        const user2GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_2_SESSION_ID);
        user2GmailClient.users.messages.list.mockResolvedValue(mockListResponse.empty);

        // User 1 should fail
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Token expired for user 1');

        // User 2 should succeed
        const user2Result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_2_ID);

        expect(user2Result.emails).toEqual([]);
        expect(user2Result.total).toBe(0);
      });
    });

    describe('Multi-User Session Invalidation', () => {
      it('should handle session invalidation during Gmail API failures', async () => {
        // Force sync
        mockCacheManager.get = jest.fn()
          .mockReturnValueOnce(null) // No cache for emails
          .mockReturnValueOnce(0);   // Old sync time

        // First call succeeds (session valid), then session becomes invalid
        mockAuthManager.validateSession.mockReturnValueOnce(true).mockReturnValue(false);
        mockAuthManager.getGmailClient.mockImplementationOnce(() =>
          Promise.reject(new Error('Session invalidated during operation'))
        );

        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Session invalidated during operation');
      });

      it('should handle concurrent session invalidation', async () => {
        // Mock both users having invalid sessions
        mockAuthManager.getGmailClient.mockImplementation((sessionId: string) => {
          // Handle both direct userId and sessionId
          if ( sessionId === REGULAR_USER_SESSION_ID) {
            return Promise.reject(new Error('Session invalid for user 1'));
          }
          if (sessionId === REGULAR_USER_2_SESSION_ID) {
            return Promise.reject(new Error('Session invalid for user 2'));
          }
          return Promise.reject(new Error('Unknown session'));
        });

        // Both users should fail independently
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Session invalid for user 1');

        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_2_ID)).rejects.toThrow('Session invalid for user 2');
      });

      it('should handle expired session during individual message processing', async () => {
        // Force sync
        mockCacheManager.get = jest.fn()
          .mockReturnValueOnce(null) // No cache for emails
          .mockReturnValueOnce(0);   // Old sync time

        const user1GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_ID);
        
        // List succeeds but get fails due to session expiration
        user1GmailClient.users.messages.list.mockResolvedValue(mockListResponse.normal);
        user1GmailClient.users.messages.get.mockRejectedValue(
          new Error('Session expired during message fetch')
        );

        // Should handle error gracefully during sync
        const result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID);

        // Should return empty results due to message processing failures
        expect(result.emails).toEqual([]);
        expect(result.total).toBe(0);
      });
    });

    describe('Multi-User Error Handling and Recovery', () => {
      it('should handle user-specific Gmail API rate limits', async () => {
        // Force sync
        mockCacheManager.get = jest.fn()
          .mockReturnValueOnce(null) // No cache for emails
          .mockReturnValueOnce(0);   // Old sync time

        // Mock rate limit error for specific user
        const user1GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_SESSION_ID);
        user1GmailClient.users.messages.list.mockRejectedValue(
          new Error('User rate limit exceeded')
        );

        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('User rate limit exceeded');

        // Verify user context was passed
        expect(mockAuthManager.getGmailClient).toHaveBeenCalledWith(REGULAR_USER_SESSION_ID);
      });

      it('should handle malformed Gmail API responses with user context', async () => {
        // Force sync
        mockCacheManager.get = jest.fn()
          .mockReturnValueOnce(null) // No cache for emails
          .mockReturnValueOnce(0);   // Old sync time

        const user1GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_ID);
        
        // Return malformed response
        user1GmailClient.users.messages.list.mockResolvedValue(
          mockListResponse.malformed
        );

        // Should not throw but return empty results
        const result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID);

        expect(result.emails).toEqual([]);
        expect(result.total).toBe(0);
      });

      it('should handle database errors during multi-user synchronization', async () => {
        // Force sync
        mockCacheManager.get = jest.fn()
          .mockReturnValueOnce(null) // No cache for emails
          .mockReturnValueOnce(0);   // Old sync time

        const user1GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_ID);
        
        // Return valid Gmail response
        user1GmailClient.users.messages.list.mockResolvedValue({
          data: {
            messages: [{ id: 'user1-message' }]
          }
        });
        
        user1GmailClient.users.messages.get.mockResolvedValue({
          data: mockGmailMessages.simple
        });

        // Database throws user-specific error during upsert
        dbManagers[REGULAR_USER_ID].upsertEmailIndex.mockRejectedValue(
          new Error(`Database error for user ${REGULAR_USER_ID}`)
        );

        // Should handle error gracefully and not throw
        const result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID);
        
        expect(result.emails).toEqual([]);
        expect(result.total).toBe(0);
      });
    });

    describe('Multi-User Cross-User Data Isolation During Errors', () => {
      it('should prevent cross-user data contamination during errors', async () => {
        // Setup different responses for different users
        const user1GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_SESSION_ID);
        const user2GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_2_SESSION_ID);

        // Force sync for both users
        mockCacheManager.get = jest.fn().mockReturnValue(null);

        // User 1 has network error
        user1GmailClient.users.messages.list.mockRejectedValue(
          new Error('Network error for user 1')
        );

        // User 2 has valid response
        user2GmailClient.users.messages.list.mockResolvedValue(mockListResponse.empty);

        // User 1 should fail with their specific error
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Network error for user 1');

        // User 2 should succeed independently
        const user2Result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_2_ID);

        expect(user2Result.emails).toEqual([]);
        expect(user2Result.total).toBe(0);

        // Verify correct clients were called for each user
        expect(mockAuthManager.getGmailClient).toHaveBeenCalledWith(REGULAR_USER_SESSION_ID);
        expect(mockAuthManager.getGmailClient).toHaveBeenCalledWith(REGULAR_USER_2_SESSION_ID);
      });

      it('should isolate cache corruption between users', async () => {
        // Mock cache get to return corrupted data for user 1, valid for user 2
        mockCacheManager.get = jest.fn().mockImplementation((key: any) => {
          if (key.includes(REGULAR_USER_ID)) {
            return { corrupted: 'data', timestamp: Date.now() - 10000 }; // Invalid cache structure, expired
          }
          if (key.includes(REGULAR_USER_2_ID)) {
            return null; // Valid cache miss
          }
          return null;
        });

        // User 1 should handle corrupted cache gracefully (cache will be considered expired)
        const user1Result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID);

        // User 2 should work normally
        const user2Result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_2_ID);

        // Both should return empty results but not crash
        expect(user1Result.emails).toEqual([]);
        expect(user2Result.emails).toEqual([]);
      });

      it('should handle user-specific database connection errors', async () => {
        // Mock database to fail for specific user operations
        dbManagers[REGULAR_USER_ID].searchEmails.mockImplementation((criteria: any) => {
          if (criteria.user_id === REGULAR_USER_ID) {
            return Promise.reject(new Error('Database connection failed for user 1'));
          }
          return Promise.resolve([]);
        });

        // User 1 should fail with database error
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Database connection failed for user 1');

        // User 2 should work normally
        const user2Result = await emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_2_ID);

        expect(user2Result.emails).toEqual([]);
        expect(user2Result.total).toBe(0);
      });
    });

    describe('Multi-User Concurrent Operations During Failures', () => {
      it('should handle concurrent operations when one user has failures', async () => {
        // Force sync for all users
        mockCacheManager.get = jest.fn().mockReturnValue(null);

        const adminGmailClient = await mockAuthManager.getGmailClient(ADMIN_SESSION_ID);
        const user1GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_SESSION_ID);
        const user2GmailClient = await mockAuthManager.getGmailClient(REGULAR_USER_2_SESSION_ID);

        // Admin succeeds
        adminGmailClient.users.messages.list.mockResolvedValue(mockListResponse.empty);
        
        // User 1 fails
        user1GmailClient.users.messages.list.mockRejectedValue(
          new Error('Gmail API error for user 1')
        );
        
        // User 2 succeeds
        user2GmailClient.users.messages.list.mockResolvedValue(mockListResponse.empty);

        // Run concurrent operations
        const adminPromise = emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, ADMIN_USER_ID);

        const user1Promise = emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_ID);

        const user2Promise = emailFetcher.listEmails({
          limit: 5,
          offset: 0
        }, REGULAR_USER_2_ID);

        // Wait for results
        const [adminResult, user1Error, user2Result] = await Promise.allSettled([
          adminPromise,
          user1Promise,
          user2Promise
        ]);

        // Admin should succeed
        expect(adminResult.status).toBe('fulfilled');
        if (adminResult.status === 'fulfilled') {
          expect(adminResult.value.emails).toEqual([]);
        }

        // User 1 should fail
        expect(user1Error.status).toBe('rejected');
        if (user1Error.status === 'rejected') {
          expect(user1Error.reason.message).toContain('Gmail API error for user 1');
        }

        // User 2 should succeed
        expect(user2Result.status).toBe('fulfilled');
        if (user2Result.status === 'fulfilled') {
          expect(user2Result.value.emails).toEqual([]);
        }
      });

      it('should handle concurrent session timeouts', async () => {
        // Mock all sessions to timeout during operation
        mockAuthManager.getGmailClient.mockImplementation((sessionId: string) => {
          // Map sessionId back to userId for consistent error messages
          const userIdMap: { [key: string]: string } = {
            [ADMIN_SESSION_ID]: ADMIN_USER_ID,
            [REGULAR_USER_SESSION_ID]: REGULAR_USER_ID,
            [REGULAR_USER_2_SESSION_ID]: REGULAR_USER_2_ID
          };
          
          const userId = userIdMap[sessionId as string] || sessionId;
          return Promise.reject(new Error(`Session timeout for ${userId}`));
        });

        // Run concurrent operations
        const operations = [
          emailFetcher.listEmails({ limit: 5, offset: 0 }, ADMIN_USER_ID),
          emailFetcher.listEmails({ limit: 5, offset: 0 }, REGULAR_USER_ID),
          emailFetcher.listEmails({ limit: 5, offset: 0 }, REGULAR_USER_2_ID)
        ];

        const results = await Promise.allSettled(operations);

        // All should fail with their respective session timeout errors
        results.forEach((result, index) => {
          expect(result.status).toBe('rejected');
          if (result.status === 'rejected') {
            const expectedUserId = [ADMIN_USER_ID, REGULAR_USER_ID, REGULAR_USER_2_ID][index];
            expect(result.reason.message).toContain(`Session timeout for ${expectedUserId}`);
          }
        });
      });
    });

    describe('Multi-User Authentication Failure Edge Cases', () => {
      it('should handle invalid user context gracefully', async () => {
        // [FIX] Add db manager for 'non-existent-user' to avoid 'User not found' error
        const nonExistentUserDbManager = createMockDatabase() as any;
        // Configure mock methods with proper return values
        nonExistentUserDbManager.searchEmails.mockResolvedValue([]);
        nonExistentUserDbManager.getEmailCount.mockResolvedValue(0);
        nonExistentUserDbManager.upsertEmailIndex.mockResolvedValue(undefined);
        dbManagers['non-existent-user'] = nonExistentUserDbManager;
        // Mock auth manager to reject invalid users
        mockAuthManager.getSessionId.mockImplementation((userId: string) => {
          if (userId === 'non-existent-user') {
            return Promise.reject(new Error('User not found'));
          }
          return Promise.resolve('valid-session-id');
        });

        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, 'non-existent-user')).rejects.toThrow('User not found');
      });

      it('should handle malformed session data', async () => {
        // [FIX] Add db manager for 'malformed-user' to avoid 'User not found' error
        const malformedUserDbManager = createMockDatabase() as any;
        // Configure mock methods with proper return values
        malformedUserDbManager.searchEmails.mockResolvedValue([]);
        malformedUserDbManager.getEmailCount.mockResolvedValue(0);
        malformedUserDbManager.upsertEmailIndex.mockResolvedValue(undefined);
        dbManagers['malformed-user'] = malformedUserDbManager;
        // Mock getSessionId to return malformed session
        mockAuthManager.getSessionId.mockImplementation((userId: string) => {
          if (userId === 'malformed-user') {
            return Promise.resolve('malformed-session-id');
          }
          return Promise.resolve('valid-session-id');
        });

        // Mock getGmailClient to reject malformed sessions
        mockAuthManager.getGmailClient.mockImplementation((sessionId: string) => {
          if (sessionId === 'malformed-session-id') {
            return Promise.reject(new Error('Malformed session data'));
          }
          return Promise.resolve(createMockGmailClient());
        });

        // Should handle malformed session gracefully
        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, 'malformed-user')).rejects.toThrow('Malformed session data');
      });

      it('should handle authentication provider failures', async () => {
        // Mock complete authentication system failure
        mockAuthManager.getGmailClient.mockImplementation(() => {
          return Promise.reject(new Error('Authentication provider unavailable'));
        });

        mockAuthManager.getSessionId.mockImplementation(() => {
          return Promise.reject(new Error('Authentication provider unavailable'));
        });

        await expect(emailFetcher.listEmails({
          limit: 10,
          offset: 0
        }, REGULAR_USER_ID)).rejects.toThrow('Authentication provider unavailable');
      });
    });
  });
});