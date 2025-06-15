import { describe, it, expect, beforeEach } from '@jest/globals';
import { ConfigurationManager } from '../ConfigurationManager.js';
import { TestScenarioConfig, ConfigurationPreset } from '../types.js';

describe('ConfigurationManager', () => {
  let configManager: ConfigurationManager;

  beforeEach(() => {
    configManager = new ConfigurationManager();
  });

  describe('Configuration Resolution', () => {
    it('should resolve configuration with global defaults', () => {
      const scenario: TestScenarioConfig = {
        name: 'Test Scenario',
        description: 'Test description',
        emails: [],
        policies: [],
        execution: {
          dryRun: true,
          maxEmails: 5
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      const resolved = configManager.resolveConfiguration(scenario);

      // Should inherit global defaults while preserving scenario values
      expect(resolved.name).toBe('Test Scenario');
      expect(resolved.execution.dryRun).toBe(true);
      expect(resolved.execution.maxEmails).toBe(5);
      expect(resolved.execution.batchSize).toBe(5); // From global defaults
      expect(resolved.execution.timeout).toBe(30000); // From global defaults
      expect(resolved.safetyConfig).toBeDefined();
      expect(resolved.safetyConfig?.enableSafetyMetrics).toBe(true);
    });

    it('should apply category-specific configuration for permissive category', () => {
      const scenario: TestScenarioConfig = {
        name: 'Permissive Test',
        description: 'Permissive deletion test',
        category: 'permissive',
        emails: [],
        policies: [],
        execution: {
          maxEmails: 10
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      const resolved = configManager.resolveConfiguration(scenario);

      // Should apply permissive category settings
      expect(resolved.category).toBe('permissive');
      expect(resolved.safetyConfig?.vipDomains).toEqual(['test-vip-never-match.com']);
      expect(resolved.safetyConfig?.minStalenessScore).toBe(0.0);
      expect(resolved.safetyConfig?.maxAccessScore).toBe(1.0);
      expect(resolved.safetyConfig?.importanceScoreThreshold).toBe(100.0);
      expect(resolved.tags).toContain('permissive');
    });

    it('should apply category-specific configuration for strict category', () => {
      const scenario: TestScenarioConfig = {
        name: 'Strict Test',
        description: 'Strict safety test',
        category: 'strict',
        emails: [],
        policies: [],
        execution: {
          maxEmails: 10
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      const resolved = configManager.resolveConfiguration(scenario);

      // Should apply strict category settings
      expect(resolved.category).toBe('strict');
      expect(resolved.safetyConfig?.vipDomains).toContain('board-of-directors.com');
      expect(resolved.safetyConfig?.minStalenessScore).toBe(0.7);
      expect(resolved.safetyConfig?.maxAccessScore).toBe(0.3);
      expect(resolved.safetyConfig?.importanceScoreThreshold).toBe(4.0);
      expect(resolved.safetyConfig?.enableDetailedLogging).toBe(true);
      expect(resolved.tags).toContain('strict');
    });

    it('should apply edge_case category configuration', () => {
      const scenario: TestScenarioConfig = {
        name: 'Edge Case Test',
        description: 'Edge case test',
        category: 'edge_case',
        emails: [],
        policies: [],
        execution: {
          maxEmails: 2
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      const resolved = configManager.resolveConfiguration(scenario);

      // Should apply edge case settings
      expect(resolved.category).toBe('edge_case');
      expect(resolved.execution.maxEmails).toBe(2); // Scenario override
      expect(resolved.execution.batchSize).toBe(1); // Category setting
      expect(resolved.execution.timeout).toBe(60000); // Category setting
      expect(resolved.safetyConfig?.maxDeletionsPerHour).toBe(1);
      expect(resolved.safetyConfig?.bulkOperationThreshold).toBe(1);
      expect(resolved.tags).toContain('edge-case');
    });

    it('should override category settings with scenario-specific values', () => {
      const scenario: TestScenarioConfig = {
        name: 'Override Test',
        description: 'Override test',
        category: 'strict',
        emails: [],
        policies: [],
        execution: {
          maxEmails: 15,
          batchSize: 10,
          timeout: 45000
        },
        safetyConfig: {
          minStalenessScore: 0.5,
          enableDetailedLogging: false
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      const resolved = configManager.resolveConfiguration(scenario);

      // Scenario values should override category and global defaults
      expect(resolved.execution.maxEmails).toBe(15);
      expect(resolved.execution.batchSize).toBe(10);
      expect(resolved.execution.timeout).toBe(45000);
      expect(resolved.safetyConfig?.minStalenessScore).toBe(0.5);
      expect(resolved.safetyConfig?.enableDetailedLogging).toBe(false);
      
      // Should still inherit non-overridden category values
      expect(resolved.safetyConfig?.maxAccessScore).toBe(0.3); // From strict category
    });
  });

  describe('Configuration Presets', () => {
    it('should retrieve predefined presets', () => {
      const permissivePreset = configManager.getPreset('PERMISSIVE_DELETION');
      expect(permissivePreset).toBeDefined();
      expect(permissivePreset?.name).toBe('PERMISSIVE_DELETION');
      expect(permissivePreset?.safetyConfig?.minStalenessScore).toBe(0.0);

      const strictPreset = configManager.getPreset('STRICT_SAFETY');
      expect(strictPreset).toBeDefined();
      expect(strictPreset?.name).toBe('STRICT_SAFETY');
      expect(strictPreset?.safetyConfig?.minStalenessScore).toBe(0.8);

      const edgeCasePreset = configManager.getPreset('EDGE_CASE_TESTING');
      expect(edgeCasePreset).toBeDefined();
      expect(edgeCasePreset?.name).toBe('EDGE_CASE_TESTING');
      expect(edgeCasePreset?.safetyConfig?.maxDeletionsPerHour).toBe(1);
    });

    it('should return null for unknown presets', () => {
      const unknownPreset = configManager.getPreset('UNKNOWN_PRESET');
      expect(unknownPreset).toBeNull();
    });

    it('should apply preset to scenario configuration', () => {
      const scenario: TestScenarioConfig = {
        name: 'Preset Test',
        description: 'Test with preset',
        emails: [],
        policies: [],
        execution: {
          maxEmails: 10
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        },
        tags: ['original-tag']
      };

      const withPreset = configManager.applyPreset(scenario, 'PERMISSIVE_DELETION');

      expect(withPreset.safetyConfig?.minStalenessScore).toBe(0.0);
      expect(withPreset.safetyConfig?.maxAccessScore).toBe(1.0);
      expect(withPreset.tags).toContain('original-tag');
      expect(withPreset.tags).toContain('preset');
      expect(withPreset.tags).toContain('permissive');
      expect(withPreset.tags).toContain('preset:PERMISSIVE_DELETION');
    });

    it('should throw error for unknown preset application', () => {
      const scenario: TestScenarioConfig = {
        name: 'Invalid Preset Test',
        description: 'Test with invalid preset',
        emails: [],
        policies: [],
        execution: {
          maxEmails: 10
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      expect(() => {
        configManager.applyPreset(scenario, 'INVALID_PRESET');
      }).toThrow('Unknown configuration preset: INVALID_PRESET');
    });
  });

  describe('Custom Configuration Registration', () => {
    it('should register custom category configuration', () => {
      const customConfig = {
        safetyConfig: {
          minStalenessScore: 0.9,
          maxAccessScore: 0.1
        },
        tags: ['custom-category']
      };

      configManager.registerCategoryConfig('custom', customConfig);

      const scenario: TestScenarioConfig = {
        name: 'Custom Category Test',
        description: 'Test with custom category',
        category: 'custom' as any,
        emails: [],
        policies: [],
        execution: {
          maxEmails: 10
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      const resolved = configManager.resolveConfiguration(scenario);

      expect(resolved.safetyConfig?.minStalenessScore).toBe(0.9);
      expect(resolved.safetyConfig?.maxAccessScore).toBe(0.1);
      expect(resolved.tags).toContain('custom-category');
    });

    it('should register custom preset', () => {
      const customPreset: ConfigurationPreset = {
        name: 'CUSTOM_PRESET',
        description: 'Custom test preset',
        safetyConfig: {
          minStalenessScore: 0.75,
          enableDetailedLogging: true
        },
        tags: ['custom', 'preset']
      };

      configManager.registerPreset(customPreset);

      const retrievedPreset = configManager.getPreset('CUSTOM_PRESET');
      expect(retrievedPreset).toBeDefined();
      expect(retrievedPreset?.safetyConfig?.minStalenessScore).toBe(0.75);
      expect(retrievedPreset?.tags).toContain('custom');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration successfully', () => {
      const validScenario: TestScenarioConfig = {
        name: 'Valid Test',
        description: 'Valid configuration',
        emails: [],
        policies: [],
        execution: {
          dryRun: false,
          maxEmails: 10,
          batchSize: 5,
          timeout: 30000
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0, max: 10 },
          emailsDeleted: { min: 0, max: 5 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      // Should not throw
      expect(() => {
        configManager.resolveConfiguration(validScenario);
      }).not.toThrow();
    });

    it('should throw validation error for invalid configuration', () => {
      const invalidScenario: TestScenarioConfig = {
        name: '', // Invalid empty name
        description: 'Invalid configuration',
        emails: [],
        policies: [],
        execution: {
          maxEmails: -1, // Invalid negative value
          batchSize: 0, // Invalid zero value
          timeout: 500 // Invalid low timeout
        },
        expected: {
          success: true,
          emailsProcessed: { min: 0 },
          emailsDeleted: { min: 0 },
          storageFreed: { min: 0 },
          errors: { maxCount: 0 }
        }
      };

      expect(() => {
        configManager.resolveConfiguration(invalidScenario);
      }).toThrow(/Configuration validation failed/);
    });
  });

  describe('Configuration Statistics', () => {
    it('should provide configuration statistics', () => {
      const stats = configManager.getStats();

      expect(stats.categories).toBeGreaterThan(0);
      expect(stats.presets).toBeGreaterThan(0);
      expect(stats.globalConfigKeys).toBeGreaterThan(0);
    });

    it('should list available categories and presets', () => {
      const categories = configManager.getAvailableCategories();
      const presets = configManager.getAvailablePresets();

      expect(categories).toContain('permissive');
      expect(categories).toContain('strict');
      expect(categories).toContain('edge_case');
      expect(categories).toContain('performance');

      expect(presets).toContain('PERMISSIVE_DELETION');
      expect(presets).toContain('STRICT_SAFETY');
      expect(presets).toContain('EDGE_CASE_TESTING');
    });
  });
});