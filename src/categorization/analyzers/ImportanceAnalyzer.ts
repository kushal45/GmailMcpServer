import { 
  IImportanceAnalyzer, 
  EmailAnalysisContext, 
  ImportanceResult, 
  ImportanceRule, 
  ImportanceAnalyzerConfig,
  ImportanceRuleConfig,
  RuleResult,
  RuleCondition
} from '../interfaces/IImportanceAnalyzer.js';
import { AnalysisContext, AnalysisResult, AnalyzerConfig } from '../interfaces/IAnalyzer.js';
import { DatabaseManager } from '../../database/DatabaseManager.js';
import { CacheManager } from '../../cache/CacheManager.js';
import { logger } from '../../utils/logger.js';
import { Labels } from '../types.js';

/**
 * ImportanceAnalyzer implementation that evaluates email importance
 * based on configurable rules and caching strategies.
 */
export class ImportanceAnalyzer implements IImportanceAnalyzer {
  private rules: ImportanceRule[] = [];
  private config: ImportanceAnalyzerConfig;
  private cacheManager?: CacheManager;
  private databaseManager?: DatabaseManager;

  constructor(
    config: ImportanceAnalyzerConfig,
    cacheManager?: CacheManager,
    databaseManager?: DatabaseManager
  ) {
    this.config = config;
    this.cacheManager = cacheManager;
    this.databaseManager = databaseManager;
    
    // Initialize default rules from config
    this.initializeRules();
  }

