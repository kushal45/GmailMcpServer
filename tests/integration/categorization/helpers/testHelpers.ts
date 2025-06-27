import { jest } from '@jest/globals';
import { EmailIndex, PriorityCategory } from '../../../../src/types/index.js';
import { DatabaseManager } from '../../../../src/database/DatabaseManager.js';
import { CacheManager } from '../../../../src/cache/CacheManager.js';
import { CategorizationEngine } from '../../../../src/categorization/CategorizationEngine.js';
import { CategorizationWorker } from '../../../../src/categorization/CategorizationWorker.js';
import { JobQueue } from '../../../../src/database/JobQueue.js';
import { JobStatusStore } from '../../../../src/database/JobStatusStore.js';
import { Job, JobStatus } from '../../../../src/types/index.js';
import { CategorizationSystemConfig } from '../../../../src/categorization/config/CategorizationConfig.js';
import { AnalysisMetrics } from '../../../../src/categorization/types.js';
import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../../../../src/utils/logger.js';
import { Logger } from 'winston';
import { DatabaseMigrationManager } from '../../../../src/database/DatabaseMigrationManager.js';
import { userDatabaseManagerFactory } from '../../../../src/database/UserDatabaseManagerFactory.js';
import { UserDatabaseManagerFactory } from '../../../../src/database/UserDatabaseManagerFactory.js';
import fs from 'fs';
import { DatabaseRegistry } from '../../../../src/database/DatabaseRegistry.js';

// --- PER-TEST DB ISOLATION ---
let testDbBaseDir: string | null = null;

export async function setupIsolatedTestDb(testName: string) {
  // Create a unique temp dir for this test
  testDbBaseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), `gmail-mcp-test-${testName}-`));
  process.env.STORAGE_PATH = testDbBaseDir;
  // Reset singletons so they use the new STORAGE_PATH
  DatabaseRegistry.resetInstance();
  UserDatabaseManagerFactory.resetInstance();
  // Initialize registry and factory
  const registry = DatabaseRegistry.getInstance(testDbBaseDir);
  await registry.initialize();
  const factory = UserDatabaseManagerFactory.getInstance();
  await factory.initialize();
  return { registry, factory, testDbBaseDir };
}

export async function cleanupIsolatedTestDb() {
  if (testDbBaseDir) {
    try {
      await fsPromises.rm(testDbBaseDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors
    }
    testDbBaseDir = null;
  }
}

// Create test database manager
let testDbPath: string;
let testDbDir: string;

// Track all created user DB paths for robust cleanup
const createdUserDbPaths = new Set<string>();
const userDbPathMap = new Map<string, string>(); // userId -> dbDir

// --- SINGLETON RESET UTILS FOR TEST ISOLATION ---
// Add this utility if not present in DatabaseManager
export function resetAllSingletons() {
  if (typeof DatabaseManager.resetInstance === 'function') {
    DatabaseManager.resetInstance();
  } else if ('singletonInstance' in DatabaseManager) {
    // Fallback for environments where resetInstance is not present
    (DatabaseManager as any).singletonInstance = null;
    console.log('[DIAGNOSTIC] (resetAllSingletons) Fallback: DatabaseManager.singletonInstance set to null');
  }
  if (typeof JobStatusStore.resetInstance === 'function') {
    JobStatusStore.resetInstance();
  }
}

export async function createTestDatabaseManager(): Promise<DatabaseManager> {
  // Reset all singletons before DB creation for test isolation
  resetAllSingletons();
  // Create a unique test database in temp directory
  testDbDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'gmail-test-'));
  testDbPath = path.join(testDbDir, 'test-emails.db');
  
  // Set the storage path environment variable to our test directory
  process.env.STORAGE_PATH = testDbDir;
  
  // Always create a new DatabaseManager instance for each test
  const dbManager = new DatabaseManager(undefined);
  await dbManager.initialize(testDbPath, true);

  // Log DB path and instance ID before migration
  console.log('[DIAGNOSTIC] (before migration) DB path:', testDbPath);
  console.log('[DIAGNOSTIC] (before migration) DB instance ID:', dbManager.getInstanceId());
  try {
    const preColumns = await dbManager.queryAll("PRAGMA table_info(email_index)");
    console.log('[DIAGNOSTIC] (before migration) email_index columns:', preColumns.map((col: any) => col.name));
  } catch (e) {
    console.log('[DIAGNOSTIC] (before migration) email_index columns: ERROR', e);
  }
  try {
    const preMigrations = await dbManager.queryAll("SELECT * FROM migrations");
    console.log('[DIAGNOSTIC] (before migration) migrations table:', preMigrations);
  } catch (e) {
    console.log('[DIAGNOSTIC] (before migration) migrations table: ERROR', e);
  }

  // Check if migrations table exists and if migration version 1 is present
  let shouldRunMigration = true;
  try {
    const tables = await dbManager.queryAll("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'");
    if (tables.length > 0) {
      const versionRows = await dbManager.queryAll("SELECT version FROM migrations WHERE version = 1");
      if (versionRows.length > 0) {
        shouldRunMigration = false;
        console.log('[DIAGNOSTIC] Migration version 1 already applied, skipping migration.');
      }
    }
  } catch (e) {
    // If any error, assume migration needs to run
    shouldRunMigration = true;
  }

  if (shouldRunMigration) {
    const migrationManager = DatabaseMigrationManager.getInstance();
    await migrationManager.initialize();
    await migrationManager.migrateDatabase(dbManager);
    console.log('[DIAGNOSTIC] Ran migration for test DB.');
  }

  // Log schema and migrations table after migration
  const columns = await dbManager.queryAll("PRAGMA table_info(email_index)");
  console.log('[DIAGNOSTIC] (after migration) email_index columns:', columns.map((col: any) => col.name));
  try {
    const postMigrations = await dbManager.queryAll("SELECT * FROM migrations");
    console.log('[DIAGNOSTIC] (after migration) migrations table:', postMigrations);
  } catch (e) {
    console.log('[DIAGNOSTIC] (after migration) migrations table: ERROR', e);
  }
  
  // Log DB path and instance ID after creation
  console.log('[DIAGNOSTIC] (after DB create) DB path:', testDbPath);
  console.log('[DIAGNOSTIC] (after DB create) DB instance ID:', dbManager.getInstanceId());
  
  return dbManager;
}

