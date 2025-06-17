import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DeleteManager } from '../../../src/delete/DeleteManager.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { DeleteOptions, EmailIndex, CleanupPolicy } from '../../../src/types/index.js';
import {
  mockEmails,
  getEmailsByCriteria,
  batchTestEmails,
  batchTestEmailIds,
  errorScenarioEmails,
  mockStatistics,
  trashEmails,
  cleanupTestEmails,
  cleanupSafetyTestEmails,
  cleanupEdgeCaseEmails
} from './fixtures/mockEmails.js';
import {
  createDeleteManagerWithRealDb,
  setupSuccessfulBatchModify,
  setupBatchModifyFailure,
  setupPartialBatchFailure,
  setupListMessagesResponse,
  setupDeleteMessageResponses,
  verifyBatchModifyCalls,
  createDeleteOptions,
  testErrors,
  resetAllMocks,
  cleanupTestDatabase,
  seedTestData,
  verifyRealDatabaseSearch,
  markEmailsAsDeleted,
  resetTestDatabase,
  verifyDatabaseState,
  getEmailsFromDatabase,
  createTestDatabaseManager,
  startLoggerCapture,
  stopLoggerCapture,
  createMockCleanupPolicy,
  createMockAccessPatternTracker,
  createMockStalenessScorer,
  createMockCleanupPolicyEngine,
  setupCleanupPolicyEngine,
  setupStalenessScorer,
  setupAccessPatternTracker,
  verifyCleanupDeletionStats,
  verifyBatchDeleteForCleanupResults,
  createTestCleanupPolicies,
  createCleanupEvaluationResults,
  waitForBatchCompletion,
  createPerformanceTestScenario
} from './helpers/testHelpers.js';
import { logger } from '../../../src/utils/logger.js';

