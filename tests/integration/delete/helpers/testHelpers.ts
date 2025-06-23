import { SpamScore } from './../../../../src/categorization/interfaces/ILabelClassifier';
import { jest } from '@jest/globals';
import { EmailIndex, DeleteOptions } from '../../../../src/types/index.js';
import { AuthManager } from '../../../../src/auth/AuthManager.js';
import { DatabaseManager } from '../../../../src/database/DatabaseManager.js';
import { DeleteManager } from '../../../../src/delete/DeleteManager.js';
import fs from 'fs/promises';
import path from 'path';

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
  console.log('🔍 DIAGNOSTIC: Creating enhanced mock auth manager');
  let isTokenExpired = false;

  const mockAuthManager = {
    getGmailClient: jest.fn(async (sessionId?: string) => {
      if (isTokenExpired) {
        throw new Error('Token expired');
      }
      return Promise.resolve(gmailClient);
    }),
    isAuthenticated: jest.fn(() => Promise.resolve(true)),
    hasValidAuth: jest.fn(async (sessionId: string) => {
      return !isTokenExpired;
    }),
    refreshToken: jest.fn(async (sessionId: string) => {
      isTokenExpired = false;
      return { access_token: 'refreshed-token' };
    }),
    authenticate: jest.fn(() => Promise.resolve(undefined)),
    getStoredCredentials: jest.fn(() => Promise.resolve({})),
    storeCredentials: jest.fn(() => Promise.resolve(undefined)),
    revokeCredentials: jest.fn(() => Promise.resolve(undefined)),
    // Test helper to simulate token expiration
    _setTokenExpired: (expired: boolean) => {
      isTokenExpired = expired;
    },
  };

  console.log('🔍 DIAGNOSTIC: Enhanced mock auth manager created with methods:', Object.keys(mockAuthManager));
  return mockAuthManager;
}

// Create real DatabaseManager for testing
export async function createTestDatabaseManager(): Promise<{ dbManager: DatabaseManager, testDbDir: string }> {
  const dataPath = `../data/${randomUUID()}-gmail-test`;
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const testDbDir = path.resolve(__dirname, dataPath);
  process.env.STORAGE_PATH = testDbDir;
  (DatabaseManager as any).instance = null;
  const dbManager = DatabaseManager.getInstance();
  await dbManager.initialize();
  return { dbManager, testDbDir };
}

