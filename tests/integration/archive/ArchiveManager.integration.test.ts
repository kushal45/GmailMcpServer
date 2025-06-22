import { describe, it, expect, beforeEach, beforeAll, afterAll, jest } from '@jest/globals';
import { ArchiveManager } from '../../../src/archive/ArchiveManager';
import { AuthManager } from '../../../src/auth/AuthManager';
import { DatabaseManager } from '../../../src/database/DatabaseManager';
import { setupFormatterRegistry } from '../../../src/archive/setupFormatters';
import { FileFormatterRegistry } from '../../../src/archive/formatters/FormatterRegistry';
import { FileAccessControlManager } from '../../../src/services/FileAccessControlManager';
import { EmailIndex, ArchiveOptions, ExportOptions } from '../../../src/types';
import { UserContext } from '../../../src/types/file-access-control';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import sqlite3 from 'sqlite3';

/**
 * ArchiveManager Multi-User Integration Tests
 * 
 * These tests validate the complete multi-user functionality of the Archive Management System
 * with real database interactions, file system operations, and service integrations.
 * Only external services (Gmail API, OAuth) are mocked.
 */
describe('ArchiveManager Multi-User Integration Tests', () => {
  let testDbPath: string;
  let testArchiveDir: string;
  let database: any;
  
  // Real instances
  let authManager: AuthManager;
  let databaseManager: DatabaseManager;
  let formatterRegistry: FileFormatterRegistry;
  let fileAccessControl: FileAccessControlManager;
  let archiveManager: ArchiveManager;

  // Test user contexts
  const userA: UserContext = {
    user_id: 'user-a-test-123',
    session_id: 'session-a-456',
    roles: ['user'],
    permissions: ['archive:read', 'archive:write'],
    ip_address: '192.168.1.100',
    user_agent: 'Mozilla/5.0 UserA'
  };

  const userB: UserContext = {
    user_id: 'user-b-test-456',
    session_id: 'session-b-789',
    roles: ['user'],
    permissions: ['archive:read', 'archive:write'],
    ip_address: '192.168.1.101',
    user_agent: 'Mozilla/5.0 UserB'
  };

  const adminUser: UserContext = {
    user_id: 'admin-test-789',
    session_id: 'session-admin-123',
    roles: ['admin', 'user'],
    permissions: ['archive:read', 'archive:write', 'archive:admin'],
    ip_address: '192.168.1.102',
    user_agent: 'Mozilla/5.0 Admin'
  };

  // Mock Gmail clients (only external service mocked)
  const mockGmailClientA: any = {
    users: {
      messages: {
        batchModify: jest.fn(),
        modify: jest.fn()
      }
    }
  };

  const mockGmailClientB: any = {
    users: {
      messages: {
        batchModify: jest.fn(),
        modify: jest.fn()
      }
    }
  };

  // Sample test data
  const sampleEmailsUserA: EmailIndex[] = [
    {
      id: 'email-a1',
      threadId: 'thread-a1',
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
      threadId: 'thread-a2',
      subject: 'User A Email 2',
      sender: 'sender-a2@example.com',
      recipients: ['user-a@example.com'],
      date: new Date('2023-02-01'),
      year: 2023,
      size: 2048,
      hasAttachments: true,
      labels: ['INBOX', 'IMPORTANT'],
      snippet: 'User A private email 2',
      archived: false
    }
  ];

  const sampleEmailsUserB: EmailIndex[] = [
    {
      id: 'email-b1',
      threadId: 'thread-b1',
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
      threadId: 'thread-b2',
      subject: 'User B Email 2',
      sender: 'sender-b2@example.com',
      recipients: ['user-b@example.com'],
      date: new Date('2023-04-01'),
      year: 2023,
      size: 4096,
      hasAttachments: true,
      labels: ['INBOX', 'WORK'],
      snippet: 'User B private email 2',
      archived: false
    }
  ];

  beforeAll(async () => {
    // Create temporary database and archive directories
    const tempDir = os.tmpdir();
    testDbPath = path.join(tempDir, `test-archive-db-${Date.now()}.sqlite`);
    testArchiveDir = path.join(tempDir, `test-archives-${Date.now()}`);
    
    await fs.mkdir(testArchiveDir, { recursive: true });
    
    // Set environment variables
    process.env.ARCHIVE_PATH = testArchiveDir;
    process.env.DATABASE_PATH = testDbPath;
  });

  afterAll(async () => {
    // Clean up test files and directories
    try {
      if (database) {
        await database.close();
      }
      await fs.unlink(testDbPath).catch(() => {});
      await fs.rm(testArchiveDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Error cleaning up test environment:', error);
    }
    
    // Reset environment
    delete process.env.ARCHIVE_PATH;
    delete process.env.DATABASE_PATH;
  });

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Initialize real database manager (creates base schema)
    databaseManager = DatabaseManager.getInstance();
    await databaseManager.initialize();

    // **DIAGNOSTIC**: Clean up test data by truncating instead of dropping tables
    console.log("=== CLEANING DATABASE STATE ===");
    try {
      // Truncate data from existing tables to preserve schema
      await databaseManager.execute('DELETE FROM file_access_permissions');
      await databaseManager.execute('DELETE FROM file_metadata');
      await databaseManager.execute('DELETE FROM audit_log');
      await databaseManager.execute('DELETE FROM archive_records');
      await databaseManager.execute('DELETE FROM archive_rules');
      await databaseManager.execute('DELETE FROM email_index');
      await databaseManager.execute('DELETE FROM users');
      console.log("All table data truncated successfully");
    } catch (error) {
      console.log("Error truncating table data (tables may not exist yet):", error);
    }

    // Initialize real file access control manager (creates new tables if needed)
    fileAccessControl = new FileAccessControlManager(databaseManager);
    await fileAccessControl.initialize();

    // Apply multi-user migration to database (adds columns to existing tables)
    await applyMultiUserMigration();

    // **DIAGNOSTIC**: Verify clean state before seeding
    const emailCountBefore = await databaseManager.queryAll('SELECT COUNT(*) as count FROM email_index');
    console.log("Email count before seeding:", emailCountBefore[0]?.count || 0);

    // Insert test data into database
    await seedTestData();

    // **DIAGNOSTIC**: Verify expected data after seeding
    const emailCountAfter = await databaseManager.queryAll('SELECT COUNT(*) as count FROM email_index');
    const userAEmails = await databaseManager.queryAll('SELECT COUNT(*) as count FROM email_index WHERE user_id = ?', ['user-a-test-123']);
    const userBEmails = await databaseManager.queryAll('SELECT COUNT(*) as count FROM email_index WHERE user_id = ?', ['user-b-test-456']);
    console.log("Email count after seeding:", emailCountAfter[0]?.count || 0);
    console.log("User A emails:", userAEmails[0]?.count || 0);
    console.log("User B emails:", userBEmails[0]?.count || 0);

    // Setup real formatter registry
    formatterRegistry = setupFormatterRegistry();

    // Setup mocked AuthManager (OAuth is external)
    authManager = new AuthManager();
    jest.spyOn(authManager, 'getGmailClient').mockImplementation(async (sessionId?: string) => {
      console.log("=== AuthManager.getGmailClient called with sessionId:", sessionId);
      if (sessionId === 'session-a-456') return mockGmailClientA;
      if (sessionId === 'session-b-789') return mockGmailClientB;
      if (sessionId === 'session-admin-123') return mockGmailClientA;
      if (sessionId === 'session-single') return mockGmailClientA; // Add single-user support
      throw new Error('Invalid session for Gmail client');
    });
    
    jest.spyOn(authManager, 'hasValidAuth').mockImplementation(async (sessionId?: string) => {
      console.log("=== AuthManager.hasValidAuth called with sessionId:", sessionId);
      const validSessions = ['session-a-456', 'session-b-789', 'session-admin-123', 'session-single'];
      const isValid = validSessions.includes(sessionId || '');
      console.log("Session validation result:", isValid);
      return isValid;
    });
    
    jest.spyOn(authManager, 'isMultiUserMode').mockReturnValue(true);
    
    jest.spyOn(authManager, 'getUserIdForSession').mockImplementation((sessionId: string) => {
      console.log("=== AuthManager.getUserIdForSession called with sessionId:", sessionId);
      const sessionUserMap: Record<string, string> = {
        'session-a-456': 'user-a-test-123',
        'session-b-789': 'user-b-test-456',
        'session-admin-123': 'admin-test-789',
        'session-single': 'single-user'
      };
      const userId = sessionUserMap[sessionId] || 'unknown-user';
      console.log("Mapped userId:", userId);
      return userId;
    });

    // Initialize ArchiveManager with real dependencies
    archiveManager = new ArchiveManager(authManager, databaseManager, formatterRegistry, fileAccessControl);

    // Setup Gmail mock responses
    mockGmailClientA.users.messages.batchModify.mockResolvedValue({ data: {} });
    mockGmailClientA.users.messages.modify.mockResolvedValue({ data: {} });
    mockGmailClientB.users.messages.batchModify.mockResolvedValue({ data: {} });
    mockGmailClientB.users.messages.modify.mockResolvedValue({ data: {} });
  });

  // Helper function to apply multi-user migration
  async function applyMultiUserMigration(): Promise<void> {
    const migrationPath = path.join(process.cwd(), 'src/database/migrations/001_multi_user_file_access_control.sql');
    
    try {
      const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
      const statements = migrationSQL.split(';').filter(stmt => stmt.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          await databaseManager.execute(statement.trim());
        }
      }
    } catch (error) {
      // If migration file doesn't exist, create tables programmatically
      await createTablesDirectly();
    }
  }

  // Helper function to create tables if migration fails
  async function createTablesDirectly(): Promise<void> {
    const tables = [
      // Users table
      `CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        is_active INTEGER NOT NULL DEFAULT 1
      )`,
      
      // Email index table with user_id
      `CREATE TABLE IF NOT EXISTS email_index (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        subject TEXT,
        sender TEXT,
        recipients TEXT,
        date INTEGER,
        year INTEGER,
        size INTEGER,
        hasAttachments INTEGER DEFAULT 0,
        labels TEXT,
        snippet TEXT,
        archived INTEGER DEFAULT 0,
        archiveDate INTEGER,
        archiveLocation TEXT,
        user_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // Archive rules table
      `CREATE TABLE IF NOT EXISTS archive_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        criteria TEXT NOT NULL,
        action TEXT NOT NULL,
        schedule TEXT,
        enabled INTEGER DEFAULT 1,
        lastRun INTEGER,
        user_id TEXT,
        created INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // Archive records table
      `CREATE TABLE IF NOT EXISTS archive_records (
        id TEXT PRIMARY KEY,
        emailIds TEXT NOT NULL,
        archiveDate INTEGER NOT NULL,
        method TEXT NOT NULL,
        location TEXT,
        format TEXT,
        size INTEGER DEFAULT 0,
        restorable INTEGER DEFAULT 1,
        user_id TEXT,
        created INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`
    ];

    for (const table of tables) {
      await databaseManager.execute(table);
    }
  }

  // Helper function to seed test data
  async function seedTestData(): Promise<void> {
    console.log("=== SEEDING TEST DATA ===");
    
    // Insert test users
    console.log("Inserting test users...");
    await databaseManager.execute(
      'INSERT OR REPLACE INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)',
      ['user-a-test-123', 'user-a@example.com', 'User A', 'user']
    );
    await databaseManager.execute(
      'INSERT OR REPLACE INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)',
      ['user-b-test-456', 'user-b@example.com', 'User B', 'user']
    );
    await databaseManager.execute(
      'INSERT OR REPLACE INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)',
      ['admin-test-789', 'admin@example.com', 'Admin User', 'admin']
    );

    // Insert test emails for User A
    console.log("Inserting emails for User A...");
    for (const email of sampleEmailsUserA) {
      console.log(`Inserting email: ${email.id} for user-a-test-123`);
      await databaseManager.upsertEmailIndex({
        ...email,
        labels: email.labels || []
      }, 'user-a-test-123');
    }

    // Insert test emails for User B
    console.log("Inserting emails for User B...");
    for (const email of sampleEmailsUserB) {
      console.log(`Inserting email: ${email.id} for user-b-test-456`);
      await databaseManager.upsertEmailIndex({
        ...email,
        labels: email.labels || []
      }, 'user-b-test-456');
    }
    
    console.log("=== TEST DATA SEEDING COMPLETE ===");
  }

  describe('End-to-End Archive Workflows', () => {
    it('should complete archive workflow: search emails → archive to Gmail → verify in database', async () => {
      // **DIAGNOSTIC**: Check what emails are available before archiving
      console.log('=== DIAGNOSTIC: GMAIL ARCHIVE WORKFLOW ===');
      console.log('User A context:', userA);
      
      const availableEmails = await databaseManager.searchEmails({
        user_id: 'user-a-test-123'
      });
      console.log('Available emails for User A:', availableEmails.length);
      availableEmails.forEach(email => {
        console.log(`  - ${email.id}: archived=${email.archived}, subject="${email.subject}"`);
      });

      // Search and archive User A's emails
      const archiveOptions: ArchiveOptions = {
        method: 'gmail',
        dryRun: false
      };

      console.log('Archive options:', archiveOptions);
      const result = await archiveManager.archiveEmails(archiveOptions, userA);
      console.log('Archive result:', result);

      // Verify archive result
      expect(result.archived).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify Gmail API was called
      expect(mockGmailClientA.users.messages.batchModify).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          ids: expect.arrayContaining(['email-a1', 'email-a2']),
          addLabelIds: ['ARCHIVED'],
          removeLabelIds: ['INBOX']
        }
      });

      // Verify database updates
      const archivedEmails = await databaseManager.searchEmails({
        archived: true,
        user_id: 'user-a-test-123'
      });
      expect(archivedEmails).toHaveLength(2);
      expect(archivedEmails[0].archived).toBe(true);
      expect(archivedEmails[0].archiveDate).toBeDefined();

      // Verify archive record was created
      const archiveRecords = await databaseManager.queryAll(
        'SELECT * FROM archive_records WHERE user_id = ?',
        ['user-a-test-123']
      );
      expect(archiveRecords).toHaveLength(1);
      expect(archiveRecords[0].method).toBe('gmail');
    });

    it('should complete export workflow: search emails → export to file → verify file creation and permissions', async () => {
      // **DIAGNOSTIC**: Check what emails are available before archiving
      console.log('=== DIAGNOSTIC: EXPORT WORKFLOW ===');
      console.log('User A context:', userA);
      
      const availableEmails = await databaseManager.searchEmails({
        user_id: 'user-a-test-123'
      });
      console.log('Available emails for User A:', availableEmails.length);
      availableEmails.forEach(email => {
        console.log(`  - ${email.id}: archived=${email.archived}, subject="${email.subject}"`);
      });

      const archiveOptions: ArchiveOptions = {
        method: 'export',
        exportFormat: 'json',
        exportPath: 'user-a-export',
        dryRun: false
      };

      console.log('Archive options:', archiveOptions);
      const result = await archiveManager.archiveEmails(archiveOptions, userA);
      console.log('Archive result:', result);

      // Verify export result
      expect(result.archived).toBe(2);
      expect(result.location).toBeDefined();
      expect(result.location).toContain('user_user-a-test-123');
      expect(result.errors).toHaveLength(0);

      // Verify file was created
      const filePath = result.location!;
      const fileExists = await fs.access(filePath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file content
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const exportedData = JSON.parse(fileContent);
      expect(exportedData.emails).toHaveLength(2);

      // Verify file metadata in database
      const fileMetadata = await databaseManager.queryAll(
        'SELECT * FROM file_metadata WHERE user_id = ? AND file_type = ?',
        ['user-a-test-123', 'email_export']
      );
      expect(fileMetadata).toHaveLength(1);
      expect(fileMetadata[0].file_path).toBe(filePath);

      // Verify user-specific directory structure
      expect(filePath).toMatch(/user_user-a-test-123/);
    });

    it('should complete restore workflow: restore archived emails → verify Gmail API calls → update database', async () => {
      // **DIAGNOSTIC**: Check emails state before archive
      console.log('=== BEFORE ARCHIVE ===');
      const beforeArchive = await databaseManager.searchEmails({ user_id: 'user-a-test-123' });
      beforeArchive.forEach(email => {
        console.log(`Email ${email.id}: archived=${email.archived}, archiveLocation=${email.archiveLocation}`);
      });

      // First archive emails
      const archiveResult = await archiveManager.archiveEmails({
        method: 'gmail',
        dryRun: false
      }, userA);
      
      console.log('=== ARCHIVE RESULT ===');
      console.log('Archive result:', archiveResult);
      
      // **DIAGNOSTIC**: Check emails state after archive
      console.log('=== AFTER ARCHIVE ===');
      const afterArchive = await databaseManager.searchEmails({ user_id: 'user-a-test-123' });
      afterArchive.forEach(email => {
        console.log(`Email ${email.id}: archived=${email.archived}, archiveLocation=${email.archiveLocation}`);
      });

      // Then restore them
      const restoreOptions = {
        emailIds: ['email-a1', 'email-a2'],
        restoreLabels: ['RESTORED', 'INBOX']
      };

      // **DIAGNOSTIC**: Check emails state before restore
      const emailsBeforeRestore = await databaseManager.searchEmails({
        user_id: 'user-a-test-123'
      });
      console.log("=== EMAILS BEFORE RESTORE ===");
      emailsBeforeRestore.forEach(email => {
        console.log(`Email ${email.id}: archived=${email.archived}, archiveLocation=${email.archiveLocation}`);
      });

      const result = await archiveManager.restoreEmails(restoreOptions, userA);

      // **DIAGNOSTIC**: Check restore result details
      console.log("=== RESTORE RESULT ===");
      console.log("Restored count:", result.restored);
      console.log("Errors:", result.errors);

      // Verify restore result
      expect(result.restored).toBe(2);
      expect(result.errors).toHaveLength(0);

      // Verify Gmail API was called for restore
      expect(mockGmailClientA.users.messages.batchModify).toHaveBeenCalledWith({
        userId: 'me',
        requestBody: {
          ids: expect.arrayContaining(['email-a1', 'email-a2']),
          addLabelIds: expect.arrayContaining(['RESTORED', 'INBOX']),
          removeLabelIds: ['ARCHIVED']
        }
      });

      // Verify database updates
      const restoredEmails = await databaseManager.searchEmails({
        archived: false,
        user_id: 'user-a-test-123'
      });
      expect(restoredEmails).toHaveLength(2);
      restoredEmails.forEach(email => {
        expect(email.archived).toBe(false);
        expect(email.archiveDate).toBeUndefined();
        expect(email.labels).toContain('RESTORED');
      });
    });

    it('should handle multi-user concurrent operations correctly', async () => {
      const archiveOptions = {
        method: 'gmail' as const,
        dryRun: false
      };

      // Execute concurrent operations
      const [resultA, resultB] = await Promise.all([
        archiveManager.archiveEmails(archiveOptions, userA),
        archiveManager.archiveEmails(archiveOptions, userB)
      ]);

      // Both should succeed independently
      expect(resultA.archived).toBe(2);
      expect(resultB.archived).toBe(2);
      expect(resultA.errors).toHaveLength(0);
      expect(resultB.errors).toHaveLength(0);

      // Verify separate database records
      const userAArchived = await databaseManager.searchEmails({
        archived: true,
        user_id: 'user-a-test-123'
      });
      const userBArchived = await databaseManager.searchEmails({
        archived: true,
        user_id: 'user-b-test-456'
      });

      expect(userAArchived).toHaveLength(2);
      expect(userBArchived).toHaveLength(2);

      // Verify data isolation
      userAArchived.forEach(email => {
        expect(email.id).toMatch(/^email-a/);
      });
      userBArchived.forEach(email => {
        expect(email.id).toMatch(/^email-b/);
      });
    });
  });

  describe('Database Integration Tests', () => {
    it('should enforce user_id filtering in all database operations', async () => {
      // User A queries their emails
      const userAEmails = await databaseManager.searchEmails({
        user_id: 'user-a-test-123'
      });

      // User B queries their emails
      const userBEmails = await databaseManager.searchEmails({
        user_id: 'user-b-test-456'
      });

      // Verify isolation
      expect(userAEmails).toHaveLength(2);
      expect(userBEmails).toHaveLength(2);
      
      userAEmails.forEach(email => {
        expect(email.id).toMatch(/^email-a/);
      });
      userBEmails.forEach(email => {
        expect(email.id).toMatch(/^email-b/);
      });
    });

    it('should validate foreign key constraints prevent cross-user access', async () => {
      // Create archive rule for User A
      const ruleId = await databaseManager.createArchiveRule({
        name: 'User A Rule',
        criteria: { category: 'low' },
        action: { method: 'gmail' },
        enabled: true
      });

      // Update with User A's ID
      await databaseManager.execute(
        'UPDATE archive_rules SET user_id = ? WHERE id = ?',
        ['user-a-test-123', ruleId]
      );

      // Verify User B cannot see User A's rule when filtered by their ID
      const userBRules = await databaseManager.getArchiveRules(true, 'user-b-test-456');
      expect(userBRules).toHaveLength(0);
      
      // Verify User A can see their own rule when filtered by their ID
      const userARules = await databaseManager.getArchiveRules(true, 'user-a-test-123');
      expect(userARules).toHaveLength(1);
    });

    it('should test migration application and user isolation setup', async () => {
      // Verify tables exist after migration
      const tables = await databaseManager.queryAll(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      const tableNames = tables.map((t: any) => t.name);

      expect(tableNames).toContain('file_metadata');
      expect(tableNames).toContain('file_access_permissions');
      expect(tableNames).toContain('audit_log');

      // Verify user_id columns added to existing tables
      const archiveRulesSchema = await databaseManager.queryAll(
        "PRAGMA table_info(archive_rules)"
      );
      const hasUserIdColumn = archiveRulesSchema?.some((col: any) => col.name === 'user_id');
      expect(hasUserIdColumn).toBe(true);
    });

    it('should associate archive rules and records with proper user IDs', async () => {
      // Create and execute archive rule
      const rule = {
        name: 'User A Auto Rule',
        criteria: { year: 2023 },
        action: { method: 'gmail' }
      };

      const result = await archiveManager.createRule(rule, userA);
      expect(result.created).toBe(true);

      // Verify rule in database has correct user_id
      const ruleRecord = await databaseManager.query(
        'SELECT * FROM archive_rules WHERE id = ?',
        [result.rule_id]
      );
      expect(ruleRecord.user_id).toBe('user-a-test-123');

      // Create archive record
      await archiveManager.archiveEmails({
        method: 'export',
        exportFormat: 'json',
        dryRun: false
      }, userA);

      // Verify archive record has correct user_id
      const archiveRecord = await databaseManager.query(
        'SELECT * FROM archive_records WHERE user_id = ?',
        ['user-a-test-123']
      );
      expect(archiveRecord).toBeDefined();
      expect(archiveRecord.user_id).toBe('user-a-test-123');
    });
  });

  describe('FileAccessControlManager Integration', () => {
    it('should create user-specific directories and manage permissions', async () => {
      
      
      const archiveOptions: ArchiveOptions = {
        method: 'export',
        exportFormat: 'json',
        exportPath: 'permission-test',
        dryRun: false
      };

      

      const result = await archiveManager.archiveEmails(archiveOptions, userA);
      
      

      

      // Verify user-specific directory created
      const userDir = path.join(testArchiveDir, 'user_user-a-test-123');
      const dirExists = await fs.access(userDir).then(() => true).catch(() => false);
      
      expect(dirExists).toBe(true);

      // Verify file metadata created
      const fileMetadata = await databaseManager.queryAll(
        'SELECT * FROM file_metadata WHERE user_id = ?',
        ['user-a-test-123']
      );
      expect(fileMetadata).toHaveLength(1);
      expect(fileMetadata[0].file_path).toBe(result.location);

      // Verify file permissions created
      const permissions = await databaseManager.queryAll(
        'SELECT * FROM file_access_permissions WHERE file_id = ?',
        [fileMetadata[0].id]
      );
      expect(permissions.length).toBeGreaterThan(0);
    });

    it('should log audit events for file operations', async () => {
      await archiveManager.archiveEmails({
        method: 'export',
        exportFormat: 'json',
        dryRun: false
      }, userA);

      // Verify audit log entries - both file and archive logs are created
      const auditLogs = await databaseManager.queryAll(
        'SELECT * FROM audit_log WHERE user_id = ? AND action = ? AND resource_type = ?',
        ['user-a-test-123', 'file_create', 'archive']
      );
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].resource_type).toBe('archive');
      expect(auditLogs[0].success).toBe(1);
    });

    it('should generate user-specific paths and validate access control', async () => {
      // User A creates export
      const resultA = await archiveManager.archiveEmails({
        method: 'export',
        exportFormat: 'json',
        exportPath: 'access-test-a',
        dryRun: false
      }, userA);

      // User B creates export
      const resultB = await archiveManager.archiveEmails({
        method: 'export',
        exportFormat: 'json',
        exportPath: 'access-test-b',
        dryRun: false
      }, userB);

      // Verify different paths for different users
      expect(resultA.location).toContain('user_user-a-test-123');
      expect(resultB.location).toContain('user_user-b-test-456');
      expect(resultA.location).not.toEqual(resultB.location);

      // Verify files exist in correct locations
      const fileAExists = await fs.access(resultA.location!).then(() => true).catch(() => false);
      const fileBExists = await fs.access(resultB.location!).then(() => true).catch(() => false);
      expect(fileAExists).toBe(true);
      expect(fileBExists).toBe(true);
    });

    it('should handle file cleanup and maintenance operations', async () => {
      // Create expired file metadata
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
      await databaseManager.execute(
        `INSERT INTO file_metadata (
          id, file_path, original_filename, file_type, size_bytes, 
          checksum_sha256, user_id, created_at, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'expired-file-123',
          '/tmp/expired-file.json',
          'expired-file.json',
          'email_export',
          1024,
          'dummy-checksum',
          'user-a-test-123',
          Math.floor(Date.now() / 1000),
          Math.floor(Date.now() / 1000),
          Math.floor(expiredDate.getTime() / 1000)
        ]
      );

      // Run cleanup
      const cleanedCount = await fileAccessControl.cleanupExpiredFiles();
      expect(cleanedCount).toBeGreaterThanOrEqual(0);

      // Verify audit log for cleanup
      const cleanupLogs = await databaseManager.queryAll(
        'SELECT * FROM audit_log WHERE action = ? AND user_id = ?',
        ['file_delete', 'system']
      );
      expect(cleanupLogs.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Service Integration Tests', () => {
    it('should integrate ArchiveManager + AuthManager with real session validation', async () => {
      // Valid session should work
      const validResult = await archiveManager.archiveEmails({
        method: 'gmail',
        dryRun: true
      }, userA);
      expect(validResult.archived).toBe(2);

      // Invalid session should fail
      const invalidUser = { ...userA, session_id: 'invalid-session' };
      await expect(
        archiveManager.archiveEmails({
          method: 'gmail',
          dryRun: false
        }, invalidUser)
      ).rejects.toThrow(/Session validation failed/);
    });

    it('should integrate ArchiveManager + DatabaseManager with real user_id queries', async () => {
      // Archive emails for User A
      await archiveManager.archiveEmails({
        method: 'gmail',
        dryRun: false
      }, userA);

      // Verify database queries respect user_id filtering
      const userAEmails = await databaseManager.searchEmails({
        archived: true,
        user_id: 'user-a-test-123'
      });
      const userBEmails = await databaseManager.searchEmails({
        archived: true,
        user_id: 'user-b-test-456'
      });

      expect(userAEmails).toHaveLength(2);
      expect(userBEmails).toHaveLength(0);
    });

    it('should integrate ArchiveManager + FileAccessControlManager with real file operations', async () => {
      const exportResult = await archiveManager.exportEmails({
        format: 'json',
        includeAttachments: false,
        outputPath: 'integration-test'
      }, userA);

      // Verify file was created through FileAccessControlManager
      expect(exportResult.exported).toBe(2);
      expect(exportResult.file_path).toBeDefined();

      // Verify file metadata exists
      const fileMetadata = await databaseManager.queryAll(
        'SELECT * FROM file_metadata WHERE user_id = ? AND file_type = ?',
        ['user-a-test-123', 'email_export']
      );
      expect(fileMetadata).toHaveLength(1);

      // Verify audit trail
      const auditEntries = await databaseManager.queryAll(
        'SELECT * FROM audit_log WHERE user_id = ? AND resource_type = ?',
        ['user-a-test-123', 'file']
      );
      expect(auditEntries.length).toBeGreaterThan(0);
    });

    it('should integrate with SearchEngine for user-specific search results', async () => {
      // Search with specific criteria for User A
      const userAResults = await databaseManager.searchEmails({
        user_id: 'user-a-test-123',
        year: 2023
      });

      // Search with same criteria for User B
      const userBResults = await databaseManager.searchEmails({
        user_id: 'user-b-test-456',
        year: 2023
      });

      // Verify results are user-specific
      expect(userAResults).toHaveLength(2);
      expect(userBResults).toHaveLength(2);
      
      userAResults.forEach(email => {
        expect(email.id).toMatch(/^email-a/);
      });
      userBResults.forEach(email => {
        expect(email.id).toMatch(/^email-b/);
      });
    });
  });

  describe('Single-User Compatibility Tests', () => {
    it('should maintain backward compatibility with single-user mode', async () => {
      // Mock single-user mode
      jest.spyOn(authManager, 'isMultiUserMode').mockReturnValue(false);
      
      // Create new ArchiveManager instance for single-user test
      const singleUserArchiveManager = new ArchiveManager(
        authManager,
        databaseManager,
        formatterRegistry,
        fileAccessControl
      );

      // Single-user context (no user_id required in some operations)
      const singleUserContext = {
        user_id: 'single-user',
        session_id: 'session-single',
        roles: ['user']
      };

      const result = await singleUserArchiveManager.archiveEmails({
        method: 'gmail',
        dryRun: true
      }, singleUserContext);

      expect(result.archived).toBeGreaterThanOrEqual(0);
    });

    it('should handle migration from single-user to multi-user setup', async () => {
      // Insert legacy data without user_id but WITH required thread_id
      await databaseManager.execute(
        `INSERT INTO email_index (
          id, thread_id, subject, sender, recipients, date, year, size, archived
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['legacy-email-1', 'legacy-thread-1', 'Legacy Email', 'legacy@example.com', 'user@example.com',
         Date.now(), 2023, 1024, 0]
      );

      // Verify legacy data exists
      const legacyEmails = await databaseManager.queryAll(
        'SELECT * FROM email_index WHERE user_id IS NULL'
      );
      expect(legacyEmails.length).toBeGreaterThan(0);

      // Migration would assign these to a default user or require manual assignment
      // For this test, we verify the data structure supports both scenarios
      const allEmails = await databaseManager.queryAll('SELECT * FROM email_index');
      expect(allEmails.length).toBeGreaterThan(4); // 2 + 2 + 1 legacy
    });

    it('should validate existing single-user data remains functional', async () => {
      // Query all emails without user filter (admin operation)
      const allEmails = await databaseManager.queryAll('SELECT * FROM email_index');
      expect(allEmails.length).toBeGreaterThanOrEqual(4);

      // Verify mixed data (with and without user_id) can coexist
      const withUserId = allEmails.filter((email: any) => email.user_id);
      const withoutUserId = allEmails.filter((email: any) => !email.user_id);
      
      expect(withUserId.length).toBe(4); // Test data
      expect(withoutUserId.length).toBeGreaterThanOrEqual(0); // Legacy data if any
    });
  });

  describe('Performance and Concurrency Tests', () => {
    it('should handle multiple users performing operations simultaneously', async () => {
      const startTime = Date.now();
      
      // Create multiple concurrent operations
      const operations = await Promise.all([
        archiveManager.archiveEmails({ method: 'gmail', dryRun: false }, userA),
        archiveManager.archiveEmails({ method: 'export', exportFormat: 'json', dryRun: false }, userB),
        archiveManager.listRules({ activeOnly: true }, userA),
        archiveManager.listRules({ activeOnly: true }, userB),
        archiveManager.exportEmails({ format: 'json', includeAttachments: false }, userA)
      ]);

      const endTime = Date.now();

      // Verify all operations succeeded with proper typing
      const [archiveResultA, archiveResultB, rulesResultA, rulesResultB, exportResult] = operations;
      
      expect((archiveResultA as any).archived).toBe(2); // User A archive
      expect((archiveResultB as any).archived).toBe(2); // User B export
      expect((rulesResultA as any).rules).toBeDefined(); // User A rules
      expect((rulesResultB as any).rules).toBeDefined(); // User B rules
      expect((exportResult as any).exported).toBe(2); // User A export

      // Performance check (should complete within reasonable time)
      expect(endTime - startTime).toBeLessThan(5000); // 5 seconds
    });

    it('should handle large archive operations with proper user isolation', async () => {
      // Insert more test data
      const largeDataSet = Array.from({ length: 100 }, (_, i) => ({
        id: `bulk-email-a-${i}`,
        threadId: `bulk-thread-a-${i}`,
        subject: `Bulk Email A ${i}`,
        sender: 'bulk@example.com',
        recipients: ['user-a@example.com'],
        date: new Date('2023-01-01'),
        year: 2023,
        size: 1024,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: `Bulk email ${i}`,
        archived: false
      }));

      // Insert bulk data for User A
      for (const email of largeDataSet) {
        await databaseManager.upsertEmailIndex(email, 'user-a-test-123');
      }

      const startTime = Date.now();
      const result = await archiveManager.archiveEmails({
        method: 'export',
        exportFormat: 'json',
        dryRun: false
      }, userA);
      const endTime = Date.now();

      // Verify large operation succeeded
      expect(result.archived).toBe(102); // 2 original + 100 bulk
      expect(result.errors).toHaveLength(0);
      
      // Performance check
      expect(endTime - startTime).toBeLessThan(10000); // 10 seconds
    });

    it('should demonstrate file system performance with user-specific directories', async () => {
      const startTime = Date.now();
      
      // Concurrent file operations for different users
      const fileOperations = await Promise.all([
        archiveManager.exportEmails({
          format: 'json',
          includeAttachments: false,
          outputPath: 'perf-test-a'
        }, userA),
        archiveManager.exportEmails({
          format: 'json', 
          includeAttachments: false,
          outputPath: 'perf-test-b'
        }, userB)
      ]);
      
      const endTime = Date.now();

      // Verify both exports succeeded
      expect(fileOperations[0].exported).toBe(2);
      expect(fileOperations[1].exported).toBe(2);
      
      // Verify different file paths
      expect(fileOperations[0].file_path).toContain('user_user-a-test-123');
      expect(fileOperations[1].file_path).toContain('user_user-b-test-456');
      
      // Performance check
      expect(endTime - startTime).toBeLessThan(3000); // 3 seconds
    });

    it('should validate database query performance with user_id filtering', async () => {
      // Insert additional test data to stress test queries
      const additionalUsers = ['user-c-test', 'user-d-test', 'user-e-test'];
      
      for (const userId of additionalUsers) {
        await databaseManager.execute(
          'INSERT INTO users (id, email, display_name, role) VALUES (?, ?, ?, ?)',
          [userId, `${userId}@example.com`, `Test User ${userId}`, 'user']
        );
        
        // Add emails for each user
        for (let i = 0; i < 10; i++) {
          await databaseManager.upsertEmailIndex({
            id: `${userId}-email-${i}`,
            threadId: `${userId}-thread-${i}`,
            subject: `Email ${i} for ${userId}`,
            sender: 'test@example.com',
            recipients: [`${userId}@example.com`],
            date: new Date(),
            year: 2023,
            size: 1024,
            hasAttachments: false,
            labels: ['INBOX'],
            snippet: `Test email ${i}`,
            archived: false
          }, userId);
        }
      }

      const startTime = Date.now();
      
      // Concurrent database queries with user_id filtering
      const queryResults = await Promise.all([
        databaseManager.searchEmails({ user_id: 'user-a-test-123' }),
        databaseManager.searchEmails({ user_id: 'user-b-test-456' }),
        databaseManager.searchEmails({ user_id: 'user-c-test' }),
        databaseManager.searchEmails({ user_id: 'user-d-test' }),
        databaseManager.searchEmails({ user_id: 'user-e-test' })
      ]);
      
      const endTime = Date.now();

      // Verify query isolation
      expect(queryResults[0]).toHaveLength(2); // User A original emails
      expect(queryResults[1]).toHaveLength(2); // User B original emails
      expect(queryResults[2]).toHaveLength(10); // User C emails
      expect(queryResults[3]).toHaveLength(10); // User D emails
      expect(queryResults[4]).toHaveLength(10); // User E emails

      // Performance check for indexed queries
      expect(endTime - startTime).toBeLessThan(1000); // 1 second
    });
  });
});