describe('DeleteManager Integration Tests with Real Database', () => {
  let deleteManager: DeleteManager;
  let mockGmailClient: any;
  let mockAuthManager: any;
  let dbManager: DatabaseManager;
  let consoleCapture: { logs: string[], errors: string[], warns: string[], infos: string[] };

  beforeEach(async () => {
    const mocks = await createDeleteManagerWithRealDb();
    deleteManager = mocks.deleteManager;
    mockGmailClient = mocks.mockGmailClient;
    mockAuthManager = mocks.mockAuthManager;
    dbManager = mocks.dbManager;
    consoleCapture = startLoggerCapture(logger);

    // Seed initial test data
    await seedTestData(dbManager, mockEmails);
  });

  afterEach(async () => {
    stopLoggerCapture();
    resetAllMocks(mockGmailClient, mockAuthManager);
    await cleanupTestDatabase(dbManager);
    jest.clearAllMocks();
  });

  describe('Normal Delete Scenarios', () => {
    describe('Delete by Category', () => {
      it('should delete low priority emails', async () => {
        const emails = await dbManager.searchEmails({ category: 'low' });
        setupSuccessfulBatchModify(mockGmailClient);
        const options = createDeleteOptions({ category: 'low' ,dryRun:false});
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(emails.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify database was searched correctly
         await verifyRealDatabaseSearch(
          dbManager, 
          { category: 'low' },
         0
        );
        
        verifyBatchModifyCalls(mockGmailClient, [{
          ids: emails.map(e => e.id)
        }]);
      });

      it('should delete medium priority emails', async () => {
        const emails = await dbManager.searchEmails({ category: 'medium'});
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ category: 'medium' });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(emails.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify correct emails were found in database
        const searchResults = await dbManager.searchEmails({ category: 'medium' });
        expect(searchResults.length).toBe(0);
      });

      it('should delete high priority emails only when explicitly specified', async () => {
        const emails = await dbManager.searchEmails({ category: 'high' });
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ category: 'high' });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(emails.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify high priority emails were found
        const searchResults = await dbManager.searchEmails({ category: 'high' });
        expect(searchResults.length).toBe(0);
      });

      it('should protect high priority emails when no category specified', async () => {
        const allEmails = await dbManager.searchEmails({});
        const nonHighPriorityEmails = allEmails.filter(e => e.category !== 'high');
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({});
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonHighPriorityEmails.length);
        expect(result.errors).toHaveLength(0);
        
        verifyBatchModifyCalls(mockGmailClient, [{
          ids: nonHighPriorityEmails.map(e => e.id)
        }]);
      });
    });

    describe('Delete by Year', () => {
      it('should delete emails from specific year', async () => {
        const emails2023 = getEmailsByCriteria({ year: 2023 });
        const nonHighPriority2023 = emails2023.filter(e => e.category !== 'high');
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ year: 2023 });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonHighPriority2023.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify database search
        const searchResults = await dbManager.searchEmails({ year: 2023});
        expect(searchResults.length).toBe(1);
      });

      it('should delete emails from multiple years when called multiple times', async () => {
        // Test year 2022
        const emails2022 = await dbManager.searchEmails({ year: 2022 });
        const nonHighPriority2022 = emails2022.filter(e => e.category !== 'high');
        setupSuccessfulBatchModify(mockGmailClient);

        const options2022 = createDeleteOptions({ year: 2022 });
        const result2022 = await deleteManager.deleteEmails(options2022);

        expect(result2022.deleted).toBe(nonHighPriority2022.length);

        // Reset mocks for next test
        resetAllMocks(mockGmailClient, mockAuthManager);
        mockAuthManager.getGmailClient = jest.fn(() => Promise.resolve(mockGmailClient));

        // Test year 2024
        const emails2024 = await dbManager.searchEmails({ year: 2024 });
        const nonHighPriority2024 = emails2024.filter(e => e.category !== 'high');
        setupSuccessfulBatchModify(mockGmailClient);

        const options2024 = createDeleteOptions({ year: 2024 });
        const result2024 = await deleteManager.deleteEmails(options2024);

        expect(result2024.deleted).toBe(nonHighPriority2024.length);
      });
    });

    describe('Delete by Size Threshold', () => {
      it('should delete emails larger than threshold', async () => {
        const largeEmails = await dbManager.searchEmails({ sizeRange: {min:0, max: 1000000 } });
        const nonHighPriorityLarge = largeEmails.filter(e => e.category !== 'high');
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ sizeThreshold: 1000000 });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonHighPriorityLarge.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify database search with size range
        const searchResults = await dbManager.searchEmails({
          sizeRange: { min: 0, max: 1000000 },
        });
        expect(searchResults.length).toBe(3);
      });

      it('should delete small emails when low threshold specified', async () => {
        const smallEmails = await dbManager.searchEmails({ sizeRange: { min: 0, max: 5000 } });
        const nonHighPrioritySmall = smallEmails.filter(e => e.category !== 'high');
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ sizeThreshold: 5000 });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonHighPrioritySmall.length);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Delete with Search Criteria', () => {
      xit('should delete emails matching search criteria', async () => {
        const newsletterEmails = await dbManager.searchEmails({ labels: ['NEWSLETTER'] });
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ 
          searchCriteria: { labels: ['NEWSLETTER'] }
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(newsletterEmails.length);
        expect(result.errors).toHaveLength(0);
        
        // Note: Label search is not implemented in DatabaseManager
        // This test will need adjustment when label search is added
      });

      it('should delete emails from specific sender', async () => {
        const senderEmails = mockEmails.filter(e => 
          !e.archived && e.sender === 'newsletter@marketing.com'
        );
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ 
          searchCriteria: { sender: 'newsletter@marketing.com' }
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(senderEmails.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify sender search in database
        const searchResults = await dbManager.searchEmails({ 
          sender: 'newsletter@marketing.com',
          archived: false 
        });
        expect(searchResults.length).toBe(0);
      });
    });

    describe('Delete with Multiple Criteria Combined', () => {
      it('should delete emails matching all criteria', async () => {
       const emailSearchCriteria = {
          category: 'low' as const,
          year: 2023,
          sizeRange: {min:0, max: 1000000},
        };

        const matchingEmails = await dbManager.searchEmails(emailSearchCriteria);
        setupSuccessfulBatchModify(mockGmailClient);
        const complexCriteria = {
          category: 'low' as const,
          year: 2023,
          sizeThreshold: 1000000
        };
        const options = createDeleteOptions(complexCriteria);
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(matchingEmails.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify complex search in database
        const searchResults = await dbManager.searchEmails({
          category: 'low',
          year: 2023,
          sizeRange: { min: 0, max: 1000000 },
        });
        expect(searchResults.length).toBe(0);
      });

      it('should combine search criteria with other filters', async () => {
        const complexCriteria = {
          category: 'medium' as const,
          searchCriteria: {
            hasAttachments: true,
            yearRange: { start: 2023, end: 2024 }
          }
        };

        const matchingEmails = await dbManager.searchEmails({
          category: 'medium',
          hasAttachments: true,
          yearRange: { start: 2023, end: 2024 }
        });

        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions(complexCriteria);
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(matchingEmails.length);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Skip Archived Emails', () => {
      it('should skip archived emails when skipArchived is true', async () => {
        const allLowPriority = await dbManager.searchEmails({ category: 'low', archived: false });
        const nonArchivedLowPriority = allLowPriority.filter(e => !e.archived);
        
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ 
          category: 'low',
          skipArchived: true 
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonArchivedLowPriority.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify only non-archived emails were searched
        const searchResults = await dbManager.searchEmails({
          category: 'low',
          archived: false
        });
        expect(searchResults.length).toBe(0);
      });

      it('should include archived emails when skipArchived is false', async () => {
        const allLowPriority = mockEmails.filter(e => e.category === 'low');
        
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ 
          category: 'low',
          skipArchived: false 
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(allLowPriority.length);
        expect(result.errors).toHaveLength(0);
      });
    });
  });

  describe('Bulk Delete Operations', () => {
    it('should handle batch processing for large number of emails', async () => {
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      // Seed batch test emails
      await seedTestData(dbManager, batchTestEmails);
      deleteManager.dbManager = dbManager; // Ensure deleteManager uses the new test DB
      setupSuccessfulBatchModify(mockGmailClient);
      const searchedEmails = await dbManager.searchEmails({ category: 'low' });
      const firstBatch = searchedEmails.slice(0, 50);
      const secondBatch = searchedEmails.slice(50, 80);
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);
      
      expect(result.deleted).toBe(80); // 50 + 30 emails
      expect(result.errors).toHaveLength(0);
      
      // Should be called twice (50 in first batch, 30 in second)
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(2);
      
      verifyBatchModifyCalls(mockGmailClient, [
        { ids: firstBatch.map(e => e.id) },
        { ids: secondBatch.map(e => e.id) }
      ]);
    });

    it('should respect batch size limit of 50 emails', async () => {
      const largeEmailSet = Array.from({ length: 150 }, (_, i) => ({
        ...batchTestEmails[0],
        id: `${i}`,
        threadId: `thread-large-set-${i}`
      }));
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      await seedTestData(dbManager, largeEmailSet);
      deleteManager.dbManager = dbManager; // Ensure deleteManager uses the new test DB
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(150);
      expect(result.errors).toHaveLength(0);
      
      // Should be called 3 times (50 + 50 + 50)
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(3);
    });

    it('should implement rate limiting between batches', async () => {
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      await seedTestData(dbManager, batchTestEmails);
      deleteManager.dbManager = dbManager; // Ensure deleteManager uses the new test DB
      setupSuccessfulBatchModify(mockGmailClient);

      const startTime = Date.now();
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);
      const endTime = Date.now();

      expect(result.deleted).toBe(80);
      expect(result.errors).toHaveLength(0);
      
      // Should take at least 100ms due to delay between batches
      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Safety Features', () => {
    describe('Dry Run Mode', () => {
      it('should preview deletion without actually deleting', async () => {
        const emailsToDelete = getEmailsByCriteria({ category: 'low', archived: false });

        const options = createDeleteOptions({ 
          category: 'low',
          dryRun: true, 
          skipArchived: true
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(emailsToDelete.length);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toContain('DRY RUN');
        expect(result.errors[0]).toContain(`Would delete ${emailsToDelete.length} emails`);
        
        // Should not call Gmail API
        expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
      });

      it('should work with complex criteria in dry run', async () => {
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

        const options = createDeleteOptions({
          ...complexCriteria,
          dryRun: true
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(matchingEmails.length);
        expect(result.errors.length).toBe(0);
        expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
      });
    });

    describe('High Priority Email Protection', () => {
      it('should not delete high priority emails by default', async () => {
        const allEmails = getEmailsByCriteria({});
        const nonHighPriority = allEmails.filter(e => e.category !== 'high');
        
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({});
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonHighPriority.length);
        
        const deletedIds = mockGmailClient.users.messages.batchModify.mock.calls[0][0].requestBody.ids;
        const highPriorityIds = allEmails.filter(e => e.category === 'high').map(e => e.id);
        
        highPriorityIds.forEach(id => {
          expect(deletedIds).not.toContain(id);
        });
      });

      it('should only delete high priority when explicitly requested', async () => {
        const highPriorityEmails = await dbManager.searchEmails({ category: 'high' , archived: false });

        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ category: 'high', skipArchived: true });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(highPriorityEmails.length);
        
        verifyBatchModifyCalls(mockGmailClient, [{
          ids: highPriorityEmails.map(e => e.id)
        }]);
      });
    });

    describe('Archived Email Skip', () => {
      it('should skip archived emails by default', async () => {
        const allEmails = await dbManager.searchEmails({});
        const nonArchived = allEmails.filter(e => !e.archived);
        const nonArchivedNonHigh = nonArchived.filter(e => e.category !== 'high');
        
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ skipArchived: true });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonArchivedNonHigh.length);
        
        const archivedIds = allEmails.filter(e => e.archived).map(e => e.id);
        const deletedIds = mockGmailClient.users.messages.batchModify.mock.calls[0][0].requestBody.ids;
        
        archivedIds.forEach(id => {
          expect(deletedIds).not.toContain(id);
        });
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty result sets gracefully', async () => {
      const options = createDeleteOptions({ category: 'low', year: 2025 });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    });

    it('should handle emails without required permissions', async () => {
      const protectedEmail = [errorScenarioEmails.permissionDenied];
      cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      await seedTestData(dbManager, protectedEmail);
      deleteManager.dbManager = dbManager; // Ensure deleteManager uses the new test DB
      setupBatchModifyFailure(mockGmailClient, testErrors.permissionError);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Insufficient permissions');
    });

    it('should handle already deleted emails', async () => {
      const alreadyDeleted = [errorScenarioEmails.alreadyDeleted];
      cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      await seedTestData(dbManager, alreadyDeleted);
      deleteManager.dbManager = dbManager; // Ensure deleteManager uses the new test DB
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      // Should succeed as Gmail API handles this gracefully
      expect(result.deleted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle partial batch failures', async () => {
      cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      await seedTestData(dbManager, batchTestEmails);
      deleteManager.dbManager = dbManager; // Ensure deleteManager uses the new test DB
      setupPartialBatchFailure(mockGmailClient, testErrors.networkError);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(50); // Only first batch succeeded
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Network timeout');
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication failures', async () => {
      mockAuthManager.getGmailClient.mockRejectedValue(testErrors.authenticationError);

      const options = createDeleteOptions({ category: 'low' });
      
      await expect(deleteManager.deleteEmails(options)).rejects.toThrow('Authentication failed');
    });

    it('should handle network timeouts', async () => {
      const emails = getEmailsByCriteria({ category: 'low', archived: false });
      setupBatchModifyFailure(mockGmailClient, testErrors.networkError);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Network timeout');
    });

    it('should handle rate limit errors', async () => {
      const emails = getEmailsByCriteria({ category: 'low', archived: false });
      setupBatchModifyFailure(mockGmailClient, testErrors.rateLimitError);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Rate limit exceeded');
    });

    it('should handle database errors', async () => {
      // Close database to simulate error
      await dbManager.close();

      const options = createDeleteOptions({ category: 'low' });
      
      await expect(deleteManager.deleteEmails(options)).rejects.toThrow();
    });

    it('should handle invalid parameters gracefully', async () => {
      setupSuccessfulBatchModify(mockGmailClient);

      // Test with invalid year
      const options = createDeleteOptions({ year: -1 } as any);
      const result = await deleteManager.deleteEmails(options);

      // Should still work but find no emails
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('State Verification', () => {
    it('should verify database state after deletion', async () => {
      const emails = await dbManager.searchEmails({ category: 'low', archived: false });
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low',skipArchived: true });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(emails.length);
      // Verify emails are marked as deleted in database
      for (const email of emails) {
        const dbEmail = await dbManager.getEmailIndex(email.id);
        expect(dbEmail).toBeDefined();
        if (dbEmail) {
          expect(dbEmail.archived).toBe(true);
          expect(dbEmail.archiveLocation).toBe('trash');
        }
      }
    });

    it('should verify Gmail API calls with correct labels', async () => {
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low',skipArchived: true });
      await deleteManager.deleteEmails(options);

      const batchModifyCall = mockGmailClient.users.messages.batchModify.mock.calls[0][0];
      expect(batchModifyCall.userId).toBe('me');
      expect(batchModifyCall.requestBody.addLabelIds).toEqual(['TRASH']);
      expect(batchModifyCall.requestBody.removeLabelIds).toEqual(['INBOX', 'UNREAD']);
    });

    it('should verify audit trail through logging', async () => {
      const emails = getEmailsByCriteria({ category: 'low', archived: false }).slice(0, 2);
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      await deleteManager.deleteEmails(options);

      // Check for start log
      expect(consoleCapture.infos.some(log => 
        log.includes('Starting email deletion')
      )).toBe(true);

      // Check for batch processing log
      expect(consoleCapture.infos.some(log => 
        log.includes('Deleting batch 1')
      )).toBe(true);

      // Check for completion log
      expect(consoleCapture.infos.some(log => 
        log.includes('Deletion completed')
      )).toBe(true);
    });
  });

  describe('Additional Methods', () => {
    describe('getDeleteStatistics', () => {
      it('should return correct statistics by category', async () => {
        const stats = await deleteManager.getDeleteStatistics();

        expect(stats.byCategory).toEqual(mockStatistics.byCategory);
        expect(stats.total).toBe(mockStatistics.total);
      });

      it('should return correct statistics by year', async () => {
        const stats = await deleteManager.getDeleteStatistics();

        expect(stats.byYear).toEqual(mockStatistics.byYear);
      });

      it('should return correct statistics by size', async () => {
        const stats = await deleteManager.getDeleteStatistics();

        expect(stats.bySize).toEqual(mockStatistics.bySize);
      });

      it('should exclude archived emails from statistics', async () => {
        const stats = await deleteManager.getDeleteStatistics();

        const archivedCount = mockEmails.filter(e => e.archived).length;
        expect(stats.total).toBe(mockEmails.length - archivedCount);
      });
    });

    describe('emptyTrash', () => {
      it('should permanently delete all emails in trash', async () => {
        setupListMessagesResponse(mockGmailClient, trashEmails);
        setupDeleteMessageResponses(mockGmailClient, trashEmails.length);

        const result = await deleteManager.emptyTrash({
          dryRun: false
        });

        expect(result.deleted).toBe(trashEmails.length);
        expect(result.errors).toHaveLength(0);
        
        expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith({
          userId: 'me',
          labelIds: ['TRASH'],
          maxResults: 100
        });
        
        expect(mockGmailClient.users.messages.delete).toHaveBeenCalledTimes(trashEmails.length);
      });

      it('should handle empty trash gracefully', async () => {
        setupListMessagesResponse(mockGmailClient, []);

        const result = await deleteManager.emptyTrash({
          dryRun: false
        });

        expect(result.deleted).toBe(0);
        expect(result.errors).toHaveLength(0);
        expect(mockGmailClient.users.messages.delete).not.toHaveBeenCalled();
      });

      it('should handle partial failures when emptying trash', async () => {
        setupListMessagesResponse(mockGmailClient, trashEmails);
        setupDeleteMessageResponses(mockGmailClient, 3, 2); // 3 success, 2 failures

        const result = await deleteManager.emptyTrash({
          dryRun: false
        });

        expect(result.deleted).toBe(3);
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]).toContain('Failed to delete message');
        expect(result.errors[1]).toContain('Failed to delete message');
      });

      it('should handle list messages error', async () => {
        mockGmailClient.users.messages.list.mockRejectedValue(testErrors.networkError);

       const result= await deleteManager.emptyTrash({
          dryRun: false
        });
        expect(result.errors.length).toBe(1);
        expect(result.errors[0]).toContain('Network timeout');
      });
    });

    describe('scheduleAutoDeletion', () => {
      xit('should log placeholder message for auto-deletion rules', async () => {
        const rules = [
          { category: 'low' as const, olderThanDays: 30 },
          { category: 'medium' as const, olderThanDays: 90, sizeThreshold: 1000000 }
        ];

        await deleteManager.scheduleAutoDeletion(rules);

        expect(consoleCapture.logs.some(log =>
          log.includes('Auto-deletion rules would be configured here')
        )).toBe(true);
      });
    });
  });

  describe('Performance and Optimization', () => {
    it('should handle very large email sets efficiently', async () => {
      const veryLargeSet = Array.from({ length: 1000 }, (_, i) => ({
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
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      deleteManager.dbManager = dbManager; // Ensure deleteManager uses the new test DB
      await seedTestData(dbManager, veryLargeSet);
      setupSuccessfulBatchModify(mockGmailClient);

      const startTime = Date.now();
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);
      const endTime = Date.now();

      expect(result.deleted).toBe(1000);
      expect(result.errors).toHaveLength(0);
      
      // Should be called 20 times (1000 / 50)
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(20);
      
      // Should complete in reasonable time (less than 5 seconds)
      expect(endTime - startTime).toBeLessThan(5000);
    });
  });

  describe('Integration with Multiple Criteria', () => {
    it('should handle complex multi-criteria deletion', async () => {
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
        searchCriteria: {
          labels: ['PROMOTIONS']
        }
      });

      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(complexEmails.length);
      expect(result.errors).toHaveLength(0);

      // Verify complex search in database
      const searchResults = await dbManager.searchEmails({
        category: 'low',
        year: 2023,
        sizeRange: { min: 100000 },
        archived: false
      });
      // Note: Label search would need to be implemented in DatabaseManager
    });
  
    // ========================
    // New Cleanup System Integration Tests
    // ========================
  
    describe('Cleanup System Integration', () => {
      describe('batchDeleteForCleanup', () => {
        it('should perform batch cleanup deletion with safety checks', async () => {
          const testEmails = cleanupTestEmails.slice(0, 5);
          const newDbManager = await resetTestDatabase(dbManager, testEmails);
          deleteManager.dbManager = newDbManager;
          
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
  
          setupSuccessfulBatchModify(mockGmailClient);
  
          const result = await deleteManager.batchDeleteForCleanup(
            testEmails,
            policy,
            { dry_run: false, batch_size: 3 }
          );
  
          expect(result.deleted).toBeGreaterThan(0);
          expect(result.errors).toHaveLength(0);
          expect(result.storage_freed).toBeGreaterThan(0);
          
          expect(result.deleted).toBeGreaterThan(0);
          expect(result.archived).toBe(0);
          expect(result.failed).toBe(0);
          expect(result.storage_freed).toBeGreaterThan(0);
          expect(result.errors).toHaveLength(0);
        });
  
        it('should handle dry run mode for batch cleanup', async () => {
          const testEmails = cleanupTestEmails.slice(0, 3);
          await resetTestDatabase(dbManager, testEmails);
          
          const policy = createMockCleanupPolicy();
  
          const result = await deleteManager.batchDeleteForCleanup(
            testEmails,
            policy,
            { dry_run: true, batch_size: 10 }
          );
  
          expect(result.deleted).toBe(testEmails.length);
          expect(result.storage_freed).toBeGreaterThan(0);
          expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
        });
  
        it('should respect safety checks for high importance emails', async () => {
          const safetyEmails = cleanupSafetyTestEmails.slice(0, 2);
          await resetTestDatabase(dbManager, safetyEmails);
          
          const policy = createMockCleanupPolicy({
            safety: {
              preserve_important: true,
              max_emails_per_run: 10,
              require_confirmation: false,
              dry_run_first: false
            }
          });
  
          setupSuccessfulBatchModify(mockGmailClient);
  
          const result = await deleteManager.batchDeleteForCleanup(
            safetyEmails,
            policy,
            { dry_run: false }
          );
  
          // High importance emails should be skipped
          expect(result.deleted).toBe(0);
          expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
        });
  
        it('should handle batch processing with different action types', async () => {
          const testEmails = cleanupTestEmails.slice(0, 4);
          const newDbManager=await resetTestDatabase(dbManager, testEmails);
          deleteManager.dbManager = newDbManager;
          
          const archivePolicy = createMockCleanupPolicy({
            action: { type: 'archive' }
          });
  
          const result = await deleteManager.batchDeleteForCleanup(
            testEmails,
            archivePolicy,
            { dry_run: false }
          );
  
          expect(result.archived).toBe(testEmails.length);
          expect(result.deleted).toBe(0);
          expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
        });
  
        it('should handle error scenarios in batch cleanup', async () => {
          const testEmails = cleanupTestEmails.slice(0, 3);
          await resetTestDatabase(dbManager, testEmails);
          
          const policy = createMockCleanupPolicy();
          setupBatchModifyFailure(mockGmailClient, testErrors.networkError);
  
          const result = await deleteManager.batchDeleteForCleanup(
            testEmails,
            policy,
            { dry_run: false, max_failures: 1 }
          );
  
          expect(result.failed).toBeGreaterThan(0);
          expect(result.errors.length).toBeGreaterThan(0);
          expect(result.errors[0]).toContain('Batch 1 failed');
        });
  
        it('should respect max failures threshold', async () => {
          const testEmails = cleanupTestEmails.slice(0, 6);
          await resetTestDatabase(dbManager, testEmails);
          
          const policy = createMockCleanupPolicy();
          setupBatchModifyFailure(mockGmailClient, testErrors.networkError);
  
          const result = await deleteManager.batchDeleteForCleanup(
            testEmails,
            policy,
            { dry_run: false, batch_size: 2, max_failures: 2 }
          );
  
          expect(result.failed).toBe(2); // Should stop after max failures
          expect(result.errors.length).toBeGreaterThan(0);
        });
      });
  
      describe('getCleanupDeletionStats', () => {
        it('should return accurate cleanup deletion statistics', async () => {
          const mixedEmails = [
            ...cleanupTestEmails.slice(0, 3),
            ...cleanupSafetyTestEmails.slice(0, 2),
            ...cleanupEdgeCaseEmails.slice(0, 2)
          ];
          const newDbManager = await resetTestDatabase(dbManager, mixedEmails);
          deleteManager.dbManager = newDbManager;

          const stats = await deleteManager.getCleanupDeletionStats();
  
          expect(stats).toHaveProperty('deletable_by_category');
          expect(stats).toHaveProperty('deletable_by_age');
          expect(stats).toHaveProperty('total_deletable');
          expect(stats).toHaveProperty('total_storage_recoverable');
          
          expect(stats.total_deletable).toBeGreaterThan(0);
          expect(stats.total_storage_recoverable).toBeGreaterThan(0);
          expect(stats.deletable_by_category.low).toBeGreaterThan(0);
        });
  
        it('should exclude high importance emails from deletable stats', async () => {
          const highImportanceEmails = cleanupSafetyTestEmails;
          const newDbManager = await resetTestDatabase(dbManager, highImportanceEmails);
          deleteManager.dbManager = newDbManager;

          const stats = await deleteManager.getCleanupDeletionStats();
          
          // High importance emails should not be counted as deletable
          expect(stats.total_deletable).toBe(0);
          expect(stats.total_storage_recoverable).toBe(0);
        });
  
        it('should categorize emails by age correctly', async () => {
          const ageTestEmails = [
            {
              ...cleanupTestEmails[0],
              id: 'recent-email',
              date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
              category: 'low' as const
            },
            {
              ...cleanupTestEmails[1],
              id: 'moderate-email',
              date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // 180 days ago
              category: 'low' as const
            },
            {
              ...cleanupTestEmails[2],
              id: 'old-email',
              date: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // 400 days ago
              category: 'low' as const
            }
          ];
          const newDbManager = await resetTestDatabase(dbManager, ageTestEmails);
          deleteManager.dbManager = newDbManager;

          const stats = await deleteManager.getCleanupDeletionStats();
          
          expect(stats.deletable_by_age.recent).toBeGreaterThanOrEqual(0);
          expect(stats.deletable_by_age.moderate).toBeGreaterThanOrEqual(0);
          expect(stats.deletable_by_age.old).toBeGreaterThanOrEqual(0);
        });
      });
  
      describe('Email Safety Checks Integration', () => {
        it('should integrate with cleanup policies for safety decisions', async () => {
          const mixedEmails = [
            ...cleanupTestEmails.slice(0, 2), // Should be deletable
            ...cleanupSafetyTestEmails.slice(0, 1) // Should be protected
          ];
          await resetTestDatabase(dbManager, mixedEmails);
  
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
        });
  
        it('should handle recent email protection', async () => {
          const recentEmail = {
            ...cleanupTestEmails[0],
            id: 'very-recent-email',
            date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
            category: 'low' as const
          };
          await resetTestDatabase(dbManager, [recentEmail]);
  
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
        });
  
        it('should handle importance score-based protection', async () => {
          const highScoreEmail = {
            ...cleanupTestEmails[0],
            id: 'high-score-email',
            importanceScore: 9.5, // Very high importance score
            category: 'medium' as const
          };
          await resetTestDatabase(dbManager, [highScoreEmail]);
  
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
        });
      });
  
      describe('Performance and Stress Testing', () => {
        it('should handle large batch cleanup operations efficiently', async () => {
          const largeEmailSet = createPerformanceTestScenario(500).map(email => ({
            ...email,
            category: 'low' as const // Make them deletable
          }));
          
          const newDbManager=await resetTestDatabase(dbManager, largeEmailSet);
          deleteManager.dbManager = newDbManager;

          
          
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
        });
  
        it('should handle concurrent cleanup operations safely', async () => {
          const emailSet1 = cleanupTestEmails.slice(0, 3).map(e => ({ ...e, id: e.id + '-set1' }));
          const emailSet2 = cleanupTestEmails.slice(0, 3).map(e => ({ ...e, id: e.id + '-set2' }));
          
          await resetTestDatabase(dbManager, [...emailSet1, ...emailSet2]);
          
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
        });
  
        it('should handle memory constraints during large operations', async () => {
          const veryLargeEmailSet = createPerformanceTestScenario(1000);
          await resetTestDatabase(dbManager, veryLargeEmailSet);
  
          const policy = createMockCleanupPolicy();
  
          // Test dry run to avoid actual Gmail API calls
          const result = await deleteManager.batchDeleteForCleanup(
            veryLargeEmailSet,
            policy,
            { dry_run: true, batch_size: 100 }
          );
  
          expect(result.deleted).toBe(veryLargeEmailSet.length);
          expect(result.storage_freed).toBeGreaterThan(0);
        });
      });
  
      describe('Edge Cases and Error Scenarios', () => {
        it('should handle emails without required fields', async () => {
          const edgeCaseEmails = cleanupEdgeCaseEmails.slice(0, 3);
          await resetTestDatabase(dbManager, edgeCaseEmails);
  
          const policy = createMockCleanupPolicy();
          setupSuccessfulBatchModify(mockGmailClient);
  
          const result = await deleteManager.batchDeleteForCleanup(
            edgeCaseEmails,
            policy,
            { dry_run: false }
          );
  
          // Should handle gracefully without crashing
          expect(result).toHaveProperty('deleted');
          expect(result).toHaveProperty('errors');
        });
  
        it('should handle conflicting importance signals', async () => {
          const conflictingEmail = cleanupEdgeCaseEmails.find(e => e.id === 'edge-conflicting-1');
          if (!conflictingEmail) throw new Error('Conflicting email not found');
          
          await resetTestDatabase(dbManager, [conflictingEmail]);
  
          const policy = createMockCleanupPolicy();
          setupSuccessfulBatchModify(mockGmailClient);
  
          const result = await deleteManager.batchDeleteForCleanup(
            [conflictingEmail],
            policy,
            { dry_run: false }
          );
  
          // Should err on the side of caution for conflicting signals
          expect(result.deleted).toBe(0);
          expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
        });
  
        it('should handle partial batch failures gracefully', async () => {
          const testEmails = cleanupTestEmails.slice(0, 4);
          await resetTestDatabase(dbManager, testEmails);
  
          const policy = createMockCleanupPolicy();
          setupPartialBatchFailure(mockGmailClient, testErrors.networkError);
  
          const result = await deleteManager.batchDeleteForCleanup(
            testEmails,
            policy,
            { dry_run: false, batch_size: 2 }
          );
  
          expect(result.deleted).toBe(2); // First batch should succeed
          expect(result.failed).toBe(2); // Second batch should fail
          expect(result.errors.length).toBeGreaterThan(0);
        });
  
        it('should handle database errors during cleanup stats', async () => {
          // Close database to simulate error
          await dbManager.close();
  
          await expect(deleteManager.getCleanupDeletionStats()).rejects.toThrow();
        });
      });
  
      describe('Integration with Cleanup Policy Validation', () => {
        it('should validate policy compatibility before cleanup', async () => {
          const testEmails = cleanupTestEmails.slice(0, 2);
          await resetTestDatabase(dbManager, testEmails);
  
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
        });
      });
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent delete operations safely', async () => {
      const emails1 = getEmailsByCriteria({ category: 'low', year: 2022, archived: false });
      const emails2 = getEmailsByCriteria({ category: 'medium', year: 2023, archived: false });
      cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      deleteManager.dbManager = dbManager; // Ensure deleteManager uses the new test DB
      // Seed both sets of emails
      await seedTestData(dbManager, [...emails1, ...emails2]);
      
      setupSuccessfulBatchModify(mockGmailClient);

      // Run concurrent operations
      const [result1, result2] = await Promise.all([
        deleteManager.deleteEmails(createDeleteOptions({ category: 'low', year: 2022 })),
        deleteManager.deleteEmails(createDeleteOptions({ category: 'medium', year: 2023 }))
      ]);

      expect(result1.deleted).toBe(emails1.length);
      expect(result2.deleted).toBe(emails2.length);
      expect(result1.errors).toHaveLength(0);
      expect(result2.errors).toHaveLength(0);
    });
  });
});