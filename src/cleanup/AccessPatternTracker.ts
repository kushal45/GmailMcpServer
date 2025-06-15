import { DatabaseManager } from '../database/DatabaseManager.js';
import { EmailAccessEvent, SearchActivityRecord, EmailAccessSummary } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * AccessPatternTracker tracks email access patterns and search activity
 * to identify frequently referenced emails for preservation during cleanup.
 */
export class AccessPatternTracker {
  private databaseManager: DatabaseManager;
  private static instance: AccessPatternTracker | null = null;

  constructor(databaseManager?: DatabaseManager) {
    this.databaseManager = databaseManager || DatabaseManager.getInstance();
  }

  static getInstance(databaseManager?: DatabaseManager): AccessPatternTracker {
    if (!this.instance) {
      this.instance = new AccessPatternTracker(databaseManager);
    }
    return this.instance;
  }

  /**
   * Log an email access event
   */
  async logEmailAccess(event: EmailAccessEvent): Promise<void> {
    try {
      await this.databaseManager.logEmailAccess(event);
      
      // Update access summary asynchronously
      this.updateAccessSummaryAsync(event.email_id);
      
      logger.debug('Email access logged', {
        email_id: event.email_id,
        access_type: event.access_type,
        timestamp: event.timestamp
      });
    } catch (error) {
      logger.error('Failed to log email access:', error);
      throw error;
    }
  }

  /**
   * Log search activity with email results and interactions
   */
  async logSearchActivity(record: SearchActivityRecord): Promise<void> {
    try {
      await this.databaseManager.logSearchActivity(record);
      
      // Update access summaries for all result emails asynchronously
      for (const emailId of record.email_results) {
        this.updateAccessSummaryAsync(emailId);
      }
      
      logger.debug('Search activity logged', {
        search_id: record.search_id,
        query: record.query,
        result_count: record.email_results.length,
        interactions: record.result_interactions.length
      });
    } catch (error) {
      logger.error('Failed to log search activity:', error);
      throw error;
    }
  }

  /**
   * Update access summary for a specific email
   */
  async updateAccessSummary(email_id: string): Promise<void> {
    try {
      await this.databaseManager.updateAccessSummary(email_id);
      
      logger.debug('Access summary updated', { email_id });
    } catch (error) {
      logger.error('Failed to update access summary:', error);
      throw error;
    }
  }

  /**
   * Get access summary for an email
   */
  async getAccessSummary(email_id: string): Promise<EmailAccessSummary | null> {
    try {
      return await this.databaseManager.getAccessSummary(email_id);
    } catch (error) {
      logger.error('Failed to get access summary:', error);
      throw error;
    }
  }

  /**
   * Calculate access score for an email based on various factors
   */
  async calculateAccessScore(email_id: string): Promise<number> {
    try {
      const summary = await this.getAccessSummary(email_id);
      
      if (!summary) {
        return 0; // No access data means low access score
      }

      // Calculate weighted access score
      const weights = {
        total_accesses: 0.4,
        recency: 0.3,
        search_interactions: 0.2,
        search_appearances: 0.1
      };

      // Normalize total accesses (log scale to prevent outliers)
      const normalizedAccesses = Math.min(1.0, Math.log10(summary.total_accesses + 1) / Math.log10(50));

      // Calculate recency score (higher for more recent access)
      const daysSinceLastAccess = (Date.now() - summary.last_accessed.getTime()) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.max(0, 1 - daysSinceLastAccess / 365); // Decay over a year

      // Normalize search interactions
      const normalizedInteractions = Math.min(1.0, summary.search_interactions / 10);

      // Normalize search appearances
      const normalizedAppearances = Math.min(1.0, summary.search_appearances / 20);

      const accessScore = (
        normalizedAccesses * weights.total_accesses +
        recencyScore * weights.recency +
        normalizedInteractions * weights.search_interactions +
        normalizedAppearances * weights.search_appearances
      );

      return Math.round(accessScore * 1000) / 1000; // Round to 3 decimal places
    } catch (error) {
      logger.error('Failed to calculate access score:', error);
      return 0;
    }
  }

  /**
   * Get emails with high access scores (frequently accessed)
   */
  async getFrequentlyAccessedEmails(limit: number = 100): Promise<string[]> {
    try {
      const sql = `
        SELECT email_id 
        FROM email_access_summary 
        WHERE access_score > 0.5 
        ORDER BY access_score DESC, last_accessed DESC 
        LIMIT ?
      `;
      
      const rows = await this.databaseManager['all'](sql, [limit]);
      return rows.map((row: any) => row.email_id);
    } catch (error) {
      logger.error('Failed to get frequently accessed emails:', error);
      return [];
    }
  }

