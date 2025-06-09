import { jest } from '@jest/globals';

// Mock import.meta.url for CommonJS compatibility in tests
if (typeof global !== 'undefined') {
  // @ts-ignore
  global.__filename = __filename;
  // @ts-ignore
  global.__dirname = __dirname;
}

// Increase timeout for integration tests
jest.setTimeout(30000);

// Suppress console logs during tests unless explicitly needed
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeAll(() => {
  // Only show console output if SHOW_LOGS env var is set
  if (!process.env.SHOW_LOGS) {
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