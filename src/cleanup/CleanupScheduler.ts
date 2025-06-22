import { RunResult } from "sqlite3";
import { DatabaseManager } from "../database/DatabaseManager.js";
import { CleanupPolicy } from "../types/index.js";
import { logger } from "../utils/logger.js";

/**
 * Schedule configuration for different types of cleanup schedules
 */
export interface ScheduleConfig {
  id: string;
  name: string;
  type: "cron" | "interval" | "daily" | "weekly" | "monthly";
  expression: string; // Cron expression or interval in ms
  policy_id: string;
  enabled: boolean;
  next_run: Date;
  last_run?: Date;
  created_at: Date;
  updated_at: Date;
  user_id?: string; // Optional user ID for multi-user support
}

/**
 * CleanupScheduler provides cron-like scheduling capabilities for automated cleanup.
 * It manages multiple schedule types and integrates with the automation engine.
 */
export class CleanupScheduler {
  private databaseManager: DatabaseManager;
  private automationEngine: any; // CleanupAutomationEngine - avoid circular dependency

  private schedules: Map<string, ScheduleConfig> = new Map();
  private schedulerIntervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning: boolean = false;

  constructor(automationEngine: any, databaseManager?: DatabaseManager) {
    this.automationEngine = automationEngine;
    this.databaseManager = databaseManager || DatabaseManager.getInstance();
  }

  /**
   * Initialize the scheduler
   */
  async initialize(): Promise<void> {
    try {
      await this.loadSchedules();
      logger.info("CleanupScheduler initialized", {
        schedules_count: this.schedules.size,
      });
    } catch (error) {
      logger.error("Failed to initialize CleanupScheduler:", error);
      throw error;
    }
  }

  /**
   * Start the scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("CleanupScheduler already running");
      return;
    }

    this.isRunning = true;

    // Start all enabled schedules
    for (const schedule of this.schedules.values()) {
      if (schedule.enabled) {
        await this.startSchedule(schedule);
      }
    }

    logger.info("CleanupScheduler started", {
      active_schedules: Array.from(this.schedules.values()).filter(
        (s) => s.enabled
      ).length,
    });
  }

  /**
   * Shutdown the scheduler
   */
  async shutdown(): Promise<void> {
    this.isRunning = false;

    // Clear all intervals
    for (const [scheduleId, intervalId] of this.schedulerIntervals.entries()) {
      clearInterval(intervalId);
      this.schedulerIntervals.delete(scheduleId);
    }

    logger.info("CleanupScheduler shutdown completed");
  }

  /**
   * Create a new schedule
   */
  /**
   * Create a new schedule with optional user context
   */
  async createSchedule(
    config: Omit<
      ScheduleConfig,
      "id" | "created_at" | "updated_at" | "next_run"
    >
  ): Promise<string> {
    try {
      const scheduleId = `schedule_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 11)}`;

      const schedule: ScheduleConfig = {
        ...config,
        id: scheduleId,
        next_run: this.calculateNextRun(config.type, config.expression),
        created_at: new Date(),
        updated_at: new Date(),
      };

      // Validate schedule
      this.validateSchedule(schedule);

      // Save to database
      await this.saveSchedule(schedule);

      // Add to memory
      this.schedules.set(scheduleId, schedule);

      // Start if enabled and scheduler is running
      if (schedule.enabled && this.isRunning) {
        await this.startSchedule(schedule);
      }

      logger.info("Schedule created", {
        schedule_id: scheduleId,
        type: schedule.type,
        policy_id: schedule.policy_id,
        enabled: schedule.enabled,
        next_run: schedule.next_run,
      });

      return scheduleId;
    } catch (error) {
      logger.error("Failed to create schedule:", error);
      throw error;
    }
  }

