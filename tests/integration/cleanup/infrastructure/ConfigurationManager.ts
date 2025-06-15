import {
  TestScenarioConfig,
  SafetyTestConfig,
  AutomationTestConfig,
  ConfigurationPreset,
  HierarchicalConfig
} from './types.js';
import { logger } from '../../../../src/utils/logger';

/**
 * ConfigurationManager handles hierarchical configuration system for cleanup tests.
 * 
 * This class implements a hierarchical configuration system that merges configurations
 * from global → category → scenario levels, with predefined presets for common scenarios.
 * 
 * Key Features:
 * - Hierarchical configuration merging (global → category → scenario)
 * - Predefined configuration presets (PERMISSIVE_DELETION, STRICT_SAFETY, EDGE_CASE_TESTING)
 * - Configuration validation and error reporting
 * - Deep merging of nested configuration objects
 * - Type-safe configuration handling
 * 
 * Configuration Hierarchy:
 * 1. Global defaults (base configuration for all tests)
 * 2. Category-specific configs (e.g., permissive, strict, edge_case)
 * 3. Scenario-specific configs (individual test overrides)
 * 
 * @example
 * ```typescript
 * const configManager = new ConfigurationManager();
 * const resolvedConfig = configManager.resolveConfiguration(scenarioConfig);
 * ```
 */
export class ConfigurationManager {
  private globalConfig: Partial<TestScenarioConfig>;
  private categoryConfigs: Map<string, Partial<TestScenarioConfig>>;
  private presets: Map<string, ConfigurationPreset>;

  constructor() {
    this.globalConfig = this.createGlobalDefaults();
    this.categoryConfigs = new Map();
    this.presets = new Map();

    // Initialize predefined configurations
    this.initializePredefinedConfigs();
    this.initializeCategoryConfigs();
    this.initializePresets();

    logger.debug('ConfigurationManager initialized', {
      categories: Array.from(this.categoryConfigs.keys()),
      presets: Array.from(this.presets.keys())
    });
  }

