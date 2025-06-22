import { AuthManager } from "../auth/AuthManager.js";
import { DatabaseManager } from "../database/DatabaseManager.js";
import { UserSession } from "../auth/UserSession.js";
import { FileAccessControlManager } from "../services/FileAccessControlManager.js";
import {
  EmailIndex,
  ArchiveOptions,
  ArchiveRule,
  ExportOptions,
  ArchiveRecord,
} from "../types/index.js";
import {
  UserContext,
  FileAccessRequest,
  CreateFileRequest,
  FileMetadata,
} from "../types/file-access-control.js";
import { logger } from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  FileFormatterRegistry,
  FormatterOptions,
  UnsupportedFormatError,
  FormatterError,
  ErrorFormatter,
} from "./formatters/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

// TypeScript may complain about these, but they're necessary for the code to work
// @ts-ignore
const __filename = fileURLToPath(import.meta.url);
// @ts-ignore
const __dirname = path.dirname(__filename);

export class ArchiveManager {
  private authManager: AuthManager;
  private databaseManager: DatabaseManager;
  private formatterRegistry: FileFormatterRegistry;
  private fileAccessControl: FileAccessControlManager;
  private archivePath: string;

  constructor(
    authManager: AuthManager,
    databaseManager: DatabaseManager,
    formatterRegistry: FileFormatterRegistry,
    fileAccessControl: FileAccessControlManager
  ) {
    this.authManager = authManager;
    this.databaseManager = databaseManager;
    this.formatterRegistry = formatterRegistry;
    this.fileAccessControl = fileAccessControl;
    // Handle both absolute and relative paths for ARCHIVE_PATH
    // @ts-ignore
    const archivePath = process.env.ARCHIVE_PATH || "archives";
    
    if (path.isAbsolute(archivePath)) {
      // Use absolute path directly (e.g., for tests)
      this.archivePath = archivePath;
    } else {
      // Use relative path from project root (e.g., for production)
      this.archivePath = path.join(__dirname, `../../${archivePath}`);
    }
  }

  async archiveEmails(
    options: ArchiveOptions,
    userContext: UserContext
  ): Promise<{ archived: number; location?: string; errors: string[] }> {
    logger.info("Starting email archive", {
      options,
      user_id: userContext.user_id,
      session_id: userContext.session_id
    });

    try {
      // Validate user session
      await this.validateUserSession(userContext);

      // Get emails to archive based on criteria with user context
      const emails = await this.getEmailsToArchive(options, userContext);

      if (options.dryRun) {
        return {
          archived: emails.length,
          errors: [],
          location: "DRY RUN - No emails were actually archived",
        };
      }

      let archived = 0;
      const errors: string[] = [];
      let location: string | undefined;

      if (options.method === "gmail") {
        // Archive to Gmail (add ARCHIVED label)
        const result = await this.archiveToGmail(emails, userContext);
        archived = result.archived;
        location = result.location;
        errors.push(...result.errors);
        
        logger.info("Gmail archive result processed", {
          archived,
          location,
          errors_count: errors.length
        });
      } else if (options.method === "export") {
        // Export to file with file access control
        const result = await this.exportToFile(emails, options, userContext);
        archived = result.archived;
        location = result.location;
        errors.push(...result.errors);
      }

      // Update database with user context
      for (const email of emails) {
        if (errors.length === 0) {
          email.archived = true;
          email.archiveDate = new Date();
          email.archiveLocation = location;
          await this.databaseManager.upsertEmailIndex(email, userContext.user_id);
        }
      }

      // Create archive record with user context
      if (archived > 0) {
        const size =
          options.method === "gmail"
            ? emails.reduce((total, email) => total + (email.size || 0), 0)
            : options.method === "export" && location
            ? await this.getFileSize(location)
            : 0;
            
        // Create archive record with user_id
        const archiveRecord = await this.databaseManager.createArchiveRecord({
          emailIds: emails.map((e) => e.id),
          archiveDate: new Date(),
          method: options.method,
          location,
          format: options.exportFormat,
          size,
          restorable: true,
        });

        // Update archive_records table with user_id if not already set
        await this.databaseManager.execute(
          'UPDATE archive_records SET user_id = ? WHERE id = ?',
          [userContext.user_id, archiveRecord]
        );

        // Log archive operation
        await this.fileAccessControl.auditLog({
          user_id: userContext.user_id,
          session_id: userContext.session_id,
          action: options.method === 'export' ? 'file_create' : 'file_write',
          resource_type: 'archive',
          resource_id: archiveRecord,
          details: {
            method: options.method,
            email_count: archived,
            size: size
          },
          ip_address: userContext.ip_address,
          user_agent: userContext.user_agent,
          success: true
        });
      }

      logger.info("Archive completed", { archived, errors: errors.length });

      return { archived, location, errors };
    } catch (error) {
      logger.error("Archive error:", error);
      throw error;
    }
  }

