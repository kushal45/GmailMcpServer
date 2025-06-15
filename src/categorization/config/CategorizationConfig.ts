import { ImportanceAnalyzerConfig } from '../interfaces/IImportanceAnalyzer.js';
import { DateSizeAnalyzerConfig } from '../interfaces/IDateSizeAnalyzer.js';
import { LabelClassifierConfig } from '../interfaces/ILabelClassifier.js';
import { Labels } from '../types.js';
import cloneDeep from 'lodash/cloneDeep.js';

/**
 * Centralized configuration for the categorization system
 */
export interface CategorizationSystemConfig {
  analyzers: {
    importance: ImportanceAnalyzerConfig;
    dateSize: DateSizeAnalyzerConfig;
    labelClassifier: LabelClassifierConfig;
  };
  orchestration: {
    enableParallelProcessing: boolean;
    batchSize: number;
    timeoutMs: number;
    retryAttempts: number;
  };
  caching: {
    globalEnabled: boolean;
    defaultTtl: number;
    maxCacheSize: number;
  };
  performance: {
    enableProfiling: boolean;
    logSlowOperations: boolean;
    slowOperationThresholdMs: number;
  };
}

/**
 * Default configuration for the categorization system
 */
export const DEFAULT_CATEGORIZATION_CONFIG: CategorizationSystemConfig = {
  analyzers: {
    importance: {
      rules: [
        // High priority rules
        {
          id: 'urgent-keywords',
          name: 'Urgent Keywords',
          type: 'keyword',
          priority: 100,
          weight: 15,
          keywords: [
            'urgent', 'asap', 'emergency', 'critical', 'immediate',
            'action required', 'deadline', 'time sensitive'
          ]
        },
        {
          id: 'important-keywords',
          name: 'Important Keywords',
          type: 'keyword',
          priority: 90,
          weight: 10,
          keywords: [
            'important', 'priority', 'attention', 'review required',
            'approval needed', 'decision required'
          ]
        },
        {
          id: 'vip-domains',
          name: 'VIP Domains',
          type: 'domain',
          priority: 95,
          weight: 12,
          domains: [
            'company.com', 'client.com', 'partner.com',
            'executive.com', 'board.com'
          ]
        },
        {
          id: 'important-labels',
          name: 'Important Labels',
          type: 'label',
          priority: 85,
          weight: 8,
          labels: [Labels.IMPORTANT, Labels.AUTOMATED]
        },
        // Medium priority rules
        {
          id: 'meeting-keywords',
          name: 'Meeting Keywords',
          type: 'keyword',
          priority: 70,
          weight: 5,
          keywords: [
            'meeting', 'conference', 'call', 'appointment',
            'schedule', 'calendar', 'invite'
          ]
        },
        // Low priority rules
        {
          id: 'newsletter-keywords',
          name: 'Newsletter Keywords',
          type: 'keyword',
          priority: 20,
          weight: -8,
          keywords: [
            'newsletter', 'unsubscribe', 'weekly digest',
            'monthly update', 'subscription'
          ]
        },
        {
          id: 'promotional-keywords',
          name: 'Promotional Keywords',
          type: 'keyword',
          priority: 15,
          weight: -10,
          keywords: [
            'sale', 'discount', 'offer', 'deal', 'promotion',
            'limited time', 'special offer', 'save money'
          ]
        },
        {
          id: 'automated-keywords',
          name: 'Automated Keywords',
          type: 'keyword',
          priority: 10,
          weight: -6,
          keywords: [
            'automated', 'notification', 'alert', 'reminder',
            'do not reply', 'system generated'
          ]
        },
        {
          id: 'no-reply-senders',
          name: 'No Reply Senders',
          type: 'noReply',
          priority: 5,
          weight: -5
        },
        {
          id: 'spam-labels',
          name: 'Spam Labels',
          type: 'label',
          priority: 1,
          weight: -15,
          labels: [Labels.SPAM, Labels.PROMOTIONAL]
        },
        {
          id: 'promotional-labels',
          name: 'Promotional Labels',
          type: 'label',
          priority: 2,
          weight: -12,
          labels: [
            Labels.CATEGORY_PROMOTIONS,
            Labels.CATEGORY_SOCIAL,
            Labels.SALE,
            Labels.OFFER,
            Labels.DISCOUNT,
            Labels.DEAL
          ]
        },
        {
          id: 'large-attachments',
          name: 'Large Attachments',
          type: 'largeAttachment',
          priority: 3,
          weight: -3,
          minSize: 5242880 // 5MB
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
    },
    dateSize: {
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
    },
    labelClassifier: {
      labelMappings: {
        gmailToCategory: {
          'important': 'important',
          'starred': 'important',
          'priority': 'important',
          'spam': 'spam',
          'junk': 'spam',
          'trash': 'spam',
          'promotions': 'promotions',
          'promotional': 'promotions',
          'deals': 'promotions',
          'offers': 'promotions',
          'social': 'social',
          'facebook': 'social',
          'twitter': 'social',
          'linkedin': 'social',
          'updates': 'updates',
          'notifications': 'updates',
          'alerts': 'updates',
          'forums': 'forums',
          'groups': 'forums',
          'mailing-list': 'forums',
          'primary': 'primary',
          'inbox': 'primary'
        },
        spamLabels: [
          Labels.SPAM,
          'junk',
          'phishing',
          'malware',
          'suspicious',
          'fraud',
          'scam',
          'virus'
        ],
        promotionalLabels: [
          Labels.PROMOTIONAL,
          Labels.CATEGORY_PROMOTIONS,
          Labels.SALE,
          Labels.OFFER,
          Labels.DISCOUNT,
          Labels.DEAL,
          'marketing',
          'advertisement',
          'promo',
          'coupon',
          'shopping'
        ],
        socialLabels: [
          Labels.CATEGORY_SOCIAL,
          'facebook',
          'twitter',
          'linkedin',
          'instagram',
          'snapchat',
          'tiktok',
          'social',
          'social-media',
          'friend',
          'follow'
        ]
      },
      scoring: {
        spamThreshold: 0.8,
        promotionalThreshold: 0.6,
        socialThreshold: 0.5
      },
      caching: {
        enabled: true,
        ttl: 1800 // 30 minutes
      }
    }
  },
  orchestration: {
    enableParallelProcessing: true,
    batchSize: 50,
    timeoutMs: 30000, // 30 seconds
    retryAttempts: 3
  },
  caching: {
    globalEnabled: true,
    defaultTtl: 600, // 10 minutes
    maxCacheSize: 1000
  },
  performance: {
    enableProfiling: false,
    logSlowOperations: true,
    slowOperationThresholdMs: 1000 // 1 second
  }
};

/**
 * Configuration manager for the categorization system
 */
export class CategorizationConfigManager {
  private config: CategorizationSystemConfig;

  constructor(config?: Partial<CategorizationSystemConfig>) {
    this.config = this.mergeConfigs(DEFAULT_CATEGORIZATION_CONFIG, config || {});
  }

  /**
   * Get the complete configuration
   */
  getConfig(): CategorizationSystemConfig {
    return cloneDeep(this.config);
  }

  /**
   * Get analyzer-specific configuration
   */
  getAnalyzerConfig<T extends keyof CategorizationSystemConfig['analyzers']>(
    analyzerType: T
  ): CategorizationSystemConfig['analyzers'][T] {
    return { ...this.config.analyzers[analyzerType] };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<CategorizationSystemConfig>): void {
    this.config = this.mergeConfigs(this.config, updates);
  }

  /**
   * Update analyzer-specific configuration
   */
  updateAnalyzerConfig<T extends keyof CategorizationSystemConfig['analyzers']>(
    analyzerType: T,
    updates: Partial<CategorizationSystemConfig['analyzers'][T]>
  ): void {
    this.config.analyzers[analyzerType] = {
      ...this.config.analyzers[analyzerType],
      ...updates
    } as CategorizationSystemConfig['analyzers'][T];
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_CATEGORIZATION_CONFIG };
  }

  /**
   * Validate configuration
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate importance analyzer config
    const importanceConfig = this.config.analyzers.importance;
    if (!importanceConfig.rules || importanceConfig.rules.length === 0) {
      errors.push('ImportanceAnalyzer must have at least one rule');
    }

    if (importanceConfig.scoring.highThreshold <= importanceConfig.scoring.lowThreshold) {
      errors.push('ImportanceAnalyzer highThreshold must be greater than lowThreshold');
    }

    // Validate date/size analyzer config
    const dateSizeConfig = this.config.analyzers.dateSize;
    if (dateSizeConfig.sizeThresholds.small >= dateSizeConfig.sizeThresholds.medium ||
        dateSizeConfig.sizeThresholds.medium >= dateSizeConfig.sizeThresholds.large) {
      errors.push('DateSizeAnalyzer size thresholds must be in ascending order');
    }

    if (dateSizeConfig.ageCategories.recent >= dateSizeConfig.ageCategories.moderate ||
        dateSizeConfig.ageCategories.moderate >= dateSizeConfig.ageCategories.old) {
      errors.push('DateSizeAnalyzer age categories must be in ascending order');
    }

    // Validate orchestration config
    if (this.config.orchestration.batchSize <= 0) {
      errors.push('Orchestration batchSize must be greater than 0');
    }

    if (this.config.orchestration.timeoutMs <= 0) {
      errors.push('Orchestration timeoutMs must be greater than 0');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Deep merge two configuration objects
   */
  private mergeConfigs(
    base: CategorizationSystemConfig,
    override: Partial<CategorizationSystemConfig>
  ): CategorizationSystemConfig {
    const result = { ...base };

    if (override.analyzers) {
      result.analyzers = {
        ...result.analyzers,
        ...override.analyzers
      };
    }

    if (override.orchestration) {
      result.orchestration = {
        ...result.orchestration,
        ...override.orchestration
      };
    }

    if (override.caching) {
      result.caching = {
        ...result.caching,
        ...override.caching
      };
    }

    if (override.performance) {
      result.performance = {
        ...result.performance,
        ...override.performance
      };
    }

    return result;
  }
}