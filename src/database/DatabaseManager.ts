import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs/promises";
import { logger } from "../utils/logger.js";
import {
  EmailIndex,
  ArchiveRule,
  ArchiveRecord,
  SavedSearch,
  SearchCriteria,
  SearchEngineCriteria,
  Job,
} from "../types/index.js";

interface RunResult {
  lastID?: number; // For INSERT statements
  changes: number; // For INSERT, UPDATE, DELETE statements
}

export class DatabaseManager {
  private db: sqlite3.Database | null = null;
  private dbPath: string;
  private initialized: boolean = false;
  private instanceId: string = Math.random().toString(36).substr(2, 9);
  private userId: string | undefined;
  private pendingWrites: number = 0;
  private idlePromise: Promise<void> = Promise.resolve();
  private resolveIdle: (() => void) | null = null;
  
  /**
   * Create a new DatabaseManager instance
   * @param userId Optional user ID for multi-user mode
   */
  constructor(userId: string | undefined) {
    this.userId = userId;
    
    // Determine the project root directory using Node.js compatible approach
    // Since we know this file is in src/database, we can navigate up from current working directory
    const projectRoot = process.cwd();

    // Always resolve storage path relative to project root, not cwd or absolute
    const storagePath = path.join(
      projectRoot,
      process.env.STORAGE_PATH || "data"
    );
    
    // In multi-user mode, the dbPath will be set during initialization
    // For backward compatibility with single-user mode, set a default path
    if (userId) {
      this.dbPath = path.join(storagePath, "db", `user_${userId}_gmail-mcp.db`);
    } else {
      this.dbPath = path.join(storagePath, "gmail-mcp.db");
    }

    logger.debug(`DatabaseManager created for ${userId ? 'user ' + userId : 'single-user mode'} with ID: ${this.instanceId}`);
  }

  /**
   * Get the instance ID for this DatabaseManager
   */
  getInstanceId(): string {
    return this.instanceId;
  }
  
  /**
   * Get the user ID for this DatabaseManager
   */
  getUserId(): string | undefined {
    return this.userId;
  }
  
  /**
   * Create a new instance for a specific user
   * @param userId User ID to create instance for
   */
  static createForUser(userId: string): DatabaseManager {
    return new DatabaseManager(userId);
  }
  
  /**
   * Get a singleton instance (for backward compatibility with single-user mode)
   */
  // Static singleton instance for backward compatibility
  private static singletonInstance: DatabaseManager | null = null;
  
  static getInstance(): DatabaseManager {
    // This method is maintained for backward compatibility with single-user mode
    if (!this.singletonInstance) {
      this.singletonInstance = new DatabaseManager(undefined);
      logger.info(`DatabaseManager singleton created for single-user mode`);
    }
    
    return this.singletonInstance;
  }

  /**
   * Reset the singleton instance (for test isolation)
   */
  static resetInstance(): void {
    logger.info('DatabaseManager: Resetting singleton instance for test isolation');
    this.singletonInstance = null;
  }

