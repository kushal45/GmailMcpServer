import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DeleteManager } from '../../../src/delete/DeleteManager.js';
import { DeleteOptions } from '../../../src/types/index.js';
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
  createDeleteManager,
  setupSuccessfulBatchModify,
  setupBatchModifyFailure,
  setupPartialBatchFailure,
  setupListMessagesResponse,
  setupDeleteMessageResponses,
  verifyBatchModifyCalls,
  createDeleteOptions,
  setupDatabaseSearchResults,
  setupDatabaseSearchFailure,
  verifyDatabaseSearchCalls,
  testErrors,
  captureConsoleLogs,
  resetAllMocks
} from './helpers/testHelpers.js';

describe('DeleteManager Integration Tests', () => {
  let deleteManager: DeleteManager;
  let mockGmailClient: any;
  let mockAuthManager: any;
  let mockDbManager: any;
  let consoleCapture: ReturnType<typeof captureConsoleLogs>;

  beforeEach(() => {
    const mocks = createDeleteManager();
    deleteManager = mocks.deleteManager;
    mockGmailClient = mocks.mockGmailClient;
    mockAuthManager = mocks.mockAuthManager;
    mockDbManager = mocks.mockDbManager;
    consoleCapture = captureConsoleLogs();
  });

  afterEach(() => {
    consoleCapture.restore();
    resetAllMocks(mockGmailClient, mockAuthManager, mockDbManager);
    jest.clearAllMocks();
  });

  describe('Normal Delete Scenarios', () => {
    describe('Delete by Category', () => {
      it('should delete low priority emails', async () => {
        const lowPriorityEmails = getEmailsByCriteria({ category: 'low', archived: false });
        setupDatabaseSearchResults(mockDbManager, lowPriorityEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ category: 'low' });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(lowPriorityEmails.length);
        expect(result.errors).toHaveLength(0);
        
        verifyDatabaseSearchCalls(mockDbManager, [{ category: 'low', archived: false }]);
        verifyBatchModifyCalls(mockGmailClient, [{
          ids: lowPriorityEmails.map(e => e.id)
        }]);
      });

      it('should delete medium priority emails', async () => {
        const mediumPriorityEmails = getEmailsByCriteria({ category: 'medium', archived: false });
        setupDatabaseSearchResults(mockDbManager, mediumPriorityEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ category: 'medium' });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(mediumPriorityEmails.length);
        expect(result.errors).toHaveLength(0);
      });

      it('should delete high priority emails only when explicitly specified', async () => {
        const highPriorityEmails = getEmailsByCriteria({ category: 'high', archived: false });
        setupDatabaseSearchResults(mockDbManager, highPriorityEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ category: 'high' });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(highPriorityEmails.length);
        expect(result.errors).toHaveLength(0);
      });

      it('should protect high priority emails when no category specified', async () => {
        const allEmails = getEmailsByCriteria({ archived: false });
        const nonHighPriorityEmails = allEmails.filter(e => e.category !== 'high');
        setupDatabaseSearchResults(mockDbManager, allEmails);
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
        const emails2023 = getEmailsByCriteria({ year: 2023, archived: false });
        const nonHighPriority2023 = emails2023.filter(e => e.category !== 'high');
        setupDatabaseSearchResults(mockDbManager, emails2023);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ year: 2023 });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonHighPriority2023.length);
        expect(result.errors).toHaveLength(0);
        
        verifyDatabaseSearchCalls(mockDbManager, [{ year: 2023, archived: false }]);
      });

      it('should delete emails from multiple years when called multiple times', async () => {
        // Test year 2022
        const emails2022 = getEmailsByCriteria({ year: 2022, archived: false });
        const nonHighPriority2022 = emails2022.filter(e => e.category !== 'high');
        setupDatabaseSearchResults(mockDbManager, emails2022);
        setupSuccessfulBatchModify(mockGmailClient);

        const options2022 = createDeleteOptions({ year: 2022 });
        const result2022 = await deleteManager.deleteEmails(options2022);

        expect(result2022.deleted).toBe(nonHighPriority2022.length);

        // Reset mocks for next test
        resetAllMocks(mockGmailClient, mockAuthManager, mockDbManager);
        mockAuthManager.getGmailClient = jest.fn(() => Promise.resolve(mockGmailClient));

        // Test year 2024
        const emails2024 = getEmailsByCriteria({ year: 2024, archived: false });
        const nonHighPriority2024 = emails2024.filter(e => e.category !== 'high');
        setupDatabaseSearchResults(mockDbManager, emails2024);
        setupSuccessfulBatchModify(mockGmailClient);

        const options2024 = createDeleteOptions({ year: 2024 });
        const result2024 = await deleteManager.deleteEmails(options2024);

        expect(result2024.deleted).toBe(nonHighPriority2024.length);
      });
    });

    describe('Delete by Size Threshold', () => {
      it('should delete emails larger than threshold', async () => {
        const largeEmails = mockEmails.filter(e => !e.archived && e.size >= 1000000);
        const nonHighPriorityLarge = largeEmails.filter(e => e.category !== 'high');
        setupDatabaseSearchResults(mockDbManager, largeEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ sizeThreshold: 1000000 });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonHighPriorityLarge.length);
        expect(result.errors).toHaveLength(0);
        
        verifyDatabaseSearchCalls(mockDbManager, [{ 
          sizeRange: { min: 1000000 }, 
          archived: false 
        }]);
      });

      it('should delete small emails when low threshold specified', async () => {
        const smallEmails = mockEmails.filter(e => !e.archived && e.size >= 5000);
        const nonHighPrioritySmall = smallEmails.filter(e => e.category !== 'high');
        setupDatabaseSearchResults(mockDbManager, smallEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ sizeThreshold: 5000 });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonHighPrioritySmall.length);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Delete with Search Criteria', () => {
      it('should delete emails matching search criteria', async () => {
        const newsletterEmails = mockEmails.filter(e => 
          !e.archived && e.labels.includes('NEWSLETTER')
        );
        setupDatabaseSearchResults(mockDbManager, newsletterEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ 
          searchCriteria: { labels: ['NEWSLETTER'] }
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(newsletterEmails.length);
        expect(result.errors).toHaveLength(0);
        
        verifyDatabaseSearchCalls(mockDbManager, [{ 
          labels: ['NEWSLETTER'], 
          archived: false 
        }]);
      });

      it('should delete emails from specific sender', async () => {
        const senderEmails = mockEmails.filter(e => 
          !e.archived && e.sender === 'newsletter@marketing.com'
        );
        setupDatabaseSearchResults(mockDbManager, senderEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ 
          searchCriteria: { sender: 'newsletter@marketing.com' }
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(senderEmails.length);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Delete with Multiple Criteria Combined', () => {
      it('should delete emails matching all criteria', async () => {
        const complexCriteria = {
          category: 'low' as const,
          year: 2023,
          sizeThreshold: 100000
        };
        
        const matchingEmails = mockEmails.filter(e => 
          !e.archived && 
          e.category === 'low' && 
          e.year === 2023 && 
          e.size >= 100000
        );
        
        setupDatabaseSearchResults(mockDbManager, matchingEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions(complexCriteria);
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(matchingEmails.length);
        expect(result.errors).toHaveLength(0);
        
        verifyDatabaseSearchCalls(mockDbManager, [{
          category: 'low',
          year: 2023,
          sizeRange: { min: 100000 },
          archived: false
        }]);
      });

      it('should combine search criteria with other filters', async () => {
        const complexCriteria = {
          category: 'medium' as const,
          searchCriteria: {
            hasAttachments: true,
            yearRange: { start: 2023, end: 2024 }
          }
        };
        
        const matchingEmails = mockEmails.filter(e => 
          !e.archived && 
          e.category === 'medium' && 
          e.hasAttachments
        );
        
        setupDatabaseSearchResults(mockDbManager, matchingEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions(complexCriteria);
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(matchingEmails.length);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('Skip Archived Emails', () => {
      it('should skip archived emails when skipArchived is true', async () => {
        const allLowPriority = mockEmails.filter(e => e.category === 'low');
        const nonArchivedLowPriority = allLowPriority.filter(e => !e.archived);
        
        setupDatabaseSearchResults(mockDbManager, nonArchivedLowPriority);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ 
          category: 'low',
          skipArchived: true 
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(nonArchivedLowPriority.length);
        expect(result.errors).toHaveLength(0);
        
        verifyDatabaseSearchCalls(mockDbManager, [{
          category: 'low',
          archived: false
        }]);
      });

      it('should include archived emails when skipArchived is false', async () => {
        const allLowPriority = mockEmails.filter(e => e.category === 'low');
        
        setupDatabaseSearchResults(mockDbManager, allLowPriority);
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
      setupDatabaseSearchResults(mockDbManager, batchTestEmails);
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(80); // 50 + 30 emails
      expect(result.errors).toHaveLength(0);
      
      // Should be called twice (50 in first batch, 30 in second)
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(2);
      
      verifyBatchModifyCalls(mockGmailClient, [
        { ids: batchTestEmailIds.firstBatch },
        { ids: batchTestEmailIds.secondBatch }
      ]);
    });

    it('should respect batch size limit of 50 emails', async () => {
      const largeEmailSet = Array.from({ length: 150 }, (_, i) => ({
        ...batchTestEmails[0],
        id: `large-set-${i}`,
        threadId: `thread-large-set-${i}`
      }));
      
      setupDatabaseSearchResults(mockDbManager, largeEmailSet);
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(150);
      expect(result.errors).toHaveLength(0);
      
      // Should be called 3 times (50 + 50 + 50)
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(3);
    });

    it('should implement rate limiting between batches', async () => {
      setupDatabaseSearchResults(mockDbManager, batchTestEmails);
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
        setupDatabaseSearchResults(mockDbManager, emailsToDelete);

        const options = createDeleteOptions({ 
          category: 'low',
          dryRun: true 
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
        
        const matchingEmails = mockEmails.filter(e =>
          !e.archived &&
          e.category === 'medium' &&
          e.year === 2023 &&
          e.size >= 50000 &&
          e.hasAttachments
        );
        
        setupDatabaseSearchResults(mockDbManager, matchingEmails);

        const options = createDeleteOptions({
          ...complexCriteria,
          dryRun: true
        });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(matchingEmails.length);
        expect(result.errors[0]).toContain('DRY RUN');
        expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
      });
    });

    describe('High Priority Email Protection', () => {
      it('should not delete high priority emails by default', async () => {
        const allEmails = getEmailsByCriteria({ archived: false });
        const nonHighPriority = allEmails.filter(e => e.category !== 'high');
        
        setupDatabaseSearchResults(mockDbManager, allEmails);
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
        const highPriorityEmails = getEmailsByCriteria({ category: 'high', archived: false });
        
        setupDatabaseSearchResults(mockDbManager, highPriorityEmails);
        setupSuccessfulBatchModify(mockGmailClient);

        const options = createDeleteOptions({ category: 'high' });
        const result = await deleteManager.deleteEmails(options);

        expect(result.deleted).toBe(highPriorityEmails.length);
        
        verifyBatchModifyCalls(mockGmailClient, [{
          ids: highPriorityEmails.map(e => e.id)
        }]);
      });
    });

    describe('Archived Email Skip', () => {
      it('should skip archived emails by default', async () => {
        const allEmails = [...mockEmails];
        const nonArchived = allEmails.filter(e => !e.archived);
        const nonArchivedNonHigh = nonArchived.filter(e => e.category !== 'high');
        
        setupDatabaseSearchResults(mockDbManager, nonArchived);
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
      setupDatabaseSearchResults(mockDbManager, []);

      const options = createDeleteOptions({ category: 'low', year: 2025 });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    });

    it('should handle emails without required permissions', async () => {
      const protectedEmail = [errorScenarioEmails.permissionDenied];
      setupDatabaseSearchResults(mockDbManager, protectedEmail);
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
      setupDatabaseSearchResults(mockDbManager, alreadyDeleted);
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      // Should succeed as Gmail API handles this gracefully
      expect(result.deleted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle partial batch failures', async () => {
      setupDatabaseSearchResults(mockDbManager, batchTestEmails);
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
      setupDatabaseSearchResults(mockDbManager, emails);
      setupBatchModifyFailure(mockGmailClient, testErrors.networkError);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Network timeout');
    });

    it('should handle rate limit errors', async () => {
      const emails = getEmailsByCriteria({ category: 'low', archived: false });
      setupDatabaseSearchResults(mockDbManager, emails);
      setupBatchModifyFailure(mockGmailClient, testErrors.rateLimitError);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Rate limit exceeded');
    });

    it('should handle database errors', async () => {
      setupDatabaseSearchFailure(mockDbManager, testErrors.databaseError);

      const options = createDeleteOptions({ category: 'low' });
      
      await expect(deleteManager.deleteEmails(options)).rejects.toThrow('Database connection failed');
    });

    it('should handle invalid parameters gracefully', async () => {
      const emails = getEmailsByCriteria({ category: 'low', archived: false });
      setupDatabaseSearchResults(mockDbManager, emails);
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
      const emails = getEmailsByCriteria({ category: 'low', archived: false });
      setupDatabaseSearchResults(mockDbManager, emails);
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options);

      expect(result.deleted).toBe(emails.length);
      
      // Verify markAsDeleted was called (through console logs)
      const deletedLogs = consoleCapture.logs.filter(log => 
        log.includes('Email marked as deleted in database')
      );
      expect(deletedLogs).toHaveLength(emails.length);
    });

    it('should verify Gmail API calls with correct labels', async () => {
      const emails = getEmailsByCriteria({ category: 'low', archived: false });
      setupDatabaseSearchResults(mockDbManager, emails);
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low' });
      await deleteManager.deleteEmails(options);

      const batchModifyCall = mockGmailClient.users.messages.batchModify.mock.calls[0][0];
      expect(batchModifyCall.userId).toBe('me');
      expect(batchModifyCall.requestBody.addLabelIds).toEqual(['TRASH']);
      expect(batchModifyCall.requestBody.removeLabelIds).toEqual(['INBOX', 'UNREAD']);
    });

    it('should verify audit trail through logging', async () => {
      const emails = getEmailsByCriteria({ category: 'low', archived: false }).slice(0, 2);
      setupDatabaseSearchResults(mockDbManager, emails);
      setupSuccessfulBatchModify(mockGmailClient);

      const options = createDeleteOptions({ category: 'low' });
      await deleteManager.deleteEmails(options);

      // Check for start log
      expect(consoleCapture.logs.some(log => 
        log.includes('Starting email deletion')
      )).toBe(true);

      // Check for batch processing log
      expect(consoleCapture.logs.some(log => 
        log.includes('Deleting batch 1')
      )).toBe(true);

      // Check for completion log
      expect(consoleCapture.logs.some(log => 
        log.includes('Deletion completed')
      )).toBe(true);
    });
  });

  describe('Additional Methods', () => {
    describe('getDeleteStatistics', () => {
      it('should return correct statistics by category', async () => {
        const nonArchivedEmails = mockEmails.filter(e => !e.archived);
        setupDatabaseSearchResults(mockDbManager, nonArchivedEmails);

        const stats = await deleteManager.getDeleteStatistics();

        expect(stats.byCategory).toEqual(mockStatistics.byCategory);
        expect(stats.total).toBe(mockStatistics.total);
      });

      it('should return correct statistics by year', async () => {
        const nonArchivedEmails = mockEmails.filter(e => !e.archived);
        setupDatabaseSearchResults(mockDbManager, nonArchivedEmails);

        const stats = await deleteManager.getDeleteStatistics();

        expect(stats.byYear).toEqual(mockStatistics.byYear);
      });

      it('should return correct statistics by size', async () => {
        const nonArchivedEmails = mockEmails.filter(e => !e.archived);
        setupDatabaseSearchResults(mockDbManager, nonArchivedEmails);

        const stats = await deleteManager.getDeleteStatistics();

        expect(stats.bySize).toEqual(mockStatistics.bySize);
      });

      it('should exclude archived emails from statistics', async () => {
        const nonArchivedEmails = mockEmails.filter(e => !e.archived);
        setupDatabaseSearchResults(mockDbManager, nonArchivedEmails);

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
      it('should log placeholder message for auto-deletion rules', async () => {
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

      setupDatabaseSearchResults(mockDbManager, veryLargeSet);
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
      const complexEmails = mockEmails.filter(e =>
        !e.archived &&
        e.category === 'low' &&
        e.year === 2023 &&
        e.size >= 100000 &&
        e.labels.includes('PROMOTIONS')
      );

      setupDatabaseSearchResults(mockDbManager, complexEmails);
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

      verifyDatabaseSearchCalls(mockDbManager, [{
        category: 'low',
        year: 2023,
        sizeRange: { min: 100000 },
        labels: ['PROMOTIONS'],
        archived: false
      }]);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent delete operations safely', async () => {
      const emails1 = getEmailsByCriteria({ category: 'low', year: 2022, archived: false });
      const emails2 = getEmailsByCriteria({ category: 'medium', year: 2023, archived: false });

      // Setup for both operations
      mockDbManager.searchEmails
        .mockResolvedValueOnce(emails1)
        .mockResolvedValueOnce(emails2);
      
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