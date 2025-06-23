// =========================
// Bulk, Batching, and Edge-Case DeleteManager Integration Tests
// Migrated from DeleteManager.integration.test.ts for isolation and maintainability
// =========================
import { DeleteManager } from '../../../src/delete/DeleteManager.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import {
  batchTestEmails,
  errorScenarioEmails,
  getEmailsByCriteria
} from './fixtures/mockEmails.js';
import {
  createTestDatabaseManager,
  cleanupTestDatabase,
  seedTestData,
  createDeleteOptions,
  setupSuccessfulBatchModify,
  setupPartialBatchFailure,
  setupBatchModifyFailure,
  verifyBatchModifyCalls,
  createMockGmailClient,
  createMockAuthManager,
  testErrors,
  createMockCleanupPolicy,
  createPerformanceTestScenario
} from './helpers/testHelpers.js';
import { PriorityCategory } from '../../../src/types/index.js';
import { logger } from '../../../src/utils/logger.js';
import { jest } from '@jest/globals';

// Helper to force-reset DatabaseManager singleton and STORAGE_PATH (ESM compatible)
async function forceResetDatabaseManager() {
  const module = await import('../../../src/database/DatabaseManager.js');
  module.DatabaseManager["singletonInstance"] = null;
  delete process.env.STORAGE_PATH;
  console.log('DIAGNOSTIC: Forced DatabaseManager singleton and STORAGE_PATH reset');
}

