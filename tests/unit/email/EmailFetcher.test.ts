import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { EmailFetcher } from "../../../src/email/EmailFetcher.js";
import { EmailIndex, PriorityCategory } from "../../../src/types/index.js";

describe("EmailFetcher", () => {
  let emailFetcher: EmailFetcher;
  let mockDbManager: any;
  let mockAuthManager: any;
  let mockCacheManager: any;
  let mockGmailClient: any;

  beforeEach(() => {
    // Use helper to create properly typed mock database manager
   
    mockDbManager = {};
    // Ensure all DB methods used in EmailFetcher are mocked
    mockDbManager.searchEmails = jest.fn();
    mockDbManager.getEmailCount = jest.fn();
    mockDbManager.upsertEmailIndex = jest.fn();

    const mockUserDbManagerFactory = {
      getUserDatabaseManager: jest.fn().mockImplementation(() => {
         return Promise.resolve(mockDbManager);
      })
    };
    mockAuthManager = {
      getGmailClient: jest.fn(),
      getSessionId: jest.fn().mockReturnValue('test-session-123'),
    };
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
    };

    // Setup Gmail client mock
    mockGmailClient = {
      users: {
        messages: {
          list: jest.fn(),
          get: jest.fn(),
        },
      },
    };

    // Setup auth manager to return mock Gmail client
    mockAuthManager.getGmailClient.mockResolvedValue(mockGmailClient);

    // Create EmailFetcher instance with mocks
    emailFetcher = new EmailFetcher(
      mockUserDbManagerFactory as any,
      mockAuthManager,
      mockCacheManager
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("listEmails", () => {
    it("should return cached results when available and fresh", async () => {
      // Setup mock cached data
      const cachedEmails = [
        { id: "email1", category: PriorityCategory.HIGH },
        { id: "email2", category: PriorityCategory.MEDIUM },
      ];

      mockCacheManager.get = jest.fn().mockReturnValue({
        emails: cachedEmails,
        total: 2,
        timestamp: Date.now(), // Fresh timestamp
      });
      // Call listEmails
      const result = await emailFetcher.listEmails({
        limit: 10,
        offset: 0,
      }, 'test-user-123');

      // Verify results
      expect(result.emails).toEqual(cachedEmails);
      expect(result.total).toBe(2);

      // Verify cache was checked but database was not queried
      expect(mockCacheManager.get).toHaveBeenCalled();
      expect(mockDbManager.searchEmails).not.toHaveBeenCalled();
    });

    it("should query database when cache is not available", async () => {
      // Setup mock database results
      const dbEmails: EmailIndex[] = [
        { id: "email1", category: PriorityCategory.HIGH, subject: "Test Subject 1", sender: "sender@example.com", recipients: ["recipient@example.com"], date: new Date(), year: 2024, size: 1024, hasAttachments: false, labels: [], snippet: "Test snippet 1", archived: false },
        { id: "email2", category: PriorityCategory.MEDIUM, subject: "Test Subject 2", sender: "sender@example.com", recipients: ["recipient@example.com"], date: new Date(), year: 2024, size: 2048, hasAttachments: false, labels: [], snippet: "Test snippet 2", archived: false }
      ];
      mockCacheManager.get.mockReturnValue(null);
      mockDbManager.searchEmails.mockResolvedValue(dbEmails);
      mockDbManager.getEmailCount.mockResolvedValue(2);

      // Call listEmails
      const result = await emailFetcher.listEmails({
        category: PriorityCategory.HIGH,
        limit: 10,
        offset: 0,
      }, 'test-user-123');

      // Verify results
      expect(result.emails).toEqual(dbEmails);
      expect(result.total).toBe(2);

      // Verify database was queried with correct parameters
      expect(mockDbManager.searchEmails).toHaveBeenCalledWith(
        expect.objectContaining({
          category: PriorityCategory.HIGH,
          limit: 10,
          offset: 0,
        })
      );

      // Verify results were cached
      expect(mockCacheManager.set).toHaveBeenCalled();
    });

    it("should synchronize with Gmail API when needed", async () => {
      // Setup conditions for sync
      mockCacheManager.get.mockReturnValueOnce(null).mockReturnValueOnce(0);
      mockDbManager.searchEmails.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: "email1", category: PriorityCategory.HIGH },
      ]);
      mockDbManager.getEmailCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      // Setup Gmail API mock responses
      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: "email1", threadId: "thread1" }],
        },
      });

      mockGmailClient.users.messages.get.mockResolvedValue({
        data: {
          id: "email1",
          threadId: "thread1",
          labelIds: ["INBOX"],
          snippet: "Test email",
          sizeEstimate: 1024,
          internalDate: Date.now().toString(),
          payload: {
            headers: [
              { name: "Subject", value: "Test Subject" },
              { name: "From", value: "sender@example.com" },
              { name: "To", value: "recipient@example.com" },
              { name: "Date", value: new Date().toISOString() },
            ],
          },
        },
      });

      // Call listEmails
      const result = await emailFetcher.listEmails({
        limit: 10,
        offset: 0,
      }, 'test-user-123');

      // Verify results
      expect(result.emails).toHaveLength(1);
      expect(result.total).toBe(1);

      // Verify Gmail API was called
      expect(mockAuthManager.getGmailClient).toHaveBeenCalled();
      expect(mockGmailClient.users.messages.list).toHaveBeenCalled();
      expect(mockGmailClient.users.messages.get).toHaveBeenCalled();

      // Verify database was updated
      expect(mockDbManager.upsertEmailIndex).toHaveBeenCalled();

      // Verify last sync time was updated
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        "last_gmail_sync",
        expect.any(Number)
      );
      // Optionally, check that the cache for emails was set
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.stringContaining("list_emails_"),
        expect.objectContaining({
          emails: expect.any(Array),
          timestamp: expect.any(Number),
          total: expect.any(Number),
        }),
        'test-user-123'
      );
    });

    it("should handle database errors gracefully", async () => {
      mockDbManager.searchEmails.mockRejectedValue(new Error("Database error"));

      // Expect the error to be propagated
      await expect(
        emailFetcher.listEmails({
          limit: 10,
          offset: 0,
        }, 'test-user-123')
      ).rejects.toThrow("Database error");
    });

    it("should handle Gmail API errors during synchronization", async () => {
      mockCacheManager.get.mockReturnValueOnce(null).mockReturnValueOnce(0);
      mockDbManager.searchEmails.mockResolvedValue([]);
      mockDbManager.getEmailCount.mockResolvedValue(0);

      // Setup Gmail API to throw error
      mockGmailClient.users.messages.list.mockRejectedValue(
        new Error("API error")
      );

      // Expect the error to be propagated
      await expect(
        emailFetcher.listEmails({
          limit: 10,
          offset: 0,
        }, 'test-user-123')
      ).rejects.toThrow("API error");
    });

    it("should handle malformed Gmail API responses", async () => {
      mockCacheManager.get.mockReturnValueOnce(null).mockReturnValueOnce(0);
      mockDbManager.searchEmails.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      mockDbManager.getEmailCount.mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      // Setup Gmail API with malformed response
      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {}, // No messages array
      });

      // Call listEmails - should not throw but return empty results
      const result = await emailFetcher.listEmails({
        limit: 10,
        offset: 0,
      }, 'test-user-123');

      // Verify results are empty but valid
      expect(result.emails).toEqual([]);
      expect(result.total).toBe(0);
    });

    it("should handle malformed message data during synchronization", async () => {
      mockCacheManager.get.mockReturnValueOnce(null).mockReturnValueOnce(0);
      mockDbManager.searchEmails.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: "email1", category: PriorityCategory.HIGH },
      ]);
      mockDbManager.getEmailCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      // Setup Gmail API with valid list but malformed message
      mockGmailClient.users.messages.list.mockResolvedValue({
        data: {
          messages: [{ id: "email1" }, { id: "email2" }],
        },
      });

      // First message is malformed
      mockGmailClient.users.messages.get
        .mockResolvedValueOnce({
          data: {
            id: "email1",
            // Missing payload
          },
        })
        // Second message is valid
        .mockResolvedValueOnce({
          data: {
            id: "email2",
            threadId: "thread2",
            labelIds: ["INBOX"],
            snippet: "Test email 2",
            sizeEstimate: 1024,
            internalDate: Date.now().toString(),
            payload: {
              headers: [
                { name: "Subject", value: "Test Subject 2" },
                { name: "From", value: "sender2@example.com" },
                { name: "To", value: "recipient@example.com" },
                { name: "Date", value: new Date().toISOString() },
              ],
            },
          },
        });

      // Call listEmails - should handle the malformed message and continue
      const result = await emailFetcher.listEmails({
        limit: 10,
        offset: 0,
      }, 'test-user-123');

      // Verify results
      expect(result.emails).toHaveLength(1);
      expect(result.total).toBe(1);

      // Verify both messages were attempted
      expect(mockGmailClient.users.messages.get).toHaveBeenCalledTimes(2);

      // Verify only one message was saved to database
      expect(mockDbManager.upsertEmailIndex).toHaveBeenCalledTimes(1);
    });

    it("should apply all filter options correctly", async () => {
      mockCacheManager.get.mockReturnValue(null);
      mockDbManager.searchEmails.mockResolvedValue([]);
      mockDbManager.getEmailCount.mockResolvedValue(0);

      // Call listEmails with all filter options
      await emailFetcher.listEmails({
        category: PriorityCategory.HIGH,
        year: 2023,
        sizeRange: { min: 1000, max: 5000 },
        archived: false,
        hasAttachments: true,
        labels: ["IMPORTANT", "WORK"],
        query: "subject:test",
        limit: 20,
        offset: 10,
      }, 'test-user-123');

      // Verify database was queried with all filters
      expect(mockDbManager.searchEmails).toHaveBeenCalledWith(
        expect.objectContaining({
          category: PriorityCategory.HIGH,
          year: 2023,
          sizeRange: { min: 1000, max: 5000 },
          archived: false,
          hasAttachments: true,
          labels: ["IMPORTANT", "WORK"],
          limit: 20,
          offset: 10,
        })
      );

      // Verify Gmail query was built correctly
      expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: expect.stringContaining("subject:test"),
        })
      );
    });

    it("should force synchronization for specific filter combinations", async () => {
      mockCacheManager.get.mockReturnValue(null);
      const dbEmails = [{ id: "email1", category: PriorityCategory.HIGH }];
      mockDbManager.searchEmails.mockResolvedValue(dbEmails);
      mockDbManager.getEmailCount.mockResolvedValue(1);

      // Setup Gmail API
      mockGmailClient.users.messages.list.mockResolvedValue({
        data: { messages: [] },
      });

      // Call listEmails with query parameter (should force sync)
      await emailFetcher.listEmails({
        query: "important",
        limit: 10,
        offset: 0,
      }, 'test-user-123');

      // Verify Gmail API was called despite having database results
      expect(mockGmailClient.users.messages.list).toHaveBeenCalled();
    });

    it("should handle stale cache correctly", async () => {
      const cachedEmails = [{ id: "email1", category: PriorityCategory.HIGH }];
      mockCacheManager.get.mockReturnValue({
        emails: cachedEmails,
        total: 1,
        timestamp: Date.now() - 3600000 * 2, // 2 hours old (stale)
      });
      const dbEmails = [
        { id: "email1", category: PriorityCategory.HIGH },
        { id: "email2", category: PriorityCategory.MEDIUM },
      ];
      mockDbManager.searchEmails.mockResolvedValue(dbEmails);
      mockDbManager.getEmailCount.mockResolvedValue(2);

      // Call listEmails
      const result = await emailFetcher.listEmails({
        limit: 10,
        offset: 0,
      }, 'test-user-123');

      // Verify fresh results from database were returned, not stale cache
      expect(result.emails).toEqual(dbEmails);
      expect(result.total).toBe(2);

      // Verify cache was updated
      expect(mockCacheManager.set).toHaveBeenCalled();
    });
  });

  describe("convertToEmailIndex", () => {
    it("should handle missing fields gracefully", async () => {
      // Setup minimal valid message
      const minimalMessage = {
        id: "email1",
        payload: {
          headers: [],
        },
      };

      // Access private method using any type
      const convertMethod = (emailFetcher as any).convertToEmailIndex.bind(
        emailFetcher
      );

      // Convert the minimal message
      const result = convertMethod(minimalMessage);

      // Verify defaults were applied
      expect(result.id).toBe("email1");
      expect(result.threadId).toBe("email1"); // Falls back to id
      expect(result.subject).toBe("");
      expect(result.sender).toBe("");
      expect(result.recipients).toEqual([]);
      expect(result.size).toBe(0);
      expect(result.hasAttachments).toBe(false);
      expect(result.labels).toEqual([]);
      expect(result.snippet).toBe("");
    });

    it("should throw error for completely invalid message", async () => {
      // Setup invalid message
      const invalidMessage = {};

      // Access private method using any type
      const convertMethod = (emailFetcher as any).convertToEmailIndex.bind(
        emailFetcher
      );

      // Expect error when converting
      expect(() => convertMethod(invalidMessage)).toThrow();
    });
  });

  describe("checkForAttachments", () => {
    it("should detect direct attachments", async () => {
      // Setup payload with direct attachment
      const payload = {
        filename: "document.pdf",
        mimeType: "application/pdf",
      };

      // Access private method using any type
      const checkMethod = (emailFetcher as any).checkForAttachments.bind(
        emailFetcher
      );

      // Check for attachments
      const result = checkMethod(payload);

      // Verify attachment was detected
      expect(result).toBe(true);
    });

    it("should detect nested attachments", async () => {
      // Setup payload with nested attachment
      const payload = {
        parts: [
          { filename: "", mimeType: "text/plain" },
          {
            mimeType: "multipart/mixed",
            parts: [{ filename: "document.pdf", mimeType: "application/pdf" }],
          },
        ],
      };

      // Access private method using any type
      const checkMethod = (emailFetcher as any).checkForAttachments.bind(
        emailFetcher
      );

      // Check for attachments
      const result = checkMethod(payload);

      // Verify attachment was detected
      expect(result).toBe(true);
    });

    it("should handle null or invalid payload", async () => {
      // Access private method using any type
      const checkMethod = (emailFetcher as any).checkForAttachments.bind(
        emailFetcher
      );

      // Check various invalid payloads
      expect(() => checkMethod(null)).not.toThrow();
      expect(checkMethod(null)).toBe(false);
      expect(() => checkMethod({})).not.toThrow();
      expect(checkMethod({})).toBe(false);
      expect(() => checkMethod({ parts: null })).not.toThrow();
      expect(checkMethod({ parts: null })).toBe(false);
      expect(() => checkMethod({ parts: "not an array" })).not.toThrow();
      expect(checkMethod({ parts: "not an array" })).toBe(false);
    });
  });
});
