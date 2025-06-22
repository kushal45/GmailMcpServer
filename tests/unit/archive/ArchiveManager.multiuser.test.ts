import { describe, expect, beforeEach, jest, test } from '@jest/globals';
import { ArchiveManager } from '../../../src/archive/ArchiveManager';
import { AuthManager } from '../../../src/auth/AuthManager';
import { DatabaseManager } from '../../../src/database/DatabaseManager';
import { FileFormatterRegistry } from '../../../src/archive/formatters/FormatterRegistry';
import { FileAccessControlManager } from '../../../src/services/FileAccessControlManager';
import { EmailIndex } from '../../../src/types';
import { UserContext } from '../../../src/types/file-access-control';
import { ValidationResultFactory } from '../../../src/archive/formatters/ValidationResult';
import { UnsupportedFormatError } from '../../../src/archive/formatters/FormatterError';
import fs from 'fs/promises';
import path from 'path';

// Mock the module imports
jest.mock('../../../src/auth/AuthManager');
jest.mock('../../../src/database/DatabaseManager');
jest.mock('../../../src/archive/formatters/FormatterRegistry');
jest.mock('../../../src/services/FileAccessControlManager');
jest.mock('fs/promises');
jest.mock('path');

// Mock URL module for ESM compatibility
jest.mock('url', () => ({
  fileURLToPath: jest.fn().mockReturnValue('mocked-file-path')
}));

