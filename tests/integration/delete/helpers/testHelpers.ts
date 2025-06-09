import { jest } from '@jest/globals';
import { gmail_v1 } from 'googleapis';
import { EmailIndex, DeleteOptions } from '../../../../src/types/index.js';
import { AuthManager } from '../../../../src/auth/AuthManager.js';
import { DatabaseManager } from '../../../../src/database/DatabaseManager.js';
import { DeleteManager } from '../../../../src/delete/DeleteManager.js';

// Mock Gmail client type
export type MockGmailClient = {
  users: {
    messages: {
      batchModify: jest.Mock<any>;
      list: jest.Mock<any>;
      delete: jest.Mock<any>;
    };
  };
};

// Create mock Gmail client
export function createMockGmailClient(): MockGmailClient {
  return {
    users: {
      messages: {
        batchModify: jest.fn(),
        list: jest.fn(),
        delete: jest.fn()
      }
    }
  };
}

// Create mock AuthManager
export function createMockAuthManager(gmailClient: MockGmailClient): any {
  const mockAuthManager = {
    getGmailClient: jest.fn(() => Promise.resolve(gmailClient)),
    isAuthenticated: jest.fn(() => Promise.resolve(true)),
    authenticate: jest.fn(() => Promise.resolve(undefined)),
    getStoredCredentials: jest.fn(() => Promise.resolve({})),
    storeCredentials: jest.fn(() => Promise.resolve(undefined)),
    revokeCredentials: jest.fn(() => Promise.resolve(undefined))
  };

  return mockAuthManager;
}

// Create mock DatabaseManager
export function createMockDatabaseManager(): any {
  const mockDbManager = {
    searchEmails: jest.fn(),
    getEmailById: jest.fn(),
    saveEmail: jest.fn(),
    updateEmail: jest.fn(),
    deleteEmail: jest.fn(),
    getEmailCount: jest.fn(),
    getEmailStatistics: jest.fn(),
    close: jest.fn()
  };

  return mockDbManager;
}

// Create DeleteManager with mocks
export function createDeleteManager(
  authManager?: any,
  databaseManager?: any
): {
  deleteManager: DeleteManager;
  mockGmailClient: MockGmailClient;
  mockAuthManager: any;
  mockDbManager: any;
} {
  const mockGmailClient = createMockGmailClient();
  const mockAuthManager = authManager || createMockAuthManager(mockGmailClient);
  const mockDbManager = databaseManager || createMockDatabaseManager();

  const deleteManager = new DeleteManager(
    mockAuthManager as unknown as AuthManager,
    mockDbManager as unknown as DatabaseManager
  );

  return {
    deleteManager,
    mockGmailClient,
    mockAuthManager,
    mockDbManager
  };
}

// Helper to setup successful batch modify response
export function setupSuccessfulBatchModify(mockGmailClient: MockGmailClient, emailIds?: string[]) {
  mockGmailClient.users.messages.batchModify.mockResolvedValue({
    data: {},
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {}
  });
}

// Helper to setup batch modify failure
export function setupBatchModifyFailure(mockGmailClient: MockGmailClient, error: Error) {
  mockGmailClient.users.messages.batchModify.mockRejectedValue(error);
}

