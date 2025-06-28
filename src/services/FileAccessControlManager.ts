import { DatabaseManager } from "../database/DatabaseManager.js";
import { UserSession } from "../auth/UserSession.js";
import { logger } from "../utils/logger.js";
import {
  FileMetadata,
  FileAccessPermission,
  AuditLogEntry,
  FileAccessRequest,
  FileAccessResult,
  CreateFileRequest,
  FileAccessControlConfig,
  SecurityPolicyRule,
  UserContext,
  FileOperationContext
} from "../types/file-access-control.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export class FileAccessControlManager {
  private databaseManager: DatabaseManager;
  private config: FileAccessControlConfig;
  private initialized: boolean = false;

  constructor(databaseManager: DatabaseManager, config?: Partial<FileAccessControlConfig>) {
    this.databaseManager = databaseManager;
    this.config = {
      enable_audit_logging: true,
      default_file_expiration_days: 90,
      max_file_size_bytes: 100 * 1024 * 1024, // 100MB
      allowed_file_types: ['email_export', 'archive_backup', 'search_result', 'attachment', 'log_file'],
      require_encryption: false,
      cross_user_access_enabled: false,
      ...config
    };
  }

  /**
   * Initialize the file access control manager
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Ensure database is initialized
      if (!this.databaseManager.isInitialized()) {
        await this.databaseManager.initialize();
      }

      // Apply database migration for file access control tables
      await this.applyFileAccessControlMigration();

      this.initialized = true;
      logger.info("FileAccessControlManager initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize FileAccessControlManager:", error);
      throw error;
    }
  }

  /**
   * Apply database migration for file access control tables
   */
  private async applyFileAccessControlMigration(): Promise<void> {
    try {
      // Check if tables already exist
      const tableExists = await this.databaseManager.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='file_metadata'"
      );

      if (tableExists) {
        logger.info("File access control tables already exist, skipping migration");
        return;
      }

      // Read and execute migration SQL
      const migrationPath = path.join(process.cwd(), 'src/database/migrations/001_multi_user_file_access_control.sql');
      
      try {
        const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
        const statements = migrationSQL.split(';').filter(stmt => stmt.trim());
        
        for (const statement of statements) {
          if (statement.trim()) {
            await this.databaseManager.execute(statement);
          }
        }
        
        logger.info("File access control migration applied successfully");
      } catch (migrationError) {
        // If migration file doesn't exist, create tables programmatically
        logger.warn("Migration file not found, creating tables programmatically");
        await this.createTablesDirectly();
      }
    } catch (error) {
      logger.error("Failed to apply file access control migration:", error);
      throw error;
    }
  }

  /**
   * Create tables directly if migration file is not available
   */
  private async createTablesDirectly(): Promise<void> {
    const queries = [
      // Add user_id to archive_rules table
      `ALTER TABLE archive_rules ADD COLUMN user_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_archive_rules_user_id ON archive_rules(user_id)`,

      // Add user_id to archive_records table  
      `ALTER TABLE archive_records ADD COLUMN user_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_archive_records_user_id ON archive_records(user_id)`,

      // File metadata table
      `CREATE TABLE IF NOT EXISTS file_metadata (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_type TEXT NOT NULL CHECK(file_type IN ('email_export', 'archive_backup', 'search_result', 'attachment', 'log_file')),
        size_bytes INTEGER NOT NULL,
        mime_type TEXT,
        checksum_sha256 TEXT NOT NULL,
        encryption_status TEXT NOT NULL CHECK(encryption_status IN ('none', 'aes256', 'gpg')) DEFAULT 'none',
        compression_status TEXT NOT NULL CHECK(compression_status IN ('none', 'gzip', 'zip')) DEFAULT 'none',
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        accessed_at INTEGER,
        expires_at INTEGER
      )`,

      // File access permissions table
      `CREATE TABLE IF NOT EXISTS file_access_permissions (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        permission_type TEXT NOT NULL CHECK(permission_type IN ('read', 'write', 'delete', 'share')),
        granted_by TEXT,
        granted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        expires_at INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (file_id) REFERENCES file_metadata(id) ON DELETE CASCADE,
        UNIQUE(file_id, user_id, permission_type)
      )`,

      // Audit log table
      `CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        user_id TEXT NOT NULL,
        session_id TEXT,
        action TEXT NOT NULL CHECK(action IN ('file_create', 'file_read', 'file_write', 'file_delete', 'file_share', 'permission_grant', 'permission_revoke', 'login', 'logout')),
        resource_type TEXT NOT NULL CHECK(resource_type IN ('file', 'email', 'archive', 'search', 'user_session')),
        resource_id TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        error_message TEXT
      )`,

      // Create indexes
      `CREATE INDEX IF NOT EXISTS idx_file_metadata_user_id ON file_metadata(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_file_metadata_file_type ON file_metadata(file_type)`,
      `CREATE INDEX IF NOT EXISTS idx_file_metadata_created_at ON file_metadata(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_file_metadata_file_path ON file_metadata(file_path)`,
      `CREATE INDEX IF NOT EXISTS idx_file_access_permissions_file_id ON file_access_permissions(file_id)`,
      `CREATE INDEX IF NOT EXISTS idx_file_access_permissions_user_id ON file_access_permissions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_file_access_permissions_active ON file_access_permissions(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_session_id ON audit_log(session_id)`
    ];

    for (const query of queries) {
      try {
        await this.databaseManager.execute(query);
      } catch (error: any) {
        // Ignore "duplicate column name" errors for ALTER TABLE
        if (!error.message.includes("duplicate column name")) {
          throw error;
        }
      }
    }
  }

  /**
   * Create file metadata record
   */
  async createFileMetadata(request: CreateFileRequest): Promise<FileMetadata> {
    const fileId = this.generateFileId();
    const now = new Date();
    const expiresAt = request.expires_at || (this.config.default_file_expiration_days 
      ? new Date(now.getTime() + this.config.default_file_expiration_days * 24 * 60 * 60 * 1000)
      : undefined);

    const fileMetadata: FileMetadata = {
      id: fileId,
      file_path: request.file_path,
      original_filename: request.original_filename,
      file_type: request.file_type,
      size_bytes: request.size_bytes,
      mime_type: request.mime_type,
      checksum_sha256: request.checksum_sha256,
      encryption_status: request.encryption_status || 'none',
      compression_status: request.compression_status || 'none',
      user_id: request.user_id,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt
    };

    // Validate file creation request
    await this.validateFileCreation(fileMetadata);

    // Insert file metadata
    const sql = `
      INSERT INTO file_metadata (
        id, file_path, original_filename, file_type, size_bytes, mime_type, 
        checksum_sha256, encryption_status, compression_status, user_id, 
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.databaseManager.execute(sql, [
      fileMetadata.id,
      fileMetadata.file_path,
      fileMetadata.original_filename,
      fileMetadata.file_type,
      fileMetadata.size_bytes,
      fileMetadata.mime_type,
      fileMetadata.checksum_sha256,
      fileMetadata.encryption_status,
      fileMetadata.compression_status,
      fileMetadata.user_id,
      Math.floor(fileMetadata.created_at.getTime() / 1000),
      Math.floor(fileMetadata.updated_at.getTime() / 1000),
      expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null
    ]);

    // Grant owner permissions
    await this.grantFilePermission(fileId, request.user_id, 'read', request.user_id);
    await this.grantFilePermission(fileId, request.user_id, 'write', request.user_id);
    await this.grantFilePermission(fileId, request.user_id, 'delete', request.user_id);
    await this.grantFilePermission(fileId, request.user_id, 'share', request.user_id);

    // Log file creation
    await this.auditLog({
      user_id: request.user_id,
      action: 'file_create',
      resource_type: 'file',
      resource_id: fileId,
      details: {
        file_type: fileMetadata.file_type,
        size_bytes: fileMetadata.size_bytes,
        encryption_status: fileMetadata.encryption_status
      },
      success: true
    });

    logger.info(`File metadata created: ${fileId}`, {
      user_id: request.user_id,
      file_type: fileMetadata.file_type,
      size_bytes: fileMetadata.size_bytes
    });

    return fileMetadata;
  }

  /**
   * Check if user has access to a file
   */
  async checkFileAccess(request: FileAccessRequest): Promise<FileAccessResult> {
    try {
      // Get file metadata
      const fileMetadata = await this.getFileMetadata(request.file_id);
      if (!fileMetadata) {
        return {
          allowed: false,
          reason: 'File not found'
        };
      }

      // Check if file is expired
      if (fileMetadata.expires_at && fileMetadata.expires_at < new Date()) {
        return {
          allowed: false,
          reason: 'File has expired'
        };
      }

      // Owner always has access
      if (fileMetadata.user_id === request.user_id) {
        await this.updateFileAccessTime(request.file_id);
        return {
          allowed: true,
          file_metadata: fileMetadata,
          effective_permissions: ['read', 'write', 'delete', 'share']
        };
      }

      // Check explicit permissions
      const permissions = await this.getUserFilePermissions(request.file_id, request.user_id);
      const hasPermission = permissions.some(p => 
        p.permission_type === request.permission_type && 
        p.is_active &&
        (!p.expires_at || p.expires_at > new Date())
      );

      if (!hasPermission) {
        return {
          allowed: false,
          reason: 'Insufficient permissions'
        };
      }

      // Update access time if reading
      if (request.permission_type === 'read') {
        await this.updateFileAccessTime(request.file_id);
      }

      return {
        allowed: true,
        file_metadata: fileMetadata,
        effective_permissions: permissions
          .filter(p => p.is_active && (!p.expires_at || p.expires_at > new Date()))
          .map(p => p.permission_type)
      };

    } catch (error) {
      logger.error('Error checking file access:', error);
      return {
        allowed: false,
        reason: 'Access check failed'
      };
    }
  }

  /**
   * Grant file permission to a user
   */
  async grantFilePermission(
    fileId: string, 
    userId: string, 
    permissionType: 'read' | 'write' | 'delete' | 'share',
    grantedBy: string,
    expiresAt?: Date
  ): Promise<void> {
    const permissionId = this.generatePermissionId();
    
    const sql = `
      INSERT OR REPLACE INTO file_access_permissions (
        id, file_id, user_id, permission_type, granted_by, granted_at, expires_at, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.databaseManager.execute(sql, [
      permissionId,
      fileId,
      userId,
      permissionType,
      grantedBy,
      Math.floor(Date.now() / 1000),
      expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null,
      1
    ]);

    // Log permission grant
    await this.auditLog({
      user_id: grantedBy,
      action: 'permission_grant',
      resource_type: 'file',
      resource_id: fileId,
      details: {
        target_user_id: userId,
        permission_type: permissionType,
        expires_at: expiresAt?.toISOString()
      },
      success: true
    });
  }

  /**
   * Revoke file permission from a user
   */
  async revokeFilePermission(
    fileId: string, 
    userId: string, 
    permissionType: 'read' | 'write' | 'delete' | 'share',
    revokedBy: string
  ): Promise<void> {
    const sql = `
      UPDATE file_access_permissions 
      SET is_active = 0, updated_at = strftime('%s', 'now')
      WHERE file_id = ? AND user_id = ? AND permission_type = ?
    `;

    await this.databaseManager.execute(sql, [fileId, userId, permissionType]);

    // Log permission revoke
    await this.auditLog({
      user_id: revokedBy,
      action: 'permission_revoke',
      resource_type: 'file',
      resource_id: fileId,
      details: {
        target_user_id: userId,
        permission_type: permissionType
      },
      success: true
    });
  }

  /**
   * Get file metadata by ID
   */
  async getFileMetadata(fileId: string): Promise<FileMetadata | null> {
    const row = await this.databaseManager.query(
      'SELECT * FROM file_metadata WHERE id = ?',
      [fileId]
    );

    if (!row) return null;

    return this.rowToFileMetadata(row);
  }

  /**
   * Get user's file permissions for a specific file
   */
  async getUserFilePermissions(fileId: string, userId: string): Promise<FileAccessPermission[]> {
    const rows = await this.databaseManager.queryAll(
      'SELECT * FROM file_access_permissions WHERE file_id = ? AND user_id = ? AND is_active = 1',
      [fileId, userId]
    );

    return rows.map(row => this.rowToFileAccessPermission(row));
  }

  /**
   * Get all files accessible by a user
   */
  async getUserFiles(userId: string, fileType?: string): Promise<FileMetadata[]> {
    let sql = `
      SELECT DISTINCT fm.* FROM file_metadata fm
      LEFT JOIN file_access_permissions fap ON fm.id = fap.file_id
      WHERE (fm.user_id = ? OR (fap.user_id = ? AND fap.is_active = 1))
      AND (fm.expires_at IS NULL OR fm.expires_at > strftime('%s', 'now'))
    `;
    
    const params = [userId, userId];

    if (fileType) {
      sql += ' AND fm.file_type = ?';
      params.push(fileType);
    }

    sql += ' ORDER BY fm.created_at DESC';

    const rows = await this.databaseManager.queryAll(sql, params);
    return rows.map(row => this.rowToFileMetadata(row));
  }

  /**
   * Log audit entry
   */
  async auditLog(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): Promise<void> {
    if (!this.config.enable_audit_logging) {
      return;
    }

    const sql = `
      INSERT INTO audit_log (
        user_id, session_id, action, resource_type, resource_id, 
        details, ip_address, user_agent, success, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await this.databaseManager.execute(sql, [
      entry.user_id,
      entry.session_id || null,
      entry.action,
      entry.resource_type,
      entry.resource_id,
      entry.details ? JSON.stringify(entry.details) : null,
      entry.ip_address || null,
      entry.user_agent || null,
      entry.success ? 1 : 0,
      entry.error_message || null
    ]);
  }

  /**
   * Clean up expired files
   */
  async cleanupExpiredFiles(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    
    // Get expired files
    const expiredFiles = await this.databaseManager.queryAll(
      'SELECT * FROM file_metadata WHERE expires_at <= ?',
      [now]
    );

    let deletedCount = 0;

    for (const file of expiredFiles) {
      try {
        // Delete physical file if it exists
        try {
          await fs.unlink(file.file_path);
        } catch (error) {
          // File might not exist, log but continue
          logger.warn(`Failed to delete physical file: ${file.file_path}`, error);
        }

        // Delete metadata (permissions will be cascade deleted)
        await this.databaseManager.execute(
          'DELETE FROM file_metadata WHERE id = ?',
          [file.id]
        );

        // Log cleanup
        await this.auditLog({
          user_id: 'system',
          action: 'file_delete',
          resource_type: 'file',
          resource_id: file.id,
          details: {
            reason: 'expired_cleanup',
            expired_at: new Date(file.expires_at * 1000).toISOString()
          },
          success: true
        });

        deletedCount++;
      } catch (error) {
        logger.error(`Failed to cleanup expired file: ${file.id}`, error);
      }
    }

    logger.info(`Cleaned up ${deletedCount} expired files`);
    return deletedCount;
  }

  /**
   * Helper methods
   */
  private generateFileId(): string {
    return `file_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private generatePermissionId(): string {
    return `perm_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private async validateFileCreation(fileMetadata: FileMetadata): Promise<void> {
    // Check file size
    if (fileMetadata.size_bytes > this.config.max_file_size_bytes) {
      throw new Error(`File size exceeds maximum allowed: ${this.config.max_file_size_bytes} bytes`);
    }

    // Check file type
    if (!this.config.allowed_file_types.includes(fileMetadata.file_type)) {
      throw new Error(`File type not allowed: ${fileMetadata.file_type}`);
    }

    // Check encryption requirement
    if (this.config.require_encryption && fileMetadata.encryption_status === 'none') {
      throw new Error('File encryption is required');
    }
  }

  private async updateFileAccessTime(fileId: string): Promise<void> {
    await this.databaseManager.execute(
      'UPDATE file_metadata SET accessed_at = strftime("%s", "now") WHERE id = ?',
      [fileId]
    );
  }

  private rowToFileMetadata(row: any): FileMetadata {
    return {
      id: row.id,
      file_path: row.file_path,
      original_filename: row.original_filename,
      file_type: row.file_type,
      size_bytes: row.size_bytes,
      mime_type: row.mime_type,
      checksum_sha256: row.checksum_sha256,
      encryption_status: row.encryption_status,
      compression_status: row.compression_status,
      user_id: row.user_id,
      created_at: new Date(row.created_at * 1000),
      updated_at: new Date(row.updated_at * 1000),
      accessed_at: row.accessed_at ? new Date(row.accessed_at * 1000) : undefined,
      expires_at: row.expires_at ? new Date(row.expires_at * 1000) : undefined
    };
  }

  private rowToFileAccessPermission(row: any): FileAccessPermission {
    return {
      id: row.id,
      file_id: row.file_id,
      user_id: row.user_id,
      permission_type: row.permission_type,
      granted_by: row.granted_by,
      granted_at: new Date(row.granted_at * 1000),
      expires_at: row.expires_at ? new Date(row.expires_at * 1000) : undefined,
      is_active: row.is_active === 1
    };
  }
}