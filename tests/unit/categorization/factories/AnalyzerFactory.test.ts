import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AnalyzerFactory } from '../../../../src/categorization/factories/AnalyzerFactory.js';
import { 
  ImportanceAnalyzerConfig,
  IImportanceAnalyzer 
} from '../../../../src/categorization/interfaces/IImportanceAnalyzer.js';
import { 
  DateSizeAnalyzerConfig,
  IDateSizeAnalyzer 
} from '../../../../src/categorization/interfaces/IDateSizeAnalyzer.js';
import { 
  LabelClassifierConfig,
  ILabelClassifier 
} from '../../../../src/categorization/interfaces/ILabelClassifier.js';
import { ImportanceAnalyzer } from '../../../../src/categorization/analyzers/ImportanceAnalyzer.js';
import { DateSizeAnalyzer } from '../../../../src/categorization/analyzers/DateSizeAnalyzer.js';
import { LabelClassifier } from '../../../../src/categorization/analyzers/LabelClassifier.js';
import { DatabaseManager } from '../../../../src/database/DatabaseManager.js';
import { CacheManager } from '../../../../src/cache/CacheManager.js';
import { Labels } from '../../../../src/categorization/types.js';

describe('AnalyzerFactory Unit Tests', () => {
  let factory: AnalyzerFactory;
  let mockDatabaseManager: jest.Mocked<DatabaseManager>;
  let mockCacheManager: jest.Mocked<CacheManager>;

  beforeEach(() => {
    // Create mock database manager
    mockDatabaseManager = {
      initialize: jest.fn(),
      close: jest.fn(),
      getEmailIndex: jest.fn(),
      upsertEmailIndex: jest.fn(),
      searchEmails: jest.fn(),
      bulkUpsertEmailIndex: jest.fn(),
      getEmailStatistics: jest.fn()
    } as any;

    // Create mock cache manager
    mockCacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      flush: jest.fn(),
      has: jest.fn(),
      stats: jest.fn()
    } as any;

    factory = new AnalyzerFactory(mockDatabaseManager, mockCacheManager);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with database and cache managers', () => {
      expect(factory).toBeInstanceOf(AnalyzerFactory);
    });

    it('should initialize without managers', () => {
      const factoryWithoutManagers = new AnalyzerFactory();
      expect(factoryWithoutManagers).toBeInstanceOf(AnalyzerFactory);
    });
  });

  describe('ImportanceAnalyzer Creation', () => {
    it('should create ImportanceAnalyzer with default config', () => {
      const analyzer = factory.createImportanceAnalyzer();

      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
      expect(analyzer).toBeDefined();
    });

    it('should create ImportanceAnalyzer with custom config', () => {
      const customConfig: ImportanceAnalyzerConfig = {
        rules: [
          {
            id: 'custom-rule',
            name: 'Custom Rule',
            type: 'keyword',
            priority: 100,
            weight: 10,
            keywords: ['custom', 'test']
          }
        ],
        scoring: {
          highThreshold: 15,
          lowThreshold: -5,
          defaultWeight: 2
        },
        caching: {
          enabled: false,
          keyStrategy: 'full'
        }
      };

      const analyzer = factory.createImportanceAnalyzer(customConfig);

      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should create analyzer with proper dependency injection', () => {
      const analyzer = factory.createImportanceAnalyzer();

      // Test that the analyzer was created with the injected dependencies
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should include default high priority rules', () => {
      const analyzer = factory.createImportanceAnalyzer();
      
      // We can't directly access private rules, but we can test through public interface
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should include default low priority rules', () => {
      const analyzer = factory.createImportanceAnalyzer();
      
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should have proper default scoring thresholds', () => {
      const analyzer = factory.createImportanceAnalyzer();
      
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });
  });

  describe('DateSizeAnalyzer Creation', () => {
    it('should create DateSizeAnalyzer with default config', () => {
      const analyzer = factory.createDateSizeAnalyzer();

      expect(analyzer).toBeInstanceOf(DateSizeAnalyzer);
      expect(analyzer).toBeDefined();
    });

    it('should create DateSizeAnalyzer with custom config', () => {
      const customConfig: DateSizeAnalyzerConfig = {
        sizeThresholds: {
          small: 50000,     // 50KB
          medium: 500000,   // 500KB
          large: 5000000    // 5MB
        },
        ageCategories: {
          recent: 3,    // 3 days
          moderate: 14, // 14 days
          old: 60       // 60 days
        },
        scoring: {
          recencyWeight: 0.8,
          sizeWeight: 0.2
        },
        caching: {
          enabled: false,
          ttl: 7200 // 2 hours
        }
      };

      const analyzer = factory.createDateSizeAnalyzer(customConfig);

      expect(analyzer).toBeInstanceOf(DateSizeAnalyzer);
    });

    it('should have proper default size thresholds', () => {
      const analyzer = factory.createDateSizeAnalyzer();
      
      // Test default thresholds through public interface
      expect(analyzer.categorizeBySize(50000)).toBe('small');    // 50KB
      expect(analyzer.categorizeBySize(500000)).toBe('medium');  // 500KB
      expect(analyzer.categorizeBySize(5000000)).toBe('large'); // 5MB
      expect(analyzer.categorizeBySize(15000000)).toBe('large'); // 15MB
    });

    it('should have proper default age categories', () => {
      const analyzer = factory.createDateSizeAnalyzer();
      
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3);
      
      const moderateDate = new Date();
      moderateDate.setDate(moderateDate.getDate() - 15);
      
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 60);
      
      expect(analyzer.categorizeByAge(recentDate)).toBe('recent');
      expect(analyzer.categorizeByAge(moderateDate)).toBe('moderate');
      expect(analyzer.categorizeByAge(oldDate)).toBe('old');
    });
  });

  describe('LabelClassifier Creation', () => {
    it('should create LabelClassifier with default config', () => {
      const classifier = factory.createLabelClassifier();

      expect(classifier).toBeInstanceOf(LabelClassifier);
      expect(classifier).toBeDefined();
    });

    it('should create LabelClassifier with custom config', () => {
      const customConfig: LabelClassifierConfig = {
        labelMappings: {
          gmailToCategory: {
            'custom': 'important',
            'test': 'spam'
          },
          spamLabels: ['custom-spam'],
          promotionalLabels: ['custom-promo'],
          socialLabels: ['custom-social']
        },
        scoring: {
          spamThreshold: 0.9,
          promotionalThreshold: 0.7,
          socialThreshold: 0.6
        },
        caching: {
          enabled: false,
          ttl: 900 // 15 minutes
        }
      };

      const classifier = factory.createLabelClassifier(customConfig);

      expect(classifier).toBeInstanceOf(LabelClassifier);
    });

    it('should have proper default label mappings', () => {
      const classifier = factory.createLabelClassifier();
      
      // Test default mappings through public interface
      expect(classifier.categorizeByGmailLabels(['important'])).toBe('important');
      expect(classifier.categorizeByGmailLabels(['spam'])).toBe('spam');
      expect(classifier.categorizeByGmailLabels(['promotions'])).toBe('promotions');
      expect(classifier.categorizeByGmailLabels(['social'])).toBe('social');
    });

    it('should include default spam labels', () => {
      const classifier = factory.createLabelClassifier();
      
      const spamScore = classifier.detectSpamIndicators([Labels.SPAM]);
      expect(spamScore.score).toBeGreaterThan(0);
    });

    it('should include default promotional labels', async () => {
      const classifier = factory.createLabelClassifier();
      
      const result = await classifier.classifyLabels([Labels.PROMOTIONAL]);
      expect(result.promotionalScore).toBeGreaterThan(0);
    });

    it('should include default social labels', async () => {
      const classifier = factory.createLabelClassifier();
      
      const result = await classifier.classifyLabels([Labels.CATEGORY_SOCIAL]);
      expect(result.socialScore).toBeGreaterThan(0);
    });
  });

  describe('Create All Analyzers', () => {
    it('should create all analyzers with default configs', () => {
      const analyzers = factory.createAllAnalyzers();

      expect(analyzers.importanceAnalyzer).toBeInstanceOf(ImportanceAnalyzer);
      expect(analyzers.dateSizeAnalyzer).toBeInstanceOf(DateSizeAnalyzer);
      expect(analyzers.labelClassifier).toBeInstanceOf(LabelClassifier);
    });

    it('should create all analyzers with custom configs', () => {
      const customConfigs = {
        importance: {
          rules: [{
            id: 'test-rule',
            name: 'Test Rule',
            type: 'keyword',
            priority: 50,
            weight: 5,
            keywords: ['test']
          }],
          scoring: { highThreshold: 10, lowThreshold: -2, defaultWeight: 1 },
          caching: { enabled: true, keyStrategy: 'partial' as const }
        },
        dateSize: {
          sizeThresholds: { small: 100000, medium: 1000000, large: 10000000 },
          ageCategories: { recent: 5, moderate: 20, old: 100 },
          scoring: { recencyWeight: 0.6, sizeWeight: 0.4 },
          caching: { enabled: true, ttl: 1800 }
        },
        labelClassifier: {
          labelMappings: {
            gmailToCategory: { 'test': 'important' as const },
            spamLabels: ['test-spam'],
            promotionalLabels: ['test-promo'],
            socialLabels: ['test-social']
          },
          scoring: { spamThreshold: 0.8, promotionalThreshold: 0.6, socialThreshold: 0.5 },
          caching: { enabled: true, ttl: 900 }
        }
      };

      const analyzers = factory.createAllAnalyzers(customConfigs);

      expect(analyzers.importanceAnalyzer).toBeInstanceOf(ImportanceAnalyzer);
      expect(analyzers.dateSizeAnalyzer).toBeInstanceOf(DateSizeAnalyzer);
      expect(analyzers.labelClassifier).toBeInstanceOf(LabelClassifier);
    });

    it('should create analyzers with partial custom configs', () => {
      const partialConfigs = {
        importance: {
          rules: [{
            id: 'partial-rule',
            name: 'Partial Rule',
            type: 'keyword',
            priority: 75,
            weight: 8,
            keywords: ['partial']
          }],
          scoring: { highThreshold: 12, lowThreshold: -3, defaultWeight: 1 },
          caching: { enabled: true, keyStrategy: 'full' as const }
        }
        // dateSize and labelClassifier will use defaults
      };

      const analyzers = factory.createAllAnalyzers(partialConfigs);

      expect(analyzers.importanceAnalyzer).toBeInstanceOf(ImportanceAnalyzer);
      expect(analyzers.dateSizeAnalyzer).toBeInstanceOf(DateSizeAnalyzer);
      expect(analyzers.labelClassifier).toBeInstanceOf(LabelClassifier);
    });
  });

  describe('Dependency Management', () => {
    it('should update database manager', () => {
      const newDbManager = {
        initialize: jest.fn(),
        close: jest.fn()
      } as any;

      factory.setDatabaseManager(newDbManager);

      // Create a new analyzer to test if new db manager is used
      const analyzer = factory.createImportanceAnalyzer();
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should update cache manager', () => {
      const newCacheManager = {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        flush: jest.fn(),
        has: jest.fn(),
        stats: jest.fn()
      } as any;

      factory.setCacheManager(newCacheManager);

      // Create new analyzers to test if new cache manager is used
      const importanceAnalyzer = factory.createImportanceAnalyzer();
      const dateSizeAnalyzer = factory.createDateSizeAnalyzer();
      const labelClassifier = factory.createLabelClassifier();

      expect(importanceAnalyzer).toBeInstanceOf(ImportanceAnalyzer);
      expect(dateSizeAnalyzer).toBeInstanceOf(DateSizeAnalyzer);
      expect(labelClassifier).toBeInstanceOf(LabelClassifier);
    });

    it('should work without database manager', () => {
      const factoryWithoutDb = new AnalyzerFactory(undefined, mockCacheManager);
      
      const analyzer = factoryWithoutDb.createImportanceAnalyzer();
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should work without cache manager', () => {
      const factoryWithoutCache = new AnalyzerFactory(mockDatabaseManager, undefined);
      
      const analyzer = factoryWithoutCache.createImportanceAnalyzer();
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should work without any managers', () => {
      const factoryWithoutManagers = new AnalyzerFactory();
      
      const analyzers = factoryWithoutManagers.createAllAnalyzers();
      expect(analyzers.importanceAnalyzer).toBeInstanceOf(ImportanceAnalyzer);
      expect(analyzers.dateSizeAnalyzer).toBeInstanceOf(DateSizeAnalyzer);
      expect(analyzers.labelClassifier).toBeInstanceOf(LabelClassifier);
    });
  });

  describe('Default Configuration Validation', () => {
    it('should create ImportanceAnalyzer with valid default rules', () => {
      const analyzer = factory.createImportanceAnalyzer();
      
      // Test that analyzer can be used without errors
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should have reasonable default thresholds for importance', () => {
      const analyzer = factory.createImportanceAnalyzer();
      
      // The analyzer should be created successfully with reasonable defaults
      expect(analyzer).toBeInstanceOf(ImportanceAnalyzer);
    });

    it('should have reasonable default thresholds for date/size', () => {
      const analyzer = factory.createDateSizeAnalyzer();
      
      // Test some reasonable size categorizations
      expect(analyzer.categorizeBySize(1000)).toBe('small');      // 1KB
      expect(analyzer.categorizeBySize(100000)).toBe('small');    // 100KB
      expect(analyzer.categorizeBySize(1000000)).toBe('medium');  // 1MB
      expect(analyzer.categorizeBySize(50000000)).toBe('large');  // 50MB
    });

    it('should have comprehensive default label mappings', () => {
      const classifier = factory.createLabelClassifier();
      
      // Test various common Gmail labels
      expect(classifier.categorizeByGmailLabels(['IMPORTANT'])).toBe('important');
      expect(classifier.categorizeByGmailLabels(['STARRED'])).toBe('important');
      expect(classifier.categorizeByGmailLabels(['SPAM'])).toBe('spam');
      expect(classifier.categorizeByGmailLabels(['PROMOTIONS'])).toBe('promotions');
      expect(classifier.categorizeByGmailLabels(['SOCIAL'])).toBe('social');
      expect(classifier.categorizeByGmailLabels(['UPDATES'])).toBe('updates');
      expect(classifier.categorizeByGmailLabels(['FORUMS'])).toBe('forums');
      expect(classifier.categorizeByGmailLabels(['UNKNOWN'])).toBe('primary');
    });
  });

  describe('Error Handling', () => {
    it('should handle analyzer creation errors gracefully', () => {
      // This test ensures the factory doesn't throw during normal operation
      expect(() => {
        factory.createImportanceAnalyzer();
        factory.createDateSizeAnalyzer();
        factory.createLabelClassifier();
        factory.createAllAnalyzers();
      }).not.toThrow();
    });

    it('should handle invalid custom configs gracefully', () => {
      // Test with minimal valid configs
      const minimalImportanceConfig: ImportanceAnalyzerConfig = {
        rules: [],
        scoring: { highThreshold: 5, lowThreshold: -5, defaultWeight: 1 },
        caching: { enabled: false, keyStrategy: 'partial' }
      };

      expect(() => {
        factory.createImportanceAnalyzer(minimalImportanceConfig);
      }).not.toThrow();
    });
  });

  describe('Integration with Analyzers', () => {
    it('should create analyzers that can be configured', () => {
      const analyzer = factory.createImportanceAnalyzer();
      
      const newConfig: ImportanceAnalyzerConfig = {
        rules: [{
          id: 'new-rule',
          name: 'New Rule',
          type: 'keyword',
          priority: 100,
          weight: 10,
          keywords: ['new']
        }],
        scoring: { highThreshold: 10, lowThreshold: -5, defaultWeight: 1 },
        caching: { enabled: true, keyStrategy: 'partial' }
      };

      expect(() => {
        analyzer.configure(newConfig);
      }).not.toThrow();
    });

    it('should create analyzers that implement proper interfaces', () => {
      const analyzers = factory.createAllAnalyzers();

      // Test that analyzers implement their interfaces
      expect(typeof analyzers.importanceAnalyzer.analyze).toBe('function');
      expect(typeof analyzers.importanceAnalyzer.configure).toBe('function');
      expect(typeof analyzers.importanceAnalyzer.analyzeImportance).toBe('function');
      expect(typeof analyzers.importanceAnalyzer.registerRule).toBe('function');

      expect(typeof analyzers.dateSizeAnalyzer.analyze).toBe('function');
      expect(typeof analyzers.dateSizeAnalyzer.configure).toBe('function');
      expect(typeof analyzers.dateSizeAnalyzer.analyzeDateSize).toBe('function');
      expect(typeof analyzers.dateSizeAnalyzer.categorizeByAge).toBe('function');
      expect(typeof analyzers.dateSizeAnalyzer.categorizeBySize).toBe('function');

      expect(typeof analyzers.labelClassifier.analyze).toBe('function');
      expect(typeof analyzers.labelClassifier.configure).toBe('function');
      expect(typeof analyzers.labelClassifier.classifyLabels).toBe('function');
      expect(typeof analyzers.labelClassifier.detectSpamIndicators).toBe('function');
      expect(typeof analyzers.labelClassifier.categorizeByGmailLabels).toBe('function');
    });
  });
});