  /**
   * Update an existing schedule
   */
  async updateSchedule(
    scheduleId: string,
    updates: Partial<ScheduleConfig>
  ): Promise<void> {
    try {
      const existingSchedule = this.schedules.get(scheduleId);
      if (!existingSchedule) {
        throw new Error(`Schedule not found: ${scheduleId}`);
      }

      // Stop current schedule if running
      if (this.schedulerIntervals.has(scheduleId)) {
        clearInterval(this.schedulerIntervals.get(scheduleId)!);
        this.schedulerIntervals.delete(scheduleId);
      }

      // Apply updates
      const updatedSchedule: ScheduleConfig = {
        ...existingSchedule,
        ...updates,
        id: scheduleId, // Ensure ID doesn't change
        updated_at: new Date(),
      };

      // Recalculate next run if schedule changed
      if (updates.type || updates.expression) {
        updatedSchedule.next_run = this.calculateNextRun(
          updatedSchedule.type,
          updatedSchedule.expression
        );
      }

      // Validate updated schedule
      this.validateSchedule(updatedSchedule);

      // Save to database
      await this.saveSchedule(updatedSchedule);

      // Update in memory
      this.schedules.set(scheduleId, updatedSchedule);

      // Restart if enabled and scheduler is running
      if (updatedSchedule.enabled && this.isRunning) {
        await this.startSchedule(updatedSchedule);
      }

      logger.info("Schedule updated", {
        schedule_id: scheduleId,
        updates: Object.keys(updates),
        next_run: updatedSchedule.next_run,
      });
    } catch (error) {
      logger.error("Failed to update schedule:", error);
      throw error;
    }
  }

  /**
   * Delete a schedule
   */
  async deleteSchedule(scheduleId: string): Promise<void> {
    try {
      // Stop schedule if running
      if (this.schedulerIntervals.has(scheduleId)) {
        clearInterval(this.schedulerIntervals.get(scheduleId)!);
        this.schedulerIntervals.delete(scheduleId);
      }

      // Remove from database
      await this.databaseManager.execute(
        "DELETE FROM cleanup_automation_config WHERE id = ? AND config_type = ?",
        [scheduleId, "schedule"]
      );

      // Remove from memory
      this.schedules.delete(scheduleId);

      logger.info("Schedule deleted", { schedule_id: scheduleId });
    } catch (error) {
      logger.error("Failed to delete schedule:", error);
      throw error;
    }
  }