export function fetchCleanupEngine(newDbManager: DatabaseManager,moockAuthManager:any, jobQueue:JobQueue): {
  accessTracker: AccessPatternTracker;
  stalenessScorer: StalenessScorer;
  policyEngine: CleanupPolicyEngine;
  healthMonitor: SystemHealthMonitor;
  deleteManager: DeleteManager;
  cleanupEngine: CleanupAutomationEngine;
} {
  const accessTracker = new AccessPatternTracker(newDbManager);
  const stalenessScorer = new StalenessScorer(accessTracker);
  stalenessScorer.customMeta="kushal";
  
  // VERY permissive safety config for testing - allow deletions
  const testSafetyConfig = {
    // Use test-specific domains that won't match real test emails
    vipDomains: ['test-vip-never-match.com'],
    trustedDomains: ['test-trusted-never-match.com'],
    whitelistDomains: ['test-whitelist-never-match.com'],
    
    // DISABLE attachment protection - use non-matching types
    criticalAttachmentTypes: ['.test-critical-never-match'],
    legalDocumentTypes: ['.test-legal-never-match'],
    financialDocumentTypes: ['.test-financial-never-match'],
    contractDocumentTypes: ['.test-contract-never-match'],
    
    // Disable thread/conversation protection
    activeThreadDays: 0,
    minThreadMessages: 1000, // Very high threshold
    recentReplyDays: 0,
    
    // Disable sender reputation protection
    frequentContactThreshold: 1000,
    importantSenderScore: 0.999, // Nearly impossible to trigger
    minInteractionHistory: 1000,
    
    // Use keywords that won't match test emails
    legalKeywords: ['test-legal-keyword-never-match'],
    complianceTerms: ['test-compliance-term-never-match'],
    regulatoryKeywords: ['test-regulatory-keyword-never-match'],
    
    // Disable unread protection
    unreadRecentDays: 0,
    unreadImportanceBoost: 0.0,
    
    // Use labels that won't match test emails
    protectedLabels: ['TEST_IMPORTANT_NEVER_MATCH'],
    criticalLabels: ['TEST_CRITICAL_NEVER_MATCH'],
    
    // Very high batch limits
    maxDeletionsPerHour: 100000,
    maxDeletionsPerDay: 1000000,
    bulkOperationThreshold: 10000,
    
    // Very high size thresholds
    largeEmailThreshold: 1000 * 1024 * 1024, // 1GB
    unusualSizeMultiplier: 100.0,
    
    // Disable recent activity protection
    recentAccessDays: 0,
    recentForwardDays: 0,
    recentModificationDays: 0,
    
    // Very permissive thresholds
    minStalenessScore: 0.0, // Accept any staleness
    maxAccessScore: 1.0, // Accept any access score
    importanceScoreThreshold: 100.0, // Nearly impossible to trigger
    
    enableSafetyMetrics: true,
    enableDetailedLogging: false // Clean test output
  };
  
  const policyEngine = new CleanupPolicyEngine(newDbManager, stalenessScorer, accessTracker, testSafetyConfig);
  const healthMonitor = new SystemHealthMonitor(newDbManager);
  healthMonitor.metaData="kushal";
  const deleteManager = new DeleteManager(moockAuthManager, newDbManager);
  const cleanupEngine = new CleanupAutomationEngine(
    newDbManager,
    jobQueue,
    deleteManager,
    accessTracker,
    stalenessScorer,
    policyEngine
  );
  cleanupEngine.hMonitor=healthMonitor;

  return{
    accessTracker,
    stalenessScorer,
    policyEngine,
    healthMonitor,
    deleteManager,
    cleanupEngine
  }
}

// Cleanup test database
export async function cleanupTestDatabase(dbManager: DatabaseManager, testDbDir: string): Promise<void> {
  if (dbManager) {
    try {
      const allPolicies = await dbManager.getAllPolicies();
      for (const policy of allPolicies) {
        await dbManager.deleteCleanupPolicy(policy.id);
      }
      console.log('🧹 Cleared cleanup_policies table');
    } catch (error) {
      console.warn('Warning: Failed to clear cleanup policies:', error);
    }
    await dbManager.close();
  }
  (DatabaseManager as any).instance = null;
  if (testDbDir) {
    const resolvedTestDbDir = path.resolve(testDbDir);
    console.log(`Attempting to remove directory: ${resolvedTestDbDir}`);
    try {
      await fs.rm(resolvedTestDbDir, { recursive: true, force: true });
      console.log(`Successfully removed test database directory: ${resolvedTestDbDir}`);
    } catch (error: any) {
      console.error('Failed to cleanup test database directory:', resolvedTestDbDir);
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        code: error.code,
        syscall: error.syscall,
        path: error.path,
        stack: error.stack
      });
      if (error.code === 'ENOENT') {
        console.warn(`Directory ${resolvedTestDbDir} already did not exist. Considering it cleaned.`);
      }
    }
  } else {
    console.warn('testDbDir is not set, skipping directory removal.');
  }
}