  /**
   * Get emails that haven't been accessed for a specified number of days
   */
  async getUnusedEmails(days: number, limit?: number): Promise<string[]> {
    try {
      const cutoffTime = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
      
      let sql = `
        SELECT e.id 
        FROM email_index e
        LEFT JOIN email_access_summary eas ON e.id = eas.email_id
        WHERE (eas.last_accessed IS NULL OR eas.last_accessed < ?)
        AND e.archived = 0
        ORDER BY COALESCE(eas.last_accessed, 0) ASC
      `;
      
      const params = [cutoffTime];
      
      if (limit) {
        sql += ' LIMIT ?';
        params.push(limit);
      }
      
      const rows = await this.databaseManager['all'](sql, params);
      return rows.map((row: any) => row.id);
    } catch (error) {
      logger.error('Failed to get unused emails:', error);
      return [];
    }
  }

  /**
   * Generate access pattern analytics
   */
  async generateAccessAnalytics(days: number = 30): Promise<{
    total_access_events: number;
    unique_emails_accessed: number;
    average_accesses_per_email: number;
    most_accessed_emails: Array<{ email_id: string; access_count: number }>;
    access_patterns_by_hour: Array<{ hour: number; access_count: number }>;
  }> {
    try {
      const cutoffTime = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

      // Total access events
      const totalAccessResult = await this.databaseManager['get'](
        'SELECT COUNT(*) as count FROM email_access_log WHERE timestamp > ?',
        [cutoffTime]
      );
      const total_access_events = totalAccessResult?.count || 0;

      // Unique emails accessed
      const uniqueEmailsResult = await this.databaseManager['get'](
        'SELECT COUNT(DISTINCT email_id) as count FROM email_access_log WHERE timestamp > ?',
        [cutoffTime]
      );
      const unique_emails_accessed = uniqueEmailsResult?.count || 0;

      // Average accesses per email
      const average_accesses_per_email = unique_emails_accessed > 0 
        ? total_access_events / unique_emails_accessed 
        : 0;

      // Most accessed emails
      const mostAccessedRows = await this.databaseManager['all'](
        `SELECT email_id, COUNT(*) as access_count 
         FROM email_access_log 
         WHERE timestamp > ? 
         GROUP BY email_id 
         ORDER BY access_count DESC 
         LIMIT 10`,
        [cutoffTime]
      );
      const most_accessed_emails = mostAccessedRows.map((row: any) => ({
        email_id: row.email_id,
        access_count: row.access_count
      }));

      // Access patterns by hour (using SQLite's strftime function)
      const hourlyPatternRows = await this.databaseManager['all'](
        `SELECT 
           CAST(strftime('%H', datetime(timestamp, 'unixepoch')) AS INTEGER) as hour,
           COUNT(*) as access_count
         FROM email_access_log 
         WHERE timestamp > ?
         GROUP BY hour
         ORDER BY hour`,
        [cutoffTime]
      );
      const access_patterns_by_hour = hourlyPatternRows.map((row: any) => ({
        hour: row.hour,
        access_count: row.access_count
      }));

      return {
        total_access_events,
        unique_emails_accessed,
        average_accesses_per_email: Math.round(average_accesses_per_email * 100) / 100,
        most_accessed_emails,
        access_patterns_by_hour
      };
    } catch (error) {
      logger.error('Failed to generate access analytics:', error);
      return {
        total_access_events: 0,
        unique_emails_accessed: 0,
        average_accesses_per_email: 0,
        most_accessed_emails: [],
        access_patterns_by_hour: []
      };
    }
  }

  /**
   * Clean up old access logs to prevent database bloat
   */
  async cleanupOldAccessLogs(days: number = 90): Promise<number> {
    try {
      const deletedCount = await this.databaseManager.cleanupOldAccessLogs(days);
      
      logger.info('Cleaned up old access logs', {
        deleted_count: deletedCount,
        older_than_days: days
      });
      
      return deletedCount;
    } catch (error) {
      logger.error('Failed to cleanup old access logs:', error);
      return 0;
    }
  }

  /**
   * Asynchronously update access summary (fire and forget)
   */
  private updateAccessSummaryAsync(email_id: string): void {
    this.updateAccessSummary(email_id).catch(error => {
      logger.error('Async access summary update failed:', error);
    });
  }

  /**
   * Batch update access summaries for multiple emails
   */
  async batchUpdateAccessSummaries(email_ids: string[]): Promise<void> {
    try {
      const batchSize = 50;
      
      for (let i = 0; i < email_ids.length; i += batchSize) {
        const batch = email_ids.slice(i, i + batchSize);
        
        const promises = batch.map(email_id => this.updateAccessSummary(email_id));
        await Promise.all(promises);
        
        logger.debug('Batch updated access summaries', {
          batch_size: batch.length,
          batch_start: i,
          total_emails: email_ids.length
        });
      }
    } catch (error) {
      logger.error('Failed to batch update access summaries:', error);
      throw error;
    }
  }
}