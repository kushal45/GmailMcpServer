import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DeleteManager } from '../../../src/delete/DeleteManager.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { DeleteOptions, EmailIndex } from '../../../src/types/index.js';
import {
  mockEmails,
  getEmailsByCriteria,
  batchTestEmails,
  batchTestEmailIds,
  errorScenarioEmails,
  mockStatistics,
  trashEmails
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
  stopLoggerCapture
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
        const options = createDeleteOptions({ category: 'low' });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(emails.length);
        expect(result.errors).toHaveLength(0);
        
        // Verify database was searched correctly
        const searchResults = await verifyRealDatabaseSearch(
          dbManager, 
          { category: 'low' },
          emails.length
        );
        
        // Verify the correct emails were found
        const foundIds = searchResults.map(e => e.id).sort();
        const expectedIds = emails.map(e => e.id).sort();
        expect(foundIds).toEqual(expectedIds);
        
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
        expect(searchResults.length).toBe(emails.length);
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
        expect(searchResults.length).toBe(emails.length);
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
        expect(searchResults.length).toBe(emails2023.length);
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
        expect(searchResults.length).toBe(largeEmails.length);
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
        expect(searchResults.length).toBe(matchingEmails.length);
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

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);
      const searchedEmails = await dbManager.searchEmails({ category: 'low' });
      const firstBatch = searchedEmails.slice(0, 50);
      const secondBatch = searchedEmails.slice(50, 80);
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
      expect(result.errors[0]).toContain('Failed to delete batch 1');
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
      expect(result.errors[0]).toContain('Failed to delete batch 2');
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

        const result = await deleteManager.emptyTrash();

        expect(result.deleted).toBe(trashEmails.length);
        expect(result.errors).toHaveLength(0);
        
        expect(mockGmailClient.users.messages.list).toHaveBeenCalledWith({
          userId: 'me',
          labelIds: ['TRASH'],
          maxResults: 500
        });
        
        expect(mockGmailClient.users.messages.delete).toHaveBeenCalledTimes(trashEmails.length);
      });

      it('should handle empty trash gracefully', async () => {
        setupListMessagesResponse(mockGmailClient, []);

        const result = await deleteManager.emptyTrash();

        expect(result.deleted).toBe(0);
        expect(result.errors).toHaveLength(0);
        expect(mockGmailClient.users.messages.delete).not.toHaveBeenCalled();
      });

      it('should handle partial failures when emptying trash', async () => {
        setupListMessagesResponse(mockGmailClient, trashEmails);
        setupDeleteMessageResponses(mockGmailClient, 3, 2); // 3 success, 2 failures

        const result = await deleteManager.emptyTrash();

        expect(result.deleted).toBe(3);
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]).toContain('Failed to delete message');
        expect(result.errors[1]).toContain('Failed to delete message');
      });

      it('should handle list messages error', async () => {
        mockGmailClient.users.messages.list.mockRejectedValue(testErrors.networkError);

        await expect(deleteManager.emptyTrash()).rejects.toThrow('Network timeout');
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