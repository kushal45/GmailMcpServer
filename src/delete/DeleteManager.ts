import { AuthManager } from "../auth/AuthManager.js";
import { DatabaseManager } from "../database/DatabaseManager.js";
import { UserDatabaseManagerFactory } from "../database/UserDatabaseManagerFactory.js";
import {
  EmailIndex,
  DeleteOptions,
  BasicDeletionOptions,
  PriorityCategory,
} from "../types/index.js";
import { logger } from "../utils/logger.js";
import { CleanupPolicy } from "../types/index.js";
import { gmail_v1 } from "googleapis";

export class DeleteManager {
  private authManager: AuthManager;
  private userDbManagerFactory: UserDatabaseManagerFactory;

  constructor(authManager: AuthManager, userDbManagerFactory: UserDatabaseManagerFactory) {
    this.authManager = authManager;
    this.userDbManagerFactory = userDbManagerFactory;
  }

  /**
   * Get user-specific database manager
   * @param userId User ID to get database manager for
   */
  private async getUserDatabaseManager(userId: string): Promise<DatabaseManager> {
    if (!userId) {
      throw new Error('User ID is required for database operations');
    }
    return this.userDbManagerFactory.getUserDatabaseManager(userId);
  }

  async deleteEmails(
    options: DeleteOptions,
    userContext: { user_id: string; session_id: string },
    extra?: { forceDelay?: boolean }
  ): Promise<{ deleted: number; errors: string[] }> {
    logger.info("Starting email deletion", {
      options,
      userId: userContext.user_id,
    });
    // Only catch business logic errors, let infra/auth errors propagate
    // Get user-specific database manager
    const databaseManager = await this.getUserDatabaseManager(userContext.user_id);

    // Add user context to options
    const optionsWithUser = {
      ...options,
      user_id: userContext.user_id,
    };

    // Get emails to delete based on criteria
    let emails = await this.getEmailsToDelete(optionsWithUser);
    // Only operate on emails that are not already archived (unless skipArchived is false)
    let emailsToProcess = emails;
    if (options.skipArchived !== false) {
      emailsToProcess = emails.filter((e) => !e.archived);
    }

    if (emailsToProcess.length === 0) {
      return { deleted: 0, errors: [] };
    }

    if (options.dryRun) {
      logger.info("Dry run - would delete emails", {
        count: emailsToProcess.length,
      });
      return {
        deleted: emailsToProcess.length,
        errors: [`DRY RUN - Would delete ${emailsToProcess.length} emails`],
      };
    }

    // Perform actual deletion with user context
    const result = await this.performDeletion(emailsToProcess, userContext, extra?.forceDelay);

    // Update database for successfully deleted emails
    if (result.deleted > 0 && result.deleted == emailsToProcess.length) {
      const deletdFromDb = await databaseManager.deleteEmailIds(
        emailsToProcess,
        userContext.user_id
      );
      if (deletdFromDb != emailsToProcess.length) {
        result.errors.push(
          "Deletion failed, some emails were not deleted from the database"
        );
      }
    }

    return result;
  }