  /**
   * Get all schedules
   */
  getSchedules(): ScheduleConfig[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Get a specific schedule
   */
  getSchedule(scheduleId: string): ScheduleConfig | undefined {
    return this.schedules.get(scheduleId);
  }

  /**
   * Get active schedule count
   */
  getActiveScheduleCount(): number {
    return Array.from(this.schedules.values()).filter((s) => s.enabled).length;
  }

  /**
   * Get next scheduled time across all schedules
   */
  getNextScheduledTime(): Date | undefined {
    const activeTimes = Array.from(this.schedules.values())
      .filter((s) => s.enabled)
      .map((s) => s.next_run)
      .sort((a, b) => a.getTime() - b.getTime());

    return activeTimes.length > 0 ? activeTimes[0] : undefined;
  }

  /**
   * Enable or disable a schedule
   */
  async toggleSchedule(scheduleId: string, enabled: boolean): Promise<void> {
    await this.updateSchedule(scheduleId, { enabled });
  }

  /**
   * Start a specific schedule
   */
  private async startSchedule(schedule: ScheduleConfig): Promise<void> {
    // Clear existing interval if any
    if (this.schedulerIntervals.has(schedule.id)) {
      clearInterval(this.schedulerIntervals.get(schedule.id)!);
    }

    const intervalMs = this.getScheduleInterval(schedule);

    const intervalId = setInterval(async () => {
      try {
        await this.executeSchedule(schedule);
      } catch (error) {
        logger.error(`Schedule execution failed for ${schedule.id}:`, error);
      }
    }, intervalMs);

    this.schedulerIntervals.set(schedule.id, intervalId);

    logger.debug("Schedule started", {
      schedule_id: schedule.id,
      type: schedule.type,
      interval_ms: intervalMs,
      next_run: schedule.next_run,
    });
  }

  /**
   * Execute a schedule
   */
  /**
   * Execute a schedule for the specified user
   */
  private async executeSchedule(schedule: ScheduleConfig): Promise<void> {
    const now = new Date();

    // Check if it's time to run
    if (now < schedule.next_run) {
      return;
    }

    logger.info("Executing scheduled cleanup", {
      schedule_id: schedule.id,
      policy_id: schedule.policy_id,
      scheduled_time: schedule.next_run,
      actual_time: now,
    });

    try {
      // Trigger cleanup job through automation engine
      await this.automationEngine.triggerManualCleanup(schedule.policy_id, {
        dry_run: false,
        max_emails: undefined, // Use policy defaults
        user_id: schedule.user_id // Pass user_id for multi-user support
      });

      // Update last run and calculate next run
      const updatedSchedule: ScheduleConfig = {
        ...schedule,
        last_run: now,
        next_run: this.calculateNextRun(
          schedule.type,
          schedule.expression,
          now
        ),
        updated_at: now,
      };

      // Save updated schedule
      await this.saveSchedule(updatedSchedule);
      this.schedules.set(schedule.id, updatedSchedule);

      logger.info("Scheduled cleanup executed successfully", {
        schedule_id: schedule.id,
        next_run: updatedSchedule.next_run,
      });
    } catch (error) {
      logger.error("Scheduled cleanup execution failed:", error);
    }
  }

  /**
   * Calculate the next run time for a schedule
   */
  private calculateNextRun(
    type: string,
    expression: string,
    fromTime?: Date
  ): Date {
    const now = fromTime || new Date();

    switch (type) {
      case "daily":
        return this.calculateDailyNextRun(expression, now);

      case "weekly":
        return this.calculateWeeklyNextRun(expression, now);

      case "monthly":
        return this.calculateMonthlyNextRun(expression, now);

      case "interval":
        const intervalMs = parseInt(expression);
        return new Date(now.getTime() + intervalMs);

      case "cron":
        return this.calculateCronNextRun(expression, now);

      default:
        throw new Error(`Unsupported schedule type: ${type}`);
    }
  }

  /**
   * Calculate next run for daily schedule
   */
  private calculateDailyNextRun(timeExpression: string, fromTime: Date): Date {
    const [hours, minutes] = timeExpression.split(":").map(Number);
    const nextRun = new Date(fromTime);

    nextRun.setHours(hours, minutes, 0, 0);

    // If time has passed today, schedule for tomorrow
    if (nextRun <= fromTime) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun;
  }

  /**
   * Calculate next run for weekly schedule
   */
  private calculateWeeklyNextRun(
    dayTimeExpression: string,
    fromTime: Date
  ): Date {
    // Format: "monday:14:30" or "1:14:30" (0=Sunday, 1=Monday, etc.)
    const [dayPart, hours, minutes] = dayTimeExpression.split(":");

    let targetDay: number;
    if (isNaN(Number(dayPart))) {
      // Day name
      const dayNames = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      targetDay = dayNames.indexOf(dayPart.toLowerCase());
    } else {
      // Day number
      targetDay = Number(dayPart);
    }

    const nextRun = new Date(fromTime);
    const currentDay = nextRun.getDay();

    let daysToAdd = targetDay - currentDay;
    if (daysToAdd < 0) {
      daysToAdd += 7; // Next week
    } else if (daysToAdd === 0) {
      // Same day - check if time has passed
      nextRun.setHours(Number(hours), Number(minutes), 0, 0);
      if (nextRun <= fromTime) {
        daysToAdd = 7; // Next week
      }
    }

    nextRun.setDate(nextRun.getDate() + daysToAdd);
    nextRun.setHours(Number(hours), Number(minutes), 0, 0);

    return nextRun;
  }

  /**
   * Calculate next run for monthly schedule
   */
  private calculateMonthlyNextRun(
    dayTimeExpression: string,
    fromTime: Date
  ): Date {
    // Format: "15:14:30" (15th day of month at 14:30)
    const [day, hours, minutes] = dayTimeExpression.split(":").map(Number);

    const nextRun = new Date(fromTime);
    nextRun.setDate(day);
    nextRun.setHours(hours, minutes, 0, 0);

    // If time has passed this month, schedule for next month
    if (nextRun <= fromTime) {
      nextRun.setMonth(nextRun.getMonth() + 1);
    }

    return nextRun;
  }

  /**
   * Calculate next run for cron expression (simplified implementation)
   */
  private calculateCronNextRun(cronExpression: string, fromTime: Date): Date {
    // Simplified cron implementation - format: "minute hour day month dayOfWeek"
    // For now, just add 1 hour as a placeholder
    return new Date(fromTime.getTime() + 60 * 60 * 1000);
  }

  /**
   * Get the interval in milliseconds for checking schedule execution
   */
  private getScheduleInterval(schedule: ScheduleConfig): number {
    switch (schedule.type) {
      case "interval":
        return parseInt(schedule.expression);
      case "daily":
      case "weekly":
      case "monthly":
      case "cron":
        return 60 * 1000; // Check every minute
      default:
        return 60 * 1000;
    }
  }

  /**
   * Validate schedule configuration
   */
  private validateSchedule(schedule: ScheduleConfig): void {
    if (!schedule.name || schedule.name.trim().length === 0) {
      throw new Error("Schedule name is required");
    }

    if (!schedule.policy_id) {
      throw new Error("Policy ID is required");
    }

    if (!schedule.expression) {
      throw new Error("Schedule expression is required");
    }

    // Validate expression format based on type
    switch (schedule.type) {
      case "daily":
        if (!/^\d{1,2}:\d{2}$/.test(schedule.expression)) {
          throw new Error("Daily schedule expression must be in HH:MM format");
        }
        break;

      case "weekly":
        if (
          !/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d):\d{1,2}:\d{2}$/i.test(
            schedule.expression
          )
        ) {
          throw new Error(
            "Weekly schedule expression must be in day:HH:MM format"
          );
        }
        break;

      case "monthly":
        if (!/^\d{1,2}:\d{1,2}:\d{2}$/.test(schedule.expression)) {
          throw new Error(
            "Monthly schedule expression must be in DD:HH:MM format"
          );
        }
        break;

      case "interval":
        const interval = parseInt(schedule.expression);
        if (isNaN(interval) || interval < 60000) {
          // Minimum 1 minute
          throw new Error(
            "Interval expression must be a number >= 60000 (milliseconds)"
          );
        }
        break;

      case "cron":
        // Basic cron validation - more comprehensive validation could be added
        const parts = schedule.expression.split(" ");
        if (parts.length !== 5) {
          throw new Error(
            "Cron expression must have 5 parts: minute hour day month dayOfWeek"
          );
        }
        break;
    }
  }