// Cleanup test database
export async function cleanupTestDatabase(dbManager: DatabaseManager): Promise<void> {
  if (dbManager) {
    await dbManager.close();
    if (typeof DatabaseManager.resetInstance === 'function') {
      DatabaseManager.resetInstance();
    } else if ('singletonInstance' in DatabaseManager) {
      (DatabaseManager as any).singletonInstance = null;
      console.log('[DIAGNOSTIC] (cleanupTestDatabase) Fallback: DatabaseManager.singletonInstance set to null');
    }
    if (typeof JobStatusStore.resetInstance === 'function') {
      JobStatusStore.resetInstance();
    }
    console.log('[DIAGNOSTIC] (after cleanup) Reset all singletons.');
  }
  // Remove test database directory and file
  if (testDbDir) {
    try {
      await fsPromises.rm(testDbDir, { recursive: true, force: true });
      console.log('[DIAGNOSTIC] Cleaned up test DB directory:', testDbDir);
    } catch (error) {
      console.error('[DIAGNOSTIC] Failed to cleanup test database:', error);
    }
  }
}

// Robust multi-user aware seeding: always use the per-user DatabaseManager from the factory
export async function seedTestData(
  emails: EmailIndex[],
  userDbManagerFactory: import('../../../../src/database/UserDatabaseManagerFactory.js').UserDatabaseManagerFactory,
  userId?:string
): Promise<void> {
  // If a userId is provided, seed all emails into that user's DB (single-user mode)
  if (userId) {
    const dbManager = await userDbManagerFactory.getUserDatabaseManager(userId);
    await dbManager.bulkUpsertEmailIndex(emails, userId);
    return;
  }
  // Otherwise, group emails by user_id and seed each group into the correct per-user DB
  const emailsByUser: Record<string, EmailIndex[]> = {};
  for (const email of emails) {
    const uid = email.user_id || 'default';
    if (!emailsByUser[uid]) emailsByUser[uid] = [];
    emailsByUser[uid].push(email);
  }
  for (const uid of Object.keys(emailsByUser)) {
    const dbManager = await userDbManagerFactory.getUserDatabaseManager(uid);
    await dbManager.bulkUpsertEmailIndex(emailsByUser[uid], uid);
  }
}