export async function resetDatabase(dbManager: DatabaseManager,emails: EmailIndex[]): Promise<DatabaseManager> {
  if (dbManager) {
     await cleanupTestDatabase(dbManager, '');
     const dbMangerObj=await createTestDatabaseManager(); 
    dbManager=dbMangerObj.dbManager;
     await seedTestData(dbManager,emails);
  }
  return dbManager;
}
// Reset singleton instances to ensure test isolation
export function resetSingletonInstances(): void {
  // Reset DatabaseManager singleton
  (DatabaseManager as any).instance = null;
  
  // Reset CleanupPolicyEngine singleton if it exists
  try {
    const { CleanupPolicyEngine } = require('../../../../src/cleanup/CleanupPolicyEngine.js');
    (CleanupPolicyEngine as any).instance = null;
  } catch (error) {
    // Ignore if CleanupPolicyEngine is not available
  }
  
  // Reset AccessPatternTracker singleton if it exists
  try {
    const { AccessPatternTracker } = require('../../../../src/cleanup/AccessPatternTracker.js');
    (AccessPatternTracker as any).instance = null;
  } catch (error) {
    // Ignore if AccessPatternTracker is not available
  }
  
  console.log('🔄 Reset singleton instances for test isolation');
}

// Seed test data into database
export async function seedTestData(dbManager: DatabaseManager, emails: EmailIndex[], userId?: string): Promise<void> {
  console.log('🔍 DIAGNOSTIC: seedTestData called', {
    email_count: emails.length,
    sample_emails: emails.slice(0, 3).map(e => ({
      id: e.id,
      category: e.category,
      date: e.date?.toISOString(),
      spam_score: e.spam_score,
      promotional_score: e.promotional_score,
      archived: e.archived
    }))
  });
  // Set user_id on all emails if provided
  const emailsWithUserId = emails.map(e => ({ ...e, user_id: userId || e.user_id || 'test-user-123' }));
  // Use bulk insert for efficiency
  if (emailsWithUserId.length > 0) {
    await dbManager.bulkUpsertEmailIndex(emailsWithUserId);
    // Verify the emails were actually inserted
    const verifyQuery = await dbManager.searchEmails({});
    console.log('🔍 DIAGNOSTIC: After seeding verification', {
      emails_in_db: verifyQuery.length,
      sample_db_emails: verifyQuery.slice(0, 3).map(e => ({
        id: e.id,
        category: e.category,
        date: e.date?.toISOString(),
        spam_score: e.spam_score,
        promotional_score: e.promotional_score,
        archived: e.archived,
        user_id: e.user_id
      }))
    });
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
  testDbDir: string;
}> {
  const mockGmailClient = createMockGmailClient();
  const mockAuthManager = authManager || createMockAuthManager(mockGmailClient);
  // Ensure we get a fresh database instance for each test
  const { dbManager, testDbDir } = await createTestDatabaseManager();

  const deleteManager = new DeleteManager(
    mockAuthManager as unknown as AuthManager,
    dbManager
  );

  return {
    deleteManager,
    mockGmailClient,
    mockAuthManager,
    dbManager,
    testDbDir
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
  console.log('DIAGNOSTIC: verifyBatchModifyCalls called', {
    expectedCalls: expectedCalls.length,
    mockGmailClient: mockGmailClient.users.messages.batchModify.mock.calls
  });
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
  console.log('🔍 DIAGNOSTIC: Resetting mocks. AuthManager methods before reset:', Object.keys(mockAuthManager));
  
  // Reset Gmail client mocks
  mockGmailClient.users.messages.batchModify.mockReset();
  mockGmailClient.users.messages.list.mockReset();
  mockGmailClient.users.messages.delete.mockReset();
  
  // Reset Auth manager mocks
  mockAuthManager.getGmailClient.mockReset();
  if (mockAuthManager.isAuthenticated) {
    mockAuthManager.isAuthenticated.mockReset();
  }
  
  // Reset enhanced OAuth methods if they exist
  const enhancedOAuthMethods = [
    'getAuthUrl', 'hasValidAuth', 'refreshToken', 'createUserSession',
    'getUserIdForSession', 'getSessionId', 'authenticateUser', 'invalidateSession',
    'getAllUsers', 'getUserById', 'getUserByEmail', 'getClient', 'getClientForSession',
    'isMultiUserMode', 'enableMultiUserMode', 'cleanup'
  ];
  
  enhancedOAuthMethods.forEach(methodName => {
    if (mockAuthManager[methodName] && typeof mockAuthManager[methodName].mockReset === 'function') {
      console.log(`🔍 DIAGNOSTIC: Resetting enhanced OAuth method: ${methodName}`);
      mockAuthManager[methodName].mockReset();
    }
  });
  
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
export async function resetTestDatabase(dbManager: DatabaseManager, emails: EmailIndex[]): Promise<DatabaseManager> {
  // Clear all existing data by closing and reinitializing
  const { dbManager: freshDbManager, testDbDir } = await createTestDatabaseManager();
  await cleanupTestDatabase(dbManager, testDbDir);
  // Re-seed with fresh data
  if (emails.length > 0) {
    await seedTestData(freshDbManager, emails);
  }
  return freshDbManager;
}

// ========================
// Cleanup System Test Helpers
// ========================

// Import cleanup system types
import { CleanupPolicy, StalenessScore, EmailAccessSummary } from '../../../../src/types/index.js';
import { fileURLToPath } from 'url';
import { create } from 'lodash';
import { AccessPatternTracker } from '../../../../src/cleanup/AccessPatternTracker.js';
import { StalenessScorer } from '../../../../src/cleanup/StalenessScorer.js';
import { CleanupPolicyEngine } from '../../../../src/cleanup/CleanupPolicyEngine.js';
import { SystemHealthMonitor } from '../../../../src/cleanup/SystemHealthMonitor.js';
import { CleanupAutomationEngine } from '../../../../src/cleanup/CleanupAutomationEngine.js';
import { JobQueue } from '../../../../src/database/JobQueue.js';
import { gmail } from 'googleapis/build/src/apis/gmail/index.js';
import { randomUUID } from 'crypto';

// Create mock cleanup policy with more realistic defaults
export function createMockCleanupPolicy(overrides?: Partial<CleanupPolicy>): CleanupPolicy {
  const uniqueId = `test-policy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const defaultPolicy = {
    id: uniqueId,
    name: 'Test Cleanup Policy',
    enabled: true,
    priority: 50,
    criteria: {
      age_days_min: 1, // ⭐ FIXED: Very permissive for debugging
      importance_level_max: 'high' as const, // ⭐ FIXED: Allow all importance levels
      size_threshold_min: 0, // ⭐ FIXED: No size restriction
      spam_score_min: 0.1, // ⭐ FIXED: Very low threshold
      promotional_score_min: 0.1, // ⭐ FIXED: Very low threshold
      access_score_max: 1.0, // ⭐ FIXED: No access restrictions
      no_access_days: 1 // ⭐ FIXED: Very permissive
    },
    action: {
      type: 'delete' as const,
      method: 'gmail' as const
    },
    safety: {
      max_emails_per_run: 100,
      require_confirmation: false,
      dry_run_first: false,
      preserve_important: false // ⭐ FIXED: Disable importance protection for debugging
    },
    schedule: {
      frequency: 'weekly' as const,
      time: '02:00',
      enabled: true
    },
    created_at: new Date(),
    updated_at: new Date()
  };

  // ⭐ FIXED: Deep merge criteria to avoid undefined values
  if (overrides) {
    const result = { ...defaultPolicy, ...overrides };
    if (overrides.criteria) {
      result.criteria = overrides.criteria;
    }
    if (overrides.action) {
      result.action = overrides.action;
    }
    if (overrides.safety) {
      result.safety = overrides.safety;
    }
    if (overrides.schedule) {
      result.schedule = overrides.schedule;
    }
    return result;
  }

  return defaultPolicy;
}

// Create mock staleness score
export function createMockStalenessScore(email: EmailIndex, overrides?: Partial<StalenessScore>): StalenessScore {
  return {
    email_id: email.id,
    total_score: 0.7,
    factors: {
      age_score: 0.8,
      importance_score: 0.6,
      size_penalty: 0.4,
      spam_score: 0.5,
      access_score: 0.9
    },
    recommendation: 'delete',
    confidence: 0.8,
    ...overrides
  };
}

// Create mock access summary
export function createMockAccessSummary(email: EmailIndex, overrides?: Partial<EmailAccessSummary>): EmailAccessSummary {
  return {
    email_id: email.id,
    total_accesses: 2,
    last_accessed: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
    search_appearances: 5,
    search_interactions: 1,
    access_score: 0.3,
    updated_at: new Date(),
    ...overrides
  };
}

// Create mock AccessPatternTracker
export function createMockAccessPatternTracker(): any {
  const calculateAccessScore = jest.fn() as any;
  calculateAccessScore.mockResolvedValue(0.5);
  
  const getFrequentlyAccessedEmails = jest.fn() as any;
  getFrequentlyAccessedEmails.mockResolvedValue([]);
  
  const getUnusedEmails = jest.fn() as any;
  getUnusedEmails.mockResolvedValue([]);
  
  return {
    logEmailAccess: jest.fn(),
    logSearchActivity: jest.fn(),
    updateAccessSummary: jest.fn(),
    getAccessSummary: jest.fn(),
    calculateAccessScore,
    getFrequentlyAccessedEmails,
    getUnusedEmails,
    generateAccessAnalytics: jest.fn(),
    cleanupOldAccessLogs: jest.fn(),
    batchUpdateAccessSummaries: jest.fn()
  };
}

// Create mock StalenessScorer
export function createMockStalenessScorer(): any {
  return {
    calculateStaleness: jest.fn(),
    batchCalculateStaleness: jest.fn(),
    getStalenesStatistics: jest.fn(),
    updateWeights: jest.fn(),
    getConfiguration: jest.fn()
  };
}

// Create mock CleanupPolicyEngine
export function createMockCleanupPolicyEngine(): any {
  const getActivePolicies = jest.fn() as any;
  getActivePolicies.mockResolvedValue([]);
  
  const getAllPolicies = jest.fn() as any;
  getAllPolicies.mockResolvedValue([]);
  
  const validatePolicy = jest.fn() as any;
  validatePolicy.mockReturnValue({ valid: true, errors: [] });
  
  return {
    createPolicy: jest.fn(),
    updatePolicy: jest.fn(),
    deletePolicy: jest.fn(),
    getActivePolicies,
    getAllPolicies,
    getPolicy: jest.fn(),
    evaluateEmailsForCleanup: jest.fn(),
    validatePolicy,
    getEmailsForPolicy: jest.fn(),
    generatePolicyRecommendations: jest.fn()
  };
}

// Helper to setup cleanup policy engine with test data
export function setupCleanupPolicyEngine(
  mockPolicyEngine: any,
  policies: CleanupPolicy[] = [],
  evaluationResults?: any
): void {
  mockPolicyEngine.getActivePolicies.mockResolvedValue(policies);
  mockPolicyEngine.getAllPolicies.mockResolvedValue(policies);
  
  if (policies.length > 0) {
    mockPolicyEngine.getPolicy.mockImplementation((id: string) =>
      Promise.resolve(policies.find(p => p.id === id) || null)
    );
  }
  
  if (evaluationResults) {
    mockPolicyEngine.evaluateEmailsForCleanup.mockResolvedValue(evaluationResults);
  }
}

// Helper to setup staleness scorer with test scores
export function setupStalenessScorer(
  mockScorer: any,
  emailScores: Map<string, StalenessScore>
): void {
  mockScorer.calculateStaleness.mockImplementation((email: EmailIndex) => {
    const score = emailScores.get(email.id);
    return Promise.resolve(score || createMockStalenessScore(email));
  });
  
  mockScorer.batchCalculateStaleness.mockImplementation((emails: EmailIndex[]) => {
    return Promise.resolve(emails.map(email =>
      emailScores.get(email.id) || createMockStalenessScore(email)
    ));
  });
}

// Helper to setup access pattern tracker with test data
export function setupAccessPatternTracker(
  mockTracker: any,
  accessSummaries: Map<string, EmailAccessSummary>
): void {
  mockTracker.getAccessSummary.mockImplementation((emailId: string) => {
    return Promise.resolve(accessSummaries.get(emailId) || null);
  });
  
  mockTracker.calculateAccessScore.mockImplementation((emailId: string) => {
    const summary = accessSummaries.get(emailId);
    return Promise.resolve(summary?.access_score || 0.5);
  });
}

// Helper to verify cleanup deletion stats calls
export async function verifyCleanupDeletionStats(
  deleteManager: DeleteManager,
  expectedStats: {
    deletable_by_category: Record<string, number>;
    deletable_by_age: Record<string, number>;
    total_deletable: number;
    total_storage_recoverable: number;
  }
): Promise<void> {
  const stats = await deleteManager.getCleanupDeletionStats();
  
  expect(stats.deletable_by_category).toEqual(expectedStats.deletable_by_category);
  expect(stats.deletable_by_age).toEqual(expectedStats.deletable_by_age);
  expect(stats.total_deletable).toBe(expectedStats.total_deletable);
  expect(stats.total_storage_recoverable).toBe(expectedStats.total_storage_recoverable);
}

// Helper to verify batch delete for cleanup results
export function verifyBatchDeleteForCleanupResults(
  result: any,
  expected: {
    deleted: number;
    archived: number;
    failed: number;
    storage_freed: number;
    errors_count: number;
  }
): void {
  expect(result.deleted).toBe(expected.deleted);
  expect(result.archived).toBe(expected.archived);
  expect(result.failed).toBe(expected.failed);
  expect(result.storage_freed).toBe(expected.storage_freed);
  expect(result.errors).toHaveLength(expected.errors_count);
}

// Helper to create test cleanup policies with different characteristics
export function createTestCleanupPolicies(): CleanupPolicy[] {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substr(2, 6);
  
  return [
    // Aggressive spam cleanup policy
    createMockCleanupPolicy({
      id: `spam-cleanup-${timestamp}-${randomSuffix}`,
      name: 'Spam Email Cleanup',
      priority: 90,
      criteria: {
        age_days_min: 30, // Match test email ages (35+ days for spam emails)
        importance_level_max: 'low',
        spam_score_min: 0.7, // ⭐ FIXED: Match test email spam scores (0.7-0.95)
        promotional_score_min: 0.6 // ⭐ FIXED: Match test email promotional scores
      },
      action: { type: 'delete' },
      safety: {
        max_emails_per_run: 50,
        require_confirmation: false,
        dry_run_first: false,
        preserve_important: true
      }
    }),
    
    // Conservative promotional cleanup policy
    createMockCleanupPolicy({
      id: `promotional-cleanup-${timestamp}-${randomSuffix}`,
      name: 'Promotional Email Cleanup',
      priority: 60,
      criteria: {
        age_days_min: 45, // ⭐ FIXED: Match test email ages (45+ days for promotional)
        importance_level_max: 'medium',
        promotional_score_min: 0.8, // ⭐ FIXED: Match test email promotional scores (0.8-0.9)
        spam_score_min: 0.3 // ⭐ FIXED: Add spam threshold
      },
      action: { type: 'archive' },
      safety: {
        max_emails_per_run: 100,
        require_confirmation: false,
        dry_run_first: false,
        preserve_important: true
      }
    }),
    
    // Large file cleanup policy
    createMockCleanupPolicy({
      id: `large-file-cleanup-${timestamp}-${randomSuffix}`,
      name: 'Large File Cleanup',
      priority: 40,
      criteria: {
        age_days_min: 90, // ⭐ FIXED: Match test email ages (120+ days for large files)
        importance_level_max: 'medium',
        size_threshold_min: 1048576, // ⭐ FIXED: 1MB to match more test emails
        spam_score_min: 0.2, // ⭐ FIXED: Lower threshold for large files
        promotional_score_min: 0.5 // ⭐ FIXED: Lower threshold for large files
      },
      action: { type: 'archive', method: 'export', export_format: 'mbox' },
      safety: {
        max_emails_per_run: 20,
        require_confirmation: false,
        dry_run_first: false,
        preserve_important: true
      }
    })
  ];
}

// Helper to simulate cleanup evaluation results
export function createCleanupEvaluationResults(emails: EmailIndex[]): any {
  const candidates = emails.filter(email =>
    email.category === 'low' ||
    (email.spam_score && email.spam_score > 0.7) ||
    (email.promotional_score && email.promotional_score > 0.6)
  );
  
  const protectedEmails = emails.filter(email =>
    email.category === 'high' ||
    (email.date && (Date.now() - email.date.getTime()) < 7 * 24 * 60 * 60 * 1000)
  );
  
  return {
    cleanup_candidates: candidates.map(email => ({
      email,
      policy: createMockCleanupPolicy(),
      staleness_score: createMockStalenessScore(email),
      recommended_action: email.category === 'low' ? 'delete' : 'archive'
    })),
    protected_emails: protectedEmails.map(email => ({
      email,
      reason: email.category === 'high' ? 'High importance email' : 'Email too recent'
    })),
    evaluation_summary: {
      total_emails: emails.length,
      candidates_count: candidates.length,
      protected_count: protectedEmails.length,
      policies_applied: 1
    }
  };
}

// Helper to wait for batch operations to complete
export async function waitForBatchCompletion(ms: number = 200): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sets up OAuth error conditions for testing
 * @param mockAuthManager The mock auth manager instance
 * @param condition The error condition to simulate
 * @param value Whether to enable or disable the condition
 */
export function setupOAuthErrorCondition(
  mockAuthManager: any,
  condition: 'expired' | 'revoked' | 'networkError' | 'rateLimited' | 'insufficientScopes',
  value: boolean = true
): void {
  if (!mockAuthManager) return;
  
  switch (condition) {
    case 'expired':
      mockAuthManager._setTokenExpired?.(value);
      break;
    case 'revoked':
      mockAuthManager._setRevoked?.(value);
      break;
    case 'networkError':
      mockAuthManager._setNetworkError?.(value);
      break;
    case 'rateLimited':
      mockAuthManager._setRateLimited?.(value);
      break;
    case 'insufficientScopes':
      mockAuthManager._setScopes?.(value ? ['https://www.googleapis.com/auth/gmail.readonly'] : ['https://www.googleapis.com/auth/gmail.modify']);
      break;
  }
}

// Helper to create performance test scenario
export function createPerformanceTestScenario(emailCount: number): EmailIndex[] {
  return Array.from({ length: emailCount }, (_, i) => {
    // Create deterministic dates that pass safety checks:
    // - Older than 7 days (recent email protection)
    // - Older than 90 days (default policy age_days_min)
    // Use 100-200 days old range for safety
    const daysOld = 200; // 100-199 days old, deterministic based on index
    const emailDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const SpamScore =(i % 100) / 200;
    const promotionalScore = (i % 100) / 150;
    const importantScore= (i % 80) / 10;
    return {
      id: `perf-test-${i}`,
      threadId: `thread-perf-${i}`,
      // Only use 'low' and 'medium' categories to avoid high importance filtering
      category: (i % 2 === 0 ? 'low' : 'medium') as any,
      subject: `Performance Test Email ${i}`,
      sender: `sender${i % 10}@performance.test`,
      recipients: ['user@example.com'],
      date: emailDate,
      year: emailDate.getFullYear(),
      // Consistent size range for predictable results
      size: 10000 + (i % 50000), // 10KB to 60KB range
      hasAttachments: i % 4 === 0, // 25% have attachments, deterministic
      labels: ['INBOX'],
      snippet: `Performance test content ${i}`,
      archived: false,
      // Keep scores low to avoid safety filtering
      spam_score: (SpamScore <=0.495)?SpamScore:0.495, // 0-0.495 range (under 0.5)
      promotional_score: promotionalScore <=0.66 ?promotionalScore:0.55, // 0-0.66 range
      importanceScore: importantScore <=7.9? importantScore : 7.8 // 0-7.9 range (under 8.0 threshold)
    };
  });
}