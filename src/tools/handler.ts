import { CleanupAutomationEngine } from './../cleanup/CleanupAutomationEngine.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from '../auth/AuthManager.js';
import { EmailFetcher } from '../email/EmailFetcher.js';
import { SearchEngine } from '../search/SearchEngine.js';
import { ArchiveManager } from '../archive/ArchiveManager.js';
import { DeleteManager } from '../delete/DeleteManager.js';
import { DatabaseManager } from '../database/DatabaseManager.js';
import { CacheManager } from '../cache/CacheManager.js';
import { logger } from '../utils/logger.js';
import { JobStatusStore } from '../database/JobStatusStore.js';
import { JobQueue } from '../database/JobQueue.js';
import { CategorizationEngine } from '../categorization/CategorizationEngine.js';
import { JobStatus } from '../database/jobStatusTypes.js';

interface ToolContext {
  authManager: AuthManager;
  emailFetcher: EmailFetcher;
  searchEngine: SearchEngine;
  archiveManager: ArchiveManager;
  deleteManager: DeleteManager;
  databaseManager: DatabaseManager;
  cacheManager: CacheManager;
  jobQueue: JobQueue;
  categorizationEngine:CategorizationEngine
  cleanupAutomationEngine:CleanupAutomationEngine;
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
      
      case 'get_job_status':
        return await handleGetJobStatus(args, context);
      case 'get_email_details':
        return await handleGetEmailDetails(args, context);
      
      // Cleanup automation tools
      case 'trigger_cleanup':
        return await handleTriggerCleanup(args, context);
      
      case 'get_cleanup_status':
        return await handleGetCleanupStatus(args, context);
      
      case 'get_system_health':
        return await handleGetSystemHealth(args, context);
      
      case 'create_cleanup_policy':
        return await handleCreateCleanupPolicy(args, context);
      
      case 'update_cleanup_policy':
        return await handleUpdateCleanupPolicy(args, context);
      
      case 'list_cleanup_policies':
        return await handleListCleanupPolicies(args, context);
      
      case 'delete_cleanup_policy':
        return await handleDeleteCleanupPolicy(args, context);
      
      case 'create_cleanup_schedule':
        return await handleCreateCleanupSchedule(args, context);
      
      case 'update_cleanup_automation_config':
        return await handleUpdateCleanupAutomationConfig(args, context);
      
      case 'get_cleanup_metrics':
        return await handleGetCleanupMetrics(args, context);
      
      case 'get_cleanup_recommendations':
        return await handleGetCleanupRecommendations(args, context);

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
  try {
    // Use JobStatusStore singleton to ensure consistent database access
    const jobStatusStore = JobStatusStore.getInstance();
    
    // Validate singleton integrity before proceeding
    JobStatusStore.validateSingletonIntegrity();
    
    const jobType = 'categorize_emails';
    const jobId = await jobStatusStore.createJob(
        jobType, // job_type
        {
            forceRefresh: args.force_refresh || false,
            year: args.year
        }
    );

    // Enqueue the job for a worker to pick up
    await context.jobQueue.addJob(jobId);

    // 3. Immediate Response
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ jobId }, null, 2)
      }]
    };
} catch (error) {
    console.error('Failed to submit categorize_emails job:', error);
    // Handle error appropriately, perhaps return a JobFailed status or throw a server error
    throw new Error('Could not initiate email categorization job.');
}

  
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
    dryRun: args.dry_run || false,
    confirm: args.confirm || false
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

async function handleGetJobStatus(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  // Use JobStatusStore singleton to ensure consistent database access
  const jobStatusStore = JobStatusStore.getInstance();
  
  // Validate singleton integrity before proceeding
  JobStatusStore.validateSingletonIntegrity();
  
  const jobId = args.id;

  if (!jobId) {
    throw new McpError(ErrorCode.InvalidParams, 'jobId is required');
  }

  const jobStatus = await jobStatusStore.getJobStatus(jobId);

  if (!jobStatus) {
    throw new McpError(ErrorCode.InvalidRequest, `Job ${jobId} not found`);
  }

  let emailList = null;
  if (jobStatus.status === JobStatus.COMPLETED && jobStatus.results?.emailIds) {
    emailList = await context.databaseManager.getEmailsByIds(jobStatus.results.emailIds);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        jobStatus: {
          id: jobStatus.job_id,
          type: jobStatus.job_type,
          status: jobStatus.status,
          progress: jobStatus.progress,
          results: jobStatus.results,
          error: jobStatus.error_details,
          createdAt: jobStatus.created_at,
          startedAt: jobStatus.started_at,
          completedAt: jobStatus.completed_at
        },
        emails: emailList
      }, null, 2)
    }]
  };
}