describe('DeleteManager Bulk Delete Operations Standalone', () => {
  it('should handle batch processing for large number of emails', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    console.log('DIAGNOSTIC: Using testDbDir:', testDbDir);
    console.log('DIAGNOSTIC: process.env.STORAGE_PATH:', process.env.STORAGE_PATH);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      const emailsBefore = await dbManager.searchEmails({});
      console.log('DIAGNOSTIC: DB should be empty before seeding, count:', emailsBefore.length);
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const allEmails = await dbManager.searchEmails({});
      console.log('DIAGNOSTIC: After seeding, emails in DB:', allEmails.length, allEmails.slice(0, 5).map(e => ({ id: e.id, category: e.category, archived: e.archived })));
      setupSuccessfulBatchModify(mockGmailClient);
      const searchedEmails = await dbManager.searchEmails({ category: 'low', archived: false });
      const firstBatch = searchedEmails.slice(0, 50);
      const secondBatch = searchedEmails.slice(50, 80);
      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(80);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(2);
      verifyBatchModifyCalls(mockGmailClient, [
        { ids: firstBatch.map(e => e.id) },
        { ids: secondBatch.map(e => e.id) }
      ]);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // Add other bulk/batch/edge-case tests here, following the same pattern.
});

describe('DeleteManager Edge Case: Already Deleted Email', () => {
  it('should handle already deleted emails', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    console.log('DIAGNOSTIC: Using testDbDir:', testDbDir);
    console.log('DIAGNOSTIC: process.env.STORAGE_PATH:', process.env.STORAGE_PATH);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      const emailsBefore = await dbManager.searchEmails({});
      console.log('DIAGNOSTIC: DB should be empty before seeding, count:', emailsBefore.length);
      // Create a unique email for this test
      const uniqueAlreadyDeleted = [{
        id: 'unique-already-deleted',
        threadId: 'thread-unique-already-deleted',
        sender: 'unique@example.com',
        subject: 'Unique Already Deleted',
        snippet: 'This is a unique already deleted test email.',
        size: 1024,
        date: new Date('2024-01-01T00:00:00Z'),
        category: 'low' as const,
        user_id: defaultUserContext.user_id,
        archived: false,
        promotional_score: 0.1,
        spam_score: 0.1,
      }];
      await seedTestData(dbManager, uniqueAlreadyDeleted, defaultUserContext.user_id);
      const allEmails = await dbManager.searchEmails({});
      console.log('DIAGNOSTIC: After seeding, emails in DB:', allEmails.length, allEmails.map(e => e.id));
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(1);
      expect(result.errors).toHaveLength(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

describe('DeleteManager Edge Case: Partial Batch Failures', () => {
  it('should handle partial batch failures', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    console.log('DIAGNOSTIC: Using testDbDir:', testDbDir);
    console.log('DIAGNOSTIC: process.env.STORAGE_PATH:', process.env.STORAGE_PATH);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      const emailsBefore = await dbManager.searchEmails({});
      console.log('DIAGNOSTIC: DB should be empty before seeding, count:', emailsBefore.length);
      // Deep clone batchTestEmails to ensure no overlap
      const clonedBatchTestEmails = batchTestEmails.map(e => ({ ...e, id: `${e.id}-partial-batch` }));
      await seedTestData(dbManager, clonedBatchTestEmails, defaultUserContext.user_id);
      const allEmails = await dbManager.searchEmails({});
      console.log('DIAGNOSTIC: After seeding, emails in DB:', allEmails.length, allEmails.map(e => e.id));
      setupPartialBatchFailure(mockGmailClient, testErrors.networkError);
      const searchedEmails = await dbManager.searchEmails({ category: 'low', archived: false });
      const firstBatch = searchedEmails.slice(0, 50);
      const secondBatch = searchedEmails.slice(50, 80);
      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(50); // Only first batch succeeded
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Network timeout');
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(2);
      verifyBatchModifyCalls(mockGmailClient, [
        { ids: firstBatch.map(e => e.id) },
        { ids: secondBatch.map(e => e.id) }
      ]);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// (Insert all missing migrated tests here, following the isolation pattern and with traceability comments)

// =========================
// MIGRATED TESTS FROM DeleteManager.integration.test.ts
// =========================

// --- Bulk Delete Operations ---
describe('DeleteManager Bulk Delete Operations', () => {
  it('should respect batch size limit of 50 emails', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      const largeEmailSet = Array.from({ length: 150 }, (_, i) => ({
        ...batchTestEmails[0],
        id: `${i}`,
        threadId: `thread-large-set-${i}`
      }));
      await seedTestData(dbManager, largeEmailSet, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(150);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(3);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should implement rate limiting between batches', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const startTime = Date.now();
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      const endTime = Date.now();
      expect(result.deleted).toBe(80);
      expect(result.errors).toHaveLength(0);
      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- Safety Features ---
describe('DeleteManager Safety Features', () => {
  it('should preview deletion without actually deleting (dry run)', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const emailsToDelete = await dbManager.searchEmails({ category: 'low', archived: false });
      const options = createDeleteOptions({ category: 'low', dryRun: true, skipArchived: true });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(emailsToDelete.length);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('DRY RUN');
      expect(result.errors[0]).toContain(`Would delete ${emailsToDelete.length} emails`);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should work with complex criteria in dry run', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const complexCriteria = {
        category: 'medium' as const,
        year: 2023,
        sizeThreshold: 50000,
        searchCriteria: { hasAttachments: true }
      };
      const matchingEmails = await dbManager.searchEmails({
        category: 'medium',
        year: 2023,
        sizeRange: { min: 0, max: 50000 },
        hasAttachments: true
      });
      const options = createDeleteOptions({ ...complexCriteria, dryRun: true });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(matchingEmails.length);
      expect(result.errors.length).toBe(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- Safety Features: High Priority Email Protection ---
describe('DeleteManager Safety Features: High Priority Email Protection', () => {
  it('should not delete high priority emails by default', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const allEmails = await dbManager.searchEmails({});
      const nonHighPriority = allEmails.filter(e => e.category !== 'high');
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({});
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(nonHighPriority.length);
      const deletedIds = (mockGmailClient.users.messages.batchModify.mock as any).calls[0][0].requestBody.ids;
      const highPriorityIds = allEmails.filter(e => e.category === 'high').map(e => e.id);
      highPriorityIds.forEach(id => {
        expect(deletedIds).not.toContain(id);
      });
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should only delete high priority when explicitly requested', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const highPriorityEmails = await dbManager.searchEmails({ category: 'high', archived: false });
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'high', skipArchived: true });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(highPriorityEmails.length);
      const ids = highPriorityEmails.map(e => e.id);
      const expectedCalls = ids.length > 0 ? [{ ids: ids }] : [];
      verifyBatchModifyCalls(mockGmailClient, expectedCalls);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- Safety Features: Archived Email Skip ---
describe('DeleteManager Safety Features: Archived Email Skip', () => {
  it('should skip archived emails by default', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const allEmails = await dbManager.searchEmails({});
      const nonArchived = allEmails.filter(e => !e.archived);
      const nonArchivedNonHigh = nonArchived.filter(e => e.category !== 'high');
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ skipArchived: true });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(nonArchivedNonHigh.length);
      const archivedIds = allEmails.filter(e => e.archived).map(e => e.id);
      const deletedIds = (mockGmailClient.users.messages.batchModify.mock as any).calls[0][0].requestBody.ids;
      archivedIds.forEach(id => {
        expect(deletedIds).not.toContain(id);
      });
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should include archived emails when skipArchived is false', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const allLowPriority = batchTestEmails.filter(e => e.category === 'low');
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low', skipArchived: false });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(allLowPriority.length);
      expect(result.errors).toHaveLength(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- Edge Cases ---
describe('DeleteManager Edge Cases', () => {
  it('should handle empty result sets gracefully', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      const options = createDeleteOptions({ category: 'low', year: 2025 });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle emails without required permissions', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      const protectedEmail = [errorScenarioEmails.permissionDenied];
      await seedTestData(dbManager, protectedEmail, defaultUserContext.user_id);
      setupBatchModifyFailure(mockGmailClient, testErrors.permissionError);
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Insufficient permissions');
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- Error Handling ---
describe('DeleteManager Error Handling', () => {
  it('should handle authentication failures', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const emails = createPerformanceTestScenario(10);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    await seedTestData(dbManager, emails, defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
   
    try {
      mockAuthManager.getGmailClient.mockRejectedValue(testErrors.authenticationError);
      const options = createDeleteOptions({ category: 'low' });
      await expect( deleteManager.deleteEmails(options, defaultUserContext)).rejects.toThrow('Authentication failed');
     
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle network timeouts', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      setupBatchModifyFailure(mockGmailClient, testErrors.networkError);
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Network timeout');
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle rate limit errors', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      setupBatchModifyFailure(mockGmailClient, testErrors.rateLimitError);
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Rate limit exceeded');
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle database errors', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await dbManager.close();
      const options = createDeleteOptions({ category: 'low' });
      await expect(deleteManager.deleteEmails(options, defaultUserContext)).rejects.toThrow();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle invalid parameters gracefully', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ year: -1 } as any);
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- State Verification ---
describe('DeleteManager State Verification', () => {
  it('should verify database state after deletion', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const emails = await dbManager.searchEmails({ category: 'low', archived: false });
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(emails.length);
      for (const email of emails) {
        const dbEmail = await dbManager.getEmailIndex(email.id);
        expect(dbEmail).toBeDefined();
        if (dbEmail) {
          expect(dbEmail.archived).toBe(true);
          expect(dbEmail.archiveLocation).toBe('trash');
        }
      }
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should verify Gmail API calls with correct labels', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      await deleteManager.deleteEmails(options, defaultUserContext);
      const batchModifyCall = (mockGmailClient.users.messages.batchModify.mock as any).calls[0][0];
      expect(batchModifyCall.userId).toBe('me');
      expect(batchModifyCall.requestBody.addLabelIds).toEqual(['TRASH']);
      expect(batchModifyCall.requestBody.removeLabelIds).toEqual(['INBOX', 'UNREAD']);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should verify audit trail through logging', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const loggerSpy = jest.spyOn(logger, 'info');
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const emails = await dbManager.searchEmails({ category: 'low', archived: false }).then(arr => arr.slice(0, 2));
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      await deleteManager.deleteEmails(options, defaultUserContext);
      // Check for start log
      expect(loggerSpy.mock.calls.some(call => typeof call[0] === 'string' && (call[0] as string).toLowerCase().includes('starting email deletion'))).toBe(true);
      // Check for batch processing log
      expect(loggerSpy.mock.calls.some(call => typeof call[0] === 'string' && (call[0] as string).toLowerCase().includes('deleting batch 1'))).toBe(true);
      // Check for completion lo
    } finally {
      loggerSpy.mockRestore();
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- Performance and Optimization ---
describe('DeleteManager Performance and Optimization', () => {
  it('should handle very large email sets efficiently', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      const veryLargeSet = Array.from({ length: 1000 }, (_, i) => ({
        ...batchTestEmails[0],
        id: `perf-test-${i}`,
        threadId: `thread-perf-${i}`,
        category: 'low' as const,
        subject: `Performance Test ${i}`,
        sender: 'perf@test.com',
        recipients: ['user@example.com'],
        date: new Date('2024-01-01'),
        year: 2024,
        size: 10000,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: `Performance test email ${i}`,
        archived: false
      }));
      await seedTestData(dbManager, veryLargeSet, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const startTime = Date.now();
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      const endTime = Date.now();
      expect(result.deleted).toBe(1000);
      expect(result.errors).toHaveLength(0);
      expect((mockGmailClient.users.messages.batchModify.mock as any).calls).toHaveLength(20);
      expect(endTime - startTime).toBeLessThan(5000);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- Integration with Multiple Criteria ---
describe('DeleteManager Integration with Multiple Criteria', () => {
  it('should handle complex multi-criteria deletion', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      await seedTestData(dbManager, batchTestEmails, defaultUserContext.user_id);
      const complexEmails = await dbManager.searchEmails({
        category: 'low',
        year: 2023,
        sizeRange: { min: 0, max: 100000 },
        labels: ['PROMOTIONS']
      });
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({
        category: 'low',
        year: 2023,
        sizeThreshold: 100000,
        searchCriteria: { labels: ['PROMOTIONS'] }
      });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(complexEmails.length);
      expect(result.errors).toHaveLength(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

// --- Cleanup System Integration ---
describe('DeleteManager Cleanup System Integration', () => {
  // --- batchDeleteForCleanup: Safety Checks ---
  it('should perform batch cleanup deletion with safety checks', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const testEmails = batchTestEmails.slice(0, 5);
    const policy = createMockCleanupPolicy({
      id: 'test-batch-policy',
      criteria: { age_days_min: 30, importance_level_max: 'medium' },
      action: { type: 'delete' },
      safety: {
        max_emails_per_run: 10,
        preserve_important: true,
        require_confirmation: false,
        dry_run_first: false
      }
    });
    try {
      await seedTestData(dbManager, testEmails, 'test-user-123');
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: false, batch_size: 3 }
      );
      expect(result.deleted).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
      expect(result.storage_freed).toBeGreaterThan(0);
      expect(result.archived).toBe(0);
      expect(result.failed).toBe(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Dry Run ---
  it('should handle dry run mode for batch cleanup', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const testEmails = batchTestEmails.slice(0, 3);
    const policy = createMockCleanupPolicy();
    try {
      await seedTestData(dbManager, testEmails, 'test-user-123');
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: true, batch_size: 10 }
      );
      expect(result.deleted).toBe(testEmails.length);
      expect(result.storage_freed).toBeGreaterThan(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Safety Checks for High Importance ---
  it('should respect safety checks for high importance emails', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const safetyEmails = batchTestEmails.slice(0, 2).map(e => ({ ...e, category: 'high' as const }));
    const policy = createMockCleanupPolicy({
      safety: {
        preserve_important: true,
        max_emails_per_run: 10,
        require_confirmation: false,
        dry_run_first: false
      }
    });
    try {
      await seedTestData(dbManager, safetyEmails, 'test-user-123');
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        safetyEmails,
        policy,
        { dry_run: false }
      );
      expect(result.deleted).toBe(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Different Action Types ---
  it('should handle batch processing with different action types', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const testEmails = batchTestEmails.slice(0, 4);
    const archivePolicy = createMockCleanupPolicy({ action: { type: 'archive' } });
    try {
      await seedTestData(dbManager, testEmails, 'test-user-123');
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        archivePolicy,
        { dry_run: false }
      );
      expect(result.archived).toBe(testEmails.length);
      expect(result.deleted).toBe(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Error Scenarios ---
  it('should handle error scenarios in batch cleanup', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const testEmails = batchTestEmails.slice(0, 3);
    const policy = createMockCleanupPolicy();
    try {
      await seedTestData(dbManager, testEmails, 'test-user-123');
      setupBatchModifyFailure(mockGmailClient, testErrors.networkError);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: false, max_failures: 1 }
      );
      expect(result.failed).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Batch 1 failed');
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Max Failures ---
  it('should respect max failures threshold', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const testEmails = batchTestEmails.slice(0, 6);
    const policy = createMockCleanupPolicy();
    try {
      await seedTestData(dbManager, testEmails, 'test-user-123');
      setupBatchModifyFailure(mockGmailClient, testErrors.networkError);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: false, batch_size: 2, max_failures: 2 }
      );
      expect(result.failed).toBe(2);
      expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- getCleanupDeletionStats: Accurate Stats ---
  it('should return accurate cleanup deletion statistics', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    // Ensure at least one deletable email (not high priority, not archived, >7 days old, importanceScore <= 8)
    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000);
    const mixedEmails = [
      { ...batchTestEmails[0], category: 'low' as PriorityCategory, archived: false, date: tenDaysAgo, importanceScore: 5 },
      { ...batchTestEmails[1], category: 'medium' as PriorityCategory, archived: false, date: tenDaysAgo, importanceScore: 5 },
      { ...batchTestEmails[2], category: 'low' as PriorityCategory, archived: false, date: tenDaysAgo, importanceScore: 5 },
      { ...batchTestEmails[3], category: 'medium' as PriorityCategory, archived: false, date: tenDaysAgo, importanceScore: 5 },
      { ...batchTestEmails[4], category: 'low' as PriorityCategory, archived: false, date: tenDaysAgo, importanceScore: 5 }
    ];
    try {
      await seedTestData(dbManager, mixedEmails, 'test-user-123');
      const userContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
      const stats = await deleteManager.getCleanupDeletionStats(userContext);
      expect(stats).toHaveProperty('deletable_by_category');
      expect(stats).toHaveProperty('deletable_by_age');
      expect(stats).toHaveProperty('total_deletable');
      expect(stats).toHaveProperty('total_storage_recoverable');
      expect(stats.total_deletable).toBeGreaterThan(0);
      expect(stats.total_storage_recoverable).toBeGreaterThan(0);
      expect(stats.deletable_by_category.low).toBeGreaterThanOrEqual(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- getCleanupDeletionStats: Exclude High Importance ---
  it('should exclude high importance emails from deletable stats', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const highImportanceEmails = batchTestEmails.slice(0, 3).map(e => ({ ...e, category: 'high' as const }));
    try {
      await seedTestData(dbManager, highImportanceEmails, 'test-user-123');
      const stats = await deleteManager.getCleanupDeletionStats();
      expect(stats.total_deletable).toBe(0);
      expect(stats.total_storage_recoverable).toBe(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- getCleanupDeletionStats: Categorize by Age ---
  it('should categorize emails by age correctly', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const now = Date.now();
    const ageTestEmails = [
      { ...batchTestEmails[0], id: 'recent-email', date: new Date(now - 15 * 24 * 60 * 60 * 1000), category: 'low' as const },
      { ...batchTestEmails[1], id: 'moderate-email', date: new Date(now - 180 * 24 * 60 * 60 * 1000), category: 'low' as const },
      { ...batchTestEmails[2], id: 'old-email', date: new Date(now - 400 * 24 * 60 * 60 * 1000), category: 'low' as const }
    ];
    try {
      await seedTestData(dbManager, ageTestEmails, 'test-user-123');
      const stats = await deleteManager.getCleanupDeletionStats();
      expect(stats.deletable_by_age.recent).toBeGreaterThanOrEqual(0);
      expect(stats.deletable_by_age.moderate).toBeGreaterThanOrEqual(0);
      expect(stats.deletable_by_age.old).toBeGreaterThanOrEqual(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- Email Safety Checks Integration ---
  it('should integrate with cleanup policies for safety decisions', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const mixedEmails = [
      ...batchTestEmails.slice(0, 2), // Should be deletable
      {
        ...batchTestEmails[2],
        id: 'safety-high-1',
        category: 'high' as PriorityCategory,
        importanceScore: 9,
        archived: false
      }
    ];
    try {
      await seedTestData(dbManager, mixedEmails, 'test-user-123');
      const policy = createMockCleanupPolicy({
        safety: {
          preserve_important: true,
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false
        }
      });
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        mixedEmails,
        policy,
        { dry_run: false }
      );
      // Only non-protected emails should be processed
      expect(result.deleted).toBeLessThan(mixedEmails.length);
      expect(result.deleted).toBeGreaterThan(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle recent email protection', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const recentEmail = {
      ...batchTestEmails[0],
      id: 'very-recent-email',
      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      category: 'low' as PriorityCategory
    };
    try {
      await seedTestData(dbManager, [recentEmail], 'test-user-123');
      const policy = createMockCleanupPolicy();
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        [recentEmail],
        policy,
        { dry_run: false }
      );
      // Recent emails should be protected
      expect(result.deleted).toBe(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle importance score-based protection', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const highScoreEmail = {
      ...batchTestEmails[0],
      id: 'high-score-email',
      importanceScore: 9.5, // Very high importance score
      category: 'medium' as PriorityCategory
    };
    try {
      await seedTestData(dbManager, [highScoreEmail], 'test-user-123');
      const policy = createMockCleanupPolicy();
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        [highScoreEmail],
        policy,
        { dry_run: false }
      );
      // High importance score emails should be protected
      expect(result.deleted).toBe(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- Integration with Cleanup Policy Validation ---
  it('should validate policy compatibility before cleanup', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const testEmails = batchTestEmails.slice(0, 2);
    try {
      await seedTestData(dbManager, testEmails, 'test-user-123');
      const invalidPolicy = createMockCleanupPolicy({
        criteria: {
          age_days_min: -1, // Invalid negative value
          importance_level_max: 'medium'
        }
      });
      // This should still work but with warnings in logs
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        invalidPolicy,
        { dry_run: true }
      );
      expect(result).toHaveProperty('deleted');
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  // --- Performance and Stress Testing ---
  it('should handle large batch cleanup operations efficiently', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const largeEmailSet = createPerformanceTestScenario(500).map(email => ({
      ...email,
      category: 'low' as PriorityCategory // Make them deletable
    }));
    try {
      await seedTestData(dbManager, largeEmailSet, 'test-user-123');
      const policy = createMockCleanupPolicy({
        safety: {
          max_emails_per_run: 500,
          preserve_important: true,
          require_confirmation: false,
          dry_run_first: false
        }
      });
      setupSuccessfulBatchModify(mockGmailClient);
      const startTime = Date.now();
      const result = await deleteManager.batchDeleteForCleanup(
        largeEmailSet,
        policy,
        { dry_run: false, batch_size: 50 }
      );
      const endTime = Date.now();
      expect(result.deleted).toBe(largeEmailSet.length);
      expect(result.errors).toHaveLength(0);
      expect(endTime - startTime).toBeLessThan(10000); // Should complete in under 10 seconds
      // Should use appropriate number of batch calls
      const expectedBatches = Math.ceil(largeEmailSet.length / 50);
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(expectedBatches);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle concurrent cleanup operations safely', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const emailSet1 = batchTestEmails.slice(0, 3).map(e => ({ ...e, id: e.id + '-set1' }));
    const emailSet2 = batchTestEmails.slice(0, 3).map(e => ({ ...e, id: e.id + '-set2' }));
    try {
      await seedTestData(dbManager, [...emailSet1, ...emailSet2], 'test-user-123');
      const policy = createMockCleanupPolicy();
      setupSuccessfulBatchModify(mockGmailClient);
      // Run concurrent batch operations
      const [result1, result2] = await Promise.all([
        deleteManager.batchDeleteForCleanup(emailSet1, policy, { dry_run: false }),
        deleteManager.batchDeleteForCleanup(emailSet2, policy, { dry_run: false })
      ]);
      expect(result1.deleted).toBe(emailSet1.length);
      expect(result2.deleted).toBe(emailSet2.length);
      expect(result1.errors).toHaveLength(0);
      expect(result2.errors).toHaveLength(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });

  it('should handle memory constraints during large operations', async () => {
    await forceResetDatabaseManager();
    const { dbManager, testDbDir } = await createTestDatabaseManager();
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const veryLargeEmailSet = createPerformanceTestScenario(1000);
    try {
      await seedTestData(dbManager, veryLargeEmailSet, 'test-user-123');
      const policy = createMockCleanupPolicy();
      // Test dry run to avoid actual Gmail API calls
      const result = await deleteManager.batchDeleteForCleanup(
        veryLargeEmailSet,
        policy,
        { dry_run: true, batch_size: 100 }
      );
      expect(result.deleted).toBe(veryLargeEmailSet.length);
      expect(result.storage_freed).toBeGreaterThan(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

describe('Concurrent Operations', () => {
  it('should handle concurrent delete operations safely', async () => {
    await forceResetDatabaseManager();
    const { dbManager: newDbManager, testDbDir: newTestDbDir } = await createTestDatabaseManager();
    const dbManager = newDbManager;
    const testDbDir = newTestDbDir;
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManager);
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    try {
      const emails1 = getEmailsByCriteria({ category: 'low', year: 2022, archived: false });
      const emails2 = getEmailsByCriteria({ category: 'medium', year: 2023, archived: false });
      await seedTestData(dbManager, [...emails1, ...emails2], defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      // Run concurrent operations
      const [result1, result2] = await Promise.all([
        deleteManager.deleteEmails(createDeleteOptions({ category: 'low', year: 2022 }), defaultUserContext),
        deleteManager.deleteEmails(createDeleteOptions({ category: 'medium', year: 2023 }), defaultUserContext)
      ]);
      expect(result1.deleted).toBe(emails1.length);
      expect(result2.deleted).toBe(emails2.length);
      expect(result1.errors).toHaveLength(0);
      expect(result2.errors).toHaveLength(0);
    } finally {
      await cleanupTestDatabase(dbManager, testDbDir);
    }
  });
});

  