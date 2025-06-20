/**
 * Mock implementation of ArchiveManager for testing
 * This avoids ES Module issues with the real implementation
 */
import { AuthManager } from '../../../../src/auth/AuthManager';
import { DatabaseManager } from '../../../../src/database/DatabaseManager';
import { FileFormatterRegistry } from '../../../../src/archive/formatters/FormatterRegistry';
import { ArchiveOptions, ExportOptions } from '../../../../src/types';

// Define type for Gmail client to fix TypeScript errors
interface GmailClient {
  users: {
    messages: {
      batchModify: jest.Mock;
      modify: jest.Mock;
    }
  }
}

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
    this.archivePath = process.env.ARCHIVE_PATH || 'archives';
  }

  // Implement only the methods needed for testing
  async archiveEmails(options: ArchiveOptions): Promise<{ archived: number, location?: string, errors: string[] }> {
    // Get emails from database
    const emails = await this.databaseManager.searchEmails({});

    if (options.method === 'gmail') {
      // Mock Gmail archiving
      // @ts-ignore - TypeScript doesn't know about the Gmail client structure
      const gmail: GmailClient = await this.authManager.getClient();
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids: emails.map(e => e.id),
          addLabelIds: ['ARCHIVED'],
          removeLabelIds: ['INBOX']
        }
      });

      // Update emails in database
      for (const email of emails) {
        email.archived = true;
        email.archiveDate = new Date();
        email.archiveLocation = 'ARCHIVED';
        await this.databaseManager.upsertEmailIndex(email);
      }

      // Create archive record
      await this.databaseManager.createArchiveRecord({
        emailIds: emails.map(e => e.id),
        archiveDate: new Date(),
        method: 'gmail',
        restorable: true
      });

      return { archived: emails.length, errors: [] };
    } else {
      // Mock file export
      return { archived: emails.length, location: 'mock-archive-path', errors: [] };
    }
  }

  async restoreEmails(options: {
    archiveId?: string,
    emailIds?: string[],
    restoreLabels?: string[]
  }): Promise<{ restored: number, errors: string[] }> {
    if (!options.emailIds || options.emailIds.length === 0) {
      return { restored: 0, errors: ['No email IDs provided'] };
    }

    // Get emails from database
    const emails = await this.databaseManager.getEmailsByIds(options.emailIds);
    const archivedEmails = emails.filter(email => email.archived);

    if (archivedEmails.length === 0) {
      return { restored: 0, errors: ['No archived emails found'] };
    }

    // Mock Gmail restoration
    // @ts-ignore - TypeScript doesn't know about the Gmail client structure
    const gmail: GmailClient = await this.authManager.getClient();
    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids: archivedEmails.map(e => e.id),
        addLabelIds: ['INBOX', ...(options.restoreLabels || [])],
        removeLabelIds: ['ARCHIVED']
      }
    });

    // Update emails in database
    for (const email of archivedEmails) {
      email.archived = false;
      email.archiveDate = undefined;
      email.archiveLocation = undefined;
      
      // Add restore labels if provided
      if (options.restoreLabels && options.restoreLabels.length > 0) {
        if (!email.labels) {
          email.labels = [];
        }
        
        for (const label of options.restoreLabels) {
          if (!email.labels.includes(label)) {
            email.labels.push(label);
          }
        }
      }
      
      await this.databaseManager.upsertEmailIndex(email);
    }

    return { restored: archivedEmails.length, errors: [] };
  }

  async exportEmails(options: ExportOptions): Promise<{ exported: number, file_path: string, size: number }> {
    // Get emails from database
    const emails = await this.databaseManager.searchEmails(options.searchCriteria || {});
    
    // Get formatter from registry
    const formatter = this.formatterRegistry.getFormatter(options.format || 'json');
    
    // Generate mock content
    const formattedContent = await formatter.formatEmails(emails, {
      includeAttachments: options.includeAttachments || false,
      includeMetadata: true
    });
    
    // Mock file path
    const outputPath = options.outputPath || 'test-export';
    const filePath = `${outputPath}.${formatter.getFileExtension()}`;
    
    // Return mock result
    return {
      exported: emails.length,
      file_path: filePath,
      size: formattedContent.length
    };
  }
}