import { IImportanceAnalyzer, ImportanceAnalyzerConfig } from '../interfaces/IImportanceAnalyzer.js';
import { IDateSizeAnalyzer, DateSizeAnalyzerConfig } from '../interfaces/IDateSizeAnalyzer.js';
import { ILabelClassifier, LabelClassifierConfig } from '../interfaces/ILabelClassifier.js';
import { ImportanceAnalyzer } from '../analyzers/ImportanceAnalyzer.js';
import { DateSizeAnalyzer } from '../analyzers/DateSizeAnalyzer.js';
import { LabelClassifier } from '../analyzers/LabelClassifier.js';
import { DatabaseManager } from '../../database/DatabaseManager.js';
import { CacheManager } from '../../cache/CacheManager.js';
import { logger } from '../../utils/logger.js';
import { Labels } from '../types.js';

/**
 * Factory class for creating analyzer instances with proper dependency injection
 */
export class AnalyzerFactory {
  private databaseManager?: DatabaseManager;
  private cacheManager?: CacheManager;

  constructor(databaseManager?: DatabaseManager, cacheManager?: CacheManager) {
    this.databaseManager = databaseManager;
    this.cacheManager = cacheManager;
  }

  /**
   * Creates an ImportanceAnalyzer with default or provided configuration
   */
  createImportanceAnalyzer(config?: ImportanceAnalyzerConfig): IImportanceAnalyzer {
    const defaultConfig: ImportanceAnalyzerConfig = {
      rules: [
        // High priority rules
        {
          id: 'high-priority-keywords',
          name: 'High Priority Keywords',
          type: 'keyword',
          priority: 100,
          weight: 10,
          keywords: [
            'urgent', 'asap', 'important', 'critical', 'deadline',
            'action required', 'immediate', 'priority', 'emergency'
          ]
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
          labels: [Labels.IMPORTANT, Labels.AUTOMATED]
        },
        // Low priority rules
        {
          id: 'low-priority-keywords',
          name: 'Low Priority Keywords',
          type: 'keyword',
          priority: 20,
          weight: -5,
          keywords: [
            'newsletter', 'unsubscribe', 'promotional', 'sale',
            'deal', 'offer', 'discount', 'no-reply', 'noreply',
            'automated', 'notification'
          ]
        },
        {
          id: 'no-reply-senders',
          name: 'No Reply Senders',
          type: 'noReply',
          priority: 15,
          weight: -3
        },
        {
          id: 'promotional-labels',
          name: 'Promotional Labels',
          type: 'label',
          priority: 10,
          weight: -4,
          labels: [
            Labels.PROMOTIONAL, 
            Labels.SPAM, 
            Labels.CATEGORY_PROMOTIONS, 
            Labels.CATEGORY_SOCIAL
          ]
        },
        {
          id: 'large-attachments',
          name: 'Large Attachments',
          type: 'largeAttachment',
          priority: 5,
          weight: -2,
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

    const finalConfig = config || defaultConfig;
    
    logger.debug('AnalyzerFactory: Creating ImportanceAnalyzer', { 
      rulesCount: finalConfig.rules.length 
    });

    return new ImportanceAnalyzer(finalConfig, this.cacheManager, this.databaseManager);
  }

  /**
   * Creates a DateSizeAnalyzer with default or provided configuration
   */
  createDateSizeAnalyzer(config?: DateSizeAnalyzerConfig): IDateSizeAnalyzer {
    const defaultConfig: DateSizeAnalyzerConfig = {
      sizeThresholds: {
        small: 102400,    // 100KB
        medium: 1048576,  // 1MB
        large: 10485760   // 10MB
      },
      ageCategories: {
        recent: 7,    // 7 days
        moderate: 30, // 30 days
        old: 365      // 1 year
      },
      scoring: {
        recencyWeight: 0.6,
        sizeWeight: 0.4
      },
      caching: {
        enabled: true,
        ttl: 3600 // 1 hour
      }
    };

    const finalConfig = config || defaultConfig;
    
    logger.debug('AnalyzerFactory: Creating DateSizeAnalyzer', { 
      sizeThresholds: finalConfig.sizeThresholds,
      ageCategories: finalConfig.ageCategories
    });

    return new DateSizeAnalyzer(finalConfig, this.cacheManager);
  }

  /**
   * Creates a LabelClassifier with default or provided configuration
   */
  createLabelClassifier(config?: LabelClassifierConfig): ILabelClassifier {
    const defaultConfig: LabelClassifierConfig = {
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
          'social',
          'notification'
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

    const finalConfig = config || defaultConfig;
    
    logger.debug('AnalyzerFactory: Creating LabelClassifier', { 
      spamLabelsCount: finalConfig.labelMappings.spamLabels.length,
      promotionalLabelsCount: finalConfig.labelMappings.promotionalLabels.length,
      socialLabelsCount: finalConfig.labelMappings.socialLabels.length
    });

    return new LabelClassifier(finalConfig, this.cacheManager);
  }

  /**
   * Creates all analyzers with default configurations
   */
  createAllAnalyzers(configs?: {
    importance?: ImportanceAnalyzerConfig;
    dateSize?: DateSizeAnalyzerConfig;
    labelClassifier?: LabelClassifierConfig;
  }): {
    importanceAnalyzer: IImportanceAnalyzer;
    dateSizeAnalyzer: IDateSizeAnalyzer;
    labelClassifier: ILabelClassifier;
  } {
    logger.debug('AnalyzerFactory: Creating all analyzers');

    return {
      importanceAnalyzer: this.createImportanceAnalyzer(configs?.importance),
      dateSizeAnalyzer: this.createDateSizeAnalyzer(configs?.dateSize),
      labelClassifier: this.createLabelClassifier(configs?.labelClassifier)
    };
  }

  /**
   * Updates the database manager for all future analyzer instances
   */
  setDatabaseManager(databaseManager: DatabaseManager): void {
    this.databaseManager = databaseManager;
    logger.debug('AnalyzerFactory: Database manager updated');
  }

  /**
   * Updates the cache manager for all future analyzer instances
   */
  setCacheManager(cacheManager: CacheManager): void {
    this.cacheManager = cacheManager;
    logger.debug('AnalyzerFactory: Cache manager updated');
  }
}