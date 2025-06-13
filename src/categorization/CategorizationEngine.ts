import { DatabaseManager } from '../database/DatabaseManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { EmailIndex, CategorizeOptions, EmailStatistics, PriorityCategory } from '../types/index.js';
import { logger } from '../utils/logger.js';
import {
  IImportanceAnalyzer,
  IDateSizeAnalyzer,
  ILabelClassifier,
  EmailAnalysisContext,
  CombinedAnalysisResult,
  AnalysisMetrics
} from './types.js';
import { AnalyzerFactory } from './factories/AnalyzerFactory.js';
import {
  CategorizationSystemConfig,
  CategorizationConfigManager,
  DEFAULT_CATEGORIZATION_CONFIG
} from './config/CategorizationConfig.js';

// Legacy interface for backward compatibility
interface PriorityRuleConfig {
  type: string;
  [key: string]: any;
}

interface LegacyCategorizationConfig {
  highPriorityRules: PriorityRuleConfig[];
  lowPriorityRules: PriorityRuleConfig[];
}

/**
 * Refactored CategorizationEngine using orchestrator pattern with modular analyzers.
 * Maintains backward compatibility while providing improved modularity and testability.
 */
export class CategorizationEngine {
  private databaseManager: DatabaseManager;
  private cacheManager: CacheManager;
  private configManager: CategorizationConfigManager;
  
  // Modular analyzers
  private importanceAnalyzer!: IImportanceAnalyzer;
  private dateSizeAnalyzer!: IDateSizeAnalyzer;
  private labelClassifier!: ILabelClassifier;
  
  // Performance tracking
  private metrics: AnalysisMetrics = {
    totalProcessingTime: 0,
    importanceAnalysisTime: 0,
    dateSizeAnalysisTime: 0,
    labelClassificationTime: 0,
    cacheHits: 0,
    cacheMisses: 0,
    rulesEvaluated: 0
  };

  constructor(
    databaseManager: DatabaseManager,
    cacheManager: CacheManager,
    config?: LegacyCategorizationConfig | CategorizationSystemConfig
  ) {
    this.databaseManager = databaseManager;
    this.cacheManager = cacheManager;
    
    // Handle legacy configuration or use new system config
    if (config && this.isLegacyConfig(config)) {
      // Convert legacy config to new format
      this.configManager = new CategorizationConfigManager(
        this.convertLegacyConfig(config)
      );
    } else {
      this.configManager = new CategorizationConfigManager(
        config as CategorizationSystemConfig
      );
    }

    // Initialize analyzers using factory
    this.initializeAnalyzers();
    
    logger.info('CategorizationEngine: Initialized with modular architecture', {
      configType: this.isLegacyConfig(config) ? 'legacy' : 'modern',
      highPriorityRulesCount: this.configManager.getConfig().analyzers.importance.rules.filter(r => r.weight > 0).length,
      lowPriorityRulesCount: this.configManager.getConfig().analyzers.importance.rules.filter(r => r.weight < 0).length
    });
  }

  /**
   * Initialize analyzers using the factory pattern
   */
  private initializeAnalyzers(): void {
    const factory = new AnalyzerFactory(this.databaseManager, this.cacheManager);
    const config = this.configManager.getConfig();
    
    this.importanceAnalyzer = factory.createImportanceAnalyzer(config.analyzers.importance);
    this.dateSizeAnalyzer = factory.createDateSizeAnalyzer(config.analyzers.dateSize);
    this.labelClassifier = factory.createLabelClassifier(config.analyzers.labelClassifier);
    
    logger.info('CategorizationEngine: Analyzers initialized');
  }

  /**
   * Type guard to check if config is legacy format
   */
  private isLegacyConfig(config: any): config is LegacyCategorizationConfig {
    return config &&
           typeof config === 'object' &&
           'highPriorityRules' in config &&
           'lowPriorityRules' in config;
  }

  /**
   * Convert legacy configuration to new system configuration
   */
  private convertLegacyConfig(legacyConfig: LegacyCategorizationConfig): Partial<CategorizationSystemConfig> {
    // This is a simplified conversion - in practice, you might want more sophisticated mapping
    logger.warn('CategorizationEngine: Converting legacy configuration format');
    
    return {
      analyzers: {
        importance: {
          ...DEFAULT_CATEGORIZATION_CONFIG.analyzers.importance,
          // You could map legacy rules here if needed
        },
        dateSize: {
          ...DEFAULT_CATEGORIZATION_CONFIG.analyzers.dateSize
        },
        labelClassifier: {
          ...DEFAULT_CATEGORIZATION_CONFIG.analyzers.labelClassifier
        }
      }
    };
  }