  /**
   * Initialize the database
   * @param dbPath Optional path to use for the database file
   * @param useMigrations If true, skip manual schema creation (for test/migration-managed DBs)
   */
  async initialize(dbPath?: string, useMigrations: boolean = false): Promise<void> {
    if (this.initialized) {
      logger.info('DatabaseManager already initialized', {
        instanceId: this.instanceId,
        userId: this.userId,
        dbPath: this.dbPath,
        initialized: this.initialized,
        dbExists: this.db !== null,
        service: 'gmail-mcp-server',
        timestamp: new Date().toISOString()
      });
      return;
    }

    try {
      this.dbPath = dbPath || this.dbPath;
      const storageDir = path.dirname(this.dbPath);
      await fs.mkdir(storageDir, { recursive: true });

      // Open database
      await new Promise<void>((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) {
            logger.error('🔍 DIAGNOSTIC: Database connection failed', {
              instanceId: this.instanceId,
              userId: this.userId,
              error: err.message,
              service: 'gmail-mcp-server',
              timestamp: new Date().toISOString()
            });
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // Enable foreign keys
      await this.run("PRAGMA foreign_keys = ON");

      if (!useMigrations) {
      // Create tables
      await this.createTables();
      // Run migration for existing databases
      await this.migrateToAnalyzerSchema();
      }

      this.initialized = true;
      
      logger.info(`Database initialized at ${this.dbPath}`, {
        instanceId: this.instanceId,
        userId: this.userId,
        dbPath: this.dbPath
      });
    } catch (error) {
      logger.error("Failed to initialize database:", error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    try {
      const queries = [
        // Email index table (basic schema with user_id for multi-user support)
        `CREATE TABLE IF NOT EXISTS email_index (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        category TEXT CHECK(category IN ('high', 'medium', 'low')),
        subject TEXT,
        sender TEXT,
        recipients TEXT,
        date INTEGER,
        year INTEGER,
        size INTEGER,
        has_attachments INTEGER,
        labels TEXT,
        snippet TEXT,
        archived INTEGER DEFAULT 0,
        archive_date INTEGER,
        archive_location TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        user_id TEXT
      )`,

        // Create indexes for common queries
        `CREATE INDEX IF NOT EXISTS idx_email_category ON email_index(category)`,
        `CREATE INDEX IF NOT EXISTS idx_email_year ON email_index(year)`,
        `CREATE INDEX IF NOT EXISTS idx_email_size ON email_index(size)`,
        `CREATE INDEX IF NOT EXISTS idx_email_archived ON email_index(archived)`,
        `CREATE INDEX IF NOT EXISTS idx_email_date ON email_index(date)`,
        `CREATE INDEX IF NOT EXISTS idx_email_has_attachments ON email_index(has_attachments)`,
        // Add index for JSON label searches to improve performance
        `CREATE INDEX IF NOT EXISTS idx_email_labels ON email_index(labels)`,

        // Archive rules table
        `CREATE TABLE IF NOT EXISTS archive_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        criteria TEXT NOT NULL,
        action TEXT NOT NULL,
        schedule TEXT,
        enabled INTEGER DEFAULT 1,
        created INTEGER DEFAULT (strftime('%s', 'now')),
        last_run INTEGER,
        total_archived INTEGER DEFAULT 0,
        last_archived INTEGER DEFAULT 0
      )`,

        // Archive records table
        `CREATE TABLE IF NOT EXISTS archive_records (
        id TEXT PRIMARY KEY,
        email_ids TEXT NOT NULL,
        archive_date INTEGER NOT NULL,
        method TEXT NOT NULL,
        location TEXT,
        format TEXT,
        size INTEGER,
        restorable INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

        // Saved searches table (with user_id for multi-user support)
        `CREATE TABLE IF NOT EXISTS saved_searches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        criteria TEXT NOT NULL,
        created INTEGER DEFAULT (strftime('%s', 'now')),
        last_used INTEGER,
        result_count INTEGER,
        user_id TEXT
      )`,

        // Email cache table for performance
        `CREATE TABLE IF NOT EXISTS email_cache (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

        // Job status table for tracking async jobs
        `CREATE TABLE IF NOT EXISTS job_statuses (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
        request_params TEXT,
        progress INTEGER,
        results TEXT,
        error_details TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        user_id TEXT
      )`,

        // Create index for job status queries
        `CREATE INDEX IF NOT EXISTS idx_job_status ON job_statuses(status)`,
        `CREATE INDEX IF NOT EXISTS idx_job_type ON job_statuses(job_type)`,
        `CREATE INDEX IF NOT EXISTS idx_job_created_at ON job_statuses(created_at)`,

        // Email Cleanup System Tables

        // Email access tracking
        `CREATE TABLE IF NOT EXISTS email_access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id TEXT NOT NULL,
        access_type TEXT NOT NULL CHECK(access_type IN ('search_result', 'direct_view', 'thread_view')),
        timestamp INTEGER NOT NULL,
        search_query TEXT,
        user_context TEXT,
        FOREIGN KEY (email_id) REFERENCES email_index(id)
      )`,

        // Search activity tracking
        `CREATE TABLE IF NOT EXISTS search_activity (
        search_id TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        email_results TEXT, -- JSON array of email IDs
        result_interactions TEXT, -- JSON array of clicked email IDs
        timestamp INTEGER NOT NULL,
        result_count INTEGER
      )`,

        // Access pattern summary (optimized for queries)
        `CREATE TABLE IF NOT EXISTS email_access_summary (
        email_id TEXT PRIMARY KEY,
        total_accesses INTEGER DEFAULT 0,
        last_accessed INTEGER,
        search_appearances INTEGER DEFAULT 0,
        search_interactions INTEGER DEFAULT 0,
        access_score REAL DEFAULT 0,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (email_id) REFERENCES email_index(id)
      )`,

        // Cleanup policies storage
        `CREATE TABLE IF NOT EXISTS cleanup_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        priority INTEGER DEFAULT 50,
        criteria TEXT NOT NULL, -- JSON
        action TEXT NOT NULL,   -- JSON
        safety TEXT NOT NULL,   -- JSON
        schedule TEXT,          -- JSON, nullable
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

        // Policy execution history
        `CREATE TABLE IF NOT EXISTS policy_execution_history (
        execution_id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        emails_processed INTEGER DEFAULT 0,
        emails_cleaned INTEGER DEFAULT 0,
        errors_encountered INTEGER DEFAULT 0,
        success INTEGER DEFAULT 0,
        FOREIGN KEY (policy_id) REFERENCES cleanup_policies(id)
      )`,

        // System monitoring metrics
        `CREATE TABLE IF NOT EXISTS system_metrics (
        metric_id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        storage_usage_percent REAL,
        storage_used_bytes INTEGER,
        storage_total_bytes INTEGER,
        average_query_time_ms REAL,
        cache_hit_rate REAL,
        active_connections INTEGER,
        cleanup_rate_per_minute REAL,
        system_load_average REAL
      )`,

        // Cleanup automation configuration
        `CREATE TABLE IF NOT EXISTS cleanup_automation_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        config_type TEXT NOT NULL, -- 'schedule', 'policy', 'threshold'
        config_data TEXT NOT NULL, -- JSON configuration
        enabled INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

        // Cleanup execution history with learning data
        `CREATE TABLE IF NOT EXISTS cleanup_execution_history (
        execution_id TEXT PRIMARY KEY,
        job_id TEXT,
        policy_id TEXT,
        triggered_by TEXT, -- 'schedule', 'storage', 'performance', 'manual'
        start_time INTEGER,
        end_time INTEGER,
        emails_processed INTEGER,
        emails_cleaned INTEGER,
        storage_freed INTEGER,
        performance_impact REAL,
        user_complaints INTEGER DEFAULT 0,
        effectiveness_score REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

        // Cleanup job metadata table for specialized job data
        `CREATE TABLE IF NOT EXISTS cleanup_job_metadata (
        job_id TEXT PRIMARY KEY,
        policy_id TEXT,
        triggered_by TEXT NOT NULL CHECK(triggered_by IN (
          'schedule', 'storage_threshold', 'performance', 'user_request',
          'continuous', 'storage_warning', 'performance_degradation', 'storage_critical'
        )),
        priority TEXT NOT NULL CHECK(priority IN ('low', 'normal', 'high', 'emergency')),
        batch_size INTEGER NOT NULL,
        target_emails INTEGER NOT NULL,
        emails_analyzed INTEGER DEFAULT 0,
        emails_cleaned INTEGER DEFAULT 0,
        storage_freed INTEGER DEFAULT 0,
        errors_encountered INTEGER DEFAULT 0,
        current_batch INTEGER DEFAULT 0,
        total_batches INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        
        FOREIGN KEY (job_id) REFERENCES job_statuses(job_id) ON DELETE CASCADE
      )`,

        // Indexes for cleanup system performance
        `CREATE INDEX IF NOT EXISTS idx_access_log_email_id ON email_access_log(email_id)`,
        `CREATE INDEX IF NOT EXISTS idx_access_log_timestamp ON email_access_log(timestamp)`,
        `CREATE INDEX IF NOT EXISTS idx_search_activity_timestamp ON search_activity(timestamp)`,
        `CREATE INDEX IF NOT EXISTS idx_access_summary_score ON email_access_summary(access_score)`,
        `CREATE INDEX IF NOT EXISTS idx_cleanup_policies_enabled ON cleanup_policies(enabled)`,
        `CREATE INDEX IF NOT EXISTS idx_policy_execution_policy_id ON policy_execution_history(policy_id)`,
        `CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON system_metrics(timestamp)`,
        `CREATE INDEX IF NOT EXISTS idx_cleanup_execution_policy_id ON cleanup_execution_history(policy_id)`,
        `CREATE INDEX IF NOT EXISTS idx_cleanup_execution_triggered_by ON cleanup_execution_history(triggered_by)`,

        // Indexes for cleanup job metadata
        `CREATE INDEX IF NOT EXISTS idx_cleanup_metadata_policy_id ON cleanup_job_metadata(policy_id)`,
        `CREATE INDEX IF NOT EXISTS idx_cleanup_metadata_triggered_by ON cleanup_job_metadata(triggered_by)`,
        `CREATE INDEX IF NOT EXISTS idx_cleanup_metadata_priority ON cleanup_job_metadata(priority)`,
        `CREATE INDEX IF NOT EXISTS idx_cleanup_metadata_created_at ON cleanup_job_metadata(created_at)`,
      ];

      for (const query of queries) {
        await this.run(query);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Migrates existing database schema to include analyzer result columns
   */
  async migrateToAnalyzerSchema(): Promise<void> {
    try {
      // Check if email_index table exists first
      const tableExists = await this.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='email_index'"
      );

      if (!tableExists) {
        logger.info("email_index table does not exist yet, skipping migration");
        return;
      }

      // Check if migration is needed by checking if importance_score column exists
      const tableInfo = await this.all("PRAGMA table_info(email_index)");
      const hasAnalyzerColumns = tableInfo.some(
        (col: any) => col.name === "importance_score"
      );

      if (hasAnalyzerColumns) {
        logger.info(
          "Database already has analyzer columns, skipping migration"
        );
        return;
      }

      logger.info("Starting database migration to add analyzer result columns");

      // Add new columns for analyzer results (without CHECK constraints for ALTER TABLE)
      const migrationQueries = [
        // Importance Analysis Results
        "ALTER TABLE email_index ADD COLUMN importance_score REAL",
        "ALTER TABLE email_index ADD COLUMN importance_level TEXT",
        "ALTER TABLE email_index ADD COLUMN importance_matched_rules TEXT",
        "ALTER TABLE email_index ADD COLUMN importance_confidence REAL",

        // Date/Size Analysis Results
        "ALTER TABLE email_index ADD COLUMN age_category TEXT",
        "ALTER TABLE email_index ADD COLUMN size_category TEXT",
        "ALTER TABLE email_index ADD COLUMN recency_score REAL",
        "ALTER TABLE email_index ADD COLUMN size_penalty REAL",

        // Label Classification Results
        "ALTER TABLE email_index ADD COLUMN gmail_category TEXT",
        "ALTER TABLE email_index ADD COLUMN spam_score REAL",
        "ALTER TABLE email_index ADD COLUMN promotional_score REAL",
        "ALTER TABLE email_index ADD COLUMN social_score REAL",
        "ALTER TABLE email_index ADD COLUMN spam_indicators TEXT",
        "ALTER TABLE email_index ADD COLUMN promotional_indicators TEXT",
        "ALTER TABLE email_index ADD COLUMN social_indicators TEXT",

        // Analysis Metadata
        "ALTER TABLE email_index ADD COLUMN analysis_timestamp INTEGER",
        "ALTER TABLE email_index ADD COLUMN analysis_version TEXT",
      ];

      // Execute migration queries
      for (const query of migrationQueries) {
        try {
          await this.run(query);
        } catch (error: any) {
          // Ignore "duplicate column name" errors as they indicate the column already exists
          if (!error.message.includes("duplicate column name")) {
            throw error;
          }
        }
      }

      // Create new indexes
      const indexQueries = [
        "CREATE INDEX IF NOT EXISTS idx_email_importance_level ON email_index(importance_level)",
        "CREATE INDEX IF NOT EXISTS idx_email_importance_score ON email_index(importance_score)",
        "CREATE INDEX IF NOT EXISTS idx_email_age_category ON email_index(age_category)",
        "CREATE INDEX IF NOT EXISTS idx_email_size_category ON email_index(size_category)",
        "CREATE INDEX IF NOT EXISTS idx_email_gmail_category ON email_index(gmail_category)",
        "CREATE INDEX IF NOT EXISTS idx_email_spam_score ON email_index(spam_score)",
        "CREATE INDEX IF NOT EXISTS idx_email_analysis_timestamp ON email_index(analysis_timestamp)",
      ];

      for (const query of indexQueries) {
        await this.run(query);
      }

      logger.info("Database migration completed successfully");
    } catch (error) {
      logger.error("Database migration failed:", error);
      throw error;
    }
  }

  // Method for executing DML/DDL statements (INSERT, UPDATE, DELETE, CREATE, ALTER)
  // Now returns RunResult for INSERT/UPDATE/DELETE, or void for others.
  private run(sql: string, params: any[] = []): Promise<RunResult | void> {
    return new Promise(async (resolve, reject) => {

      if (!this.db) {
        logger.error('🔍 DIAGNOSTIC: Database connection is null in run(), attempting reconnection', {
          dbExists: this.db !== null,
          initialized: this.initialized,
          instanceId: this.instanceId,
          userId: this.userId,
          dbPath: this.dbPath,
          service: 'gmail-mcp-server',
          timestamp: new Date().toISOString(),
          stackTrace: new Error().stack
        });
        this.incrementWrites();
        // Attempt automatic reconnection for test environments
        try {
          //await this.reconnect();
        } catch (reconnectError) {
          logger.error('🔍 DIAGNOSTIC: Database reconnection failed', {
            instanceId: this.instanceId,
            userId: this.userId,
            reconnectError: reconnectError instanceof Error ? reconnectError.message : 'Unknown error',
            service: 'gmail-mcp-server',
            timestamp: new Date().toISOString()
          });
          reject(new Error('Database not initialized and reconnection failed'));
          return;
        }
      }
      // If params is a 2D array, treat as multiple runs in a transaction
      if (Array.isArray(params[0])) {
        this.db!.serialize(() => {
          this.db!.run("BEGIN TRANSACTION", (beginErr) => {
            if (beginErr) {
              return reject(beginErr);
            }

            let totalChanges = 0;
            let transactionError: Error | null = null;

            for (const paramSet of params) {
              // Using a bound function to capture 'this' for each run
              this.db!.run(sql, paramSet, function (err) {
                if (err) {
                  transactionError = err;
                  // Log the error but continue to allow the transaction to rollback
                  console.error(
                    `Error during batch run for query "${sql}" with params ${paramSet}:`,
                    err
                  );
                  // We can't directly reject here as it's inside a loop and would not
                  // allow the transaction to rollback properly from this context.
                  // Instead, we mark an error and handle it in the COMMIT/ROLLBACK callback.
                } else {
                  // Handle cases where context might be undefined (e.g., in test environments)
                  const changes =
                    this && typeof this.changes === "number" ? this.changes : 0;
                  totalChanges += changes; // Accumulate changes
                }
              });
            }

            if (transactionError) {
              this.db!.run("ROLLBACK", (rollbackErr) => {
                if (rollbackErr) {
                  console.error(
                    "Error during transaction rollback:",
                    rollbackErr
                  );
                  reject(
                    new Error(
                      `Transaction failed: ${transactionError?.message}. Also, rollback failed: ${rollbackErr.message}`
                    )
                  );
                } else {
                  reject(transactionError); // Reject with the original transaction error
                }
              });
            } else {
              this.db!.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  // If commit fails, attempt rollback
                  this.db!.run("ROLLBACK", (rollbackDuringCommitErr) => {
                    if (rollbackDuringCommitErr) {
                      console.error(
                        "Error during commit and subsequent rollback:",
                        rollbackDuringCommitErr
                      );
                      reject(
                        new Error(
                          `Commit failed: ${commitErr.message}. Also, rollback during commit failed: ${rollbackDuringCommitErr.message}`
                        )
                      );
                    } else {
                      reject(commitErr); // Reject with the commit error
                    }
                  });
                } else {
                  // For batch operations, we return the total changes across all statements
                  resolve({ changes: totalChanges });
                }
              });
            }
          });
        });
      } else {
        // Single run
        this.db!.run(sql, params, function (err) {
          if (err) {
            reject(err);
          } else {
            // 'this' refers to the statement object in the callback
            // It has 'lastID' for inserts and 'changes' for inserts/updates/deletes
            // Handle cases where context might be undefined (e.g., in test environments)
            const changes =
              this && typeof this.changes === "number" ? this.changes : 0;
            const lastID =
              this && typeof this.lastID === "number" ? this.lastID : undefined;

            const result: RunResult = {
              changes: changes, // Number of rows actually changed
              lastID: lastID, // ID of the last inserted row
            };
            resolve(result);
          }
        });
      }
    });
  }

  // Public methods for database operations
  
  /**
   * Execute non-query operations (INSERT, UPDATE, DELETE, CREATE, ALTER)
   * Returns RunResult for DML, or void for DDL
   */
  public execute(sql: string, params: any[] = []): Promise<RunResult | void> {
    return this.run(sql, params);
  }
  
  /**
   * Execute a query that returns a single row
   * @param sql SQL query
   * @param params Query parameters
   */
  public async query<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    return this.get(sql, params) as Promise<T | null>;
  }
  
  /**
   * Execute a query that returns multiple rows
   * @param sql SQL query
   * @param params Query parameters
   */
  public async queryAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.all(sql, params) as Promise<T[]>;
  }

  private get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      // Add initialization check and diagnostic logging
      if (this.db === null) {
        const errorMsg = `DatabaseManager.get() called before database initialization. DB state: null, initialized: ${
          this.initialized
        }, instanceId: ${this.getInstanceId()}, userId: ${this.userId}`;
        logger.error(errorMsg, { sql, params, stackTrace: new Error().stack });
        reject(new Error(errorMsg));
        return;
      }

      if (!this.initialized) {
        const warningMsg = `DatabaseManager.get() called while database is initializing. DB exists: ${!!this
          .db}, initialized: ${
          this.initialized
        }, instanceId: ${this.getInstanceId()}, userId: ${this.userId}`;
        // logger.warn(warningMsg, { sql, params });
      } else {
        logger.info(
          `DatabaseManager.get() accessing initialized database (instanceId: ${this.getInstanceId()}, userId: ${this.userId})`,
          { sql }
        );
      }

      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private async all(sql: string, params: any[] = []): Promise<any[]> {
    try {

      if (!this.db) {
        logger.error('🔍 DIAGNOSTIC: Database connection is null in all(), attempting reconnection', {
          dbExists: this.db !== null,
          initialized: this.initialized,
          instanceId: this.instanceId,
          userId: this.userId,
          dbPath: this.dbPath,
          service: 'gmail-mcp-server',
          timestamp: new Date().toISOString(),
          stackTrace: new Error().stack
        });
        
        // Attempt automatic reconnection for test environments
        try {
          //await this.reconnect();
        } catch (reconnectError) {
          logger.error('🔍 DIAGNOSTIC: Database reconnection failed in all()', {
            instanceId: this.instanceId,
            userId: this.userId,
            reconnectError: reconnectError instanceof Error ? reconnectError.message : 'Unknown error',
            service: 'gmail-mcp-server',
            timestamp: new Date().toISOString()
          });
          throw new Error('Database not initialized and reconnection failed');
        }
      }

      const rawSqlString = this.getInterpolatedSql(sql, params);
      return new Promise((resolve, reject) => {
        this.db!.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else return resolve(rows);
        });
      });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Reconstructs the raw SQL query string by interpolating parameters.
   * WARNING: This function is for debugging/logging ONLY.
   * DO NOT use the output of this function to execute queries against a database,
   * as it is highly susceptible to SQL injection if not perfectly robust.
   *
   * @param sql The SQL query template with placeholders (e.g., ?, $param).
   * @param params An array for positional parameters or an object for named parameters.
   * @returns The fully interpolated SQL string.
   */
  private getInterpolatedSql(sql: string, params: any): string {
    let interpolatedSql = sql;

    if (Array.isArray(params)) {
      // Handle positional parameters '?'
      let paramIndex = 0;
      interpolatedSql = interpolatedSql.replace(/\?/g, () => {
        if (paramIndex < params.length) {
          return this.escapeSqlValue(params[paramIndex++]);
        } else {
          console.warn(
            `SQL Interpolation Warning: Not enough parameters for '?' placeholder in query: ${sql}`
          );
          return "MISSING_PARAM"; // Indicate a missing parameter
        }
      });
    } else if (typeof params === "object" && params !== null) {
      // Handle named parameters ($name, :name, @name)
      // Note: SQLite typically uses $name for named parameters
      interpolatedSql = interpolatedSql.replace(
        /(\$|:|\@)([a-zA-Z0-9_]+)/g,
        (match, prefix, paramName) => {
          const key = prefix + paramName; // Reconstruct the key ($name, :name, etc.)
          if (params.hasOwnProperty(key)) {
            return this.escapeSqlValue(params[key]);
          } else if (params.hasOwnProperty(paramName)) {
            // Also check without prefix if the driver is flexible
            return this.escapeSqlValue(params[paramName]);
          }
          console.warn(
            `SQL Interpolation Warning: Named parameter '${key}' not found in params object for query: ${sql}`
          );
          return `MISSING_PARAM_${paramName}`; // Indicate a missing named parameter
        }
      );
    } else if (params !== undefined && params !== null) {
      console.warn(
        `SQL Interpolation Warning: Unexpected type for params. Expected Array or Object, got ${typeof params}. SQL: ${sql}`
      );
    }

    return interpolatedSql;
  }

  private escapeSqlValue(value: any): string {
    if (value === null || typeof value === "undefined") {
      return "NULL";
    }
    switch (typeof value) {
      case "string":
        // Escape single quotes by doubling them
        return `'${value.replace(/'/g, "''")}'`;
      case "number":
      case "boolean": // SQLite treats true as 1, false as 0
        return String(value);
      default:
        // For other types (e.g., Buffer), you might need to convert to hex blob or string
        // For simplicity, we'll stringify, but be aware this might not be correct for all types
        console.warn(
          `Warning: Unhandled type for SQL interpolation: ${typeof value}. Stringifying.`
        );
        return `'${String(value).replace(/'/g, "''")}'`;
    }
  }

  // Email index methods
  async upsertEmailIndex(email: EmailIndex, userId?: string): Promise<void> {
    // Use the provided userId, or fall back to email.user_id, or finally instance userId
    const ownerUserId = userId || email.user_id || this.userId;
    
    const sql = `
      INSERT OR REPLACE INTO email_index (
        id, thread_id, category, subject, sender, recipients,
        date, year, size, has_attachments, labels, snippet,
        archived, archive_date, archive_location,
        importance_score, importance_level, importance_matched_rules, importance_confidence,
        age_category, size_category, recency_score, size_penalty,
        gmail_category, spam_score, promotional_score, social_score,
        spam_indicators, promotional_indicators, social_indicators,
        analysis_timestamp, analysis_version, updated_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), ?)
    `;

    await this.run(sql, [
      email.id,
      email.threadId,
      email.category,
      email.subject,
      email.sender,
      JSON.stringify(email.recipients),
      email.date ? email.date.getTime() : Date.now(),
      email?.year,
      email?.size,
      email?.hasAttachments ? 1 : 0,
      JSON.stringify(email?.labels),
      email?.snippet,
      email?.archived ? 1 : 0,
      email?.archiveDate?.getTime() || null,
      email?.archiveLocation || null,
      // Importance Analysis Results
      email?.importanceScore ?? null,
      email?.importanceLevel ?? null,
      email?.importanceMatchedRules
        ? JSON.stringify(email.importanceMatchedRules)
        : null,
      email?.importanceConfidence ?? null,
      // Date/Size Analysis Results
      email?.ageCategory ?? null,
      email?.sizeCategory ?? null,
      email?.recencyScore ?? null,
      email?.sizePenalty ?? null,
      // Label Classification Results
      email?.gmailCategory ?? null,
      email?.spam_score ?? null,
      email?.promotional_score ?? null,
      email?.socialScore ?? null,
      email?.spamIndicators ? JSON.stringify(email.spamIndicators) : null,
      email?.promotionalIndicators
        ? JSON.stringify(email.promotionalIndicators)
        : null,
      email?.socialIndicators ? JSON.stringify(email.socialIndicators) : null,
      // Analysis Metadata
      email?.analysisTimestamp?.getTime() || null,
      email?.analysisVersion || null,
      // User ID for multi-user support
      ownerUserId || null,
    ]);
  }

  async bulkUpsertEmailIndex(emails: EmailIndex[], userId?: string): Promise<void> {
    // Use the provided userId or fall back to the instance userId
    // Note: For bulk operations, we use the provided userId for all emails
    const ownerUserId = userId || this.userId;
    
    const sql = `
      INSERT OR REPLACE INTO email_index (
        id, thread_id, category, subject, sender, recipients,
        date, year, size, has_attachments, labels, snippet,
        archived, archive_date, archive_location,
        importance_score, importance_level, importance_matched_rules, importance_confidence,
        age_category, size_category, recency_score, size_penalty,
        gmail_category, spam_score, promotional_score, social_score,
        spam_indicators, promotional_indicators, social_indicators,
        analysis_timestamp, analysis_version, updated_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'), ?)
    `;
    const paramSets = emails.map((email) => [
      email.id,
      email.threadId,
      email.category,
      email.subject,
      email.sender,
      JSON.stringify(email.recipients),
      email.date ? email.date.getTime() : Date.now(),
      email.year,
      email.size,
      email.hasAttachments ? 1 : 0,
      JSON.stringify(email.labels),
      email.snippet,
      email.archived ? 1 : 0,
      email.archiveDate ? email.archiveDate.getTime() : null,
      email.archiveLocation || null,
      // Importance Analysis Results
      email?.importanceScore ?? null,
      email?.importanceLevel ?? null,
      email?.importanceMatchedRules
        ? JSON.stringify(email.importanceMatchedRules)
        : null,
      email?.importanceConfidence ?? null,
      // Date/Size Analysis Results
      email?.ageCategory ?? null,
      email?.sizeCategory ?? null,
      email?.recencyScore ?? null,
      email?.sizePenalty ?? null,
      // Label Classification Results
      email?.gmailCategory ?? null,
      email?.spam_score ?? null,
      email?.promotional_score ?? null,
      email?.socialScore ?? null,
      email?.spamIndicators ? JSON.stringify(email.spamIndicators) : null,
      email?.promotionalIndicators
        ? JSON.stringify(email.promotionalIndicators)
        : null,
      email?.socialIndicators ? JSON.stringify(email.socialIndicators) : null,
      // Analysis Metadata
      email?.analysisTimestamp?.getTime() || null,
      email?.analysisVersion || null,
      // User ID for multi-user support - use email's user_id if available
      email.user_id || ownerUserId || null,
    ]);
    await this.run(sql, paramSets);
  }

  async getEmailIndex(id: string): Promise<EmailIndex | null> {
    const row = await this.get("SELECT * FROM email_index WHERE id = ?", [id]);
    return row ? this.rowToEmailIndex(row) : null;
  }

  /**
   * Search emails with user context for multi-user support
   * @param criteria Search criteria including optional user_id
   */
  async searchEmails(criteria: SearchEngineCriteria): Promise<EmailIndex[]> {
    let sql = "SELECT *,COUNT(*) OVER () AS total_email_count FROM email_index WHERE 1=1";
    const params: any[] = [];

    // Filter by user_id if provided in criteria or available in the instance
    const userIdToUse = criteria.user_id || this.userId;
    if (userIdToUse) {
      sql += " AND user_id = ?";
      params.push(userIdToUse);
    }

    if (criteria?.category === null) {
      sql += " AND category IS NULL";
    } else if (criteria?.category) {
      sql += " AND category = ?";
      params.push(criteria.category);
    }

    if(criteria?.categories) {
      const placeholders = criteria.categories.map(() => "?").join(", ");
      sql += ` AND category IN (${placeholders})`; // Insert the placeholders into the SQL
      params.push(...criteria.categories);
    }

    if (criteria?.ids) {
      const placeholders = criteria.ids.map(() => "?").join(", ");
      sql += ` AND id IN (${placeholders})`; // Insert the placeholders into the SQL
      params.push(...criteria.ids);
    }

    if (criteria.year) {
      sql += " AND year = ?";
      params.push(criteria.year);
    }

    if (criteria.yearRange) {
      if (criteria.yearRange.start) {
        sql += " AND year >= ?";
        params.push(criteria.yearRange.start);
      }
      if (criteria.yearRange.end) {
        sql += " AND year <= ?";
        params.push(criteria.yearRange.end);
      }
    }

    if (criteria.sizeRange) {
      if (criteria.sizeRange.min) {
        sql += " AND size >= ?";
        params.push(criteria.sizeRange.min);
      }
      if (criteria.sizeRange.max) {
        sql += " AND size <= ?";
        params.push(criteria.sizeRange.max);
      }
    }

    if (criteria.archived !== undefined) {
      sql += " AND archived = ?";
      params.push(criteria.archived ? 1 : 0);
    }

    if (criteria.sender) {
      sql += " AND sender LIKE ?";
      params.push(`%${criteria.sender}%`);
    }

    // Add SQL-level filtering for labels
    if (criteria.labels && criteria.labels.length > 0) {
      criteria.labels.forEach(label => {
        // This ensures each specified label is in the JSON array
        // JSON_EXTRACT with ->> operator extracts text without quotes for comparison
        sql += " AND JSON_EXTRACT(labels, '$') LIKE ?";
        // Escape special characters in the label and ensure it's a complete JSON string match
        params.push(`%"${label.replace(/"/g, '\\"')}"%`);
      });
    }

    // Add SQL-level filtering for hasAttachments
    if (typeof criteria.hasAttachments === 'boolean') {
      sql += " AND has_attachments = ?";
      params.push(criteria.hasAttachments ? 1 : 0);
    }

    sql += " ORDER BY date DESC";

    if (criteria.limit) {
      sql += " LIMIT ?";
      params.push(criteria.limit);

      if (criteria.offset) {
        sql += " OFFSET ?";
        params.push(criteria.offset);
      }
    }

    const rows = await this.all(sql, params);
    if (process.env.NODE_ENV !== 'production') {
      console.log('[DEBUG] searchEmails SQL:', sql);
      console.log('[DEBUG] searchEmails params:', params);
    }
    return rows.map((row) => this.rowToEmailIndex(row));
  }

  private rowToEmailIndex(row: any): EmailIndex {
    return {
      id: row.id,
      threadId: row.thread_id,
      category: row.category,
      subject: row.subject,
      sender: row.sender,
      recipients: JSON.parse(row.recipients),
      date: new Date(row.date),
      year: row.year,
      size: row.size,
      hasAttachments: row.has_attachments === 1,
      labels: JSON.parse(row.labels),
      snippet: row.snippet,
      archived: row.archived === 1,
      archiveDate: row.archive_date ? new Date(row.archive_date) : undefined,
      archiveLocation: row.archive_location,
      user_id: row.user_id || undefined,  // Added for multi-user support

      // Importance Analysis Results
      importanceScore: row.importance_score ?? undefined,
      importanceLevel: row.importance_level ?? undefined,
      importanceMatchedRules: row.importance_matched_rules
        ? JSON.parse(row.importance_matched_rules)
        : undefined,
      importanceConfidence: row.importance_confidence ?? undefined,

      // Date/Size Analysis Results
      ageCategory: row.age_category ?? undefined,
      sizeCategory: row.size_category ?? undefined,
      recencyScore: row.recency_score ?? undefined,
      sizePenalty: row.size_penalty ?? undefined,

      // Label Classification Results
      gmailCategory: row.gmail_category ?? undefined,
      spam_score: row.spam_score ?? undefined,
      promotional_score: row.promotional_score ?? undefined,
      socialScore: row.social_score ?? undefined,
      spamIndicators: row.spam_indicators
        ? JSON.parse(row.spam_indicators)
        : undefined,
      promotionalIndicators: row.promotional_indicators
        ? JSON.parse(row.promotional_indicators)
        : undefined,
      socialIndicators: row.social_indicators
        ? JSON.parse(row.social_indicators)
        : undefined,

      // Analysis Metadata
      analysisTimestamp: row.analysis_timestamp
        ? new Date(row.analysis_timestamp)
        : undefined,
      analysisVersion: row.analysis_version || undefined,
      totalEmailCount: row.total_email_count || undefined,
    };
  }

  async getEmailsByIds(ids: string[]): Promise<EmailIndex[]> {
    const sql = `SELECT * FROM email_index WHERE id IN (${ids
      .map(() => "?")
      .join(", ")})`;
    const rows = await this.all(sql, ids);
    return rows.map((row) => this.rowToEmailIndex(row));
  }

  // Archive rule methods
  async createArchiveRule(
    rule: Omit<ArchiveRule, "id" | "created" | "stats">
  ): Promise<string> {
    const id = `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const sql = `
      INSERT INTO archive_rules (id, name, criteria, action, schedule, enabled)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.run(sql, [
      id,
      rule.name,
      JSON.stringify(rule.criteria),
      JSON.stringify(rule.action),
      rule.schedule || null,
      rule.enabled ? 1 : 0,
    ]);

    return id;
  }

  /**
   * Get archive rules with user context for multi-user support
   * @param activeOnly Filter for enabled rules only
   * @param userId Optional user ID (defaults to the instance's user ID)
   */
  async getArchiveRules(activeOnly: boolean = false, userId?: string): Promise<ArchiveRule[]> {
    // Use the provided userId or fall back to the instance userId
    const ownerUserId = userId || this.userId;
    
    let sql = "SELECT * FROM archive_rules";
    const params: any[] = [];
    
    // Build WHERE clause conditions
    const conditions: string[] = [];
    
    // Filter by user_id if we're in multi-user mode
    if (ownerUserId) {
      conditions.push("user_id = ?");
      params.push(ownerUserId);
    }
    
    // Filter by enabled status if requested
    if (activeOnly) {
      conditions.push("enabled = 1");
    }
    
    // Add WHERE clause if we have conditions
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    
    sql += " ORDER BY created DESC";

    const rows = await this.all(sql, params);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      criteria: JSON.parse(row.criteria),
      action: JSON.parse(row.action),
      schedule: row.schedule,
      enabled: row.enabled === 1,
      created: new Date(row.created * 1000),
      lastRun: row.last_run ? new Date(row.last_run * 1000) : undefined,
      stats: {
        totalArchived: row.total_archived,
        lastArchived: row.last_archived,
      },
    }));
  }

