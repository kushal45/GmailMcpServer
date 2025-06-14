import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { LabelClassifier } from '../../../../src/categorization/analyzers/LabelClassifier.js';
import { 
  LabelClassifierConfig, 
  LabelClassification,
  GmailCategory,
  SpamScore
} from '../../../../src/categorization/interfaces/ILabelClassifier.js';
import { EmailAnalysisContext } from '../../../../src/categorization/interfaces/IImportanceAnalyzer.js';
import { CacheManager } from '../../../../src/cache/CacheManager.js';
import { EmailIndex } from '../../../../src/types/index.js';
import { Labels } from '../../../../src/categorization/types.js';

describe('LabelClassifier Unit Tests', () => {
  let classifier: LabelClassifier;
  let mockCacheManager: jest.Mocked<CacheManager>;
  let testConfig: LabelClassifierConfig;
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

    // Test configuration
    testConfig = {
      labelMappings: {
        gmailToCategory: {
          'important': 'important',
          'starred': 'important',
          'spam': 'spam',
          'junk': 'spam',
          'promotions': 'promotions',
          'promotional': 'promotions',
          'social': 'social',
          'updates': 'updates',
          'forums': 'forums',
          'primary': 'primary'
        },
        spamLabels: [
          Labels.SPAM,
          'junk',
          'phishing',
          'malware',
          'suspicious'
        ],
        promotionalLabels: [
          Labels.PROMOTIONAL,
          Labels.CATEGORY_PROMOTIONS,
          Labels.SALE,
          Labels.OFFER,
          Labels.DISCOUNT,
          Labels.DEAL,
          'marketing',
          'advertisement'
        ],
        socialLabels: [
          Labels.CATEGORY_SOCIAL,
          'facebook',
          'twitter',
          'linkedin',
          'instagram',
          'social'
        ]
      },
      scoring: {
        spamThreshold: 0.7,
        promotionalThreshold: 0.5,
        socialThreshold: 0.4
      },
      caching: {
        enabled: true,
        ttl: 1800 // 30 minutes
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
      subject: testEmail.subject || 'Test Subject',
      sender: testEmail.sender || 'test@example.com',
      snippet: testEmail.snippet || 'Test email snippet',
      labels: testEmail.labels || ['INBOX'],
      date: testEmail.date || new Date('2024-01-15'),
      size: testEmail.size || 50000,
      hasAttachments: testEmail.hasAttachments || false
    };

    classifier = new LabelClassifier(testConfig, mockCacheManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with provided configuration', () => {
      expect(classifier).toBeInstanceOf(LabelClassifier);
    });

    it('should configure classifier with new config', () => {
      const newConfig: LabelClassifierConfig = {
        ...testConfig,
        scoring: {
          spamThreshold: 0.8,
          promotionalThreshold: 0.6,
          socialThreshold: 0.5
        }
      };

      classifier.configure(newConfig);
      
      // Configuration should be updated (we can't directly test private config,
      // but we can test behavior that depends on it)
      expect(() => classifier.configure(newConfig)).not.toThrow();
    });

    it('should throw error for invalid config type', () => {
      expect(() => {
        classifier.configure({ invalid: 'config' } as any);
      }).toThrow('LabelClassifier requires LabelClassifierConfig');
    });
  });

  describe('Gmail Category Classification', () => {
    it('should classify important labels correctly', () => {
      const labels = ['INBOX', 'IMPORTANT'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('important');
    });

    it('should classify starred labels correctly', () => {
      const labels = ['INBOX', 'STARRED'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('important');
    });

    it('should classify spam labels correctly', () => {
      const labels = ['SPAM'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('spam');
    });

    it('should classify promotional labels correctly', () => {
      const labels = ['INBOX', 'PROMOTIONS'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('promotions');
    });

    it('should classify social labels correctly', () => {
      const labels = ['INBOX', 'SOCIAL'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('social');
    });

    it('should classify updates labels correctly', () => {
      const labels = ['INBOX', 'UPDATES'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('updates');
    });

    it('should classify forums labels correctly', () => {
      const labels = ['INBOX', 'FORUMS'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('forums');
    });

    it('should default to primary for unknown labels', () => {
      const labels = ['INBOX', 'UNKNOWN_LABEL'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('primary');
    });

    it('should be case insensitive', () => {
      const labels = ['inbox', 'important'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('important');
    });

    it('should handle empty labels array', () => {
      const labels: string[] = [];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('primary');
    });

    it('should prioritize explicit mappings over common checks', () => {
      const labels = ['INBOX', 'IMPORTANT', 'SOCIAL'];
      const category = classifier.categorizeByGmailLabels(labels);
      expect(category).toBe('important'); // Should match first found
    });
  });

  describe('Spam Detection', () => {
    it('should detect spam labels', () => {
      const labels = ['SPAM'];
      const spamScore = classifier.detectSpamIndicators(labels);
      
      expect(spamScore.score).toBeGreaterThan(0);
      expect(spamScore.indicators).toContain('SPAM');
      expect(spamScore.confidence).toBeGreaterThan(0);
    });

    it('should detect junk labels', () => {
      const labels = ['JUNK'];
      const spamScore = classifier.detectSpamIndicators(labels);
      
      expect(spamScore.score).toBeGreaterThan(0);
      expect(spamScore.indicators).toContain('JUNK');
    });

    it('should detect phishing labels', () => {
      const labels = ['PHISHING'];
      const spamScore = classifier.detectSpamIndicators(labels);
      
      expect(spamScore.score).toBeGreaterThan(0);
      expect(spamScore.indicators).toContain('phishing');
    });

    it('should give higher scores for explicit spam labels', () => {
      const explicitSpam = classifier.detectSpamIndicators(['SPAM']);
      const configuredSpam = classifier.detectSpamIndicators(['suspicious']);
      
      expect(explicitSpam.score).toBeGreaterThan(configuredSpam.score);
    });

    it('should accumulate scores for multiple spam indicators', () => {
      const singleSpam = classifier.detectSpamIndicators(['SPAM']);
      const multipleSpam = classifier.detectSpamIndicators(['SPAM', 'JUNK', 'PHISHING']);
      
      expect(multipleSpam.score).toBeGreaterThan(singleSpam.score);
    });

    it('should cap spam score at 1.0', () => {
      const manySpamLabels = ['SPAM', 'JUNK', 'PHISHING', 'MALWARE', 'SUSPICIOUS'];
      const spamScore = classifier.detectSpamIndicators(manySpamLabels);
      
      expect(spamScore.score).toBeLessThanOrEqual(1.0);
    });

    it('should return zero score for non-spam labels', () => {
      const labels = ['INBOX', 'IMPORTANT'];
      const spamScore = classifier.detectSpamIndicators(labels);
      
      expect(spamScore.score).toBe(0);
      expect(spamScore.indicators).toHaveLength(0);
      expect(spamScore.confidence).toBe(0);
    });

    it('should be case insensitive for spam detection', () => {
      const labels = ['spam', 'JUNK'];
      const spamScore = classifier.detectSpamIndicators(labels);
      
      expect(spamScore.score).toBeGreaterThan(0);
      expect(spamScore.indicators.length).toBeGreaterThan(0);
    });
  });

  describe('Complete Label Classification', () => {
    it('should perform complete classification for important email', async () => {
      const labels = ['INBOX', 'IMPORTANT'];
      const result = await classifier.classifyLabels(labels);

      expect(result.category).toBe('important');
      expect(result.spamScore).toBe(0);
      expect(result.promotionalScore).toBe(0);
      expect(result.socialScore).toBe(0);
      expect(result.indicators.spam).toHaveLength(0);
      expect(result.indicators.promotional).toHaveLength(0);
      expect(result.indicators.social).toHaveLength(0);
    });

    it('should perform complete classification for promotional email', async () => {
      const labels = ['INBOX', Labels.PROMOTIONAL, Labels.SALE];
      const result = await classifier.classifyLabels(labels);

      expect(result.category).toBe('promotions');
      expect(result.promotionalScore).toBeGreaterThan(0);
      expect(result.indicators.promotional.length).toBeGreaterThan(0);
    });

    it('should perform complete classification for social email', async () => {
      const labels = ['INBOX', Labels.CATEGORY_SOCIAL, 'facebook'];
      const result = await classifier.classifyLabels(labels);

      expect(result.category).toBe('social');
      expect(result.socialScore).toBeGreaterThan(0);
      expect(result.indicators.social.length).toBeGreaterThan(0);
    });

    it('should perform complete classification for spam email', async () => {
      const labels = ['SPAM', 'JUNK'];
      const result = await classifier.classifyLabels(labels);

      expect(result.category).toBe('spam');
      expect(result.spamScore).toBeGreaterThan(0);
      expect(result.indicators.spam.length).toBeGreaterThan(0);
    });

    it('should handle mixed label types', async () => {
      const labels = ['INBOX', Labels.PROMOTIONAL, 'facebook', 'suspicious'];
      const result = await classifier.classifyLabels(labels);

      expect(result.promotionalScore).toBeGreaterThan(0);
      expect(result.socialScore).toBeGreaterThan(0);
      expect(result.spamScore).toBeGreaterThan(0);
      expect(result.indicators.promotional.length).toBeGreaterThan(0);
      expect(result.indicators.social.length).toBeGreaterThan(0);
      expect(result.indicators.spam.length).toBeGreaterThan(0);
    });
  });

  describe('Promotional Score Calculation', () => {
    it('should calculate promotional score for promotional labels', async () => {
      const labels = [Labels.PROMOTIONAL];
      const result = await classifier.classifyLabels(labels);

      expect(result.promotionalScore).toBeGreaterThan(0);
    });

    it('should calculate higher scores for explicit promotional labels', async () => {
      const explicitPromo = await classifier.classifyLabels([Labels.CATEGORY_PROMOTIONS]);
      const configuredPromo = await classifier.classifyLabels(['marketing']);

      expect(explicitPromo.promotionalScore).toBeGreaterThan(configuredPromo.promotionalScore);
    });

    it('should accumulate promotional scores', async () => {
      const singlePromo = await classifier.classifyLabels([Labels.SALE]);
      const multiplePromo = await classifier.classifyLabels([Labels.SALE, Labels.OFFER, Labels.DISCOUNT]);

      expect(multiplePromo.promotionalScore).toBeGreaterThan(singlePromo.promotionalScore);
    });

    it('should cap promotional score at 1.0', async () => {
      const manyPromoLabels = [
        Labels.PROMOTIONAL, Labels.CATEGORY_PROMOTIONS, Labels.SALE, 
        Labels.OFFER, Labels.DISCOUNT, Labels.DEAL, 'marketing', 'advertisement'
      ];
      const result = await classifier.classifyLabels(manyPromoLabels);

      expect(result.promotionalScore).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Social Score Calculation', () => {
    it('should calculate social score for social labels', async () => {
      const labels = [Labels.CATEGORY_SOCIAL];
      const result = await classifier.classifyLabels(labels);

      expect(result.socialScore).toBeGreaterThan(0);
    });

    it('should calculate higher scores for explicit social labels', async () => {
      const explicitSocial = await classifier.classifyLabels([Labels.CATEGORY_SOCIAL]);
      const configuredSocial = await classifier.classifyLabels(['notification']);

      expect(explicitSocial.socialScore).toBeGreaterThan(configuredSocial.socialScore);
    });

    it('should accumulate social scores', async () => {
      const singleSocial = await classifier.classifyLabels(['facebook']);
      const multipleSocial = await classifier.classifyLabels(['facebook', 'twitter', 'linkedin']);

      expect(multipleSocial.socialScore).toBeGreaterThan(singleSocial.socialScore);
    });

    it('should cap social score at 1.0', async () => {
      const manySocialLabels = [
        Labels.CATEGORY_SOCIAL, 'facebook', 'twitter', 'linkedin', 
        'instagram', 'social'
      ];
      const result = await classifier.classifyLabels(manySocialLabels);

      expect(result.socialScore).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Caching Behavior', () => {
    beforeEach(() => {
      mockCacheManager.get.mockReturnValue(null);
      mockCacheManager.set.mockReturnValue(undefined);
    });

    it('should check cache when enabled', async () => {
      const labels = ['INBOX', 'IMPORTANT'];
      await classifier.classifyLabels(labels);

      expect(mockCacheManager.get).toHaveBeenCalled();
    });

    it('should return cached result when available', async () => {
      const cachedResult: LabelClassification = {
        category: 'important',
        spamScore: 0,
        promotionalScore: 0,
        socialScore: 0,
        indicators: {
          spam: [],
          promotional: [],
          social: []
        }
      };

      mockCacheManager.get.mockReturnValue(cachedResult);

      const labels = ['INBOX', 'IMPORTANT'];
      const result = await classifier.classifyLabels(labels);

      expect(result).toEqual(cachedResult);
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('should cache new results', async () => {
      mockCacheManager.get.mockReturnValue(null);

      const labels = ['INBOX', 'IMPORTANT'];
      await classifier.classifyLabels(labels);

      expect(mockCacheManager.set).toHaveBeenCalled();
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        testConfig.caching.ttl
      );
    });

    it('should not use cache when disabled', async () => {
      const noCacheConfig = {
        ...testConfig,
        caching: { enabled: false, ttl: 1800 }
      };

      const noCacheClassifier = new LabelClassifier(noCacheConfig, mockCacheManager);

      const labels = ['INBOX', 'IMPORTANT'];
      await noCacheClassifier.classifyLabels(labels);

      expect(mockCacheManager.get).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent cache keys for same labels', async () => {
      const labels1 = ['INBOX', 'IMPORTANT'];
      const labels2 = ['INBOX', 'IMPORTANT'];

      await classifier.classifyLabels(labels1);
      await classifier.classifyLabels(labels2);

      expect(mockCacheManager.get).toHaveBeenCalledTimes(2);
      const firstCall = mockCacheManager.get.mock.calls[0][0];
      const secondCall = mockCacheManager.get.mock.calls[1][0];
      expect(firstCall).toBe(secondCall);
    });

    it('should generate different cache keys for different labels', async () => {
      const labels1 = ['INBOX', 'IMPORTANT'];
      const labels2 = ['INBOX', 'SPAM'];

      await classifier.classifyLabels(labels1);
      await classifier.classifyLabels(labels2);

      const firstCall = mockCacheManager.get.mock.calls[0][0];
      const secondCall = mockCacheManager.get.mock.calls[1][0];
      expect(firstCall).not.toBe(secondCall);
    });

    it('should generate same cache key regardless of label order', async () => {
      const labels1 = ['INBOX', 'IMPORTANT'];
      const labels2 = ['IMPORTANT', 'INBOX'];

      await classifier.classifyLabels(labels1);
      await classifier.classifyLabels(labels2);

      const firstCall = mockCacheManager.get.mock.calls[0][0];
      const secondCall = mockCacheManager.get.mock.calls[1][0];
      expect(firstCall).toBe(secondCall);
    });
  });

  describe('Error Handling', () => {
    it('should handle cache errors gracefully', async () => {
      mockCacheManager.get.mockImplementation(() => {
        throw new Error('Cache error');
      });

      const labels = ['INBOX', 'IMPORTANT'];
      const result = await classifier.classifyLabels(labels);

      expect(result).toBeDefined();
    });

    it('should handle cache storage errors gracefully', async () => {
      mockCacheManager.get.mockReturnValue(null);
      mockCacheManager.set.mockImplementation(() => {
        throw new Error('Cache storage error');
      });

      const labels = ['INBOX', 'IMPORTANT'];
      const result = await classifier.classifyLabels(labels);

      expect(result).toBeDefined();
    });

    it('should throw error for invalid context type', async () => {
      await expect(classifier.analyze({ invalid: 'context' } as any))
        .rejects.toThrow('LabelClassifier requires EmailAnalysisContext');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty labels array', async () => {
      const labels: string[] = [];
      const result = await classifier.classifyLabels(labels);

      expect(result.category).toBe('primary');
      expect(result.spamScore).toBe(0);
      expect(result.promotionalScore).toBe(0);
      expect(result.socialScore).toBe(0);
      expect(result.indicators.spam).toHaveLength(0);
      expect(result.indicators.promotional).toHaveLength(0);
      expect(result.indicators.social).toHaveLength(0);
    });

    it('should handle labels with special characters', async () => {
      const labels = ['INBOX', 'LABEL-WITH-DASHES', 'label_with_underscores'];
      const result = await classifier.classifyLabels(labels);

      expect(result).toBeDefined();
      expect(result.category).toBe('primary');
    });

    it('should handle very long label names', async () => {
      const longLabel = 'a'.repeat(1000);
      const labels = ['INBOX', longLabel];
      const result = await classifier.classifyLabels(labels);

      expect(result).toBeDefined();
    });

    it('should handle duplicate labels', async () => {
      const labels = ['INBOX', 'IMPORTANT', 'IMPORTANT', 'INBOX'];
      const result = await classifier.classifyLabels(labels);

      expect(result.category).toBe('important');
      // Should not double-count duplicates
    });
  });

  describe('Base Analyzer Interface', () => {
    it('should implement base analyze method', async () => {
      const result = await classifier.analyze(testContext);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('category');
      expect(result).toHaveProperty('spamScore');
      expect(result).toHaveProperty('promotionalScore');
      expect(result).toHaveProperty('socialScore');
      expect(result).toHaveProperty('indicators');
    });

    it('should handle context with labels property', async () => {
      const contextWithLabels = {
        ...testContext,
        labels: ['INBOX', 'IMPORTANT']
      };

      const result = await classifier.analyze(contextWithLabels);

      expect(result).toBeDefined();
      expect((result as LabelClassification).category).toBe('important');
    });
  });
});