  /**
   * Main method to categorize emails based on configured rules and analyzers
   */
  async categorizeEmails(options: CategorizeOptions): Promise<{ processed: number, categories: any }> {
    logger.info('Starting email categorization', options);
    
    try {
      // Get all emails that need categorization
      const emails = await this.getEmailsForCategorization(options);
      
      let processed = 0;
      const categories = { high: 0, medium: 0, low: 0 };
      
      for (const email of emails) {
        const category = await this.determineCategory(email);
        email.category = category;
        
        // Update database
        await this.databaseManager.upsertEmailIndex(email);
        
        categories[category]++;
        processed++;
        
        // Log progress every 100 emails
        if (processed % 100 === 0) {
          logger.info(`Categorized ${processed} emails...`);
        }
      }
      
      // Clear cache after categorization
      this.cacheManager.flush();
      
      logger.info('Email categorization completed', { processed, categories });
      
      return { processed, categories };
    } catch (error) {
      logger.error('Error during categorization:', error);
      throw error;
    }
  }

  /**
   * Determines email category using orchestrated analysis from multiple analyzers
   */
  private async determineCategory(email: EmailIndex): Promise<PriorityCategory> {
    const startTime = Date.now();
    
    try {
      // Create analysis context
      const context = this.createAnalysisContext(email);
      
      // Orchestrate analysis across all analyzers
      const combinedResult = await this.orchestrateAnalysis(context);
      
      // Update metrics
      this.metrics.totalProcessingTime += Date.now() - startTime;
      
      logger.debug('CategorizationEngine: Category determined', {
        emailId: email.id,
        category: combinedResult.finalCategory,
        confidence: combinedResult.confidence,
        processingTime: combinedResult.processingTime
      });
      
      return combinedResult.finalCategory;
    } catch (error) {
      logger.error('CategorizationEngine: Error determining category', {
        emailId: email.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return PriorityCategory.MEDIUM; // Fallback category on error
    }
  }

  /**
   * Create analysis context from email data
   */
  private createAnalysisContext(email: EmailIndex): EmailAnalysisContext {
    const subject = email?.subject?.toLowerCase() || '';
    const sender = email?.sender?.toLowerCase() || '';
    const snippet = email?.snippet?.toLowerCase() || '';
    
    if (!email.subject) {
      logger.warn('CategorizationEngine: Email subject is missing', { emailId: email.id });
      throw new Error(`Email subject is missing for email ${email.id}`);
    }
    if (!email.sender) {
      logger.warn('CategorizationEngine: Email sender is missing', { emailId: email.id });
      throw new Error(`Email sender is missing for email ${email.id}`);
    }
    if (!email.snippet) {
      logger.warn('CategorizationEngine: Email snippet is missing', { emailId: email.id });
      throw new Error(`Email snippet is missing for email ${email.id}`);
    }

    return {
      email,
      subject,
      sender,
      snippet,
      labels: email.labels || [],
      date: email.date || new Date(),
      size: email.size || 0,
      hasAttachments: email.hasAttachments || false
    };
  }

  /**
   * Orchestrate analysis across all analyzers and combine results
   */
  private async orchestrateAnalysis(context: EmailAnalysisContext): Promise<CombinedAnalysisResult> {
    const startTime = Date.now();
    const config = this.configManager.getConfig();
    
    try {
      // Run analyzers in parallel if enabled, otherwise sequentially
      let importanceResult, dateSizeResult, labelClassification;
      
      if (config.orchestration.enableParallelProcessing) {
        // Parallel execution
        const [importance, dateSize, labels] = await Promise.all([
          this.runWithTimeout(
            () => this.importanceAnalyzer.analyzeImportance(context),
            config.orchestration.timeoutMs,
            'ImportanceAnalyzer'
          ),
          this.runWithTimeout(
            () => this.dateSizeAnalyzer.analyzeDateSize(context),
            config.orchestration.timeoutMs,
            'DateSizeAnalyzer'
          ),
          this.runWithTimeout(
            () => this.labelClassifier.classifyLabels(context.labels),
            config.orchestration.timeoutMs,
            'LabelClassifier'
          )
        ]);
        
        importanceResult = importance;
        dateSizeResult = dateSize;
        labelClassification = labels;
      } else {
        // Sequential execution
        const importanceStart = Date.now();
        importanceResult = await this.importanceAnalyzer.analyzeImportance(context);
        this.metrics.importanceAnalysisTime += Date.now() - importanceStart;
        
        const dateSizeStart = Date.now();
        dateSizeResult = await this.dateSizeAnalyzer.analyzeDateSize(context);
        this.metrics.dateSizeAnalysisTime += Date.now() - dateSizeStart;
        
        const labelStart = Date.now();
        labelClassification = await this.labelClassifier.classifyLabels(context.labels);
        this.metrics.labelClassificationTime += Date.now() - labelStart;
      }

      // Combine results to determine final category
      const finalCategory = this.combineAnalysisResults(
        importanceResult,
        dateSizeResult,
        labelClassification
      );

      const processingTime = Date.now() - startTime;
      
      return {
        importance: importanceResult,
        dateSize: dateSizeResult,
        labelClassification,
        finalCategory,
        confidence: this.calculateOverallConfidence(importanceResult, dateSizeResult, labelClassification),
        reasoning: this.generateReasoning(importanceResult, dateSizeResult, labelClassification),
        processingTime
      };
    } catch (error) {
      logger.error('CategorizationEngine: Analysis orchestration failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Run analyzer with timeout protection
   */
  private async runWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    analyzerName: string
  ): Promise<T> {
    logger.debug(`CategorizationEngine: Starting ${analyzerName} with timeout ${timeoutMs}ms`);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        logger.error(`CategorizationEngine: ${analyzerName} timed out after ${timeoutMs}ms`);
        reject(new Error(`${analyzerName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      operation()
        .then(result => {
          clearTimeout(timeout);
          logger.debug(`CategorizationEngine: ${analyzerName} completed successfully`);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeout);
          logger.error(`CategorizationEngine: ${analyzerName} failed with error`, { error: error.message });
          reject(error);
        });
    });
  }

  /**
   * Combine analysis results to determine final priority category
   */
  private combineAnalysisResults(
    importance: any,
    dateSize: any,
    labelClassification: any
  ): PriorityCategory {
    // Primary decision based on importance level
    if (importance.level === 'high') {
      return PriorityCategory.HIGH;
    }
    
    if (importance.level === 'low') {
      // Check if other factors might override low importance
      if (dateSize.ageCategory === 'recent' && labelClassification.category === 'important') {
        return PriorityCategory.MEDIUM;
      }
      return PriorityCategory.LOW;
    }
    
    // For medium importance, consider other factors
    if (importance.level === 'medium') {
      // Boost to high if recent and important labels
      if (dateSize.ageCategory === 'recent' && labelClassification.category === 'important') {
        return PriorityCategory.HIGH;
      }
      
      // Reduce to low if promotional or spam
      if (labelClassification.spamScore > 0.7 || labelClassification.promotionalScore > 0.8) {
        return PriorityCategory.LOW;
      }
      
      return PriorityCategory.MEDIUM;
    }
    
    // Default fallback
    return PriorityCategory.MEDIUM;
  }

  /**
   * Calculate overall confidence from individual analyzer confidences
   */
  private calculateOverallConfidence(importance: any, dateSize: any, labelClassification: any): number {
    // Weight importance analysis more heavily
    const importanceWeight = 0.6;
    const dateSizeWeight = 0.2;
    const labelWeight = 0.2;
    
    const importanceConfidence = importance.confidence || 0.5;
    const dateSizeConfidence = 0.8; // DateSize analysis is generally reliable
    const labelConfidence = labelClassification.indicators ?
      Math.min(1.0, Object.values(labelClassification.indicators).flat().length * 0.2) : 0.5;
    
    return (
      importanceConfidence * importanceWeight +
      dateSizeConfidence * dateSizeWeight +
      labelConfidence * labelWeight
    );
  }

  /**
   * Generate human-readable reasoning for the categorization decision
   */
  private generateReasoning(importance: any, dateSize: any, labelClassification: any): string[] {
    const reasoning: string[] = [];
    
    // Importance reasoning
    if (importance.matchedRules && importance.matchedRules.length > 0) {
      reasoning.push(`Importance: ${importance.level} (matched rules: ${importance.matchedRules.join(', ')})`);
    } else {
      reasoning.push(`Importance: ${importance.level} (score: ${importance.score})`);
    }
    if(dateSize.ageCategory && dateSize.sizeCategory) {
    // Date/Size reasoning
    reasoning.push(`Age: ${dateSize.ageCategory}, Size: ${dateSize.sizeCategory}`);
    }
    
    // Label reasoning
    if (labelClassification.category !== 'primary') {
      reasoning.push(`Gmail category: ${labelClassification.category}`);
    }
    
    if (labelClassification.spamScore > 0.5) {
      reasoning.push(`Spam indicators detected (score: ${labelClassification.spamScore.toFixed(2)})`);
    }
    
    if (labelClassification.promotionalScore > 0.5) {
      reasoning.push(`Promotional content detected (score: ${labelClassification.promotionalScore.toFixed(2)})`);
    }
    
    return reasoning;
  }

  private async getEmailsForCategorization(options: CategorizeOptions): Promise<EmailIndex[]> {
    if (options.forceRefresh) {
      // Get all emails
      return await this.databaseManager.searchEmails({
        year: options.year
      });
    } else {
      // Get only uncategorized emails (category IS NULL)
      return await this.databaseManager.searchEmails({
        year: options.year,
        category: null
      });
    }
  }

  async getStatistics(options: { groupBy: string, includeArchived: boolean }): Promise<EmailStatistics> {
    const cacheKey = CacheManager.categoryStatsKey();
    const cached = this.cacheManager.get<EmailStatistics>(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    const stats = await this.databaseManager.getEmailStatistics(options.includeArchived);
    
    // Transform database stats to EmailStatistics format
    const result: EmailStatistics = {
      categories: {
        high: 0,
        medium: 0,
        low: 0,
        total: 0
      },
      years: {},
      sizes: {
        small: stats.sizes.small || 0,
        medium: stats.sizes.medium || 0,
        large: stats.sizes.large || 0,
        totalSize: stats.sizes.total_size || 0
      },
      archived: {
        count: stats.archived.count || 0,
        size: stats.archived.total_size || 0
      },
      total: {
        count: 0,
        size: 0
      }
    };
    
    // Process category stats
    for (const cat of stats.categories) {
      if (cat.category in result.categories) {
        result.categories[cat.category as keyof typeof result.categories] = cat.count;
        result.categories.total += cat.count;
      }
    }
    
    // Process year stats
    for (const year of stats.years) {
      result.years[year.year] = {
        count: year.count,
        size: year.total_size
      };
      result.total.count += year.count;
      result.total.size += year.total_size;
    }
    
    // Cache the result
    this.cacheManager.set(cacheKey, result, 300); // Cache for 5 minutes
    
    return result;
  }

  async updateImportantDomains(domains: string[]): Promise<void> {
    // Legacy method - now delegates to importance analyzer configuration
    logger.warn('CategorizationEngine: updateImportantDomains is deprecated');
    logger.info('Updated important domains', { count: domains.length });
    
    // You could update the analyzer configuration here if needed
    // For now, just log the action for backward compatibility
  }

  async analyzeEmailPatterns(): Promise<any> {
    // Advanced analysis to identify patterns
    // - Most frequent senders
    // - Email volume by time of day
    // - Thread participation
    // - Response times
    // This is a placeholder for future enhancement
    
    logger.info('Analyzing email patterns...');
    
    const patterns = {
      frequentSenders: [],
      peakHours: [],
      averageThreadLength: 0,
      responseTime: 0
    };
    
    return patterns;
  }

  /**
   * Get current analyzer metrics for monitoring and debugging
   */
  public getAnalysisMetrics(): AnalysisMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset analysis metrics
   */
  public resetMetrics(): void {
    this.metrics = {
      totalProcessingTime: 0,
      importanceAnalysisTime: 0,
      dateSizeAnalysisTime: 0,
      labelClassificationTime: 0,
      cacheHits: 0,
      cacheMisses: 0,
      rulesEvaluated: 0
    };
    logger.info('CategorizationEngine: Metrics reset');
  }

  /**
   * Get current configuration
   */
  public getConfiguration(): CategorizationSystemConfig {
    return this.configManager.getConfig();
  }

  /**
   * Update configuration
   */
  public updateConfiguration(updates: Partial<CategorizationSystemConfig>): void {
    this.configManager.updateConfig(updates);
    
    // Reinitialize analyzers with new configuration
    this.initializeAnalyzers();
    
    logger.info('CategorizationEngine: Configuration updated and analyzers reinitialized');
  }

  /**
   * Validate current configuration
   */
  public validateConfiguration(): { valid: boolean; errors: string[] } {
    return this.configManager.validateConfig();
  }

  /**
   * Get analyzer instances for advanced usage (use with caution)
   */
  public getAnalyzers(): {
    importanceAnalyzer: IImportanceAnalyzer;
    dateSizeAnalyzer: IDateSizeAnalyzer;
    labelClassifier: ILabelClassifier;
  } {
    return {
      importanceAnalyzer: this.importanceAnalyzer,
      dateSizeAnalyzer: this.dateSizeAnalyzer,
      labelClassifier: this.labelClassifier
    };
  }

  /**
   * Perform a single email analysis without database updates (useful for testing)
   */
  public async analyzeEmail(email: EmailIndex): Promise<CombinedAnalysisResult> {
    const context = this.createAnalysisContext(email);
    return this.orchestrateAnalysis(context);
  }
}