  private async getEmailsToArchive(
    options: ArchiveOptions,
    userContext: UserContext
  ): Promise<EmailIndex[]> {
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
    
    // Add user context for multi-user isolation
    criteria.user_id = userContext.user_id;

    return await this.databaseManager.searchEmails(criteria);
  }

  private async archiveToGmail(
    emails: EmailIndex[],
    userContext: UserContext
  ): Promise<{ archived: number; errors: string[]; location: string }> {
    logger.info("Starting Gmail archive process", {
      email_count: emails.length,
      user_id: userContext.user_id
    });

    // Get user-specific Gmail client
    const gmail = await this.authManager.getGmailClient(userContext.session_id);
    let archived = 0;
    const errors: string[] = [];

    // Process in batches
    const batchSize = 100;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);

      try {
        logger.info(`Processing Gmail archive batch ${i / batchSize + 1}`, {
          batch_size: batch.length,
          email_ids: batch.map(e => e.id)
        });

        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: batch.map((e) => e.id),
            addLabelIds: ["ARCHIVED"],
            removeLabelIds: ["INBOX"],
          },
        });

        archived += batch.length;
        logger.info(`Gmail archive batch ${i / batchSize + 1} completed`, {
          archived_in_batch: batch.length,
          total_archived: archived
        });
      } catch (error) {
        const errorMsg = `Failed to archive batch ${
          i / batchSize + 1
        }: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    // Gmail archives are stored with location identifier "GMAIL_ARCHIVED"
    const location = "GMAIL_ARCHIVED";
    
    logger.info("Gmail archive process completed", {
      total_archived: archived,
      errors_count: errors.length,
      archive_location: location
    });

    return { archived, errors, location };
  }

  private async exportToFile(
    emails: EmailIndex[],
    options: ArchiveOptions,
    userContext: UserContext
  ): Promise<{ archived: number; location: string; errors: string[] }> {
    // Create user-specific archive directory
    const userArchivePath = path.join(this.archivePath, `user_${userContext.user_id}`);
    await fs.mkdir(userArchivePath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileNamePrefix = options.exportPath || `archive_${timestamp}`;
    const format = options.exportFormat || "json";

    const errors: string[] = [];

    try {
      // Get the formatter
      let formatter;
      try {
        formatter = this.formatterRegistry.getFormatter(format);
      } catch (error) {
        if (error instanceof UnsupportedFormatError) {
          // Fallback to default formatter if available
          logger.warn(
            `Requested format ${format} is not supported, falling back to default format`
          );
          formatter = this.formatterRegistry.getDefaultFormatter();

          errors.push(
            `Requested format ${format} is not supported, falling back to ${formatter.getFormatName()}`
          );
        } else {
          throw error;
        }
      }

      // Validate emails
      const validationResult = formatter.validateEmails(emails);

      // Log warnings but proceed
      validationResult.warnings.forEach((warning) => {
        logger.warn(`Validation warning: ${warning.message}`, warning);
        errors.push(warning.message);
      });

      // If there are errors, don't proceed
      if (!validationResult.valid) {
        const errorMessages = validationResult.errors.map((e) => e.message);
        throw new Error(`Validation failed: ${errorMessages.join(", ")}`);
      }

      // Format emails
      const formatOptions: FormatterOptions = {
        includeAttachments: options.includeAttachments || false,
        includeMetadata: true,
        prettyPrint: true,
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

      // Write to file with access control
      const filename = `${fileNamePrefix}.${formatter.getFileExtension()}`;
      const filepath = path.join(userArchivePath, filename);

      try {
        await fs.writeFile(filepath, formattedContent);
        
        // Calculate file checksum
        const checksum = crypto.createHash('sha256').update(formattedContent).digest('hex');
        
        // Create file metadata record with access control
        const fileMetadata = await this.fileAccessControl.createFileMetadata({
          file_path: filepath,
          original_filename: filename,
          file_type: 'email_export',
          size_bytes: Buffer.byteLength(formattedContent, 'utf8'),
          mime_type: this.getMimeTypeForFormat(format),
          checksum_sha256: checksum,
          encryption_status: 'none',
          compression_status: 'none',
          user_id: userContext.user_id
        });

        logger.info(`File exported with access control: ${fileMetadata.id}`, {
          user_id: userContext.user_id,
          file_path: filepath,
          size_bytes: fileMetadata.size_bytes
        });

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
        errors: errors,
      };
    } catch (error) {
      logger.error("Export to file failed", error);

      if (error instanceof Error) {
        errors.push(`Export failed: ${error.message}`);
      } else {
        errors.push(`Export failed: Unknown error`);
      }

      return {
        archived: 0,
        location: "",
        errors: errors,
      };
    }
  }

  async restoreEmails(
    options: {
      archiveId?: string;
      emailIds?: string[];
      restoreLabels?: string[];
    },
    userContext: UserContext
  ): Promise<{ restored: number; errors: string[] }> {
    logger.info("Restoring emails", {
      options,
      user_id: userContext.user_id,
      session_id: userContext.session_id
    });

    try {
      // Validate user session
      await this.validateUserSession(userContext);
      
      const errors: string[] = [];
      let emailsToRestore: EmailIndex[] = [];
      let archiveRecord: ArchiveRecord | null = null;

      // Step 1: If archive ID is provided, we need to validate it exists
      // Since we don't have a direct method to query archive records,
      // we'll focus primarily on the email IDs for restoration
      if (options.archiveId) {
        logger.info(
          `Archive ID provided: ${options.archiveId}, but direct archive record lookup is not available`
        );

        // For now, we'll proceed with just a warning that we're ignoring the archiveId
        // and focusing on direct email restoration
        if (!options.emailIds || options.emailIds.length === 0) {
          return {
            restored: 0,
            errors: [
              `Cannot restore by archive ID alone. Please provide email IDs to restore.`,
            ],
          };
        }
      }

      // Step 2: Determine which emails to restore - must have emailIds
      if (options.emailIds && options.emailIds.length > 0) {
        console.log("=== RESTORE: Retrieving emails by IDs ===");
        console.log("Email IDs:", options.emailIds);
        console.log("User ID:", userContext.user_id);

        // Use provided email IDs with user context filtering
        emailsToRestore = await this.databaseManager.getEmailsByIds(
          options.emailIds
        );

        console.log("=== RESTORE: Retrieved emails from database ===");
        console.log("Total found:", emailsToRestore.length);
        emailsToRestore.forEach(email => {
          console.log(`Email ${email.id}: archived=${email.archived}, archiveLocation=${email.archiveLocation}, user_id=${(email as any).user_id}`);
        });

        // Filter only archived emails that belong to the user
        const beforeFilter = emailsToRestore.length;
        emailsToRestore = emailsToRestore.filter((email) =>
          email.archived &&
          (email as any).user_id === userContext.user_id
        );

        console.log("=== RESTORE: After filtering ===");
        console.log(`Before filter: ${beforeFilter}, After filter: ${emailsToRestore.length}`);
        console.log("User ID filter:", userContext.user_id);
        emailsToRestore.forEach(email => {
          console.log(`Filtered email ${email.id}: archived=${email.archived}, archiveLocation=${email.archiveLocation}, user_id=${(email as any).user_id}`);
        });

        if (emailsToRestore.length === 0) {
          console.log("=== RESTORE: No emails found for restoration ===");
          return {
            restored: 0,
            errors: ["No archived emails found with the provided IDs"],
          };
        }
      } else {
        // Neither email IDs nor archive ID provided
        return {
          restored: 0,
          errors: ["Either emailIds or archiveId must be provided"],
        };
      }

      // Step 3: Restore based on archive method
      let restored = 0;

      // Determine the archive method based on the archived emails
      const archiveMethod =
        emailsToRestore[0].archiveLocation === "GMAIL_ARCHIVED" ? "gmail" : "export";
        
      logger.info("Detected archive method for restore", {
        archive_method: archiveMethod,
        archive_location: emailsToRestore[0].archiveLocation,
        email_count: emailsToRestore.length,
        email_ids: emailsToRestore.map(e => e.id)
      });

      if (archiveMethod === "gmail") {
        // Restore from Gmail archive (remove ARCHIVED label, add back INBOX)
        const result = await this.restoreFromGmail(
          emailsToRestore.map((e) => e.id),
          options.restoreLabels || [],
          userContext
        );
        restored = result.restored;
        errors.push(...result.errors);
      } else if (archiveMethod === "export") {
        // For exported archives, we need the archive location
        const archiveLocation = emailsToRestore[0].archiveLocation;
        if (!archiveLocation) {
          errors.push("Cannot restore from export: Archive location not found");
        } else {
          const result = await this.restoreFromExport(
            archiveLocation,
            "json", // Default to JSON format if not specified
            emailsToRestore.map((e) => e.id),
            options.restoreLabels || [],
            userContext
          );
          restored = result.restored;
          errors.push(...result.errors);
        }
      }
      if (restored != emailsToRestore.length) {
        throw new McpError(
          ErrorCode.ParseError,
          `Restored ${restored} emails, but expected ${emailsToRestore.length} emails to restore`
        );
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

          await this.databaseManager.upsertEmailIndex(email, userContext.user_id);
        }

        // Log restore operation
        await this.fileAccessControl.auditLog({
          user_id: userContext.user_id,
          session_id: userContext.session_id,
          action: 'file_read',
          resource_type: 'archive',
          resource_id: options.archiveId || 'email_restore',
          details: {
            restored_count: restored,
            email_ids: emailsToRestore.slice(0, restored).map(e => e.id)
          },
          ip_address: userContext.ip_address,
          user_agent: userContext.user_agent,
          success: true
        });

        logger.info(`Successfully restored ${restored} emails`);
      }

      return { restored, errors };
    } catch (error) {
      logger.error("Error restoring emails:", error);
      return {
        restored: 0,
        errors: [
          `Failed to restore emails: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  }
  /**
   * Restore emails from Gmail archive by removing ARCHIVED label and adding back INBOX
   */
  private async restoreFromGmail(
    emailIds: string[],
    restoreLabels: string[] = [],
    userContext: UserContext
  ): Promise<{ restored: number; errors: string[] }> {
    // Get user-specific Gmail client
    const gmail = await this.authManager.getGmailClient(userContext.session_id);
    let restored = 0;
    const errors: string[] = [];

    // Add INBOX to restore labels if not already included
    if (!restoreLabels.includes("INBOX")) {
      restoreLabels.push("INBOX");
    }

    // Process in batches
    const batchSize = 100;
    for (let i = 0; i < emailIds.length; i += batchSize) {
      const batch = emailIds.slice(i, i + batchSize);

      try {
        await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: batch,
            addLabelIds: restoreLabels,
            removeLabelIds: ["ARCHIVED"],
          },
        });

        restored += batch.length;
      } catch (error) {
        const errorMsg = `Failed to restore batch ${
          i / batchSize + 1
        }: ${error}`;
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
    restoreLabels: string[] = [],
    userContext: UserContext
  ): Promise<{ restored: number; errors: string[] }> {
    const errors: string[] = [];

    try {
      // Check file access permission through FileAccessControl
      const fileAccessRequest: FileAccessRequest = {
        file_id: path.basename(location), // This should be the file metadata ID
        user_id: userContext.user_id,
        session_id: userContext.session_id || '',
        permission_type: 'read',
        context: {
          ip_address: userContext.ip_address,
          user_agent: userContext.user_agent,
          operation: 'restore_from_export'
        }
      };

      // Verify the export file exists and user has access
      try {
        await fs.access(location);
        // TODO: Check file access permission when we have file_id mapping
        // const accessResult = await this.fileAccessControl.checkFileAccess(fileAccessRequest);
        // if (!accessResult.allowed) {
        //   return {
        //     restored: 0,
        //     errors: [`Access denied to file: ${accessResult.reason}`],
        //   };
        // }
      } catch (error) {
        return {
          restored: 0,
          errors: [`Export file not found: ${location}`],
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
            errors: [`Unsupported format for restore: ${format}`],
          };
        }
        throw error;
      }

      // Read and parse the exported file
      const fileContent = await fs.readFile(location, "utf8");

      // Use the formatter to import the emails back with user context
      const gmail = await this.authManager.getGmailClient(userContext.session_id);
      let restored = 0;

      // Implement specific logic based on format
      if (format === "json") {
        // For JSON format, directly process the parsed content
        const parsedContent = JSON.parse(fileContent);
        const emails = Array.isArray(parsedContent)
          ? parsedContent
          : [parsedContent];

        // Filter only the requested email IDs if specified
        const emailsToRestore =
          emailIds.length > 0
            ? emails.filter((email) => emailIds.includes(email.id))
            : emails;

        for (const email of emailsToRestore) {
          try {
            // Add emails back to inbox with labels
            await gmail.users.messages.modify({
              userId: "me",
              id: email.id,
              requestBody: {
                addLabelIds: [
                  ...(email.labelIds || []),
                  ...restoreLabels,
                  "INBOX",
                ],
                removeLabelIds: ["ARCHIVED"],
              },
            });
            restored++;
          } catch (error) {
            errors.push(`Failed to restore email ${email.id}: ${error}`);
          }
        }
      } else if (format === "mbox") {
        // For MBOX format, we need specialized parsing
        errors.push("MBOX import is not yet fully implemented");
        // In a real implementation, this would parse the MBOX file and restore via Gmail API
      } else {
        errors.push(`Unsupported format for restore: ${format}`);
      }

      return { restored, errors };
    } catch (error) {
      logger.error("Restore from export failed:", error);
      return {
        restored: 0,
        errors: [
          `Failed to restore from export: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  }

  async createRule(
    rule: {
      name: string;
      criteria: any;
      action: any;
      schedule?: string;
    },
    userContext: UserContext
  ): Promise<{ rule_id: string; created: boolean }> {
    try {
      // Validate user session
      await this.validateUserSession(userContext);

      const ruleId = await this.databaseManager.createArchiveRule({
        name: rule.name,
        criteria: rule.criteria,
        action: rule.action,
        schedule: rule.schedule as "daily" | "weekly" | "monthly" | undefined,
        enabled: true,
        lastRun: undefined,
      });

      // Update archive_rules table with user_id
      await this.databaseManager.execute(
        'UPDATE archive_rules SET user_id = ? WHERE id = ?',
        [userContext.user_id, ruleId]
      );

      // Log rule creation
      await this.fileAccessControl.auditLog({
        user_id: userContext.user_id,
        session_id: userContext.session_id,
        action: 'file_create',
        resource_type: 'archive',
        resource_id: ruleId,
        details: {
          rule_name: rule.name,
          criteria: rule.criteria,
          action: rule.action
        },
        ip_address: userContext.ip_address,
        user_agent: userContext.user_agent,
        success: true
      });

      logger.info("Archive rule created", { ruleId, name: rule.name, user_id: userContext.user_id });

      return { rule_id: ruleId, created: true };
    } catch (error) {
      logger.error("Error creating archive rule:", error);
      throw error;
    }
  }

  async listRules(
    options: {
      activeOnly: boolean;
    },
    userContext: UserContext
  ): Promise<{ rules: ArchiveRule[] }> {
    try {
      // Validate user session
      await this.validateUserSession(userContext);

      // Get user-specific rules with proper user filtering in DatabaseManager
      const userRules = await this.databaseManager.getArchiveRules(options.activeOnly, userContext.user_id);
      
      return { rules: userRules };
    } catch (error) {
      logger.error("Error listing archive rules:", error);
      throw error;
    }
  }

  async exportEmails(
    options: ExportOptions,
    userContext: UserContext
  ): Promise<{ exported: number; file_path: string; size: number }> {
    logger.info("Exporting emails", {
      options,
      user_id: userContext.user_id,
      session_id: userContext.session_id
    });

    // Validate user session
    await this.validateUserSession(userContext);

    // Search emails with user context
    const searchCriteria = {
      ...(options.searchCriteria || {}),
      user_id: userContext.user_id
    };
    
    const emails = await this.databaseManager.searchEmails(searchCriteria);

    const archiveOptions: ArchiveOptions = {
      method: "export",
      exportFormat: options.format as "mbox" | "json" | "csv",
      exportPath: options.outputPath,
      includeAttachments: options.includeAttachments,
      dryRun: false,
    };

    const result = await this.exportToFile(emails, archiveOptions, userContext);

    // Get file size
    let fileSize = 0;
    if (result.location) {
      try {
       fileSize = await this.getFileSize(result.location);
      } catch (error) {
        logger.error(
          `Error getting file size: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return {
      exported: result.archived,
      file_path: result.location || "",
      size: fileSize,
    };
  }

  async runScheduledRules(userContext?: UserContext): Promise<void> {
    logger.info("Running scheduled archive rules", {
      user_id: userContext?.user_id,
      system_run: !userContext
    });

    const rules = await this.databaseManager.getArchiveRules(true, userContext?.user_id);

    for (const rule of rules) {
      // Filter rules by user if userContext is provided
      if (userContext && (rule as any).user_id !== userContext.user_id) {
        continue;
      }

      if (this.shouldRunRule(rule)) {
        try {
          await this.executeRule(rule, userContext);
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
    const daysSinceLastRun =
      (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60 * 24);

    switch (rule.schedule) {
      case "daily":
        return daysSinceLastRun >= 1;
      case "weekly":
        return daysSinceLastRun >= 7;
      case "monthly":
        return daysSinceLastRun >= 30;
      default:
        return false;
    }
  }

  private async executeRule(rule: ArchiveRule, userContext?: UserContext): Promise<void> {
    logger.info(`Executing archive rule: ${rule.name}`, {
      user_id: userContext?.user_id
    });

    const options: ArchiveOptions = {
      category: rule.criteria.category,
      olderThanDays: rule.criteria.olderThanDays,
      method: rule.action.method,
      exportFormat: rule.action.exportFormat,
      dryRun: false,
    };

    // Create system user context if not provided
    const effectiveUserContext = userContext || {
      user_id: (rule as any).user_id || 'system',
      session_id: 'system_scheduled_rule',
      roles: ['system']
    };

    const result = await this.archiveEmails(options, effectiveUserContext);

    // Update rule stats
    // TODO: Update rule in database with new stats

    logger.info(`Archive rule completed: ${rule.name}`, {
      archived: result.archived,
    });
  }

  // Helper method to get file size
  private async getFileSize(filePath: string): Promise<number> {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch (error) {
      logger.warn(`Failed to get file size for ${filePath}`, error);
      return 0;
    }
  }

  /**
   * Validate user session and ensure user has proper access
   */
  private async validateUserSession(userContext: UserContext): Promise<void> {
    if (!userContext.user_id) {
      throw new Error('User ID is required');
    }

    if (!userContext.session_id) {
      throw new Error('Session ID is required');
    }

    // Check if session is valid through AuthManager
    try {
      // Check if authentication is valid for this session
      if (!await this.authManager.hasValidAuth(userContext.session_id)) {
        throw new Error('Invalid or expired session');
      }

      // Verify the session belongs to the correct user
      if (this.authManager.isMultiUserMode()) {
        const sessionUserId = this.authManager.getUserIdForSession(userContext.session_id);
        if (sessionUserId !== userContext.user_id) {
          throw new Error('Session does not belong to the specified user');
        }
      }
    } catch (error) {
      throw new Error(`Session validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get appropriate MIME type for export format
   */
  private getMimeTypeForFormat(format: string): string {
    const mimeTypes: Record<string, string> = {
      'json': 'application/json',
      'csv': 'text/csv',
      'mbox': 'application/mbox',
      'eml': 'message/rfc822',
      'html': 'text/html',
      'txt': 'text/plain',
      'pdf': 'application/pdf',
      'xml': 'application/xml'
    };

    return mimeTypes[format.toLowerCase()] || 'application/octet-stream';
  }
}
