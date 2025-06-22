import {
  jest,
  describe,
  expect,
  beforeEach,
  test
} from "@jest/globals";
import { UserSession } from '../../../src/auth/UserSession.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

// Mock dependencies
jest.mock('fs/promises');
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  }
}));

describe('UserSession Unit Tests', () => {
  // Test constants
  const testUserId = 'test-user-123';
  const testStoragePath = path.join(os.tmpdir(), 'test-storage');
  const testEncryptionKey = 'test-encryption-key-12345';
  
  // Mock credentials for testing
  const mockCredentials = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    expiry_date: Date.now() + 3600000,
    token_type: 'Bearer',
    id_token: 'test-id-token',
    scope: 'test-scope'
  };
  
  let session: UserSession;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Use jest.spyOn to create proper mocks for each fs function
    jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined as any);
    jest.spyOn(fs, 'writeFile').mockResolvedValue(undefined as any);
    jest.spyOn(fs, 'readFile').mockResolvedValue('mock-iv:mock-encrypted-data' as any);
    jest.spyOn(fs, 'access').mockResolvedValue(undefined as any);
    jest.spyOn(fs, 'unlink').mockResolvedValue(undefined as any);
    
    session = new UserSession(testUserId, testStoragePath, testEncryptionKey);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Session Creation', () => {
    test('should create a valid session with correct properties', () => {
      const sessionData = session.getSessionData();
      
      expect(sessionData.userId).toBe(testUserId);
      expect(sessionData.sessionId).toBeDefined();
      expect(sessionData.created).toBeInstanceOf(Date);
      expect(sessionData.expires).toBeInstanceOf(Date);
      expect(sessionData.lastAccessed).toBeInstanceOf(Date);
      expect(sessionData.isValid).toBe(true);
      
      // Verify token path is set correctly
      expect((session as any).tokenPath).toBe(path.join(testStoragePath, `${testUserId}_token.enc`));
    });
    
    test('should generate a unique session ID for each new session', () => {
      const session1 = new UserSession(testUserId, testStoragePath, testEncryptionKey);
      const session2 = new UserSession(testUserId, testStoragePath, testEncryptionKey);
      
      expect(session1.getSessionData().sessionId).not.toBe(session2.getSessionData().sessionId);
    });
  });

  describe('Session Validation', () => {
    test('should return true for a valid session', () => {
      expect(session.isValid()).toBe(true);
    });
    
    test('should return false if session is manually invalidated', () => {
      session.invalidate();
      expect(session.isValid()).toBe(false);
    });
    
    test('should return false if session has expired', () => {
      // Mock an expired session by manipulating the expiry date
      const sessionData = session.getSessionData();
      (session as any).sessionData.expires = new Date(Date.now() - 1000);
      
      expect(session.isValid()).toBe(false);
      expect((session as any).sessionData.isValid).toBe(false); // Should be invalidated internally
    });
    
    test('should update lastAccessed timestamp when validating', () => {
      const beforeLastAccessed = session.getSessionData().lastAccessed;
      // Wait a small amount to ensure the timestamp changes
      jest.advanceTimersByTime(10);
      
      session.isValid();
      
      const afterLastAccessed = session.getSessionData().lastAccessed;
      expect(afterLastAccessed.getTime()).toBeGreaterThan(beforeLastAccessed.getTime());
    });
  });

  describe('Session Extension', () => {
    test('should extend session expiry time', () => {
      const originalExpires = session.getSessionData().expires;
      const originalExpiryTime = originalExpires.getTime();
      
      // Advance time to simulate some time passing
      jest.advanceTimersByTime(1000);
      
      session.extendSession();
      
      const newExpires = session.getSessionData().expires;
      expect(newExpires.getTime()).toBeGreaterThan(originalExpiryTime);
    });
    
    test('should allow custom extension duration', () => {
      const originalExpires = session.getSessionData().expires;
      const customDuration = 2 * 60 * 60 * 1000; // 2 hours
      
      session.extendSession(customDuration);
      
      const newExpires = session.getSessionData().expires;
      // The new expiry should be approximately the current time + customDuration
      const expectedExpiry = Date.now() + customDuration;
      expect(Math.abs(newExpires.getTime() - expectedExpiry)).toBeLessThan(100); // Allow small timing differences
    });
    
    test('should throw error when extending an invalid session', () => {
      session.invalidate();
      
      expect(() => {
        session.extendSession();
      }).toThrow('Cannot extend an invalid session');
    });
  });

  describe('Token Storage and Retrieval', () => {
    beforeEach(() => {
      // Mock the decrypt and encrypt methods for these tests
      const encryptedData = 'mock-iv:mock-encrypted-data';
      
      // Mock the decrypt method
      (session as any).decryptData = jest.fn().mockReturnValue(JSON.stringify(mockCredentials));
      (session as any).encryptData = jest.fn().mockReturnValue(encryptedData);
    });
    
    test('should store token credentials', async () => {
      await session.storeToken(mockCredentials);
      
      expect(fs.mkdir).toHaveBeenCalledWith(path.dirname((session as any).tokenPath), { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith((session as any).tokenPath, expect.any(String));
      expect((session as any).tokenData).toEqual(mockCredentials);
    });
    
    test('should retrieve stored token credentials', async () => {
      // First store the token
      await session.storeToken(mockCredentials);
      
      // Clear the in-memory token to force a file read
      (session as any).tokenData = null;
      
      const retrievedToken = await session.getToken();
      
      expect(fs.readFile).toHaveBeenCalledWith((session as any).tokenPath, 'utf-8');
      expect(retrievedToken).toEqual(mockCredentials);
    });
    
    test('should return cached token if available', async () => {
      // Set token in memory
      (session as any).tokenData = mockCredentials;
      
      const retrievedToken = await session.getToken();
      
      expect(fs.readFile).not.toHaveBeenCalled(); // Shouldn't read from file
      expect(retrievedToken).toEqual(mockCredentials);
    });
    
    test('should detect if token exists', async () => {
      // Mock access success
      jest.spyOn(fs, 'access').mockResolvedValue(undefined as any);
      
      const hasToken = await session.hasToken();
      expect(hasToken).toBe(true);
      
      // Test with in-memory token
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));
      (session as any).tokenData = mockCredentials;
      
      const hasTokenInMemory = await session.hasToken();
      expect(hasTokenInMemory).toBe(true);
    });
    
    test('should return false if token does not exist', async () => {
      // Mock access failure
      jest.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));
      (session as any).tokenData = null;
      
      const hasToken = await session.hasToken();
      expect(hasToken).toBe(false);
    });
    
    test('should update an existing token', async () => {
      const updatedCredentials = {
        ...mockCredentials,
        access_token: 'updated-access-token'
      };
      
      await session.updateToken(updatedCredentials);
      
      expect(fs.writeFile).toHaveBeenCalled();
      expect((session as any).tokenData).toEqual(updatedCredentials);
    });
    
    test('should remove token', async () => {
      // Set token in memory
      (session as any).tokenData = mockCredentials;
      
      await session.removeToken();
      
      expect(fs.unlink).toHaveBeenCalledWith((session as any).tokenPath);
      expect((session as any).tokenData).toBeNull();
    });
    
    test('should handle non-existent token when removing', async () => {
      // Mock unlink failure with ENOENT
      jest.spyOn(fs, 'unlink').mockRejectedValue({ code: 'ENOENT' } as any);
      
      await expect(session.removeToken()).resolves.not.toThrow();
    });
  });

  describe('Encryption and Decryption', () => {
    test('should encrypt data with correct format', () => {
      // Restore original implementation for this test
      (session as any).encryptData = UserSession.prototype['encryptData'];
      
      const testData = 'test-data-to-encrypt';
      const encrypted = (session as any).encryptData(testData);
      
      // Should have format iv:encryptedData
      expect(encrypted).toContain(':');
      const parts = encrypted.split(':');
      expect(parts.length).toBe(2);
      
      // IV should be 32 characters (16 bytes in hex)
      expect(parts[0].length).toBe(32);
    });
    
    test('should decrypt data correctly', () => {
      // Restore original implementation for this test
      (session as any).encryptData = UserSession.prototype['encryptData'];
      (session as any).decryptData = UserSession.prototype['decryptData'];
      
      const testData = 'test-data-to-encrypt-and-decrypt';
      const encrypted = (session as any).encryptData(testData);
      const decrypted = (session as any).decryptData(encrypted);
      
      expect(decrypted).toBe(testData);
    });
    
    test('should throw error for invalid encrypted data format', () => {
      // Restore original implementation for this test
      (session as any).decryptData = UserSession.prototype['decryptData'];
      
      const invalidEncryptedData = 'invalid-format-without-colon';
      
      expect(() => {
        (session as any).decryptData(invalidEncryptedData);
      }).toThrow('Invalid encrypted data format');
    });
  });
});