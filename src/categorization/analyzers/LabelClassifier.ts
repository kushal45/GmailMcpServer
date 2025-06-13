import { 
  ILabelClassifier, 
  LabelClassification, 
  GmailCategory, 
  SpamScore,
  LabelClassifierConfig 
} from '../interfaces/ILabelClassifier.js';
import { EmailAnalysisContext } from '../interfaces/IImportanceAnalyzer.js';
import { AnalysisContext, AnalysisResult, AnalyzerConfig } from '../interfaces/IAnalyzer.js';
import { CacheManager } from '../../cache/CacheManager.js';
import { logger } from '../../utils/logger.js';
import { Labels } from '../types.js';

/**
 * LabelClassifier implementation that categorizes emails based on
 * their Gmail labels and detects spam/promotional indicators.
 */
export class LabelClassifier implements ILabelClassifier {
  private config: LabelClassifierConfig;
  private cacheManager?: CacheManager;

  constructor(config: LabelClassifierConfig, cacheManager?: CacheManager) {
    this.config = config;
    this.cacheManager = cacheManager;
  }

  /**
   * Classifies email labels into categories
   */
  async classifyLabels(labels: string[]): Promise<LabelClassification> {
    const cacheKey = this.generateCacheKey(labels);
    
    // Check cache first if enabled
    if (this.config.caching.enabled && this.cacheManager) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        logger.debug('LabelClassifier: Cache hit', { cacheKey });
        return cached;
      }
    }

    // Perform classification
    const category = this.categorizeByGmailLabels(labels);
    const spamScore = this.calculateSpamScore(labels);
    const promotionalScore = this.calculatePromotionalScore(labels);
    const socialScore = this.calculateSocialScore(labels);

    const result: LabelClassification = {
      category,
      spamScore,
      promotionalScore,
      socialScore,
      indicators: {
        spam: this.getSpamIndicators(labels),
        promotional: this.getPromotionalIndicators(labels),
        social: this.getSocialIndicators(labels)
      }
    };

    // Cache result if enabled
    if (this.config.caching.enabled && this.cacheManager) {
      this.cacheResult(cacheKey, result);
    }

    logger.debug('LabelClassifier: Classification complete', { 
      category, 
      spamScore, 
      promotionalScore, 
      socialScore 
    });

    return result;
  }

  /**
   * Base analyze method implementation
   */
  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    if (!this.isEmailAnalysisContext(context)) {
      throw new Error('LabelClassifier requires EmailAnalysisContext');
    }
    return this.classifyLabels(context.labels);
  }

  /**
   * Configure the analyzer
   */
  configure(config: AnalyzerConfig): void {
    if (this.isLabelClassifierConfig(config)) {
      this.config = config;
    } else {
      throw new Error('LabelClassifier requires LabelClassifierConfig');
    }
  }

  /**
   * Detects spam indicators in labels
   */
  detectSpamIndicators(labels: string[]): SpamScore {
    const spamLabels = this.config.labelMappings.spamLabels;
    const matchedIndicators: string[] = [];
    const processedLabels = new Set<string>(); // Track processed labels to prevent double-counting
    let totalScore = 0;

    // Check for explicit spam/junk labels first (higher weight)
    const explicitSpamLabels = ['spam', 'junk', 'trash'];
    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      if (explicitSpamLabels.some(spam => normalizedLabel.includes(spam))) {
        matchedIndicators.push(label);
        processedLabels.add(normalizedLabel); // Mark as processed
        totalScore += 0.7; // Explicit spam labels get higher score
      }
    }

    // Check for configured spam labels - only if not already processed
    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      if (!processedLabels.has(normalizedLabel)) {
        for (const spamLabel of spamLabels) {
          if (normalizedLabel.includes(spamLabel.toLowerCase())) {
            matchedIndicators.push(spamLabel);
            processedLabels.add(normalizedLabel); // Mark as processed
            totalScore += 0.3; // Each spam indicator adds 0.3 to score
            break; // Only count once per label
          }
        }
      }
    }

    const finalScore = Math.min(1.0, totalScore);
    const confidence = matchedIndicators.length > 0 ?
      Math.min(1.0, matchedIndicators.length * 0.4) : 0;

    return {
      score: finalScore,
      indicators: matchedIndicators,
      confidence
    };
  }

  /**
   * Categorizes email based on Gmail labels
   */
  categorizeByGmailLabels(labels: string[]): GmailCategory {
    const labelMappings = this.config.labelMappings.gmailToCategory;
    
    // Check for explicit category mappings first
    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      for (const [gmailLabel, category] of Object.entries(labelMappings)) {
        if (normalizedLabel.includes(gmailLabel.toLowerCase())) {
          return category;
        }
      }
    }

    // Check for common Gmail categories
    const categoryChecks = [
      { labels: ['important', 'starred'], category: 'important' as GmailCategory },
      { labels: ['spam', 'junk'], category: 'spam' as GmailCategory },
      { labels: ['promotions', 'promotional', 'deals', 'offers'], category: 'promotions' as GmailCategory },
      { labels: ['social', 'facebook', 'twitter', 'linkedin'], category: 'social' as GmailCategory },
      { labels: ['updates', 'notifications', 'alerts'], category: 'updates' as GmailCategory },
      { labels: ['forums', 'groups', 'mailing'], category: 'forums' as GmailCategory }
    ];

    for (const check of categoryChecks) {
      for (const label of labels) {
        const normalizedLabel = label.toLowerCase();
        if (check.labels.some(checkLabel => normalizedLabel.includes(checkLabel))) {
          return check.category;
        }
      }
    }

    // Default to primary if no specific category found
    return 'primary';
  }

  /**
   * Calculate spam score based on labels
   */
  private calculateSpamScore(labels: string[]): number {
    const spamResult = this.detectSpamIndicators(labels);
    return spamResult.score;
  }

  /**
   * Calculate promotional score based on labels
   */
  private calculatePromotionalScore(labels: string[]): number {
    const promotionalLabels = this.config.labelMappings.promotionalLabels;
    let score = 0;

    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      for (const promoLabel of promotionalLabels) {
        if (normalizedLabel.includes(promoLabel.toLowerCase())) {
          score += 0.25; // Each promotional indicator adds 0.25
        }
      }
    }

    // Check for explicit promotional categories
    const explicitPromoLabels = [
      Labels.PROMOTIONAL, 
      Labels.CATEGORY_PROMOTIONS,
      'deals', 
      'offers', 
      'sale', 
      'discount'
    ];
    
    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      if (explicitPromoLabels.some(promo => normalizedLabel.includes(promo))) {
        score += 0.5; // Explicit promotional labels get higher score
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate social score based on labels
   */
  private calculateSocialScore(labels: string[]): number {
    const socialLabels = this.config.labelMappings.socialLabels;
    let score = 0;

    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      for (const socialLabel of socialLabels) {
        if (normalizedLabel.includes(socialLabel.toLowerCase())) {
          score += 0.3; // Each social indicator adds 0.3
        }
      }
    }

    // Check for explicit social categories
    const explicitSocialLabels = [
      Labels.CATEGORY_SOCIAL,
      'facebook', 
      'twitter', 
      'linkedin', 
      'instagram',
      'social'
    ];
    
    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      if (explicitSocialLabels.some(social => normalizedLabel.includes(social))) {
        score += 0.4; // Explicit social labels get higher score
      }
    }

    return Math.min(1.0, score);
  }

  /**
   * Get spam indicators from labels
   */
  private getSpamIndicators(labels: string[]): string[] {
    const spamLabels = this.config.labelMappings.spamLabels;
    const indicators: string[] = [];

    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      for (const spamLabel of spamLabels) {
        if (normalizedLabel.includes(spamLabel.toLowerCase())) {
          indicators.push(label);
        }
      }
    }

    return Array.from(new Set(indicators)); // Remove duplicates
  }

  /**
   * Get promotional indicators from labels
   */
  private getPromotionalIndicators(labels: string[]): string[] {
    const promotionalLabels = this.config.labelMappings.promotionalLabels;
    const indicators: string[] = [];

    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      for (const promoLabel of promotionalLabels) {
        if (normalizedLabel.includes(promoLabel.toLowerCase())) {
          indicators.push(label);
        }
      }
    }

    return Array.from(new Set(indicators)); // Remove duplicates
  }

  /**
   * Get social indicators from labels
   */
  private getSocialIndicators(labels: string[]): string[] {
    const socialLabels = this.config.labelMappings.socialLabels;
    const indicators: string[] = [];

    for (const label of labels) {
      const normalizedLabel = label.toLowerCase();
      for (const socialLabel of socialLabels) {
        if (normalizedLabel.includes(socialLabel.toLowerCase())) {
          indicators.push(label);
        }
      }
    }

    return Array.from(new Set(indicators)); // Remove duplicates
  }

  /**
   * Generate cache key for labels
   */
  private generateCacheKey(labels: string[]): string {
    const sortedLabels = [...labels].sort();
    const labelsStr = sortedLabels.join(',');
    return `labels:${Buffer.from(labelsStr).toString('base64')}`;
  }

  /**
   * Get cached result
   */
  private getCachedResult(cacheKey: string): LabelClassification | null {
    if (!this.cacheManager) return null;
    
    try {
      return this.cacheManager.get<LabelClassification>(cacheKey);
    } catch (error) {
      logger.error('LabelClassifier: Cache retrieval failed', { 
        cacheKey, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Cache analysis result
   */
  private cacheResult(cacheKey: string, result: LabelClassification): void {
    if (!this.cacheManager) return;
    
    try {
      this.cacheManager.set(cacheKey, result, this.config.caching.ttl);
    } catch (error) {
      logger.error('LabelClassifier: Cache storage failed', { 
        cacheKey, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Type guard for EmailAnalysisContext
   */
  private isEmailAnalysisContext(context: AnalysisContext): context is EmailAnalysisContext {
    return (
      typeof context === 'object' &&
      context !== null &&
      'labels' in context &&
      Array.isArray(context.labels)
    );
  }

  /**
   * Type guard for LabelClassifierConfig
   */
  private isLabelClassifierConfig(config: AnalyzerConfig): config is LabelClassifierConfig {
    return (
      typeof config === 'object' &&
      config !== null &&
      'labelMappings' in config &&
      'scoring' in config &&
      'caching' in config
    );
  }
}