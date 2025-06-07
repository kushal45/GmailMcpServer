import { gmail_v1 } from 'googleapis';
import { AuthManager } from '../auth/AuthManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { EmailMessage, EmailIndex, ListEmailsOptions } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class EmailFetcher {
  private authManager: AuthManager;
  private cacheManager: CacheManager;

  constructor(authManager: AuthManager, cacheManager: CacheManager) {
    this.authManager = authManager;
    this.cacheManager = cacheManager;
  }

  async listEmails(options: ListEmailsOptions): Promise<{ emails: EmailIndex[], total: number }> {
    // Check cache first
    const cacheKey = CacheManager.emailListKey(options);
    const cached = this.cacheManager.get<{ emails: EmailIndex[], total: number }>(cacheKey);
    if (cached) {
      logger.debug('Returning cached email list');
      return cached;
    }

    try {
      const gmail = await this.authManager.getGmailClient();
      
      // Build query
      let query = '';
      if (options.category) {
        // This will be refined after categorization is implemented
        query += `label:${options.category} `;
      }
      if (options.year) {
        query += `after:${options.year}/1/1 before:${options.year + 1}/1/1 `;
      }
      if (options.archived) {
        query += 'label:archived ';
      }

      // Fetch emails
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query.trim(),
        maxResults: options.limit,
        pageToken: options.offset ? String(options.offset) : undefined
      });

      const messages = response.data.messages || [];
      const emails: EmailIndex[] = [];

      // Fetch details for each message
      for (const message of messages) {
        const details = await this.getEmailDetails(gmail, message.id!);
        if (details) {
          emails.push(details);
        }
      }

      const result = {
        emails,
        total: response.data.resultSizeEstimate || 0
      };

      // Cache the result
      this.cacheManager.set(cacheKey, result);

      return result;
    } catch (error) {
      logger.error('Error listing emails:', error);
      throw error;
    }
  }

  async getEmailDetails(gmail: gmail_v1.Gmail, messageId: string): Promise<EmailIndex | null> {
    // Check cache
    const cacheKey = CacheManager.emailKey(messageId);
    const cached = this.cacheManager.get<EmailIndex>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date']
      });

      const message = response.data;
      const headers = message.payload?.headers || [];
      
      const getHeader = (name: string) => 
        headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      const date = new Date(getHeader('Date'));
      
      const emailIndex: EmailIndex = {
        id: message.id!,
        threadId: message.threadId!,
        category: 'medium', // Default, will be updated by categorization
        subject: getHeader('Subject'),
        sender: getHeader('From'),
        recipients: getHeader('To').split(',').map(r => r.trim()),
        date,
        year: date.getFullYear(),
        size: message.sizeEstimate || 0,
        hasAttachments: false, // TODO: Check for attachments
        labels: message.labelIds || [],
        snippet: message.snippet || '',
        archived: (message.labelIds || []).includes('ARCHIVED'),
        archiveDate: undefined,
        archiveLocation: undefined
      };

      // Cache the result
      this.cacheManager.set(cacheKey, emailIndex);

      return emailIndex;
    } catch (error) {
      logger.error(`Error fetching email details for ${messageId}:`, error);
      return null;
    }
  }

  async fetchEmailBatch(messageIds: string[]): Promise<EmailIndex[]> {
    const gmail = await this.authManager.getGmailClient();
    const emails: EmailIndex[] = [];

    // Process in batches to avoid rate limits
    const batchSize = parseInt(process.env.GMAIL_BATCH_SIZE || '100', 10);
    
    for (let i = 0; i < messageIds.length; i += batchSize) {
      const batch = messageIds.slice(i, i + batchSize);
      const promises = batch.map(id => this.getEmailDetails(gmail, id));
      const results = await Promise.all(promises);
      
      emails.push(...results.filter((e): e is EmailIndex => e !== null));
      
      // Small delay between batches to avoid rate limits
      if (i + batchSize < messageIds.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return emails;
  }

  async getAllMessageIds(query: string = ''): Promise<string[]> {
    const gmail = await this.authManager.getGmailClient();
    const messageIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 500,
        pageToken
      });

      const messages = response.data.messages || [];
      messageIds.push(...messages.map(m => m.id!));
      
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);

    return messageIds;
  }
}