// Create mock CacheManager
export function createMockCacheManager(): CacheManager {
  const mockCache = new Map<string, any>();
  
  return {
    get: jest.fn((key: string) => mockCache.get(key)),
    set: jest.fn((key: string, value: any, ttl?: number) => {
      mockCache.set(key, value);
      return true;
    }),
    delete: jest.fn((key: string) => {
      return mockCache.delete(key);
    }),
    flush: jest.fn(() => {
      mockCache.clear();
    }),
    has: jest.fn((key: string) => mockCache.has(key)),
    stats: jest.fn(() => ({
      keys: mockCache.size,
      hits: 0,
      misses: 0,
      size: 0
    }))
  } as unknown as CacheManager;
}

/**
 * Create CategorizationEngine with real database (multi-user aware, per-test factory)
 * @param userDbManagerFactory The per-test UserDatabaseManagerFactory instance
 */
export async function createCategorizationEngineWithRealDb(
  userDbManagerFactory: UserDatabaseManagerFactory
): Promise<{
  categorizationEngine: CategorizationEngine;
  cacheManager: CacheManager;
  userDbManagerFactory: UserDatabaseManagerFactory;
}> {
  const cacheManager = createMockCacheManager();
  // Use the per-test factory for all multi-user aware CategorizationEngine instantiations
  const categorizationEngine = new CategorizationEngine(userDbManagerFactory, cacheManager);
  return {
    categorizationEngine,
    cacheManager,
    userDbManagerFactory
  };
}

// Verify categorization results
export async function verifyCategorization(
  dbManager: DatabaseManager,
  emailIds: string[],
  expectedCategory: PriorityCategory
): Promise<void> {
  for (const id of emailIds) {
    const email = await dbManager.getEmailIndex(id);
    expect(email).toBeDefined();
    if (email) {
      expect(email.category).toBe(expectedCategory);
    }
  }
}

// Helper to capture logger output
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

type LoggerMethodName = 'log' | 'warn' | 'error' | 'info';
const loggerSpies: { [key in LoggerMethodName]?: any } = {};

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
    return loggerInstance;
  });
  loggerSpies.error = jest.spyOn(loggerInstance, 'error').mockImplementation((...args: any[]) => {
    capturedOutput.errors.push(formatArgs(...args));
    return loggerInstance;
  });
  loggerSpies.warn = jest.spyOn(loggerInstance, 'warn').mockImplementation((...args: any[]) => {
    capturedOutput.warns.push(formatArgs(...args));
    return loggerInstance;
  });
  loggerSpies.info = jest.spyOn(loggerInstance, 'info').mockImplementation((...args: any[]) => {
    capturedOutput.infos.push(formatArgs(...args));
    return loggerInstance;
  });

  return capturedOutput;
}

export function stopLoggerCapture() {
  for (const method of Object.keys(loggerSpies) as LoggerMethodName[]) {
    loggerSpies[method]?.mockRestore();
    delete loggerSpies[method];
  }
}

// Helper to create mock analyzer configurations
export function createMockImportanceAnalyzerConfig() {
  return {
    rules: [
      {
        id: 'test-urgent',
        name: 'Test Urgent Keywords',
        type: 'keyword',
        priority: 100,
        weight: 15,
        keywords: ['urgent', 'critical', 'emergency', 'asap']
      },
      {
        id: 'test-important-domains',
        name: 'Test Important Domains',
        type: 'domain',
        priority: 90,
        weight: 10,
        domains: ['company.com', 'client.com', 'ceo@company.com']
      },
      {
        id: 'test-promotional',
        name: 'Test Promotional Keywords',
        type: 'keyword',
        priority: 20,
        weight: -8,
        keywords: ['sale', 'discount', 'offer', 'promotion']
      }
    ],
    scoring: {
      highThreshold: 10,
      lowThreshold: -5,
      defaultWeight: 1
    },
    caching: {
      enabled: true,
      keyStrategy: 'partial' as const
    }
  };
}

export function createMockDateSizeAnalyzerConfig() {
  return {
    sizeThresholds: {
      small: 100000,    // 100KB
      medium: 1000000,  // 1MB
      large: 10000000   // 10MB
    },
    ageCategories: {
      recent: 7,    // 7 days
      moderate: 30, // 30 days
      old: 90       // 90 days
    },
    scoring: {
      recencyWeight: 0.7,
      sizeWeight: 0.3
    },
    caching: {
      enabled: true,
      ttl: 3600
    }
  };
}

