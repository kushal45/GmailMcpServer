import { describe, expect, beforeEach, jest, test } from '@jest/globals';
// Import ArchiveManager properly
import { ArchiveManager } from '../../../src/archive/ArchiveManager';
import { AuthManager } from '../../../src/auth/AuthManager';
import { DatabaseManager } from '../../../src/database/DatabaseManager';
import { FileFormatterRegistry } from '../../../src/archive/formatters/FormatterRegistry';
import { IFileFormatter } from '../../../src/archive/formatters/IFileFormatter';
import { ValidationResultFactory } from '../../../src/archive/formatters/ValidationResult';
import { UnsupportedFormatError, FormatterError } from '../../../src/archive/formatters/FormatterError';
import { FileAccessControlManager } from '../../../src/services/FileAccessControlManager';
import { UserManager } from '../../../src/auth/UserManager';
import { EmailIndex } from '../../../src/types';
import { UserContext } from '../../../src/types/file-access-control';
import fs from 'fs/promises';
import path from 'path';

// Mock the module imports to prevent issues with ES modules
jest.mock('../../../src/auth/AuthManager');
jest.mock('../../../src/database/DatabaseManager');
jest.mock('../../../src/archive/formatters/FormatterRegistry');
jest.mock('../../../src/services/FileAccessControlManager');
jest.mock('../../../src/auth/UserManager');
jest.mock('fs/promises');
jest.mock('path');

// Mock the URL module properly for ESM compatibility
jest.mock('url', () => {
  return {
    fileURLToPath: jest.fn().mockReturnValue('mocked-file-path')
  };
});