  private async getEmailsToDelete(
    options: DeleteOptions
  ): Promise<EmailIndex[]> {
    // Get user-specific database manager
    const userId = (options as any).user_id;
    if (!userId) {
      throw new Error('User ID is required for email deletion operations');
    }
    const databaseManager = await this.getUserDatabaseManager(userId);

    // If a category is specified, use it directly
    if (options.category) {
      const criteria: any = { ...options.searchCriteria };
      criteria.category = options.category;
      if (options.year) criteria.year = options.year;
      if (options.sizeThreshold)
        criteria.sizeRange = { min: 0, max: options.sizeThreshold };
      // Always exclude archived unless skipArchived is false
      if (options.skipArchived === false) {
        // include both archived and non-archived
      } else {
        criteria.archived = 0;
      }
      if (options?.maxCount) criteria.limit = options.maxCount;
      if (options?.orderBy) criteria.orderBy = options.orderBy;
      if (options?.orderDirection)
        criteria.orderDirection = options.orderDirection;
      if (options.user_id) criteria.user_id = options.user_id;
      // Debug log
      logger.info("[getEmailsToDelete] Using criteria for category", {
        criteria,
      });
      const result = await databaseManager.searchEmails(criteria);
      logger.info("[getEmailsToDelete] Result count", { count: result.length });
      if (result.length > 0) {
        logger.info("[getEmailsToDelete] First few results", {
          emails: result
            .slice(0, 3)
            .map((e) => ({
              id: e.id,
              user_id: e.user_id,
              archived: e.archived,
              category: e.category,
            })),
        });
      } else {
        logger.info("[getEmailsToDelete] No results returned for criteria", {
          criteria,
        });
      }
      return result;
    } else {
      // If no category is specified, default to deleting only low and medium priority emails
      const criteria: any = { ...options.searchCriteria };
      criteria.user_id = options.user_id;
      // Only low and medium
      criteria.categories = ["low", "medium"];
      if (options.year) criteria.year = options.year;
      if (options.sizeThreshold)
        criteria.sizeRange = { min: 0, max: options.sizeThreshold };
      // Always exclude archived unless skipArchived is false
      if (options.skipArchived === false) {
        // include both archived and non-archived
      } else {
        criteria.archived = 0;
      }
      logger.debug("[getEmailsToDelete] Using default criteria (low/medium)", {
        criteria,
      });
      const result = await databaseManager.searchEmails(criteria);
      logger.debug("[getEmailsToDelete] Result count", {
        count: result.length,
      });
      return result;
    }
  }

