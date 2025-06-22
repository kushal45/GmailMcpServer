export interface EmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload: {
    headers: Array<{
      name: string;
      value: string;
    }>;
    body?: {
      size: number;
      data?: string;
    };
    parts?: Array<{
      mimeType: string;
      body: {
        size: number;
        data?: string;
      };
    }>;
  };
  sizeEstimate: number;
  historyId: string;
  internalDate: string;
}

export interface Header {
  name: string;
  value: string;
}



export const PriorityCategory = {
    HIGH: 'high',
    MEDIUM: 'medium',
    LOW: 'low'
} as const;
export type PriorityCategory = typeof PriorityCategory[keyof typeof PriorityCategory];

export interface EmailIndex {
  id: string;
  threadId?: string;
  category?: PriorityCategory | null;
  subject?: string;
  sender?: string;
  recipients?: string[];
  date?: Date;
  year?: number;
  size?: number;
  hasAttachments?: boolean;
  labels?: string[];
  snippet?: string;
  archived?: boolean;
  archiveDate?: Date;
  archiveLocation?: string;
  user_id?: string;  // Added for multi-user support
  
  // Importance Analysis Results
  importanceScore?: number;
  importanceLevel?: 'high' | 'medium' | 'low';
  importanceMatchedRules?: string[];
  importanceConfidence?: number;
  
  // Date/Size Analysis Results
  ageCategory?: 'recent' | 'moderate' | 'old';
  sizeCategory?: 'small' | 'medium' | 'large';
  recencyScore?: number;
  sizePenalty?: number;
  
  // Label Classification Results
  gmailCategory?: 'primary' | 'important' | 'spam' | 'promotions' | 'social' | 'updates' | 'forums';
  spam_score?: number;
  promotional_score?: number;
  socialScore?: number;
  spamIndicators?: string[];
  promotionalIndicators?: string[];
  socialIndicators?: string[];
  
  // Analysis Metadata
  analysisTimestamp?: Date;
  analysisVersion?: string;
}

export interface SearchCriteria {
  query?: string;
  category?: PriorityCategory | null;
  year?: number;
  yearRange?: { start?: number; end?: number };
  sizeRange?: { min?: number; max?: number };
  sender?: string;
  hasAttachments?: boolean;
  archived?: boolean;
  labels?: string[];
  offset?: number;
  id?:string;
  ids?:string[];
}

export interface SearchEngineCriteria extends SearchCriteria {
  limit?: number;
  user_id?: string;  // Added for multi-user support
}

export interface ArchiveRule {
  id: string;
  name: string;
  criteria: {
    category?: PriorityCategory;
    olderThanDays?: number;
    sizeGreaterThan?: number;
    labels?: string[];
  };
  action: {
    method: 'gmail' | 'export';
    exportFormat?: 'mbox' | 'json';
  };
  schedule?: 'daily' | 'weekly' | 'monthly';
  enabled: boolean;
  created: Date;
  lastRun?: Date;
  stats: {
    totalArchived: number;
    lastArchived: number;
  };
}

export interface ArchiveRecord {
  id: string;
  emailIds: string[];
  archiveDate: Date;
  method: 'gmail' | 'export';
  location?: string;
  format?: string;
  size?: number;
  restorable: boolean;
}

export interface SavedSearch {
  id: string;
  name: string;
  criteria: SearchCriteria;
  created: Date;
  lastUsed: Date;
  resultCount?: number;
  user_id: string;  // Added for multi-user support
}

export interface CategoryStats {
  high: number;
  medium: number;
  low: number;
  total: number;
}

export interface YearStats {
  [year: number]: {
    count: number;
    size: number;
  };
}

export interface SizeStats {
  small: number;  // < 100KB
  medium: number; // 100KB - 1MB
  large: number;  // > 1MB
  totalSize: number;
}

export interface EmailStatistics {
  categories: CategoryStats;
  years: YearStats;
  sizes: SizeStats;
  archived: {
    count: number;
    size: number;
  };
  total: {
    count: number;
    size: number;
  };
}

export interface ListEmailsOptions {
  category?: PriorityCategory;
  year?: number;
  sizeRange?: { min?: number; max?: number };
  archived?: boolean;
  limit: number;
  offset: number;
  
