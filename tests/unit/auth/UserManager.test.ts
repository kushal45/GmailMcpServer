import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";
import path from 'path';
import os from 'os';
import { UserManager } from '../../../src/auth/UserManager.js';

// Mock the modules but don't try to test the mocked functionality
jest.mock('fs/promises');
jest.mock('../../../src/auth/UserSession.js');
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  }
}));

describe('UserManager Unit Tests', () => {
  let userManager: UserManager;
  const testStoragePath = os.tmpdir() + '/test-user-manager';
  const testEncryptionKey = 'test-encryption-key-12345';
  
  beforeEach(() => {
    jest.clearAllMocks();
    userManager = new UserManager(testStoragePath, testEncryptionKey);
    
    // Set up test users
    (userManager as any).users = new Map([
      ['user-1', {
        userId: 'user-1',
        email: 'user1@example.com',
        displayName: 'Test User 1',
        created: new Date(),
        lastLogin: new Date(),
        preferences: {},
        isActive: true
      }],
      ['user-2', {
        userId: 'user-2',
        email: 'user2@example.com',
        displayName: 'Test User 2',
        created: new Date(),
        lastLogin: new Date(),
        preferences: {},
        isActive: true
      }]
    ]);
    
    // Add a mock session
    (userManager as any).sessions = new Map([
      ['session-123', {
        getSessionData: jest.fn().mockReturnValue({
          sessionId: 'session-123',
          userId: 'user-1'
        }),
        isValid: jest.fn().mockReturnValue(true),
        invalidate: jest.fn()
      }]
    ]);
  });
  
  // This test simply verifies that UserManager can be instantiated
  it('should create a UserManager instance', () => {
    expect(userManager).toBeInstanceOf(UserManager);
  });
  
  // Test user retrieval methods directly (no mocks needed)
  it('should get all users', () => {
    const users = userManager.getAllUsers();
    expect(users.length).toBe(2);
    expect(users[0].email).toBe('user1@example.com');
    expect(users[1].email).toBe('user2@example.com');
  });
  
  it('should get user by ID', () => {
    const user = userManager.getUserById('user-1');
    expect(user).toBeDefined();
    expect(user?.email).toBe('user1@example.com');
  });
  
  it('should get user by email', () => {
    const user = userManager.getUserByEmail('user2@example.com');
    expect(user).toBeDefined();
    expect(user?.userId).toBe('user-2');
  });
  
  it('should throw error when updating non-existent user', async () => {
    await expect(userManager.updateUser('non-existent', { displayName: 'Test' }))
      .rejects.toThrow('User not found');
  });

  it('should get a session by ID', () => {
    const session = userManager.getSession('session-123');
    expect(session).toBeDefined();
    expect(session?.getSessionData().sessionId).toBe('session-123');
  });

  it('should get all active sessions for a user', () => {
    const sessions = userManager.getUserSessions('user-1');
    expect(sessions.length).toBe(1);
    expect(sessions[0].getSessionData().userId).toBe('user-1');
  });

  it('should throw error when creating session for non-existent user', () => {
    expect(() => userManager.createSession('non-existent'))
      .toThrow('User not found');
  });
});
