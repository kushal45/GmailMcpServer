import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { EmailFetcher } from '../../../src/email/EmailFetcher';
import { AuthManager } from '../../../src/auth/AuthManager';
import { CacheManager } from '../../../src/cache/CacheManager';
import { DatabaseManager } from '../../../src/database/DatabaseManager';
import { 
  createMockGmailClient, 
  createMockDatabase, 
  createMockCache,
  mockFetch,
  cleanupMocks 
} from '../../utils/testHelpers';
import { 
  mockEmailMessage, 
  mockEmailIndex, 
  mockGmailListResponse,
  mockGmailGetResponse,
  createMockEmails 
} from '../../fixtures/mockData';

// Mock node-fetch
jest.mock('node-fetch');

describe('EmailFetcher', () => {
  let emailFetcher: EmailFetcher;
  let mockAuthManager: jest.Mocked<AuthManager>;
  let mockCacheManager: jest.Mocked<CacheManager>;
  let mockDatabaseManager: any;
  let mockGmailClient: ReturnType<typeof createMockGmailClient>;

  beforeEach(() => {
    // Create mocks
    mockGmailClient = createMockGmailClient();
    mockAuthManager = {
      getGmailClient: jest.fn(() => Promise.resolve(mockGmailClient)),
      getClient: jest.fn(() => ({
        getAccessToken: jest.fn(() => Promise.resolve({ token: 'mock-token' }))
      }))
    } as any;
    
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn()
    } as any;
    
    mockDatabaseManager = createMockDatabase();
    
    emailFetcher = new EmailFetcher(
      mockAuthManager as any,
      mockCacheManager as any,
      mockDatabaseManager
    );
  });

  afterEach(() => {
    cleanupMocks();
  });

  describe('listEmails', () => {
    const listOptions = {
      limit: 10,
      offset: 0
    };

    it('should return cached results if available', async () => {
      const cachedData = {
        emails: createMockEmails(5),
        total: 5
      };
      mockCacheManager.get.mockReturnValue(cachedData);

      const result = await emailFetcher.listEmails(listOptions);

      expect(mockCacheManager.get).toHaveBeenCalledWith(
        expect.stringContaining('email-list:')
      );
      expect(result).toEqual(cachedData);
      expect(mockAuthManager.getGmailClient).not.toHaveBeenCalled();
    });

    it('should fetch emails from Gmail API when cache miss', async () => {
      mockCacheManager.get.mockReturnValue(null);
      (mockGmailClient.users.messages.list as any).mockResolvedValue(mockGmailListResponse);
      (mockGmailClient.users.messages.get as any).mockResolvedValue(mockGmailGetResponse);

      const result = await emailFetcher.listEmails(listOptions);

      expect(mockAuthManager.getGmailClient).toHaveBeenCalled();
      expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: '',
        maxResults: 10,
        pageToken: undefined
      });
      expect(result.emails).toHaveLength(3); // Based on mockGmailListResponse
      expect(mockDatabaseManager.bulkUpsertEmailIndex).toHaveBeenCalled();
    });

    it('should apply category filter', async () => {
      mockCacheManager.get.mockReturnValue(null);
      (mockGmailClient.users.messages.list as any).mockResolvedValue({
        data: { messages: [], resultSizeEstimate: 0 }
      });

      await emailFetcher.listEmails({ ...listOptions, category: 'high' });

      expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'label:high',
        maxResults: 10,
        pageToken: undefined
      });
    });

    it('should apply year filter', async () => {
      mockCacheManager.get.mockReturnValue(null);
      (mockGmailClient.users.messages.list as any).mockResolvedValue({
        data: { messages: [], resultSizeEstimate: 0 }
      });

      await emailFetcher.listEmails({ ...listOptions, year: 2024 });

      expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'after:2024/1/1 before:2025/1/1',
        maxResults: 10,
        pageToken: undefined
      });
    });

    it('should handle errors gracefully', async () => {
      mockCacheManager.get.mockReturnValue(null);
      const error = new Error('Gmail API error');
      (mockGmailClient.users.messages.list as any).mockRejectedValue(error);

      await expect(emailFetcher.listEmails(listOptions)).rejects.toThrow('Gmail API error');
    });
  });

  describe('getEmailDetailsBulk', () => {
    it('should return empty array for empty message IDs', async () => {
      const result = await emailFetcher.getEmailDetailsBulk([]);
      
      expect(result).toEqual([]);
      expect(mockAuthManager.getGmailClient).not.toHaveBeenCalled();
    });

    it('should fetch email details via batch API', async () => {
      const messageIds = ['msg1', 'msg2', 'msg3'];
      const mockBatchResponse = `--batch_123
Content-Type: application/http

HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "msg1",
  "threadId": "thread1",
  "labelIds": ["INBOX"],
  "snippet": "Test email 1",
  "payload": {
    "headers": [
      {"name": "From", "value": "sender1@example.com"},
      {"name": "To", "value": "recipient@example.com"},
      {"name": "Subject", "value": "Test Subject 1"},
      {"name": "Date", "value": "Mon, 1 Jan 2024 12:00:00 +0000"}
    ]
  },
  "sizeEstimate": 1024
}
--batch_123--`;

      const mockedFetch = mockFetch([{
        ok: true,
        status: 200,
        text: () => Promise.resolve(mockBatchResponse)
      }]);
      (global as any).fetch = mockedFetch;

      const result = await emailFetcher.getEmailDetailsBulk(messageIds);

      expect(mockedFetch).toHaveBeenCalledWith(
        'https://gmail.googleapis.com/batch/gmail/v1',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer mock-token',
            'Content-Type': expect.stringContaining('multipart/mixed')
          })
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('msg1');
    });

    it('should handle batch API errors and fall back to individual fetching for small batches', async () => {
      const messageIds = ['msg1', 'msg2'];
      const mockedFetch = mockFetch([{
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error')
      }]);
      (global as any).fetch = mockedFetch;

      (mockGmailClient.users.messages.get as any).mockResolvedValue(mockGmailGetResponse);

      const result = await emailFetcher.getEmailDetailsBulk(messageIds);

      expect(mockedFetch).toHaveBeenCalled();
      expect(mockAuthManager.getGmailClient).toHaveBeenCalled();
      expect(mockGmailClient.users.messages.get).toHaveBeenCalledTimes(2);
    });

    it('should handle missing emails gracefully', async () => {
      const messageIds = ['msg1', 'msg2', 'msg3'];
      const mockBatchResponse = `--batch_123
Content-Type: application/http

HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": {
    "code": 404,
    "message": "Message not found"
  }
}
--batch_123--`;

      const mockedFetch = mockFetch([{
        ok: true,
        status: 200,
        text: () => Promise.resolve(mockBatchResponse)
      }]);
      (global as any).fetch = mockedFetch;

      const result = await emailFetcher.getEmailDetailsBulk(messageIds);

      expect(result).toEqual([]);
    });
  });

  describe('getAllMessageIds', () => {
    it('should fetch all message IDs with pagination', async () => {
      const page1Response = {
        data: {
          messages: [{ id: 'msg1' }, { id: 'msg2' }],
          nextPageToken: 'token123'
        }
      };
      const page2Response = {
        data: {
          messages: [{ id: 'msg3' }, { id: 'msg4' }],
          nextPageToken: undefined
        }
      };

      (mockGmailClient.users.messages.list as any)
        .mockResolvedValueOnce(page1Response)
        .mockResolvedValueOnce(page2Response);

      const result = await emailFetcher.getAllMessageIds();

      expect(mockGmailClient.users.messages.list).toHaveBeenCalledTimes(2);
      expect(mockGmailClient.users.messages.list).toHaveBeenNthCalledWith(1, {
        userId: 'me',
        q: '',
        maxResults: 500,
        pageToken: undefined
      });
      expect(mockGmailClient.users.messages.list).toHaveBeenNthCalledWith(2, {
        userId: 'me',
        q: '',
        maxResults: 500,
        pageToken: 'token123'
      });
      expect(result).toEqual(['msg1', 'msg2', 'msg3', 'msg4']);
    });

    it('should apply query filter when provided', async () => {
      (mockGmailClient.users.messages.list as any).mockResolvedValue({
        data: { messages: [], nextPageToken: undefined }
      });

      await emailFetcher.getAllMessageIds('from:test@example.com');

      expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith({
        userId: 'me',
        q: 'from:test@example.com',
        maxResults: 500,
        pageToken: undefined
      });
    });

    it('should handle empty results', async () => {
      (mockGmailClient.users.messages.list as any).mockResolvedValue({
        data: { messages: undefined, nextPageToken: undefined }
      });

      const result = await emailFetcher.getAllMessageIds();

      expect(result).toEqual([]);
    });
  });
});