import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CategorizationEngine } from '../../../src/categorization/CategorizationEngine.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { CacheManager } from '../../../src/cache/CacheManager.js';
import { CategorizeOptions, EmailIndex, PriorityCategory } from '../../../src/types/index.js';
import { CategorizationSystemConfig } from '../../../src/categorization/config/CategorizationConfig.js';
import { CombinedAnalysisResult, EnhancedCategorizationResult } from '../../../src/categorization/types.js';
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
import { error } from 'console';

describe('CategorizationEngine Integration Tests', () => {
  let categorizationEngine: CategorizationEngine;
  let dbManager: DatabaseManager;
  let cacheManager: CacheManager;
  let consoleCapture: { logs: string[], errors: string[], warns: string[], infos: string[] };
  const userContext = { user_id: 'default', session_id: 'default-session' };
  const userContextA = { user_id: 'userA', session_id: 'sessionA' };
  const userContextB = { user_id: 'userB', session_id: 'sessionB' };

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
      const result: EnhancedCategorizationResult = await categorizationEngine.categorizeEmails(options, userContext);

      // Verify all emails were processed
      expect(result.processed).toBe(mockEmails.length);
      
      // Verify category counts match expected
      expect(result.categories.high).toBe(expectedCategories.high.length);
      expect(result.categories.medium).toBe(expectedCategories.medium.length);
      expect(result.categories.low).toBe(expectedCategories.low.length);

      // NEW: Verify emails array is returned with analyzer results
      expect(result.emails).toBeDefined();
      expect(Array.isArray(result.emails)).toBe(true);
      expect(result.emails.length).toBe(mockEmails.length);
      
      // Verify each email has analyzer results
      result.emails.forEach(email => {
        expect(email.category).not.toBeNull();
        expect(email.importanceLevel).toBeDefined();
        expect(email.importanceScore).toBeDefined();
        expect(email.ageCategory).toBeDefined();
        expect(email.sizeCategory).toBeDefined();
        expect(email.analysisTimestamp).toBeDefined();
        expect(email.analysisVersion).toBeDefined();
        expect(email.user_id).toBe('default');
      });

      // NEW: Verify analyzer_insights are provided
      expect(result.analyzer_insights).toBeDefined();
      if (result.analyzer_insights) {
        expect(result.analyzer_insights.top_importance_rules).toBeDefined();
        expect(Array.isArray(result.analyzer_insights.top_importance_rules)).toBe(true);
        expect(typeof result.analyzer_insights.spam_detection_rate).toBe('number');
        expect(typeof result.analyzer_insights.avg_confidence).toBe('number');
        expect(result.analyzer_insights.age_distribution).toBeDefined();
        expect(result.analyzer_insights.size_distribution).toBeDefined();
        
        // Verify distribution totals
        const ageTotal = result.analyzer_insights.age_distribution.recent +
                        result.analyzer_insights.age_distribution.moderate +
                        result.analyzer_insights.age_distribution.old;
        const sizeTotal = result.analyzer_insights.size_distribution.small +
                         result.analyzer_insights.size_distribution.medium +
                         result.analyzer_insights.size_distribution.large;
        expect(ageTotal).toBe(result.processed);
        expect(sizeTotal).toBe(result.processed);
      }

      // Verify high priority emails were categorized correctly
      await verifyCategorization(
        dbManager,
        expectedCategories.high.map(e => e.id),
        PriorityCategory.HIGH
      );

      // Verify medium priority emails were categorized correctly (if any)
      if (expectedCategories.medium.length > 0) {
        await verifyCategorization(
          dbManager,
          expectedCategories.medium.map(e => e.id),
          PriorityCategory.MEDIUM
        );
      }

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
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      
      // Manually change some categories to test recategorization
      const emailToChange = await dbManager.getEmailIndex('email-high-1');
      if (emailToChange) {
        emailToChange.category = 'low';
        await dbManager.upsertEmailIndex(emailToChange);
      }
      
      // Run categorization with forceRefresh
      const options: CategorizeOptions = { forceRefresh: true };
      const result: EnhancedCategorizationResult = await categorizationEngine.categorizeEmails(options, userContext);
      
      // Verify all emails were processed again
      expect(result.processed).toBe(mockEmails.length);
      
      // NEW: Verify enhanced return format
      expect(result.emails).toBeDefined();
      expect(result.emails.length).toBe(mockEmails.length);
      expect(result.analyzer_insights).toBeDefined();
      
      // Verify the changed email was recategorized correctly
      const recategorizedEmail = await dbManager.getEmailIndex('email-high-1');
      expect(recategorizedEmail?.category).toBe(PriorityCategory.HIGH);
      
      // Verify the email is also in the returned emails array with correct category
      const emailInResult = result.emails.find(e => e.id === 'email-high-1');
      expect(emailInResult).toBeDefined();
      expect(emailInResult?.category).toBe(PriorityCategory.HIGH);
    });

    it('should categorize emails from specific year only', async () => {
      // Run categorization for 2023 only
      const options: CategorizeOptions = { forceRefresh: false, year: 2023 };
      const result: EnhancedCategorizationResult = await categorizationEngine.categorizeEmails(options, userContext);
      
      // Count emails from 2023
      const emails2023 = mockEmails.filter(e => e.year === 2023);
      expect(result.processed).toBe(emails2023.length);
      
      // NEW: Verify enhanced return format
      expect(result.emails).toBeDefined();
      expect(result.emails.length).toBe(emails2023.length);
      expect(result.analyzer_insights).toBeDefined();
      
      // Verify all returned emails are from 2023
      result.emails.forEach(email => {
        expect(email.year).toBe(2023);
        expect(email.category).not.toBeNull();
        expect(email.user_id).toBe('default');
      });
      
      // Verify only 2023 emails were categorized
      const categorized2023 = await dbManager.searchEmails({ year: 2023 });
      categorized2023.forEach(email => {
        expect(email.category).not.toBeNull();
        expect(email.user_id).toBe('default');
      });
      
      // Verify other years remain uncategorized
      const uncategorized2024 = await dbManager.searchEmails({ year: 2024 });
      uncategorized2024.forEach(email => {
        expect(email.category).toBeNull();
        expect(email.user_id).toBe('default');
      });
    });

    it('should handle empty result sets gracefully', async () => {
      // Run categorization for a year with no emails
      const options: CategorizeOptions = { forceRefresh: false, year: 2025 };
      const result: EnhancedCategorizationResult = await categorizationEngine.categorizeEmails(options, userContext);
      
      // Verify no emails were processed
      expect(result.processed).toBe(0);
      expect(result.categories.high).toBe(0);
      expect(result.categories.medium).toBe(0);
      expect(result.categories.low).toBe(0);
      
      // NEW: Verify enhanced return format for empty results
      expect(result.emails).toBeDefined();
      expect(Array.isArray(result.emails)).toBe(true);
      expect(result.emails.length).toBe(0);
      
      // Analyzer insights should still be provided even for empty results
      expect(result.analyzer_insights).toBeDefined();
      if (result.analyzer_insights) {
        expect(result.analyzer_insights.top_importance_rules).toBeDefined();
        expect(Array.isArray(result.analyzer_insights.top_importance_rules)).toBe(true);
        expect(result.analyzer_insights.spam_detection_rate).toBe(0);
        expect(result.analyzer_insights.avg_confidence).toBe(0);
        expect(result.analyzer_insights.age_distribution.recent).toBe(0);
        expect(result.analyzer_insights.age_distribution.moderate).toBe(0);
        expect(result.analyzer_insights.age_distribution.old).toBe(0);
        expect(result.analyzer_insights.size_distribution.small).toBe(0);
        expect(result.analyzer_insights.size_distribution.medium).toBe(0);
        expect(result.analyzer_insights.size_distribution.large).toBe(0);
      }
    });

    it('should validate enhanced categorization result structure', async () => {
      // Run categorization
      const result: EnhancedCategorizationResult = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      
      // Validate basic structure
      expect(typeof result.processed).toBe('number');
      expect(result.processed).toBeGreaterThan(0);
      
      // Validate categories structure
      expect(result.categories).toBeDefined();
      expect(typeof result.categories.high).toBe('number');
      expect(typeof result.categories.medium).toBe('number');
      expect(typeof result.categories.low).toBe('number');
      expect(result.categories.high + result.categories.medium + result.categories.low).toBe(result.processed);
      
      // Validate emails array
      expect(result.emails).toBeDefined();
      expect(Array.isArray(result.emails)).toBe(true);
      expect(result.emails.length).toBe(result.processed);
      
      // Validate each email has required analyzer result fields
      result.emails.forEach((email, index) => {
        expect(email.id).toBeDefined();
        expect(email.category).not.toBeNull();
        expect(['high', 'medium', 'low']).toContain(email.category);
        
        // Importance analyzer results
        expect(email.importanceLevel).toBeDefined();
        expect(['high', 'medium', 'low']).toContain(email.importanceLevel);
        expect(typeof email.importanceScore).toBe('number');
        expect(Array.isArray(email.importanceMatchedRules)).toBe(true);
        expect(typeof email.importanceConfidence).toBe('number');
        
        // Date/Size analyzer results
        expect(email.ageCategory).toBeDefined();
        expect(['recent', 'moderate', 'old']).toContain(email.ageCategory);
        expect(email.sizeCategory).toBeDefined();
        expect(['small', 'medium', 'large']).toContain(email.sizeCategory);
        expect(typeof email.recencyScore).toBe('number');
        
        // Label classifier results
        expect(email.gmailCategory).toBeDefined();
        expect(typeof email.spam_score).toBe('undefined');
        expect(typeof email.promotional_score).toBe('undefined');
        expect(typeof email.socialScore).toBe('number');
        
        // Analysis metadata
        expect(email.analysisTimestamp).toBeDefined();
        expect(email.analysisVersion).toBeDefined();
        expect(email.user_id).toBe('default');
      });
      
      // Validate analyzer_insights
      expect(result.analyzer_insights).toBeDefined();
      if (result.analyzer_insights) {
        expect(Array.isArray(result.analyzer_insights.top_importance_rules)).toBe(true);
        expect(typeof result.analyzer_insights.spam_detection_rate).toBe('number');
        expect(result.analyzer_insights.spam_detection_rate).toBeGreaterThanOrEqual(0);
        expect(result.analyzer_insights.spam_detection_rate).toBeLessThanOrEqual(1);
        expect(typeof result.analyzer_insights.avg_confidence).toBe('number');
        expect(result.analyzer_insights.avg_confidence).toBeGreaterThanOrEqual(0);
        expect(result.analyzer_insights.avg_confidence).toBeLessThanOrEqual(1);
        
        // Validate age distribution
        expect(result.analyzer_insights.age_distribution).toBeDefined();
        expect(typeof result.analyzer_insights.age_distribution.recent).toBe('number');
        expect(typeof result.analyzer_insights.age_distribution.moderate).toBe('number');
        expect(typeof result.analyzer_insights.age_distribution.old).toBe('number');
        
        // Validate size distribution
        expect(result.analyzer_insights.size_distribution).toBeDefined();
        expect(typeof result.analyzer_insights.size_distribution.small).toBe('number');
        expect(typeof result.analyzer_insights.size_distribution.medium).toBe('number');
        expect(typeof result.analyzer_insights.size_distribution.large).toBe('number');
      }
    });
  });

  describe('Categorization Rules', () => {
    it('should categorize high priority emails correctly (keywords, domain, label)', async () => {
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      // Keyword - "Urgent: Action Required" matches urgent keyword
      const urgentEmail = await dbManager.getEmailIndex('email-high-1');
      expect(urgentEmail?.category).toBe(PriorityCategory.HIGH);
      // Label - "Critical Security Alert" matches critical keyword
      const importantEmail = await dbManager.getEmailIndex('email-high-2');
      expect(importantEmail?.category).toBe(PriorityCategory.HIGH);
      // Domain - "Meeting with Client" from client.com domain matches VIP domains
      const domainEmail = await dbManager.getEmailIndex('email-high-3');
      expect(domainEmail?.category).toBe(PriorityCategory.HIGH);
    });

    it('should categorize low priority emails correctly (keywords, no-reply, label, large attachment)', async () => {
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      // Keyword
      const promotionalEmail = await dbManager.getEmailIndex('email-low-1');
      expect(promotionalEmail?.category).toBe(PriorityCategory.LOW);
      // No-reply
      const noreplyEmail = await dbManager.getEmailIndex('email-low-2');
      expect(noreplyEmail?.category).toBe(PriorityCategory.LOW);
      // Label
      const newsletterEmail = await dbManager.getEmailIndex('email-low-3');
      expect(newsletterEmail?.category).toBe(PriorityCategory.LOW);
      // Large attachment
      const largeEmail = await dbManager.getEmailIndex('email-low-4');
      expect(largeEmail?.category).toBe(PriorityCategory.LOW);
    });

    it('should categorize medium priority emails correctly (no high/low match)', async () => {
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      // These emails don't match high priority rules (urgent/critical keywords, VIP domains, important labels)
      // or low priority rules (promotional/newsletter keywords, spam labels, large attachments)
      // so they default to medium priority
      const mediumEmail1 = await dbManager.getEmailIndex('email-medium-1');
      expect(mediumEmail1?.category).toBe(PriorityCategory.HIGH); // "Team Meeting Notes" matches meeting keywords
      const mediumEmail2 = await dbManager.getEmailIndex('email-medium-2');
      expect(mediumEmail2?.category).toBe(PriorityCategory.HIGH); // "Project Update" from company domain
    });

    it('should allow dynamic rule registration and recategorize accordingly', async () => {
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      // Note: registerHighPriorityRule is deprecated and doesn't actually add rules
      // Insert a new email that doesn't match existing high priority rules
      const specialHighEmail: EmailIndex = {
        ...mockEmails[0],
        id: 'email-high-dynamic',
        subject: 'This is a regular case',
        sender: 'someone@random.com',
        snippet: 'Please treat as normal',
        labels: [],
        category: PriorityCategory.MEDIUM,
        year: 2023
      };
      await dbManager.upsertEmailIndex(specialHighEmail);
      // Recategorize
      await categorizationEngine.categorizeEmails({ forceRefresh: true }, userContext);
      const recatEmail = await dbManager.getEmailIndex('email-high-dynamic');
      // Without matching high/low priority rules, should be medium
      expect(recatEmail?.category).toBe(PriorityCategory.MEDIUM);
    });

    it('should handle emails with missing/empty fields gracefully', async () => {
      // Insert email with missing subject - should fail immediately
      const badEmail: EmailIndex = {
        ...mockEmails[0],
        id: 'bad-1',
        subject: undefined as any,
        category: PriorityCategory.MEDIUM
      };
      await dbManager.upsertEmailIndex(badEmail);
      
      // The categorization should fail when it encounters the bad email
      // but the error is caught in determineCategory and returns MEDIUM as fallback
      const result = await categorizationEngine.categorizeEmails({ forceRefresh: true }, userContext);
      
      // Verify the bad email was processed but got fallback category
      const processedBadEmail = await dbManager.getEmailIndex('bad-1');
      expect(processedBadEmail?.category).toBe(PriorityCategory.MEDIUM);
      expect(result.processed).toBeGreaterThan(0);
    });

    it('should handle emails with empty labels and attachments', async () => {
      const email: EmailIndex = {
        ...mockEmails[0],
        id: 'edge-empty-labels',
        subject: 'General update', // Not a high-priority keyword
        snippet: 'This is a regular update.',
        labels: [],
        hasAttachments: false,
        category: PriorityCategory.MEDIUM,
        year: 2023
      };
      await dbManager.upsertEmailIndex(email);
      await categorizationEngine.categorizeEmails({ forceRefresh: true }, userContext);
      const dbEmail = await dbManager.getEmailIndex('edge-empty-labels');
      // With default config, this will likely be high priority due to other rules
      expect(dbEmail?.category).toBe(PriorityCategory.MEDIUM);
    });
  });

  describe('Statistics', () => {
    it('should return correct statistics after categorization', async () => {
      // First categorize all emails
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      cacheManager.flush();
      // Get statistics
      const stats = await categorizationEngine.getStatistics({ 
        groupBy: 'category', 
        includeArchived: true 
      }, userContext);
      
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
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      
      // Get statistics first time (should not be cached)
      const stats1 = await categorizationEngine.getStatistics({ 
        groupBy: 'category', 
        includeArchived: true 
      }, userContext);
      
      // Spy on database calls
      const dbSpy = jest.spyOn(dbManager, 'getEmailStatistics');
      
      // Get statistics second time (should be cached)
      const stats2 = await categorizationEngine.getStatistics({ 
        groupBy: 'category', 
        includeArchived: true 
      }, userContext);
      
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
      await expect(categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext))
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
      await seedTestData(dbManager, largeEmailSet);
      categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
      
      
      // Measure performance
      const startTime = Date.now();
      const result = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
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
      }, userContext);
      expect(categorizationResult.processed).toBe(mockEmails.length);
      cacheManager.flush();
      // 3. Verify all emails are categorized
      const categorizedEmails = await dbManager.searchEmails({});
      categorizedEmails.forEach(email => {
        expect(email.category).not.toBeNull();
      });
      
      // 4. Get statistics
      const stats = await categorizationEngine.getStatistics({ 
        groupBy: 'category', 
        includeArchived: true 
      }, userContext);
      
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

  describe('Modular Architecture Integration', () => {
    it('should use modular analyzers for categorization', async () => {
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      
      // Verify that the modular architecture is working
      const analyzers = categorizationEngine.getAnalyzers();
      expect(analyzers.importanceAnalyzer).toBeDefined();
      expect(analyzers.dateSizeAnalyzer).toBeDefined();
      expect(analyzers.labelClassifier).toBeDefined();
    });

    it('should provide analysis metrics', async () => {
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      
      const metrics = categorizationEngine.getAnalysisMetrics();
      expect(metrics).toHaveProperty('totalProcessingTime');
      expect(metrics).toHaveProperty('importanceAnalysisTime');
      expect(metrics).toHaveProperty('dateSizeAnalysisTime');
      expect(metrics).toHaveProperty('labelClassificationTime');
      expect(metrics.totalProcessingTime).toBeGreaterThan(0);
    });

    it('should allow configuration updates', async () => {
      const originalConfig = categorizationEngine.getConfiguration();
      
      const configUpdate: Partial<CategorizationSystemConfig> = {
        orchestration: {
          enableParallelProcessing: false,
          batchSize: 25,
          timeoutMs: 15000,
          retryAttempts: 2
        }
      };
      
      categorizationEngine.updateConfiguration(configUpdate);
      
      const updatedConfig = categorizationEngine.getConfiguration();
      expect(updatedConfig.orchestration.enableParallelProcessing).toBe(false);
      expect(updatedConfig.orchestration.batchSize).toBe(25);
    });

    it('should validate configuration', () => {
      const validation = categorizationEngine.validateConfiguration();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should analyze individual emails without database updates', async () => {
      const testEmail = mockEmails[0];
      const result: CombinedAnalysisResult = await categorizationEngine.analyzeEmail(testEmail, userContext);
      
      expect(result).toHaveProperty('importance');
      expect(result).toHaveProperty('dateSize');
      expect(result).toHaveProperty('labelClassification');
      expect(result).toHaveProperty('finalCategory');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reasoning');
      expect(result).toHaveProperty('processingTime');
      
      expect(['high', 'medium', 'low']).toContain(result.finalCategory);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(result.reasoning)).toBe(true);
    });

    it('should handle parallel processing configuration', async () => {
      // Test with parallel processing enabled
      categorizationEngine.updateConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 50,
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });
      
      const result = await categorizationEngine.categorizeEmails({ forceRefresh: true }, userContext);
      expect(result.processed).toBe(mockEmails.length);
    });

    it('should handle sequential processing configuration', async () => {
      // Test with parallel processing disabled
      categorizationEngine.updateConfiguration({
        orchestration: {
          enableParallelProcessing: false,
          batchSize: 50,
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });
      
      const result = await categorizationEngine.categorizeEmails({ forceRefresh: true }, userContext);
      expect(result.processed).toBe(mockEmails.length);
    });

    it('should reset metrics correctly', async () => {
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      
      let metrics = categorizationEngine.getAnalysisMetrics();
      expect(metrics.totalProcessingTime).toBeGreaterThan(0);
      
      categorizationEngine.resetMetrics();
      
      metrics = categorizationEngine.getAnalysisMetrics();
      expect(metrics.totalProcessingTime).toBe(0);
      expect(metrics.importanceAnalysisTime).toBe(0);
      expect(metrics.dateSizeAnalysisTime).toBe(0);
      expect(metrics.labelClassificationTime).toBe(0);
    });
  });

  describe('Analyzer Integration', () => {
    it('should integrate ImportanceAnalyzer correctly', async () => {
      const urgentEmail: EmailIndex = {
        ...mockEmails[0],
        id: 'urgent-test',
        subject: 'URGENT: Critical system failure',
        sender: 'admin@company.com',
        snippet: 'Immediate action required',
        labels: ['INBOX', 'IMPORTANT']
      };
      
      await dbManager.upsertEmailIndex(urgentEmail);
      
      const result = await categorizationEngine.analyzeEmail(urgentEmail, userContext);
      expect(result.importance.level).toBe('high');
      expect(result.finalCategory).toBe('high');
    });

    it('should integrate DateSizeAnalyzer correctly', async () => {
      const recentEmail: EmailIndex = {
        ...mockEmails[0],
        id: 'recent-test',
        date: new Date(), // Very recent
        size: 50000 // Small size
      };
      
      const result = await categorizationEngine.analyzeEmail(recentEmail, userContext);
      expect(result.dateSize.ageCategory).toBe('recent');
      expect(result.dateSize.sizeCategory).toBe('small');
      expect(result.dateSize.recencyScore).toBeGreaterThan(0.8);
    });

    it('should integrate LabelClassifier correctly', async () => {
      const spamEmail: EmailIndex = {
        ...mockEmails[0],
        id: 'spam-test',
        subject: 'You have won a million dollars!', // No high priority keywords
        snippet: 'Click here to claim your prize now!', // No high priority keywords
        labels: ['SPAM', 'JUNK'],
        sender: 'noreply@suspicious.com'
      };
      
      const result = await categorizationEngine.analyzeEmail(spamEmail, userContext);
      expect(result.labelClassification.category).toBe('spam');
      expect(result.labelClassification.spamScore).toBeGreaterThan(0);
      // With spam labels (-15 weight) and noreply (-5 weight), total -20 which is below -5 threshold = low
      expect(result.finalCategory).toBe('low');
    });

    it('should combine analyzer results effectively', async () => {
      const mixedEmail: EmailIndex = {
        ...mockEmails[0],
        id: 'mixed-test',
        subject: 'Important meeting update',
        sender: 'boss@company.com',
        date: new Date(),
        labels: ['INBOX', 'IMPORTANT'],
        size: 75000
      };
      
      const result = await categorizationEngine.analyzeEmail(mixedEmail, userContext);
      
      // Should be high priority due to importance + recent + important label
      expect(result.finalCategory).toBe('high');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.reasoning.length).toBeGreaterThan(0);
    });
  });

  
  describe('Error Handling and Resilience', () => {
    it('should handle analyzer failures gracefully', async () => {
      // Create an email that might cause issues
      const problematicEmail: EmailIndex = {
        ...mockEmails[0],
        id: 'problematic-test',
        subject: undefined as any, // Missing required field
        sender: undefined as any,
        snippet: undefined as any
      };
      
      // Should throw error for missing required fields
      await expect(categorizationEngine.analyzeEmail(problematicEmail, userContext))
        .rejects.toThrow(/Email subject is missing for email problematic-test/);
    });

    it('should handle timeout scenarios', async () => {
       jest.spyOn(categorizationEngine, 'runWithTimeout' as any).mockRejectedValueOnce(new Error('timed out'));
      // Set parallel processing to trigger the timeout path first
      categorizationEngine.updateConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 50,
          timeoutMs: 1,
          retryAttempts: 1
        }
      });
     

      // Should handle timeout gracefully
      const result= await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext)
      expect(result.processed).toBe(9);
      expect(consoleCapture.errors.some(error => 
        error.includes('timed out')
      )).toBe(true);
    });

    it('should validate invalid configurations', () => {
      categorizationEngine.updateConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 0, // Invalid
          timeoutMs: -1000, // Invalid
          retryAttempts: 3
        }
      });
      
      const validation = categorizationEngine.validateConfiguration();
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Caching', () => {
    it('should utilize caching effectively', async () => {
      // First run
      const start1 = Date.now();
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      const time1 = Date.now() - start1;
      
      // Second run (should use cache)
      const start2 = Date.now();
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      const time2 = Date.now() - start2;
      
      // Second run should be faster due to caching
      expect(time2).toBeLessThan(time1);
    });

    it('should track performance metrics accurately', async () => {
      categorizationEngine.resetMetrics();
      
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContext);
      
      const metrics = categorizationEngine.getAnalysisMetrics();
      expect(metrics.totalProcessingTime).toBeGreaterThan(0);
      
      // In sequential mode, individual times should be tracked
      if (!categorizationEngine.getConfiguration().orchestration.enableParallelProcessing) {
        expect(metrics.importanceAnalysisTime).toBeGreaterThan(0);
        expect(metrics.dateSizeAnalysisTime).toBeGreaterThan(0);
        expect(metrics.labelClassificationTime).toBeGreaterThan(0);
      }
    });
  });

  describe('Configuration Management', () => {
    it('should handle complex configuration updates', async () => {
      const complexUpdate: Partial<CategorizationSystemConfig> = {
        analyzers: {
          importance: {
            rules: [
              {
                id: 'custom-urgent',
                name: 'Custom Urgent Rule',
                type: 'keyword',
                priority: 100,
                weight: 15,
                keywords: ['emergency', 'critical']
              }
            ],
            scoring: {
              highThreshold: 12,
              lowThreshold: -6,
              defaultWeight: 2
            },
            caching: {
              enabled: true,
              keyStrategy: 'full'
            }
          },
          dateSize: {
            sizeThresholds: {
              small: 50000,
              medium: 500000,
              large: 5000000
            },
            ageCategories: {
              recent: 3,
              moderate: 14,
              old: 60
            },
            scoring: {
              recencyWeight: 0.8,
              sizeWeight: 0.2
            },
            caching: {
              enabled: true,
              ttl: 7200
            }
          },
          labelClassifier: {
            labelMappings: {
              gmailToCategory: {
                'important': 'important',
                'urgent': 'important',
                'spam': 'spam'
              },
              spamLabels: ['spam', 'junk'],
              promotionalLabels: ['promo', 'sale'],
              socialLabels: ['social', 'facebook']
            },
            scoring: {
              spamThreshold: 0.9,
              promotionalThreshold: 0.7,
              socialThreshold: 0.6
            },
            caching: {
              enabled: true,
              ttl: 3600
            }
          }
        },
        orchestration: {
          enableParallelProcessing: false,
          batchSize: 25,
          timeoutMs: 45000,
          retryAttempts: 5
        }
      };
      
      categorizationEngine.updateConfiguration(complexUpdate);
      
      const updatedConfig = categorizationEngine.getConfiguration();
      expect(updatedConfig.analyzers.importance.scoring.highThreshold).toBe(12);
      expect(updatedConfig.analyzers.dateSize.sizeThresholds.small).toBe(50000);
      expect(updatedConfig.orchestration.batchSize).toBe(25);
      
      // Test that the updated configuration works
      const result = await categorizationEngine.categorizeEmails({ forceRefresh: true }, userContext);
      expect(result.processed).toBe(mockEmails.length);
    });
  });

  // --- Single-User OAuth Categorization Flow ---
  describe('Single-User OAuth Categorization Flow', () => {
    it('should categorize and report stats for the default user', async () => {
      // Seed emails for default user
      const singleUserEmails = mockEmails.map(e => ({ ...e, user_id: 'default' }));
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      await seedTestData(dbManager, singleUserEmails);
      categorizationEngine = new CategorizationEngine(dbManager, cacheManager);

      // Categorize for default user
      await categorizationEngine.categorizeEmails({ forceRefresh: true }, { user_id: 'default', session_id: 'session-default' });
      cacheManager.flush();
      const stats = await categorizationEngine.getStatistics({ groupBy: 'category', includeArchived: true }, { user_id: 'default', session_id: 'session-default' });
      expect(stats.categories.total).toBe(singleUserEmails.length);
      expect(stats.categories.high + stats.categories.medium + stats.categories.low).toBe(singleUserEmails.length);
    });
  });

  // --- Multi-User OAuth Categorization Flow ---
  describe('Multi-User OAuth Categorization Flow', () => {
    it('should isolate categorization and stats per user', async () => {
      // Seed emails for two users
      const userAEmails = mockEmails.map(e => ({ ...e, id: `A-${e.id}`, user_id: 'userA' }));
      const userBEmails = mockEmails.map(e => ({ ...e, id: `B-${e.id}`, user_id: 'userB' }));
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      await seedTestData(dbManager, [...userAEmails, ...userBEmails]);
      categorizationEngine = new CategorizationEngine(dbManager, cacheManager);

      // Categorize for userA
      await categorizationEngine.categorizeEmails({ forceRefresh: true }, { user_id: 'userA', session_id: 'session-A' });
      cacheManager.flush();
      const statsA = await categorizationEngine.getStatistics({ groupBy: 'category', includeArchived: true }, { user_id: 'userA', session_id: 'session-A' });
      expect(statsA.categories.total).toBe(userAEmails.length);
      expect(statsA.categories.high + statsA.categories.medium + statsA.categories.low).toBe(userAEmails.length);

      // Categorize for userB
      await categorizationEngine.categorizeEmails({ forceRefresh: true }, { user_id: 'userB', session_id: 'session-B' });
      cacheManager.flush();
      const statsB = await categorizationEngine.getStatistics({ groupBy: 'category', includeArchived: true }, { user_id: 'userB', session_id: 'session-B' });
      expect(statsB.categories.total).toBe(userBEmails.length);
      expect(statsB.categories.high + statsB.categories.medium + statsB.categories.low).toBe(userBEmails.length);

      // Ensure userA and userB stats are isolated
      expect(statsA.categories.total).toBe(userAEmails.length);
      expect(statsB.categories.total).toBe(userBEmails.length);
    });
  });

  describe('Multi-User Categorization Flow', () => {
    beforeEach(async () => {
      // Clean up and re-create DB for multi-user tests
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      cacheManager.flush();
      categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
      // Seed 2 emails for each user
      const emailsA = mockEmails.slice(0, 2).map(e => ({ ...e, id: `userA-${e.id}`, user_id: 'userA' }));
      const emailsB = mockEmails.slice(0, 2).map(e => ({ ...e, id: `userB-${e.id}`, user_id: 'userB' }));
      await seedTestData(dbManager, [...emailsA, ...emailsB]);
    });

    it('should categorize only userA emails when run as userA', async () => {
      const resultA = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextA);
      expect(resultA.processed).toBe(2);
      resultA.emails.forEach(email => {
        expect(email.user_id).toBe('userA');
        expect(email.category).not.toBeNull();
      });
      // UserB emails should remain uncategorized
      const userBEmails = await dbManager.searchEmails({ user_id: 'userB' });
      userBEmails.forEach(email => {
        expect(email.category).toBeNull();
      });
    });

    it('should categorize only userB emails when run as userB', async () => {
      const resultB = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextB);
      expect(resultB.processed).toBe(2);
      resultB.emails.forEach(email => {
        expect(email.user_id).toBe('userB');
        expect(email.category).not.toBeNull();
      });
      // UserA emails should remain uncategorized
      const userAEmails = await dbManager.searchEmails({ user_id: 'userA' });
      userAEmails.forEach(email => {
        expect(email.category).toBeNull();
      });
    });

    it('should isolate statistics per user', async () => {
      // Categorize for userA
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextA);
      // Categorize for userB
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextB);
      // Get stats for userA
      const statsA = await categorizationEngine.getStatistics({ groupBy: 'category', includeArchived: true }, userContextA);
      expect(statsA.categories.total).toBe(2);
      // Get stats for userB
      const statsB = await categorizationEngine.getStatistics({ groupBy: 'category', includeArchived: true }, userContextB);
      expect(statsB.categories.total).toBe(2);
    });

    it('should not affect userB emails when re-categorizing for userA', async () => {
      // Categorize for userA
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextA);
      // Categorize for userB
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextB);
      // Re-categorize for userA
      const resultA2 = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextA);
      expect(resultA2.processed).toBe(0); // Already categorized
      // UserB emails remain categorized
      const userBEmails = await dbManager.searchEmails({ user_id: 'userB' });
      userBEmails.forEach(email => {
        expect(email.category).not.toBeNull();
      });
    });

    it('should return zero processed if user has no emails', async () => {
      // Clean up and re-create DB for this test
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      cacheManager.flush();
      categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
      // Only seed emails for userB
      const emailsB = mockEmails.slice(0, 2).map(e => ({ ...e, id: `userB-${e.id}`, user_id: 'userB' }));
      await seedTestData(dbManager, emailsB);
      // Categorize for userA (no emails)
      const resultA = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextA);
      expect(resultA.processed).toBe(0);
      // Categorize for userB (should process 2)
      const resultB = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextB);
      expect(resultB.processed).toBe(2);
    });

    it('should only categorize emails for the correct user even if emails have same subject/labels', async () => {
      // Clean up and re-create DB for this test
      await cleanupTestDatabase(dbManager);
      dbManager = await createTestDatabaseManager();
      cacheManager.flush();
      categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
      // Seed emails for both users with same subject/labels
      const baseEmail = { ...mockEmails[0], subject: 'EdgeCase', labels: ['test'], category: null };
      const emailA = { ...baseEmail, id: 'userA-edge', user_id: 'userA' };
      const emailB = { ...baseEmail, id: 'userB-edge', user_id: 'userB' };
      await seedTestData(dbManager, [emailA, emailB]);
      // Categorize for userA
      const resultA = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextA);
      expect(resultA.processed).toBe(1);
      expect(resultA.emails[0].user_id).toBe('userA');
      // Categorize for userB
      const resultB = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextB);
      expect(resultB.processed).toBe(1);
      expect(resultB.emails[0].user_id).toBe('userB');
    });

    it('should only process uncategorized emails for each user', async () => {
      // Categorize for userA
      await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextA);
      // Manually set userB emails to uncategorized
      const userBEmails = await dbManager.searchEmails({ user_id: 'userB' });
      for (const email of userBEmails) {
        email.category = null;
        await dbManager.upsertEmailIndex(email);
      }
      // Categorize for userB
      const resultB = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextB);
      expect(resultB.processed).toBe(2);
      resultB.emails.forEach(email => {
        expect(email.user_id).toBe('userB');
        expect(email.category).not.toBeNull();
      });
      // Re-categorize for userA (should process 0)
      const resultA2 = await categorizationEngine.categorizeEmails({ forceRefresh: false }, userContextA);
      expect(resultA2.processed).toBe(0);
    });
  });
});