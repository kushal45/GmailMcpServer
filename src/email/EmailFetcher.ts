import { DatabaseManager } from '../database/DatabaseManager.js';
import { AuthManager } from '../auth/AuthManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { EmailIndex, ListEmailsOptions, PriorityCategory, Header} from '../types/index.js';
import { logger } from '../utils/logger.js';

export class EmailFetcher {
  private databaseManager: DatabaseManager;
  private authManager: AuthManager;
  private cacheManager: CacheManager;
  
  // Cache expiration time in seconds
  private readonly CACHE_TTL = 3600; // 1 hour
  
  // Maximum number of emails to fetch in one batch
  private readonly BATCH_SIZE = 50;

  constructor(
    databaseManager: DatabaseManager,
    authManager: AuthManager,
    cacheManager: CacheManager
  ) {
    this.databaseManager = databaseManager;
    this.authManager = authManager;
    this.cacheManager = cacheManager;
  }

  /**
   * List emails based on provided filters
   * Implements the flow from the sequence diagram
   */
  async listEmails(options: ListEmailsOptions): Promise<{
    emails: EmailIndex[];
    total: number;
  }> {
    logger.info('Listing emails with options:', options);
    
    try {
      // Step 1: Query local cache DB for email metadata
      const cacheKey = this.generateCacheKey(options);
      const cachedResult = this.cacheManager.get<{
        emails: EmailIndex[];
        total: number;
        timestamp: number;
      }>(cacheKey);
      
      // If we have fresh cached results, return them
      if (cachedResult && Date.now() - cachedResult.timestamp < this.CACHE_TTL * 1000) {
        logger.info(`Returning ${cachedResult.emails.length} emails from cache`);
        return {
          emails: cachedResult.emails,
          total: cachedResult.total
        };
      }
      
      // Step 2: Query database for matching emails
      const searchCriteria: any = {
        category: options.category,
        year: options.year,
        sizeRange: options.sizeRange,
        archived: options.archived,
        limit: options.limit,
        offset: options.offset
      };
      
      // Add additional search criteria if provided
      if (options.hasAttachments !== undefined) {
        searchCriteria.hasAttachments = options.hasAttachments;
      }
      
      if (options.labels && options.labels.length > 0) {
        searchCriteria.labels = options.labels;
      }
      
      const emails = await this.databaseManager.searchEmails(searchCriteria);
      
      // Get total count without pagination
      const countCriteria = { ...searchCriteria };
      delete countCriteria.limit;
      delete countCriteria.offset;
      const total = await this.databaseManager.getEmailCount(countCriteria);
      
      // Step 3: Check if we need to fetch from Gmail API
      const needsSync = this.needsSynchronization(emails, options);
      
      if (needsSync) {
        // Step 4: Apply incremental synchronization logic
        await this.synchronizeWithGmail(options);
        
        // Step 5: Re-query database after synchronization
        const refreshedEmails = await this.databaseManager.searchEmails(searchCriteria);
        const refreshedTotal = await this.databaseManager.getEmailCount(countCriteria);
        
        // Step 6: Cache the results
        this.cacheManager.set(cacheKey, {
          emails: refreshedEmails,
          total: refreshedTotal,
          timestamp: Date.now()
        }, this.CACHE_TTL);
        
        logger.info(`Returning ${refreshedEmails.length} emails after synchronization`);
        return {
          emails: refreshedEmails,
          total: refreshedTotal
        };
      }
      
      // Step 6: Cache the results
      this.cacheManager.set(cacheKey, {
        emails,
        total,
        timestamp: Date.now()
      }, this.CACHE_TTL);
      
      logger.info(`Returning ${emails.length} emails from database`);
      return { emails, total };
    } catch (error) {
      logger.error('Error listing emails:', error);
      throw error;
    }
  }

  /**
   * Determine if we need to synchronize with Gmail API
   */
  private needsSynchronization(emails: EmailIndex[], options: ListEmailsOptions): boolean {
    // If explicit query or specific filters are provided, we might need fresh data
    if (options.query || (options.labels && options.labels.length > 0)) {
      return true;
    }
    
    // If no emails found, we might need to sync
    if (emails.length === 0 && options.offset === 0) {
      return true;
    }
    
    // Check last sync time from cache
    const lastSyncKey = 'last_gmail_sync';
    const lastSync = this.cacheManager.get<number>(lastSyncKey) || 0;
    
    // If it's been more than 1 hour since last sync, sync again
    if (Date.now() - lastSync > this.CACHE_TTL * 1000) {
      return true;
    }
    
    return false;
  }

