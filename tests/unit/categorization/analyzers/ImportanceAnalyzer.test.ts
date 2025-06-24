import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { ImportanceAnalyzer } from '../../../../src/categorization/analyzers/ImportanceAnalyzer.js';
import { 
  ImportanceAnalyzerConfig, 
  EmailAnalysisContext, 
  ImportanceResult,
  ImportanceRule,
  RuleResult
} from '../../../../src/categorization/interfaces/IImportanceAnalyzer.js';
import { CacheManager } from '../../../../src/cache/CacheManager.js';
import { DatabaseManager } from '../../../../src/database/DatabaseManager.js';
import { EmailIndex } from '../../../../src/types/index.js';
import { Labels } from '../../../../src/categorization/types.js';

describe('ImportanceAnalyzer Unit Tests', () => {
  let analyzer: ImportanceAnalyzer;
  let mockCacheManager: jest.Mocked<CacheManager>;
  let mockDatabaseManager: jest.Mocked<DatabaseManager>;
  let testConfig: ImportanceAnalyzerConfig;
  let testContext: EmailAnalysisContext;

  beforeEach(() => {
    // Create mock cache manager
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      flush: jest.fn(),
      has: jest.fn(),
      stats: jest.fn()
    } as any;

    // Create mock database manager
    mockDatabaseManager = {
      initialize: jest.fn(),
      close: jest.fn()
    } as any;

    // Test configuration
    testConfig = {
      rules: [
        {
          id: 'urgent-keywords',
          name: 'Urgent Keywords',
          type: 'keyword',
          priority: 100,
          weight: 10,
          keywords: ['urgent', 'critical', 'asap']
        },
        {
          id: 'important-domains',
          name: 'Important Domains',
          type: 'domain',
          priority: 90,
          weight: 8,
          domains: ['company.com', 'client.com']
        },
        {
          id: 'important-labels',
          name: 'Important Labels',
          type: 'label',
          priority: 85,
          weight: 7,
          labels: ['important']
        },
        {
          id: 'no-reply-rule',
          name: 'No Reply Rule',
          type: 'noReply',
          priority: 20,
          weight: -5
        },
        {
          id: 'large-attachment-rule',
          name: 'Large Attachment Rule',
          type: 'largeAttachment',
          priority: 15,
          weight: -3,
          minSize: 1048576 // 1MB
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

    // Test email context
    const testEmail: EmailIndex = {
      id: 'test-email-1',
      threadId: 'thread-1',
      category: null,
      subject: 'Test Subject',
      sender: 'test@example.com',
      recipients: ['user@example.com'],
      date: new Date('2024-01-15'),
      year: 2024,
      size: 50000,
      hasAttachments: false,
      labels: ['INBOX'],
      snippet: 'Test email snippet',
      archived: false
    };

    testContext = {
      email: testEmail,
      user_id: 'test-user',
      subject: testEmail.subject || 'Test Subject',
      sender: testEmail.sender || 'test@example.com',
      snippet: testEmail.snippet || 'Test email snippet',
      labels: testEmail.labels || ['INBOX'],
      date: testEmail.date || new Date('2024-01-15'),
      size: testEmail.size || 50000,
      hasAttachments: testEmail.hasAttachments || false
    };

    analyzer = new ImportanceAnalyzer(testConfig, mockCacheManager, mockDatabaseManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with provided configuration', () => {
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
      expect(analyzer.getApplicableRules(testContext)).toHaveLength(5);
    });

    it('should configure analyzer with new config', () => {
      const newConfig: ImportanceAnalyzerConfig = {
        ...testConfig,
        rules: [testConfig.rules[0]] // Only one rule
      };

      analyzer.configure(newConfig);
      expect(analyzer.getApplicableRules(testContext)).toHaveLength(1);
    });

    it('should throw error for invalid config type', () => {
      expect(() => {
        analyzer.configure({ invalid: 'config' } as any);
      }).toThrow('ImportanceAnalyzer requires ImportanceAnalyzerConfig');
    });
  });

  describe('Rule Evaluation - Keyword Rules', () => {
    it('should match urgent keywords in subject', async () => {
      const context = {
        ...testContext,
        subject: 'URGENT: Please review this document',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.level).toBe('high');
      expect(result.score).toBeGreaterThanOrEqual(10);
      expect(result.matchedRules).toContain('Urgent Keywords');
    });

    it('should match urgent keywords in snippet', async () => {
      const context = {
        ...testContext,
        snippet: 'This is critical and needs immediate attention',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.level).toBe('high');
      expect(result.matchedRules).toContain('Urgent Keywords');
    });

    it('should be case insensitive for keyword matching', async () => {
      const context = {
        ...testContext,
        subject: 'CRITICAL update required',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).toContain('Urgent Keywords');
    });

    it('should not match partial keywords', async () => {
      const context = {
        ...testContext,
        subject: 'Urgently needed documentation',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).not.toContain('Urgent Keywords');
    });
  });

  describe('Rule Evaluation - Domain Rules', () => {
    it('should match important domains', async () => {
      const context = {
        ...testContext,
        sender: 'boss@company.com',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.score).toBeGreaterThan(0);
      expect(result.matchedRules).toContain('Important Domains');
    });

    it('should be case insensitive for domain matching', async () => {
      const context = {
        ...testContext,
        sender: 'user@CLIENT.COM',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).toContain('Important Domains');
    });

    it('should not match unrelated domains', async () => {
      const context = {
        ...testContext,
        sender: 'spam@random.com',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).not.toContain('Important Domains');
    });
  });

  describe('Rule Evaluation - Label Rules', () => {
    it('should match important labels', async () => {
      const context = {
        ...testContext,
        labels: ['INBOX', 'important'],
        user_id: 'test-user'
      };
      // Also update the email object to have the same labels
      context.email.labels = ['INBOX', 'important'];

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).toContain('Important Labels');
    });

    it('should be case insensitive for label matching', async () => {
      const context = {
        ...testContext,
        labels: ['INBOX', 'IMPORTANT'],
        user_id: 'test-user'
      };
      // Also update the email object to have the same labels
      context.email.labels = ['INBOX', 'IMPORTANT'];

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).toContain('Important Labels');
    });

    it('should handle empty labels array', async () => {
      const context = {
        ...testContext,
        labels: [],
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).not.toContain('Important Labels');
    });
  });

  describe('Rule Evaluation - No Reply Rules', () => {
    it('should detect no-reply senders', async () => {
      const context = {
        ...testContext,
        sender: 'noreply@example.com',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).toContain('No Reply Rule');
      expect(result.score).toBeLessThan(0); // Negative weight
    });

    it('should detect no-reply with hyphen', async () => {
      const context = {
        ...testContext,
        sender: 'no-reply@example.com',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).toContain('No Reply Rule');
    });

    it('should not match regular senders', async () => {
      const context = {
        ...testContext,
        sender: 'user@example.com',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).not.toContain('No Reply Rule');
    });
  });

  describe('Rule Evaluation - Large Attachment Rules', () => {
    it('should detect large attachments', async () => {
      const context = {
        ...testContext,
        size: 2000000, // 2MB
        hasAttachments: true,
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).toContain('Large Attachment Rule');
      expect(result.score).toBeLessThan(0); // Negative weight
    });

    it('should not match small emails with attachments', async () => {
      const context = {
        ...testContext,
        size: 50000, // 50KB
        hasAttachments: true,
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).not.toContain('Large Attachment Rule');
    });

    it('should not match large emails without attachments', async () => {
      const context = {
        ...testContext,
        size: 2000000, // 2MB
        hasAttachments: false,
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.matchedRules).not.toContain('Large Attachment Rule');
    });
  });

  describe('Scoring and Level Determination', () => {
    it('should categorize as high priority for high scores', async () => {
      const context = {
        ...testContext,
        subject: 'URGENT: Critical issue',
        sender: 'boss@company.com',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.level).toBe('high');
      expect(result.score).toBeGreaterThanOrEqual(testConfig.scoring.highThreshold);
    });

    it('should categorize as low priority for low scores', async () => {
      const context = {
        ...testContext,
        sender: 'noreply@spam.com',
        size: 2000000,
        hasAttachments: true,
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.level).toBe('low');
      expect(result.score).toBeLessThanOrEqual(testConfig.scoring.lowThreshold);
    });

    it('should categorize as medium priority for middle scores', async () => {
      const context = {
        ...testContext,
        subject: 'Regular email',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.level).toBe('medium');
      expect(result.score).toBeGreaterThan(testConfig.scoring.lowThreshold);
      expect(result.score).toBeLessThan(testConfig.scoring.highThreshold);
    });
  });

  describe('Confidence Calculation', () => {
    it('should calculate confidence based on matched rules', async () => {
      const context = {
        ...testContext,
        subject: 'URGENT: Critical issue',
        sender: 'boss@company.com',
        labels: ['important'],
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should have zero confidence when no rules match', async () => {
      const context = {
        ...testContext,
        subject: 'Regular email',
        sender: 'user@random.com',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result.confidence).toBe(0);
    });
  });

  describe('Caching Behavior', () => {
    beforeEach(() => {
      mockCacheManager.get.mockReturnValue(null);
      mockCacheManager.set.mockReturnValue(undefined);
    });

    it('should check cache when enabled', async () => {
      await analyzer.analyzeImportance(testContext);

      expect(mockCacheManager.get).toHaveBeenCalled();
    });

    it('should return cached result when available', async () => {
      const cachedResult: ImportanceResult = {
        score: 5,
        level: 'medium',
        matchedRules: ['Cached Rule'],
        confidence: 0.8
      };

      mockCacheManager.get.mockReturnValue(cachedResult);

      const result = await analyzer.analyzeImportance(testContext);

      expect(result).toEqual(cachedResult);
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('should cache new results', async () => {
      mockCacheManager.get.mockReturnValue(null);

      await analyzer.analyzeImportance(testContext);

      expect(mockCacheManager.set).toHaveBeenCalled();
    });

    it('should not use cache when disabled', async () => {
      const noCacheConfig = {
        ...testConfig,
        caching: { enabled: false, keyStrategy: 'partial' as const }
      };

      const noCacheAnalyzer = new ImportanceAnalyzer(noCacheConfig, mockCacheManager);

      await noCacheAnalyzer.analyzeImportance(testContext);

      expect(mockCacheManager.get).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
  });

  describe('Rule Registration', () => {
    it('should register new rules dynamically', () => {
      const newRule: ImportanceRule = {
        id: 'dynamic-rule',
        name: 'Dynamic Rule',
        priority: 50,
        condition: { type: 'keyword', keywords: ['dynamic'] },
        weight: 5,
        evaluate: (context: EmailAnalysisContext): RuleResult => ({
          matched: context.subject.includes('dynamic'),
          score: 5,
          reason: 'Dynamic rule matched'
        })
      };

      analyzer.registerRule(newRule);

      const rules = analyzer.getApplicableRules(testContext);
      expect(rules.some(rule => rule.id === 'dynamic-rule')).toBe(true);
    });

    it('should sort rules by priority', () => {
      const rules = analyzer.getApplicableRules(testContext);
      
      for (let i = 0; i < rules.length - 1; i++) {
        expect(rules[i].priority).toBeGreaterThanOrEqual(rules[i + 1].priority);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle rule evaluation errors gracefully', async () => {
      const faultyRule: ImportanceRule = {
        id: 'faulty-rule',
        name: 'Faulty Rule',
        priority: 50,
        condition: { type: 'keyword' },
        weight: 5,
        evaluate: (): RuleResult => {
          throw new Error('Rule evaluation failed');
        }
      };

      analyzer.registerRule(faultyRule);

      const result = await analyzer.analyzeImportance(testContext);

      // Should still return a result despite the error
      expect(result).toBeDefined();
      expect(result.score).toBeDefined();
      expect(result.level).toBeDefined();
    });

    it('should handle cache errors gracefully', async () => {
      mockCacheManager.get.mockImplementation(() => {
        throw new Error('Cache error');
      });

      const result = await analyzer.analyzeImportance(testContext);

      expect(result).toBeDefined();
    });

    it('should throw error for invalid context type', async () => {
      await expect(analyzer.analyze({ invalid: 'context' } as any))
        .rejects.toThrow('ImportanceAnalyzer requires EmailAnalysisContext');
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent cache keys for same context', async () => {
      const context1 = { ...testContext };
      const context2 = { ...testContext };

      await analyzer.analyzeImportance(context1);
      await analyzer.analyzeImportance(context2);

      expect(mockCacheManager.get).toHaveBeenCalledTimes(2);
      const firstCall = mockCacheManager.get.mock.calls[0][0];
      const secondCall = mockCacheManager.get.mock.calls[1][0];
      expect(firstCall).toBe(secondCall);
    });

    it('should generate different cache keys for different contexts', async () => {
      const context1 = { ...testContext, subject: 'Subject 1' };
      const context2 = { ...testContext, subject: 'Subject 2' };

      await analyzer.analyzeImportance(context1);
      await analyzer.analyzeImportance(context2);

      const firstCall = mockCacheManager.get.mock.calls[0][0];
      const secondCall = mockCacheManager.get.mock.calls[1][0];
      expect(firstCall).not.toBe(secondCall);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty subject and snippet', async () => {
      const context = {
        ...testContext,
        subject: '',
        snippet: '',
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result).toBeDefined();
      expect(result.level).toBe('medium'); // Should default to medium
    });

    it('should handle undefined labels', async () => {
      const context = {
        ...testContext,
        labels: undefined as any,
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result).toBeDefined();
    });

    it('should handle zero size emails', async () => {
      const context = {
        ...testContext,
        size: 0,
        user_id: 'test-user'
      };

      const result = await analyzer.analyzeImportance(context);

      expect(result).toBeDefined();
      expect(result.matchedRules).not.toContain('Large Attachment Rule');
    });
  });
});