  /**
   * Resolve configuration using hierarchical merging
   * 
   * @param scenario - Base scenario configuration
   * @returns Fully resolved configuration with all hierarchical merges applied
   */
  resolveConfiguration(scenario: TestScenarioConfig): TestScenarioConfig {
    try {
      logger.debug('Resolving configuration hierarchy', {
        scenario_name: scenario.name,
        scenario_category: scenario.category
      });

      // Start with global defaults
      let resolvedConfig = this.deepClone(this.globalConfig);

      // Apply category-specific configuration if available
      if (scenario.category && this.categoryConfigs.has(scenario.category)) {
        const categoryConfig = this.categoryConfigs.get(scenario.category)!;
        resolvedConfig = this.deepMerge(resolvedConfig, categoryConfig);
        
        logger.debug('Applied category configuration', {
          category: scenario.category
        });
      }

      // Apply scenario-specific configuration (highest priority)
      resolvedConfig = this.deepMerge(resolvedConfig, scenario);

      // Validate the resolved configuration
      this.validateConfiguration(resolvedConfig as TestScenarioConfig);

      logger.debug('Configuration resolved successfully', {
        scenario_name: scenario.name,
        final_safety_domains_count: resolvedConfig.safetyConfig?.vipDomains?.length || 0,
        final_execution_config: resolvedConfig.execution
      });

      return resolvedConfig as TestScenarioConfig;

    } catch (error) {
      logger.error('Failed to resolve configuration', {
        scenario_name: scenario.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get a predefined configuration preset
   * 
   * @param presetName - Name of the preset to retrieve
   * @returns Configuration preset or null if not found
   */
  getPreset(presetName: string): ConfigurationPreset | null {
    return this.presets.get(presetName) || null;
  }

  /**
   * Apply a preset to a scenario configuration
   * 
   * @param scenario - Base scenario configuration
   * @param presetName - Name of the preset to apply
   * @returns Scenario with preset applied
   */
  applyPreset(scenario: TestScenarioConfig, presetName: string): TestScenarioConfig {
    const preset = this.getPreset(presetName);
    if (!preset) {
      throw new Error(`Unknown configuration preset: ${presetName}`);
    }

    logger.debug('Applying configuration preset', {
      scenario_name: scenario.name,
      preset_name: presetName
    });

    // Merge preset configuration into scenario
    const updatedScenario = this.deepClone(scenario);
    
    if (preset.safetyConfig) {
      updatedScenario.safetyConfig = this.deepMerge(
        updatedScenario.safetyConfig || {},
        preset.safetyConfig
      );
    }

    if (preset.automationConfig) {
      updatedScenario.automationConfig = this.deepMerge(
        updatedScenario.automationConfig || {},
        preset.automationConfig
      );
    }

    // Add preset tags to scenario tags
    updatedScenario.tags = [
      ...(updatedScenario.tags || []),
      ...preset.tags,
      `preset:${presetName}`
    ];

    return updatedScenario;
  }

  /**
   * Register a custom category configuration
   * 
   * @param category - Category name
   * @param config - Configuration for the category
   */
  registerCategoryConfig(category: string, config: Partial<TestScenarioConfig>): void {
    this.categoryConfigs.set(category, config);
    
    logger.debug('Registered category configuration', {
      category,
      config_keys: Object.keys(config)
    });
  }

  /**
   * Register a custom preset
   * 
   * @param preset - Configuration preset to register
   */
  registerPreset(preset: ConfigurationPreset): void {
    this.presets.set(preset.name, preset);
    
    logger.debug('Registered configuration preset', {
      preset_name: preset.name,
      tags: preset.tags
    });
  }

  /**
   * Create global default configuration
   */
  private createGlobalDefaults(): Partial<TestScenarioConfig> {
    return {
      execution: {
        dryRun: false,
        maxEmails: 10,
        batchSize: 5,
        timeout: 30000
      },
      safetyConfig: {
        // Conservative defaults for all tests
        vipDomains: [],
        trustedDomains: [],
        whitelistDomains: [],
        criticalAttachmentTypes: [],
        legalDocumentTypes: [],
        financialDocumentTypes: [],
        contractDocumentTypes: [],
        activeThreadDays: 7,
        minThreadMessages: 3,
        recentReplyDays: 7,
        frequentContactThreshold: 10,
        importantSenderScore: 0.8,
        minInteractionHistory: 5,
        legalKeywords: [],
        complianceTerms: [],
        regulatoryKeywords: [],
        unreadRecentDays: 14,
        unreadImportanceBoost: 0.3,
        protectedLabels: [],
        criticalLabels: [],
        maxDeletionsPerHour: 100,
        maxDeletionsPerDay: 1000,
        bulkOperationThreshold: 50,
        largeEmailThreshold: 25 * 1024 * 1024, // 25MB
        unusualSizeMultiplier: 3.0,
        recentAccessDays: 7,
        recentForwardDays: 14,
        recentModificationDays: 30,
        minStalenessScore: 0.3,
        maxAccessScore: 0.5,
        importanceScoreThreshold: 6.0,
        enableSafetyMetrics: true,
        enableDetailedLogging: false
      },
      automationConfig: {
        continuousCleanup: {
          enabled: false,
          targetEmailsPerMinute: 1,
          maxConcurrentOperations: 1
        },
        eventTriggers: {
          storageThreshold: {
            enabled: false,
            warningThresholdPercent: 80,
            criticalThresholdPercent: 95
          },
          performanceThreshold: {
            enabled: false,
            queryTimeThresholdMs: 1000,
            cacheHitRateThreshold: 0.7
          }
        }
      },
      tags: ['global-defaults'],
      priority: 'medium'
    };
  }

  /**
   * Initialize predefined category configurations
   */
  private initializeCategoryConfigs(): void {
    // Permissive deletion configuration (for testing deletion scenarios)
    this.categoryConfigs.set('permissive', {
      safetyConfig: {
        // Very permissive safety settings for deletion testing
        vipDomains: ['test-vip-never-match.com'],
        trustedDomains: ['test-trusted-never-match.com'],
        whitelistDomains: ['test-whitelist-never-match.com'],
        criticalAttachmentTypes: ['.test-critical-never-match'],
        legalDocumentTypes: ['.test-legal-never-match'],
        financialDocumentTypes: ['.test-financial-never-match'],
        contractDocumentTypes: ['.test-contract-never-match'],
        activeThreadDays: 0,
        minThreadMessages: 1000,
        recentReplyDays: 0,
        frequentContactThreshold: 1000,
        importantSenderScore: 999,
        minInteractionHistory: 1000,
        legalKeywords: ['test-legal-keyword-never-match'],
        complianceTerms: ['test-compliance-term-never-match'],
        regulatoryKeywords: ['test-regulatory-keyword-never-match'],
        unreadRecentDays: 0,
        unreadImportanceBoost: 0.0,
        protectedLabels: ['TEST_IMPORTANT_NEVER_MATCH'],
        criticalLabels: ['TEST_CRITICAL_NEVER_MATCH'],
        maxDeletionsPerHour: 100000,
        maxDeletionsPerDay: 1000000,
        bulkOperationThreshold: 10000,
        largeEmailThreshold: 1000 * 1024 * 1024, // 1GB
        unusualSizeMultiplier: 100.0,
        recentAccessDays: 0,
        recentForwardDays: 0,
        recentModificationDays: 0,
        minStalenessScore: 0.0,
        maxAccessScore: 0.7,
        importanceScoreThreshold: 100.0,
        enableSafetyMetrics: true,
        enableDetailedLogging: false
      },
      tags: ['permissive', 'deletion-testing']
    });

    // Strict safety configuration (for safety mechanism testing)
    this.categoryConfigs.set('strict', {
      safetyConfig: {
        // Production-like safety settings
        vipDomains: [
          'board-of-directors.com',
          'executives.com',
          'ceo.com',
          'legal-counsel.com'
        ],
        trustedDomains: [
          'company.com',
          'organization.org',
          'trusted-partner.com',
          'bank.com',
          'government.gov'
        ],
        whitelistDomains: [
          'important.org',
          'critical-vendor.com',
          'key-client.com',
          'healthcare-provider.com'
        ],
        criticalAttachmentTypes: [
          '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
          '.contract', '.agreement', '.legal', '.invoice', '.receipt'
        ],
        legalDocumentTypes: [
          '.contract', '.agreement', '.nda', '.legal', '.court',
          '.lawsuit', '.settlement', '.compliance', '.audit'
        ],
        financialDocumentTypes: [
          '.invoice', '.receipt', '.statement', '.tax', '.financial',
          '.budget', '.expense', '.payment', '.bank', '.accounting'
        ],
        contractDocumentTypes: [
          '.contract', '.agreement', '.terms', '.conditions',
          '.proposal', '.quote', '.estimate', '.sow', '.msa'
        ],
        activeThreadDays: 30,
        minThreadMessages: 3,
        recentReplyDays: 7,
        frequentContactThreshold: 10,
        importantSenderScore: 0.8,
        minInteractionHistory: 5,
        legalKeywords: [
          'legal', 'lawsuit', 'litigation', 'compliance', 'audit',
          'regulation', 'policy', 'contract', 'agreement', 'confidential'
        ],
        complianceTerms: [
          'gdpr', 'hipaa', 'sox', 'pci', 'ferpa', 'ccpa', 'privacy',
          'data protection', 'security', 'breach', 'incident', 'report'
        ],
        regulatoryKeywords: [
          'sec', 'fda', 'epa', 'osha', 'ftc', 'cftc', 'finra',
          'regulatory', 'inspection', 'violation', 'penalty', 'fine'
        ],
        unreadRecentDays: 14,
        unreadImportanceBoost: 0.3,
        protectedLabels: [
          'IMPORTANT', 'STARRED', 'VIP', 'URGENT', 'PRIORITY',
          'LEGAL', 'CONFIDENTIAL', 'BOARD', 'EXECUTIVE'
        ],
        criticalLabels: [
          'LEGAL', 'CONFIDENTIAL', 'CLASSIFIED', 'TOP_SECRET',
          'PRIVILEGED', 'ATTORNEY_CLIENT', 'WORK_PRODUCT'
        ],
        maxDeletionsPerHour: 50,
        maxDeletionsPerDay: 200,
        bulkOperationThreshold: 25,
        largeEmailThreshold: 10 * 1024 * 1024, // 10MB
        unusualSizeMultiplier: 2.0,
        recentAccessDays: 14,
        recentForwardDays: 30,
        recentModificationDays: 60,
        minStalenessScore: 0.7,
        maxAccessScore: 0.3,
        importanceScoreThreshold: 4.0,
        enableSafetyMetrics: true,
        enableDetailedLogging: true
      },
      tags: ['strict', 'safety-testing', 'production-like']
    });

    // Edge case configuration (for boundary condition testing)
    this.categoryConfigs.set('edge_case', {
      execution: {
        maxEmails: 1,
        batchSize: 1,
        timeout: 60000
      },
      safetyConfig: {
        // Edge case safety settings
        maxDeletionsPerHour: 1,
        maxDeletionsPerDay: 5,
        bulkOperationThreshold: 1,
        largeEmailThreshold: 1024, // 1KB (very small)
        unusualSizeMultiplier: 1.1,
        minStalenessScore: 0.9,
        maxAccessScore: 0.1,
        importanceScoreThreshold: 1.0,
        enableDetailedLogging: true
      },
      tags: ['edge-case', 'boundary-testing', 'single-email']
    });

    // Performance testing configuration
    this.categoryConfigs.set('performance', {
      execution: {
        maxEmails: 1000,
        batchSize: 50,
        timeout: 120000
      },
      safetyConfig: {
        maxDeletionsPerHour: 10000,
        maxDeletionsPerDay: 100000,
        bulkOperationThreshold: 1000,
        enableDetailedLogging: false // Reduce overhead
      },
      automationConfig: {
        continuousCleanup: {
          enabled: true,
          targetEmailsPerMinute: 100,
          maxConcurrentOperations: 5
        }
      },
      tags: ['performance', 'high-volume', 'stress-testing']
    });
  }

  /**
   * Initialize predefined configuration presets
   */
  private initializePresets(): void {
    // Permissive deletion preset
    this.presets.set('PERMISSIVE_DELETION', {
      name: 'PERMISSIVE_DELETION',
      description: 'Very permissive configuration for testing deletion scenarios without safety interference',
      safetyConfig: {
        vipDomains: [],
        trustedDomains: [],
        whitelistDomains: [],
        criticalAttachmentTypes: [],
        legalKeywords: [],
        protectedLabels: [],
        recentAccessDays: 0,           // Disable recent email protection
        activeThreadDays: 0,           // Disable active thread protection
        importantSenderScore: 999,     // Extremely high threshold to bypass sender reputation protection
        minStalenessScore: 0.0,
        maxAccessScore: 0.7,           // Set below typical access scores to bypass staleness threshold protection
        importanceScoreThreshold: 100.0,
        enableDetailedLogging: false
      },
      tags: ['preset', 'permissive', 'deletion-focused']
    });

    // Strict safety preset
    this.presets.set('STRICT_SAFETY', {
      name: 'STRICT_SAFETY',
      description: 'Production-grade safety configuration for testing safety mechanisms',
      safetyConfig: {
        vipDomains: ['executives.com', 'board.com', 'legal.com'],
        trustedDomains: ['company.com', 'partner.com', 'bank.com'],
        protectedLabels: ['IMPORTANT', 'LEGAL', 'CONFIDENTIAL'],
        criticalLabels: ['TOP_SECRET', 'PRIVILEGED'],
        legalKeywords: ['legal', 'contract', 'confidential', 'lawsuit'],
        minStalenessScore: 0.8,
        maxAccessScore: 0.2,
        importanceScoreThreshold: 3.0,
        enableDetailedLogging: true
      },
      tags: ['preset', 'strict', 'safety-focused', 'production-like']
    });

    // Edge case testing preset
    this.presets.set('EDGE_CASE_TESTING', {
      name: 'EDGE_CASE_TESTING',
      description: 'Configuration for testing edge cases and boundary conditions',
      safetyConfig: {
        // Edge case specific limits (keep restrictive for boundary testing)
        maxDeletionsPerHour: 1,
        bulkOperationThreshold: 1,
        largeEmailThreshold: 5001,        // Just above largest edge case email (5000 bytes for age threshold test)
        unusualSizeMultiplier: 1.01,
        enableDetailedLogging: true,
        
        // Override restrictive category thresholds to allow edge case emails to be processed
        importanceScoreThreshold: 100.0,  // Allow high importance emails for edge case testing
        minStalenessScore: 0.0,           // Allow any staleness level
        maxAccessScore: 0.7,              // Set below edge case email access score (0.8) to allow processing
        importantSenderScore: 999         // Bypass sender reputation protection
      },
      automationConfig: {
        continuousCleanup: {
          enabled: false,
          targetEmailsPerMinute: 1,
          maxConcurrentOperations: 1
        }
      },
      tags: ['preset', 'edge-case', 'boundary-testing', 'minimal']
    });
  }

  /**
   * Initialize predefined configurations (kept for backward compatibility)
   */
  private initializePredefinedConfigs(): void {
    // This method is kept for any additional predefined configurations
    // that don't fit into categories or presets
  }

  /**
   * Deep merge two configuration objects
   */
  private deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = this.deepClone(target);

    for (const key in source) {
      if (source[key] !== undefined) {
        if (
          typeof source[key] === 'object' &&
          source[key] !== null &&
          !Array.isArray(source[key]) &&
          typeof result[key] === 'object' &&
          result[key] !== null &&
          !Array.isArray(result[key])
        ) {
          // Deep merge objects
          result[key] = this.deepMerge(result[key], source[key] as any);
        } else {
          // Direct assignment for primitives, arrays, and null values
          result[key] = source[key] as any;
        }
      }
    }

    return result;
  }

  /**
   * Deep clone an object
   */
  private deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime()) as any;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item)) as any;
    }

    const cloned = {} as T;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }

    return cloned;
  }

  /**
   * Validate resolved configuration
   */
  private validateConfiguration(config: TestScenarioConfig): void {
    const errors: string[] = [];

    // Validate required fields
    if (!config.name) {
      errors.push('Configuration must have a name');
    }

    if (!config.execution) {
      errors.push('Configuration must have execution settings');
    } else {
      if (config.execution.maxEmails !== undefined && config.execution.maxEmails < 1) {
        errors.push('Execution maxEmails must be at least 1');
      }
      if (config.execution.batchSize !== undefined && config.execution.batchSize < 1) {
        errors.push('Execution batchSize must be at least 1');
      }
      if (config.execution.timeout !== undefined && config.execution.timeout < 1000) {
        errors.push('Execution timeout must be at least 1000ms');
      }
    }

    if (!config.expected) {
      errors.push('Configuration must have expected results');
    }

    // Validate safety configuration ranges
    if (config.safetyConfig) {
      const safety = config.safetyConfig;
      
      if (safety.minStalenessScore !== undefined && 
          (safety.minStalenessScore < 0 || safety.minStalenessScore > 1)) {
        errors.push('Safety minStalenessScore must be between 0 and 1');
      }
      
      if (safety.maxAccessScore !== undefined && 
          (safety.maxAccessScore < 0 || safety.maxAccessScore > 1)) {
        errors.push('Safety maxAccessScore must be between 0 and 1');
      }
      
      if (safety.importanceScoreThreshold !== undefined && safety.importanceScoreThreshold < 0) {
        errors.push('Safety importanceScoreThreshold must be non-negative');
      }
    }

    if (errors.length > 0) {
      throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }
  }

  /**
   * Get all available category configurations
   */
  getAvailableCategories(): string[] {
    return Array.from(this.categoryConfigs.keys());
  }

  /**
   * Get all available presets
   */
  getAvailablePresets(): string[] {
    return Array.from(this.presets.keys());
  }

  /**
   * Get configuration statistics
   */
  getStats(): {
    categories: number;
    presets: number;
    globalConfigKeys: number;
  } {
    return {
      categories: this.categoryConfigs.size,
      presets: this.presets.size,
      globalConfigKeys: Object.keys(this.globalConfig).length
    };
  }
}