  /**
   * Analyzes email importance based on registered rules
   */
  async analyzeImportance(context: EmailAnalysisContext): Promise<ImportanceResult> {
    const contextHash = this.generateContextHash(context);
    
    // Check cache first if enabled
    if (this.config.caching.enabled && this.cacheManager) {
      const cached = this.getCachedResult(contextHash);
      if (cached) {
        logger.debug('ImportanceAnalyzer: Cache hit', { contextHash });
        return cached;
      }
    }

    // Get applicable rules for this context
    const applicableRules = this.getApplicableRules(context);
    
    // Evaluate each rule
    const ruleEvaluations: Array<{ rule: ImportanceRule; result: RuleResult }> = [];
    for (const rule of applicableRules) {
      try {
        const result = rule.evaluate(context);
        ruleEvaluations.push({ rule, result });
        
        if (result.matched) {
          logger.debug('ImportanceAnalyzer: Rule matched', { 
            ruleId: rule.id, 
            ruleName: rule.name,
            score: result.score 
          });
        }
      } catch (error) {
        logger.error('ImportanceAnalyzer: Rule evaluation failed', { 
          ruleId: rule.id, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    // Calculate importance score
    const score = this.calculateImportanceScore(ruleEvaluations);
    const level = this.determineImportanceLevel(score);
    const matchedRules = ruleEvaluations
      .filter(evaluation => evaluation.result.matched)
      .map(evaluation => evaluation.rule.name);

    const result: ImportanceResult = {
      score,
      level,
      matchedRules,
      confidence: this.calculateConfidence(ruleEvaluations)
    };

    // Cache result if enabled
    if (this.config.caching.enabled && this.cacheManager) {
      this.cacheResult(contextHash, result);
    }

    logger.debug('ImportanceAnalyzer: Analysis complete', { 
      level, 
      score, 
      matchedRules: matchedRules.length 
    });

    return result;
  }

  /**
   * Base analyze method implementation
   */
  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    if (!this.isEmailAnalysisContext(context)) {
      throw new Error('ImportanceAnalyzer requires EmailAnalysisContext');
    }
    return this.analyzeImportance(context);
  }

  /**
   * Configure the analyzer
   */
  configure(config: AnalyzerConfig): void {
    if (this.isImportanceAnalyzerConfig(config)) {
      this.config = config;
      this.initializeRules();
    } else {
      throw new Error('ImportanceAnalyzer requires ImportanceAnalyzerConfig');
    }
  }

  /**
   * Register a new importance rule
   */
  registerRule(rule: ImportanceRule): void {
    this.rules.push(rule);
    logger.info('ImportanceAnalyzer: Rule registered', { 
      ruleId: rule.id, 
      ruleName: rule.name 
    });
  }

  /**
   * Get applicable rules for the given context
   */
  getApplicableRules(context: EmailAnalysisContext): ImportanceRule[] {
    // For now, return all rules. In the future, this could be optimized
    // to return only rules that are likely to match based on context
    return this.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Initialize default rules from configuration
   */
  private initializeRules(): void {
    this.rules = [];
    
    for (const ruleConfig of this.config.rules) {
      try {
        const rule = this.createRuleFromConfig(ruleConfig);
        this.rules.push(rule);
      } catch (error) {
        logger.error('ImportanceAnalyzer: Failed to create rule', { 
          ruleConfig, 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }

    logger.info('ImportanceAnalyzer: Rules initialized', { count: this.rules.length });
  }

  /**
   * Create a rule from configuration
   */
  private createRuleFromConfig(config: ImportanceRuleConfig): ImportanceRule {
    const condition: RuleCondition = {
      ...config,
      type: config.type
    };

    return {
      id: config.id,
      name: config.name,
      priority: config.priority,
      condition,
      weight: config.weight,
      evaluate: (context: EmailAnalysisContext): RuleResult => {
        return this.evaluateRuleCondition(condition, context);
      }
    };
  }

  /**
   * Evaluate a rule condition against context
   */
  private evaluateRuleCondition(condition: RuleCondition, context: EmailAnalysisContext): RuleResult {
    const { subject, sender, snippet, email } = context;
    
    switch (condition.type) {
      case 'keyword':
        return this.evaluateKeywordRule(condition, subject, snippet);
      
      case 'domain':
        return this.evaluateDomainRule(condition, sender);
      
      case 'label':
        return this.evaluateLabelRule(condition, email.labels || []);
      
      case 'noReply':
        return this.evaluateNoReplyRule(condition, sender);
      
      case 'largeAttachment':
        return this.evaluateLargeAttachmentRule(condition, context);
      
      default:
        logger.warn('ImportanceAnalyzer: Unknown rule type', { type: condition.type });
        return { matched: false, score: 0, reason: 'Unknown rule type' };
    }
  }

  /**
   * Evaluate keyword-based rule
   */
  private evaluateKeywordRule(condition: RuleCondition, subject: string, snippet: string): RuleResult {
    const content = `${subject} ${snippet}`.toLowerCase();
    const keywords = condition.keywords as string[] || [];
    
    logger.debug('ImportanceAnalyzer: Evaluating keyword rule', {
      content,
      keywords,
      subject,
      snippet
    });
    
    // Use word boundary matching to avoid partial matches
    const matchedKeywords = keywords.filter(keyword => {
      const escapedKeyword = keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
      return regex.test(content);
    });

    logger.debug('ImportanceAnalyzer: Keyword matching result', {
      matchedKeywords,
      matched: matchedKeywords.length > 0
    });

    if (matchedKeywords.length > 0) {
      return {
        matched: true,
        score: matchedKeywords.length * (condition.weight || this.config.scoring.defaultWeight),
        reason: `Matched keywords: ${matchedKeywords.join(', ')}`
      };
    }

    return { matched: false, score: 0 };
  }

  /**
   * Evaluate domain-based rule
   */
  private evaluateDomainRule(condition: RuleCondition, sender: string): RuleResult {
    const domains = condition.domains as string[] || [];
    const senderLower = sender.toLowerCase();
    
    const matchedDomains = domains.filter(domain => 
      senderLower.includes(domain.toLowerCase())
    );

    if (matchedDomains.length > 0) {
      return {
        matched: true,
        score: condition.weight || this.config.scoring.defaultWeight,
        reason: `Matched domains: ${matchedDomains.join(', ')}`
      };
    }

    return { matched: false, score: 0 };
  }

  /**
   * Evaluate label-based rule
   */
  private evaluateLabelRule(condition: RuleCondition, labels: string[]): RuleResult {
    const ruleLabels = condition.labels as string[] || [];
    
    logger.debug('ImportanceAnalyzer: Evaluating label rule', {
      labels,
      ruleLabels,
      condition
    });
    
    const matchedLabels = ruleLabels.filter(ruleLabel =>
      labels.some(label => label.toLowerCase() === ruleLabel.toLowerCase())
    );

    logger.debug('ImportanceAnalyzer: Label matching result', {
      matchedLabels,
      matched: matchedLabels.length > 0
    });

    if (matchedLabels.length > 0) {
      return {
        matched: true,
        score: matchedLabels.length * (condition.weight || this.config.scoring.defaultWeight),
        reason: `Matched labels: ${matchedLabels.join(', ')}`
      };
    }

    return { matched: false, score: 0 };
  }

  /**
   * Evaluate no-reply rule
   */
  private evaluateNoReplyRule(condition: RuleCondition, sender: string): RuleResult {
    const senderLower = sender.toLowerCase();
    const noReplyIndicators = [Labels.NO_REPLY, 'noreply', 'no-reply'];
    
    logger.debug('ImportanceAnalyzer: Evaluating no-reply rule', {
      sender,
      senderLower,
      noReplyIndicators
    });
    
    const matched = noReplyIndicators.some(indicator =>
      senderLower.includes(indicator)
    );

    logger.debug('ImportanceAnalyzer: No-reply matching result', {
      matched,
      weight: condition.weight
    });

    if (matched) {
      return {
        matched: true,
        score: condition.weight || this.config.scoring.defaultWeight,
        reason: 'No-reply sender detected'
      };
    }

    return { matched: false, score: 0 };
  }

  /**
   * Evaluate large attachment rule
   */
  private evaluateLargeAttachmentRule(condition: RuleCondition, context: EmailAnalysisContext): RuleResult {
    const minSize = condition.minSize as number || 1048576; // 1MB default
    const emailSize = context.size || 0;
    const hasAttachments = context.hasAttachments || false;

    logger.debug('ImportanceAnalyzer: Evaluating large attachment rule', {
      minSize,
      emailSize,
      hasAttachments,
      condition
    });

    const matched = emailSize > minSize && hasAttachments;
    
    logger.debug('ImportanceAnalyzer: Large attachment matching result', {
      matched,
      weight: condition.weight
    });

    if (matched) {
      return {
        matched: true,
        score: condition.weight || this.config.scoring.defaultWeight,
        reason: `Large attachment detected: ${Math.round(emailSize / 1024 / 1024)}MB`
      };
    }

    return { matched: false, score: 0 };
  }

  /**
   * Calculate overall importance score from rule evaluations
   */
  private calculateImportanceScore(evaluations: Array<{ rule: ImportanceRule; result: RuleResult }>): number {
    return evaluations
      .filter(evaluation => evaluation.result.matched)
      .reduce((total, evaluation) => total + evaluation.result.score, 0);
  }

  /**
   * Determine importance level based on score
   */
  private determineImportanceLevel(score: number): 'high' | 'medium' | 'low' {
    if (score >= this.config.scoring.highThreshold) {
      return 'high';
    } else if (score <= this.config.scoring.lowThreshold) {
      return 'low';
    }
    return 'medium';
  }

  /**
   * Calculate confidence based on rule evaluations
   */
  private calculateConfidence(evaluations: Array<{ rule: ImportanceRule; result: RuleResult }>): number {
    const totalRules = evaluations.length;
    const matchedRules = evaluations.filter(evaluation => evaluation.result.matched).length;
    
    if (totalRules === 0) return 0;
    
    // Base confidence on percentage of rules that matched
    const baseConfidence = matchedRules / totalRules;
    
    // Adjust based on rule priorities
    const priorityWeight = evaluations
      .filter(evaluation => evaluation.result.matched)
      .reduce((sum, evaluation) => sum + evaluation.rule.priority, 0) / 100;
    
    return Math.min(1, baseConfidence + priorityWeight);
  }

  /**
   * Generate cache key for context
   */
  private generateContextHash(context: EmailAnalysisContext): string {
    if (this.config.caching.keyStrategy === 'partial') {
      // Use only key fields for caching
      return `importance:${context.email.id}:${context.subject}:${context.sender}`;
    } else {
      // Use full context for caching
      const contextStr = JSON.stringify({
        id: context.email.id,
        subject: context.subject,
        sender: context.sender,
        snippet: context.snippet,
        labels: context.labels?.sort(),
        size: context.size,
        hasAttachments: context.hasAttachments
      });
      return `importance:${Buffer.from(contextStr).toString('base64')}`;
    }
  }

  /**
   * Get cached result
   */
  private getCachedResult(contextHash: string): ImportanceResult | null {
    if (!this.cacheManager) return null;
    
    try {
      return this.cacheManager.get<ImportanceResult>(contextHash);
    } catch (error) {
      logger.error('ImportanceAnalyzer: Cache retrieval failed', { 
        contextHash, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Cache analysis result
   */
  private cacheResult(contextHash: string, result: ImportanceResult): void {
    if (!this.cacheManager) return;
    
    try {
      this.cacheManager.set(contextHash, result, 300); // Cache for 5 minutes
    } catch (error) {
      logger.error('ImportanceAnalyzer: Cache storage failed', { 
        contextHash, 
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
      'email' in context &&
      'subject' in context &&
      'sender' in context &&
      'snippet' in context
    );
  }

  /**
   * Type guard for ImportanceAnalyzerConfig
   */
  private isImportanceAnalyzerConfig(config: AnalyzerConfig): config is ImportanceAnalyzerConfig {
    return (
      typeof config === 'object' &&
      config !== null &&
      'rules' in config &&
      'scoring' in config &&
      'caching' in config
    );
  }
}