describe('ArchiveManager', () => {
  // Mock instances with 'any' type to avoid TypeScript errors
  let authManager: any;
  let databaseManager: any;
  let formatterRegistry: any;
  let fileAccessControl: any;
  let userManager: any;
  let archiveManager: ArchiveManager;

  // Mock UserContext for tests
  const mockUserContext: UserContext = {
    user_id: 'test-user-123',
    session_id: 'test-session-456',
    roles: ['user'],
    permissions: ['archive:read', 'archive:write'],
    ip_address: '127.0.0.1',
    user_agent: 'test-agent'
  };

  const mockUserContext2: UserContext = {
    user_id: 'test-user-456',
    session_id: 'test-session-789',
    roles: ['user'],
    permissions: ['archive:read', 'archive:write'],
    ip_address: '192.168.1.1',
    user_agent: 'test-agent-2'
  };

  // Mock Gmail client
  const mockGmailClient: any = {
    users: {
      messages: {
        batchModify: jest.fn(),
        modify: jest.fn()
      }
    }
  };

  // Sample email data
  const sampleEmails: EmailIndex[] = [
    {
      id: 'email1',
      subject: 'Test Email 1',
      sender: 'sender1@example.com',
      recipients: ['recipient1@example.com'],
      date: new Date('2023-01-01'),
      year: 2023,
      size: 1024,
      hasAttachments: false,
      labels: ['INBOX'],
      snippet: 'This is a test email 1',
      archived: false
    },
    {
      id: 'email2',
      subject: 'Test Email 2',
      sender: 'sender2@example.com',
      recipients: ['recipient2@example.com'],
      date: new Date('2023-02-01'),
      year: 2023,
      size: 2048,
      hasAttachments: true,
      labels: ['INBOX', 'IMPORTANT'],
      snippet: 'This is a test email 2',
      archived: false
    }
  ];

  // Mock formatters with 'any' type to avoid TypeScript errors
  const mockJsonFormatter: any = {
    // @ts-ignore - TypeScript error with mock return value
    getFileExtension: jest.fn().mockReturnValue('json'),
    // @ts-ignore - TypeScript error with mock return value
    getFormatName: jest.fn().mockReturnValue('JSON'),
    // @ts-ignore - TypeScript error with mock return value
    formatEmails: jest.fn().mockResolvedValue(JSON.stringify({ emails: sampleEmails })),
    // @ts-ignore - TypeScript error with mock return value
    validateEmails: jest.fn().mockReturnValue(ValidationResultFactory.createValid())
  };

  const mockMboxFormatter: any = {
    // @ts-ignore - TypeScript error with mock return value
    getFileExtension: jest.fn().mockReturnValue('mbox'),
    // @ts-ignore - TypeScript error with mock return value
    getFormatName: jest.fn().mockReturnValue('Mbox'),
    // @ts-ignore - TypeScript error with mock return value
    formatEmails: jest.fn().mockResolvedValue('From sender@example.com Date\nSubject: Test\n\nTest content'),
    // @ts-ignore - TypeScript error with mock return value
    validateEmails: jest.fn().mockReturnValue(ValidationResultFactory.createValid())
  };

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock instances
    authManager = new AuthManager();
    databaseManager = DatabaseManager.getInstance();
    formatterRegistry = new FileFormatterRegistry();
    fileAccessControl = new FileAccessControlManager(databaseManager);
    userManager = new UserManager();

    // Setup auth manager mock
    // @ts-ignore - TypeScript error with mock return value
    authManager.getGmailClient = jest.fn().mockResolvedValue(mockGmailClient);
    // @ts-ignore - TypeScript error with mock return value
    authManager.hasValidAuth = jest.fn().mockResolvedValue(true);
    // @ts-ignore - TypeScript error with mock return value
    authManager.isMultiUserMode = jest.fn().mockReturnValue(true);
    // @ts-ignore - TypeScript error with mock return value
    authManager.getUserIdForSession = jest.fn().mockImplementation((sessionId: string) => {
      if (sessionId === 'test-session-456') return 'test-user-123';
      if (sessionId === 'test-session-789') return 'test-user-456';
      return null;
    });

    // Setup database manager mock
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.searchEmails = jest.fn().mockResolvedValue(sampleEmails);
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.upsertEmailIndex = jest.fn().mockResolvedValue(true);
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.createArchiveRecord = jest.fn().mockResolvedValue('archive1');
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.execute = jest.fn().mockResolvedValue(true);
    // @ts-ignore - TypeScript error with mock implementation
    databaseManager.getEmailsByIds = jest.fn().mockImplementation(async (ids: string[]) => {
      return sampleEmails.filter(email => ids.includes(email.id));
    });
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.createArchiveRule = jest.fn().mockResolvedValue('rule1');
    // @ts-ignore - TypeScript error with mock return value
    databaseManager.getArchiveRules = jest.fn().mockResolvedValue([
      {
        id: 'rule1',
        name: 'Test Rule',
        criteria: { category: 'low', olderThanDays: 30 },
        action: { method: 'gmail' },
        enabled: true,
        created: new Date(),
        stats: { totalArchived: 0, lastArchived: 0 }
      }
    ]);

    // Setup file access control mock
    // @ts-ignore - TypeScript error with mock return value
    fileAccessControl.createFileMetadata = jest.fn().mockResolvedValue({
      id: 'file-123',
      file_path: 'test/path',
      size_bytes: 1024
    });
    // @ts-ignore - TypeScript error with mock return value
    fileAccessControl.auditLog = jest.fn().mockResolvedValue(undefined);

    // Setup formatter registry mock
    // @ts-ignore - TypeScript error with mock implementation
    formatterRegistry.getFormatter = jest.fn().mockImplementation((format: string) => {
      if (format === 'json') return mockJsonFormatter;
      if (format === 'mbox') return mockMboxFormatter;
      throw new UnsupportedFormatError(format);
    });
    // @ts-ignore - TypeScript error with mock return value
    formatterRegistry.getDefaultFormatter = jest.fn().mockReturnValue(mockJsonFormatter);
    // @ts-ignore - TypeScript error with mock return value
    formatterRegistry.getSupportedFormats = jest.fn().mockReturnValue(['json', 'mbox']);

    // Mock path and fs - use type assertion to avoid TypeScript errors
    // @ts-ignore - TypeScript error with mock implementation
    (path.join as any) = jest.fn().mockImplementation((...parts: string[]) => parts.join('/'));
    // @ts-ignore - TypeScript error with mock return value
    (fs.mkdir as any) = jest.fn().mockResolvedValue(undefined);
    // @ts-ignore - TypeScript error with mock return value
    (fs.writeFile as any) = jest.fn().mockResolvedValue(undefined);
    // @ts-ignore - TypeScript error with mock return value
    (fs.access as any) = jest.fn().mockResolvedValue(undefined);
    // @ts-ignore - TypeScript error with mock return value
    (fs.readFile as any) = jest.fn().mockResolvedValue(JSON.stringify(sampleEmails));
    // @ts-ignore - TypeScript error with mock return value
    (fs.stat as any) = jest.fn().mockResolvedValue({ size: 1024 });

    // Mock process.env for archivePath
    process.env.ARCHIVE_PATH = 'test-archives';

    // Create archive manager instance
    archiveManager = new ArchiveManager(authManager, databaseManager, formatterRegistry, fileAccessControl);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('archiveEmails', () => {
    test('should archive emails to Gmail successfully', async () => {
      // Setup
      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      // Mock Gmail API response
      // @ts-ignore - TypeScript error with mock return value
      mockGmailClient.users.messages.batchModify.mockResolvedValueOnce({ data: {} });

      // Execute
      const result = await archiveManager.archiveEmails(options, mockUserContext);

      // Verify
      expect(result.archived).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(databaseManager.searchEmails).toHaveBeenCalledWith(expect.objectContaining({
        archived: false,
        user_id: 'test-user-123'
      }));
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          ids: ['email1', 'email2'],
          addLabelIds: ['ARCHIVED'],
          removeLabelIds: ['INBOX']
        }
      });
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledTimes(2);
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(expect.any(Object), 'test-user-123');
      expect(databaseManager.createArchiveRecord).toHaveBeenCalledWith(expect.objectContaining({
        emailIds: ['email1', 'email2'],
        method: 'gmail',
        restorable: true
      }));
    });

    test('should export emails to file successfully', async () => {
      // Setup
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      // Execute
      const result = await archiveManager.archiveEmails(options, mockUserContext);

      // Verify
      expect(result.archived).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.location).toBeDefined();
      expect(databaseManager.searchEmails).toHaveBeenCalledWith(expect.objectContaining({
        archived: false,
        user_id: 'test-user-123'
      }));
      expect(formatterRegistry.getFormatter).toHaveBeenCalledWith('json');
      expect(mockJsonFormatter.formatEmails).toHaveBeenCalledWith(sampleEmails, expect.any(Object));
      expect(fs.writeFile).toHaveBeenCalled();
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledTimes(2);
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(expect.any(Object), 'test-user-123');
      expect(databaseManager.createArchiveRecord).toHaveBeenCalledWith(expect.objectContaining({
        emailIds: ['email1', 'email2'],
        method: 'export',
        format: 'json',
        restorable: true
      }));
    });

    test('should handle dry run mode correctly', async () => {
      // Setup
      const options = {
        method: 'gmail' as const,
        dryRun: true
      };

      // Execute
      const result = await archiveManager.archiveEmails(options, mockUserContext);

      // Verify
      expect(result.archived).toBe(2);
      expect(result.errors).toHaveLength(0);
      expect(result.location).toContain('DRY RUN');
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
      expect(databaseManager.upsertEmailIndex).not.toHaveBeenCalled();
      expect(databaseManager.createArchiveRecord).not.toHaveBeenCalled();
    });

    test('should handle Gmail API errors gracefully', async () => {
      // Setup
      const options = {
        method: 'gmail' as const,
        dryRun: false
      };

      // Mock Gmail API error
      mockGmailClient.users.messages.batchModify.mockRejectedValueOnce(new Error('Failed to archive batch'));

      // Execute
      const result = await archiveManager.archiveEmails(options, mockUserContext);

      // Verify
      expect(result.archived).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to archive batch');
      expect(databaseManager.upsertEmailIndex).not.toHaveBeenCalled();
      expect(databaseManager.createArchiveRecord).not.toHaveBeenCalled();
    });

    test('should handle formatter errors gracefully', async () => {
      // Setup
      const options = {
        method: 'export' as const,
        exportFormat: 'json' as const,
        dryRun: false
      };

      // Mock formatter error
      // @ts-ignore - TypeScript error with mock return value
      mockJsonFormatter.formatEmails.mockRejectedValueOnce(
        new FormatterError('FORMAT_ERROR', 'Failed to format emails')
      );

      // Execute
      const result = await archiveManager.archiveEmails(options, mockUserContext);

      // Verify
      expect(result.archived).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Export failed');
      expect(fs.writeFile).not.toHaveBeenCalled();
      expect(databaseManager.upsertEmailIndex).not.toHaveBeenCalled();
      expect(databaseManager.createArchiveRecord).not.toHaveBeenCalled();
    });

    test('should handle unsupported export format', async () => {
      // Setup
      const options = {
        method: 'export' as const,
        exportFormat: 'csv' as const,
        dryRun: false
      };

      // Mock unsupported format error
      // @ts-ignore - TypeScript error with mock implementation
      formatterRegistry.getFormatter.mockImplementationOnce((format: string) => {
        if (format === 'json') return mockJsonFormatter;
        if (format === 'mbox') return mockMboxFormatter;
        throw new UnsupportedFormatError(format);
      });

      // Execute
      const result = await archiveManager.archiveEmails(options, mockUserContext);

      // Verify
      expect(result.archived).toBe(2); // Should still archive using the default formatter
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('not supported');
      expect(formatterRegistry.getDefaultFormatter).toHaveBeenCalled();
      expect(mockJsonFormatter.formatEmails).toHaveBeenCalled();
    });

    test('should filter emails based on criteria', async () => {
      // Setup
      const options = {
        method: 'gmail' as const,
        category: 'low' as const,
        year: 2023,
        olderThanDays: 30,
        dryRun: false
      };

      // Execute
      await archiveManager.archiveEmails(options, mockUserContext);

      // Verify
      expect(databaseManager.searchEmails).toHaveBeenCalledWith(expect.objectContaining({
        category: 'low',
        year: 2023,
        archived: false,
        user_id: 'test-user-123'
      }));
      // The dateBefore field is dynamically calculated, so we don't check it exactly
      expect(databaseManager.searchEmails).toHaveBeenCalledWith(
        expect.objectContaining({
          dateBefore: expect.any(Date)
        })
      );
    });
  });

  describe('restoreEmails', () => {
    beforeEach(() => {
      // Setup mock archived emails
      const archivedEmails = sampleEmails.map(email => ({
        ...email,
        archived: true,
        archiveDate: new Date(),
      }));
      
      // Email 1 archived via Gmail
      archivedEmails[0].archiveLocation = 'ARCHIVED';
      
      // Email 2 archived via export
      archivedEmails[1].archiveLocation = '/path/to/archive.json';
      
      // @ts-ignore - TypeScript error with mock return value
      databaseManager.getEmailsByIds = jest.fn().mockResolvedValue(archivedEmails);
    });

    test('should restore Gmail-archived emails successfully', async () => {
      // Setup
      const options = {
        emailIds: ['email1'],
        restoreLabels: ['INBOX', 'RESTORED']
      };

      // Mock Gmail API response
      // @ts-ignore - TypeScript error with mock return value
      mockGmailClient.users.messages.batchModify.mockResolvedValueOnce({ data: {} });

      databaseManager.getEmailsByIds.mockResolvedValueOnce([
        {
          id: 'email1',
          archived: true,
          archiveDate: new Date(),
          archiveLocation: 'ARCHIVED',
          user_id: 'test-user-123'
        }
      ]);
      // Execute
      const result = await archiveManager.restoreEmails(options, mockUserContext);

      // Verify
      expect(result.restored).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          ids: ['email1'],
          addLabelIds: ['INBOX', 'RESTORED'],
          removeLabelIds: ['ARCHIVED']
        }
      });
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledTimes(1);
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(expect.objectContaining({
        id: 'email1',
        archived: false,
        archiveDate: undefined,
        archiveLocation: undefined,
        labels: expect.arrayContaining(['INBOX', 'RESTORED'])
      }), 'test-user-123');
    });

    test("should restore exported emails from  archived file successfully", async () => {
      // Setup
      const options = {
        emailIds: ['email2'],
        restoreLabels: ['INBOX', 'RESTORED']
      };

      // Mock Gmail API response
      mockGmailClient.users.messages.batchModify.mockResolvedValueOnce({ data: {} });
      databaseManager.getEmailsByIds.mockResolvedValueOnce([
        {
          id: 'email2',
          archived: true,
          archiveDate: new Date(),
          archiveLocation: '/path/to/archive.json',
          user_id: 'test-user-123'
        }
      ]);
      const result = await archiveManager.restoreEmails(options, mockUserContext);
      // Verify
      expect(result.restored).toBe(1);
      expect(result.errors).toHaveLength(0);
      // check for file location restored
      expect(result.restored).toBe(1);
      expect(fs.readFile).toHaveBeenCalledWith('/path/to/archive.json', 'utf8');

    });
    test('should restore exported emails successfully', async () => {
      // Setup
      const options = {
        emailIds: ['email2'],
        restoreLabels: ['INBOX', 'RESTORED']
      };

      // Mock Gmail API response
      // @ts-ignore - TypeScript error with mock return value
      mockGmailClient.users.messages.batchModify.mockResolvedValueOnce({ data: {} });

      // Execute
      databaseManager.getEmailsByIds.mockResolvedValueOnce([
        {
          id: 'email2',
          archived: true,
          archiveDate: new Date(),
          archiveLocation: 'ARCHIVED',
          user_id: 'test-user-123'
        }
      ]);
      const result = await archiveManager.restoreEmails(options, mockUserContext);

      // Verify
      expect(result.restored).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledWith({
        userId: 'me',
        requestBody:{
          ids: ['email2'],
          addLabelIds: ['INBOX', 'RESTORED'],
          removeLabelIds: ['ARCHIVED']
        }
      });
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledTimes(1);
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(expect.objectContaining({
        id: 'email2',
        archived: false,
        archiveDate: undefined,
        archiveLocation: undefined
      }), 'test-user-123');
    });

    test('should return error when no archived emails found', async () => {
      // Setup
      const options = {
        emailIds: ['nonexistent']
      };

      // Mock empty result
      // @ts-ignore - TypeScript error with mock return value
      databaseManager.getEmailsByIds = jest.fn().mockResolvedValue([]);

      // Execute
      const result = await archiveManager.restoreEmails(options, mockUserContext);

      // Verify
      expect(result.restored).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('No archived emails found');
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
      expect(databaseManager.upsertEmailIndex).not.toHaveBeenCalled();
    });

    test('should handle Gmail API errors during restore', async () => {
      // Setup - IMPORTANT: Reset the mock completely first
      mockGmailClient.users.messages.batchModify.mockReset();
      
      const options = {
        emailIds: ['email1'],
      };

      // Force the mock to reject ALL calls during this test
      mockGmailClient.users.messages.batchModify.mockRejectedValueOnce(
        new Error('Failed to restore emails')
      );

      // Setup the email data AFTER setting up the rejection
      // @ts-ignore - TypeScript error with mock return value
      databaseManager.getEmailsByIds.mockResolvedValueOnce([
        {
          id: 'email1',
          archived: true,
          archiveDate: new Date(),
          archiveLocation: 'ARCHIVED',
          user_id: 'test-user-123'
        }
      ]);
      
      // Execute
      const result = await archiveManager.restoreEmails(options, mockUserContext);

      // Verify
      expect(result.restored).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to restore emails');
      expect(databaseManager.upsertEmailIndex).not.toHaveBeenCalled();
    });

    test('should handle missing archive location', async () => {
      // Setup
      const options = {
        emailIds: ['email2']
      };

      // Mock email with missing archive location
      // @ts-ignore - TypeScript error with mock return value
      databaseManager.getEmailsByIds = jest.fn().mockResolvedValue([{
        ...sampleEmails[1],
        archived: true,
        archiveDate: new Date(),
        archiveLocation: undefined,
        user_id: 'test-user-123'
      }]);

      // Execute
      const result = await archiveManager.restoreEmails(options,mockUserContext);

      // Verify
      expect(result.restored).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to restore emails');
      expect(fs.readFile).not.toHaveBeenCalled();
      expect(databaseManager.upsertEmailIndex).not.toHaveBeenCalled();
    });

    test('should preserve labels when restoring', async () => {
      // Setup - IMPORTANT: Reset all mocks completely first
      mockGmailClient.users.messages.batchModify.mockReset();
      
      const options = {
        emailIds: ['email1'],
        restoreLabels: ['RESTORED']
      };
      
      // Explicitly override the default mock to return ONLY ONE email
      // This ensures we're only testing with a single email
      databaseManager.getEmailsByIds.mockReset();
      databaseManager.getEmailsByIds.mockResolvedValueOnce([{
        id: 'email1',
        archived: true,
        archiveDate: new Date(),
        archiveLocation: 'ARCHIVED',
        labels: ['INBOX'],
        user_id: 'test-user-123'
      }]);

      // Mock Gmail API response with success
      mockGmailClient.users.messages.batchModify.mockResolvedValue({ data: {} });

      // Execute
      const result = await archiveManager.restoreEmails(options, mockUserContext);

      // Verify
      expect(result.restored).toBe(1);
      expect(databaseManager.upsertEmailIndex).toHaveBeenCalledWith(expect.objectContaining({
        id: 'email1',
        labels: expect.arrayContaining(['INBOX', 'RESTORED'])
      }), 'test-user-123');
    });
  });

  describe('exportEmails', () => {
    test('should export emails in JSON format', async () => {
      // Setup
      const options = {
        format: 'json' as const,
        includeAttachments: false,
        searchCriteria: { year: 2023 }
      };

      // Execute
      const result = await archiveManager.exportEmails(options, mockUserContext);

      // Verify
      expect(result.exported).toBe(2);
      expect(result.file_path).toBeDefined();
      expect(result.size).toBe(1024);
      expect(databaseManager.searchEmails).toHaveBeenCalledWith({
        year: 2023,
        user_id: 'test-user-123'
      });
      expect(formatterRegistry.getFormatter).toHaveBeenCalledWith('json');
      expect(mockJsonFormatter.formatEmails).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.stat).toHaveBeenCalled();
    });

    test('should export emails in MBOX format', async () => {
      // Setup
      const options = {
        format: 'mbox' as const,
        includeAttachments: true,
        searchCriteria: {}
      };

      // Execute
      const result = await archiveManager.exportEmails(options, mockUserContext);

      // Verify
      expect(result.exported).toBe(2);
      expect(formatterRegistry.getFormatter).toHaveBeenCalledWith('mbox');
      expect(mockMboxFormatter.formatEmails).toHaveBeenCalledWith(
        sampleEmails, 
        expect.objectContaining({ includeAttachments: true })
      );
    });

    test('should handle export errors', async () => {
      // Setup
      const options = {
        format: 'json' as const,
        includeAttachments: false,
        searchCriteria: {}
      };

      // Mock formatter error
      // @ts-ignore - TypeScript error with mock return value
      mockJsonFormatter.formatEmails.mockRejectedValueOnce(new Error('Format error'));

      // Execute
      const result = await archiveManager.exportEmails(options, mockUserContext);

      // Verify
      expect(result.exported).toBe(0);
      expect(result.file_path).toBe('');
      expect(result.size).toBe(0);
    });
  });

  describe('Archive Rules', () => {
    test('should create archive rule', async () => {
      // Setup
      const rule = {
        name: 'Test Rule',
        criteria: { category: 'low' },
        action: { method: 'gmail' }
      };

      // Execute
      const result = await archiveManager.createRule(rule, mockUserContext);

      // Verify
      expect(result.rule_id).toBe('rule1');
      expect(result.created).toBe(true);
      expect(databaseManager.createArchiveRule).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Test Rule',
        criteria: { category: 'low' },
        action: { method: 'gmail' },
        enabled: true
      }));
    });

    test('should list archive rules', async () => {
      // Execute
      const result = await archiveManager.listRules({ activeOnly: true }, mockUserContext);

      // Verify
      expect(result.rules).toHaveLength(1);
      expect(result.rules[0].id).toBe('rule1');
      expect(databaseManager.getArchiveRules).toHaveBeenCalledWith(true);
    });

    test('should run scheduled rules', async () => {
      // We don't need to mock private methods; instead we'll just verify the public interface
      // Execute the method and check that the expected database methods were called
      await archiveManager.runScheduledRules();
      
      // Verify that rules were fetched
      expect(databaseManager.getArchiveRules).toHaveBeenCalledWith(true);
    });
  });
});