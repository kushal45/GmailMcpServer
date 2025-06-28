/**
 * File Access Control Types
 * Interfaces for database-centric file access control with multi-user support
 */

export interface FileMetadata {
  id: string;
  file_path: string;
  original_filename: string;
  file_type: 'email_export' | 'archive_backup' | 'search_result' | 'attachment' | 'log_file';
  size_bytes: number;
  mime_type?: string;
  checksum_sha256: string;
  encryption_status: 'none' | 'aes256' | 'gpg';
  compression_status: 'none' | 'gzip' | 'zip';
  user_id: string;
  created_at: Date;
  updated_at: Date;
  accessed_at?: Date;
  expires_at?: Date;
}

export interface FileAccessPermission {
  id: string;
  file_id: string;
  user_id: string;
  permission_type: 'read' | 'write' | 'delete' | 'share';
  granted_by: string;
  granted_at: Date;
  expires_at?: Date;
  is_active: boolean;
}

export interface AuditLogEntry {
  id: number;
  timestamp: Date;
  user_id: string;
  session_id?: string;
  action: 'file_create' | 'file_read' | 'file_write' | 'file_delete' | 'file_share' | 'permission_grant' | 'permission_revoke' | 'login' | 'logout';
  resource_type: 'file' | 'email' | 'archive' | 'search' | 'user_session';
  resource_id: string;
  details?: any; // JSON object
  ip_address?: string;
  user_agent?: string;
  success: boolean;
  error_message?: string;
}

export interface FileAccessRequest {
  file_id: string;
  user_id: string;
  session_id: string;
  permission_type: 'read' | 'write' | 'delete' | 'share';
  context?: {
    ip_address?: string;
    user_agent?: string;
    operation?: string;
  };
}

export interface FileAccessResult {
  allowed: boolean;
  reason?: string;
  file_metadata?: FileMetadata;
  effective_permissions?: string[];
}

export interface CreateFileRequest {
  file_path: string;
  original_filename: string;
  file_type: FileMetadata['file_type'];
  size_bytes: number;
  mime_type?: string;
  checksum_sha256: string;
  encryption_status?: FileMetadata['encryption_status'];
  compression_status?: FileMetadata['compression_status'];
  user_id: string;
  expires_at?: Date;
}

export interface FileAccessControlConfig {
  enable_audit_logging: boolean;
  default_file_expiration_days?: number;
  max_file_size_bytes: number;
  allowed_file_types: FileMetadata['file_type'][];
  require_encryption: boolean;
  cross_user_access_enabled: boolean;
}

export interface SecurityPolicyRule {
  id: string;
  name: string;
  description: string;
  rule_type: 'file_access' | 'user_permission' | 'session_security' | 'data_retention';
  conditions: {
    user_roles?: string[];
    file_types?: FileMetadata['file_type'][];
    time_restrictions?: {
      start_hour: number;
      end_hour: number;
      days_of_week: number[];
    };
    ip_whitelist?: string[];
    session_max_age_minutes?: number;
  };
  actions: {
    allow: boolean;
    require_approval?: boolean;
    log_level: 'info' | 'warn' | 'error';
    notification_required?: boolean;
  };
  priority: number;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface UserContext {
  user_id: string;
  session_id?: string;
  roles?: string[];
  permissions?: string[];
  ip_address?: string;
  user_agent?: string;
}

export interface FileOperationContext {
  operation: 'create' | 'read' | 'write' | 'delete' | 'share' | 'list';
  user_context: UserContext;
  file_metadata?: FileMetadata;
  additional_data?: any;
}