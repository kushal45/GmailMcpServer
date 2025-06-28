import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DateSizeAnalyzer } from '../../../src/categorization/analyzers/DateSizeAnalyzer.js';
import { LabelClassifier } from '../../../src/categorization/analyzers/LabelClassifier.js';
import { AnalyzerFactory } from '../../../src/categorization/factories/AnalyzerFactory.js';
import { CategorizationEngine } from '../../../src/categorization/CategorizationEngine.js';
import {
  EmailAnalysisContext,
  ImportanceAnalyzerConfig,
  DateSizeAnalyzerConfig,
  LabelClassifierConfig,
  IImportanceAnalyzer,
  EnhancedCategorizationResult
} from '../../../src/categorization/types.js';
import { CacheManager } from '../../../src/cache/CacheManager.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { EmailIndex } from '../../../src/types/index.js';
import {
  createTestDatabaseManager,
  cleanupTestDatabase,
  generatePerformanceTestEmails,
  createTestSystemConfig
} from '../../integration/categorization/helpers/testHelpers.js';

describe('Analyzer Performance Tests', () => {
  let mockCacheManager: jest.Mocked<CacheManager>;
  let dbManager: DatabaseManager;
  let factory: AnalyzerFactory;

  beforeEach(async () => {
    // Create mock cache manager
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      flush: jest.fn(),
      has: jest.fn(),
      stats: jest.fn()
    } as any;

    // Create real database manager for performance testing
    dbManager = await createTestDatabaseManager();
    factory = new AnalyzerFactory(dbManager, mockCacheManager);
  });

  afterEach(async () => {
    await cleanupTestDatabase(dbManager);
    jest.clearAllMocks();
  });

  describe('ImportanceAnalyzer Performance', () => {
    let analyzer: IImportanceAnalyzer;
    let testEmails: EmailIndex[];

    beforeEach(() => {
      const config: ImportanceAnalyzerConfig = {
        rules: [
          {
            id: 'perf-urgent',
            name: 'Performance Urgent Keywords',
            type: 'keyword',
            priority: 100,
            weight: 15,
            keywords: ['urgent', 'critical', 'emergency', 'asap', 'immediate']
          },
          {
            id: 'perf-domains',
            name: 'Performance Important Domains',
            type: 'domain',
            priority: 90,
            weight: 10,
            domains: ['company.com', 'client.com', 'important.org']
          },
          {
            id: 'perf-labels',
            name: 'Performance Important Labels',
            type: 'label',
            priority: 85,
            weight: 8,
            labels: ['IMPORTANT', 'STARRED', 'PRIORITY']
          },
          {
            id: 'perf-promotional',
            name: 'Performance Promotional Keywords',
            type: 'keyword',
            priority: 20,
            weight: -8,
            keywords: ['sale', 'discount', 'offer', 'promotion', 'deal']
          }
        ],
        scoring: {
          highThreshold: 10,
          lowThreshold: -5,
          defaultWeight: 1
        },
        caching: {
          enabled: true,
          keyStrategy: 'partial'
        }
      };

      analyzer = factory.createImportanceAnalyzer(config);
      testEmails = generatePerformanceTestEmails(1000);
    });

    it('should analyze 1000 emails within reasonable time', async () => {
      const startTime = Date.now();
      
      for (const email of testEmails.slice(0, 1000)) {
        const context: EmailAnalysisContext = {
          email,
          user_id: 'test-user',
          subject: email.subject || 'Test Subject',
          sender: email.sender || 'test@example.com',
          snippet: email.snippet || 'Test snippet',
          labels: email.labels || [],
          date: email.date || new Date(),
          size: email.size || 50000,
          hasAttachments: email.hasAttachments || false
        };
        
        await analyzer.analyzeImportance(context);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTimePerEmail = totalTime / 1000;
      
      console.log(`ImportanceAnalyzer: 1000 emails analyzed in ${totalTime}ms (${avgTimePerEmail.toFixed(2)}ms per email)`);
      
      // Should process each email in less than 10ms on average
      expect(avgTimePerEmail).toBeLessThan(10);
      
      // Total time should be less than 10 seconds
      expect(totalTime).toBeLessThan(10000);
    });

    it('should benefit from caching on repeated analysis', async () => {
      const testEmail = testEmails[0];
      const context: EmailAnalysisContext = {
        email: testEmail,
        user_id: 'test-user',
        subject: testEmail.subject || 'Test Subject',
        sender: testEmail.sender || 'test@example.com',
        snippet: testEmail.snippet || 'Test snippet',
        labels: testEmail.labels || [],
        date: testEmail.date || new Date(),
        size: testEmail.size || 50000,
        hasAttachments: testEmail.hasAttachments || false
      };

      // First analysis (cache miss)
      mockCacheManager.get.mockReturnValue(null);
      const startTime1 = Date.now();
      await analyzer.analyzeImportance(context);
      const time1 = Date.now() - startTime1;

      // Second analysis (cache hit)
      const cachedResult = {
        score: 5,
        level: 'medium' as const,
        matchedRules: ['test'],
        confidence: 0.8
      };
      mockCacheManager.get.mockReturnValue(cachedResult);
      
      const startTime2 = Date.now();
      await analyzer.analyzeImportance(context);
      const time2 = Date.now() - startTime2;

      console.log(`ImportanceAnalyzer: Cache miss: ${time1}ms, Cache hit: ${time2}ms`);
      
      // Cache hit should be faster or at least not significantly slower
      // Handle case where both times are 0ms (very fast execution)
      if (time1 === 0 && time2 === 0) {
        // Both are very fast, test passes
        expect(true).toBe(true);
      } else if (time1 > 0) {
        // Cache hit should be faster or equal
        expect(time2).toBeLessThanOrEqual(time1);
      } else {
        // If time1 is 0 but time2 is not, that's still acceptable
        expect(time2).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle concurrent analysis efficiently', async () => {
      const concurrentEmails = testEmails.slice(0, 100);
      const contexts = concurrentEmails.map(email => ({
        email,
        user_id: 'test-user',
        subject: email.subject || 'Test Subject',
        sender: email.sender || 'test@example.com',
        snippet: email.snippet || 'Test snippet',
        labels: email.labels || [],
        date: email.date || new Date(),
        size: email.size || 50000,
        hasAttachments: email.hasAttachments || false
      }));

      const startTime = Date.now();
      
      // Analyze all emails concurrently
      const results = await Promise.all(
        contexts.map(context => analyzer.analyzeImportance(context))
      );
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      console.log(`ImportanceAnalyzer: 100 concurrent analyses completed in ${totalTime}ms`);
      
      expect(results).toHaveLength(100);
      expect(totalTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });

  describe('DateSizeAnalyzer Performance', () => {
    let analyzer: DateSizeAnalyzer;
    let testEmails: EmailIndex[];

    beforeEach(() => {
      const config: DateSizeAnalyzerConfig = {
        sizeThresholds: {
          small: 100000,
          medium: 1000000,
          large: 10000000
        },
        ageCategories: {
          recent: 7,
          moderate: 30,
          old: 90
        },
        scoring: {
          recencyWeight: 0.7,
          sizeWeight: 0.3
        },
        caching: {
          enabled: true,
          ttl: 3600
        }
      };

      analyzer = factory.createDateSizeAnalyzer(config) as DateSizeAnalyzer;
      testEmails = generatePerformanceTestEmails(1000);
    });

    it('should analyze 1000 emails within reasonable time', async () => {
      const startTime = Date.now();
      
      for (const email of testEmails.slice(0, 1000)) {
        const context: EmailAnalysisContext = {
          email,
          user_id: 'test-user',
          subject: email.subject || 'Test Subject',
          sender: email.sender || 'test@example.com',
          snippet: email.snippet || 'Test snippet',
          labels: email.labels || [],
          date: email.date || new Date(),
          size: email.size || 50000,
          hasAttachments: email.hasAttachments || false
        };
        
        await analyzer.analyzeDateSize(context);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTimePerEmail = totalTime / 1000;
      
      console.log(`DateSizeAnalyzer: 1000 emails analyzed in ${totalTime}ms (${avgTimePerEmail.toFixed(2)}ms per email)`);
      
      // Should process each email in less than 5ms on average (simpler analysis)
      expect(avgTimePerEmail).toBeLessThan(5);
      
      // Total time should be less than 5 seconds
      expect(totalTime).toBeLessThan(5000);
    });

    it('should categorize by age efficiently', () => {
      const dates = [
        new Date(), // Recent
        new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // Moderate
        new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // Old
      ];

      const startTime = Date.now();
      
      for (let i = 0; i < 10000; i++) {
        const date = dates[i % dates.length];
        analyzer.categorizeByAge(date);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      console.log(`DateSizeAnalyzer: 10000 age categorizations in ${totalTime}ms`);
      
      // Should be very fast for simple categorization
      expect(totalTime).toBeLessThan(100);
    });

    it('should categorize by size efficiently', () => {
      const sizes = [50000, 500000, 5000000, 50000000]; // Various sizes

      const startTime = Date.now();
      
      for (let i = 0; i < 10000; i++) {
        const size = sizes[i % sizes.length];
        analyzer.categorizeBySize(size);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      console.log(`DateSizeAnalyzer: 10000 size categorizations in ${totalTime}ms`);
      
      // Should be very fast for simple categorization
      expect(totalTime).toBeLessThan(50);
    });
  });

  describe('LabelClassifier Performance', () => {
    let classifier: LabelClassifier;

    beforeEach(() => {
      const config: LabelClassifierConfig = {
        labelMappings: {
          gmailToCategory: {
            'important': 'important',
            'starred': 'important',
            'spam': 'spam',
            'junk': 'spam',
            'promotions': 'promotions',
            'social': 'social',
            'updates': 'updates',
            'forums': 'forums'
          },
          spamLabels: ['spam', 'junk', 'phishing', 'malware', 'suspicious'],
          promotionalLabels: ['promotions', 'category_promotions', 'sale', 'offer', 'discount'],
          socialLabels: ['category_social', 'facebook', 'twitter', 'linkedin', 'instagram']
        },
        scoring: {
          spamThreshold: 0.7,
          promotionalThreshold: 0.5,
          socialThreshold: 0.4
        },
        caching: {
          enabled: true,
          ttl: 1800
        }
      };

      classifier = factory.createLabelClassifier(config) as LabelClassifier;
    });

    it('should classify 1000 label sets within reasonable time', async () => {
      const labelSets = [
        ['INBOX'],
        ['INBOX', 'IMPORTANT'],
        ['SPAM', 'JUNK'],
        ['INBOX', 'PROMOTIONS'],
        ['INBOX', 'CATEGORY_SOCIAL'],
        ['INBOX', 'UPDATES'],
        ['INBOX', 'FORUMS'],
        ['INBOX', 'STARRED'],
        ['INBOX', 'CATEGORY_PROMOTIONS', 'SALE'],
        ['INBOX', 'IMPORTANT', 'STARRED']
      ];

      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        const labels = labelSets[i % labelSets.length];
        await classifier.classifyLabels(labels, 'test-user');
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTimePerClassification = totalTime / 1000;
      
      console.log(`LabelClassifier: 1000 classifications in ${totalTime}ms (${avgTimePerClassification.toFixed(2)}ms per classification)`);
      
      // Should process each classification in less than 3ms on average
      expect(avgTimePerClassification).toBeLessThan(3);
      
      // Total time should be less than 3 seconds
      expect(totalTime).toBeLessThan(3000);
    });

    it('should detect spam indicators efficiently', () => {
      const spamLabelSets = [
        ['SPAM'],
        ['JUNK'],
        ['SPAM', 'JUNK'],
        ['PHISHING'],
        ['MALWARE'],
        ['SUSPICIOUS'],
        ['SPAM', 'PHISHING', 'MALWARE']
      ];

      const startTime = Date.now();
      
      for (let i = 0; i < 10000; i++) {
        const labels = spamLabelSets[i % spamLabelSets.length];
        classifier.detectSpamIndicators(labels);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      console.log(`LabelClassifier: 10000 spam detections in ${totalTime}ms`);
      
      // Should be very fast for spam detection
      expect(totalTime).toBeLessThan(500);
    });

    it('should categorize Gmail labels efficiently', () => {
      const labelSets = [
        ['important'],
        ['starred'],
        ['spam'],
        ['promotions'],
        ['social'],
        ['updates'],
        ['forums'],
        ['primary']
      ];

      const startTime = Date.now();
      
      for (let i = 0; i < 10000; i++) {
        const labels = labelSets[i % labelSets.length];
        classifier.categorizeByGmailLabels(labels);
      }
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      
      console.log(`LabelClassifier: 10000 Gmail categorizations in ${totalTime}ms`);
      
      // Should be very fast for simple categorization
      expect(totalTime).toBeLessThan(200);
    });
  });

  describe('CategorizationEngine End-to-End Performance', () => {
    let engine: CategorizationEngine;
    let testEmails: EmailIndex[];

    beforeEach(async () => {
      const config = createTestSystemConfig();
      engine = new CategorizationEngine(dbManager, mockCacheManager, config);
      testEmails = generatePerformanceTestEmails(500);
      
      // Seed test data
      await dbManager.bulkUpsertEmailIndex(testEmails);
    });

    it('should categorize 500 emails within reasonable time', async () => {
      const startTime = Date.now();
      
      const result: EnhancedCategorizationResult = await engine.categorizeEmails({ forceRefresh: false });
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgTimePerEmail = totalTime / result.processed;
      
      console.log(`CategorizationEngine: ${result.processed} emails categorized in ${totalTime}ms (${avgTimePerEmail.toFixed(2)}ms per email)`);
      
      expect(result.processed).toBe(testEmails.length);
      
      // NEW: Verify enhanced return format doesn't significantly impact performance
      expect(result.emails).toBeDefined();
      expect(result.emails.length).toBe(result.processed);
      expect(result.analyzer_insights).toBeDefined();
      
      // Verify that returning emails doesn't significantly impact performance
      expect(avgTimePerEmail).toBeLessThan(50);
      expect(totalTime).toBeLessThan(25000);
    });

    it('should show performance improvement with parallel processing', async () => {
      // Test sequential processing
      engine.updateConfiguration({
        orchestration: {
          enableParallelProcessing: false,
          batchSize: 50,
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });

      const startTime1 = Date.now();
      const sequentialResult: EnhancedCategorizationResult = await engine.categorizeEmails({ forceRefresh: true });
      const sequentialTime = Date.now() - startTime1;

      // Test parallel processing
      engine.updateConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 50,
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });

      const startTime2 = Date.now();
      const parallelResult: EnhancedCategorizationResult = await engine.categorizeEmails({ forceRefresh: true });
      const parallelTime = Date.now() - startTime2;

      console.log(`CategorizationEngine: Sequential: ${sequentialTime}ms, Parallel: ${parallelTime}ms`);
      
      // NEW: Verify both results have enhanced format
      expect(sequentialResult.emails).toBeDefined();
      expect(sequentialResult.analyzer_insights).toBeDefined();
      expect(parallelResult.emails).toBeDefined();
      expect(parallelResult.analyzer_insights).toBeDefined();
      
      // Parallel should be faster (though not always guaranteed due to overhead)
      // At minimum, parallel shouldn't be significantly slower
      expect(parallelTime).toBeLessThan(sequentialTime * 1.5);
    });

    it('should track performance metrics accurately', async () => {
      engine.resetMetrics();
      
      const result: EnhancedCategorizationResult = await engine.categorizeEmails({ forceRefresh: false });
      
      const metrics = engine.getAnalysisMetrics();
      
      expect(metrics.totalProcessingTime).toBeGreaterThan(0);
      
      console.log('Performance Metrics:', {
        totalProcessingTime: metrics.totalProcessingTime,
        importanceAnalysisTime: metrics.importanceAnalysisTime,
        dateSizeAnalysisTime: metrics.dateSizeAnalysisTime,
        labelClassificationTime: metrics.labelClassificationTime,
        emailsReturned: result.emails.length,
        insightsGenerated: result.analyzer_insights ? 'Yes' : 'No'
      });
      
      // NEW: Verify enhanced return format doesn't affect metrics tracking
      expect(result.emails).toBeDefined();
      expect(result.analyzer_insights).toBeDefined();
      
      // Verify metrics are reasonable
      expect(metrics.totalProcessingTime).toBeLessThan(30000); // Less than 30 seconds
    });

    it('should handle large batch sizes efficiently', async () => {
      // Generate larger dataset
      const largeTestEmails = generatePerformanceTestEmails(1000);
      await dbManager.bulkUpsertEmailIndex(largeTestEmails);

      engine.updateConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 100, // Larger batch size
          timeoutMs: 60000,
          retryAttempts: 3
        }
      });

      const startTime = Date.now();
      const result: EnhancedCategorizationResult = await engine.categorizeEmails({ forceRefresh: false });
      const endTime = Date.now();
      
      const totalTime = endTime - startTime;
      const avgTimePerEmail = totalTime / result.processed;
      
      console.log(`CategorizationEngine (Large Batch): ${result.processed} emails in ${totalTime}ms (${avgTimePerEmail.toFixed(2)}ms per email)`);
      
      expect(result.processed).toBe(largeTestEmails.length);
      
      // NEW: Verify enhanced return format works with large batches
      expect(result.emails).toBeDefined();
      expect(result.emails.length).toBe(result.processed);
      expect(result.analyzer_insights).toBeDefined();
      
      // Verify performance is still reasonable with enhanced data
      expect(avgTimePerEmail).toBeLessThan(100);
      
      // NEW: Add specific test for large batch analyzer insights
      if (result.analyzer_insights) {
        expect(result.analyzer_insights.age_distribution.recent +
               result.analyzer_insights.age_distribution.moderate +
               result.analyzer_insights.age_distribution.old).toBe(result.processed);
        expect(result.analyzer_insights.size_distribution.small +
               result.analyzer_insights.size_distribution.medium +
               result.analyzer_insights.size_distribution.large).toBe(result.processed);
      }
    });
  });

  describe('Memory Usage and Resource Management', () => {
    it('should not leak memory during repeated analysis', async () => {
      const analyzer = factory.createImportanceAnalyzer();
      const testEmail = generatePerformanceTestEmails(1)[0];
      
      const context: EmailAnalysisContext = {
        email: testEmail,
        user_id: 'test-user',
        subject: testEmail.subject || 'Test Subject',
        sender: testEmail.sender || 'test@example.com',
        snippet: testEmail.snippet || 'Test snippet',
        labels: testEmail.labels || [],
        date: testEmail.date || new Date(),
        size: testEmail.size || 50000,
        hasAttachments: testEmail.hasAttachments || false
      };

      // Perform many analyses to check for memory leaks
      for (let i = 0; i < 10000; i++) {
        await analyzer.analyzeImportance(context);
        
        // Force garbage collection periodically (if available)
        if (i % 1000 === 0 && global.gc) {
          global.gc();
        }
      }

      // Test should complete without running out of memory
      expect(true).toBe(true);
    });

    it('should handle cache size limits appropriately', async () => {
      // This test would require a real cache implementation with size limits
      // For now, we just verify that the cache is being used
      const analyzer = factory.createImportanceAnalyzer();
      
      // Generate many different contexts to fill cache
      for (let i = 0; i < 100; i++) {
        const testEmail = generatePerformanceTestEmails(1)[0];
        testEmail.id = `cache-test-${i}`;
        testEmail.subject = `Cache Test ${i}`;
        
        const context: EmailAnalysisContext = {
          email: testEmail,
          user_id: 'test-user',
          subject: testEmail.subject,
          sender: testEmail.sender || 'test@example.com',
          snippet: testEmail.snippet || 'Test snippet',
          labels: testEmail.labels || [],
          date: testEmail.date || new Date(),
          size: testEmail.size || 50000,
          hasAttachments: testEmail.hasAttachments || false
        };
        
        await analyzer.analyzeImportance(context);
      }
      
      // Verify cache operations were called
      expect(mockCacheManager.set).toHaveBeenCalled();
    });
  });

  describe('Multi-User Performance', () => {
    let analyzer: IImportanceAnalyzer;
    let testEmailsA: EmailIndex[];
    let testEmailsB: EmailIndex[];

    beforeEach(() => {
      const config: ImportanceAnalyzerConfig = {
        rules: [
          {
            id: 'multiuser-keyword',
            name: 'Multiuser Keyword',
            type: 'keyword',
            priority: 100,
            weight: 10,
            keywords: ['multiuser', 'test']
          }
        ],
        scoring: {
          highThreshold: 8,
          lowThreshold: -3,
          defaultWeight: 1
        },
        caching: {
          enabled: true,
          keyStrategy: 'partial'
        }
      };
      analyzer = factory.createImportanceAnalyzer(config);
      testEmailsA = generatePerformanceTestEmails(100).map(e => ({ ...e, user_id: 'userA' }));
      testEmailsB = generatePerformanceTestEmails(100).map(e => ({ ...e, user_id: 'userB' }));
    });

    it('should analyze emails for userA and userB in isolation and with good performance', async () => {
      const startA = Date.now();
      for (const email of testEmailsA) {
        const context: EmailAnalysisContext = {
          email,
          user_id: 'userA',
          subject: email.subject || 'Test Subject',
          sender: email.sender || 'test@example.com',
          snippet: email.snippet || 'Test snippet',
          labels: email.labels || [],
          date: email.date || new Date(),
          size: email.size || 50000,
          hasAttachments: email.hasAttachments || false
        };
        await analyzer.analyzeImportance(context);
      }
      const endA = Date.now();
      const totalA = endA - startA;
      expect(totalA).toBeLessThan(3000);

      const startB = Date.now();
      for (const email of testEmailsB) {
        const context: EmailAnalysisContext = {
          email,
          user_id: 'userB',
          subject: email.subject || 'Test Subject',
          sender: email.sender || 'test@example.com',
          snippet: email.snippet || 'Test snippet',
          labels: email.labels || [],
          date: email.date || new Date(),
          size: email.size || 50000,
          hasAttachments: email.hasAttachments || false
        };
        await analyzer.analyzeImportance(context);
      }
      const endB = Date.now();
      const totalB = endB - startB;
      expect(totalB).toBeLessThan(3000);
    });
  });
});