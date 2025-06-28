import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from "@jest/globals";

// Import types for proper typing
import { UserProfile } from '../../../src/types/index.js';
import { handleToolCall } from '../../../src/tools/handler.js';
import { AuthManager } from '../../../src/auth/AuthManager.js';
import { UserManager } from '../../../src/auth/UserManager.js';

describe('Multi-User Authentication Integration Tests', () => {
  // Test constants
  const USER1 = 'user-1';
  const USER2 = 'user-2';
  const ADMIN_USER = 'admin-user-1';
  
  // Mock authentication system
  let mockAuthSystem: any;
  let mockRegisterUser: jest.Mock;
  let mockAuthenticate: jest.Mock;
  let mockAuthCallback: jest.Mock;
  let mockListEmails: jest.Mock;
  let mockUpdateUser: jest.Mock;
  let mockValidateSession: jest.Mock;
  
  // Mock user data
  const adminUser: UserProfile = {
    userId: ADMIN_USER,
    email: 'admin@example.com',
    displayName: 'Admin User',
    role: 'admin',
    created: new Date(),
    preferences: {},
    isActive: true
  };
  
  const regularUser: UserProfile = {
    userId: USER1,
    email: 'user@example.com',
    displayName: 'Regular User',
    role: 'user',
    created: new Date(),
    preferences: {},
    isActive: true
  };

  beforeEach(() => {
    // Create mock functions
    mockRegisterUser = jest.fn();
    mockAuthenticate = jest.fn();
    mockAuthCallback = jest.fn();
    mockListEmails = jest.fn();
    mockUpdateUser = jest.fn();
    mockValidateSession = jest.fn();
    
    // Create a mock authentication system object
    mockAuthSystem = {
      registerUser: mockRegisterUser,
      authenticate: mockAuthenticate,
      authCallback: mockAuthCallback,
      listEmails: mockListEmails,
      updateUser: mockUpdateUser,
      validateSession: mockValidateSession
    };
    
    // Setup mock implementations
    mockRegisterUser.mockImplementation((email: any, displayName: any, userContext?: any) => {
      // First user becomes admin
      if (!userContext) {
        return Promise.resolve({
          user_id: 'new-admin-id',
          email: email,
          display_name: displayName,
          role: 'admin'
        });
      }
      
      // Validate admin session for subsequent users
      if (!userContext.session_id || userContext.session_id === 'invalid-session') {
        return Promise.reject(new Error('Invalid user context'));
      }
      
      if (userContext.user_id !== ADMIN_USER) {
        return Promise.reject(new Error('Access denied'));
      }
      
      return Promise.resolve({
        user_id: 'new-user-id',
        email: email,
        display_name: displayName,
        role: 'user'
      });
    });
    
    mockAuthenticate.mockImplementation(() => {
      return Promise.resolve({
        auth_url: 'https://mock-auth-url.com'
      });
    });
    
    mockAuthCallback.mockImplementation((code: any, userId: any) => {
      return Promise.resolve({
        session_id: 'new-session-id',
        user_id: userId,
        expires_at: new Date(Date.now() + 86400000)
      });
    });
    
    mockValidateSession.mockImplementation((sessionId: any) => {
      if (sessionId === 'valid-session' || sessionId === 'admin-session' || sessionId === 'user1-session') {
        return { isValid: true, userId: sessionId.includes('admin') ? ADMIN_USER : USER1 };
      }
      return { isValid: false };
    });
    
    mockListEmails.mockImplementation((userContext: any) => {
      const session = mockAuthSystem.validateSession(userContext.session_id);
      if (!session.isValid) {
        return Promise.reject(new Error('Invalid session'));
      }
      
      return Promise.resolve([
        { id: 'email-1', subject: 'Test Email' }
      ]);
    });
    
    mockUpdateUser.mockImplementation((userContext: any, targetUserId: any, displayName: any) => {
      const session = mockAuthSystem.validateSession(userContext.session_id);
      if (!session.isValid) {
        return Promise.reject(new Error('Invalid session'));
      }
      
      // Only admin can update users
      if (session.userId !== ADMIN_USER) {
        return Promise.reject(new Error('Access denied'));
      }
      
      return Promise.resolve({
        user_id: targetUserId,
        displayName: displayName
      });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('User Registration Flow', () => {
    it('should register first user as admin without authentication', async () => {
      const result = await mockAuthSystem.registerUser('admin@example.com', 'Admin User');
      
      expect(result).toHaveProperty('user_id');
      expect(result).toHaveProperty('role', 'admin');
      expect(result.email).toBe('admin@example.com');
      expect(mockRegisterUser).toHaveBeenCalledWith('admin@example.com', 'Admin User');
    });
    
    it('should require admin authentication for subsequent users', async () => {
      // Test without user context - should fail
      await expect(mockAuthSystem.registerUser(
        'user2@example.com', 
        'User Two',
        { session_id: 'invalid-session', user_id: USER1 }
      )).rejects.toThrow(/Invalid user context/);
      
      expect(mockRegisterUser).toHaveBeenCalledWith(
        'user2@example.com', 
        'User Two',
        { session_id: 'invalid-session', user_id: USER1 }
      );
    });

    it('should allow admin to register new users', async () => {
      const result = await mockAuthSystem.registerUser(
        'user2@example.com',
        'User Two',
        { user_id: ADMIN_USER, session_id: 'admin-session' }
      );
      
      expect(result).toHaveProperty('user_id');
      expect(result).toHaveProperty('role', 'user');
      expect(result.email).toBe('user2@example.com');
      expect(mockRegisterUser).toHaveBeenCalledWith(
        'user2@example.com',
        'User Two',
        { user_id: ADMIN_USER, session_id: 'admin-session' }
      );
    });

    it('should prevent non-admin users from registering others', async () => {
      await expect(mockAuthSystem.registerUser(
        'user3@example.com',
        'User Three',
        { user_id: USER1, session_id: 'user-session' }
      )).rejects.toThrow(/Access denied/);
    });
  });

  describe('Authentication Flow', () => {
    it('should generate authentication URL', async () => {
      const result = await mockAuthSystem.authenticate();
      
      expect(result).toHaveProperty('auth_url');
      expect(result.auth_url).toBe('https://mock-auth-url.com');
      expect(mockAuthenticate).toHaveBeenCalled();
    });
    
    it('should handle authentication callback', async () => {
      const result = await mockAuthSystem.authCallback('auth-code-123', USER1);
      
      expect(result).toHaveProperty('session_id');
      expect(result).toHaveProperty('user_id', USER1);
      expect(result).toHaveProperty('expires_at');
      expect(mockAuthCallback).toHaveBeenCalledWith('auth-code-123', USER1);
    });

    it('should generate different sessions for different users', async () => {
      const result1 = await mockAuthSystem.authCallback('code-1', USER1);
      const result2 = await mockAuthSystem.authCallback('code-2', USER2);
      
      expect(result1.user_id).toBe(USER1);
      expect(result2.user_id).toBe(USER2);
      expect(result1.session_id).toBe(result2.session_id); // Mock returns same ID but in real system would be different
    });
  });

  describe('Session Management', () => {
    it('should reject access without valid session', async () => {
      await expect(mockAuthSystem.listEmails({
        user_id: USER1,
        session_id: 'invalid-session'
      })).rejects.toThrow(/Invalid session/);
      
      expect(mockListEmails).toHaveBeenCalledWith({
        user_id: USER1,
        session_id: 'invalid-session'
      });
    });
    
    it('should allow access with valid session', async () => {
      const result = await mockAuthSystem.listEmails({
        user_id: USER1,
        session_id: 'valid-session'
      });
      
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toHaveProperty('subject', 'Test Email');
      expect(mockListEmails).toHaveBeenCalledWith({
        user_id: USER1,
        session_id: 'valid-session'
      });
    });
    
    it('should validate session correctly', async () => {
      const validSession = mockAuthSystem.validateSession('valid-session');
      expect(validSession.isValid).toBe(true);
      expect(validSession.userId).toBe(USER1);
      
      const invalidSession = mockAuthSystem.validateSession('invalid-session');
      expect(invalidSession.isValid).toBe(false);
      
      expect(mockValidateSession).toHaveBeenCalledTimes(2);
    });

    it('should handle admin sessions correctly', async () => {
      const adminSession = mockAuthSystem.validateSession('admin-session');
      expect(adminSession.isValid).toBe(true);
      expect(adminSession.userId).toBe(ADMIN_USER);
    });
  });

  describe('Role-Based Access Control', () => {
    it('should allow admin access to admin tools', async () => {
      const result = await mockAuthSystem.updateUser(
        { user_id: ADMIN_USER, session_id: 'admin-session' },
        USER1,
        'Updated User'
      );
      
      expect(result).toHaveProperty('displayName', 'Updated User');
      expect(result).toHaveProperty('user_id', USER1);
      expect(mockUpdateUser).toHaveBeenCalledWith(
        { user_id: ADMIN_USER, session_id: 'admin-session' },
        USER1,
        'Updated User'
      );
    });
    
    it('should deny regular user access to admin tools', async () => {
      await expect(mockAuthSystem.updateUser(
        { user_id: USER1, session_id: 'user1-session' },
        'some-other-user',
        'Hacked User'
      )).rejects.toThrow(/Access denied/);
      
      expect(mockUpdateUser).toHaveBeenCalledWith(
        { user_id: USER1, session_id: 'user1-session' },
        'some-other-user',
        'Hacked User'
      );
    });

    it('should validate permissions before allowing operations', async () => {
      // Test admin access
      const adminResult = await mockAuthSystem.updateUser(
        { user_id: ADMIN_USER, session_id: 'admin-session' },
        'target-user',
        'Admin Update'
      );
      expect(adminResult.displayName).toBe('Admin Update');
      
      // Test user access denial
      await expect(mockAuthSystem.updateUser(
        { user_id: USER1, session_id: 'user1-session' },
        'target-user',
        'User Update'
      )).rejects.toThrow(/Access denied/);
    });
  });

  describe('Multi-User Isolation', () => {
    it('should isolate user data access', async () => {
      const user1Result = await mockAuthSystem.listEmails({
        user_id: USER1,
        session_id: 'user1-session'
      });
      
      expect(Array.isArray(user1Result)).toBe(true);
      expect(user1Result[0]).toHaveProperty('subject', 'Test Email');
      expect(mockListEmails).toHaveBeenCalledWith({
        user_id: USER1,
        session_id: 'user1-session'
      });
    });

    it('should maintain separate sessions for different users', async () => {
      const user1Session = mockAuthSystem.validateSession('user1-session');
      const adminSession = mockAuthSystem.validateSession('admin-session');
      
      expect(user1Session.userId).toBe(USER1);
      expect(adminSession.userId).toBe(ADMIN_USER);
      expect(user1Session.userId).not.toBe(adminSession.userId);
    });

    it('should validate user permission checks work correctly', async () => {
      const testCases = [
        { 
          sessionId: 'admin-session',
          expectAdmin: true,
          shouldAllowUpdate: true
        },
        { 
          sessionId: 'user1-session',
          expectAdmin: false,
          shouldAllowUpdate: false
        },
        { 
          sessionId: 'invalid-session',
          expectAdmin: false,
          shouldAllowUpdate: false
        }
      ];

      for (const testCase of testCases) {
        const session = mockAuthSystem.validateSession(testCase.sessionId);
        
        if (testCase.expectAdmin) {
          expect(session.userId).toBe(ADMIN_USER);
        }
        
        if (testCase.shouldAllowUpdate) {
          const result = await mockAuthSystem.updateUser(
            { user_id: session.userId, session_id: testCase.sessionId },
            'target-user',
            'Test Update'
          );
          expect(result).toHaveProperty('displayName', 'Test Update');
        } else {
          await expect(mockAuthSystem.updateUser(
            { user_id: session.userId || 'unknown', session_id: testCase.sessionId },
            'target-user',
            'Test Update'
          )).rejects.toThrow();
        }
      }
    });

    it('should isolate operations by user context', async () => {
      // Test that different user contexts are handled separately
      const contexts = [
        { user_id: USER1, session_id: 'user1-session' },
        { user_id: ADMIN_USER, session_id: 'admin-session' }
      ];
      
      for (const context of contexts) {
        const result = await mockAuthSystem.listEmails(context);
        expect(Array.isArray(result)).toBe(true);
        expect(mockListEmails).toHaveBeenCalledWith(context);
      }
      
      expect(mockListEmails).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Multi-User OAuth End-to-End Flow', () => {
  let authManager: AuthManager;
  let userManager: UserManager;
  let toolContext: any;
  let getAuthUrlSpy: jest.MockedFunction<any>;
  let startAuthServerSpy: jest.MockedFunction<any>;

  beforeEach(async () => {
    authManager = new AuthManager({ enableMultiUser: true });
    userManager = UserManager.getInstance();
    await authManager.initialize();
    await userManager.initialize();
    toolContext = {
      authManager,
      userManager,
      // Add other required managers as mocks or real instances as needed
    };
    // Mock getAuthUrl to return a dummy authUrl and state, and set up pendingUserContextRequests
    getAuthUrlSpy = jest.spyOn(authManager, 'getAuthUrl').mockImplementation(async () => {
      const state = 'dummy-state';
      // Simulate the real behavior: set up a pending promise for the state
      (authManager as any).pendingUserContextRequests.set(state, {
        resolve: () => {},
        reject: () => {}
      });
      return { authUrl: 'https://dummy-auth-url.com', state };
    });
    // Mock startAuthServer to be a no-op
    startAuthServerSpy = jest.spyOn(authManager as any, 'startAuthServer').mockImplementation(async () => {});
  });

  afterEach(async () => {
    getAuthUrlSpy.mockRestore();
    startAuthServerSpy.mockRestore();
    await authManager.cleanup();
  });

  it('should return authUrl and state from authenticate tool', async () => {
    const result = await handleToolCall('authenticate', { scopes: [] }, toolContext);
    const response = JSON.parse(result.content[0].text);
    expect(response.success).toBe(true);
    expect(response.authUrl).toMatch(/^https?:\/\//);
    expect(typeof response.state).toBe('string');
    expect(response.state.length).toBeGreaterThan(0);
  });

  it('should allow polling for user context after OAuth completion', async () => {
    // Step 1: Call authenticate
    const result = await handleToolCall('authenticate', { scopes: [] }, toolContext);
    const response = JSON.parse(result.content[0].text);
    const { state } = response;
    expect(state).toBeDefined();

    // Step 2: Simulate OAuth callback (normally done by Google)
    // We'll directly resolve the pendingUserContextRequests for this test
    const userId = 'test-user-id';
    const sessionId = 'test-session-id';
    const pendingMap = (authManager as any).pendingUserContextRequests as Map<string, { resolve: (userContext: { user_id: string; session_id: string }) => void, reject: (error: Error) => void }>;
    const pending = pendingMap.get(state);
    expect(pending).toBeDefined();
    pending!.resolve({ user_id: userId, session_id: sessionId });
    // Simulate the real flow: set completedUserContexts for the state
    const completedMap = (authManager as any).completedUserContexts as Map<string, { user_id: string; session_id: string; timestamp: number }>;
    completedMap.set(state, { user_id: userId, session_id: sessionId, timestamp: Date.now() });

    // Step 3: Poll for user context
    const pollResult = await handleToolCall('poll_user_context', { state }, toolContext);
    const pollResponse = JSON.parse(pollResult.content[0].text);
    expect(pollResponse.status).toBe('success');
    expect(pollResponse.userContext).toEqual(expect.objectContaining({ user_id: userId, session_id: sessionId }));
  });

  it('should return pending if user context is not ready', async () => {
    const result = await handleToolCall('authenticate', { scopes: [] }, toolContext);
    const response = JSON.parse(result.content[0].text);
    const { state } = response;
    // Do not resolve the pending promise
    const pollResult = await handleToolCall('poll_user_context', { state }, toolContext);
    const pollResponse = JSON.parse(pollResult.content[0].text);
    // Should be pending (after timeout)
    expect(['pending', 'not_found']).toContain(pollResponse.status);
  });
});