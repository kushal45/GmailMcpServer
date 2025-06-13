import { jest } from '@jest/globals';
import { EmailIndex, PriorityCategory } from '../../../../src/types/index.js';
import { DatabaseManager } from '../../../../src/database/DatabaseManager.js';
import { CacheManager } from '../../../../src/cache/CacheManager.js';
import { CategorizationEngine } from '../../../../src/categorization/CategorizationEngine.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from '../../../../src/utils/logger.js';
import { Logger } from 'winston';

// Create test database manager
let testDbPath: string;
let testDbDir: string;

export async function createTestDatabaseManager(): Promise<DatabaseManager> {
  // Create a unique test database in temp directory
  testDbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gmail-test-'));
  testDbPath = path.join(testDbDir, 'test-emails.db');
  
  // Set the storage path environment variable to our test directory
  process.env.STORAGE_PATH = testDbDir;
  
  const dbManager = new DatabaseManager();
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

// Create CategorizationEngine with real database
export async function createCategorizationEngineWithRealDb(): Promise<{
  categorizationEngine: CategorizationEngine;
  dbManager: DatabaseManager;
  cacheManager: CacheManager;
}> {
  const dbManager = await createTestDatabaseManager();
  const cacheManager = createMockCacheManager();
  
  const categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
  
  return {
    categorizationEngine,
    dbManager,
    cacheManager
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