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