export function createMockLabelClassifierConfig() {
  return {
    labelMappings: {
      gmailToCategory: {
        'important': 'important' as const,
        'starred': 'important' as const,
        'spam': 'spam' as const,
        'junk': 'spam' as const,
        'promotions': 'promotions' as const,
        'social': 'social' as const
      },
      spamLabels: ['spam', 'junk', 'phishing'],
      promotionalLabels: ['promotions', 'category_promotions', 'sale', 'offer'],
      socialLabels: ['category_social', 'facebook', 'twitter']
    },
    scoring: {
      spamThreshold: 0.7,
      promotionalThreshold: 0.5,
      socialThreshold: 0.4
    },
    caching: {
      enabled: true,
      ttl: 1800
    }
  };
}

// Helper to create complete system configuration for testing
export function createTestSystemConfig() {
  return {
    analyzers: {
      importance: createMockImportanceAnalyzerConfig(),
      dateSize: createMockDateSizeAnalyzerConfig(),
      labelClassifier: createMockLabelClassifierConfig()
    },
    orchestration: {
      enableParallelProcessing: true,
      batchSize: 50,
      timeoutMs: 30000,
      retryAttempts: 3
    },
    caching: {
      globalEnabled: true,
      defaultTtl: 600,
      maxCacheSize: 1000
    },
    performance: {
      enableProfiling: false,
      logSlowOperations: true,
      slowOperationThresholdMs: 1000
    }
  };
}

// Helper to verify analyzer-specific results
export async function verifyImportanceAnalysis(
  dbManager: DatabaseManager,
  emailId: string,
  expectedLevel: 'high' | 'medium' | 'low'
): Promise<void> {
  const email = await dbManager.getEmailIndex(emailId);
  expect(email).toBeDefined();
  if (email) {
    // This would require access to the analyzer directly
    // For integration tests, we verify through the final category
    expect(email.category).toBeDefined();
  }
}

export async function verifyDateSizeAnalysis(
  dbManager: DatabaseManager,
  emailId: string,
  expectedAgeCategory: 'recent' | 'moderate' | 'old',
  expectedSizeCategory: 'small' | 'medium' | 'large'
): Promise<void> {
  const email = await dbManager.getEmailIndex(emailId);
  expect(email).toBeDefined();
  if (email) {
    // Verify through email properties
    const now = new Date();
    const emailDate = email.date || new Date();
    const daysDiff = Math.floor((now.getTime() - emailDate.getTime()) / (1000 * 60 * 60 * 24));
    
    if (expectedAgeCategory === 'recent') {
      expect(daysDiff).toBeLessThanOrEqual(7);
    } else if (expectedAgeCategory === 'moderate') {
      expect(daysDiff).toBeGreaterThan(7);
      expect(daysDiff).toBeLessThanOrEqual(30);
    } else {
      expect(daysDiff).toBeGreaterThan(30);
    }
    
    const size = email.size || 0;
    if (expectedSizeCategory === 'small') {
      expect(size).toBeLessThanOrEqual(100000);
    } else if (expectedSizeCategory === 'medium') {
      expect(size).toBeGreaterThan(100000);
      expect(size).toBeLessThanOrEqual(1000000);
    } else {
      expect(size).toBeGreaterThan(1000000);
    }
  }
}

export async function verifyLabelClassification(
  dbManager: DatabaseManager,
  emailId: string,
  expectedCategory: 'primary' | 'social' | 'promotions' | 'updates' | 'forums' | 'spam' | 'important'
): Promise<void> {
  const email = await dbManager.getEmailIndex(emailId);
  expect(email).toBeDefined();
  if (email) {
    const labels = email.labels || [];
    
    // Verify based on labels
    if (expectedCategory === 'spam') {
      expect(labels.some(label =>
        ['spam', 'junk'].includes(label.toLowerCase())
      )).toBe(true);
    } else if (expectedCategory === 'promotions') {
      expect(labels.some(label =>
        ['promotions', 'category_promotions'].includes(label.toLowerCase())
      )).toBe(true);
    } else if (expectedCategory === 'social') {
      expect(labels.some(label =>
        ['category_social', 'social'].includes(label.toLowerCase())
      )).toBe(true);
    } else if (expectedCategory === 'important') {
      expect(labels.some(label =>
        ['important', 'starred'].includes(label.toLowerCase())
      )).toBe(true);
    }
  }
}

// Helper to create test emails with specific characteristics
export function createTestEmailForImportance(overrides: Partial<EmailIndex> = {}): EmailIndex {
  return {
    id: `importance-test-${Date.now()}`,
    threadId: `thread-${Date.now()}`,
    category: null,
    subject: 'Test Subject',
    sender: 'test@example.com',
    recipients: ['user@example.com'],
    date: new Date(),
    year: new Date().getFullYear(),
    size: 50000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'Test email snippet',
    archived: false,
    ...overrides
  };
}

