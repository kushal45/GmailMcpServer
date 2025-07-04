import { jest } from '@jest/globals';

// Increase timeout for integration tests
jest.setTimeout(30000);

// Suppress console logs during tests unless explicitly needed
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  // Only suppress console output if in test/CI and SHOW_LOGS is not set
  const isTestEnv = process.env.NODE_ENV === 'test' || process.env.CI === 'true';
  if (isTestEnv && !process.env.SHOW_LOGS) {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
  }
});

afterAll(() => {
  // Restore console methods
  console.log = originalConsoleLog;
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;
});

// Remove any CJS-style exports or module.exports. Use only ESM imports/exports and globalThis for globals if needed.
// If you need to set up globals, do it like this:
// globalThis.myGlobal = ...;