  // Archive record methods
  async createArchiveRecord(
    record: Omit<ArchiveRecord, "id">
  ): Promise<string> {
    const id = `archive_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const sql = `
      INSERT INTO archive_records (
        id, email_ids, archive_date, method, location, format, size, restorable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.run(sql, [
      id,
      JSON.stringify(record.emailIds),
      record.archiveDate.getTime(),
      record.method,
      record.location || null,
      record.format || null,
      record.size || null,
      record.restorable ? 1 : 0,
    ]);

    return id;
  }

  // Saved search methods
  /**
   * Save a search with user context for multi-user support
   * @param name Name of the saved search
   * @param criteria Search criteria to save
   * @param userId ID of the user who owns this search
   */
  async saveSearch(name: string, criteria: any, userId?: string): Promise<string> {
    const id = `search_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    // Use the provided userId or fall back to the instance userId
    const ownerUserId = userId || this.userId;

    const sql = `
      INSERT INTO saved_searches (id, name, criteria, user_id)
      VALUES (?, ?, ?, ?)
    `;

    await this.run(sql, [id, name, JSON.stringify(criteria), ownerUserId]);
    return id;
  }

  /**
   * Get saved searches for a specific user
   * @param userId Optional user ID (defaults to the instance's user ID)
   */
  async getSavedSearches(userId?: string): Promise<SavedSearch[]> {
    // Use the provided userId or fall back to the instance userId
    const ownerUserId = userId || this.userId;
    
    let sql = "SELECT * FROM saved_searches";
    const params: any[] = [];
    
    // Filter by user_id if we're in multi-user mode
    if (ownerUserId) {
      sql += " WHERE user_id = ?";
      params.push(ownerUserId);
    }
    
    sql += " ORDER BY created DESC";
    
    const rows = await this.all(sql, params);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      criteria: JSON.parse(row.criteria),
      created: new Date(row.created * 1000),
      lastUsed: row.last_used
        ? new Date(row.last_used * 1000)
        : new Date(row.created * 1000),
      resultCount: row.result_count,
      user_id: row.user_id || this.userId || 'default',
    }));
  }

  // Get email count based on criteria
  async getEmailCount(criteria: any): Promise<number> {
    let sql = "SELECT COUNT(*) as count FROM email_index WHERE 1=1";
    const params: any[] = [];

    if (criteria.category) {
      sql += " AND category = ?";
      params.push(criteria.category);
    }

    if (criteria.year) {
      sql += " AND year = ?";
      params.push(criteria.year);
    }

    if (criteria.yearRange) {
      if (criteria.yearRange.start) {
        sql += " AND year >= ?";
        params.push(criteria.yearRange.start);
      }
      if (criteria.yearRange.end) {
        sql += " AND year <= ?";
        params.push(criteria.yearRange.end);
      }
    }

    if (criteria.sizeRange) {
      if (criteria.sizeRange.min) {
        sql += " AND size >= ?";
        params.push(criteria.sizeRange.min);
      }
      if (criteria.sizeRange.max) {
        sql += " AND size <= ?";
        params.push(criteria.sizeRange.max);
      }
    }

    if (criteria.archived !== undefined) {
      sql += " AND archived = ?";
      params.push(criteria.archived ? 1 : 0);
    }

    if (criteria.sender) {
      sql += " AND sender LIKE ?";
      params.push(`%${criteria.sender}%`);
    }

    const result = await this.get(sql, params);
    return result ? result.count : 0;
  }

  // Statistics methods
  async getEmailStatistics(includeArchived: boolean = true, userId?: string): Promise<any> {
    // Use the provided userId or fall back to the instance userId
    const ownerUserId = userId || this.userId;
    
    // Base condition for filtering by archived status
    const archivedCondition = includeArchived ? "" : " AND archived = 0";
    
    // User filtering condition
    const userCondition = ownerUserId ? " AND user_id = ?" : "";
    const userParams = ownerUserId ? [ownerUserId] : [];
    
    // Category stats
    const categoryStats = await this.all(`
      SELECT category, COUNT(*) as count
      FROM email_index
      WHERE category IS NOT NULL ${archivedCondition} ${userCondition}
      GROUP BY category
    `, userParams);

    // Year stats
    const yearStats = await this.all(`
      SELECT year, COUNT(*) as count, SUM(size) as total_size
      FROM email_index
      WHERE year IS NOT NULL ${archivedCondition} ${userCondition}
      GROUP BY year
      ORDER BY year DESC
    `, userParams);

    // Size stats
    const sizeStats = await this.get(`
      SELECT
        SUM(CASE WHEN size < 102400 THEN 1 ELSE 0 END) as small,
        SUM(CASE WHEN size >= 102400 AND size < 1048576 THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN size >= 1048576 THEN 1 ELSE 0 END) as large,
        SUM(size) as total_size
      FROM email_index
      WHERE 1=1 ${archivedCondition} ${userCondition}
    `, userParams);

    // Archive stats
    const archiveStats = await this.get(`
      SELECT COUNT(*) as count, SUM(size) as total_size
      FROM email_index
      WHERE archived = 1 ${userCondition}
    `, userParams);

    return {
      categories: categoryStats,
      years: yearStats,
      sizes: sizeStats,
      archived: archiveStats,
    };
  }

  // mark emails as deleted
  async markEmailsAsDeleted(emailIds: string[], userId?: string): Promise<void> {
    if (emailIds.length === 0) return;
    
    // Use the provided userId or fall back to the instance userId
    const ownerUserId = userId || this.userId;
    
    let sql = `
    UPDATE email_index
    SET archived = 1, archive_location = ?, archive_date = strftime('%s', 'now')
    WHERE id IN (${emailIds.map(() => "?").join(", ")})`;
    
    // Add user filtering for multi-user support if a user ID is available
    const params = ["trash", ...emailIds];
    
    if (ownerUserId) {
      sql += ` AND user_id = ?`;
      params.push(ownerUserId);
    }
    
    await this.run(sql, params);
  }

  async deleteEmailIds(emails: EmailIndex[], userId?: string): Promise<number> {
    if (emails.length === 0) return 0;
    
    // Use the provided userId or fall back to the instance userId
    const ownerUserId = userId || this.userId;
    
    console.log('🔍 DIAGNOSTIC: DatabaseManager.deleteEmailIds called', {
      emailCount: emails.length,
      requestedUserId: userId,
      instanceUserId: this.userId,
      finalUserId: ownerUserId,
      emailIds: emails.slice(0, 3).map(e => e.id),
      emailUserIds: emails.slice(0, 3).map(e => e.user_id || 'undefined')
    });
    
    let sql = `DELETE FROM email_index WHERE id IN (${emails
      .map(() => "?")
      .join(", ")})`;
    
    // Add user filtering for multi-user support if a user ID is available
    const params = [...emails.map((email) => email.id)];
    
    if (ownerUserId) {
      sql += ` AND user_id = ?`;
      params.push(ownerUserId);
    }
    
    console.log('🔍 DIAGNOSTIC: Executing delete SQL', {
      sql: sql,
      paramCount: params.length,
      firstFewParams: params.slice(0, 5),
      hasUserIdFilter: !!ownerUserId
    });
    
    const result = await this.run(sql, params);
    const actualDeleted = (result as any)?.changes || 0;
    
    console.log('🔍 DIAGNOSTIC: Delete SQL result', {
      requestedEmails: emails.length,
      actualChanges: actualDeleted,
      difference: emails.length - actualDeleted
    });
    
    return actualDeleted; // Return actual deleted count, not requested count
  }

  private incrementWrites() {
    if (this.pendingWrites === 0) {
      this.idlePromise = new Promise(resolve => {
        this.resolveIdle = resolve;
      });
    }
    this.pendingWrites++;
  }

  private decrementWrites() {
    this.pendingWrites--;
    if (this.pendingWrites === 0 && this.resolveIdle) {
      this.resolveIdle();
      this.resolveIdle = null;
    }
  }

  async waitForIdle(): Promise<void> {
    return this.idlePromise;
  }

  async close(): Promise<void> {
    await this.waitForIdle();
    if (this.db) {
      return new Promise((resolve, reject) => {
        this.db?.close((err) => {
          if (err) {
            logger.error('Failed to close database:', err);
            reject(err);
          } else {
            this.db = null;
            this.initialized = false;
            logger.info('Database connection closed');
            resolve();
          }
        });
      });
    }
  }

  /**
   * Reconnect to the database after connection loss
   * This is primarily for test environments where the connection might be closed during isolation
   */
  private async reconnect(): Promise<void> {
    try {
      // Ensure storage directory exists
      const storageDir = path.dirname(this.dbPath);
      await fs.mkdir(storageDir, { recursive: true });

      // Open database connection
      await new Promise<void>((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) {
            logger.error('🔍 DIAGNOSTIC: Database reconnection failed', {
              instanceId: this.instanceId,
              userId: this.userId,
              error: err.message,
              service: 'gmail-mcp-server',
              timestamp: new Date().toISOString()
            });
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // Enable foreign keys
      await this.run("PRAGMA foreign_keys = ON");

      this.initialized = true;
    } catch (error) {
      logger.error("Failed to reconnect database:", error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // Job status methods
  async createJobStatusTable(): Promise<void> {
    const query = `
      CREATE TABLE IF NOT EXISTS job_statuses (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED')),
        request_params TEXT,
        progress INTEGER,
        results TEXT,
        error_details TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        user_id TEXT
      )
    `;
    await this.run(query);

    // Create indexes
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_job_status ON job_statuses(status)"
    );
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_job_type ON job_statuses(job_type)"
    );
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_job_created_at ON job_statuses(created_at)"
    );
    await this.run(
      "CREATE INDEX IF NOT EXISTS idx_job_user_id ON job_statuses(user_id)"
    );
  }

  async insertJob(job: Job): Promise<void> {
    // Route to specialized methods for specific job types
    if (job.job_type.includes("cleanup")) {
      await this.insertCleanupJob(job as any);
      return;
    }

    // Add user_id field to support multi-user isolation
    const sql = `
      INSERT INTO job_statuses (
        job_id, job_type, status, request_params, created_at, user_id
      ) VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.run(sql, [
      job.job_id,
      job.job_type,
      job.status,
      JSON.stringify(job.request_params),
      Math.floor(job.created_at.getTime() / 1000),
      job.user_id || null,
    ]);
  }

  async getJob(jobId: string): Promise<any | null> {
    // First check if this is a cleanup job by checking the job_type
    const typeCheck = await this.get(
      "SELECT job_type FROM job_statuses WHERE job_id = ?",
      [jobId]
    );
    if (!typeCheck) return null;

    // Route to specialized method for cleanup jobs
    if (typeCheck.job_type.includes("cleanup")) {
      return await this.getCleanupJob(jobId);
    }

    // Handle base jobs normally
    const row = await this.get("SELECT * FROM job_statuses WHERE job_id = ?", [
      jobId,
    ]);
    if (!row) return null;

    return {
      job_id: row.job_id,
      job_type: row.job_type,
      status: row.status,
      request_params: JSON.parse(row.request_params || "{}"),
      progress: row.progress,
      results: row.results ? JSON.parse(row.results) : null,
      error_details: row.error_details,
      created_at: new Date(row.created_at * 1000),
      started_at: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completed_at: row.completed_at
        ? new Date(row.completed_at * 1000)
        : undefined,
      user_id: row.user_id,
    };
  }

  async updateJob(jobId: string, updates: any): Promise<void> {
    // Check if this is a cleanup job by checking the job_type
    const typeCheck = await this.get(
      "SELECT job_type FROM job_statuses WHERE job_id = ?",
      [jobId]
    );
    if (!typeCheck) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // Route to specialized method for cleanup jobs
    if (typeCheck.job_type.includes("cleanup")) {
      await this.updateCleanupJob(jobId, updates);
      return;
    }

    // Handle base job updates normally
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      fields.push("status = ?");
      values.push(updates.status);
    }

    if (updates.progress !== undefined) {
      fields.push("progress = ?");
      values.push(updates.progress);
    }

    if (updates.results !== undefined) {
      fields.push("results = ?");
      values.push(JSON.stringify(updates.results));
    }

    if (updates.error_details !== undefined) {
      fields.push("error_details = ?");
      values.push(updates.error_details);
    }

    if (updates.started_at !== undefined) {
      fields.push("started_at = ?");
      values.push(Math.floor(updates.started_at.getTime() / 1000));
    }

    if (updates.completed_at !== undefined) {
      fields.push("completed_at = ?");
      values.push(Math.floor(updates.completed_at.getTime() / 1000));
    }

    fields.push("updated_at = strftime('%s', 'now')");

    if (fields.length === 1) return; // Only updated_at field

    const sql = `UPDATE job_statuses SET ${fields.join(", ")} WHERE job_id = ?`;
    values.push(jobId);

    await this.run(sql, values);
  }

