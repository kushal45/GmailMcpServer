-- Multi-User OAuth Architecture - Phase 1 Database Migration
-- Adds file access control tables and missing user_id foreign keys

-- Add user_id to archive_rules table
ALTER TABLE archive_rules ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_archive_rules_user_id ON archive_rules(user_id);

-- Add user_id to archive_records table  
ALTER TABLE archive_records ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_archive_records_user_id ON archive_records(user_id);

-- File metadata table for database-centric file access control
CREATE TABLE IF NOT EXISTS file_metadata (
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
  expires_at INTEGER,
  
  -- Foreign key constraints
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- File access permissions table
CREATE TABLE IF NOT EXISTS file_access_permissions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission_type TEXT NOT NULL CHECK(permission_type IN ('read', 'write', 'delete', 'share')),
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  expires_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  
  -- Foreign key constraints
  FOREIGN KEY (file_id) REFERENCES file_metadata(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL,
  
  -- Unique constraint to prevent duplicate permissions
  UNIQUE(file_id, user_id, permission_type)
);

-- Audit log table for file access tracking
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  user_id TEXT NOT NULL,
  session_id TEXT,
  action TEXT NOT NULL CHECK(action IN ('file_create', 'file_read', 'file_write', 'file_delete', 'file_share', 'permission_grant', 'permission_revoke', 'login', 'logout')),
  resource_type TEXT NOT NULL CHECK(resource_type IN ('file', 'email', 'archive', 'search', 'user_session')),
  resource_id TEXT NOT NULL,
  details TEXT, -- JSON object with additional context
  ip_address TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  
  -- Foreign key constraints
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_file_metadata_user_id ON file_metadata(user_id);
CREATE INDEX IF NOT EXISTS idx_file_metadata_file_type ON file_metadata(file_type);
CREATE INDEX IF NOT EXISTS idx_file_metadata_created_at ON file_metadata(created_at);
CREATE INDEX IF NOT EXISTS idx_file_metadata_file_path ON file_metadata(file_path);

CREATE INDEX IF NOT EXISTS idx_file_access_permissions_file_id ON file_access_permissions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_access_permissions_user_id ON file_access_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_file_access_permissions_active ON file_access_permissions(is_active);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_session_id ON audit_log(session_id);