// Cleanup automation tool handlers

async function handleTriggerCleanup(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const jobId = await context.cleanupAutomationEngine.triggerManualCleanup(args.policy_id, {
    dry_run: args.dry_run || false,
    max_emails: args.max_emails,
    force: args.force || false
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ jobId, message: 'Cleanup job triggered successfully' }, null, 2)
    }]
  };
}

async function handleGetCleanupStatus(args: any, context: ToolContext) {
  const status = await context.cleanupAutomationEngine.getAutomationStatus();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(status, null, 2)
    }]
  };
}

async function handleGetSystemHealth(args: any, context: ToolContext) {
  const health = await context.cleanupAutomationEngine['healthMonitor'].getCurrentHealth();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(health, null, 2)
    }]
  };
}

async function handleCreateCleanupPolicy(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const policyEngine = context.cleanupAutomationEngine['policyEngine'];
  const policyId = await policyEngine.createPolicy({
    name: args.name,
    enabled: args.enabled !== false,
    priority: args.priority || 50,
    criteria: args.criteria,
    action: args.action,
    safety: args.safety,
    schedule: args.schedule
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ policyId, message: 'Cleanup policy created successfully' }, null, 2)
    }]
  };
}

async function handleUpdateCleanupPolicy(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const policyEngine = context.cleanupAutomationEngine['policyEngine'];
  await policyEngine.updatePolicy(args.policy_id, args.updates);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ message: 'Cleanup policy updated successfully' }, null, 2)
    }]
  };
}

async function handleListCleanupPolicies(args: any, context: ToolContext) {
  const policyEngine = context.cleanupAutomationEngine['policyEngine'];
  const policies = args.active_only
    ? await policyEngine.getActivePolicies()
    : await policyEngine.getAllPolicies();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(policies, null, 2)
    }]
  };
}

async function handleDeleteCleanupPolicy(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const policyEngine = context.cleanupAutomationEngine['policyEngine'];
  await policyEngine.deletePolicy(args.policy_id);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ message: 'Cleanup policy deleted successfully' }, null, 2)
    }]
  };
}

async function handleCreateCleanupSchedule(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const scheduler = context.cleanupAutomationEngine['scheduler'];
  const scheduleId = await scheduler.createSchedule({
    name: args.name,
    type: args.type,
    expression: args.expression,
    policy_id: args.policy_id,
    enabled: args.enabled !== false
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ scheduleId, message: 'Cleanup schedule created successfully' }, null, 2)
    }]
  };
}

async function handleUpdateCleanupAutomationConfig(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  await context.cleanupAutomationEngine.updateConfiguration(args.config);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ message: 'Automation configuration updated successfully' }, null, 2)
    }]
  };
}

async function handleGetCleanupMetrics(args: any, context: ToolContext) {
  const healthMonitor = context.cleanupAutomationEngine['healthMonitor'];
  const metrics = await healthMonitor.getMetricsHistory(args.hours || 24);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(metrics, null, 2)
    }]
  };
}

async function handleGetCleanupRecommendations(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const policyEngine = context.cleanupAutomationEngine['policyEngine'];
  const recommendations = await policyEngine.generatePolicyRecommendations();

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(recommendations, null, 2)
    }]
  };
}

async function handleGetEmailDetails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth()) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const emailId = args.id;

  if (!emailId) {
    throw new McpError(ErrorCode.InvalidParams, 'emailId is required');
  }

  const email = await context.databaseManager.getEmailIndex(emailId);

  if (!email) {
    throw new McpError(ErrorCode.InvalidRequest, `Email ${emailId} not found`);
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(email, null, 2)
    }]
  };
}