  async listJobs(filters: any = {}): Promise<any[]> {
    // Route to specialized method for cleanup jobs
    if (filters.job_type && filters.job_type.includes("cleanup")) {
      return await this.listCleanupJobs(filters);
    }

    // Handle base job listing normally
    let sql = "SELECT * FROM job_statuses WHERE 1=1";
    const params: any[] = [];

    // Add user_id filtering for multi-user support
    if (filters.user_id) {
      sql += " AND user_id = ?";
      params.push(filters.user_id);
    }

    if (filters.job_type) {
      sql += " AND job_type = ?";
      params.push(filters.job_type);
    }

    if (filters.status) {
      sql += " AND status = ?";
      params.push(filters.status);
    }

    sql += " ORDER BY created_at DESC";

    if (filters.limit) {
      sql += " LIMIT ?";
      params.push(filters.limit);

      if (filters.offset) {
        sql += " OFFSET ?";
        params.push(filters.offset);
      }
    }

    const rows = await this.all(sql, params);
    return rows.map((row) => ({
      job_id: row.job_id,
      job_type: row.job_type,
      status: row.status,
      request_params: JSON.parse(row.request_params || "{}"),
      progress: row.progress,
      results: row.results ? JSON.parse(row.results) : null,
      error_details: row.error_details,
      created_at: new Date(row.created_at * 1000),
      started_at: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completed_at: row.completed_at
        ? new Date(row.completed_at * 1000)
        : undefined,
    }));
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.run("DELETE FROM job_statuses WHERE job_id = ?", [jobId]);
  }

