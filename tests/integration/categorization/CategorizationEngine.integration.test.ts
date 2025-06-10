import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CategorizationEngine } from '../../../src/categorization/CategorizationEngine.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { CacheManager } from '../../../src/cache/CacheManager.js';
import { CategorizeOptions, EmailIndex, PriorityCategory } from '../../../src/types/index.js';
import {
  mockEmails,
  expectedCategories,
  mockStatistics
} from './fixtures/mockEmails.js';
import {
  createCategorizationEngineWithRealDb,
  createTestDatabaseManager,
  cleanupTestDatabase,
  seedTestData,
  verifyCategorization,
  startLoggerCapture,
  stopLoggerCapture
} from './helpers/testHelpers.js';
import { logger } from '../../../src/utils/logger.js';

describe('CategorizationEngine Integration Tests', () => {
  let categorizationEngine: CategorizationEngine;
  let dbManager: DatabaseManager;
  let cacheManager: CacheManager;
  let consoleCapture: { logs: string[], errors: string[], warns: string[], infos: string[] };

  beforeEach(async () => {
    const setup = await createCategorizationEngineWithRealDb();
    categorizationEngine = setup.categorizationEngine;
    dbManager = setup.dbManager;
    cacheManager = setup.cacheManager;
    consoleCapture = startLoggerCapture(logger);

    // Seed initial test data
    await seedTestData(dbManager, mockEmails);
  });

  afterEach(async () => {
    stopLoggerCapture();
    await cleanupTestDatabase(dbManager);
    jest.clearAllMocks();
  });

  describe('Email Categorization Flow', () => {
    it('should categorize all uncategorized emails', async () => {
      // Verify emails are initially uncategorized
      const initialEmails = await dbManager.searchEmails({});
      initialEmails.forEach(email => {
        expect(email.category).toBeNull();
      });

      // Run categorization
      const options: CategorizeOptions = { forceRefresh: false };
      const result = await categorizationEngine.categorizeEmails(options);

      // Verify all emails were processed
      expect(result.processed).toBe(mockEmails.length);
      
      // Verify category counts match expected
      expect(result.categories.high).toBe(expectedCategories.high.length);
      expect(result.categories.medium).toBe(expectedCategories.medium.length);
      expect(result.categories.low).toBe(expectedCategories.low.length);

      // Verify high priority emails were categorized correctly
      await verifyCategorization(
        dbManager,
        expectedCategories.high.map(e => e.id),
        PriorityCategory.HIGH
      );

      // Verify medium priority emails were categorized correctly
      await verifyCategorization(
        dbManager,
        expectedCategories.medium.map(e => e.id),
        PriorityCategory.MEDIUM
      );

      // Verify low priority emails were categorized correctly
      await verifyCategorization(
        dbManager,
        expectedCategories.low.map(e => e.id),
        PriorityCategory.LOW
      );

      // Verify logging
      expect(consoleCapture.infos.some(log => 
        log.includes('Starting email categorization')
      )).toBe(true);
      expect(consoleCapture.infos.some(log => 
        log.includes('Email categorization completed')
      )).toBe(true);
    });

    it('should recategorize all emails when forceRefresh is true', async () => {
      // First categorize all emails
      await categorizationEngine.categorizeEmails({ forceRefresh: false });
      
      // Manually change some categories to test recategorization
      const emailToChange = await dbManager.getEmailIndex('email-high-1');
      if (emailToChange) {
        emailToChange.category = 'low';
        await dbManager.upsertEmailIndex(emailToChange);
      }
      
      // Run categorization with forceRefresh
      const options: CategorizeOptions = { forceRefresh: true };
      const result = await categorizationEngine.categorizeEmails(options);
      
      // Verify all emails were processed again
      expect(result.processed).toBe(mockEmails.length);
      
      // Verify the changed email was recategorized correctly
      const recategorizedEmail = await dbManager.getEmailIndex('email-high-1');
      expect(recategorizedEmail?.category).toBe(PriorityCategory.HIGH);
    });

    it('should categorize emails from specific year only', async () => {
      // Run categorization for 2023 only
      const options: CategorizeOptions = { forceRefresh: false, year: 2023 };
      const result = await categorizationEngine.categorizeEmails(options);
      
      // Count emails from 2023
      const emails2023 = mockEmails.filter(e => e.year === 2023);
      expect(result.processed).toBe(emails2023.length);
      
      // Verify only 2023 emails were categorized
      const categorized2023 = await dbManager.searchEmails({ year: 2023 });
      categorized2023.forEach(email => {
        expect(email.category).not.toBeNull();
      });
      
      // Verify other years remain uncategorized
      const uncategorized2024 = await dbManager.searchEmails({ year: 2024 });
      uncategorized2024.forEach(email => {
        expect(email.category).toBeNull();
      });
    });

    it('should handle empty result sets gracefully', async () => {
      // Run categorization for a year with no emails
      const options: CategorizeOptions = { forceRefresh: false, year: 2025 };
      const result = await categorizationEngine.categorizeEmails(options);
      
      // Verify no emails were processed
      expect(result.processed).toBe(0);
      expect(result.categories.high).toBe(0);
      expect(result.categories.medium).toBe(0);
      expect(result.categories.low).toBe(0);
    });
  });

  describe('Categorization Rules', () => {
    it('should categorize high priority emails correctly', async () => {
      // Run categorization
      await categorizationEngine.categorizeEmails({ forceRefresh: false });
      
      // Check emails with urgent keywords
      const urgentEmail = await dbManager.getEmailIndex('email-high-1');
      expect(urgentEmail?.category).toBe(PriorityCategory.HIGH);
      
      // Check emails with important labels
      const importantEmail = await dbManager.getEmailIndex('email-high-2');
      expect(importantEmail?.category).toBe(PriorityCategory.HIGH);
      
      // Check emails from important domains
      const domainEmail = await dbManager.getEmailIndex('email-high-3');
      expect(domainEmail?.category).toBe(PriorityCategory.HIGH);
    });

    it('should categorize low priority emails correctly', async () => {
      // Run categorization
      await categorizationEngine.categorizeEmails({ forceRefresh: false });
      
      // Check promotional emails
      const promotionalEmail = await dbManager.getEmailIndex('email-low-1');
      expect(promotionalEmail?.category).toBe(PriorityCategory.LOW);
      
      // Check no-reply emails
      const noreplyEmail = await dbManager.getEmailIndex('email-low-2');
      expect(noreplyEmail?.category).toBe(PriorityCategory.LOW);
      
      // Check newsletter emails
      const newsletterEmail = await dbManager.getEmailIndex('email-low-3');
      expect(newsletterEmail?.category).toBe(PriorityCategory.LOW);
      
      // Check large emails with attachments
      const largeEmail = await dbManager.getEmailIndex('email-low-4');
      expect(largeEmail?.category).toBe(PriorityCategory.LOW);
    });

    it('should categorize medium priority emails correctly', async () => {
      // Run categorization
      await categorizationEngine.categorizeEmails({ forceRefresh: false });
      
      // Check regular emails that don't match high or low criteria
      const mediumEmail1 = await dbManager.getEmailIndex('email-medium-1');
      expect(mediumEmail1?.category).toBe(PriorityCategory.MEDIUM);
      
      const mediumEmail2 = await dbManager.getEmailIndex('email-medium-2');
      expect(mediumEmail2?.category).toBe(PriorityCategory.MEDIUM);
    });

    it('should update important domains and recategorize', async () => {
      // First categorize with default domains
      await categorizationEngine.categorizeEmails({ forceRefresh: false });
      
      // Add a new important domain
      await categorizationEngine.updateImportantDomains(['company.com']);
      
      // Recategorize
      await categorizationEngine.categorizeEmails({ forceRefresh: true });
      
      // Check that emails from the new domain are now high priority
      const companyEmails = mockEmails.filter(e => e.sender.includes('company.com'));
      for (const email of companyEmails) {
        const dbEmail = await dbManager.getEmailIndex(email.id);
        expect(dbEmail?.category).toBe(PriorityCategory.HIGH);
      }
    });
  });

  describe('Statistics', () => {
    it('should return correct statistics after categorization', async () => {
      // First categorize all emails
      await categorizationEngine.categorizeEmails({ forceRefresh: false });
      
      // Get statistics
      const stats = await categorizationEngine.getStatistics({ 
        groupBy: 'category', 
        includeArchived: true 
      });
      
      // Verify category counts
      expect(stats.categories.high).toBe(expectedCategories.high.length);
      expect(stats.categories.medium).toBe(expectedCategories.medium.length);
      expect(stats.categories.low).toBe(expectedCategories.low.length);
      expect(stats.categories.total).toBe(mockEmails.length);
      
      // Verify year stats
      const years = Object.keys(stats.years).map(Number);
      expect(years).toContain(2022);
      expect(years).toContain(2023);
      expect(years).toContain(2024);
      
      // Verify size stats
      expect(stats.sizes.small).toBeGreaterThanOrEqual(0);
      expect(stats.sizes.medium).toBeGreaterThanOrEqual(0);
      expect(stats.sizes.large).toBeGreaterThanOrEqual(0);
      expect(stats.total.count).toBe(mockEmails.length);
    });

    it('should cache statistics', async () => {
      // First categorize all emails
      await categorizationEngine.categorizeEmails({ forceRefresh: false });
      
      // Get statistics first time (should not be cached)
      const stats1 = await categorizationEngine.getStatistics({ 
        groupBy: 'category', 
        includeArchived: true 
      });
      
      // Spy on database calls
      const dbSpy = jest.spyOn(dbManager, 'getEmailStatistics');
      
      // Get statistics second time (should be cached)
      const stats2 = await categorizationEngine.getStatistics({ 
        groupBy: 'category', 
        includeArchived: true 
      });
      
      // Verify cache was used
      expect(dbSpy).not.toHaveBeenCalled();
      
      // Verify stats are the same
      expect(stats2).toEqual(stats1);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      // Close database to simulate error
      await dbManager.close();
      
      // Attempt to categorize
      await expect(categorizationEngine.categorizeEmails({ forceRefresh: false }))
        .rejects.toThrow();
      
      // Verify error was logged
      expect(consoleCapture.errors.some(log => 
        log.includes('Error during categorization')
      )).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle large batches of emails efficiently', async () => {
      // Create a large batch of test emails
      const largeEmailSet = Array.from({ length: 100 }, (_, i) => ({
        ...mockEmails[0],
        id: `perf-test-${i}`,
        threadId: `thread-perf-${i}`,
        subject: `Performance Test ${i}`,
        category: null as any
      }));
      
      // Reset database and seed with large dataset
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
      await seedTestData(dbManager, largeEmailSet);
      
      // Measure performance
      const startTime = Date.now();
      const result = await categorizationEngine.categorizeEmails({ forceRefresh: false });
      const endTime = Date.now();
      
      // Verify all emails were processed
      expect(result.processed).toBe(largeEmailSet.length);
      
      // Verify processing time is reasonable (less than 2 seconds)
      expect(endTime - startTime).toBeLessThan(2000);
    });
  });

  describe('End-to-End Flow', () => {
    it('should complete the full categorization workflow', async () => {
      // 1. Start with uncategorized emails
      const initialEmails = await dbManager.searchEmails({});
      initialEmails.forEach(email => {
        expect(email.category).toBeNull();
      });
      
      // 2. Run categorization
      const categorizationResult = await categorizationEngine.categorizeEmails({ 
        forceRefresh: false 
      });
      expect(categorizationResult.processed).toBe(mockEmails.length);
      
      // 3. Verify all emails are categorized
      const categorizedEmails = await dbManager.searchEmails({});
      categorizedEmails.forEach(email => {
        expect(email.category).not.toBeNull();
      });
      
      // 4. Get statistics
      const stats = await categorizationEngine.getStatistics({ 
        groupBy: 'category', 
        includeArchived: true 
      });
      
      // 5. Verify statistics match expected counts
      expect(stats.categories.high + stats.categories.medium + stats.categories.low)
        .toBe(mockEmails.length);
      
      // 6. Analyze patterns (placeholder functionality)
      const patterns = await categorizationEngine.analyzeEmailPatterns();
      expect(patterns).toBeDefined();
      
      // 7. Verify logging of the complete flow
      expect(consoleCapture.infos.some(log => 
        log.includes('Starting email categorization')
      )).toBe(true);
      expect(consoleCapture.infos.some(log => 
        log.includes('Email categorization completed')
      )).toBe(true);
      expect(consoleCapture.infos.some(log => 
        log.includes('Analyzing email patterns')
      )).toBe(true);
    });
  });
});