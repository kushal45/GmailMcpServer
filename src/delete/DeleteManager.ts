import { AuthManager } from '../auth/AuthManager.js';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { EmailIndex, DeleteOptions } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class DeleteManager {
  private authManager: AuthManager;
  private databaseManager: DatabaseManager;

  constructor(authManager: AuthManager, databaseManager: DatabaseManager) {
    this.authManager = authManager;
    this.databaseManager = databaseManager;
  }

  set dbManager(manager: DatabaseManager) {
    this.databaseManager = manager;
  }

  get dbManager(): DatabaseManager {
    return this.databaseManager;
  }

  async deleteEmails(options: DeleteOptions): Promise<{ deleted: number, errors: string[] }> {
    logger.info('Starting email deletion', { options });
    try {
      // Get emails to delete based on criteria
      const emails = await this.getEmailsToDelete(options);

      if (emails.length === 0) {
        return { deleted: 0, errors: [] };
      }

      if (options.dryRun) {
        logger.info('Dry run - would delete emails', { count: emails.length });
        return {
          deleted: emails.length,
          errors: [`DRY RUN - Would delete ${emails.length} emails`]
        };
      }

      // Perform actual deletion
      const result = await this.performDeletion(emails);

      // Update database for successfully deleted emails
      if (result.deleted > 0) {
        const deletedIds = emails.slice(0, result.deleted).map(e => e.id);
        await this.markAsDeleted(deletedIds);
      }

      logger.info('Deletion completed', { 
        deleted: result.deleted, 
        errors: result.errors.length 
      });

      return result;
    } catch (error: unknown) {
      console.error('Error during email deletion:', (error as Error).message, { stack: (error as Error).stack });
      logger.error('Delete error:', (error as Error).message, { stack: (error as Error).stack });
      throw error;
    }
  }

  private async getEmailsToDelete(options: DeleteOptions): Promise<EmailIndex[]> {
    const criteria: any = {};

    if (options.searchCriteria) {
      Object.assign(criteria, options.searchCriteria);
    }

    if (options.category) {
      criteria.category = options.category;
    }

    if (options.year) {
      criteria.year = options.year;
    }

    if (options.sizeThreshold) {
      criteria.sizeRange = { min: 0, max: options.sizeThreshold };
    }

    if (options.skipArchived) {
      criteria.archived = false;
    }

    if(!options?.orderBy) {
      criteria.orderBy = `id`;
    }else{
      criteria.orderBy = options.orderBy;
    }

    if(!options?.orderDirection){
      criteria.orderDirection = 'ASC';
    }else{
      criteria.orderDirection = options.orderDirection;
    }

    const emails = await this.databaseManager.searchEmails(criteria);

    // Additional safety check - don't delete high priority emails unless explicitly specified
    if (!options.category || options.category !== 'high') {
      return emails.filter(e => e.category !== 'high');
    }

    return emails;
  }

  private async performDeletion(emails: EmailIndex[]): Promise<{ deleted: number, errors: string[] }> {
    const gmail = await this.authManager.getGmailClient();
    let deleted = 0;
    const errors: string[] = [];

    // Process in batches to avoid rate limits
    const batchSize = 50;
    
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      try {
        logger.info("emails to delete", { count: batch.length, ids: batch.map(e => e.id) });
        logger.info(`Deleting batch ${Math.floor(i / batchSize) + 1}`, { count: batch.length });
        // Move to trash first (safer than permanent delete)
       const response = await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch.map(e => e.id),
            addLabelIds: ['TRASH'],
            removeLabelIds: ['INBOX', 'UNREAD']
          }
        });
        logger.info('Batch delete response', { response });

        deleted += batch.length;
        
        // Small delay between batches
        if (i + batchSize < emails.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        const errorMsg = `Failed to delete batch ${Math.floor(i / batchSize) + 1}: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
        
        // Stop processing on error to prevent partial deletion
        break;
      }
    }

    return { deleted, errors };
  }

  private async markAsDeleted(emailIds: string[]): Promise<void> {
    // In a real implementation, you might want to:
    // 1. Remove from database
    // 2. Or mark with a "deleted" flag
    // 3. Keep audit trail
    
    logger.info('Marking emails as deleted', { count: emailIds.length });
    await this.databaseManager.markEmailsAsDeleted(emailIds);
    logger.info('Emails marked as deleted', { count: emailIds.length });
  }

  async getDeleteStatistics(): Promise<any> {
    // Get statistics about deletable emails
    const stats = {
      byCategory: {
        high: 0,
        medium: 0,
        low: 0
      },
      byYear: {} as Record<number, number>,
      bySize: {
        small: 0,
        medium: 0,
        large: 0
      },
      total: 0
    };

    // Get all non-archived emails
    const emails = await this.databaseManager.searchEmails({ archived: false });

    for (const email of emails) {
      stats.byCategory[email?.category??"high"]++;
      
      const year = email.year || new Date().getFullYear();
      if (!stats.byYear[year]) {
        stats.byYear[year] = 0;
      }
      stats.byYear[year]++;
      if(email.size == null){
        throw new Error(`Email size is null for email ID: ${email.id}`);
      }
      if (email.size < 102400) {
        stats.bySize.small++;
      } else if (email.size < 1048576) {
        stats.bySize.medium++;
      } else {
        stats.bySize.large++;
      }

      stats.total++;
    }

    return stats;
  }

  async emptyTrash(): Promise<{ deleted: number, errors: string[] }> {
    logger.info('Emptying trash');

    try {
      const gmail = await this.authManager.getGmailClient();
      
      // Get all messages in trash
      const response = await gmail.users.messages.list({
        userId: 'me',
        labelIds: ['TRASH'],
        maxResults: 500
      });

      const messages = response.data.messages || [];
      
      if (messages.length === 0) {
        return { deleted: 0, errors: [] };
      }

      // Permanently delete messages in trash
      let deleted = 0;
      const errors: string[] = [];

      for (const message of messages) {
        try {
          await gmail.users.messages.delete({
            userId: 'me',
            id: message.id!
          });
          deleted++;
        } catch (error) {
          errors.push(`Failed to delete message ${message.id}: ${error}`);
        }
      }

      logger.info('Trash emptied', { deleted, errors: errors.length });
      
      return { deleted, errors };
    } catch (error) {
      logger.error('Error emptying trash:', error);
      throw error;
    }
  }

  async scheduleAutoDeletion(rules: Array<{
    category?: 'high' | 'medium' | 'low',
    olderThanDays?: number,
    sizeThreshold?: number
  }>): Promise<void> {
    // This would set up automatic deletion rules
    // For safety, this should be implemented with extreme caution
    logger.info('Auto-deletion rules would be configured here', { rules });
    
    // In a real implementation:
    // 1. Store rules in database
    // 2. Set up scheduled job to run rules
    // 3. Send notifications before deletion
    // 4. Keep audit log of all deletions
  }
}