  async deleteJobsOlderThan(date: Date, user_id?: string): Promise<number> {
    const timestamp = Math.floor(date.getTime() / 1000);
    let sql = "DELETE FROM job_statuses WHERE created_at < ?";
    const params: any[] = [timestamp];
    
    // Add user filtering if provided
    if (user_id) {
      sql += " AND user_id = ?";
      params.push(user_id);
    }
    
    const result = await this.execute(sql, params);
    return result?.changes || 0;
  }

  // ========================
  // Email Cleanup System Methods
  // ========================

  // Access Pattern Tracking Methods
  async logEmailAccess(
    event: import("../types/index.js").EmailAccessEvent
  ): Promise<void> {
    const sql = `
      INSERT INTO email_access_log (email_id, access_type, timestamp, search_query, user_context)
      VALUES (?, ?, ?, ?, ?)
    `;

    await this.run(sql, [
      event.email_id,
      event.access_type,
      Math.floor(event.timestamp.getTime() / 1000),
      event.search_query || null,
      event.user_context || null,
    ]);
  }

  async logSearchActivity(
    record: import("../types/index.js").SearchActivityRecord
  ): Promise<void> {
    const sql = `
      INSERT INTO search_activity (search_id, query, email_results, result_interactions, timestamp, result_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    await this.run(sql, [
      record.search_id,
      record.query,
      JSON.stringify(record.email_results),
      JSON.stringify(record.result_interactions),
      Math.floor(record.timestamp.getTime() / 1000),
      record.email_results.length,
    ]);
  }

  async updateAccessSummary(email_id: string): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO email_access_summary (
        email_id, total_accesses, last_accessed, search_appearances, search_interactions, access_score, updated_at
      )
      SELECT
        ?,
        COALESCE((SELECT COUNT(*) FROM email_access_log WHERE email_id = ?), 0),
        COALESCE((SELECT MAX(timestamp) FROM email_access_log WHERE email_id = ?), 0),
        COALESCE((SELECT COUNT(*) FROM search_activity WHERE email_results LIKE '%' || ? || '%'), 0),
        COALESCE((SELECT COUNT(*) FROM search_activity WHERE result_interactions LIKE '%' || ? || '%'), 0),
        CASE
          WHEN (SELECT COUNT(*) FROM email_access_log WHERE email_id = ?) > 0
          THEN MIN(1.0, (SELECT COUNT(*) FROM email_access_log WHERE email_id = ?) / 10.0)
          ELSE 0.0
        END,
        strftime('%s', 'now')
    `;

    await this.run(sql, [
      email_id,
      email_id,
      email_id,
      email_id,
      email_id,
      email_id,
      email_id,
    ]);
  }

