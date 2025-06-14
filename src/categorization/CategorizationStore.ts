import { DatabaseManager } from '../database/DatabaseManager.js';
import { logger } from '../utils/logger.js';
import { EmailIndex, PriorityCategory } from '../types/index.js';

/**
 * Store for managing email categorization data
 */
export class CategorizationStore {
  private dbManager: DatabaseManager;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  /**
   * Save categorization results for emails
   * @param emailsWithCategories Array of email objects with assigned categories
   */
  async saveCategorizationResults(emailsWithCategories: EmailIndex[]): Promise<void> {
    try {
      // Use the existing bulk upsert method to save categorized emails
      await this.dbManager.bulkUpsertEmailIndex(emailsWithCategories);
      
      logger.info(`Saved categorization results for ${emailsWithCategories.length} emails`);
    } catch (error) {
      logger.error(`Failed to save categorization results: ${error}`);
      throw error;
    }
  }

  /**
   * Get emails that need categorization (where category is null)
   * @param limit Maximum number of emails to retrieve
   * @param year Optional year filter
   */
  async getUncategorizedEmails(limit: number = 100, year?: number): Promise<EmailIndex[]> {
    try {
      const criteria: any = {
        category: null,
        limit
      };
      
      if (year) {
        criteria.year = year;
      }
      
      const emails = await this.dbManager.searchEmails(criteria);
      logger.info(`Retrieved ${emails.length} uncategorized emails`);
      
      return emails;
    } catch (error) {
      logger.error(`Failed to get uncategorized emails: ${error}`);
      throw error;
    }
  }

  /**
   * Update the category for a single email
   * @param emailId Email ID
   * @param category Priority category to assign
   */
  async updateEmailCategory(emailId: string, category: PriorityCategory): Promise<void> {
    try {
      const email = await this.dbManager.getEmailIndex(emailId);
      
      if (!email) {
        throw new Error(`Email with ID ${emailId} not found`);
      }
      
      email.category = category;
      await this.dbManager.upsertEmailIndex(email);
      
      logger.info(`Updated category for email ${emailId} to ${category}`);
    } catch (error) {
      logger.error(`Failed to update email category: ${error}`);
      throw error;
    }
  }

  /**
   * Get categorization statistics
   */
  async getCategorizationStats(): Promise<{
    total: number;
    categorized: number;
    uncategorized: number;
    byCategory: Record<PriorityCategory, number>;
  }> {
    try {
      const stats = await this.dbManager.getEmailStatistics();
      
      // Extract category counts from stats
      const highCount = stats.categories.find((c: any) => c.category === 'high')?.count || 0;
      const mediumCount = stats.categories.find((c: any) => c.category === 'medium')?.count || 0;
      const lowCount = stats.categories.find((c: any) => c.category === 'low')?.count || 0;
      
      // Get total count
      const totalCount = await this.dbManager.getEmailCount({});
      
      // Calculate uncategorized count
      const categorizedCount = highCount + mediumCount + lowCount;
      const uncategorizedCount = totalCount - categorizedCount;
      
      return {
        total: totalCount,
        categorized: categorizedCount,
        uncategorized: uncategorizedCount,
        byCategory: {
          high: highCount,
          medium: mediumCount,
          low: lowCount
        }
      };
    } catch (error) {
      logger.error(`Failed to get categorization stats: ${error}`);
      throw error;
    }
  }
}