import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { EmailIndex, ArchiveRule, ArchiveRecord, SavedSearch,SearchCriteria, SearchEngineCriteria } from '../types/index.js';

export class DatabaseManager {
  private db: sqlite3.Database | null = null;
  private dbPath: string;
  private initialized: boolean = false;

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
      
      this.initialized = true;
      logger.info('Database initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize database:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
    const queries = [
      // Email index table
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
      )`
    ];

    for (const query of queries) {
      await this.run(query);
    }
  }

  // Promisified database methods
  private run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      // If params is a 2D array, treat as multiple runs in a transaction
      if (Array.isArray(params[0])) {
        this.db!.serialize(() => {
          this.db!.run('BEGIN TRANSACTION');
          for (const paramSet of params) {
            this.db!.run(sql, paramSet, function(err) {
              if (err) {
                reject(err);
              }
            });
          }
          this.db!.run('COMMIT', (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        // Single run
        this.db!.run(sql, params, function(err) {
          if (err) reject(err);
          else resolve();
        });
      }
    });
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
        archived, archive_date, archive_location, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
    `;
    
    await this.run(sql, [
      email.id,
      email.threadId,
      email.category,
      email.subject,
      email.sender,
      JSON.stringify(email.recipients),
      email.date ? email.date.getTime() :Date.now(),
      email?.year,
      email?.size,
      email?.hasAttachments ? 1 : 0,
      JSON.stringify(email?.labels),
      email?.snippet,
      email?.archived ? 1 : 0,
      email?.archiveDate?.getTime() || null,
      email?.archiveLocation || null
    ]);
  }

  async bulkUpsertEmailIndex(emails: EmailIndex[]): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO email_index (
        id, thread_id, category, subject, sender, recipients,
        date, year, size, has_attachments, labels, snippet,
        archived, archive_date, archive_location, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
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
      email.archiveLocation || null
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
      archiveLocation: row.archive_location
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
}
