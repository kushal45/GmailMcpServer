import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from '../auth/AuthManager.js';
import { EmailFetcher } from '../email/EmailFetcher.js';
import { CategorizationEngine } from '../categorization/CategorizationEngine.js';
import { SearchEngine } from '../search/SearchEngine.js';
import { ArchiveManager } from '../archive/ArchiveManager.js';
import { DeleteManager } from '../delete/DeleteManager.js';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { logger } from '../utils/logger.js';

interface ToolContext {
  authManager: AuthManager;
  emailFetcher: EmailFetcher;
  categorizationEngine: CategorizationEngine;
  searchEngine: SearchEngine;
  archiveManager: ArchiveManager;
  deleteManager: DeleteManager;
  databaseManager: DatabaseManager;
  cacheManager: CacheManager;
}

export async function handleToolCall(
  toolName: string,
  args: any,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  logger.info(`Handling tool call: ${toolName}`, { args });

  try {
    switch (toolName) {
      case 'authenticate':
        return await handleAuthenticate(args, context);
      
      case 'list_emails':
        return await handleListEmails(args, context);
      
      case 'search_emails':
        return await handleSearchEmails(args, context);
      
      case 'categorize_emails':
        return await handleCategorizeEmails(args, context);
      
      case 'get_email_stats':
        return await handleGetEmailStats(args, context);
      
      case 'archive_emails':
        return await handleArchiveEmails(args, context);
      
      case 'restore_emails':
        return await handleRestoreEmails(args, context);
      
      case 'create_archive_rule':
        return await handleCreateArchiveRule(args, context);
      
      case 'list_archive_rules':
        return await handleListArchiveRules(args, context);
      
      case 'export_emails':
        return await handleExportEmails(args, context);
      
      case 'delete_emails':
        return await handleDeleteEmails(args, context);
      
      case 'save_search':
        return await handleSaveSearch(args, context);
      
      case 'list_saved_searches':
        return await handleListSavedSearches(args, context);
      
      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
    }
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }
    console.error(`Unhandled error in tool ${toolName}:`, (error as Error).message, (error as Error).stack);
    logger.error(`Error in tool ${toolName}:`, (error as Error).message);
    throw new McpError(
      ErrorCode.InternalError,
      `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handleAuthenticate(args: any, context: ToolContext) {
  const scopes = args.scopes || [];
  const authUrl = await context.authManager.getAuthUrl(scopes);
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        authUrl,
        instructions: 'Please visit the URL to authenticate. After authentication, the server will automatically detect and store your credentials.'
      }, null, 2)
    }]
  };
}

async function handleListEmails(args: any, context: ToolContext) {
  // Ensure user is authenticated
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const emails = await context.emailFetcher.listEmails({
    category: args.category,
    year: args.year,
    sizeRange: args.size_min || args.size_max ? {
      min: args.size_min,
      max: args.size_max
    } : undefined,
    archived: args.archived,
    hasAttachments: args.has_attachments,
    labels: args.labels,
    query: args.query,
    limit: args.limit || 50,
    offset: args.offset || 0
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(emails, null, 2)
    }]
  };
}

async function handleSearchEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const results = await context.searchEngine.search({
    query: args.query,
    category: args.category,
    yearRange: args.year_range,
    sizeRange: args.size_range,
    sender: args.sender,
    hasAttachments: args.has_attachments,
    archived: args.archived,
    limit: args.limit || 50
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(results, null, 2)
    }]
  };
}

async function handleCategorizeEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }
  logger.info('Categorizing emails with args:', JSON.stringify(args, null, 2));
  const result = await context.categorizationEngine.categorizeEmails({
    forceRefresh: args.force_refresh || false,
    year: args.year
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleGetEmailStats(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const stats = await context.categorizationEngine.getStatistics({
    groupBy: args.group_by,
    includeArchived: args.include_archived !== false
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(stats, null, 2)
    }]
  };
}

async function handleArchiveEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const result = await context.archiveManager.archiveEmails({
    searchCriteria: args.search_criteria,
    category: args.category,
    year: args.year,
    olderThanDays: args.older_than_days,
    method: args.method,
    exportFormat: args.export_format,
    exportPath: args.export_path,
    dryRun: args.dry_run || false
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleRestoreEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const result = await context.archiveManager.restoreEmails({
    archiveId: args.archive_id,
    emailIds: args.email_ids,
    restoreLabels: args.restore_labels
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleCreateArchiveRule(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const result = await context.archiveManager.createRule({
    name: args.name,
    criteria: args.criteria,
    action: args.action,
    schedule: args.schedule
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleListArchiveRules(args: any, context: ToolContext) {
  const rules = await context.archiveManager.listRules({
    activeOnly: args.active_only || false
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(rules, null, 2)
    }]
  };
}

async function handleExportEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const result = await context.archiveManager.exportEmails({
    searchCriteria: args.search_criteria,
    format: args.format,
    includeAttachments: args.include_attachments || false,
    outputPath: args.output_path,
    cloudUpload: args.cloud_upload
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleDeleteEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  // Require explicit confirmation for deletion
  if (!args.confirm && !args.dry_run) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Deletion requires explicit confirmation. Set confirm: true or use dry_run: true to preview.'
    );
  }

  const result = await context.deleteManager.deleteEmails({
    searchCriteria: args.search_criteria,
    category: args.category,
    year: args.year,
    sizeThreshold: args.size_threshold,
    skipArchived: args.skip_archived !== false,
    dryRun: args.dry_run || false
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleSaveSearch(args: any, context: ToolContext) {
  const result = await context.searchEngine.saveSearch({
    name: args.name,
    criteria: args.criteria
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleListSavedSearches(args: any, context: ToolContext) {
  const searches = await context.searchEngine.listSavedSearches();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(searches, null, 2)
    }]
  };
}