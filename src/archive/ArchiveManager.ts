import { AuthManager } from '../auth/AuthManager.js';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { EmailIndex, ArchiveOptions, ArchiveRule, ExportOptions, ArchiveRecord } from '../types/index.js';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  FileFormatterRegistry, 
  FormatterOptions,
  UnsupportedFormatError,
  FormatterError,
  ErrorFormatter
} from './formatters/index.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

// TypeScript may complain about these, but they're necessary for the code to work
// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
// @ts-ignore
const __dirname = path.dirname(__filename);

export class ArchiveManager {
  private authManager: AuthManager;
  private databaseManager: DatabaseManager;
  private formatterRegistry: FileFormatterRegistry;
  private archivePath: string;

  constructor(
    authManager: AuthManager, 
    databaseManager: DatabaseManager,
    formatterRegistry: FileFormatterRegistry
  ) {
    this.authManager = authManager;
    this.databaseManager = databaseManager;
    this.formatterRegistry = formatterRegistry;
    // Use absolute path based on project root
    // @ts-ignore
    const archivePath = process.env.ARCHIVE_PATH;
    this.archivePath = path.join(__dirname, `../../${archivePath || 'archives'}`);
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
    const fileNamePrefix = options.exportPath || `archive_${timestamp}`;
    const format = options.exportFormat || 'json';
    
    const errors: string[] = [];
    
    try {
      // Get the formatter
      let formatter;
      try {
        formatter = this.formatterRegistry.getFormatter(format);
      } catch (error) {
        if (error instanceof UnsupportedFormatError) {
          // Fallback to default formatter if available
          logger.warn(`Requested format ${format} is not supported, falling back to default format`);
          formatter = this.formatterRegistry.getDefaultFormatter();
          
          errors.push(`Requested format ${format} is not supported, falling back to ${formatter.getFormatName()}`);
        } else {
          throw error;
        }
      }
      
      // Validate emails
      const validationResult = formatter.validateEmails(emails);
      
      // Log warnings but proceed
      validationResult.warnings.forEach(warning => {
        logger.warn(`Validation warning: ${warning.message}`, warning);
        errors.push(warning.message);
      });
      
      // If there are errors, don't proceed
      if (!validationResult.valid) {
        const errorMessages = validationResult.errors.map(e => e.message);
        throw new Error(`Validation failed: ${errorMessages.join(', ')}`);
      }
      
      // Format emails
      const formatOptions: FormatterOptions = {
        includeAttachments: options.includeAttachments || false,
        includeMetadata: true,
        prettyPrint: true
      };
      
      let formattedContent: string;
      try {
        formattedContent = await formatter.formatEmails(emails, formatOptions);
      } catch (error) {
        if (error instanceof FormatterError) {
          throw new Error(`Formatting failed: ${error.message}`);
        }
        throw error;
      }
      
      // Write to file
      const filename = `${fileNamePrefix}.${formatter.getFileExtension()}`;
      const filepath = path.join(this.archivePath, filename);
      
      try {
        await fs.writeFile(filepath, formattedContent);
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Failed to write file: ${error.message}`);
        } else {
          throw new Error(`Failed to write file: ${String(error)}`);
        }
      }
      
      return {
        archived: emails.length,
        location: filepath,
        errors: errors
      };
    } catch (error) {
      logger.error('Export to file failed', error);
      
      if (error instanceof Error) {
        errors.push(`Export failed: ${error.message}`);
      } else {
        errors.push(`Export failed: Unknown error`);
      }
      
      return {
        archived: 0,
        location: '',
        errors: errors
      };
    }
  }

  async restoreEmails(options: {
    archiveId?: string,
    emailIds?: string[],
    restoreLabels?: string[]
  }): Promise<{ restored: number, errors: string[] }> {
    logger.info('Restoring emails', { options });
    
    try {
      const errors: string[] = [];
      let emailsToRestore: EmailIndex[] = [];
      let archiveRecord: ArchiveRecord | null = null;
      
      // Step 1: If archive ID is provided, we need to validate it exists
      // Since we don't have a direct method to query archive records,
      // we'll focus primarily on the email IDs for restoration
      if (options.archiveId) {
        logger.info(`Archive ID provided: ${options.archiveId}, but direct archive record lookup is not available`);
        
        // For now, we'll proceed with just a warning that we're ignoring the archiveId
        // and focusing on direct email restoration
        if (!options.emailIds || options.emailIds.length === 0) {
          return {
            restored: 0,
            errors: [`Cannot restore by archive ID alone. Please provide email IDs to restore.`]
          };
        }
      }
        
      // Step 2: Determine which emails to restore - must have emailIds
      if (options.emailIds && options.emailIds.length > 0) {
        // Use provided email IDs
        emailsToRestore = await this.databaseManager.getEmailsByIds(options.emailIds);
        
        // Filter only archived emails
        emailsToRestore = emailsToRestore.filter(email => email.archived);
        
        if (emailsToRestore.length === 0) {
          return {
            restored: 0,
            errors: ['No archived emails found with the provided IDs']
          };
        }
      } else {
        // Neither email IDs nor archive ID provided
        return {
          restored: 0,
          errors: ['Either emailIds or archiveId must be provided']
        };
      }
      
      // Step 3: Restore based on archive method
      let restored = 0;
      
      // Determine the archive method based on the archived emails
      const archiveMethod = emailsToRestore[0].archiveLocation === 'ARCHIVED'
        ? 'gmail'
        : 'export';
      
      if (archiveMethod === 'gmail') {
        // Restore from Gmail archive (remove ARCHIVED label, add back INBOX)
        const result = await this.restoreFromGmail(
          emailsToRestore.map(e => e.id),
          options.restoreLabels || []
        );
        restored = result.restored;
        errors.push(...result.errors);
      } else if (archiveMethod === 'export') {
        // For exported archives, we need the archive location
        const archiveLocation = emailsToRestore[0].archiveLocation;
        if (!archiveLocation) {
          errors.push('Cannot restore from export: Archive location not found');
        } else {
          const result = await this.restoreFromExport(
            archiveLocation,
            'json', // Default to JSON format if not specified
            emailsToRestore.map(e => e.id)
          );
          restored = result.restored;
          errors.push(...result.errors);
        }
      }
      if( restored != emailsToRestore.length ) {
        throw new McpError(ErrorCode.ParseError, `Restored ${restored} emails, but expected ${emailsToRestore.length} emails to restore`);
      }
      // Step 4: Update database for successfully restored emails
      if (restored > 0) {
        // Update each email in the database
        for (const email of emailsToRestore.slice(0, restored)) {
          email.archived = false;
          email.archiveDate = undefined;
          email.archiveLocation = undefined;
          
          // Preserve original labels if they exist, plus add any restore labels
          if (options.restoreLabels && options.restoreLabels.length > 0) {
            if (!email.labels) {
              email.labels = [];
            }
            
            // Add restore labels without duplicates
            for (const label of options.restoreLabels) {
              if (!email.labels.includes(label)) {
                email.labels.push(label);
              }
            }
          }
          
          await this.databaseManager.upsertEmailIndex(email);
        }
        
        logger.info(`Successfully restored ${restored} emails`);
      }
      
      return { restored, errors };
    } catch (error) {
      logger.error('Error restoring emails:', error);
      return {
        restored: 0,
        errors: [`Failed to restore emails: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }  
  /**
   * Restore emails from Gmail archive by removing ARCHIVED label and adding back INBOX
   */
  private async restoreFromGmail(
    emailIds: string[],
    restoreLabels: string[] = []
  ): Promise<{ restored: number, errors: string[] }> {
    const gmail = await this.authManager.getGmailClient();
    let restored = 0;
    const errors: string[] = [];
    
    // Add INBOX to restore labels if not already included
    if (!restoreLabels.includes('INBOX')) {
      restoreLabels.push('INBOX');
    }
    
    // Process in batches
    const batchSize = 100;
    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, i + batchSize);
      
      try {
        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: {
            ids: batch,
            addLabelIds: restoreLabels,
            removeLabelIds: ['ARCHIVED']
          }
        });
        
        restored += batch.length;
      } catch (error) {
        const errorMsg = `Failed to restore batch ${i / batchSize + 1}: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }
    
    return { restored, errors };
  }
  
  /**
   * Restore emails from exported file archive
   */
  private async restoreFromExport(
    location: string,
    format: string,
    emailIds: string[],
    restoreLabels: string[] = []
  ): Promise<{ restored: number, errors: string[] }> {
    const errors: string[] = [];
    
    try {
      // Verify the export file exists
      try {
        await fs.access(location);
      } catch (error) {
        return {
          restored: 0,
          errors: [`Export file not found: ${location}`]
        };
      }
      
      // Get the formatter for the file format
      let formatter;
      try {
        formatter = this.formatterRegistry.getFormatter(format);
      } catch (error) {
        if (error instanceof UnsupportedFormatError) {
          return {
            restored: 0,
            errors: [`Unsupported format for restore: ${format}`]
          };
        }
        throw error;
      }
      
      // Read and parse the exported file
      const fileContent = await fs.readFile(location, 'utf8');
      
      // Use the formatter to import the emails back
      const gmail = await this.authManager.getGmailClient();
      let restored = 0;
      
      // Implement specific logic based on format
      if (format === 'json') {
        // For JSON format, directly process the parsed content
        const parsedContent = JSON.parse(fileContent);
        const emails = Array.isArray(parsedContent) ? parsedContent : [parsedContent];
        
        // Filter only the requested email IDs if specified
        const emailsToRestore = emailIds.length > 0
          ? emails.filter(email => emailIds.includes(email.id))
          : emails;
        
        for (const email of emailsToRestore) {
          try {
            // Add emails back to inbox with labels
            await gmail.users.messages.modify({
              userId: 'me',
              id: email.id,
              requestBody: {
                addLabelIds: [...(email.labelIds || []), ...restoreLabels, 'INBOX'],
                removeLabelIds: ['ARCHIVED']
              }
            });
            restored++;
          } catch (error) {
            errors.push(`Failed to restore email ${email.id}: ${error}`);
          }
        }
      } else if (format === 'mbox') {
        // For MBOX format, we need specialized parsing
        errors.push('MBOX import is not yet fully implemented');
        // In a real implementation, this would parse the MBOX file and restore via Gmail API
      } else {
        errors.push(`Unsupported format for restore: ${format}`);
      }
      
      return { restored, errors };
    } catch (error) {
      logger.error('Restore from export failed:', error);
      return {
        restored: 0,
        errors: [`Failed to restore from export: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
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
    
    const emails = await this.databaseManager.searchEmails(options.searchCriteria || {});
    
    const archiveOptions: ArchiveOptions = {
      method: 'export',
      exportFormat: options.format as 'mbox' | 'json' | 'csv',
      exportPath: options.outputPath,
      includeAttachments: options.includeAttachments,
      dryRun: false
    };
    
    const result = await this.exportToFile(emails, archiveOptions);
    
    // Get file size
    let fileSize = 0;
    if (result.location) {
      try {
        const stats = await fs.stat(result.location);
        fileSize = stats.size;
      } catch (error) {
        logger.error(`Error getting file size: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    return {
      exported: result.archived,
      file_path: result.location || '',
      size: fileSize
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