  /**
   * Load schedules from database
   */
  /**
   * Load schedules from database with user filtering support
   */
  private async loadSchedules(): Promise<void> {
    try {
      const rows = await this.databaseManager["all"](
        "SELECT * FROM cleanup_automation_config WHERE config_type = ? AND enabled = 1",
        ["schedule"]
      );

      for (const row of rows) {
        try {
          const config = JSON.parse(row.config_data);
          const schedule: ScheduleConfig = {
            id: row.id.toString(),
            ...config,
            created_at: new Date(row.created_at * 1000),
            updated_at: new Date(row.updated_at * 1000),
            user_id: config.user_id // Ensure user_id is included
          };

          this.schedules.set(schedule.id, schedule);
        } catch (error) {
          logger.error(
            `Failed to parse schedule config for row ${row.id}:`,
            error
          );
        }
      }

      logger.info("Schedules loaded from database", {
        count: this.schedules.size,
      });
    } catch (error) {
      logger.error("Failed to load schedules from database:", error);
      // Continue with empty schedules rather than failing
    }
  }

  /**
   * Save schedule to database
   */
  private async saveSchedule(schedule: ScheduleConfig): Promise<number> {
    try {
      const configData = {
        name: schedule.name,
        type: schedule.type,
        expression: schedule.expression,
        policy_id: schedule.policy_id,
        enabled: schedule.enabled,
        next_run: schedule.next_run.toISOString(),
        last_run: schedule.last_run?.toISOString(),
        user_id: schedule.user_id // Include user_id in saved data
      };
      const configType = "schedule";
      const result: RunResult = (await this.databaseManager.execute(
        `INSERT OR REPLACE INTO cleanup_automation_config 
       (id, config_type, config_data, enabled, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?)`,
        [
          schedule.id ? parseInt(schedule.id) : undefined, // Ensure id is a number or undefined
          configType,
          JSON.stringify(configData),
          schedule.enabled ? 1 : 0, // Convert boolean to integer
          Math.floor(schedule.created_at.getTime() / 1000),
          Math.floor(schedule.updated_at.getTime() / 1000),
        ]
      )) as RunResult;
      return result.changes;
    } catch (error) {
      throw error;
    }
  }
}