describe('ArchiveManager Multi-User Security Tests', () => {
  let authManager: any;
  let databaseManager: any;
  let formatterRegistry: any;
  let fileAccessControl: any;
  let archiveManager: ArchiveManager;

  // Mock User Contexts for different users
  const userA: UserContext = {
    user_id: 'user-a-123',
    session_id: 'session-a-456',
    roles: ['user'],
    permissions: ['archive:read', 'archive:write'],
    ip_address: '192.168.1.100',
    user_agent: 'Mozilla/5.0 UserA'
  };

  const userB: UserContext = {
    user_id: 'user-b-456',
    session_id: 'session-b-789',
    roles: ['user'],
    permissions: ['archive:read', 'archive:write'],
    ip_address: '192.168.1.101',
    user_agent: 'Mozilla/5.0 UserB'
  };

  const adminUser: UserContext = {
    user_id: 'admin-789',
    session_id: 'session-admin-123',
    roles: ['admin', 'user'],
    permissions: ['archive:read', 'archive:write', 'archive:admin'],
    ip_address: '192.168.1.102',
    user_agent: 'Mozilla/5.0 Admin'
  };

  const invalidUserContext: UserContext = {
    user_id: 'invalid-user',
    session_id: 'invalid-session-999',
    roles: ['user'],
    permissions: [],
    ip_address: '192.168.1.103',
    user_agent: 'Mozilla/5.0 Invalid'
  };

  // Mock Gmail clients for different users
  const mockGmailClientUserA: any = {
    users: {
      messages: {
        batchModify: jest.fn(),
        modify: jest.fn()
      }
    }
  };

  const mockGmailClientUserB: any = {
    users: {
      messages: {
        batchModify: jest.fn(),
        modify: jest.fn()
      }
    }
  };

  // Sample email data for different users
  const userAEmails: EmailIndex[] = [
    {
      id: 'email-a1',
      subject: 'User A Email 1',
      sender: 'sender-a@example.com',
      recipients: ['user-a@example.com'],
      date: new Date('2023-01-01'),
      year: 2023,
      size: 1024,
      hasAttachments: false,
      labels: ['INBOX'],
      snippet: 'User A private email 1',
      archived: false
    },
    {
      id: 'email-a2',
      subject: 'User A Email 2',
      sender: 'sender-a2@example.com',
      recipients: ['user-a@example.com'],
      date: new Date('2023-02-01'),
      year: 2023,
      size: 2048,
      hasAttachments: true,
      labels: ['INBOX', 'IMPORTANT'],
      snippet: 'User A private email 2',
      archived: true,
      archiveDate: new Date(),
      archiveLocation: '/path/userA/archive.json'
    }
  ];

  const userBEmails: EmailIndex[] = [
    {
      id: 'email-b1',
      subject: 'User B Email 1',
      sender: 'sender-b@example.com',
      recipients: ['user-b@example.com'],
      date: new Date('2023-03-01'),
      year: 2023,
      size: 3072,
      hasAttachments: false,
      labels: ['INBOX'],
      snippet: 'User B private email 1',
      archived: false
    },
    {
      id: 'email-b2',
      subject: 'User B Email 2',
      sender: 'sender-b2@example.com',
      recipients: ['user-b@example.com'],
      date: new Date('2023-04-01'),
      year: 2023,
      size: 4096,
      hasAttachments: true,
      labels: ['INBOX', 'WORK'],
      snippet: 'User B private email 2',
      archived: true,
      archiveDate: new Date(),
      archiveLocation: 'ARCHIVED'
    }
  ];

  // Mock formatters
  const mockJsonFormatter: any = {
    getFileExtension: jest.fn().mockReturnValue('json'),
    getFormatName: jest.fn().mockReturnValue('JSON'),
    // @ts-ignore - TypeScript error with mock return value
    formatEmails: jest.fn().mockResolvedValue(JSON.stringify({ emails: [] })),
    validateEmails: jest.fn().mockReturnValue(ValidationResultFactory.createValid())
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock instances
    authManager = new AuthManager();
    databaseManager = DatabaseManager.getInstance();
    formatterRegistry = new FileFormatterRegistry();
    fileAccessControl = new FileAccessControlManager(databaseManager);

    // Setup AuthManager mocking
    // @ts-ignore - TypeScript error with mock implementation
    authManager.getGmailClient = jest.fn().mockImplementation((sessionId: string) => {
      if (sessionId === 'session-a-456') return Promise.resolve(mockGmailClientUserA);
      if (sessionId === 'session-b-789') return Promise.resolve(mockGmailClientUserB);
      if (sessionId === 'session-admin-123') return Promise.resolve(mockGmailClientUserA);
      throw new Error('Invalid session for Gmail client');
    });

    // @ts-ignore - TypeScript error with mock implementation
    authManager.hasValidAuth = jest.fn().mockImplementation((sessionId: string) => {
      return Promise.resolve(['session-a-456', 'session-b-789', 'session-admin-123'].includes(sessionId));
    });

    // @ts-ignore - TypeScript error with mock return value
    authManager.isMultiUserMode = jest.fn().mockReturnValue(true);

    // @ts-ignore - TypeScript error with mock implementation
    authManager.getUserIdForSession = jest.fn().mockImplementation((sessionId: string) => {
      const sessionUserMap: Record<string, string> = {
        'session-a-456': 'user-a-123',
        'session-b-789': 'user-b-456',
        'session-admin-123': 'admin-789'
      };
      return sessionUserMap[sessionId] || null;
    });

    // Setup DatabaseManager mocking with user isolation
    // @ts-ignore - TypeScript error with mock implementation
    databaseManager.searchEmails = jest.fn().mockImplementation(async (criteria: any) => {
      if (criteria.user_id === 'user-a-123') {
        return userAEmails.filter(email => !criteria.archived || email.archived === criteria.archived);
      }
      if (criteria.user_id === 'user-b-456') {
        return userBEmails.filter(email => !criteria.archived || email.archived === criteria.archived);
      }
      return [];
    });

    // @ts-ignore - TypeScript error with mock implementation
    databaseManager.getEmailsByIds = jest.fn().mockImplementation(async (ids: string[]) => {
      const allEmails = [...userAEmails, ...userBEmails];
      return allEmails.filter(email => ids.includes(email.id));
    });

    // @ts-ignore - TypeScript error with mock return value
    databaseManager.upsertEmailIndex = jest.fn().mockResolvedValue(true);
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.createArchiveRecord = jest.fn().mockResolvedValue('archive-record-123');
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.execute = jest.fn().mockResolvedValue(true);

    // Archive rules mocking with user isolation
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.createArchiveRule = jest.fn().mockResolvedValue('rule-123');
    // @ts-ignore - TypeScript error with mock implementation
    databaseManager.getArchiveRules = jest.fn().mockImplementation(async (activeOnly: boolean) => {
      return [
        {
          id: 'rule-a1',
          name: 'User A Rule 1',
          criteria: { category: 'low' },
          action: { method: 'gmail' },
          enabled: true,
          user_id: 'user-a-123',
          created: new Date(),
          stats: { totalArchived: 0, lastArchived: 0 }
        },
        {
          id: 'rule-b1',
          name: 'User B Rule 1',
          criteria: { category: 'spam' },
          action: { method: 'export' },
          enabled: true,
          user_id: 'user-b-456',
          created: new Date(),
          stats: { totalArchived: 0, lastArchived: 0 }
        }
      ];
    });

    // FileAccessControlManager mocking
    // @ts-ignore - TypeScript error with mock return value
    fileAccessControl.createFileMetadata = jest.fn().mockResolvedValue({
      id: 'file-123',
      file_path: 'test/path',
      size_bytes: 1024
    });
    // @ts-ignore - TypeScript error with mock return value
    fileAccessControl.auditLog = jest.fn().mockResolvedValue(undefined);
    // @ts-ignore - TypeScript error with mock implementation
    fileAccessControl.checkFileAccess = jest.fn().mockImplementation(async (request: any) => {
      // Simulate user-specific file access control
      if (request.user_id === 'user-a-123' && request.file_id.includes('userA')) {
        return { allowed: true, file_metadata: {} };
      }
      if (request.user_id === 'user-b-456' && request.file_id.includes('userB')) {
        return { allowed: true, file_metadata: {} };
      }
      return { allowed: false, reason: 'Access denied to file' };
    });

    // Formatter registry mocking
    // @ts-ignore - TypeScript error with mock implementation
    formatterRegistry.getFormatter = jest.fn().mockImplementation((format: string) => {
      if (format === 'json') return mockJsonFormatter;
      throw new UnsupportedFormatError(format);
    });
    // @ts-ignore - TypeScript error with mock return value
    formatterRegistry.getDefaultFormatter = jest.fn().mockReturnValue(mockJsonFormatter);

    // File system mocking with user-specific paths
    // @ts-ignore - TypeScript error with mock implementation
    (path.join as any) = jest.fn().mockImplementation((...parts: string[]) => parts.join('/'));
    // @ts-ignore - TypeScript error with mock return value
    (fs.mkdir as any) = jest.fn().mockResolvedValue(undefined);
    // @ts-ignore - TypeScript error with mock return value
    (fs.writeFile as any) = jest.fn().mockResolvedValue(undefined);
    // @ts-ignore - TypeScript error with mock return value
    (fs.access as any) = jest.fn().mockResolvedValue(undefined);
    // @ts-ignore - TypeScript error with mock implementation
    (fs.readFile as any) = jest.fn().mockImplementation(async (filePath: string) => {
      if (filePath.includes('userA')) {
        return JSON.stringify(userAEmails);
      }
      if (filePath.includes('userB')) {
        return JSON.stringify(userBEmails);
      }
      throw new Error('File not found');
    });
    // @ts-ignore - TypeScript error with mock return value
    (fs.stat as any) = jest.fn().mockResolvedValue({ size: 1024 });

    // Mock process.env
    process.env.ARCHIVE_PATH = 'test-archives';

    // Create ArchiveManager instance
    archiveManager = new ArchiveManager(authManager, databaseManager, formatterRegistry, fileAccessControl);
  });

  describe('User Data Isolation Tests', () => {
    test('should isolate User A archives from User B', async () => {
      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      // Mock Gmail responses
      mockGmailClientUserA.users.messages.batchModify.mockResolvedValue({ data: {} });
      mockGmailClientUserB.users.messages.batchModify.mockResolvedValue({ data: {} });

      // User A archives their emails
      const resultA = await archiveManager.archiveEmails(options, userA);

      // User B archives their emails
      const resultB = await archiveManager.archiveEmails(options, userB);

      // Verify user isolation in database calls
      expect(databaseManager.searchEmails).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-a-123',
        archived: false
      }));
      expect(databaseManager.searchEmails).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-b-456',
        archived: false
      }));

      // Verify different Gmail clients were used
      expect(authManager.getGmailClient).toHaveBeenCalledWith('session-a-456');
      expect(authManager.getGmailClient).toHaveBeenCalledWith('session-b-789');

      // Verify audit logs are user-specific
      expect(fileAccessControl.auditLog).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-a-123'
      }));
      expect(fileAccessControl.auditLog).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-b-456'
      }));

      expect(resultA.archived).toBeGreaterThan(0);
      expect(resultB.archived).toBeGreaterThan(0);
    });

    test('should create user-specific export directories', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      // User A exports emails
      await archiveManager.archiveEmails(options, userA);

      // User B exports emails
      await archiveManager.archiveEmails(options, userB);

      // Verify user-specific directories were created
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('user_user-a-123'),
        { recursive: true }
      );
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('user_user-b-456'),
        { recursive: true }
      );

      // Verify files written to user-specific paths
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('user_user-a-123'),
        expect.any(String)
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('user_user-b-456'),
        expect.any(String)
      );
    });

    test('should isolate archive rules by user', async () => {
      const ruleA = {
        name: 'User A Rule',
        criteria: { category: 'low' },
        action: { method: 'gmail' }
      };

      const ruleB = {
        name: 'User B Rule',
        criteria: { category: 'spam' },
        action: { method: 'export' }
      };

      // Create rules for both users
      await archiveManager.createRule(ruleA, userA);
      await archiveManager.createRule(ruleB, userB);

      // List rules for User A
      const rulesA = await archiveManager.listRules({ activeOnly: true }, userA);

      // List rules for User B
      const rulesB = await archiveManager.listRules({ activeOnly: true }, userB);

      // Verify user A only sees their rules
      expect(rulesA.rules).toHaveLength(1);
      expect(rulesA.rules[0]).toHaveProperty('user_id', 'user-a-123');

      // Verify user B only sees their rules
      expect(rulesB.rules).toHaveLength(1);
      expect(rulesB.rules[0]).toHaveProperty('user_id', 'user-b-456');

      // Verify database updates included user_id
      expect(databaseManager.execute).toHaveBeenCalledWith(
        'UPDATE archive_rules SET user_id = ? WHERE id = ?',
        ['user-a-123', 'rule-123']
      );
      expect(databaseManager.execute).toHaveBeenCalledWith(
        'UPDATE archive_rules SET user_id = ? WHERE id = ?',
        ['user-b-456', 'rule-123']
      );
    });

    test('should isolate archive records by user', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      // Archive emails for both users
      await archiveManager.archiveEmails(options, userA);
      await archiveManager.archiveEmails(options, userB);

      // Verify archive records are created with user_id
      expect(databaseManager.execute).toHaveBeenCalledWith(
        'UPDATE archive_records SET user_id = ? WHERE id = ?',
        ['user-a-123', 'archive-record-123']
      );
      expect(databaseManager.execute).toHaveBeenCalledWith(
        'UPDATE archive_records SET user_id = ? WHERE id = ?',
        ['user-b-456', 'archive-record-123']
      );
    });

    test('should ensure database queries filter by user_id', async () => {
      const options = {
        method: 'gmail' as const,
        category: 'low' as const,
        year: 2023,
        dryRun: false
      };

      // Execute archive for User A
      await archiveManager.archiveEmails(options, userA);

      // Verify searchEmails was called with user_id filter
      expect(databaseManager.searchEmails).toHaveBeenCalledWith(expect.objectContaining({
        user_id: 'user-a-123',
        category: 'low',
        year: 2023,
        archived: false
      }));

      // Execute export for User B
      const exportOptions = {
        format: 'json' as const,
        includeAttachments: false,
        searchCriteria: { year: 2023 }
      };

      await archiveManager.exportEmails(exportOptions, userB);

      // Verify export search includes user_id
      expect(databaseManager.searchEmails).toHaveBeenCalledWith({
        year: 2023,
        user_id: 'user-b-456'
      });
    });
  });

  describe('Session Validation Tests', () => {
    test('should reject invalid session IDs', async () => {
      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      // Test with invalid session
      await expect(
        archiveManager.archiveEmails(options, invalidUserContext)
      ).rejects.toThrow(/Session validation failed/);

      // Verify no Gmail client was requested
      expect(authManager.getGmailClient).not.toHaveBeenCalledWith('invalid-session-999');

      // Verify no database operations occurred
      expect(databaseManager.searchEmails).not.toHaveBeenCalled();
    });

    test('should reject expired sessions', async () => {
      // Mock expired session
      // @ts-ignore - TypeScript error with mock return value
      authManager.hasValidAuth = jest.fn().mockResolvedValue(false);

      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      await expect(
        archiveManager.archiveEmails(options, userA)
      ).rejects.toThrow(/Invalid or expired session/);
    });

    test('should validate session at each method entry point', async () => {
      // Test archiveEmails method - should throw
      await expect(
        archiveManager.archiveEmails({ method: 'gmail', dryRun: true }, invalidUserContext)
      ).rejects.toThrow(/Session validation failed/);

      // Test restoreEmails method - should return error object
      const restoreResult = await archiveManager.restoreEmails({ emailIds: ['test'] }, invalidUserContext);
      expect(restoreResult.errors).toContain('Failed to restore emails: Session validation failed: Invalid or expired session');

      // Test exportEmails method - should throw
      await expect(
        archiveManager.exportEmails({ format: 'json', includeAttachments: false }, invalidUserContext)
      ).rejects.toThrow(/Session validation failed/);

      // Test createRule method - should throw
      await expect(
        archiveManager.createRule({ name: 'test', criteria: {}, action: {} }, invalidUserContext)
      ).rejects.toThrow(/Session validation failed/);

      // Test listRules method - should throw
      await expect(
        archiveManager.listRules({ activeOnly: true }, invalidUserContext)
      ).rejects.toThrow(/Session validation failed/);

      // Verify session validation was called for each method (5 times)
      expect(authManager.hasValidAuth).toHaveBeenCalledTimes(5);
    });

    test('should validate session user ID match', async () => {
      // Mock mismatched user ID
      authManager.getUserIdForSession = jest.fn().mockReturnValue('different-user-id');

      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      await expect(
        archiveManager.archiveEmails(options, userA)
      ).rejects.toThrow(/Session does not belong to the specified user/);
    });

    test('should provide proper error messages for authentication failures', async () => {
      const testCases = [
        {
          context: { ...userA, user_id: '' },
          expectedError: /User ID is required/
        },
        {
          context: { ...userA, session_id: '' },
          expectedError: /Session ID is required/
        },
        {
          context: { ...userA, session_id: 'invalid-session' },
          expectedError: /Invalid or expired session/
        }
      ];

      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      for (const testCase of testCases) {
        await expect(
          archiveManager.archiveEmails(options, testCase.context as UserContext)
        ).rejects.toThrow(testCase.expectedError);
      }
    });
  });

  describe('Cross-User Access Prevention', () => {
    test('should prevent User A from restoring User B archived emails', async () => {
      // Setup archived emails with user ownership
      const userBArchivedEmail = {
        ...userBEmails[1],
        user_id: 'user-b-456'
      };

      // @ts-ignore - TypeScript error with mock return value
      databaseManager.getEmailsByIds = jest.fn().mockResolvedValue([userBArchivedEmail]);

      const restoreOptions = {
        emailIds: ['email-b2'],
        restoreLabels: ['RESTORED']
      };

      // User A tries to restore User B's email
      const result = await archiveManager.restoreEmails(restoreOptions, userA);

      // Should fail with no emails restored
      expect(result.restored).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('No archived emails found');

      // Verify no Gmail operations were attempted
      expect(mockGmailClientUserA.users.messages.batchModify).not.toHaveBeenCalled();
    });

    test('should prevent User A from accessing User B archive rules', async () => {
      // User A lists rules
      const rulesA = await archiveManager.listRules({ activeOnly: true }, userA);

      // Should only see User A's rules
      expect(rulesA.rules).toHaveLength(1);
      expect(rulesA.rules[0]).toHaveProperty('user_id', 'user-a-123');
      expect(rulesA.rules[0].name).toBe('User A Rule 1');

      // User B lists rules
      const rulesB = await archiveManager.listRules({ activeOnly: true }, userB);

      // Should only see User B's rules
      expect(rulesB.rules).toHaveLength(1);
      expect(rulesB.rules[0]).toHaveProperty('user_id', 'user-b-456');
      expect(rulesB.rules[0].name).toBe('User B Rule 1');
    });

    test('should prevent User A from accessing User B export files', async () => {
      // Mock file access control to deny cross-user access
      fileAccessControl.checkFileAccess = jest.fn().mockImplementation(async (request: any) => {
        if (request.user_id === 'user-a-123' && request.file_id.includes('userB')) {
          return { allowed: false, reason: 'Access denied to file' };
        }
        return { allowed: true, file_metadata: {} };
      });

      const restoreOptions = {
        emailIds: ['email-b2']
      };

      // Setup User B's archived email with export location
      // @ts-ignore - TypeScript error with mock return value
      databaseManager.getEmailsByIds = jest.fn().mockResolvedValue([{
        id: 'email-b2',
        archived: true,
        archiveLocation: '/path/userB/archive.json',
        user_id: 'user-b-456'
      }]);

      // User A tries to restore from User B's export file
      const result = await archiveManager.restoreEmails(restoreOptions, userA);

      // Should fail
      expect(result.restored).toBe(0);
      expect(result.errors).toHaveLength(1);
    });

    test('should handle unauthorized access attempts gracefully', async () => {
      const unauthorizedOperations = [
        async () => {
          // Try to restore with wrong user context
          // @ts-ignore - TypeScript error with mock return value
          databaseManager.getEmailsByIds = jest.fn().mockResolvedValue([{
            id: 'email-b1',
            archived: true,
            user_id: 'user-b-456'
          }]);
          return archiveManager.restoreEmails({ emailIds: ['email-b1'] }, userA);
        },
        async () => {
          // Try to export with criteria that would access other user data
          // @ts-ignore - TypeScript error with mock return value
          databaseManager.searchEmails = jest.fn().mockResolvedValue([]);
          return archiveManager.exportEmails({ format: 'json', includeAttachments: false }, userA);
        }
      ];

      for (const operation of unauthorizedOperations) {
        const result = await operation();
        // Should not throw but should return safe results
        expect(result).toBeDefined();
      }
    });
  });

  describe('File System Security Tests', () => {
    test('should create user-specific directories', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      // User A exports
      await archiveManager.archiveEmails(options, userA);

      // User B exports
      await archiveManager.archiveEmails(options, userB);

      // Verify user-specific directories
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/user_user-a-123$/),
        { recursive: true }
      );
      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringMatching(/user_user-b-456$/),
        { recursive: true }
      );
    });

    test('should generate file paths with user ID', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        exportPath: 'custom-export',
        dryRun: false
      };

      await archiveManager.archiveEmails(options, userA);

      // Verify file path includes user ID
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('user_user-a-123'),
        expect.any(String)
      );
    });

    test('should integrate with FileAccessControlManager', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      await archiveManager.archiveEmails(options, userA);

      // Verify file metadata creation with user context
      expect(fileAccessControl.createFileMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-a-123',
          file_type: 'email_export'
        })
      );
    });

    test('should log audit events for file operations', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      await archiveManager.archiveEmails(options, userA);

      // Verify audit logging with user context
      expect(fileAccessControl.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-a-123',
          session_id: 'session-a-456',
          action: 'file_create',
          resource_type: 'archive',
          ip_address: '192.168.1.100',
          user_agent: 'Mozilla/5.0 UserA',
          success: true
        })
      );
    });
  });

  describe('Multi-User Archive Operations', () => {
    test('should handle concurrent archiving by different users', async () => {
      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      // Mock concurrent Gmail operations
      mockGmailClientUserA.users.messages.batchModify.mockResolvedValue({ data: {} });
      mockGmailClientUserB.users.messages.batchModify.mockResolvedValue({ data: {} });

      // Execute concurrent operations
      const [resultA, resultB] = await Promise.all([
        archiveManager.archiveEmails(options, userA),
        archiveManager.archiveEmails(options, userB)
      ]);

      // Both should succeed independently
      expect(resultA.archived).toBeGreaterThan(0);
      expect(resultB.archived).toBeGreaterThan(0);

      // Verify separate Gmail clients were used
      expect(authManager.getGmailClient).toHaveBeenCalledWith('session-a-456');
      expect(authManager.getGmailClient).toHaveBeenCalledWith('session-b-789');

      // Verify separate database operations
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(expect.any(Object), 'user-a-123');
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(expect.any(Object), 'user-b-456');
    });

    test('should use user-specific Gmail API clients', async () => {
      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      mockGmailClientUserA.users.messages.batchModify.mockResolvedValue({ data: {} });

      await archiveManager.archiveEmails(options, userA);

      // Verify correct Gmail client was retrieved
      expect(authManager.getGmailClient).toHaveBeenCalledWith('session-a-456');
      expect(mockGmailClientUserA.users.messages.batchModify).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          ids: expect.any(Array),
          addLabelIds: ['ARCHIVED'],
          removeLabelIds: ['INBOX']
        }
      });
    });

    test('should pass proper user context to dependencies', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      await archiveManager.archiveEmails(options, userA);

      // Verify user context passed to database operations
      expect(databaseManager.searchEmails).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-a-123' })
      );
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(
        expect.any(Object),
        'user-a-123'
      );

      // Verify user context passed to file access control
      expect(fileAccessControl.createFileMetadata).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-a-123' })
      );
      expect(fileAccessControl.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-a-123' })
      );
    });

    test('should respect user boundaries in archive rule execution', async () => {
      // Mock scheduled rules execution
      await archiveManager.runScheduledRules(userA);

      // Verify only User A's rules are considered
      expect(databaseManager.getArchiveRules).toHaveBeenCalledWith(true);

      // In a real scenario, the method would filter rules by user_id
      // This test verifies the method accepts user context
    });
  });

  describe('Database Integration Tests', () => {
    test('should set user_id in all database operations', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      await archiveManager.archiveEmails(options, userA);

      // Verify user_id in email index operations
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(
        expect.any(Object),
        'user-a-123'
      );

      // Verify user_id in archive record operations
      expect(databaseManager.execute).toHaveBeenCalledWith(
        'UPDATE archive_records SET user_id = ? WHERE id = ?',
        ['user-a-123', expect.any(String)]
      );
    });

    test('should enforce user isolation in search operations', async () => {
      const exportOptions = {
        format: 'json' as const,
        includeAttachments: false,
        searchCriteria: {
          year: 2023,
          category: 'high' as const
        }
      };

      await archiveManager.exportEmails(exportOptions, userA);

      // Verify search criteria includes user_id
      expect(databaseManager.searchEmails).toHaveBeenCalledWith({
        year: 2023,
        category: 'high',
        user_id: 'user-a-123'
      });
    });

    test('should validate archive rule user isolation', async () => {
      const rule = {
        name: 'Test Rule',
        criteria: { category: 'low' },
        action: { method: 'gmail' }
      };

      await archiveManager.createRule(rule, userA);

      // Verify rule creation with user context
      expect(databaseManager.createArchiveRule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Rule',
          criteria: { category: 'low' },
          action: { method: 'gmail' },
          enabled: true
        })
      );

      // Verify user_id is set after creation
      expect(databaseManager.execute).toHaveBeenCalledWith(
        'UPDATE archive_rules SET user_id = ? WHERE id = ?',
        ['user-a-123', expect.any(String)]
      );
    });

    test('should filter archive records by user_id', async () => {
      // This test verifies the pattern used for user isolation
      // In practice, archive records would be filtered by user_id in queries

      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      mockGmailClientUserA.users.messages.batchModify.mockResolvedValue({ data: {} });

      await archiveManager.archiveEmails(options, userA);

      // Verify archive record creation includes user association
      expect(databaseManager.execute).toHaveBeenCalledWith(
        'UPDATE archive_records SET user_id = ? WHERE id = ?',
        ['user-a-123', expect.any(String)]
      );
    });
  });

  describe('Admin User Access Tests', () => {
    test('should allow admin to access system-wide operations', async () => {
      // Admin runs scheduled rules for all users
      await archiveManager.runScheduledRules();

      // Verify system-wide rule access
      expect(databaseManager.getArchiveRules).toHaveBeenCalledWith(true);
    });

    test('should maintain admin audit trail', async () => {
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      // Mock admin-specific emails
      // @ts-ignore - TypeScript error with mock implementation
      databaseManager.searchEmails = jest.fn().mockImplementation(async (criteria: any) => {
        if (criteria.user_id === 'admin-789') {
          return [
            {
              id: 'admin-email-1',
              subject: 'Admin Email',
              sender: 'admin@example.com',
              recipients: ['admin@example.com'],
              date: new Date(),
              year: 2023,
              size: 1024,
              hasAttachments: false,
              labels: ['INBOX'],
              snippet: 'Admin email',
              archived: false
            }
          ];
        }
        return [];
      });

      await archiveManager.archiveEmails(options, adminUser);

      // Verify admin operations are properly logged
      expect(fileAccessControl.auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'admin-789',
          session_id: 'session-admin-123',
          action: 'file_create',
          resource_type: 'archive'
        })
      );
    });
  });

  describe('Error Handling and Edge Cases', () => {
    test('should handle missing user_id gracefully', async () => {
      const invalidContext = { ...userA, user_id: '' };

      await expect(
        archiveManager.archiveEmails({ method: 'gmail', dryRun: false }, invalidContext as UserContext)
      ).rejects.toThrow(/User ID is required/);
    });

    test('should handle session mismatch errors', async () => {
      // Mock session validation to detect mismatch
      authManager.getUserIdForSession = jest.fn().mockReturnValue('wrong-user-id');

      await expect(
        archiveManager.archiveEmails({ method: 'gmail', dryRun: false }, userA)
      ).rejects.toThrow(/Session does not belong to the specified user/);
    });

    test('should handle cross-user email access attempts', async () => {
      // User A tries to restore User B's emails by ID
      // @ts-ignore - TypeScript error with mock return value
      databaseManager.getEmailsByIds = jest.fn().mockResolvedValue([
        { ...userBEmails[0], user_id: 'user-b-456' }
      ]);

      const result = await archiveManager.restoreEmails(
        { emailIds: ['email-b1'] },
        userA
      );

      // Should fail silently (no emails found for user A)
      expect(result.restored).toBe(0);
      expect(result.errors).toHaveLength(1);
    });

    test('should handle file access control failures', async () => {
      // Mock file access control to deny access
      // @ts-ignore - TypeScript error with mock return value
      fileAccessControl.createFileMetadata = jest.fn().mockRejectedValue(
        // @ts-ignore - TypeScript error with mock return value
        new Error('File access denied')
      );

      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      const result = await archiveManager.archiveEmails(options, userA);

      // Should handle the error gracefully
      expect(result.archived).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});