  async getAccessSummary(
    email_id: string
  ): Promise<import("../types/index.js").EmailAccessSummary | null> {
    const row = await this.get(
      "SELECT * FROM email_access_summary WHERE email_id = ?",
      [email_id]
    );

    if (!row) return null;

    return {
      email_id: row.email_id,
      total_accesses: row.total_accesses,
      last_accessed: new Date(row.last_accessed * 1000),
      search_appearances: row.search_appearances,
      search_interactions: row.search_interactions,
      access_score: row.access_score,
      updated_at: new Date(row.updated_at * 1000),
    };
  }

  // Cleanup Policy Methods
  async createCleanupPolicy(
    policy: Omit<
      import("../types/index.js").CleanupPolicy,
      "id" | "created_at" | "updated_at"
    > & { id?: string }
  ): Promise<string> {
    // Use provided ID if available, otherwise generate one
    const id =
      (policy as any).id ||
      `policy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    logger.info("Creating cleanup policy with ID", {
      provided_id: (policy as any).id,
      final_id: id,
      policy_name: policy.name,
    });

    const sql = `
      INSERT INTO cleanup_policies (id, name, enabled, priority, criteria, action, safety, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.run(sql, [
      id,
      policy.name,
      policy.enabled ? 1 : 0,
      policy.priority,
      JSON.stringify(policy.criteria),
      JSON.stringify(policy.action),
      JSON.stringify(policy.safety),
      policy.schedule ? JSON.stringify(policy.schedule) : null,
    ]);

    return id;
  }

  async updateCleanupPolicy(
    policyId: string,
    updates: Partial<import("../types/index.js").CleanupPolicy>
  ): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push("name = ?");
      values.push(updates.name);
    }

    if (updates.enabled !== undefined) {
      fields.push("enabled = ?");
      values.push(updates.enabled ? 1 : 0);
    }

    if (updates.priority !== undefined) {
      fields.push("priority = ?");
      values.push(updates.priority);
    }

    if (updates.criteria !== undefined) {
      fields.push("criteria = ?");
      values.push(JSON.stringify(updates.criteria));
    }

    if (updates.action !== undefined) {
      fields.push("action = ?");
      values.push(JSON.stringify(updates.action));
    }

    if (updates.safety !== undefined) {
      fields.push("safety = ?");
      values.push(JSON.stringify(updates.safety));
    }

    if (updates.schedule !== undefined) {
      fields.push("schedule = ?");
      values.push(updates.schedule ? JSON.stringify(updates.schedule) : null);
    }

    fields.push("updated_at = strftime('%s', 'now')");

    if (fields.length === 1) return; // Only updated_at field

    const sql = `UPDATE cleanup_policies SET ${fields.join(", ")} WHERE id = ?`;
    values.push(policyId);

