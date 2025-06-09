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

export interface EmailIndex {
  id: string;
  threadId: string;
  category: 'high' | 'medium' | 'low';
  subject: string;
  sender: string;
  recipients: string[];
  date: Date;
  year: number;
  size: number;
  hasAttachments: boolean;
  labels: string[];
  snippet: string;
  archived: boolean;
  archiveDate?: Date;
  archiveLocation?: string;
}

export interface SearchCriteria {
  query?: string;
  category?: 'high' | 'medium' | 'low';
  yearRange?: { start?: number; end?: number };
  sizeRange?: { min?: number; max?: number };
  sender?: string;
  hasAttachments?: boolean;
  archived?: boolean;
  labels?: string[];
}

export interface ArchiveRule {
  id: string;
  name: string;
  criteria: {
    category?: 'high' | 'medium' | 'low';
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
  category?: 'high' | 'medium' | 'low';
  year?: number;
  sizeRange?: { min?: number; max?: number };
  archived?: boolean;
  limit: number;
  offset: number;
}

export interface CategorizeOptions {
  forceRefresh: boolean;
  year?: number;
}

export interface ArchiveOptions {
  searchCriteria?: SearchCriteria;
  category?: 'high' | 'medium' | 'low';
  year?: number;
  olderThanDays?: number;
  method: 'gmail' | 'export';
  exportFormat?: 'mbox' | 'json';
  exportPath?: string;
  dryRun: boolean;
}

export interface DeleteOptions {
  searchCriteria?: SearchCriteria;
  category?: 'high' | 'medium' | 'low';
  year?: number;
  sizeThreshold?: number;
  skipArchived: boolean;
  dryRun: boolean;
  orderBy?: 'date' | 'size' | 'id' ;
  orderDirection?: 'ASC' | 'DESC';
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