  // Additional fields for Gmail API query
  query?: string;
  hasAttachments?: boolean;
  labels?: string[];
}

export interface CategorizeOptions {
  forceRefresh: boolean;
  year?: number;
  user_id?: string;  // Added for multi-user support
}

export interface ArchiveOptions {
  searchCriteria?: SearchCriteria;
  category?: PriorityCategory;
  year?: number;
  olderThanDays?: number;
  method: 'gmail' | 'export';
  exportFormat?: 'mbox' | 'json' | 'csv';
  exportPath?: string;
  dryRun: boolean;
  includeAttachments?: boolean;
}

export interface BasicDeletionOptions {
  dryRun: boolean;
  maxCount?: number;
}

export interface DeleteOptions extends BasicDeletionOptions {
  searchCriteria?: SearchCriteria;
  category?: 'high' | 'medium' | 'low';
  year?: number;
  sizeThreshold?: number;
  skipArchived: boolean;
  orderBy?: 'date' | 'size' | 'id' ;
  orderDirection?: 'ASC' | 'DESC';
  user_id?: string;  // Added for multi-user support
}

export enum JobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED="CANCELLED"
}


export interface Job {
  job_id: string;
  job_type: string;
  status: JobStatus;
  request_params: any;
  progress?: number;
  results?: any;
  error_details?: string;
  created_at: Date;
  started_at?: Date;
  completed_at?: Date;
  user_id?: string;  // Added for multi-user support
}

export interface ExportOptions {
  searchCriteria?: SearchCriteria;
  format: 'mbox' | 'json' | 'csv';
  includeAttachments: boolean;
  outputPath?: string;
  cloudUpload?: {
    provider: 'gdrive' | 's3' | 'dropbox';
    path: string;
  };
}

// ========================
// Email Cleanup System Types
// ========================

// Access Pattern Tracking
export interface EmailAccessEvent {
  email_id: string;
  access_type: 'search_result' | 'direct_view' | 'thread_view';
  timestamp: Date;
  search_query?: string;
  user_context?: string;
}

export interface SearchActivityRecord {
  search_id: string;
  query: string;
  email_results: string[];
  timestamp: Date;
  result_interactions: string[];
}

export interface EmailAccessSummary {
  email_id: string;
  total_accesses: number;
  last_accessed: Date;
  search_appearances: number;
  search_interactions: number;
  access_score: number;
  updated_at: Date;
}

// Cleanup Policy System
export interface CleanupPolicy {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  
  // Staleness criteria
  criteria: {
    age_days_min: number;
    importance_level_max: 'high' | 'medium' | 'low';
    size_threshold_min?: number; // bytes
    spam_score_min?: number; // 0-1
    promotional_score_min?: number; // 0-1
    access_score_max?: number; // 0-1
    no_access_days?: number;
  };
  
  // Actions to take
  action: {
    type: 'archive' | 'delete';
    method?: 'gmail' | 'export';
    export_format?: 'mbox' | 'json';
  };
  
  // Safety settings
  safety: {
    max_emails_per_run: number;
    require_confirmation: boolean;
    dry_run_first: boolean;
    preserve_important: boolean;
  };
  
  // Scheduling
  schedule?: {
    frequency: 'continuous' | 'daily' | 'weekly' | 'monthly';
    time?: string; // HH:MM format
    enabled: boolean;
  };
  created_at: Date;
  updated_at: Date;
}

export interface StalenessScore {
  email_id: string;
  total_score: number; // 0-1, higher = more stale
  factors: {
    age_score: number;           // 0-1 (higher = older)
    importance_score: number;    // 0-1 (higher = less important)
    size_penalty: number;        // 0-1 (higher = larger)
    spam_score: number;          // 0-1 (higher = more spam-like)
    access_score: number;        // 0-1 (higher = less accessed)
  };
  recommendation: 'keep' | 'archive' | 'delete';
  confidence: number; // 0-1
}

// Automation Configuration
export interface AutomationConfig {
  continuous_cleanup: {
    enabled: boolean;
    target_emails_per_minute: number;
    max_concurrent_operations: number;
    pause_during_peak_hours: boolean;
    peak_hours: { start: string; end: string }; // HH:MM format
  };
  