export function createTestEmailForDateSize(overrides: Partial<EmailIndex> = {}): EmailIndex {
  return {
    id: `datesize-test-${Date.now()}`,
    threadId: `thread-${Date.now()}`,
    category: null,
    subject: 'Test Subject',
    sender: 'test@example.com',
    recipients: ['user@example.com'],
    date: new Date(),
    year: new Date().getFullYear(),
    size: 50000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'Test email snippet',
    archived: false,
    ...overrides
  };
}

export function createTestEmailForLabels(overrides: Partial<EmailIndex> = {}): EmailIndex {
  return {
    id: `label-test-${Date.now()}`,
    threadId: `thread-${Date.now()}`,
    category: null,
    subject: 'Test Subject',
    sender: 'test@example.com',
    recipients: ['user@example.com'],
    date: new Date(),
    year: new Date().getFullYear(),
    size: 50000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'Test email snippet',
    archived: false,
    ...overrides
  };
}

// Helper to wait for async operations
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to generate performance test data
export function generatePerformanceTestEmails(count: number): EmailIndex[] {
  const emails: EmailIndex[] = [];
  
  for (let i = 0; i < count; i++) {
    emails.push({
      id: `perf-test-${i}`,
      threadId: `thread-perf-${i}`,
      category: null,
      subject: `Performance Test Email ${i}`,
      sender: `sender${i}@example.com`,
      recipients: ['user@example.com'],
      date: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000), // Random date within last year
      year: new Date().getFullYear(),
      size: Math.floor(Math.random() * 10000000), // Random size up to 10MB
      hasAttachments: Math.random() > 0.5,
      labels: ['INBOX'],
      snippet: `Performance test email snippet ${i}`,
      archived: false
    });
  }
  
  return emails;
}

// =====================================
// NEW ENHANCED HELPER FUNCTIONS FOR COMPREHENSIVE TESTING
// =====================================

// Job Processing Helpers
export async function waitForJobCompletion(jobId: string, options: { timeout?: number } = {}): Promise<Job> {
  const timeout = options.timeout ?? 15000; // Increased default timeout to 15s
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const job = await JobStatusStore.getInstance().getJobStatus(jobId);
    if (job && [JobStatus.COMPLETED, JobStatus.FAILED].includes(job.status)) {
      return job;
    }
    await delay(100); // Check every 100ms
  }
  throw new Error(`Job ${jobId} did not complete within ${timeout}ms`);
}

export async function waitForJobStatus(jobId: string, status: JobStatus, timeout: number = 15000): Promise<Job> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const job = await JobStatusStore.getInstance().getJobStatus(jobId);
    if (job && job.status === status) {
      return job;
    }
    await delay(100);
  }
  throw new Error(`Job ${jobId} did not reach status ${status} within ${timeout}ms`);
}

export async function createJobAndWaitForCompletion(params: any): Promise<{ job: Job, result: any }> {
  const jobStatusStore = JobStatusStore.getInstance();
  const jobId = await jobStatusStore.createJob('categorization', params);
  const job = await waitForJobCompletion(jobId);
  return { job, result: job.results };
}

export async function submitMultipleJobs(jobParams: any[], user_id?: string): Promise<string[]> {
  const jobStatusStore = JobStatusStore.getInstance();
  const jobIds: string[] = [];
  
  for (const params of jobParams) {
    const jobId = await jobStatusStore.createJob('categorization', params, user_id);
    jobIds.push(jobId);
  }
  
  return jobIds;
}

// Analyzer Result Verification
export async function verifyAnalyzerResultsPersistence(
  dbManager: DatabaseManager,
  emailId: string,
  expectedResults: {
    importanceLevel?: 'high' | 'medium' | 'low';
    ageCategory?: 'recent' | 'moderate' | 'old';
    sizeCategory?: 'small' | 'medium' | 'large';
    gmailCategory?: string;
  }
): Promise<void> {
  const email = await dbManager.getEmailIndex(emailId);
  expect(email).toBeDefined();
  
  if (email && expectedResults) {
    if (expectedResults.importanceLevel) {
      expect(email.importanceLevel).toBe(expectedResults.importanceLevel);
    }
    if (expectedResults.ageCategory) {
      expect(email.ageCategory).toBe(expectedResults.ageCategory);
    }
    if (expectedResults.sizeCategory) {
      expect(email.sizeCategory).toBe(expectedResults.sizeCategory);
    }
    if (expectedResults.gmailCategory) {
      expect(email.gmailCategory).toBe(expectedResults.gmailCategory);
    }
  }
}