    await this.run(sql, values);
  }

  async deleteCleanupPolicy(policyId: string): Promise<void> {
    await this.run("DELETE FROM cleanup_policies WHERE id = ?", [policyId]);
  }

  async getCleanupPolicy(
    policyId: string
  ): Promise<import("../types/index.js").CleanupPolicy | null> {
    const row = await this.get("SELECT * FROM cleanup_policies WHERE id = ?", [
      policyId,
    ]);
    return row ? this.rowToCleanupPolicy(row) : null;
  }

  async getActivePolicies(): Promise<
    import("../types/index.js").CleanupPolicy[]
  > {
    const rows = await this.all(
      "SELECT * FROM cleanup_policies WHERE enabled = 1 ORDER BY priority DESC"
    );
    return rows.map((row) => this.rowToCleanupPolicy(row));
  }

  async getAllPolicies(): Promise<import("../types/index.js").CleanupPolicy[]> {
    const rows = await this.all(
      "SELECT * FROM cleanup_policies ORDER BY priority DESC"
    );
    return rows.map((row) => this.rowToCleanupPolicy(row));
  }

  private rowToCleanupPolicy(
    row: any
  ): import("../types/index.js").CleanupPolicy {
    return {
      id: row.id,
      name: row.name,
      enabled: row.enabled === 1,
      priority: row.priority,
      criteria: JSON.parse(row.criteria),
      action: JSON.parse(row.action),
      safety: JSON.parse(row.safety),
      schedule: row.schedule ? JSON.parse(row.schedule) : undefined,
      created_at: new Date(row.created_at * 1000),
      updated_at: new Date(row.updated_at * 1000),
    };
  }

  // System Metrics Methods
  async recordSystemMetrics(
    metrics: Omit<import("../types/index.js").SystemMetrics, "timestamp">
  ): Promise<void> {
    const sql = `
      INSERT INTO system_metrics (
        timestamp, storage_usage_percent, storage_used_bytes, storage_total_bytes,
        average_query_time_ms, cache_hit_rate, active_connections, cleanup_rate_per_minute, system_load_average
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.run(sql, [
      Math.floor(Date.now() / 1000),
      metrics.storage_usage_percent,
      metrics.storage_used_bytes,
      metrics.storage_total_bytes,
      metrics.average_query_time_ms,
      metrics.cache_hit_rate,
      metrics.active_connections,
      metrics.cleanup_rate_per_minute,
      metrics.system_load_average,
    ]);
  }

  async getRecentSystemMetrics(
    hours: number = 24
  ): Promise<import("../types/index.js").SystemMetrics[]> {
    const cutoffTime = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
    const rows = await this.all(
      "SELECT * FROM system_metrics WHERE timestamp > ? ORDER BY timestamp DESC",
      [cutoffTime]
    );

    return rows.map((row) => ({
      timestamp: new Date(row.timestamp * 1000),
      storage_usage_percent: row.storage_usage_percent,
      storage_used_bytes: row.storage_used_bytes,
      storage_total_bytes: row.storage_total_bytes,
      average_query_time_ms: row.average_query_time_ms,
      cache_hit_rate: row.cache_hit_rate,
      active_connections: row.active_connections,
      cleanup_rate_per_minute: row.cleanup_rate_per_minute,
      system_load_average: row.system_load_average,
    }));
  }

  async getLatestSystemMetrics(): Promise<
    import("../types/index.js").SystemMetrics | null
  > {
    const row = await this.get(
      "SELECT * FROM system_metrics ORDER BY timestamp DESC LIMIT 1"
    );

    if (!row) return null;

    return {
      timestamp: new Date(row.timestamp * 1000),
      storage_usage_percent: row.storage_usage_percent,
      storage_used_bytes: row.storage_used_bytes,
      storage_total_bytes: row.storage_total_bytes,
      average_query_time_ms: row.average_query_time_ms,
      cache_hit_rate: row.cache_hit_rate,
      active_connections: row.active_connections,
      cleanup_rate_per_minute: row.cleanup_rate_per_minute,
      system_load_average: row.system_load_average,
    };
  }

  // Cleanup Execution History Methods
  async recordCleanupExecution(
    execution: Omit<import("../types/index.js").CleanupResults, "execution_id">
  ): Promise<string> {
    const execution_id = `exec_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const sql = `
      INSERT INTO cleanup_execution_history (
        execution_id, policy_id, start_time, end_time, emails_processed, emails_cleaned,
        storage_freed, effectiveness_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const emailsCleaned = execution.emails_deleted + execution.emails_archived;
    const effectivenessScore =
      execution.emails_processed > 0
        ? emailsCleaned / execution.emails_processed
        : 0;

    await this.run(sql, [
      execution_id,
      execution.policy_id || null,
      Math.floor(execution.started_at.getTime() / 1000),
      Math.floor(execution.completed_at.getTime() / 1000),
      execution.emails_processed,
      emailsCleaned,
      execution.storage_freed,
      effectivenessScore,
    ]);

    return execution_id;
  }

  async getCleanupExecutionHistory(days: number = 30): Promise<any[]> {
    const cutoffTime = Math.floor(
      (Date.now() - days * 24 * 60 * 60 * 1000) / 1000
    );
    const rows = await this.all(
      "SELECT * FROM cleanup_execution_history WHERE start_time > ? ORDER BY start_time DESC",
      [cutoffTime]
    );

    return rows.map((row) => ({
      execution_id: row.execution_id,
      policy_id: row.policy_id,
      started_at: new Date(row.start_time * 1000),
      completed_at: new Date(row.end_time * 1000),
      emails_processed: row.emails_processed,
      emails_cleaned: row.emails_cleaned,
      storage_freed: row.storage_freed,
      effectiveness_score: row.effectiveness_score,
    }));
  }

  // Cleanup system maintenance methods
  async cleanupOldAccessLogs(days: number = 90): Promise<number> {
    const cutoffTime = Math.floor(
      (Date.now() - days * 24 * 60 * 60 * 1000) / 1000
    );
    const result = await this.execute(
      "DELETE FROM email_access_log WHERE timestamp < ?",
      [cutoffTime]
    );
    return result?.changes || 0;
  }

  async cleanupOldSystemMetrics(days: number = 30): Promise<number> {
    const cutoffTime = Math.floor(
      (Date.now() - days * 24 * 60 * 60 * 1000) / 1000
    );
    const result = await this.execute(
      "DELETE FROM system_metrics WHERE timestamp < ?",
      [cutoffTime]
    );
    return result?.changes || 0;
  }

  // Utility method to get emails eligible for cleanup
  /**
   * Get emails eligible for cleanup with user filtering
   * @param policy Cleanup policy to determine eligible emails
   * @param limit Maximum number of emails to return
   * @param userId Optional user ID to filter emails (for multi-user support)
   * @returns Array of email indexes eligible for cleanup
   */
  async getEmailsForCleanup(
    policy: import("../types/index.js").CleanupPolicy,
    limit?: number,
    userId?: string
  ): Promise<EmailIndex[]> {
    let sql = "SELECT * FROM email_index WHERE 1=1";
    const params: any[] = [];
    
    // Apply user filtering for multi-user support
    // Use either the provided userId or the instance's userId
    const userIdToUse = userId || this.userId;
    if (userIdToUse) {
      sql += " AND user_id = ?";
      params.push(userIdToUse);
    }

    // Apply policy criteria
    if (policy.criteria.age_days_min) {
      // FIX: Remove the division by 1000 - dates are stored as milliseconds
      const cutoffDate =
        Date.now() - policy.criteria.age_days_min * 24 * 60 * 60 * 1000;
      sql += " AND date < ?";
      params.push(cutoffDate);
    }

    if (policy.criteria.importance_level_max) {
      const levels = ["low", "medium", "high"];
      const maxIndex = levels.indexOf(policy.criteria.importance_level_max);
      const allowedLevels = levels.slice(0, maxIndex + 1);
      sql += ` AND (category IN (${allowedLevels
        .map(() => "?")
        .join(", ")}) OR category IS NULL)`;
      params.push(...allowedLevels);
    }

    if (policy.criteria.size_threshold_min) {
      sql += " AND size >= ?";
      params.push(policy.criteria.size_threshold_min);
    }

    if (policy.criteria.spam_score_min) {
      sql += " AND spam_score >= ?";
      params.push(policy.criteria.spam_score_min);
    }

    if (policy.criteria.promotional_score_min) {
      sql += " AND promotional_score >= ?";
      params.push(policy.criteria.promotional_score_min);
    }

    // Exclude recently accessed emails if specified
    if (policy.criteria.access_score_max !== undefined) {
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM email_access_summary WHERE email_id = email_index.id AND access_score > ?)
        OR NOT EXISTS (SELECT 1 FROM email_access_summary WHERE email_id = email_index.id)
      )`;
      params.push(policy.criteria.access_score_max);
    }

    if (policy.criteria.no_access_days) {
      const noAccessCutoff = Math.floor(
        (Date.now() - policy.criteria.no_access_days * 24 * 60 * 60 * 1000) /
          1000
      );
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM email_access_summary WHERE email_id = email_index.id AND last_accessed > ?)
        OR NOT EXISTS (SELECT 1 FROM email_access_summary WHERE email_id = email_index.id)
      )`;
      params.push(noAccessCutoff);
    }

    // Safety: exclude archived emails if not explicitly handling them
    sql += " AND archived = 0";

    // Order by least important first
    sql += " ORDER BY COALESCE(importance_score, 0) ASC, date ASC";

    if (limit) {
      sql += " LIMIT ?";
      params.push(limit);
    }


    // Execute query and log results
    const rows = await this.all(sql, params);

    return rows.map((row) => this.rowToEmailIndex(row));
  }

  // ========================
  // Specialized CleanupJob Methods
  // ========================

  /**
   * Insert a CleanupJob with both base and metadata fields
   */
  async insertCleanupJob(
    job: import("../types/index.js").CleanupJob
  ): Promise<void> {
    // Use SQLite's serialized transaction handling
    return new Promise((resolve, reject) => {
      this.db!.serialize(() => {
        this.db!.run("BEGIN TRANSACTION", (beginErr) => {
          if (beginErr) {
            return reject(beginErr);
          }

          // Insert base job data
          const baseSql = `
            INSERT INTO job_statuses (
              job_id, job_type, status, request_params, created_at
            ) VALUES (?, ?, ?, ?, ?)
          `;

          this.db!.run(
            baseSql,
            [
              job.job_id,
              job.job_type,
              job.status,
              JSON.stringify(job.request_params),
              Math.floor(job.created_at.getTime() / 1000),
            ],
            (baseErr) => {
              if (baseErr) {
                this.db!.run("ROLLBACK");
                return reject(baseErr);
              }

              // Insert cleanup-specific metadata
              const metadataSql = `
              INSERT INTO cleanup_job_metadata (
                job_id, policy_id, triggered_by, priority, batch_size, target_emails,
                emails_analyzed, emails_cleaned, storage_freed, errors_encountered,
                current_batch, total_batches
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

              this.db!.run(
                metadataSql,
                [
                  job.job_id,
                  job.cleanup_metadata.policy_id || null,
                  job.cleanup_metadata.triggered_by,
                  job.cleanup_metadata.priority,
                  job.cleanup_metadata.batch_size,
                  job.cleanup_metadata.target_emails,
                  job.progress_details.emails_analyzed,
                  job.progress_details.emails_cleaned,
                  job.progress_details.storage_freed,
                  job.progress_details.errors_encountered,
                  job.progress_details.current_batch,
                  job.progress_details.total_batches,
                ],
                (metadataErr) => {
                  if (metadataErr) {
                    this.db!.run("ROLLBACK");
                    return reject(metadataErr);
                  }

                  this.db!.run("COMMIT", (commitErr) => {
                    if (commitErr) {
                      this.db!.run("ROLLBACK");
                      return reject(commitErr);
                    }
                    resolve();
                  });
                }
              );
            }
          );
        });
      });
    });
  }

  /**
   * Get a CleanupJob with joined base and metadata fields
   */
  async getCleanupJob(
    jobId: string
  ): Promise<import("../types/index.js").CleanupJob | null> {
    const sql = `
      SELECT
        j.*,
        m.policy_id, m.triggered_by, m.priority, m.batch_size, m.target_emails,
        m.emails_analyzed, m.emails_cleaned, m.storage_freed, m.errors_encountered,
        m.current_batch, m.total_batches
      FROM job_statuses j
      JOIN cleanup_job_metadata m ON j.job_id = m.job_id
      WHERE j.job_id = ?
    `;

    const row = await this.get(sql, [jobId]);
    if (!row) return null;

    return {
      job_id: row.job_id,
      job_type: row.job_type as any,
      status: row.status as any,
      request_params: JSON.parse(row.request_params || "{}"),
      progress: row.progress,
      results: row.results ? JSON.parse(row.results) : null,
      error_details: row.error_details,
      created_at: new Date(row.created_at * 1000),
      started_at: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completed_at: row.completed_at
        ? new Date(row.completed_at * 1000)
        : undefined,

      cleanup_metadata: {
        policy_id: row.policy_id,
        triggered_by: row.triggered_by,
        priority: row.priority,
        batch_size: row.batch_size,
        target_emails: row.target_emails,
      },

      progress_details: {
        emails_analyzed: row.emails_analyzed,
        emails_cleaned: row.emails_cleaned,
        storage_freed: row.storage_freed,
        errors_encountered: row.errors_encountered,
        current_batch: row.current_batch,
        total_batches: row.total_batches,
      },
    };
  }

  /**
   * Update a CleanupJob with both base and metadata fields
   */
  async updateCleanupJob(
    jobId: string,
    updates: Partial<import("../types/index.js").CleanupJob>
  ): Promise<void> {
    // Update base job fields if provided
    const baseFields: string[] = [];
    const baseValues: any[] = [];

    if (updates.status !== undefined) {
      baseFields.push("status = ?");
      baseValues.push(updates.status);
    }

    if (updates.progress !== undefined) {
      baseFields.push("progress = ?");
      baseValues.push(updates.progress);
    }

    if (updates.results !== undefined) {
      baseFields.push("results = ?");
      baseValues.push(JSON.stringify(updates.results));
    }

    if (updates.error_details !== undefined) {
      baseFields.push("error_details = ?");
      baseValues.push(updates.error_details);
    }

    if (updates.started_at !== undefined) {
      baseFields.push("started_at = ?");
      baseValues.push(Math.floor(updates.started_at.getTime() / 1000));
    }

    if (updates.completed_at !== undefined) {
      baseFields.push("completed_at = ?");
      baseValues.push(Math.floor(updates.completed_at.getTime() / 1000));
    }

    if (baseFields.length > 0) {
      baseFields.push("updated_at = strftime('%s', 'now')");
      const baseSql = `UPDATE job_statuses SET ${baseFields.join(
        ", "
      )} WHERE job_id = ?`;
      baseValues.push(jobId);
      await this.run(baseSql, baseValues);
    }

    // Update cleanup metadata fields if provided
    const metadataFields: string[] = [];
    const metadataValues: any[] = [];

    if (updates.cleanup_metadata) {
      if (updates.cleanup_metadata.policy_id !== undefined) {
        metadataFields.push("policy_id = ?");
        metadataValues.push(updates.cleanup_metadata.policy_id);
      }

      if (updates.cleanup_metadata.triggered_by !== undefined) {
        metadataFields.push("triggered_by = ?");
        metadataValues.push(updates.cleanup_metadata.triggered_by);
      }

      if (updates.cleanup_metadata.priority !== undefined) {
        metadataFields.push("priority = ?");
        metadataValues.push(updates.cleanup_metadata.priority);
      }

      if (updates.cleanup_metadata.batch_size !== undefined) {
        metadataFields.push("batch_size = ?");
        metadataValues.push(updates.cleanup_metadata.batch_size);
      }

      if (updates.cleanup_metadata.target_emails !== undefined) {
        metadataFields.push("target_emails = ?");
        metadataValues.push(updates.cleanup_metadata.target_emails);
      }
    }

    if (updates.progress_details) {
      if (updates.progress_details.emails_analyzed !== undefined) {
        metadataFields.push("emails_analyzed = ?");
        metadataValues.push(updates.progress_details.emails_analyzed);
      }

      if (updates.progress_details.emails_cleaned !== undefined) {
        metadataFields.push("emails_cleaned = ?");
        metadataValues.push(updates.progress_details.emails_cleaned);
      }

      if (updates.progress_details.storage_freed !== undefined) {
        metadataFields.push("storage_freed = ?");
        metadataValues.push(updates.progress_details.storage_freed);
      }

      if (updates.progress_details.errors_encountered !== undefined) {
        metadataFields.push("errors_encountered = ?");
        metadataValues.push(updates.progress_details.errors_encountered);
      }

      if (updates.progress_details.current_batch !== undefined) {
        metadataFields.push("current_batch = ?");
        metadataValues.push(updates.progress_details.current_batch);
      }

      if (updates.progress_details.total_batches !== undefined) {
        metadataFields.push("total_batches = ?");
        metadataValues.push(updates.progress_details.total_batches);
      }
    }

    if (metadataFields.length > 0) {
      metadataFields.push("updated_at = strftime('%s', 'now')");
      const metadataSql = `UPDATE cleanup_job_metadata SET ${metadataFields.join(
        ", "
      )} WHERE job_id = ?`;
      metadataValues.push(jobId);
      await this.run(metadataSql, metadataValues);
    }
  }

  /**
   * List CleanupJobs with filtering and pagination
   */
  async listCleanupJobs(
    filters: {
      status?: string;
      policy_id?: string;
      triggered_by?: string;
      priority?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<import("../types/index.js").CleanupJob[]> {
    let sql = `
      SELECT
        j.*,
        m.policy_id, m.triggered_by, m.priority, m.batch_size, m.target_emails,
        m.emails_analyzed, m.emails_cleaned, m.storage_freed, m.errors_encountered,
        m.current_batch, m.total_batches
      FROM job_statuses j
      JOIN cleanup_job_metadata m ON j.job_id = m.job_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (filters.status) {
      sql += " AND j.status = ?";
      params.push(filters.status);
    }

    if (filters.policy_id) {
      sql += " AND m.policy_id = ?";
      params.push(filters.policy_id);
    }

    if (filters.triggered_by) {
      sql += " AND m.triggered_by = ?";
      params.push(filters.triggered_by);
    }

    if (filters.priority) {
      sql += " AND m.priority = ?";
      params.push(filters.priority);
    }

    sql += " ORDER BY j.created_at DESC";

    if (filters.limit) {
      sql += " LIMIT ?";
      params.push(filters.limit);

      if (filters.offset) {
        sql += " OFFSET ?";
        params.push(filters.offset);
      }
    }

    const rows = await this.all(sql, params);
    return rows.map((row) => ({
      job_id: row.job_id,
      job_type: row.job_type as any,
      status: row.status as any,
      request_params: JSON.parse(row.request_params || "{}"),
      progress: row.progress,
      results: row.results ? JSON.parse(row.results) : null,
      error_details: row.error_details,
      created_at: new Date(row.created_at * 1000),
      started_at: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completed_at: row.completed_at
        ? new Date(row.completed_at * 1000)
        : undefined,

      cleanup_metadata: {
        policy_id: row.policy_id,
        triggered_by: row.triggered_by,
        priority: row.priority,
        batch_size: row.batch_size,
        target_emails: row.target_emails,
      },

      progress_details: {
        emails_analyzed: row.emails_analyzed,
        emails_cleaned: row.emails_cleaned,
        storage_freed: row.storage_freed,
        errors_encountered: row.errors_encountered,
        current_batch: row.current_batch,
        total_batches: row.total_batches,
      },
    }));
  }
}