// Helper to setup partial batch failure (succeeds once, then fails)
export function setupPartialBatchFailure(mockGmailClient: MockGmailClient, error: Error) {
  mockGmailClient.users.messages.batchModify
    .mockResolvedValueOnce({
      data: {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config: {}
    })
    .mockRejectedValueOnce(error);
}

// Helper to setup list messages response
export function setupListMessagesResponse(mockGmailClient: MockGmailClient, messages: Array<{ id: string; threadId: string }>) {
  mockGmailClient.users.messages.list.mockResolvedValue({
    data: {
      messages: messages.map(m => ({ id: m.id, threadId: m.threadId })),
      resultSizeEstimate: messages.length
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: {}
  });
}

// Helper to setup delete message responses
export function setupDeleteMessageResponses(mockGmailClient: MockGmailClient, successCount: number, failureCount: number = 0) {
  const responses: any[] = [];
  
  // Add successful responses
  for (let i = 0; i < successCount; i++) {
    responses.push({
      data: {},
      status: 204,
      statusText: 'No Content',
      headers: {},
      config: {}
    });
  }
  
  // Add failure responses
  for (let i = 0; i < failureCount; i++) {
    responses.push(new Error(`Failed to delete message ${i + successCount + 1}`));
  }
  
  // Setup mock to return responses in sequence
  responses.forEach((response, index) => {
    if (response instanceof Error) {
      mockGmailClient.users.messages.delete.mockRejectedValueOnce(response);
    } else {
      mockGmailClient.users.messages.delete.mockResolvedValueOnce(response);
    }
  });
}

// Helper to verify batch modify calls
export function verifyBatchModifyCalls(
  mockGmailClient: MockGmailClient,
  expectedCalls: Array<{
    ids: string[];
    addLabelIds?: string[];
    removeLabelIds?: string[];
  }>
) {
  expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(expectedCalls.length);
  
  expectedCalls.forEach((expectedCall, index) => {
    expect(mockGmailClient.users.messages.batchModify).toHaveBeenNthCalledWith(index + 1, {
      userId: 'me',
      requestBody: {
        ids: expectedCall.ids,
        addLabelIds: expectedCall.addLabelIds || ['TRASH'],
        removeLabelIds: expectedCall.removeLabelIds || ['INBOX', 'UNREAD']
      }
    });
  });
}

// Helper to create delete options
export function createDeleteOptions(overrides?: Partial<DeleteOptions>): DeleteOptions {
  return {
    skipArchived: false,
    dryRun: false,
    ...overrides
  };
}

// Helper to setup database search results
export function setupDatabaseSearchResults(mockDbManager: any, emails: EmailIndex[]) {
  mockDbManager.searchEmails.mockResolvedValue(emails);
}

// Helper to setup database search failure
export function setupDatabaseSearchFailure(mockDbManager: any, error: Error) {
  mockDbManager.searchEmails.mockRejectedValue(error);
}

// Helper to verify database search calls
export function verifyDatabaseSearchCalls(
  mockDbManager: any,
  expectedCriteria: any[]
) {
  expect(mockDbManager.searchEmails).toHaveBeenCalledTimes(expectedCriteria.length);
  
  expectedCriteria.forEach((criteria, index) => {
    expect(mockDbManager.searchEmails).toHaveBeenNthCalledWith(index + 1, criteria);
  });
}

// Helper to create various error scenarios
export const testErrors = {
  authenticationError: new Error('Authentication failed'),
  networkError: new Error('Network timeout'),
  rateLimitError: Object.assign(new Error('Rate limit exceeded'), { code: 429 }),
  permissionError: Object.assign(new Error('Insufficient permissions'), { code: 403 }),
  notFoundError: Object.assign(new Error('Email not found'), { code: 404 }),
  databaseError: new Error('Database connection failed'),
  invalidParameterError: new Error('Invalid parameter provided')
};

// Helper to wait for async operations
export function waitForAsync(ms: number = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to capture console logs
export function captureConsoleLogs(): {
  logs: string[];
  errors: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  
  const originalLog = console.log;
  const originalError = console.error;
  
  console.log = (...args: any[]) => {
    logs.push(args.join(' '));
  };
  
  console.error = (...args: any[]) => {
    errors.push(args.join(' '));
  };
  
  return {
    logs,
    errors,
    restore: () => {
      console.log = originalLog;
      console.error = originalError;
    }
  };
}

// Helper to create a delay promise
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to verify no unexpected calls
export function verifyNoUnexpectedCalls(
  mockGmailClient: MockGmailClient,
  mockDbManager: any
) {
  // Get all mock functions
  const gmailMocks = [
    mockGmailClient.users.messages.batchModify,
    mockGmailClient.users.messages.list,
    mockGmailClient.users.messages.delete
  ];
  
  const dbMocks = [
    mockDbManager.searchEmails
  ];
  
  // Check each mock for unexpected calls
  [...gmailMocks, ...dbMocks].forEach(mock => {
    const calls = mock.mock.calls;
    if (calls.length > 0) {
      console.warn(`Unexpected calls to ${mock.getMockName() || 'mock'}:`, calls);
    }
  });
}

// Helper to reset all mocks
export function resetAllMocks(
  mockGmailClient: MockGmailClient,
  mockAuthManager: any,
  mockDbManager: any
) {
  // Reset Gmail client mocks
  mockGmailClient.users.messages.batchModify.mockReset();
  mockGmailClient.users.messages.list.mockReset();
  mockGmailClient.users.messages.delete.mockReset();
  
  // Reset Auth manager mocks
  mockAuthManager.getGmailClient.mockReset();
  if (mockAuthManager.isAuthenticated) {
    mockAuthManager.isAuthenticated.mockReset();
  }
  
  // Reset Database manager mocks
  mockDbManager.searchEmails.mockReset();
  if (mockDbManager.getEmailById) {
    mockDbManager.getEmailById.mockReset();
  }
  if (mockDbManager.saveEmail) {
    mockDbManager.saveEmail.mockReset();
  }
  if (mockDbManager.updateEmail) {
    mockDbManager.updateEmail.mockReset();
  }
  if (mockDbManager.deleteEmail) {
    mockDbManager.deleteEmail.mockReset();
  }
  if (mockDbManager.getEmailCount) {
    mockDbManager.getEmailCount.mockReset();
  }
  if (mockDbManager.getEmailStatistics) {
    mockDbManager.getEmailStatistics.mockReset();
  }
}