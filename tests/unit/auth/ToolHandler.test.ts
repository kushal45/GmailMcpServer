import {
  jest,
  describe,
  expect,
  beforeEach,
} from "@jest/globals";
import { handleToolCall } from '../../../src/tools/handler.js';

// Mock the MCP SDK to avoid ES module issues
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  McpError: class McpError extends Error {
    constructor(public code: number, message: string) {
      super(message);
      this.name = 'McpError';
    }
  },
  ErrorCode: {
    InvalidRequest: -32600,
    MethodNotFound: -32601,
    InvalidParams: -32602,
    InternalError: -32603
  }
}));

// Mock dependencies
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

describe('User Context Validation in Tool Handler', () => {
  // Mock session data
  const mockSessionData = {
    sessionId: 'session-123',
    userId: 'user-1',
    created: new Date(),
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    lastAccessed: new Date(),
    isValid: true
  };
  
  // Mock session
  const mockSession = {
    getSessionData: jest.fn().mockReturnValue(mockSessionData),
    isValid: jest.fn().mockReturnValue(true),
    extendSession: jest.fn()
  };
  
  // Mock user manager with all required methods
  const mockUserManager = {
    getSession: jest.fn<any>().mockReturnValue(mockSession),
    getAllUsers: jest.fn<any>().mockReturnValue([]),
    getUserById: jest.fn<any>().mockReturnValue(null),
    createUser: jest.fn<any>().mockResolvedValue({ userId: 'new-user' }),
    updateUser: jest.fn<any>().mockResolvedValue({}),
    createSession: jest.fn<any>().mockResolvedValue(mockSession),
    invalidateSession: jest.fn<any>()
  };
  
  // Mock context with minimal implementation needed for tests
  const mockContext = {
    userManager: mockUserManager,
    authManager: {
      getAuthUrl: jest.fn<any>().mockResolvedValue('https://example.com/auth'),
      hasValidAuth: jest.fn<any>().mockResolvedValue(true)
    },
    emailFetcher: {
      listEmails: jest.fn<any>().mockResolvedValue([])
    }
  } as any;
  
  beforeEach(() => {
    jest.clearAllMocks();
  });
  
  describe('User Context Validation', () => {
    test('should throw error when user context is missing', async () => {
      // Arrange
      const toolName = 'list_emails'; // This tool requires validation
      const args = { param1: 'value1' }; // No user_context
      
      // Act & Assert
      await expect(handleToolCall(toolName, args, mockContext))
        .rejects.toThrow(/Invalid user context/);
    });
    
    test('should throw error when user_id is missing in user context', async () => {
      // Arrange
      const toolName = 'list_emails';
      const args = { 
        user_context: { session_id: 'session-123' }, // Missing user_id
        param1: 'value1'
      };
      
      // Act & Assert
      await expect(handleToolCall(toolName, args, mockContext))
        .rejects.toThrow(/Invalid user context/);
    });
    
    test('should throw error when session_id is missing in user context', async () => {
      // Arrange
      const toolName = 'list_emails';
      const args = { 
        user_context: { user_id: 'user-1' }, // Missing session_id
        param1: 'value1'
      };
      
      // Act & Assert
      await expect(handleToolCall(toolName, args, mockContext))
        .rejects.toThrow(/Invalid user context/);
    });
    
    test('should throw error when session does not exist', async () => {
      // Arrange
      const toolName = 'list_emails';
      const args = { 
        user_context: { user_id: 'user-1', session_id: 'invalid-session' },
        param1: 'value1'
      };
      
      // Mock non-existent session
      mockUserManager.getSession.mockReturnValueOnce(null);
      
      // Act & Assert
      await expect(handleToolCall(toolName, args, mockContext))
        .rejects.toThrow(/Invalid session/);
    });
    
    test('should throw error when session user_id does not match', async () => {
      // Arrange
      const toolName = 'list_emails';
      const args = { 
        user_context: { user_id: 'different-user', session_id: 'session-123' },
        param1: 'value1'
      };
      
      // Act & Assert
      await expect(handleToolCall(toolName, args, mockContext))
        .rejects.toThrow(/Invalid session for this user/);
    });
    
    test('should throw error when session is invalid', async () => {
      // Arrange
      const toolName = 'list_emails';
      const args = { 
        user_context: { user_id: 'user-1', session_id: 'session-123' },
        param1: 'value1'
      };
      
      // Mock invalid session
      mockSession.isValid.mockReturnValueOnce(false);
      
      // Act & Assert
      await expect(handleToolCall(toolName, args, mockContext))
        .rejects.toThrow(/Invalid session for this user/);
    });
    
    test('should call extendSession when validation succeeds', async () => {
      // Arrange
      const toolName = 'list_emails';
      const args = { 
        user_context: { user_id: 'user-1', session_id: 'session-123' }
      };
      
      try {
        // Act
        await handleToolCall(toolName, args, mockContext);
      } catch (error) {
        // We don't care about errors after validation
      }
      
      // Assert
      expect(mockUserManager.getSession).toHaveBeenCalledWith('session-123');
      expect(mockSession.getSessionData).toHaveBeenCalled();
      expect(mockSession.isValid).toHaveBeenCalled();
      expect(mockSession.extendSession).toHaveBeenCalled();
    });
  });

  describe('Authentication Exemption', () => {
    test('should skip validation for authenticate tool', async () => {
      // Arrange
      const toolName = 'authenticate';
      const args = { scopes: [] }; // No user_context
      
      // Act
      await handleToolCall(toolName, args, mockContext);
      
      // Assert
      expect(mockUserManager.getSession).not.toHaveBeenCalled(); // Validation bypassed
      expect(mockSession.extendSession).not.toHaveBeenCalled();
    });
    
    test('should skip validation for register_user tool (first user)', async () => {
      // Arrange
      const toolName = 'register_user';
      const args = { email: 'user@example.com', display_name: 'Test User' }; // No user_context
      
      // Mock first user scenario
      mockUserManager.getAllUsers.mockReturnValueOnce([]);
      
      // Act
      await handleToolCall(toolName, args, mockContext);
      
      // Assert
      expect(mockUserManager.getSession).not.toHaveBeenCalled(); // Validation bypassed
      expect(mockSession.extendSession).not.toHaveBeenCalled();
      expect(mockUserManager.createUser).toHaveBeenCalled();
    });
    
    test('should require validation for register_user tool (subsequent users)', async () => {
      // Arrange
      const toolName = 'register_user';
      const args = {
        user_context: { user_id: 'admin-1', session_id: 'admin-session' },
        email: 'user2@example.com',
        display_name: 'Test User 2'
      };
      
      // Update mock session data to match the admin user
      mockSessionData.userId = 'admin-1';
      mockSessionData.sessionId = 'admin-session';
      
      // Mock existing users (not first user)
      mockUserManager.getAllUsers.mockReturnValueOnce([{ userId: 'existing-user' }]);
      
      // Mock an admin user
      const adminUser = { userId: 'admin-1', role: 'admin' };
      mockUserManager.getUserById.mockReturnValueOnce(adminUser);
      
      // Update the session mock to return the admin session
      mockUserManager.getSession.mockReturnValueOnce(mockSession);
      
      // Act
      await handleToolCall(toolName, args, mockContext);
      
      // Assert
      expect(mockUserManager.getSession).toHaveBeenCalled(); // Validation should occur
      expect(mockSession.extendSession).toHaveBeenCalled();
      expect(mockUserManager.createUser).toHaveBeenCalled();
    });
  });
});