  event_triggers: {
    storage_threshold: {
      enabled: boolean;
      warning_threshold_percent: number; // 80%
      critical_threshold_percent: number; // 95%
      emergency_policies: string[]; // policy IDs
    };
    performance_threshold: {
      enabled: boolean;
      query_time_threshold_ms: number;
      cache_hit_rate_threshold: number;
    };
    email_volume_threshold: {
      enabled: boolean;
      daily_email_threshold: number;
      immediate_cleanup_policies: string[];
    };
  };
}

// Cleanup Job Types
export interface CleanupJob extends Job {
  job_type: 'continuous_cleanup' | 'scheduled_cleanup' | 'event_cleanup' | 'emergency_cleanup';
  
  cleanup_metadata: {
    policy_id?: string;
    triggered_by: 'schedule' | 'storage_threshold' | 'performance' | 'user_request' | 'continuous' | 'storage_warning' | 'performance_degradation' | 'storage_critical';
    priority: 'low' | 'normal' | 'high' | 'emergency';
    batch_size: number;
    target_emails: number;
  };
  
  progress_details: {
    emails_analyzed: number;
    emails_cleaned: number;
    storage_freed: number;
    errors_encountered: number;
    current_batch: number;
    total_batches: number;
  };
}

// Cleanup Results and Analytics
export interface CleanupResults {
  execution_id: string;
  policy_id?: string;
  started_at: Date;
  completed_at: Date;
  emails_processed: number;
  emails_deleted: number;
  emails_archived: number;
  storage_freed: number;
  errors: string[];
  success: boolean;
}

export interface AutomationStatus {
  continuous_cleanup_running: boolean;
  scheduled_jobs_count: number;
  active_policies_count: number;
  last_cleanup_time?: Date;
  next_scheduled_cleanup?: Date;
  system_health: {
    storage_usage_percent: number;
    average_query_time_ms: number;
    cache_hit_rate: number;
  };
}

// System Metrics
export interface SystemMetrics {
  timestamp: Date;
  storage_usage_percent: number;
  storage_used_bytes: number;
  storage_total_bytes: number;
  average_query_time_ms: number;
  cache_hit_rate: number;
  active_connections: number;
  cleanup_rate_per_minute: number;
  system_load_average: number;
}

// Configuration Management
export interface EmailCleanupSystemConfig {
  automation: AutomationConfig;
  policies: CleanupPolicy[];
  monitoring: {
    alerts: {
      cleanup_failure_threshold: number;
      performance_degradation_threshold: number;
      storage_critical_threshold: number;
      false_positive_rate_threshold: number;
    };
    reporting: {
      daily_summary: boolean;
      weekly_analysis: boolean;
      monthly_optimization_report: boolean;
      real_time_metrics: boolean;
    };
  };
  optimization: {
    database_optimization: boolean;
    performance_monitoring: boolean;
    adaptive_learning: boolean;
  };
  safety: {
    max_emails_per_day: number;
    confirmation_thresholds: {
      high_importance: number;
      bulk_operations: number;
    };
    rollback_capability: boolean;
    user_notification: boolean;
  };
}

// User Management System Types

export interface UserProfile {
  userId: string;          // Unique identifier for the user
  email: string;           // Primary email of the user
  displayName?: string;    // User's display name
  profilePicture?: string; // URL to user's profile picture
  created: Date;           // When the user was first registered
  lastLogin?: Date;        // Last successful login time
  role?: 'user' | 'admin'; // User role for access control
  preferences: {
    defaultCategory?: PriorityCategory;
    defaultSearchCriteria?: SearchCriteria;
    defaultExportFormat?: 'mbox' | 'json' | 'csv';
    uiSettings?: {
      theme?: 'light' | 'dark' | 'system';
      emailsPerPage?: number;
      notificationsEnabled?: boolean;
    };
  };
  isActive: boolean;       // Whether the user is active
}

export interface UserSession {
  sessionId: string;       // Unique session identifier
  userId: string;          // Reference to the user
  created: Date;           // When the session was created
  expires: Date;           // When the session expires
  lastAccessed: Date;      // Last time the session was used
  ipAddress?: string;      // IP address of the session
  userAgent?: string;      // User agent of the session
  isValid: boolean;        // Whether the session is valid
}