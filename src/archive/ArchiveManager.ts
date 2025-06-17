import { AuthManager } from '../auth/AuthManager.js';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { EmailIndex, ArchiveOptions, ArchiveRule, ExportOptions } from '../types/index.js';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ArchiveManager {
  private authManager: AuthManager;
  private databaseManager: DatabaseManager;
  private archivePath: string;

  constructor(authManager: AuthManager, databaseManager: DatabaseManager) {
    this.authManager = authManager;
    this.databaseManager = databaseManager;
    // Use absolute path based on project root
    this.archivePath = path.join(__dirname, `../../${process.env.ARCHIVE_PATH}`) || path.join(__dirname, '../../archives');
  }

  async archiveEmails(options: ArchiveOptions): Promise<{ archived: number, location?: string, errors: string[] }> {
    logger.info('Starting email archive', { options });
    
    try {
      // Get emails to archive based on criteria
      const emails = await this.getEmailsToArchive(options);
      
      if (options.dryRun) {
        return {
          archived: emails.length,
          errors: [],
          location: 'DRY RUN - No emails were actually archived'
        };
      }

      let archived = 0;
      const errors: string[] = [];
      let location: string | undefined;

      if (options.method === 'gmail') {
        // Archive to Gmail (add ARCHIVED label)
        const result = await this.archiveToGmail(emails);
        archived = result.archived;
        errors.push(...result.errors);
      } else if (options.method === 'export') {
        // Export to file
        const result = await this.exportToFile(emails, options);
        archived = result.archived;
        location = result.location;
        errors.push(...result.errors);
      }

      // Update database
      for (const email of emails) {
        if (errors.length === 0) {
          email.archived = true;
          email.archiveDate = new Date();
          email.archiveLocation = location;
          await this.databaseManager.upsertEmailIndex(email);
        }
      }

      // Create archive record
      if (archived > 0) {
        await this.databaseManager.createArchiveRecord({
          emailIds: emails.map(e => e.id),
          archiveDate: new Date(),
          method: options.method,
          location,
          format: options.exportFormat,
          size: 0, // TODO: Calculate actual size
          restorable: true
        });
      }

      logger.info('Archive completed', { archived, errors: errors.length });
      
      return { archived, location, errors };
    } catch (error) {
      logger.error('Archive error:', error);
      throw error;
    }
  }

  private async getEmailsToArchive(options: ArchiveOptions): Promise<EmailIndex[]> {
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

    if (options.olderThanDays) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - options.olderThanDays);
      criteria.dateBefore = cutoffDate;
    }

    // Don't archive already archived emails
    criteria.archived = false;

    return await this.databaseManager.searchEmails(criteria);
  }

  private async archiveToGmail(emails: EmailIndex[]): Promise<{ archived: number, errors: string[] }> {
    const gmail = await this.authManager.getGmailClient();
    let archived = 0;
    const errors: string[] = [];

    // Process in batches
    const batchSize = 100;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      try {
        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch.map(e => e.id),
            addLabelIds: ['ARCHIVED'],
            removeLabelIds: ['INBOX']
          }
        });
        
        archived += batch.length;
      } catch (error) {
        const errorMsg = `Failed to archive batch ${i / batchSize + 1}: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    return { archived, errors };
  }

  private async exportToFile(
    emails: EmailIndex[], 
    options: ArchiveOptions
  ): Promise<{ archived: number, location: string, errors: string[] }> {
    // Ensure archive directory exists
    await fs.mkdir(this.archivePath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileNamePrefix = options.exportPath||`archive_${timestamp}`;
    const filename = `${fileNamePrefix}.${options.exportFormat || 'json'}`;
    const filepath = path.join(this.archivePath, filename);

    try {
      if (options.exportFormat === 'mbox') {
        // TODO: Implement MBOX format export
        throw new Error('MBOX export not yet implemented');
      } else {
        // JSON export
        const data = {
          exportDate: new Date(),
          emailCount: emails.length,
          emails: emails
        };
        
        await fs.writeFile(filepath, JSON.stringify(data, null, 2));
      }

      return {
        archived: emails.length,
        location: filepath,
        errors: []
      };
    } catch (error) {
      return {
        archived: 0,
        location: '',
        errors: [`Export failed: ${error}`]
      };
    }
  }

  async restoreEmails(options: {
    archiveId?: string,
    emailIds?: string[],
    restoreLabels?: string[]
  }): Promise<{ restored: number, errors: string[] }> {
    logger.info('Restoring emails', { options });
    
    // TODO: Implement restore functionality
    // This would involve:
    // 1. Finding the archive record
    // 2. If Gmail archive, remove ARCHIVED label
    // 3. If file export, re-import emails
    // 4. Update database
    
    return { restored: 0, errors: ['Restore functionality not yet implemented'] };
  }

  async createRule(rule: {
    name: string,
    criteria: any,
    action: any,
    schedule?: string
  }): Promise<{ rule_id: string, created: boolean }> {
    try {
      const ruleId = await this.databaseManager.createArchiveRule({
        name: rule.name,
        criteria: rule.criteria,
        action: rule.action,
        schedule: rule.schedule as 'daily' | 'weekly' | 'monthly' | undefined,
        enabled: true,
        lastRun: undefined
      });
      
      logger.info('Archive rule created', { ruleId, name: rule.name });
      
      return { rule_id: ruleId, created: true };
    } catch (error) {
      logger.error('Error creating archive rule:', error);
      throw error;
    }
  }

  async listRules(options: { activeOnly: boolean }): Promise<{ rules: ArchiveRule[] }> {
    try {
      const rules = await this.databaseManager.getArchiveRules(options.activeOnly);
      return { rules };
    } catch (error) {
      logger.error('Error listing archive rules:', error);
      throw error;
    }
  }

  async exportEmails(options: ExportOptions): Promise<{ exported: number, file_path: string, size: number }> {
    logger.info('Exporting emails', { options });
    
    // TODO: Implement full export functionality
    // This is a simplified version
    
    const emails = await this.databaseManager.searchEmails(options.searchCriteria || {});
    
    const archiveOptions: ArchiveOptions = {
      method: 'export',
      exportFormat: options.format === 'csv' ? 'json' : options.format,
      exportPath: options.outputPath,
      dryRun: false
    };
    
    const result = await this.exportToFile(emails, archiveOptions);
    
    // Get file size
    const stats = await fs.stat(result.location);
    
    return {
      exported: result.archived,
      file_path: result.location,
      size: stats.size
    };
  }

  async runScheduledRules(): Promise<void> {
    logger.info('Running scheduled archive rules');
    
    const rules = await this.databaseManager.getArchiveRules(true);
    
    for (const rule of rules) {
      if (this.shouldRunRule(rule)) {
        try {
          await this.executeRule(rule);
        } catch (error) {
          logger.error(`Error executing rule ${rule.name}:`, error);
        }
      }
    }
  }

  private shouldRunRule(rule: ArchiveRule): boolean {
    if (!rule.schedule || !rule.lastRun) {
      return true;
    }

    const now = new Date();
    const lastRun = new Date(rule.lastRun);
    const daysSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60 * 24);

    switch (rule.schedule) {
      case 'daily':
        return daysSinceLastRun >= 1;
      case 'weekly':
        return daysSinceLastRun >= 7;
      case 'monthly':
        return daysSinceLastRun >= 30;
      default:
        return false;
    }
  }

  private async executeRule(rule: ArchiveRule): Promise<void> {
    logger.info(`Executing archive rule: ${rule.name}`);
    
    const options: ArchiveOptions = {
      category: rule.criteria.category,
      olderThanDays: rule.criteria.olderThanDays,
      method: rule.action.method,
      exportFormat: rule.action.exportFormat,
      dryRun: false
    };
    
    const result = await this.archiveEmails(options);
    
    // Update rule stats
    // TODO: Update rule in database with new stats
    
    logger.info(`Archive rule completed: ${rule.name}`, { archived: result.archived });
  }
}