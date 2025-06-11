import { DatabaseManager } from '../database/DatabaseManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { EmailIndex, CategorizeOptions, EmailStatistics, PriorityCategory } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { LabelsType ,Labels} from './types.js';


// --- Priority rule config types ---
interface PriorityRuleConfig {
  type: string;
  [key: string]: any;
}

interface CategorizationConfig {
  highPriorityRules: PriorityRuleConfig[];
  lowPriorityRules: PriorityRuleConfig[];
}

// --- Rule type for modular priority logic ---
type PriorityRule = (ctx: { subject: string, sender: string, snippet: string, email: EmailIndex }) => boolean;

export class CategorizationEngine {
  private databaseManager: DatabaseManager;
  private cacheManager: CacheManager;
  
  // --- Modular rule arrays ---
  private highPriorityRules: PriorityRule[] = [];
  private lowPriorityRules: PriorityRule[] = [];
  private config: CategorizationConfig;
  private IMPORTANT_DOMAINS: string[] = [];

  constructor(databaseManager: DatabaseManager, cacheManager: CacheManager, config?: CategorizationConfig) {
    this.databaseManager = databaseManager;
    this.cacheManager = cacheManager;

    // Default config if not provided
    this.config = config || {
      highPriorityRules: [
        { type: 'keyword', keywords: [
          'urgent', 'asap', 'important', 'critical', 'deadline',
          'action required', 'immediate', 'priority', 'emergency'] },
        { type: 'domain', domains: ['company.com', 'client.com'] },
        { type: 'label', labels: [Labels.IMPORTANT, Labels.AUTOMATED] },
      ],
      lowPriorityRules: [
        { type: 'keyword', keywords: [
          'newsletter', 'unsubscribe', 'promotional', 'sale',
          'deal', 'offer', 'discount', 'no-reply', 'noreply',
          'automated', 'notification'] },
        { type: 'noReply' },
        { type: 'label', labels: [Labels.PROMOTIONAL, Labels.SPAM, Labels.CATEGORY_PROMOTIONS,Labels.CATEGORY_SOCIAL] },
        { type: 'largeAttachment', minSize: 1048576 },
      ]
    };

    this.highPriorityRules = this.config.highPriorityRules.map(ruleCfg => this.createRule(ruleCfg, 'high'));
    this.lowPriorityRules = this.config.lowPriorityRules.map(ruleCfg => this.createRule(ruleCfg, 'low'));
  }

  // --- Factory for rule functions ---
  private createRule(ruleCfg: PriorityRuleConfig, priority: 'high' | 'low'): PriorityRule {
    switch (ruleCfg.type) {
      case 'keyword':
        return ({ subject, snippet }) => {
          const content = `${subject} ${snippet}`;
          return ruleCfg.keywords.some((k: string) => content.includes(k));
        };
      case 'domain':
        return ({ sender }) => ruleCfg.domains.some((d: string) => sender.includes(d));
      case 'label':
        return ({ email }) => {
          if (!email.labels) return false;
          return ruleCfg.labels.some((l: string) => (email.labels ?? []).includes(l));
        };
      case 'noReply':
        return ({ sender }) => sender.includes(Labels.NO_REPLY) || sender.includes('noreply');
      case 'largeAttachment':
        return ({ email }) => (email.size ?? 0) > (ruleCfg.minSize ?? 1048576) && !!email.hasAttachments;
      default:
        // Unknown rule type, always false
        return () => false;
    }
  }

  // --- Allow dynamic rule registration ---
  public registerHighPriorityRule(ruleCfg: PriorityRuleConfig) {
    this.highPriorityRules.push(this.createRule(ruleCfg, 'high'));
    this.config.highPriorityRules.push(ruleCfg);
  }
  public registerLowPriorityRule(ruleCfg: PriorityRuleConfig) {
    this.lowPriorityRules.push(this.createRule(ruleCfg, 'low'));
    this.config.lowPriorityRules.push(ruleCfg);
  }

  async categorizeEmails(options: CategorizeOptions): Promise<{ processed: number, categories: any }> {
    logger.info('Starting email categorization', options);
    
    try {
      // Get all emails that need categorization
      const emails = await this.getEmailsForCategorization(options);
      
      let processed = 0;
      const categories = { high: 0, medium: 0, low: 0 };
      
      for (const email of emails) {
        const category = this.determineCategory(email);
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

  private determineCategory(email: EmailIndex): PriorityCategory  {
    const subject = email?.subject?.toLowerCase();
    const sender = email?.sender?.toLowerCase();
    const snippet = email?.snippet?.toLowerCase();
    if(subject ==null){
      throw new Error('Email subject is missing');
    }
    if(sender == null){
      throw new Error('Email sender is missing');
    }
    if(snippet == null){
      throw new Error('Email snippet is missing');
    }
    const ctx = { subject, sender, snippet, email };
    // Check for high priority indicators
    if (this.isHighPriority(ctx)) {
      return PriorityCategory.HIGH;
    }
    // Check for low priority indicators
    if (this.isLowPriority(ctx)) {
      return PriorityCategory.LOW;
    }
    // Default to medium priority
    return PriorityCategory.MEDIUM;
  }

  // --- Modular rule-based high priority check ---
  private isHighPriority(ctx: { subject: string, sender: string, snippet: string, email: EmailIndex }): boolean {
    return this.highPriorityRules.some(rule => rule(ctx));
  }

  // --- Modular rule-based low priority check ---
  private isLowPriority(ctx: { subject: string, sender: string, snippet: string, email: EmailIndex }): boolean {
    return this.lowPriorityRules.some(rule => rule(ctx));
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
    // This could be stored in database for persistence
    this.IMPORTANT_DOMAINS.push(...domains);
    logger.info('Updated important domains', { count: domains.length });
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
}