  private async performDeletion(
    emails: EmailIndex[],
    userContext: { user_id: string; session_id: string },
    forceDelay?: boolean
  ): Promise<{ deleted: number; errors: string[] }> {
    // Get Gmail client for the specific user
    const gmail = await this.authManager.getGmailClient(userContext.session_id);
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
          const isTest = process.env.NODE_ENV === 'test' || process.env.CI === 'true';
          if (forceDelay || !isTest) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }
      } catch (error) {
        // Only catch and return errors for batch failures, not for auth/network/scope errors
        // If the error is an auth/network/scope error, rethrow
        const errMsg = (error as Error).message || String(error);
        if (
          errMsg.includes('Token expired') ||
          errMsg.includes('Token has been revoked') ||
          errMsg.includes('Token revoked') ||
          errMsg.includes('Network error') ||
          errMsg.includes('Rate limit exceeded') ||
          errMsg.includes('Insufficient OAuth scope') ||
          errMsg.includes('Insufficient scopes') ||
          errMsg.includes('Authentication failed')
        ) {
          throw error;
        }
        const errorMsg = `Batch ${Math.floor(i / batchSize) + 1} failed: ${error}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
        // Stop processing on error to prevent partial deletion
        break;
      }
    }

    return { deleted, errors };
  }

  private async deleteEmailsFromDb(
    emails: EmailIndex[],
    userId: string
  ): Promise<void> {
    // Get user-specific database manager
    const databaseManager = await this.getUserDatabaseManager(userId);

    // In a real implementation, you might want to:
    // 1. Remove from database
    // 2. Or mark with a "deleted" flag
    // 3. Keep audit trail

    logger.debug("deleting emails from sqlite DB", {
      count: emails.length,
      userId,
    });
    const deleted = await databaseManager.deleteEmailIds(emails, userId);
    logger.info("Emails deleted from DB: ", { count: deleted, userId });
  }

  async getDeleteStatistics(userContext: {
    user_id: string;
    session_id: string;
  }): Promise<any> {
    // Get user-specific database manager
    const databaseManager = await this.getUserDatabaseManager(userContext.user_id);

    // Use the database's getEmailStatistics for accuracy
    const statsRaw = await databaseManager.getEmailStatistics(
      false,
      userContext.user_id
    );
    // Format to match test expectations
    const byCategory: Record<string, number> = { high: 0, medium: 0, low: 0 };
    for (const row of statsRaw.categories) {
      byCategory[row.category] = row.count;
    }
    const byYear: Record<number, number> = {};
    for (const row of statsRaw.years) {
      byYear[row.year] = row.count;
    }
    const bySize = {
      small: statsRaw.sizes.small || 0,
      medium: statsRaw.sizes.medium || 0,
      large: statsRaw.sizes.large || 0,
    };
    return {
      byCategory,
      byYear,
      bySize,
      total:
        statsRaw.years && statsRaw.years.length > 0
          ? statsRaw.years.reduce((acc: number, row: any) => acc + row.count, 0)
          : Object.values(byCategory).reduce((acc, v) => acc + v, 0),
    };
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
    maxEmailCount?: number
  ): Promise<{ messages: gmail_v1.Schema$Message[]; errors: string[] }> {
    let messages: gmail_v1.Schema$Message[] = [];
    let errors: string[] = [];
    try {
      const response = await gmail.users.messages.list({
        userId: "me",
        labelIds: ["TRASH"],
        maxResults: maxEmailCount ?? 100,
      });

      const messages = response.data.messages || [];
      return { messages, errors };
    } catch (error) {
      errors.push(`Failed to list messages: ${error}`);
      return { messages, errors };
    }
  }

  async emptyTrash(
    trashOption: BasicDeletionOptions,
    userContext: { user_id: string; session_id: string }
  ): Promise<{ deleted: number; errors: string[] }> {
    let messages: gmail_v1.Schema$Message[] = [];
    const errors: string[] = [];
    let deleted = 0;
    try {
      const gmail = await this.authManager.getGmailClient(
        userContext.session_id
      );

      // Get all messages in trash
      const ListTrashResult = await this.listTrashEmails(
        gmail,
        trashOption?.maxCount
      );
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
    } = {},
    userContext?: { user_id: string; session_id: string }
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
              const result = userContext
                ? await this.performDeletion(safeEmails, userContext, false)
                : await this.performDeletion(safeEmails, {
                    user_id: "system", // System cleanup without user context
                    session_id: "default",
                  }, false);
              totalDeleted += result.deleted;
              totalFailed += safeEmails.length - result.deleted;
              allErrors.push(...result.errors);
            } else if (action === "archive") {
              // Archive instead of delete
              await this.archiveEmails(safeEmails, userContext?.user_id);
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
          const isTest = process.env.NODE_ENV === 'test' || process.env.CI === 'true';
          if (!isTest) {
            await new Promise((resolve) => setTimeout(resolve, delay_between_batches_ms));
          }
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
  private async archiveEmails(
    emails: EmailIndex[],
    userId?: string
  ): Promise<void> {
    if (!userId) {
      throw new Error('User ID is required for archiving emails');
    }

    // Get user-specific database manager
    const databaseManager = await this.getUserDatabaseManager(userId);

    const emailIds = emails.map((email) => email.id);
    await databaseManager.markEmailsAsDeleted(emailIds, userId);
  }

  /**
   * Get cleanup deletion statistics
   */
  async getCleanupDeletionStats(userContext?: {
    user_id: string;
    session_id: string;
  }): Promise<{
    deletable_by_category: Record<string, number>;
    deletable_by_age: Record<string, number>;
    total_deletable: number;
    total_storage_recoverable: number;
  }> {
    try {
      if (!userContext?.user_id) {
        throw new Error('User context is required for cleanup statistics');
      }

      // Get user-specific database manager
      const databaseManager = await this.getUserDatabaseManager(userContext.user_id);

      // Get all non-archived emails for the specific user
      const allEmails = await databaseManager.searchEmails({
        archived: false,
        user_id: userContext.user_id,
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
    }>,
    userContext?: { user_id: string; session_id: string }
  ): Promise<void> {
    // This would set up automatic deletion rules
    // For safety, this should be implemented with extreme caution
    logger.info("Auto-deletion rules would be configured here", {
      rules,
      userId: userContext?.user_id || "system",
    });

    // In a real implementation:
    // 1. Store rules in database
    // 2. Set up scheduled job to run rules
    // 3. Send notifications before deletion
    // 4. Keep audit log of all deletions
  }
}
