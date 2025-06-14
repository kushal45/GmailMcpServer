import { jest } from '@jest/globals';
import { EmailIndex, DeleteOptions } from '../../../../src/types/index.js';
import { AuthManager } from '../../../../src/auth/AuthManager.js';
import { DatabaseManager } from '../../../../src/database/DatabaseManager.js';
import { DeleteManager } from '../../../../src/delete/DeleteManager.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../../../../build/utils/logger.js';
import { Logger } from 'winston';

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

export type MockDatabaseManager = {
  searchEmails: jest.Mock<any>;
  getEmailById: jest.Mock<any>;
  saveEmail: jest.Mock<any>;
  updateEmail: jest.Mock<any>;
  deleteEmail: jest.Mock<any>;
  getEmailCount: jest.Mock<any>;
  getEmailStatistics: jest.Mock<any>;
  close: jest.Mock<any>;
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

// Test database path
let testDbPath: string;
let testDbDir: string;

// Create real DatabaseManager for testing
export async function createTestDatabaseManager(): Promise<DatabaseManager> {
  // Create a unique test database in temp directory
  testDbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gmail-test-'));
  testDbPath = path.join(testDbDir, 'test-emails.db');
  
  // Set the storage path environment variable to our test directory
  process.env.STORAGE_PATH = testDbDir;
  
  const dbManager = DatabaseManager.getInstance();
  await dbManager.initialize();
  
  return dbManager;
}

// Cleanup test database
export async function cleanupTestDatabase(dbManager: DatabaseManager): Promise<void> {
  if (dbManager) {
    await dbManager.close();
  }
  
  // Remove test database directory
  if (testDbDir) {
    try {
      await fs.rm(testDbDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup test database:', error);
    }
  }
}

// Seed test data into database
export async function seedTestData(dbManager: DatabaseManager, emails: EmailIndex[]): Promise<void> {
  // Use bulk insert for efficiency
  if (emails.length > 0) {
    await dbManager.bulkUpsertEmailIndex(emails);
  }
}

// Verify database state
export async function verifyDatabaseState(
  dbManager: DatabaseManager,
  expectedEmails: EmailIndex[]
): Promise<void> {
  const allEmails = await dbManager.searchEmails({});
  
  // Create a map for easy lookup
  const emailMap = new Map(allEmails.map(e => [e.id, e]));
  
  expectedEmails.forEach(expected => {
    const actual = emailMap.get(expected.id);
    expect(actual).toBeDefined();
    if (actual) {
      expect(actual.archived).toBe(expected.archived);
      expect(actual.category).toBe(expected.category);
    }
  });
}

// Get emails from database by IDs
export async function getEmailsFromDatabase(
  dbManager: DatabaseManager,
  emailIds: string[]
): Promise<EmailIndex[]> {
  const emails: EmailIndex[] = [];
  for (const id of emailIds) {
    const email = await dbManager.getEmailIndex(id);
    if (email) {
      emails.push(email);
    }
  }
  return emails;
}

// Create mock DatabaseManager (kept for compatibility but deprecated)
export function createMockDatabaseManager(): MockDatabaseManager {
  const mockDbManager: MockDatabaseManager = {
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

// Create DeleteManager with real database
export async function createDeleteManagerWithRealDb(
  authManager?: any
): Promise<{
  deleteManager: DeleteManager;
  mockGmailClient: MockGmailClient;
  mockAuthManager: any;
  dbManager: DatabaseManager;
}> {
  const mockGmailClient = createMockGmailClient();
  const mockAuthManager = authManager || createMockAuthManager(mockGmailClient);
  const dbManager = await createTestDatabaseManager();

  const deleteManager = new DeleteManager(
    mockAuthManager as unknown as AuthManager,
    dbManager
  );

  return {
    deleteManager,
    mockGmailClient,
    mockAuthManager,
    dbManager
  };
}

// Create DeleteManager with mocks (kept for backward compatibility)
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

// Helper to setup database search results (kept for mock compatibility)
export function setupDatabaseSearchResults(mockDbManager: any, emails: EmailIndex[]) {
  mockDbManager.searchEmails.mockResolvedValue(emails);
}

// Helper to setup database search failure (kept for mock compatibility)
export function setupDatabaseSearchFailure(mockDbManager: any, error: Error) {
  mockDbManager.searchEmails.mockRejectedValue(error);
}

// Helper to verify database search calls (kept for mock compatibility)
export function verifyDatabaseSearchCalls(
  mockDbManager: any,
  expectedCriteria: any[]
) {
  expect(mockDbManager.searchEmails).toHaveBeenCalledTimes(expectedCriteria.length);
  
  expectedCriteria.forEach((criteria, index) => {
    expect(mockDbManager.searchEmails).toHaveBeenNthCalledWith(index + 1, criteria);
  });
}

// Helper to verify real database search results
export async function verifyRealDatabaseSearch(
  dbManager: DatabaseManager,
  criteria: any,
  expectedCount: number
): Promise<EmailIndex[]> {
  const results = await dbManager.searchEmails(criteria);
  expect(results.length).toBe(expectedCount);
  return results;
}

// Helper to mark emails as deleted in real database
export async function markEmailsAsDeleted(
  dbManager: DatabaseManager,
  emailIds: string[]
): Promise<void> {
  for (const id of emailIds) {
    const email = await dbManager.getEmailIndex(id);
    if (email) {
      email.archived = true;
      email.archiveDate = new Date();
      email.archiveLocation = 'trash';
      await dbManager.upsertEmailIndex(email);
    }
  }
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



interface CapturedConsoleOutput {
  logs: string[];
  errors: string[];
  warns: string[];
  infos: string[];
}

const capturedOutput: CapturedConsoleOutput = {
  logs: [],
  errors: [],
  warns: [],
  infos: []
};
// Stores the captured output across tests
// This should be cleared and reset for each test
type LoggerMethodName = 'log' | 'warn' | 'error' | 'info'; // Assuming these are the methods you use
const loggerSpies: { [key in LoggerMethodName]?: any } = {}; // Changed to loggerSpies

/**
 * Starts capturing Winston logger outputs (log, error, warn, info) using Jest spies.
 * Clears any previously captured logs.
 *
 * @param loggerInstance The Winston logger instance to spy on.
 * @returns An object containing arrays for logs, errors, warns, and infos.
 */
export function startLoggerCapture(loggerInstance: Logger): CapturedConsoleOutput {
   // Clear previous captures before starting
  capturedOutput.logs = [];
  capturedOutput.errors = [];
  capturedOutput.warns = [];
  capturedOutput.infos = [];

 const formatArgs = (...args: any[]): string => {
    return args.map(arg => {
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
  };

  loggerSpies.log = jest.spyOn(loggerInstance, 'log').mockImplementation((...args: any[]) => {
    capturedOutput.logs.push(formatArgs(...args));
    return loggerInstance; // <-- ADD THIS LINE
  });
  loggerSpies.error = jest.spyOn(loggerInstance, 'error').mockImplementation((...args: any[]) => {
    capturedOutput.errors.push(formatArgs(...args));
    return loggerInstance; // <-- ADD THIS LINE
  });
  loggerSpies.warn = jest.spyOn(loggerInstance, 'warn').mockImplementation((...args: any[]) => {
    capturedOutput.warns.push(formatArgs(...args));
    return loggerInstance; // <-- ADD THIS LINE
  });
  loggerSpies.info = jest.spyOn(loggerInstance, 'info').mockImplementation((...args: any[]) => {
    capturedOutput.infos.push(formatArgs(...args));
    return loggerInstance; // <-- ADD THIS LINE
  });

  return capturedOutput;
}

/**
 * Restores all spied logger methods to their original implementations.
 * This should typically be called in Jest's `afterEach` hook.
 */
export function stopLoggerCapture() {
  for (const method of Object.keys(loggerSpies) as LoggerMethodName[]) {
    loggerSpies[method]?.mockRestore();
    delete loggerSpies[method]; // Clean up the spy reference
  }
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
  mockDbManager?: MockDatabaseManager
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
  
  // Reset Database manager mocks if provided (for mock tests)
  if (mockDbManager) {
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
}

// Helper to reset test database
export async function resetTestDatabase(dbManager: DatabaseManager, emails: EmailIndex[]): Promise<void> {
  // Clear all existing data by closing and reinitializing
  await dbManager.close();
  await dbManager.initialize();
  
  // Re-seed with fresh data
  if (emails.length > 0) {
    await seedTestData(dbManager, emails);
  }
}