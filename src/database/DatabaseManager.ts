import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { EmailIndex, ArchiveRule, ArchiveRecord, SavedSearch,SearchCriteria, SearchEngineCriteria } from '../types/index.js';

interface RunResult {
  lastID?: number; // For INSERT statements
  changes: number; // For INSERT, UPDATE, DELETE statements
}

export class DatabaseManager {
  private db: sqlite3.Database | null = null;
  private dbPath: string;
  private initialized: boolean = false;
  private static instance: DatabaseManager | null = null;

  constructor() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // Determine the project root directory
    // Since we know this file is in src/database, we can navigate up from there
    const projectRoot = path.resolve(__dirname, '../../');
    
    // Always resolve storage path relative to project root, not cwd or absolute
    const storagePath = path.join(projectRoot, process.env.STORAGE_PATH || 'data');
    this.dbPath = path.join(storagePath, 'gmail-mcp.db');
  }

  static getInstance(): DatabaseManager {
    if (!this.instance) {
      this.instance = new DatabaseManager();
    }
    return this.instance;
  }

  async initialize(): Promise<void> {
    try {
      // Ensure storage directory exists
      const storageDir = path.dirname(this.dbPath);
      await fs.mkdir(storageDir, { recursive: true });

      // Open database
      await new Promise<void>((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Enable foreign keys
      await this.run('PRAGMA foreign_keys = ON');

      // Create tables
      await this.createTables();
      
      // Run migration for existing databases
      await this.migrateToAnalyzerSchema();
      
      this.initialized = true;
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const queries = [
      // Email index table (basic schema without analyzer columns for migration compatibility)
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
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

      // Create indexes for common queries
      `CREATE INDEX IF NOT EXISTS idx_email_category ON email_index(category)`,
      `CREATE INDEX IF NOT EXISTS idx_email_year ON email_index(year)`,
      `CREATE INDEX IF NOT EXISTS idx_email_size ON email_index(size)`,
      `CREATE INDEX IF NOT EXISTS idx_email_archived ON email_index(archived)`,
      `CREATE INDEX IF NOT EXISTS idx_email_date ON email_index(date)`,

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

      // Saved searches table
      `CREATE TABLE IF NOT EXISTS saved_searches (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        criteria TEXT NOT NULL,
        created INTEGER DEFAULT (strftime('%s', 'now')),
        last_used INTEGER,
        result_count INTEGER
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
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,

      // Create index for job status queries
      `CREATE INDEX IF NOT EXISTS idx_job_status ON job_statuses(status)`,
      `CREATE INDEX IF NOT EXISTS idx_job_type ON job_statuses(job_type)`,
      `CREATE INDEX IF NOT EXISTS idx_job_created_at ON job_statuses(created_at)`
    ];

    for (const query of queries) {
      await this.run(query);
    }
  }

  /**
   * Migrates existing database schema to include analyzer result columns
   */
  async migrateToAnalyzerSchema(): Promise<void> {
    try {
      // Check if email_index table exists first
      const tableExists = await this.get("SELECT name FROM sqlite_master WHERE type='table' AND name='email_index'");
      
      if (!tableExists) {
        logger.info('email_index table does not exist yet, skipping migration');
        return;
      }

      // Check if migration is needed by checking if importance_score column exists
      const tableInfo = await this.all("PRAGMA table_info(email_index)");
      const hasAnalyzerColumns = tableInfo.some((col: any) => col.name === 'importance_score');
      
      if (hasAnalyzerColumns) {
        logger.info('Database already has analyzer columns, skipping migration');
        return;
      }

      logger.info('Starting database migration to add analyzer result columns');

      // Add new columns for analyzer results (without CHECK constraints for ALTER TABLE)
      const migrationQueries = [
        // Importance Analysis Results
        'ALTER TABLE email_index ADD COLUMN importance_score REAL',
        'ALTER TABLE email_index ADD COLUMN importance_level TEXT',
        'ALTER TABLE email_index ADD COLUMN importance_matched_rules TEXT',
        'ALTER TABLE email_index ADD COLUMN importance_confidence REAL',
        
        // Date/Size Analysis Results
        'ALTER TABLE email_index ADD COLUMN age_category TEXT',
        'ALTER TABLE email_index ADD COLUMN size_category TEXT',
        'ALTER TABLE email_index ADD COLUMN recency_score REAL',
        'ALTER TABLE email_index ADD COLUMN size_penalty REAL',
        
        // Label Classification Results
        'ALTER TABLE email_index ADD COLUMN gmail_category TEXT',
        'ALTER TABLE email_index ADD COLUMN spam_score REAL',
        'ALTER TABLE email_index ADD COLUMN promotional_score REAL',
        'ALTER TABLE email_index ADD COLUMN social_score REAL',
        'ALTER TABLE email_index ADD COLUMN spam_indicators TEXT',
        'ALTER TABLE email_index ADD COLUMN promotional_indicators TEXT',
        'ALTER TABLE email_index ADD COLUMN social_indicators TEXT',
        
        // Analysis Metadata
        'ALTER TABLE email_index ADD COLUMN analysis_timestamp INTEGER',
        'ALTER TABLE email_index ADD COLUMN analysis_version TEXT'
      ];

      // Execute migration queries
      for (const query of migrationQueries) {
        try {
          await this.run(query);
        } catch (error: any) {
          // Ignore "duplicate column name" errors as they indicate the column already exists
          if (!error.message.includes('duplicate column name')) {
            throw error;
          }
        }
      }

      // Create new indexes
      const indexQueries = [
        'CREATE INDEX IF NOT EXISTS idx_email_importance_level ON email_index(importance_level)',
        'CREATE INDEX IF NOT EXISTS idx_email_importance_score ON email_index(importance_score)',
        'CREATE INDEX IF NOT EXISTS idx_email_age_category ON email_index(age_category)',
        'CREATE INDEX IF NOT EXISTS idx_email_size_category ON email_index(size_category)',
        'CREATE INDEX IF NOT EXISTS idx_email_gmail_category ON email_index(gmail_category)',
        'CREATE INDEX IF NOT EXISTS idx_email_spam_score ON email_index(spam_score)',
        'CREATE INDEX IF NOT EXISTS idx_email_analysis_timestamp ON email_index(analysis_timestamp)'
      ];

      for (const query of indexQueries) {
        await this.run(query);
      }

      logger.info('Database migration completed successfully');
    } catch (error) {
      logger.error('Database migration failed:', error);
      throw error;
    }
  }

 // Method for executing DML/DDL statements (INSERT, UPDATE, DELETE, CREATE, ALTER)
  // Now returns RunResult for INSERT/UPDATE/DELETE, or void for others.
  private run(sql: string, params: any[] = []): Promise<RunResult | void> {
    return new Promise((resolve, reject) => {
      // If params is a 2D array, treat as multiple runs in a transaction
      if (Array.isArray(params[0])) {
        this.db!.serialize(() => {
          this.db!.run('BEGIN TRANSACTION', (beginErr) => {
            if (beginErr) {
              return reject(beginErr);
            }

            let totalChanges = 0;
            let transactionError: Error | null = null;

            for (const paramSet of params) {
              // Using a bound function to capture 'this' for each run
              this.db!.run(sql, paramSet, function(err) {
                if (err) {
                  transactionError = err;
                  // Log the error but continue to allow the transaction to rollback
                  console.error(`Error during batch run for query "${sql}" with params ${paramSet}:`, err);
                  // We can't directly reject here as it's inside a loop and would not
                  // allow the transaction to rollback properly from this context.
                  // Instead, we mark an error and handle it in the COMMIT/ROLLBACK callback.
                } else {
                  // Handle cases where context might be undefined (e.g., in test environments)
                  const changes = (this && typeof this.changes === 'number') ? this.changes : 0;
                  totalChanges += changes; // Accumulate changes
                }
              });
            }

            if (transactionError) {
              this.db!.run('ROLLBACK', (rollbackErr) => {
                if (rollbackErr) {
                  console.error('Error during transaction rollback:', rollbackErr);
                  reject(new Error(`Transaction failed: ${transactionError?.message}. Also, rollback failed: ${rollbackErr.message}`));
                } else {
                  reject(transactionError); // Reject with the original transaction error
                }
              });
            } else {
              this.db!.run('COMMIT', (commitErr) => {
                if (commitErr) {
                  // If commit fails, attempt rollback
                  this.db!.run('ROLLBACK', (rollbackDuringCommitErr) => {
                    if (rollbackDuringCommitErr) {
                      console.error('Error during commit and subsequent rollback:', rollbackDuringCommitErr);
                      reject(new Error(`Commit failed: ${commitErr.message}. Also, rollback during commit failed: ${rollbackDuringCommitErr.message}`));
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
        this.db!.run(sql, params, function(err) {
          if (err) {
            reject(err);
          } else {
            // 'this' refers to the statement object in the callback
            // It has 'lastID' for inserts and 'changes' for inserts/updates/deletes
            // Handle cases where context might be undefined (e.g., in test environments)
            const changes = (this && typeof this.changes === 'number') ? this.changes : 0;
            const lastID = (this && typeof this.lastID === 'number') ? this.lastID : undefined;
            
            const result: RunResult = {
              changes: changes, // Number of rows actually changed
              lastID: lastID,   // ID of the last inserted row
            };
            resolve(result);
          }
        });
      }
    });
  }

  // Public method for non-query operations, leveraging the private run
  // Returns RunResult for DML, or void for DDL.
  public execute(sql: string, params: any[] = []): Promise<RunResult | void> {
    return this.run(sql, params);
  }

  private get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  private all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Email index methods
  async upsertEmailIndex(email: EmailIndex): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO email_index (
        id, thread_id, category, subject, sender, recipients,
        date, year, size, has_attachments, labels, snippet,
        archived, archive_date, archive_location,
        importance_score, importance_level, importance_matched_rules, importance_confidence,
        age_category, size_category, recency_score, size_penalty,
        gmail_category, spam_score, promotional_score, social_score,
        spam_indicators, promotional_indicators, social_indicators,
        analysis_timestamp, analysis_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
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
      email?.importanceScore || null,
      email?.importanceLevel || null,
      email?.importanceMatchedRules ? JSON.stringify(email.importanceMatchedRules) : null,
      email?.importanceConfidence || null,
      // Date/Size Analysis Results
      email?.ageCategory || null,
      email?.sizeCategory || null,
      email?.recencyScore || null,
      email?.sizePenalty || null,
      // Label Classification Results
      email?.gmailCategory || null,
      email?.spamScore || null,
      email?.promotionalScore || null,
      email?.socialScore || null,
      email?.spamIndicators ? JSON.stringify(email.spamIndicators) : null,
      email?.promotionalIndicators ? JSON.stringify(email.promotionalIndicators) : null,
      email?.socialIndicators ? JSON.stringify(email.socialIndicators) : null,
      // Analysis Metadata
      email?.analysisTimestamp?.getTime() || null,
      email?.analysisVersion || null
    ]);
  }

  async bulkUpsertEmailIndex(emails: EmailIndex[]): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO email_index (
        id, thread_id, category, subject, sender, recipients,
        date, year, size, has_attachments, labels, snippet,
        archived, archive_date, archive_location,
        importance_score, importance_level, importance_matched_rules, importance_confidence,
        age_category, size_category, recency_score, size_penalty,
        gmail_category, spam_score, promotional_score, social_score,
        spam_indicators, promotional_indicators, social_indicators,
        analysis_timestamp, analysis_version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;
    const paramSets = emails.map(email => [
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
      email?.importanceScore || null,
      email?.importanceLevel || null,
      email?.importanceMatchedRules ? JSON.stringify(email.importanceMatchedRules) : null,
      email?.importanceConfidence || null,
      // Date/Size Analysis Results
      email?.ageCategory || null,
      email?.sizeCategory || null,
      email?.recencyScore || null,
      email?.sizePenalty || null,
      // Label Classification Results
      email?.gmailCategory || null,
      email?.spamScore || null,
      email?.promotionalScore || null,
      email?.socialScore || null,
      email?.spamIndicators ? JSON.stringify(email.spamIndicators) : null,
      email?.promotionalIndicators ? JSON.stringify(email.promotionalIndicators) : null,
      email?.socialIndicators ? JSON.stringify(email.socialIndicators) : null,
      // Analysis Metadata
      email?.analysisTimestamp?.getTime() || null,
      email?.analysisVersion || null
    ]);
    await this.run(sql, paramSets);
  }

  async getEmailIndex(id: string): Promise<EmailIndex | null> {
    const row = await this.get('SELECT * FROM email_index WHERE id = ?', [id]);
    return row ? this.rowToEmailIndex(row) : null;
  }

  async searchEmails(criteria: SearchEngineCriteria): Promise<EmailIndex[]> {
    let sql = 'SELECT * FROM email_index WHERE 1=1';
    const params: any[] = [];

    if (criteria?.category === null) {
      sql += ' AND category IS NULL';
    } else if (criteria?.category) {
      sql += ' AND category = ?';
      params.push(criteria.category);
    }

    if (criteria.year) {
      sql += ' AND year = ?';
      params.push(criteria.year);
    }

    if (criteria.yearRange) {
      if (criteria.yearRange.start) {
        sql += ' AND year >= ?';
        params.push(criteria.yearRange.start);
      }
      if (criteria.yearRange.end) {
        sql += ' AND year <= ?';
        params.push(criteria.yearRange.end);
      }
    }

    if (criteria.sizeRange) {
      if (criteria.sizeRange.min) {
        sql += ' AND size >= ?';
        params.push(criteria.sizeRange.min);
      }
      if (criteria.sizeRange.max) {
        sql += ' AND size <= ?';
        params.push(criteria.sizeRange.max);
      }
    }

    if (criteria.archived !== undefined) {
      sql += ' AND archived = ?';
      params.push(criteria.archived ? 1 : 0);
    }

    if (criteria.sender) {
      sql += ' AND sender LIKE ?';
      params.push(`%${criteria.sender}%`);
    }

    sql += ' ORDER BY date DESC';

    if (criteria.limit) {
      sql += ' LIMIT ?';
      params.push(criteria.limit);
      
      if (criteria.offset) {
        sql += ' OFFSET ?';
        params.push(criteria.offset);
      }
    }

    const rows = await this.all(sql, params);
    return rows.map(row => this.rowToEmailIndex(row));
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
      
      // Importance Analysis Results
      importanceScore: row.importance_score || undefined,
      importanceLevel: row.importance_level || undefined,
      importanceMatchedRules: row.importance_matched_rules ? JSON.parse(row.importance_matched_rules) : undefined,
      importanceConfidence: row.importance_confidence || undefined,
      
      // Date/Size Analysis Results
      ageCategory: row.age_category || undefined,
      sizeCategory: row.size_category || undefined,
      recencyScore: row.recency_score || undefined,
      sizePenalty: row.size_penalty || undefined,
      
      // Label Classification Results
      gmailCategory: row.gmail_category || undefined,
      spamScore: row.spam_score || undefined,
      promotionalScore: row.promotional_score || undefined,
      socialScore: row.social_score || undefined,
      spamIndicators: row.spam_indicators ? JSON.parse(row.spam_indicators) : undefined,
      promotionalIndicators: row.promotional_indicators ? JSON.parse(row.promotional_indicators) : undefined,
      socialIndicators: row.social_indicators ? JSON.parse(row.social_indicators) : undefined,
      
      // Analysis Metadata
      analysisTimestamp: row.analysis_timestamp ? new Date(row.analysis_timestamp) : undefined,
      analysisVersion: row.analysis_version || undefined
    };
  }

  // Archive rule methods
  async createArchiveRule(rule: Omit<ArchiveRule, 'id' | 'created' | 'stats'>): Promise<string> {
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
      rule.enabled ? 1 : 0
    ]);
    
    return id;
  }

  async getArchiveRules(activeOnly: boolean = false): Promise<ArchiveRule[]> {
    let sql = 'SELECT * FROM archive_rules';
    if (activeOnly) {
      sql += ' WHERE enabled = 1';
    }
    sql += ' ORDER BY created DESC';
    
    const rows = await this.all(sql);
    return rows.map(row => ({
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
        lastArchived: row.last_archived
      }
    }));
  }

  // Archive record methods
  async createArchiveRecord(record: Omit<ArchiveRecord, 'id'>): Promise<string> {
    const id = `archive_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
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
      record.restorable ? 1 : 0
    ]);
    
    return id;
  }

  // Saved search methods
  async saveSearch(name: string, criteria: any): Promise<string> {
    const id = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const sql = `
      INSERT INTO saved_searches (id, name, criteria)
      VALUES (?, ?, ?)
    `;
    
    await this.run(sql, [id, name, JSON.stringify(criteria)]);
    return id;
  }

  async getSavedSearches(): Promise<SavedSearch[]> {
    const rows = await this.all('SELECT * FROM saved_searches ORDER BY created DESC');
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      criteria: JSON.parse(row.criteria),
      created: new Date(row.created * 1000),
      lastUsed: row.last_used ? new Date(row.last_used * 1000) : new Date(row.created * 1000),
      resultCount: row.result_count
    }));
  }

  // Get email count based on criteria
  async getEmailCount(criteria: any): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM email_index WHERE 1=1';
    const params: any[] = [];

    if (criteria.category) {
      sql += ' AND category = ?';
      params.push(criteria.category);
    }

    if (criteria.year) {
      sql += ' AND year = ?';
      params.push(criteria.year);
    }

    if (criteria.yearRange) {
      if (criteria.yearRange.start) {
        sql += ' AND year >= ?';
        params.push(criteria.yearRange.start);
      }
      if (criteria.yearRange.end) {
        sql += ' AND year <= ?';
        params.push(criteria.yearRange.end);
      }
    }

    if (criteria.sizeRange) {
      if (criteria.sizeRange.min) {
        sql += ' AND size >= ?';
        params.push(criteria.sizeRange.min);
      }
      if (criteria.sizeRange.max) {
        sql += ' AND size <= ?';
        params.push(criteria.sizeRange.max);
      }
    }

    if (criteria.archived !== undefined) {
      sql += ' AND archived = ?';
      params.push(criteria.archived ? 1 : 0);
    }

    if (criteria.sender) {
      sql += ' AND sender LIKE ?';
      params.push(`%${criteria.sender}%`);
    }

    const result = await this.get(sql, params);
    return result ? result.count : 0;
  }

  // Statistics methods
  async getEmailStatistics(includeArchived: boolean = true): Promise<any> {
    const archivedCondition = includeArchived ? '' : ' AND archived = 0';
    
    // Category stats
    const categoryStats = await this.all(`
      SELECT category, COUNT(*) as count
      FROM email_index
      WHERE category IS NOT NULL ${archivedCondition}
      GROUP BY category
    `);
    
    // Year stats
    const yearStats = await this.all(`
      SELECT year, COUNT(*) as count, SUM(size) as total_size
      FROM email_index
      WHERE year IS NOT NULL ${archivedCondition}
      GROUP BY year
      ORDER BY year DESC
    `);
    
    // Size stats
    const sizeStats = await this.get(`
      SELECT 
        SUM(CASE WHEN size < 102400 THEN 1 ELSE 0 END) as small,
        SUM(CASE WHEN size >= 102400 AND size < 1048576 THEN 1 ELSE 0 END) as medium,
        SUM(CASE WHEN size >= 1048576 THEN 1 ELSE 0 END) as large,
        SUM(size) as total_size
      FROM email_index
      WHERE 1=1 ${archivedCondition}
    `);
    
    // Archive stats
    const archiveStats = await this.get(`
      SELECT COUNT(*) as count, SUM(size) as total_size
      FROM email_index
      WHERE archived = 1
    `);
    
    return {
      categories: categoryStats,
      years: yearStats,
      sizes: sizeStats,
      archived: archiveStats
    };
  }

  // mark emails as deleted
 async markEmailsAsDeleted(emailIds: string[]): Promise<void> {
  if (emailIds.length === 0) return;
  const sql = `
    UPDATE email_index
    SET archived = 1, archive_location = ?, archive_date = strftime('%s', 'now')
    WHERE id IN (${emailIds.map(() => '?').join(', ')})
  `;
  await this.run(sql, ['trash', ...emailIds]);
}

  async deleteEmailIndexs(emails: EmailIndex[]): Promise<number> {
    if (emails.length === 0) return 0;
    const sql = `DELETE FROM email_index WHERE id IN (${emails.map(() => '?').join(', ')})`;
    await this.run(sql, emails.map(email => email.id));
    return emails.length;
  }

  async close(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        this.db!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.db = null;
      this.initialized = false;
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
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
        request_params TEXT,
        progress INTEGER,
        results TEXT,
        error_details TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `;
    await this.run(query);
    
    // Create indexes
    await this.run('CREATE INDEX IF NOT EXISTS idx_job_status ON job_statuses(status)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_job_type ON job_statuses(job_type)');
    await this.run('CREATE INDEX IF NOT EXISTS idx_job_created_at ON job_statuses(created_at)');
  }

  async insertJob(job: any): Promise<void> {
    const sql = `
      INSERT INTO job_statuses (
        job_id, job_type, status, request_params, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;
    
    await this.run(sql, [
      job.job_id,
      job.job_type,
      job.status,
      JSON.stringify(job.request_params),
      Math.floor(job.created_at.getTime() / 1000)
    ]);
  }

  async getJob(jobId: string): Promise<any | null> {
    const row = await this.get('SELECT * FROM job_statuses WHERE job_id = ?', [jobId]);
    if (!row) return null;
    
    return {
      job_id: row.job_id,
      job_type: row.job_type,
      status: row.status,
      request_params: JSON.parse(row.request_params || '{}'),
      progress: row.progress,
      results: row.results ? JSON.parse(row.results) : null,
      error_details: row.error_details,
      created_at: new Date(row.created_at * 1000),
      started_at: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completed_at: row.completed_at ? new Date(row.completed_at * 1000) : undefined
    };
  }

  async updateJob(jobId: string, updates: any): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];
    
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    
    if (updates.progress !== undefined) {
      fields.push('progress = ?');
      values.push(updates.progress);
    }
    
    if (updates.results !== undefined) {
      fields.push('results = ?');
      values.push(JSON.stringify(updates.results));
    }
    
    if (updates.error_details !== undefined) {
      fields.push('error_details = ?');
      values.push(updates.error_details);
    }
    
    if (updates.started_at !== undefined) {
      fields.push('started_at = ?');
      values.push(Math.floor(updates.started_at.getTime() / 1000));
    }
    
    if (updates.completed_at !== undefined) {
      fields.push('completed_at = ?');
      values.push(Math.floor(updates.completed_at.getTime() / 1000));
    }
    
    fields.push('updated_at = strftime(\'%s\', \'now\')');
    
    if (fields.length === 0) return;
    
    const sql = `UPDATE job_statuses SET ${fields.join(', ')} WHERE job_id = ?`;
    values.push(jobId);
    
    await this.run(sql, values);
  }

  async listJobs(filters: any = {}): Promise<any[]> {
    let sql = 'SELECT * FROM job_statuses WHERE 1=1';
    const params: any[] = [];
    
    if (filters.job_type) {
      sql += ' AND job_type = ?';
      params.push(filters.job_type);
    }
    
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    
    sql += ' ORDER BY created_at DESC';
    
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
      
      if (filters.offset) {
        sql += ' OFFSET ?';
        params.push(filters.offset);
      }
    }
    
    const rows = await this.all(sql, params);
    return rows.map(row => ({
      job_id: row.job_id,
      job_type: row.job_type,
      status: row.status,
      request_params: JSON.parse(row.request_params || '{}'),
      progress: row.progress,
      results: row.results ? JSON.parse(row.results) : null,
      error_details: row.error_details,
      created_at: new Date(row.created_at * 1000),
      started_at: row.started_at ? new Date(row.started_at * 1000) : undefined,
      completed_at: row.completed_at ? new Date(row.completed_at * 1000) : undefined
    }));
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.run('DELETE FROM job_statuses WHERE job_id = ?', [jobId]);
  }

  async deleteJobsOlderThan(date: Date): Promise<number> {
    const timestamp = Math.floor(date.getTime() / 1000);
    const result = await this.execute('DELETE FROM job_statuses WHERE created_at < ?', [timestamp]);
    return result?.changes || 0;
  }
}
