import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { 
  CategorizationConfigManager,
  CategorizationSystemConfig,
  DEFAULT_CATEGORIZATION_CONFIG
} from '../../../../src/categorization/config/CategorizationConfig.js';
import { 
  ImportanceAnalyzerConfig 
} from '../../../../src/categorization/interfaces/IImportanceAnalyzer.js';
import { 
  DateSizeAnalyzerConfig 
} from '../../../../src/categorization/interfaces/IDateSizeAnalyzer.js';
import { 
  LabelClassifierConfig 
} from '../../../../src/categorization/interfaces/ILabelClassifier.js';
import { Labels } from '../../../../src/categorization/types.js';

describe('CategorizationConfig Unit Tests', () => {
  let configManager: CategorizationConfigManager;

  beforeEach(() => {
    configManager = new CategorizationConfigManager();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Default Configuration', () => {
    it('should have valid default configuration structure', () => {
      expect(DEFAULT_CATEGORIZATION_CONFIG).toBeDefined();
      expect(DEFAULT_CATEGORIZATION_CONFIG.analyzers).toBeDefined();
      expect(DEFAULT_CATEGORIZATION_CONFIG.orchestration).toBeDefined();
      expect(DEFAULT_CATEGORIZATION_CONFIG.caching).toBeDefined();
      expect(DEFAULT_CATEGORIZATION_CONFIG.performance).toBeDefined();
    });

    it('should have valid importance analyzer config', () => {
      const importanceConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance;
      
      expect(importanceConfig.rules).toBeDefined();
      expect(Array.isArray(importanceConfig.rules)).toBe(true);
      expect(importanceConfig.rules.length).toBeGreaterThan(0);
      expect(importanceConfig.scoring).toBeDefined();
      expect(importanceConfig.caching).toBeDefined();
    });

    it('should have valid date/size analyzer config', () => {
      const dateSizeConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.dateSize;
      
      expect(dateSizeConfig.sizeThresholds).toBeDefined();
      expect(dateSizeConfig.ageCategories).toBeDefined();
      expect(dateSizeConfig.scoring).toBeDefined();
      expect(dateSizeConfig.caching).toBeDefined();
    });

    it('should have valid label classifier config', () => {
      const labelConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.labelClassifier;
      
      expect(labelConfig.labelMappings).toBeDefined();
      expect(labelConfig.scoring).toBeDefined();
      expect(labelConfig.caching).toBeDefined();
    });

    it('should have reasonable default thresholds', () => {
      const importanceConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance;
      
      expect(importanceConfig.scoring.highThreshold).toBeGreaterThan(importanceConfig.scoring.lowThreshold);
      expect(importanceConfig.scoring.defaultWeight).toBeGreaterThan(0);
    });

    it('should have ascending size thresholds', () => {
      const dateSizeConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.dateSize;
      
      expect(dateSizeConfig.sizeThresholds.small).toBeLessThan(dateSizeConfig.sizeThresholds.medium);
      expect(dateSizeConfig.sizeThresholds.medium).toBeLessThan(dateSizeConfig.sizeThresholds.large);
    });

    it('should have ascending age categories', () => {
      const dateSizeConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.dateSize;
      
      expect(dateSizeConfig.ageCategories.recent).toBeLessThan(dateSizeConfig.ageCategories.moderate);
      expect(dateSizeConfig.ageCategories.moderate).toBeLessThan(dateSizeConfig.ageCategories.old);
    });

    it('should include comprehensive rule types', () => {
      const importanceConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance;
      const ruleTypes = importanceConfig.rules.map(rule => rule.type);
      
      expect(ruleTypes).toContain('keyword');
      expect(ruleTypes).toContain('domain');
      expect(ruleTypes).toContain('label');
      expect(ruleTypes).toContain('noReply');
      expect(ruleTypes).toContain('largeAttachment');
    });

    it('should include high and low priority rules', () => {
      const importanceConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance;
      const weights = importanceConfig.rules.map(rule => rule.weight);
      
      expect(weights.some(weight => weight > 0)).toBe(true); // High priority rules
      expect(weights.some(weight => weight < 0)).toBe(true); // Low priority rules
    });
  });

  describe('CategorizationConfigManager Constructor', () => {
    it('should initialize with default config when no config provided', () => {
      const manager = new CategorizationConfigManager();
      const config = manager.getConfig();
      
      expect(config).toEqual(DEFAULT_CATEGORIZATION_CONFIG);
    });

    it('should merge partial config with defaults', () => {
      const partialConfig = {
        orchestration: {
          enableParallelProcessing: false,
          batchSize: 25,
          timeoutMs: 15000,
          retryAttempts: 2
        }
      };

      const manager = new CategorizationConfigManager(partialConfig);
      const config = manager.getConfig();
      
      expect(config.orchestration.enableParallelProcessing).toBe(false);
      expect(config.orchestration.batchSize).toBe(25);
      expect(config.analyzers).toEqual(DEFAULT_CATEGORIZATION_CONFIG.analyzers);
    });

    it('should handle deep partial config merging', () => {
      const partialConfig: Partial<CategorizationSystemConfig> = {
        analyzers: {
          importance: {
            ...DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance,
            scoring: {
              highThreshold: 15,
              lowThreshold: -8,
              defaultWeight: 1
            }
          },
          dateSize: DEFAULT_CATEGORIZATION_CONFIG.analyzers.dateSize,
          labelClassifier: DEFAULT_CATEGORIZATION_CONFIG.analyzers.labelClassifier
        }
      };

      const manager = new CategorizationConfigManager(partialConfig);
      const config = manager.getConfig();
      
      expect(config.analyzers.importance.scoring.highThreshold).toBe(15);
      expect(config.analyzers.importance.scoring.lowThreshold).toBe(-8);
      // Should preserve other default values
      expect(config.analyzers.importance.rules).toEqual(DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance.rules);
    });
  });

  describe('Configuration Retrieval', () => {
    it('should return complete configuration', () => {
      const config = configManager.getConfig();
      
      expect(config).toHaveProperty('analyzers');
      expect(config).toHaveProperty('orchestration');
      expect(config).toHaveProperty('caching');
      expect(config).toHaveProperty('performance');
    });

    it('should return deep copy of configuration', () => {
      const config1 = configManager.getConfig();
      const config2 = configManager.getConfig();
      
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2); // Different objects
      
      // Modify one config
      config1.orchestration.batchSize = 999;
      expect(config2.orchestration.batchSize).not.toBe(999);
    });

    it('should get specific analyzer config', () => {
      const importanceConfig = configManager.getAnalyzerConfig('importance');
      
      expect(importanceConfig).toHaveProperty('rules');
      expect(importanceConfig).toHaveProperty('scoring');
      expect(importanceConfig).toHaveProperty('caching');
    });

    it('should return deep copy of analyzer config', () => {
      const config1 = configManager.getAnalyzerConfig('importance');
      const config2 = configManager.getAnalyzerConfig('importance');
      
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);
    });
  });

  describe('Configuration Updates', () => {
    it('should update complete configuration', () => {
      const updates: Partial<CategorizationSystemConfig> = {
        orchestration: {
          enableParallelProcessing: false,
          batchSize: 100,
          timeoutMs: 60000,
          retryAttempts: 5
        },
        caching: {
          globalEnabled: false,
          defaultTtl: 1200,
          maxCacheSize: 2000
        }
      };

      configManager.updateConfig(updates);
      const config = configManager.getConfig();
      
      expect(config.orchestration.enableParallelProcessing).toBe(false);
      expect(config.orchestration.batchSize).toBe(100);
      expect(config.caching.globalEnabled).toBe(false);
      expect(config.caching.defaultTtl).toBe(1200);
    });

    it('should update specific analyzer configuration', () => {
      const importanceUpdates: Partial<ImportanceAnalyzerConfig> = {
        scoring: {
          highThreshold: 20,
          lowThreshold: -10,
          defaultWeight: 2
        }
      };

      configManager.updateAnalyzerConfig('importance', importanceUpdates);
      const config = configManager.getAnalyzerConfig('importance');
      
      expect(config.scoring.highThreshold).toBe(20);
      expect(config.scoring.lowThreshold).toBe(-10);
      expect(config.scoring.defaultWeight).toBe(2);
    });

    it('should preserve other config when updating specific analyzer', () => {
      const originalConfig = configManager.getConfig();
      
      configManager.updateAnalyzerConfig('importance', {
        scoring: { highThreshold: 25, lowThreshold: -5, defaultWeight: 1 }
      });
      
      const updatedConfig = configManager.getConfig();
      
      // Other analyzers should remain unchanged
      expect(updatedConfig.analyzers.dateSize).toEqual(originalConfig.analyzers.dateSize);
      expect(updatedConfig.analyzers.labelClassifier).toEqual(originalConfig.analyzers.labelClassifier);
      expect(updatedConfig.orchestration).toEqual(originalConfig.orchestration);
    });

    it('should handle partial analyzer updates', () => {
      const originalRules = configManager.getAnalyzerConfig('importance').rules;
      
      configManager.updateAnalyzerConfig('importance', {
        caching: { enabled: false, keyStrategy: 'full' }
      });
      
      const updatedConfig = configManager.getAnalyzerConfig('importance');
      
      expect(updatedConfig.caching.enabled).toBe(false);
      expect(updatedConfig.caching.keyStrategy).toBe('full');
      expect(updatedConfig.rules).toEqual(originalRules); // Should preserve rules
    });
  });

  describe('Configuration Reset', () => {
    it('should reset to default configuration', () => {
      // Make some changes
      configManager.updateConfig({
        orchestration: { enableParallelProcessing: false, batchSize: 999, timeoutMs: 1, retryAttempts: 1 }
      });
      
      // Reset
      configManager.resetToDefaults();
      
      const config = configManager.getConfig();
      expect(config).toEqual(DEFAULT_CATEGORIZATION_CONFIG);
    });

    it('should reset analyzer-specific changes', () => {
      // Make analyzer-specific changes
      configManager.updateAnalyzerConfig('importance', {
        scoring: { highThreshold: 999, lowThreshold: -999, defaultWeight: 999 }
      });
      
      // Reset
      configManager.resetToDefaults();
      
      const importanceConfig = configManager.getAnalyzerConfig('importance');
      expect(importanceConfig).toEqual(DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate valid default configuration', () => {
      const validation = configManager.validateConfig();
      
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect invalid importance analyzer thresholds', () => {
      configManager.updateAnalyzerConfig('importance', {
        scoring: {
          highThreshold: 5,
          lowThreshold: 10, // Invalid: low > high
          defaultWeight: 1
        }
      });
      
      const validation = configManager.validateConfig();
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(error => 
        error.includes('highThreshold must be greater than lowThreshold')
      )).toBe(true);
    });

    it('should detect empty importance rules', () => {
      configManager.updateAnalyzerConfig('importance', {
        rules: [] // Invalid: no rules
      });
      
      const validation = configManager.validateConfig();
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(error => 
        error.includes('must have at least one rule')
      )).toBe(true);
    });

    it('should detect invalid size thresholds order', () => {
      configManager.updateAnalyzerConfig('dateSize', {
        sizeThresholds: {
          small: 1000000,  // 1MB
          medium: 500000,  // 500KB - Invalid: medium < small
          large: 2000000   // 2MB
        }
      });
      
      const validation = configManager.validateConfig();
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(error => 
        error.includes('size thresholds must be in ascending order')
      )).toBe(true);
    });

    it('should detect invalid age categories order', () => {
      configManager.updateAnalyzerConfig('dateSize', {
        ageCategories: {
          recent: 30,    // 30 days
          moderate: 15,  // 15 days - Invalid: moderate < recent
          old: 90        // 90 days
        }
      });
      
      const validation = configManager.validateConfig();
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(error => 
        error.includes('age categories must be in ascending order')
      )).toBe(true);
    });

    it('should detect invalid orchestration batch size', () => {
      configManager.updateConfig({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 0, // Invalid: must be > 0
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });
      
      const validation = configManager.validateConfig();
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(error => 
        error.includes('batchSize must be greater than 0')
      )).toBe(true);
    });

    it('should detect invalid orchestration timeout', () => {
      configManager.updateConfig({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 50,
          timeoutMs: -1000, // Invalid: must be > 0
          retryAttempts: 3
        }
      });
      
      const validation = configManager.validateConfig();
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.some(error => 
        error.includes('timeoutMs must be greater than 0')
      )).toBe(true);
    });

    it('should accumulate multiple validation errors', () => {
      configManager.updateConfig({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 0,     // Error 1
          timeoutMs: -1000, // Error 2
          retryAttempts: 3
        }
      });
      
      configManager.updateAnalyzerConfig('importance', {
        rules: [], // Error 3
        scoring: {
          highThreshold: 5,
          lowThreshold: 10, // Error 4
          defaultWeight: 1
        }
      });
      
      const validation = configManager.validateConfig();
      
      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Configuration Merging', () => {
    it('should handle nested object merging correctly', () => {
      const updates: Partial<CategorizationSystemConfig> = {
        analyzers: {
          importance: {
            ...DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance,
            scoring: {
              ...DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance.scoring,
              highThreshold: 15
              // lowThreshold and defaultWeight should be preserved
            }
          },
          dateSize: DEFAULT_CATEGORIZATION_CONFIG.analyzers.dateSize,
          labelClassifier: DEFAULT_CATEGORIZATION_CONFIG.analyzers.labelClassifier
        }
      };

      configManager.updateConfig(updates);
      const config = configManager.getConfig();
      
      expect(config.analyzers.importance.scoring.highThreshold).toBe(15);
      expect(config.analyzers.importance.scoring.lowThreshold).toBe(DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance.scoring.lowThreshold);
      expect(config.analyzers.importance.scoring.defaultWeight).toBe(DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance.scoring.defaultWeight);
    });

    it('should preserve arrays when merging', () => {
      const originalRules = configManager.getAnalyzerConfig('importance').rules;
      
      configManager.updateConfig({
        caching: { globalEnabled: false, defaultTtl: 1200, maxCacheSize: 2000 }
      });
      
      const updatedRules = configManager.getAnalyzerConfig('importance').rules;
      expect(updatedRules).toEqual(originalRules);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty partial config', () => {
      const manager = new CategorizationConfigManager({});
      const config = manager.getConfig();
      
      expect(config).toEqual(DEFAULT_CATEGORIZATION_CONFIG);
    });

    it('should handle null/undefined updates gracefully', () => {
      expect(() => {
        configManager.updateConfig({});
        configManager.updateAnalyzerConfig('importance', {});
      }).not.toThrow();
    });

    it('should handle invalid analyzer type in getAnalyzerConfig', () => {
      // TypeScript should prevent this, but test runtime behavior
      expect(() => {
        configManager.getAnalyzerConfig('invalid' as any);
      }).not.toThrow();
    });
  });

  describe('Label Constants Integration', () => {
    it('should use proper label constants in default config', () => {
      const labelConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.labelClassifier;
      
      expect(labelConfig.labelMappings.spamLabels).toContain(Labels.SPAM);
      expect(labelConfig.labelMappings.promotionalLabels).toContain(Labels.PROMOTIONAL);
      expect(labelConfig.labelMappings.promotionalLabels).toContain(Labels.CATEGORY_PROMOTIONS);
      expect(labelConfig.labelMappings.socialLabels).toContain(Labels.CATEGORY_SOCIAL);
    });

    it('should include comprehensive label mappings', () => {
      const labelConfig = DEFAULT_CATEGORIZATION_CONFIG.analyzers.labelClassifier;
      
      expect(Object.keys(labelConfig.labelMappings.gmailToCategory).length).toBeGreaterThan(5);
      expect(labelConfig.labelMappings.spamLabels.length).toBeGreaterThan(3);
      expect(labelConfig.labelMappings.promotionalLabels.length).toBeGreaterThan(5);
      expect(labelConfig.labelMappings.socialLabels.length).toBeGreaterThan(3);
    });
  });
});