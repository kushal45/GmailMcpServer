import { DatabaseManager } from '../database/DatabaseManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { EmailIndex, CategorizeOptions, EmailStatistics, PriorityCategory } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { LabelsType ,Labels} from './types.js';


export class CategorizationEngine {
  private databaseManager: DatabaseManager;
  private cacheManager: CacheManager;
  
  // Keywords for importance detection
  private readonly HIGH_PRIORITY_KEYWORDS = [
    'urgent', 'asap', 'important', 'critical', 'deadline',
    'action required', 'immediate', 'priority', 'emergency'
  ];
  
  private readonly LOW_PRIORITY_KEYWORDS = [
    'newsletter', 'unsubscribe', 'promotional', 'sale',
    'deal', 'offer', 'discount', 'no-reply', 'noreply',
    'automated', 'notification'
  ];
  
  // Important domains (customize based on user needs)
  private readonly IMPORTANT_DOMAINS = [
    'company.com', // Add your company domain
    'client.com',  // Add important client domains
  ];

  constructor(databaseManager: DatabaseManager, cacheManager: CacheManager) {
    this.databaseManager = databaseManager;
    this.cacheManager = cacheManager;
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
    const subject = email.subject.toLowerCase();
    const sender = email.sender.toLowerCase();
    const snippet = email.snippet.toLowerCase();
    
    // Check for high priority indicators
    if (this.isHighPriority(subject, sender, snippet, email)) {
      return PriorityCategory.HIGH;
    }
    
    // Check for low priority indicators
    if (this.isLowPriority(subject, sender, snippet, email)) {
      return PriorityCategory.LOW;
    }

    // Default to medium priority
    return PriorityCategory.MEDIUM;
  }

  private isHighPriority(subject: string, sender: string, snippet: string, email: EmailIndex): boolean {
    // Check for urgent keywords
    const content = `${subject} ${snippet}`;
    for (const keyword of this.HIGH_PRIORITY_KEYWORDS) {
      if (content.includes(keyword)) {
        return true;
      }
    }
    
    // Check if from important domain
    for (const domain of this.IMPORTANT_DOMAINS) {
      if (sender.includes(domain)) {
        return true;
      }
    
    }
    
    // Check if it's a direct reply (not part of a large thread)
    if (email.labels.includes(Labels.IMPORTANT) || email.labels.includes(Labels.AUTOMATED)) {
      return true;
    }
    
    // Check if sender appears frequently (indicating important contact)
    // This would require additional analysis of sender frequency
    
    return false;
  }

  private isLowPriority(subject: string, sender: string, snippet: string, email: EmailIndex): boolean {
    // Check for promotional keywords
    const content = `${subject} ${snippet}`;
    for (const keyword of this.LOW_PRIORITY_KEYWORDS) {
      if (content.includes(keyword)) {
        return true;
      }
    }
    
    // Check if from no-reply addresses
    if (sender.includes(Labels.NO_REPLY) || sender.includes('noreply')) {
      return true;
    }
    
    // Check for promotional labels
    const promotionalLabelSet = new Set(['PROMOTIONS', 'SPAM', 'CATEGORY_PROMOTIONS']);
    const emailLabelsSet = new Set(email.labels);
    for (const label of promotionalLabelSet) {
      if (emailLabelsSet.has(label)) {
        return true;
      }
    }
    
    
    // Large size with attachments might indicate newsletters
    if (email.size > 1048576 && email.hasAttachments) {
      return true;
    }
    
    return false;
  }

  private async getEmailsForCategorization(options: CategorizeOptions): Promise<EmailIndex[]> {
    if (options.forceRefresh) {
      // Get all emails
      return await this.databaseManager.searchEmails({
        year: options.year
      });
    } else {
      // Get only uncategorized emails
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