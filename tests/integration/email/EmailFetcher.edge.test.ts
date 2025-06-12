import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { EmailFetcher } from '../../../src/email/EmailFetcher.js';
import { PriorityCategory } from '../../../src/types/index.js';
import { mockGmailMessages, mockListResponse } from './fixtures/mockGmailResponses.js';
import { createMockDatabase, createMockCache, createMockGmailClient } from '../../utils/testHelpers';



describe('EmailFetcher Edge Cases', () => {
  let emailFetcher: EmailFetcher;
  let mockDbManager: any;
  let mockAuthManager: { getGmailClient: jest.Mock };
  let mockCacheManager: any;
  let mockGmailClient: any;

  beforeEach(() => {
    mockDbManager = createMockDatabase();
    mockCacheManager = createMockCache();
    mockGmailClient = createMockGmailClient();
    mockAuthManager = {
      getGmailClient: jest.fn().mockImplementation(() => Promise.resolve(mockGmailClient))
    };

    emailFetcher = new EmailFetcher(
      mockDbManager,
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
      })).rejects.toThrow('Network error');
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
      });
      
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
      });
      
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
      });
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
      });
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