  /**
   * Synchronize with Gmail API to fetch missing or newer emails
   */
  private async synchronizeWithGmail(options: ListEmailsOptions): Promise<void> {
    logger.info('Synchronizing with Gmail API');
    
    try {
      // Get Gmail client
      const gmailClient = await this.authManager.getGmailClient();
      if (!gmailClient || !gmailClient.users || !gmailClient.users.messages) {
        throw new Error('Invalid Gmail client or missing messages API');
      }
      
      // Build query based on options
      const query = this.buildGmailQuery(options);
      
      // Fetch emails from Gmail API with retry logic
      let response;
      try {
        response = await gmailClient.users.messages.list({
          userId: 'me',
          q: query,
          maxResults: this.BATCH_SIZE
        });
      } catch (error) {
        logger.error('Error fetching message list from Gmail API:', error);
        throw new Error(`Failed to fetch messages: ${(error as Error).message || 'Unknown error'}`);
      }
      
      // Validate response data
      if (!response || !response.data) {
        logger.warn('Empty response from Gmail API');
        return;
      }
      
      const messages = response.data.messages || [];
      logger.info(`Fetched ${messages.length} messages from Gmail API`);
      
      if (messages.length === 0) {
        logger.info('No new messages to synchronize');
        // Still update the sync time to prevent repeated empty calls
        this.cacheManager.set('last_gmail_sync', Date.now(), this.CACHE_TTL * 24);
        return;
      }
      
      // Process each message
      for (const message of messages) {
        try {
          if (!message || !message.id) {
            logger.warn('Skipping message with missing ID');
            continue;
          }
          
          // Get full message details
          const fullMessage = await gmailClient.users.messages.get({
            userId: 'me',
            id: message.id
          });
          
          if (!fullMessage || !fullMessage.data) {
            logger.warn(`Failed to get full message for ID: ${message.id}`);
            continue;
          }
          
          // Convert to EmailIndex format
          const emailIndex = this.convertToEmailIndex(fullMessage.data);
          
          // Save to database
          await this.databaseManager.upsertEmailIndex(emailIndex);
        } catch (error) {
          // Log error but continue processing other messages
          logger.error(`Error processing message ${message?.id || 'unknown'}:`, error);
        }
      }
      
      // Update last sync time
      this.cacheManager.set('last_gmail_sync', Date.now(), this.CACHE_TTL * 24); // 24 hours
      
      logger.info('Synchronization completed');
    } catch (error) {
      logger.error('Error synchronizing with Gmail:', error);
      throw error;
    }
  }

  /**
   * Build Gmail API query based on options
   */
  private buildGmailQuery(options: ListEmailsOptions): string {
    const queryParts: string[] = [];
    
    // Add custom query if provided
    if (options.query) {
      queryParts.push(options.query);
    }
    
    if (options.year) {
      const startDate = new Date(options.year, 0, 1);
      const endDate = new Date(options.year + 1, 0, 1);
      queryParts.push(`after:${this.formatDate(startDate)} before:${this.formatDate(endDate)}`);
    }
    
    if (options.sizeRange) {
      if (options.sizeRange.min) {
        queryParts.push(`larger:${Math.floor(options.sizeRange.min / 1024)}k`);
      }
      if (options.sizeRange.max) {
        queryParts.push(`smaller:${Math.floor(options.sizeRange.max / 1024)}k`);
      }
    }
    
    if (options.hasAttachments) {
      queryParts.push('has:attachment');
    }
    
    if (options.labels && options.labels.length > 0) {
      options.labels.forEach(label => {
        queryParts.push(`label:${label}`);
      });
    }
    
    if (options.archived === false) {
      queryParts.push('in:inbox');
    } else if (options.archived === true) {
      queryParts.push('-in:inbox');
    }
    
    return queryParts.join(' ');
  }

  /**
   * Format date for Gmail API query
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0].replace(/-/g, '/');
  }

  /**
   * Convert Gmail message to EmailIndex format
   */
  private convertToEmailIndex(message: any): EmailIndex {
    if (!message || !message.payload || !message.payload.headers) {
      throw new Error(`Invalid message format: ${JSON.stringify(message)}`);
    }
    
    // Extract headers
    const headers: Header[] = message.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const from = headers.find(h => h.name === 'From')?.value || '';
    const to = headers.find(h => h.name === 'To')?.value || '';
    const date = headers.find(h => h.name === 'Date')?.value;
    
    // Parse date
    const messageDate = date ? new Date(date) : new Date(parseInt(message.internalDate || Date.now()));
    const year = messageDate.getFullYear();
    
    // Extract recipients - handle empty to field
    const recipients = to ? to.split(',').map(r => r.trim()) : [];
    
    // Determine if has attachments
    const hasAttachments = this.checkForAttachments(message.payload);
    
    // Default to medium priority until categorized
    const category = PriorityCategory.MEDIUM;
    
    return {
      id: message.id,
      threadId: message.threadId || message.id, // Fallback to id if threadId is missing
      category,
      subject,
      sender: from,
      recipients,
      date: messageDate,
      year,
      size: message.sizeEstimate || 0,
      hasAttachments,
      labels: message.labelIds || [],
      snippet: message.snippet || '',
      archived: !message.labelIds?.includes('INBOX')
    };
  }

  /**
   * Check if message has attachments
   */
  private checkForAttachments(payload: any): boolean {
    if (!payload) return false;
    // Check for direct attachment in the payload
    if (payload.filename && payload.filename.length > 0) {
      return true;
    }
    
    // Check for attachments in parts
    if (!payload.parts || !Array.isArray(payload.parts)) {
      return false;
    }
    
    // Recursively check parts and their subparts
    return payload.parts.some((part: any) => {
      if (part.filename && part.filename.length > 0) {
        return true;
      }
      
      // Check nested parts recursively
      if (part.parts) {
        return this.checkForAttachments(part);
      }
      
      return false;
    });
  }

  /**
   * Generate cache key based on options
   */
  private generateCacheKey(options: ListEmailsOptions): string {
    // Create a normalized version of options for consistent cache keys
    const normalizedOptions = {
      category: options.category,
      year: options.year,
      sizeRange: options.sizeRange,
      archived: options.archived,
      hasAttachments: options.hasAttachments,
      labels: options.labels,
      query: options.query,
      limit: options.limit,
      offset: options.offset
    };
    
    return `list_emails_${JSON.stringify(normalizedOptions)}`;
  }
}