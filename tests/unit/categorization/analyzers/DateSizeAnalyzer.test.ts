import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { DateSizeAnalyzer } from '../../../../src/categorization/analyzers/DateSizeAnalyzer.js';
import { 
  DateSizeAnalyzerConfig, 
  DateSizeResult,
  AgeCategory,
  SizeCategory
} from '../../../../src/categorization/interfaces/IDateSizeAnalyzer.js';
import { EmailAnalysisContext } from '../../../../src/categorization/interfaces/IImportanceAnalyzer.js';
import { CacheManager } from '../../../../src/cache/CacheManager.js';
import { EmailIndex } from '../../../../src/types/index.js';

describe('DateSizeAnalyzer Unit Tests', () => {
  let analyzer: DateSizeAnalyzer;
  let mockCacheManager: jest.Mocked<CacheManager>;
  let testConfig: DateSizeAnalyzerConfig;
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
      sizeThresholds: {
        small: 102400,    // 100KB
        medium: 1048576,  // 1MB
        large: 10485760   // 10MB
      },
      ageCategories: {
        recent: 7,    // 7 days
        moderate: 30, // 30 days
        old: 90       // 90 days
      },
      scoring: {
        recencyWeight: 0.7,
        sizeWeight: 0.3
      },
      caching: {
        enabled: true,
        ttl: 3600 // 1 hour
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

    analyzer = new DateSizeAnalyzer(testConfig, mockCacheManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with provided configuration', () => {
      expect(analyzer).toBeInstanceOf(DateSizeAnalyzer);
    });

    it('should configure analyzer with new config', () => {
      const newConfig: DateSizeAnalyzerConfig = {
        ...testConfig,
        sizeThresholds: {
          small: 50000,
          medium: 500000,
          large: 5000000
        }
      };

      analyzer.configure(newConfig);
      
      // Test that new thresholds are applied
      expect(analyzer.categorizeBySize(100000)).toBe('medium');
    });

    it('should throw error for invalid config type', () => {
      expect(() => {
        analyzer.configure({ invalid: 'config' } as any);
      }).toThrow('DateSizeAnalyzer requires DateSizeAnalyzerConfig');
    });
  });

  describe('Age Categorization', () => {
    it('should categorize recent emails correctly', () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3); // 3 days ago

      const category = analyzer.categorizeByAge(recentDate);
      expect(category).toBe('recent');
    });

    it('should categorize moderate age emails correctly', () => {
      const moderateDate = new Date();
      moderateDate.setDate(moderateDate.getDate() - 15); // 15 days ago

      const category = analyzer.categorizeByAge(moderateDate);
      expect(category).toBe('moderate');
    });

    it('should categorize old emails correctly', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60); // 60 days ago

      const category = analyzer.categorizeByAge(oldDate);
      expect(category).toBe('old');
    });

    it('should handle boundary cases for recent category', () => {
      const boundaryDate = new Date();
      boundaryDate.setDate(boundaryDate.getDate() - 7); // Exactly 7 days ago

      const category = analyzer.categorizeByAge(boundaryDate);
      expect(category).toBe('recent');
    });

    it('should handle boundary cases for moderate category', () => {
      const boundaryDate = new Date();
      boundaryDate.setDate(boundaryDate.getDate() - 30); // Exactly 30 days ago

      const category = analyzer.categorizeByAge(boundaryDate);
      expect(category).toBe('moderate');
    });

    it('should handle very old emails', () => {
      const veryOldDate = new Date();
      veryOldDate.setFullYear(veryOldDate.getFullYear() - 1); // 1 year ago

      const category = analyzer.categorizeByAge(veryOldDate);
      expect(category).toBe('old');
    });
  });

  describe('Size Categorization', () => {
    it('should categorize small emails correctly', () => {
      const category = analyzer.categorizeBySize(50000); // 50KB
      expect(category).toBe('small');
    });

    it('should categorize medium emails correctly', () => {
      const category = analyzer.categorizeBySize(500000); // 500KB
      expect(category).toBe('medium');
    });

    it('should categorize large emails correctly', () => {
      const category = analyzer.categorizeBySize(5000000); // 5MB
      expect(category).toBe('large');
    });

    it('should categorize very large emails correctly', () => {
      const category = analyzer.categorizeBySize(15000000); // 15MB
      expect(category).toBe('large');
    });

    it('should handle boundary cases for small category', () => {
      const category = analyzer.categorizeBySize(102400); // Exactly 100KB
      expect(category).toBe('small');
    });

    it('should handle boundary cases for medium category', () => {
      const category = analyzer.categorizeBySize(1048576); // Exactly 1MB
      expect(category).toBe('medium');
    });

    it('should handle zero size emails', () => {
      const category = analyzer.categorizeBySize(0);
      expect(category).toBe('small');
    });

    it('should handle negative size (edge case)', () => {
      const category = analyzer.categorizeBySize(-1000);
      expect(category).toBe('small');
    });
  });

  describe('Recency Score Calculation', () => {
    it('should give high scores to very recent emails', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 1); // 1 day ago

      const context = {
        ...testContext,
        date: recentDate
      };

      const result = await analyzer.analyzeDateSize(context);
      expect(result.recencyScore).toBeGreaterThan(0.9);
    });

    it('should give medium scores to moderately old emails', async () => {
      const moderateDate = new Date();
      moderateDate.setDate(moderateDate.getDate() - 15); // 15 days ago

      const context = {
        ...testContext,
        date: moderateDate
      };

      const result = await analyzer.analyzeDateSize(context);
      expect(result.recencyScore).toBeGreaterThan(0.2);
      expect(result.recencyScore).toBeLessThan(0.8);
    });

    it('should give low scores to old emails', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60); // 60 days ago

      const context = {
        ...testContext,
        date: oldDate
      };

      const result = await analyzer.analyzeDateSize(context);
      expect(result.recencyScore).toBeLessThan(0.3);
    });

    it('should give very low scores to very old emails', async () => {
      const veryOldDate = new Date();
      veryOldDate.setFullYear(veryOldDate.getFullYear() - 1); // 1 year ago

      const context = {
        ...testContext,
        date: veryOldDate
      };

      const result = await analyzer.analyzeDateSize(context);
      expect(result.recencyScore).toBeLessThan(0.1);
    });
  });

  describe('Size Penalty Calculation', () => {
    it('should have no penalty for small emails', async () => {
      const context = {
        ...testContext,
        size: 50000 // 50KB
      };

      const result = await analyzer.analyzeDateSize(context);
      expect(result.sizePenalty).toBe(0);
    });

    it('should have small penalty for medium emails', async () => {
      const context = {
        ...testContext,
        size: 2000000 // 2MB
      };

      const result = await analyzer.analyzeDateSize(context);
      expect(result.sizePenalty).toBeGreaterThan(0);
      expect(result.sizePenalty).toBeLessThan(0.5);
    });

    it('should have higher penalty for large emails', async () => {
      const context = {
        ...testContext,
        size: 15000000 // 15MB
      };

      const result = await analyzer.analyzeDateSize(context);
      expect(result.sizePenalty).toBeGreaterThan(0.5);
    });

    it('should cap penalty at maximum value', async () => {
      const context = {
        ...testContext,
        size: 100000000 // 100MB
      };

      const result = await analyzer.analyzeDateSize(context);
      expect(result.sizePenalty).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Complete Analysis', () => {
    it('should perform complete date/size analysis', async () => {
      const result = await analyzer.analyzeDateSize(testContext);

      expect(result).toHaveProperty('ageCategory');
      expect(result).toHaveProperty('sizeCategory');
      expect(result).toHaveProperty('recencyScore');
      expect(result).toHaveProperty('sizePenalty');

      expect(['recent', 'moderate', 'old']).toContain(result.ageCategory);
      expect(['small', 'medium', 'large']).toContain(result.sizeCategory);
      expect(result.recencyScore).toBeGreaterThanOrEqual(0);
      expect(result.recencyScore).toBeLessThanOrEqual(1);
      expect(result.sizePenalty).toBeGreaterThanOrEqual(0);
      expect(result.sizePenalty).toBeLessThanOrEqual(1);
    });

    it('should handle recent small email', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 2);

      const context = {
        ...testContext,
        date: recentDate,
        size: 30000 // 30KB
      };

      const result = await analyzer.analyzeDateSize(context);

      expect(result.ageCategory).toBe('recent');
      expect(result.sizeCategory).toBe('small');
      expect(result.recencyScore).toBeGreaterThan(0.8);
      expect(result.sizePenalty).toBe(0);
    });

    it('should handle old large email', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);

      const context = {
        ...testContext,
        date: oldDate,
        size: 20000000 // 20MB
      };

      const result = await analyzer.analyzeDateSize(context);

      expect(result.ageCategory).toBe('old');
      expect(result.sizeCategory).toBe('large');
      expect(result.recencyScore).toBeLessThan(0.2);
      expect(result.sizePenalty).toBeGreaterThan(0.8);
    });
  });

  describe('Caching Behavior', () => {
    beforeEach(() => {
      // Populate the cache with a mock result
      const cachedResult: DateSizeResult = {
        ageCategory: 'recent',
        sizeCategory: 'small',
        recencyScore: 0.9,
        sizePenalty: 0.1
      };
      mockCacheManager.get.mockReturnValue(cachedResult);
      mockCacheManager.set.mockReturnValue(undefined);
    });

    it('should check cache when enabled', async () => {
      await analyzer.analyzeDateSize(testContext);

      expect(mockCacheManager.get).toHaveBeenCalled();
    });

    it('should return cached result when available', async () => {
      // Populate the cache with a mock result
      const cachedResult: DateSizeResult = {
        ageCategory: 'recent',
        sizeCategory: 'small',
        recencyScore: 0.9,
        sizePenalty: 0.1
      };
      mockCacheManager.get.mockReturnValue(cachedResult);

      const result = await analyzer.analyzeDateSize(testContext);

      expect(result).toEqual(cachedResult);
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });

    it('should cache new results', async () => {
      mockCacheManager.get.mockReturnValue(null);

      await analyzer.analyzeDateSize(testContext);

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
        caching: { enabled: false, ttl: 3600 }
      };

      const noCacheAnalyzer = new DateSizeAnalyzer(noCacheConfig, mockCacheManager);

      await noCacheAnalyzer.analyzeDateSize(testContext);

      expect(mockCacheManager.get).not.toHaveBeenCalled();
      expect(mockCacheManager.set).not.toHaveBeenCalled();
    });
  });

  describe('Cache Key Generation', () => {
    it('should generate consistent cache keys for same context', async () => {
      const context1 = { ...testContext };
      const context2 = { ...testContext };

      await analyzer.analyzeDateSize(context1);
      await analyzer.analyzeDateSize(context2);

      expect(mockCacheManager.get).toHaveBeenCalledTimes(2);
      const firstCall = mockCacheManager.get.mock.calls[0][0];
      const secondCall = mockCacheManager.get.mock.calls[1][0];
      expect(firstCall).toBe(secondCall);
    });

    it('should generate different cache keys for different dates', async () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-02');

      const context1 = { ...testContext, date: date1 };
      const context2 = { ...testContext, date: date2 };

      await analyzer.analyzeDateSize(context1);
      await analyzer.analyzeDateSize(context2);

      const firstCall = mockCacheManager.get.mock.calls[0][0];
      const secondCall = mockCacheManager.get.mock.calls[1][0];
      expect(firstCall).not.toBe(secondCall);
    });

    it('should generate different cache keys for different sizes', async () => {
      const context1 = { ...testContext, size: 50000 };
      const context2 = { ...testContext, size: 2000000 };

      await analyzer.analyzeDateSize(context1);
      await analyzer.analyzeDateSize(context2);

      const firstCall = mockCacheManager.get.mock.calls[0][0];
      const secondCall = mockCacheManager.get.mock.calls[1][0];
      expect(firstCall).not.toBe(secondCall);
    });
  });

  describe('Error Handling', () => {
    it('should handle cache errors gracefully', async () => {
      mockCacheManager.get.mockImplementation(() => {
        throw new Error('Cache error');
      });

      const result = await analyzer.analyzeDateSize(testContext);

      expect(result).toBeDefined();
    });

    it('should handle cache storage errors gracefully', async () => {
      mockCacheManager.get.mockReturnValue(null);
      mockCacheManager.set.mockImplementation(() => {
        throw new Error('Cache storage error');
      });

      const result = await analyzer.analyzeDateSize(testContext);

      expect(result).toBeDefined();
    });

    it('should throw error for invalid context type', async () => {
      await expect(analyzer.analyze({ invalid: 'context' } as any))
        .rejects.toThrow('DateSizeAnalyzer requires EmailAnalysisContext');
    });
  });

  describe('Edge Cases', () => {
    it('should handle future dates', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10); // 10 days in future

      const context = {
        ...testContext,
        date: futureDate
      };

      const result = await analyzer.analyzeDateSize(context);

      expect(result).toBeDefined();
      expect(result.ageCategory).toBe('recent');
      expect(result.recencyScore).toBeGreaterThan(1); // Should be > 1 for future dates
    });

    it('should handle extremely large sizes', async () => {
      const context = {
        ...testContext,
        size: Number.MAX_SAFE_INTEGER
      };

      const result = await analyzer.analyzeDateSize(context);

      expect(result).toBeDefined();
      expect(result.sizeCategory).toBe('large');
      expect(result.sizePenalty).toBeLessThanOrEqual(1);
    });

    it('should handle invalid dates', async () => {
      const context = {
        ...testContext,
        date: new Date('invalid-date')
      };

      // Should not throw, but may produce NaN values
      const result = await analyzer.analyzeDateSize(context);
      expect(result).toBeDefined();
    });
  });

  describe('Base Analyzer Interface', () => {
    it('should implement base analyze method', async () => {
      const result = await analyzer.analyze(testContext);

      expect(result).toBeDefined();
      expect(result).toHaveProperty('ageCategory');
      expect(result).toHaveProperty('sizeCategory');
      expect(result).toHaveProperty('recencyScore');
      expect(result).toHaveProperty('sizePenalty');
    });
  });
});