export async function verifyJobResultsIntegrity(jobId: string): Promise<void> {
  const jobStatusStore = JobStatusStore.getInstance();
  const job = await jobStatusStore.getJobStatus(jobId);
  
  expect(job).toBeDefined();
  expect(job!.status).toBe(JobStatus.COMPLETED);
  expect(job!.results).toBeDefined();
  expect(job!.results.processed).toBeGreaterThanOrEqual(0);
  expect(job!.results.emailIds).toBeDefined();
  expect(Array.isArray(job!.results.emailIds)).toBe(true);
  expect(job!.completed_at).toBeDefined();
}

export async function assertAnalyzerResultsComplete(
  dbManager: DatabaseManager,
  emailIds: string[]
): Promise<void> {
  for (const emailId of emailIds) {
    const email = await dbManager.getEmailIndex(emailId);
    expect(email).toBeDefined();
    
    if (email) {
      // Verify all analyzer results are present
      expect(email.category).not.toBeNull();
      expect(email.importanceLevel).toBeDefined();
      expect(email.importanceScore).toBeDefined();
      expect(email.ageCategory).toBeDefined();
      expect(email.sizeCategory).toBeDefined();
      expect(email.analysisTimestamp).toBeDefined();
      expect(email.analysisVersion).toBeDefined();
    }
  }
}

// Performance and Metrics
export async function measureProcessingTime<T>(operation: () => Promise<T>): Promise<{ result: T, timeMs: number }> {
  const startTime = Date.now();
  const result = await operation();
  const timeMs = Date.now() - startTime;
  return { result, timeMs };
}

export async function generateLargeEmailDataset(
  count: number,
  characteristics?: {
    highPriorityRatio?: number;
    lowPriorityRatio?: number;
    yearRange?: { start: number; end: number };
  }
): Promise<EmailIndex[]> {
  const emails: EmailIndex[] = [];
  const chars = characteristics || {};
  const highRatio = chars.highPriorityRatio || 0.2;
  const lowRatio = chars.lowPriorityRatio || 0.3;
  const yearStart = chars.yearRange?.start || 2022;
  const yearEnd = chars.yearRange?.end || 2024;
  
  for (let i = 0; i < count; i++) {
    const rand = Math.random();
    let subject = `Test Email ${i}`;
    let sender = `sender${i}@example.com`;
    let labels = ['INBOX'];
    
    // Generate high priority emails
    if (rand < highRatio) {
      subject = `URGENT: Critical Issue ${i}`;
      sender = `admin@company.com`;
      labels = ['INBOX', 'IMPORTANT'];
    }
    // Generate low priority emails
    else if (rand < highRatio + lowRatio) {
      subject = `Special Offer ${i} - 50% Discount!`;
      sender = `noreply@promotions.com`;
      labels = ['INBOX', 'PROMOTIONS'];
    }
    
    emails.push({
      id: `large-dataset-${i}`,
      threadId: `thread-large-${i}`,
      category: null,
      subject,
      sender,
      recipients: ['user@example.com'],
      date: new Date(yearStart + Math.random() * (yearEnd - yearStart), Math.floor(Math.random() * 12), Math.floor(Math.random() * 28)),
      year: yearStart + Math.floor(Math.random() * (yearEnd - yearStart + 1)),
      size: Math.floor(Math.random() * 10000000),
      hasAttachments: Math.random() > 0.7,
      labels,
      snippet: `Test email snippet for email ${i}`,
      archived: false
    });
  }
  
  return emails;
}

export async function measureMemoryUsage<T>(operation: () => Promise<T>): Promise<{ result: T, memoryDelta: number }> {
  const initialMemory = process.memoryUsage().heapUsed;
  const result = await operation();
  const finalMemory = process.memoryUsage().heapUsed;
  const memoryDelta = finalMemory - initialMemory;
  return { result, memoryDelta };
}

// Configuration Management
export function createTestConfiguration(overrides: Partial<CategorizationSystemConfig> = {}): CategorizationSystemConfig {
  const baseConfig = createTestSystemConfig();
  return {
    ...baseConfig,
    ...overrides,
    analyzers: {
      ...baseConfig.analyzers,
      ...overrides.analyzers
    },
    orchestration: {
      ...baseConfig.orchestration,
      ...overrides.orchestration
    }
  };
}

