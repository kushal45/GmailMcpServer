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
  AnalysisMetrics,
  ImportanceResult,
  DateSizeResult,
  LabelClassification,
  EnhancedCategorizationResult
} from './types.js';
import { AnalyzerFactory } from './factories/AnalyzerFactory.js';
import {
  CategorizationSystemConfig,
  CategorizationConfigManager,
  DEFAULT_CATEGORIZATION_CONFIG
} from './config/CategorizationConfig.js';

// Analysis version for tracking schema changes
const ANALYSIS_VERSION = '1.0.0';

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
  async categorizeEmails(options: CategorizeOptions, userContext?: { user_id: string; session_id: string }): Promise<EnhancedCategorizationResult> {
    logger.info('Starting email categorization', { ...options, userId: userContext?.user_id });
    
    try {
      // Get all emails that need categorization with user context
      const emails = await this.getEmailsForCategorization(options, userContext);
      
      let processed = 0;
      const categories = { high: 0, medium: 0, low: 0 };
      const categorizedEmails: EmailIndex[] = [];
      
      // Track analyzer insights data
      const allImportanceRules: string[] = [];
      const confidenceScores: number[] = [];
      const ageDistribution = { recent: 0, moderate: 0, old: 0 };
      const sizeDistribution = { small: 0, medium: 0, large: 0 };
      let spamDetectedCount = 0;
      
      for (const email of emails) {
        const category = await this.determineCategory(email);
        email.category = category;
        
        // Update database
        await this.databaseManager.upsertEmailIndex(email, userContext?.user_id);
        
        // Collect the categorized email with all analyzer results
        categorizedEmails.push({ ...email });
        
        categories[category]++;
        processed++;
        
        // Collect analyzer insights data
        if (email.importanceMatchedRules) {
          allImportanceRules.push(...email.importanceMatchedRules);
        }
        if (email.importanceConfidence !== undefined) {
          confidenceScores.push(email.importanceConfidence);
        }
        if (email.ageCategory) {
          ageDistribution[email.ageCategory]++;
        }
        if (email.sizeCategory) {
          sizeDistribution[email.sizeCategory]++;
        }
        if (email.spam_score && email.spam_score > 0.5) {
          spamDetectedCount++;
        }
        
        // Log progress every 100 emails
        if (processed % 100 === 0) {
          logger.info(`Categorized ${processed} emails...`);
        }
      }
      
      // Clear cache after categorization
      this.cacheManager.flush();
      
      // Generate analyzer insights
      const analyzer_insights = this.generateAnalyzerInsights(
        allImportanceRules,
        confidenceScores,
        ageDistribution,
        sizeDistribution,
        spamDetectedCount,
        processed
      );
      
      logger.info('Email categorization completed', { processed, categories });
      
      return {
        processed,
        categories,
        emails: categorizedEmails,
        analyzer_insights
      };
    } catch (error) {
      logger.error('Error during categorization:', error);
      throw error;
    }
  }

  /**
   * Determines email category using orchestrated analysis from multiple analyzers
   * and collects detailed analyzer results for persistence
   */
  private async determineCategory(email: EmailIndex): Promise<PriorityCategory> {
    const startTime = Date.now();
    
    try {
      // Create analysis context
      const context = this.createAnalysisContext(email);
      
      // Orchestrate analysis across all analyzers
      const combinedResult = await this.orchestrateAnalysis(context);
      
      // Collect and store detailed analyzer results in the email object
      this.collectAnalyzerResults(email, combinedResult);
      
      // Update metrics
      this.metrics.totalProcessingTime += Date.now() - startTime;
      
      logger.debug('CategorizationEngine: Category determined with detailed results', {
        emailId: email.id,
        category: combinedResult.finalCategory,
        confidence: combinedResult.confidence,
        processingTime: combinedResult.processingTime,
        importanceLevel: email.importanceLevel,
        ageCategory: email.ageCategory,
        gmailCategory: email.gmailCategory
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
  private createAnalysisContext(email: EmailIndex,user_id:string='default'): EmailAnalysisContext {
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
      user_id,
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
            () => this.labelClassifier.classifyLabels(context.labels,context.user_id),
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
        labelClassification = await this.labelClassifier.classifyLabels(context.labels,context.user_id);
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
      if (labelClassification.spam_score > 0.7 || labelClassification.promotional_score > 0.8) {
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
    
    if (labelClassification.spam_score > 0.5) {
      reasoning.push(`Spam indicators detected (score: ${labelClassification.spam_score.toFixed(2)})`);
    }
    
    if (labelClassification.promotional_score > 0.5) {
      reasoning.push(`Promotional content detected (score: ${labelClassification.promotional_score.toFixed(2)})`);
    }
    
    return reasoning;
  }

  /**
   * Collects detailed analyzer results and stores them in the email object for persistence
   */
  private collectAnalyzerResults(email: EmailIndex, combinedResult: CombinedAnalysisResult): void {
    try {
      // Extract importance analysis results
      const importanceResult = combinedResult.importance;
      email.importanceScore = importanceResult.score;
      email.importanceLevel = importanceResult.level;
      email.importanceMatchedRules = importanceResult.matchedRules || [];
      email.importanceConfidence = importanceResult.confidence;

      // Extract date/size analysis results
      const dateSizeResult = combinedResult.dateSize;
      email.ageCategory = dateSizeResult.ageCategory;
      email.sizeCategory = dateSizeResult.sizeCategory;
      email.recencyScore = dateSizeResult.recencyScore;
      email.sizePenalty = dateSizeResult.sizePenalty;

      // Extract label classification results
      const labelClassification = combinedResult.labelClassification;
      // Map 'other' category to 'primary' as fallback since EmailIndex doesn't support 'other'
      email.gmailCategory = labelClassification.category === 'other' ? 'primary' : labelClassification.category;
      email.spam_score = labelClassification.spam_score;
      email.promotional_score = labelClassification.promotional_score;
      email.socialScore = labelClassification.socialScore;
      
      // Handle indicators arrays - store as arrays directly
      if (labelClassification.indicators) {
        email.spamIndicators = labelClassification.indicators.spam || [];
        email.promotionalIndicators = labelClassification.indicators.promotional || [];
        email.socialIndicators = labelClassification.indicators.social || [];
      }


      // Add analysis metadata
      email.analysisTimestamp = new Date();
      email.analysisVersion = ANALYSIS_VERSION;

      logger.debug('CategorizationEngine: Analyzer results collected', {
        emailId: email.id,
        importanceLevel: email.importanceLevel,
        importanceScore: email.importanceScore,
        ageCategory: email.ageCategory,
        sizeCategory: email.sizeCategory,
        gmailCategory: email.gmailCategory,
        spam_score: email.spam_score,
        analysisVersion: email.analysisVersion
      });
    } catch (error) {
      logger.error('CategorizationEngine: Error collecting analyzer results', {
        emailId: email.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Set minimal analysis metadata even on error
      email.analysisTimestamp = new Date();
      email.analysisVersion = ANALYSIS_VERSION;
    }
  }

  /**
   * Generate analyzer insights summary from processed emails
   */
  private generateAnalyzerInsights(
    allImportanceRules: string[],
    confidenceScores: number[],
    ageDistribution: { recent: number; moderate: number; old: number },
    sizeDistribution: { small: number; medium: number; large: number },
    spamDetectedCount: number,
    totalProcessed: number
  ) {
    // Get top importance rules (most frequently matched)
    const ruleFrequency = allImportanceRules.reduce((acc, rule) => {
      acc[rule] = (acc[rule] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const top_importance_rules = Object.entries(ruleFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([rule]) => rule);
    
    // Calculate average confidence
    const avg_confidence = confidenceScores.length > 0
      ? confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length
      : 0;
    
    // Calculate spam detection rate
    const spam_detection_rate = totalProcessed > 0 ? spamDetectedCount / totalProcessed : 0;
    
    return {
      top_importance_rules,
      spam_detection_rate: Math.round(spam_detection_rate * 100) / 100, // Round to 2 decimal places
      avg_confidence: Math.round(avg_confidence * 100) / 100, // Round to 2 decimal places
      age_distribution: ageDistribution,
      size_distribution: sizeDistribution
    };
  }

  private async getEmailsForCategorization(options: CategorizeOptions, userContext?: { user_id: string; session_id: string }): Promise<EmailIndex[]> {
    // Use user_id from options or from userContext
    const userId = options.user_id || userContext?.user_id || this.databaseManager.getUserId();
    
    if (options.forceRefresh) {
      // Get all emails for this user
      return await this.databaseManager.searchEmails({
        year: options.year,
        user_id: userId
      });
    } else {
      // Get only uncategorized emails (category IS NULL) for this user
      return await this.databaseManager.searchEmails({
        year: options.year,
        category: null,
        user_id: userId
      });
    }
  }

  async getStatistics(options: { groupBy: string, includeArchived: boolean }, userContext?: { user_id: string; session_id: string }): Promise<EmailStatistics> {
    // Use a user-specific cache key
    const userId = userContext?.user_id || this.databaseManager.getUserId() || 'default';
    const cacheKey = CacheManager.categoryStatsKey(userId);
    const cached = this.cacheManager.get<EmailStatistics>(cacheKey);
    
    if (cached) {
      return cached;
    }
    
    // Pass userId to get user-specific statistics
    const stats = await this.databaseManager.getEmailStatistics(options.includeArchived, userId);
    
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
    this.cacheManager.set(cacheKey, result,userId, 300); // Cache for 5 minutes
    
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
  public async analyzeEmail(email: EmailIndex, userContext?: { user_id: string; session_id: string }): Promise<CombinedAnalysisResult> {
    // Ensure the email object has a user_id if provided in context
    if (userContext?.user_id && !email.user_id) {
      email.user_id = userContext.user_id;
    }
    
    const context = this.createAnalysisContext(email);
    return this.orchestrateAnalysis(context);
  }
}