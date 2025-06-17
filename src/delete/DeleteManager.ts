import { AuthManager } from "../auth/AuthManager.js";
import { DatabaseManager } from "../database/DatabaseManager.js";
import {
  EmailIndex,
  DeleteOptions,
  BasicDeletionOptions,
} from "../types/index.js";
import { logger } from "../utils/logger.js";
import { CleanupPolicy } from "../types/index.js";
import { gmail_v1 } from "googleapis";

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

  async deleteEmails(
    options: DeleteOptions
  ): Promise<{ deleted: number; errors: string[] }> {
    logger.info("Starting email deletion", { options });
    try {
      // Get emails to delete based on criteria
      const emails = await this.getEmailsToDelete(options);

      if (emails.length === 0) {
        return { deleted: 0, errors: [] };
      }

      if (options.dryRun) {
        logger.info("Dry run - would delete emails", { count: emails.length });
        return {
          deleted: emails.length,
          errors: [`DRY RUN - Would delete ${emails.length} emails`],
        };
      }

      // Perform actual deletion
      const result = await this.performDeletion(emails);

      // Update database for successfully deleted emails
      if (result.deleted > 0) {
        await this.deleteEmailsFromDb(emails);
      }

      logger.info("Deletion completed", {
        deleted: result.deleted,
        errors: result.errors.length,
      });

      return result;
    } catch (error: unknown) {
      console.error("Error during email deletion:", (error as Error).message, {
        stack: (error as Error).stack,
      });
      logger.error("Delete error:", (error as Error).message, {
        stack: (error as Error).stack,
      });
      throw error;
    }
  }

  private async getEmailsToDelete(
    options: DeleteOptions
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

    if (options.sizeThreshold) {
      criteria.sizeRange = { min: 0, max: options.sizeThreshold };
    }

    if (options.skipArchived) {
      criteria.archived = false;
    }

    if (!options?.orderBy) {
      criteria.orderBy = `id`;
    } else {
      criteria.orderBy = options.orderBy;
    }

    if (!options?.orderDirection) {
      criteria.orderDirection = "ASC";
    } else {
      criteria.orderDirection = options.orderDirection;
    }

    if(options?.maxCount){
      criteria.limit = options.maxCount;
    }

    const emails = await this.databaseManager.searchEmails(criteria);

    // Additional safety check - don't delete high priority emails unless explicitly specified
    if (!options.category || options.category !== "high") {
      return emails.filter((e) => e.category !== "high");
    }

    return emails;
  }

  private async performDeletion(
    emails: EmailIndex[]
  ): Promise<{ deleted: number; errors: string[] }> {
    const gmail = await this.authManager.getGmailClient();
    let deleted = 0;
    const errors: string[] = [];

    // Process in batches to avoid rate limits
    const batchSize = 50;

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);

      try {
        logger.info("emails to delete", {
          count: batch.length,
          ids: batch.map((e) => e.id),
        });
        logger.info(`Deleting batch ${Math.floor(i / batchSize) + 1}`, {
          count: batch.length,
        });
        // Move to trash first (safer than permanent delete)
        const response = await gmail.users.messages.batchModify({
          userId: "me",
          requestBody: {
            ids: batch.map((e) => e.id),
            addLabelIds: ["TRASH"],
            removeLabelIds: ["INBOX", "UNREAD"],
          },
        });
        logger.info("Batch delete response", { response });

        deleted += batch.length;

        // Small delay between batches
        if (i + batchSize < emails.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch (error) {
        const errorMsg = `Batch ${
          Math.floor(i / batchSize) + 1
        } failed: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);

        // Stop processing on error to prevent partial deletion
        break;
      }
    }

    return { deleted, errors };
  }

  private async deleteEmailsFromDb(emails: EmailIndex[]): Promise<void> {
    // In a real implementation, you might want to:
    // 1. Remove from database
    // 2. Or mark with a "deleted" flag
    // 3. Keep audit trail

    logger.debug("deleting emails from sqlite DB", { count: emails.length });
    const deleted=await this.databaseManager.deleteEmailIds(emails);
    logger.info("Emails deleted from DB: ", { count: deleted });
  }

  async getDeleteStatistics(): Promise<any> {
    // Get statistics about deletable emails
    const stats = {
      byCategory: {
        high: 0,
        medium: 0,
        low: 0,
      },
      byYear: {} as Record<number, number>,
      bySize: {
        small: 0,
        medium: 0,
        large: 0,
      },
      total: 0,
    };

    // Get all non-archived emails
    const emails = await this.databaseManager.searchEmails({ archived: false });

    for (const email of emails) {
      stats.byCategory[email?.category ?? "high"]++;

      const year = email.year || new Date().getFullYear();
      if (!stats.byYear[year]) {
        stats.byYear[year] = 0;
      }
      stats.byYear[year]++;
      if (email.size == null) {
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

  private async actualDeletions(
    gmail: gmail_v1.Gmail,
    messages: gmail_v1.Schema$Message[]
  ): Promise<{ deleted: number; errors: string[] }> {
    let deleted = 0;
    const errors: string[] = [];

    for (const message of messages) {
      try {
        /**
         * risky operation , need to change scope to ['https://mail.google.com/'] in order for full broad access
         */
        await gmail.users.messages.delete({
          userId: "me",
          id: message.id!,
        });
        deleted++;
      } catch (error) {
        errors.push(`Failed to delete message ${message.id}: ${error}`);
      }
    }

    return { deleted, errors };
  }

  private async listTrashEmails(
    gmail: gmail_v1.Gmail,
    maxEmailCount?:number
  ): Promise<{ messages: gmail_v1.Schema$Message[]; errors: string[] }> {
    let messages: gmail_v1.Schema$Message[] = [];
    let errors: string[] = [];
    try {
      const response = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["TRASH"],
        maxResults: maxEmailCount??100,
      });

      const messages = response.data.messages || [];
      return { messages, errors };
    } catch (error) {
      errors.push(`Failed to list messages: ${error}`);
      return { messages, errors };
    }
  }

  async emptyTrash(
    trashOption: BasicDeletionOptions
  ): Promise<{ deleted: number; errors: string[] }> {
    let messages: gmail_v1.Schema$Message[] = [];
    const errors: string[] = [];
    let deleted = 0;
    try {
      const gmail = await this.authManager.getGmailClient();

      
      // Get all messages in trash
      const ListTrashResult = await this.listTrashEmails(gmail,trashOption?.maxCount);
      messages = ListTrashResult.messages;
      errors.push(...ListTrashResult.errors);
      if (messages.length === 0 || errors.length > 0) {
        return { deleted: 0, errors };
      }
      if (trashOption.dryRun) {
        logger.info("Dry run - would empty trash");
        return {
          deleted: messages.length,
          errors,
        };
      }
      // Permanently delete messages in trash
      const actualTrashEmtpyResult = await this.actualDeletions(
        gmail,
        messages
      );
      const deleted = actualTrashEmtpyResult.deleted;
      errors.push(...actualTrashEmtpyResult.errors);
      logger.info("Trash emptied", { deleted, errors: errors.length });
      return { deleted, errors };
    } catch (error) {
      logger.error("Error emptying trash:", error);
      throw error;
    }
  }

  /**
   * Batch delete emails with enhanced safety checks for cleanup operations
   */
  async batchDeleteForCleanup(
    emails: EmailIndex[],
    policy?: CleanupPolicy,
    options: {
      dry_run?: boolean;
      batch_size?: number;
      delay_between_batches_ms?: number;
      max_failures?: number;
    } = {}
  ): Promise<{
    deleted: number;
    archived: number;
    failed: number;
    errors: string[];
    storage_freed: number;
  }> {
    const {
      dry_run = false,
      batch_size = 50,
      delay_between_batches_ms = 100,
      max_failures = 10,
    } = options;

    logger.info("Starting batch cleanup deletion", {
      total_emails: emails.length,
      policy_id: policy?.id,
      dry_run,
      batch_size,
    });

    let totalDeleted = 0;
    let totalArchived = 0;
    let totalFailed = 0;
    let totalStorageFreed = 0;
    const allErrors: string[] = [];

    // Process emails in batches
    for (let i = 0; i < emails.length; i += batch_size) {
      const batch = emails.slice(i, i + batch_size);
      const batchNumber = Math.floor(i / batch_size) + 1;
      const totalBatches = Math.ceil(emails.length / batch_size);

      try {
        logger.debug(
          `Processing cleanup batch ${batchNumber}/${totalBatches}`,
          {
            batch_size: batch.length,
            emails_processed: i + batch.length,
            total_emails: emails.length,
          }
        );

        if (dry_run) {
          // Dry run - just simulate
          totalDeleted += batch.length;
          totalStorageFreed += batch.reduce(
            (sum, email) => sum + (email.size || 0),
            0
          );
        } else {
          // Apply safety checks
          const safeEmails = batch.filter((email) =>
            this.isEmailSafeToDelete(email, policy)
          );

          if (safeEmails.length !== batch.length) {
            const skipped = batch.length - safeEmails.length;
            logger.warn(
              `Skipped ${skipped} emails in batch ${batchNumber} due to safety checks`
            );
          }

          if (safeEmails.length > 0) {
            // Determine action based on policy
            const action = policy?.action?.type || "delete";

            if (action === "delete") {
              const result = await this.performDeletion(safeEmails);
              totalDeleted += result.deleted;
              totalFailed += safeEmails.length - result.deleted;
              allErrors.push(...result.errors);
            } else if (action === "archive") {
              // Archive instead of delete
              await this.archiveEmails(safeEmails);
              totalArchived += safeEmails.length;
            }

            totalStorageFreed += safeEmails.reduce(
              (sum, email) => sum + (email.size || 0),
              0
            );
          }
        }

        // Check failure threshold
        if (totalFailed >= max_failures) {
          const errorMsg = `Maximum failures (${max_failures}) reached, stopping batch processing`;
          allErrors.push(errorMsg);
          logger.error(errorMsg);
          break;
        }

        // Delay between batches to avoid overwhelming the system
        if (i + batch_size < emails.length && delay_between_batches_ms > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, delay_between_batches_ms)
          );
        }
      } catch (error) {
        const errorMsg = `Batch ${batchNumber} failed: ${error}`;
        allErrors.push(errorMsg);
        totalFailed += batch.length;
        logger.error(errorMsg);

        if (totalFailed >= max_failures) {
          break;
        }
      }
    }

    const result = {
      deleted: totalDeleted,
      archived: totalArchived,
      failed: totalFailed,
      errors: allErrors,
      storage_freed: totalStorageFreed,
    };

    logger.info("Batch cleanup deletion completed", result);
    return result;
  }

  /**
   * Check if an email is safe to delete based on cleanup policy and general safety rules
   */
  private isEmailSafeToDelete(
    email: EmailIndex,
    policy?: CleanupPolicy
  ): boolean {
    // Never delete high importance emails unless explicitly allowed
    if (email.category === "high" || email.importanceLevel === "high") {
      if (policy?.safety?.preserve_important !== false) {
        return false;
      }
    }

    // Don't delete very recent emails (less than 7 days)
    if (email.date) {
      const daysSinceReceived =
        (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceReceived < 7) {
        return false;
      }
    }

    // Don't delete emails with very high importance scores
    if (email.importanceScore && email.importanceScore > 8) {
      return false;
    }

    // Additional policy-specific safety checks
    if (policy) {
      // Check if email is too recent for policy
      if (policy.criteria.age_days_min && email.date) {
        const daysSinceReceived =
          (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceReceived < policy.criteria.age_days_min) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Get the reason why an email was filtered (for debugging)
   */
  private getFilterReason(email: EmailIndex, policy?: CleanupPolicy): string {
    // Check high importance
    if (email.category === "high" || email.importanceLevel === "high") {
      if (policy?.safety?.preserve_important !== false) {
        return "high_importance_category";
      }
    }

    // Check recent emails (< 7 days)
    if (email.date) {
      const daysSinceReceived =
        (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceReceived < 7) {
        return "too_recent_7_days";
      }
    }

    // Check high importance score (> 8)
    if (email.importanceScore && email.importanceScore > 8) {
      return "high_importance_score";
    }

    // Check policy age criteria
    if (policy && policy.criteria.age_days_min && email.date) {
      const daysSinceReceived =
        (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceReceived < policy.criteria.age_days_min) {
        return "policy_age_minimum";
      }
    }

    return "unknown";
  }

  /**
   * Archive emails instead of deleting them
   */
  private async archiveEmails(emails: EmailIndex[]): Promise<void> {
    const emailIds = emails.map((email) => email.id);
    await this.databaseManager.markEmailsAsDeleted(emailIds);
  }

  /**
   * Get cleanup deletion statistics
   */
  async getCleanupDeletionStats(): Promise<{
    deletable_by_category: Record<string, number>;
    deletable_by_age: Record<string, number>;
    total_deletable: number;
    total_storage_recoverable: number;
  }> {
    try {
      // Get all non-archived emails
      const allEmails = await this.databaseManager.searchEmails({
        archived: false,
      });

      const stats = {
        deletable_by_category: { high: 0, medium: 0, low: 0 },
        deletable_by_age: { recent: 0, moderate: 0, old: 0 },
        total_deletable: 0,
        total_storage_recoverable: 0,
      };

      for (const email of allEmails) {
        if (this.isEmailSafeToDelete(email)) {
          stats.total_deletable++;
          stats.total_storage_recoverable += email.size || 0;

          // Category stats
          const category = email.category || "medium";
          stats.deletable_by_category[category]++;

          // Age stats
          if (email.date) {
            const daysSince =
              (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSince < 30) {
              stats.deletable_by_age.recent++;
            } else if (daysSince < 365) {
              stats.deletable_by_age.moderate++;
            } else {
              stats.deletable_by_age.old++;
            }
          }
        }
      }

      return stats;
    } catch (error) {
      logger.error("Failed to get cleanup deletion stats:", error);
      throw error;
    }
  }

  async scheduleAutoDeletion(
    rules: Array<{
      category?: "high" | "medium" | "low";
      olderThanDays?: number;
      sizeThreshold?: number;
    }>
  ): Promise<void> {
    // This would set up automatic deletion rules
    // For safety, this should be implemented with extreme caution
    logger.info("Auto-deletion rules would be configured here", { rules });

    // In a real implementation:
    // 1. Store rules in database
    // 2. Set up scheduled job to run rules
    // 3. Send notifications before deletion
    // 4. Keep audit log of all deletions
  }
}