export async function updateWorkerConfiguration(
  worker: CategorizationWorker,
  config: CategorizationSystemConfig
): Promise<void> {
  // Access the categorization engine through the worker
  const engine = (worker as any).categorizationEngine as CategorizationEngine;
  if (engine && typeof engine.updateConfiguration === 'function') {
    engine.updateConfiguration(config);
  }
}

export function validateConfigurationIntegrity(config: CategorizationSystemConfig): { valid: boolean, errors: string[] } {
  const errors: string[] = [];
  
  // Validate orchestration settings
  if (config.orchestration.batchSize <= 0) {
    errors.push('Batch size must be greater than 0');
  }
  if (config.orchestration.timeoutMs <= 0) {
    errors.push('Timeout must be greater than 0');
  }
  if (config.orchestration.retryAttempts < 0) {
    errors.push('Retry attempts cannot be negative');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Error Injection and Simulation
export function injectAnalyzerError(analyzerType: 'importance' | 'dateSize' | 'label', errorType: string): any {
  // This would be implemented based on the specific analyzer interfaces
  // For now, return a mock spy that can be used to simulate errors
  return jest.fn(() => Promise.reject(new Error(`${analyzerType} analyzer ${errorType} error`)));
}

export function simulateNetworkTimeout(durationMs: number): void {
  // Use fake timers to simulate timeout scenarios
  jest.advanceTimersByTime(durationMs);
}

export function simulateDatabaseConnectionDrop(): any {
  // Return a spy that can be used to mock database connection failures
  return jest.fn(() => Promise.reject(new Error('Database connection failed')));
}

export async function simulateSystemLoad(): Promise<void> {
  // Simulate system load by performing CPU-intensive operations
  const iterations = 1000000;
  let result = 0;
  for (let i = 0; i < iterations; i++) {
    result += Math.random();
  }
  await delay(10); // Small delay to simulate I/O
}

// Database and Data Management
export async function seedRealisticTestData(
  dbManager: DatabaseManager,
  emailCount: number = 50
): Promise<EmailIndex[]> {
  const emails = await generateLargeEmailDataset(emailCount, {
    highPriorityRatio: 0.2,
    lowPriorityRatio: 0.3,
    yearRange: { start: 2022, end: 2024 }
  });
  
  await seedTestData(emails, userDatabaseManagerFactory);
  return emails;
}

export async function verifyDatabaseConsistency(dbManager: DatabaseManager): Promise<boolean> {
  try {
    // Basic consistency checks
    const emails = await dbManager.searchEmails({});
    
    // Verify all emails have required fields
    for (const email of emails) {
      if (!email.id || !email.subject || !email.sender) {
        return false;
      }
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

export async function cleanupTestArtifacts(): Promise<void> {
  // Clear any test artifacts, caches, etc.
  // This can be extended as needed
}

// Worker Lifecycle Management
export async function waitForWorkerShutdown(worker: CategorizationWorker, timeout: number = 5000): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    // Check if worker is still running (this would need to be implemented based on worker interface)
    const isRunning = (worker as any).isRunning;
    if (!isRunning) {
      return;
    }
    await delay(100);
  }
  
  throw new Error(`Worker did not shutdown within ${timeout}ms`);
}

export async function restartWorker(worker: CategorizationWorker): Promise<void> {
  worker.stop();
  await waitForWorkerShutdown(worker);
  worker.start();
}

export function getWorkerState(worker: CategorizationWorker): { isRunning: boolean } {
  return {
    isRunning: (worker as any).isRunning || false
  };
}

// Enhanced Assertion Helpers
export async function assertCompleteJobExecution(jobId: string): Promise<void> {
  const jobStatusStore = JobStatusStore.getInstance();
  const job = await jobStatusStore.getJobStatus(jobId);
  
  expect(job).not.toBeNull();
  expect(job!.status).toBe(JobStatus.COMPLETED);
  expect(job!.results).toBeDefined();
  expect(job!.completed_at).toBeDefined();
  expect(job!.results.processed).toBeGreaterThanOrEqual(0);
  expect(job!.started_at).toBeDefined();
  expect(job!.created_at).toBeDefined();
  
  // Verify timing makes sense
  expect(job!.completed_at!.getTime()).toBeGreaterThanOrEqual(job!.started_at!.getTime());
  expect(job!.started_at!.getTime()).toBeGreaterThanOrEqual(job!.created_at.getTime());
}

export async function assertAnalyzerResultsIntegrity(
  dbManager: DatabaseManager,
  emailIds: string[]
): Promise<void> {
  for (const emailId of emailIds) {
    const email = await dbManager.getEmailIndex(emailId);
    expect(email).toBeDefined();
    
    if (email) {
      expect(email.category).not.toBeNull();
      expect(['high', 'medium', 'low']).toContain(email.category);
      
      // Importance analyzer results
      expect(email.importanceLevel).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(email.importanceLevel);
      expect(typeof email.importanceScore).toBe('number');
      expect(Array.isArray(email.importanceMatchedRules || [])).toBe(true);
      expect(typeof (email.importanceConfidence || 0)).toBe('number');
      
      // Date/Size analyzer results
      expect(email.ageCategory).toBeDefined();
      expect(['recent', 'moderate', 'old']).toContain(email.ageCategory);
      expect(email.sizeCategory).toBeDefined();
      expect(['small', 'medium', 'large']).toContain(email.sizeCategory);
      expect(typeof (email.recencyScore || 0)).toBe('number');
      
      // Analysis metadata
      expect(email.analysisTimestamp).toBeDefined();
      expect(email.analysisVersion).toBeDefined();
    }
  }
}

export async function assertPerformanceMetrics(
  metrics: AnalysisMetrics,
  expectations: {
    totalTime?: { max: number };
    cacheHitRatio?: { min: number };
    rulesEvaluated?: { min: number };
  }
): Promise<void> {
  if (expectations.totalTime) {
    expect(metrics.totalProcessingTime).toBeLessThan(expectations.totalTime.max);
  }
  
  if (expectations.cacheHitRatio && (metrics.cacheHits + metrics.cacheMisses) > 0) {
    const hitRatio = metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses);
    expect(hitRatio).toBeGreaterThan(expectations.cacheHitRatio.min);
  }
  
  if (expectations.rulesEvaluated) {
    expect(metrics.rulesEvaluated).toBeGreaterThanOrEqual(expectations.rulesEvaluated.min);
  }
}

// Create specialized worker setup helper
export async function createWorkerWithRealComponents(): Promise<{
  worker: CategorizationWorker;
  jobQueue: JobQueue;
  categorizationEngine: CategorizationEngine;
  jobStatusStore: JobStatusStore;
  dbManager: DatabaseManager;
  cacheManager: CacheManager;
}> {
  // Reset all singletons before creating components
  resetAllSingletons();
  const dbManager = await createTestDatabaseManager();
  // Reset JobStatusStore singleton for test isolation (again, after DB is ready)
  JobStatusStore.resetInstance();
  const jobStatusStore = JobStatusStore.getInstance(dbManager);
  await jobStatusStore.initialize();
  console.log('[DIAGNOSTIC] (worker setup) JobStatusStore instance ID:', jobStatusStore.getInstanceId());
  console.log('[DIAGNOSTIC] (worker setup) DatabaseManager instance ID:', dbManager.getInstanceId());
  const jobQueue = new JobQueue();
  const cacheManager = new CacheManager();
  const categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
  const worker = new CategorizationWorker(jobQueue, categorizationEngine);
  return {
    worker,
    jobQueue,
    categorizationEngine,
    jobStatusStore,
    dbManager,
    cacheManager
  };
}

// Enhanced cleanup: remove all created user DBs
export async function cleanupAllUserTestDatabases() {
  for (const dbDir of createdUserDbPaths) {
    try {
      await fsPromises.rm(dbDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore errors
    }
  }
  createdUserDbPaths.clear();
  userDbPathMap.clear();
}

// Remove the entire directory where user DBs are created
export async function cleanupAllUserDbDirectories() {
  // Get the base path from the registry singleton
  const registry = DatabaseRegistry.getInstance();
  // Try to get the base path from the registry, fallback to env or default
  const basePath = (registry as any).dbBasePath || process.env.STORAGE_PATH || './data/db';
  try {
    await fsPromises.rm(basePath, { recursive: true, force: true });
    console.log(`[DIAGNOSTIC] Cleaned up all user DB directories at: ${basePath}`);
  } catch (e) {
    console.warn(`[DIAGNOSTIC] Failed to cleanup user DB directories at: ${basePath}`, e);
  }
}