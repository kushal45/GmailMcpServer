import { CleanupAutomationEngine } from './../cleanup/CleanupAutomationEngine.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { AuthManager } from '../auth/AuthManager.js';
import { UserManager } from '../auth/UserManager.js';
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
import { JobStatus } from '../types/index.js';
import { UserDatabaseManagerFactory } from '../database/UserDatabaseManagerFactory.js';

// Interface for user context
export interface UserContext {
  user_id: string;
  session_id: string;
}

interface ToolContext {
  authManager: AuthManager;
  userManager: UserManager;
  emailFetcher: EmailFetcher;
  searchEngine: SearchEngine;
  archiveManager: ArchiveManager;
  deleteManager: DeleteManager;
  databaseManager: DatabaseManager;
  cacheManager: CacheManager;
  jobQueue: JobQueue;
  categorizationEngine: CategorizationEngine;
  cleanupAutomationEngine: CleanupAutomationEngine;
}

const toolNamesNotRequiringAuth = ['authenticate', 'register_user','get_system_health','list_users'];

export async function handleToolCall(
  toolName: string,
  args: any,
  context: ToolContext
): Promise<{ content: Array<{ type: string; text: string }> }> {
  logger.info(`Handling tool call: ${toolName}`, { args });

  try {
    // Validate user context for all tools except authenticate and poll_user_context
    if (!toolNamesNotRequiringAuth.includes(toolName) && toolName !== 'poll_user_context') {
      await validateUserContext(args, context);
    }
    
    switch (toolName) {
      case 'authenticate':
        return await handleAuthenticate(args, context);
      case 'poll_user_context':
        return await handlePollUserContext(args, context);
      
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

      case 'empty_trash':
        return await handleEmptyTrash(args, context);
      
      case 'save_search':
        return await handleSaveSearch(args, context);
      
      case 'list_saved_searches':
        return await handleListSavedSearches(args, context);
      
      case 'get_job_status':
        return await handleGetJobStatus(args, context);
      case 'list_jobs':
        return await handleListJobs(args, context);
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
        
      // User Management Tools
      case 'register_user':
        return await handleRegisterUser(args, context);
        
      case 'get_user_profile':
        return await handleGetUserProfile(args, context);
        
      case 'switch_user':
        return await handleSwitchUser(args, context);
        
      case 'list_users':
        return await handleListUsers(args, context);

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
  const result = await context.authManager.getAuthUrl(scopes);

  let authUrl: string;
  let state: string | undefined;
  if (typeof result === 'string') {
    authUrl = result;
  } else {
    authUrl = result.authUrl;
    state = result.state;
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        success: true,
        authUrl,
        state,
        instructions: 'Please visit the URL to authenticate. After authentication, poll with the state to get your user context.'
      }, null, 2)
    }]
  };
}

async function handleListEmails(args: any, context: ToolContext) {
  // Ensure user is authenticated
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }
  const userContext = args.user_context as UserContext;
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
    offset: args.offset || 0,
  },userContext.user_id);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(emails, null, 2)
    }]
  };
}

async function handleSearchEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }
  const userContext = await args.user_context as UserContext
  const results = await context.searchEngine.search({
    query: args.query,
    category: args.category,
    yearRange: args.year_range,
    sizeRange: args.size_range,
    sender: args.sender,
    hasAttachments: args.has_attachments,
    archived: args.archived,
    limit: args.limit || 50
  },userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(results, null, 2)
    }]
  };
}

async function handleCategorizeEmails(args: any, context: ToolContext) {
  const userContext = args.user_context as UserContext;
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
        },
        userContext.user_id
    );

    // Enqueue the job for a worker to pick up
    await context.jobQueue.addJob(jobId,userContext.user_id);

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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const userContext = args.user_context as UserContext;
  const result = await context.archiveManager.archiveEmails({
    searchCriteria: args.search_criteria,
    category: args.category,
    year: args.year,
    olderThanDays: args.older_than_days,
    method: args.method,
    exportFormat: args.export_format,
    exportPath: args.export_path,
    dryRun: args.dry_run || false
  }, userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleRestoreEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const userContext = args.user_context as UserContext;
  const result = await context.archiveManager.restoreEmails({
    archiveId: args.archive_id,
    emailIds: args.email_ids,
    restoreLabels: args.restore_labels
  }, userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleCreateArchiveRule(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const userContext = args.user_context as UserContext;
  const result = await context.archiveManager.createRule({
    name: args.name,
    criteria: args.criteria,
    action: args.action,
    schedule: args.schedule
  }, userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleListArchiveRules(args: any, context: ToolContext) {
  const userContext = args.user_context as UserContext;
  const rules = await context.archiveManager.listRules({
    activeOnly: args.active_only || false
  }, userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(rules, null, 2)
    }]
  };
}

async function handleExportEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const userContext = args.user_context as UserContext;
  const result = await context.archiveManager.exportEmails({
    searchCriteria: args.search_criteria,
    format: args.format,
    includeAttachments: args.include_attachments || false,
    outputPath: args.output_path,
    cloudUpload: args.cloud_upload
  }, userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleDeleteEmails(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }
  const userContext = args.user_context as UserContext;
  const result = await context.deleteManager.deleteEmails({
    searchCriteria: args.search_criteria,
    category: args.category,
    year: args.year,
    sizeThreshold: args.size_threshold,
    skipArchived: args.skip_archived !== false,
    dryRun: args.dry_run || false,
    maxCount: args.max_count
  }, userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleEmptyTrash(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }
  const userContext = args.user_context as UserContext;
  const result = await context.deleteManager.emptyTrash({
    dryRun: args.dry_run || false,
    maxCount: args.max_count|| 10,
  }, userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleSaveSearch(args: any, context: ToolContext) {
   if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }
  const userContext = args.user_context as UserContext;
  const result = await context.searchEngine.saveSearch({
    name: args.name,
    criteria: args.criteria
  },userContext);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(result, null, 2)
    }]
  };
}

async function handleListSavedSearches(args: any, context: ToolContext) {
  const searches = await context.searchEngine.listSavedSearches(args.user_context);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify(searches, null, 2)
    }]
  };
}

async function handleGetJobStatus(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
    if(!jobStatus.user_id) {
      throw new McpError(ErrorCode.InvalidRequest, `Job ${jobId} does not have a user_id`);
    }
    const userDbManager = await UserDatabaseManagerFactory.getInstance().getUserDatabaseManager(jobStatus.user_id);
    emailList = await userDbManager.getEmailsByIds(jobStatus.results.emailIds);
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


async function handleListJobs(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }
   const jobStatusStore = JobStatusStore.getInstance();
  
  // Validate singleton integrity before proceeding
  JobStatusStore.validateSingletonIntegrity();
  const jobs = await jobStatusStore.listJobs();
  
  return {
    content: [{
      type: 'text',
      text: JSON.stringify(jobs, null, 2)
    }]
  };
}

async function handleCancelJob(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }

  const jobStatusStore = JobStatusStore.getInstance();
  JobStatusStore.validateSingletonIntegrity();
  const jobId = args.id;
  if (!jobId) {
    throw new McpError(ErrorCode.InvalidParams, 'jobId is required');
  }
  const jobStatus = await jobStatusStore.getJobStatus(jobId);
  if (!jobStatus) {
    throw new McpError(ErrorCode.InvalidRequest, `Job ${jobId} not found`);
  }
  if (jobStatus.status === JobStatus.COMPLETED || jobStatus.status === JobStatus.CANCELLED) {
   throw new McpError(ErrorCode.InvalidRequest, `Job ${jobId} is already completed or cancelled`);
  }
  await jobStatusStore.cancelJob(jobId);
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ message: 'Job cancelled successfully' }, null, 2)
    }]
  };
}

// Cleanup automation tool handlers

async function handleTriggerCleanup(args: any, context: ToolContext) {
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
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
  if (!await context.authManager.hasValidAuth(args?.user_context?.session_id)) {
    throw new McpError(ErrorCode.InvalidRequest, 'Not authenticated. Please use the authenticate tool first.');
  }
  const userContext = args.user_context as UserContext;
  const userId = userContext.user_id;
  if(!userId) {
    throw new McpError(ErrorCode.InvalidRequest, 'User ID is required in fetching email details');
  }

  const emailId = args.id;

  if (!emailId) {
    throw new McpError(ErrorCode.InvalidParams, 'emailId is required');
  }
  const userDbManager = await UserDatabaseManagerFactory.getInstance().getUserDatabaseManager(userId);
  const email = await userDbManager.getEmailIndex(emailId);

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

/**
 * Validate user context for tool calls
 */
async function validateUserContext(args: any, context: ToolContext): Promise<void> {
  // Check if user context is provided
  if (!args.user_context || !args.user_context.user_id || !args.user_context.session_id) {
    throw new McpError(
      ErrorCode.InvalidParams,
      'Invalid user context. Please provide user_id and session_id.'
    );
  }

  const { user_id, session_id } = args.user_context;
  
  // Get session from user manager
  const session = context.userManager.getSession(session_id);
  if (!session) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Invalid session. Please authenticate again.'
    );
  }
  
  // Validate session belongs to the user
  const sessionData = session.getSessionData();
  if (sessionData.userId !== user_id || !session.isValid()) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      'Invalid session for this user. Please authenticate again.'
    );
  }
  
  // Extend session validity since it was successfully used
  session.extendSession();
  
  logger.debug(`User context validated for user ${user_id} with session ${session_id}`);
}

/**
 * Handle registering a new user
 */
async function handleRegisterUser(args: any, context: ToolContext): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    let newUserRole = args?.role ?? 'user';
    // Check if caller is admin when not registering first user
    const allUsers = context.userManager.getAllUsers();
    if (allUsers.length > 0) {
      // Only first user can register without authentication
      // For subsequent registrations, check if caller is admin
      await validateUserContext(args, context);
      
      const caller = context.userManager.getUserById(args.user_context.user_id);
      if (!caller || caller.role !== 'admin') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          'Only administrators can register new users.'
        );
      }
    }
    
    // Create the new user
    const newUser = await context.userManager.createUser(
      args.email,
      args.display_name || undefined
    );
    
    // Set role if provided and valid
    if (args.role) {
      await context.userManager.updateUser(newUser.userId, { role: newUserRole });
    }
    
    // If this is the first user, automatically make them an admin
    if (allUsers.length === 0) {
      newUserRole = 'admin';
      await context.userManager.updateUser(newUser.userId, { role: newUserRole as 'user' | 'admin' });
    }
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'User registered successfully',
          userId: newUser.userId,
          displayName: newUser.displayName,
          email: newUser.email,
          role: newUserRole
        }, null, 2)
      }]
    };
  } catch (error) {
    logger.error('Error registering user:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to register user: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Handle retrieving a user profile
 */
async function handleGetUserProfile(args: any, context: ToolContext): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // Get target user ID (defaults to requesting user)
    const targetUserId = args.target_user_id || args.user_context.user_id;
    
    // Check if user has permission to view this profile
    const requestingUser = context.userManager.getUserById(args.user_context.user_id);
    const isAdmin = requestingUser?.role === 'admin';
    const isSelf = targetUserId === args.user_context.user_id;
    
    if (!isAdmin && !isSelf) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'You do not have permission to view this user profile.'
      );
    }
    
    // Get user profile
    const userProfile = context.userManager.getUserById(targetUserId);
    if (!userProfile) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `User with ID ${targetUserId} not found.`
      );
    }
    
    // Return profile without sensitive information
    const safeProfile = {
      userId: userProfile.userId,
      email: userProfile.email,
      displayName: userProfile.displayName,
      profilePicture: userProfile.profilePicture,
      created: userProfile.created,
      lastLogin: userProfile.lastLogin,
      role: userProfile.role,
      preferences: userProfile.preferences,
      isActive: userProfile.isActive
    };
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(safeProfile, null, 2)
      }]
    };
  } catch (error) {
    logger.error('Error getting user profile:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to get user profile: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Handle switching active user
 */
async function handleSwitchUser(args: any, context: ToolContext): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    const { target_user_id, user_context } = args;
    
    // Check if target user exists
    const targetUser = context.userManager.getUserById(target_user_id);
    if (!targetUser) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `User with ID ${target_user_id} not found.`
      );
    }
    
    // Check if target user is active
    if (!targetUser.isActive) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `User ${target_user_id} is not active.`
      );
    }
    
    // Check permissions
    const requestingUser = context.userManager.getUserById(user_context.user_id);
    const isAdmin = requestingUser?.role === 'admin';
    
    if (!isAdmin && user_context.user_id !== target_user_id) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'You do not have permission to switch to this user.'
      );
    }
    
    // Invalidate the current session
    context.userManager.invalidateSession(user_context.session_id);
    
    // Create a new session for the target user
    const newSession = context.userManager.createSession(target_user_id);
    const sessionData = newSession.getSessionData();
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: 'User switched successfully',
          userId: target_user_id,
          sessionId: sessionData.sessionId,
          expires: sessionData.expires
        }, null, 2)
      }]
    };
  } catch (error) {
    logger.error('Error switching user:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to switch user: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Handle listing all users (admin only)
 */
async function handleListUsers(args: any, context: ToolContext): Promise<{ content: Array<{ type: string; text: string }> }> {
  try {
    // Check if user has admin permissions
    const requestingUser = context.userManager.getUserById(args.user_context.user_id);
    if (!requestingUser || requestingUser.role !== 'admin') {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Only administrators can list all users.'
      );
    }
    
    // Get all users
    let users = context.userManager.getAllUsers();
    
    // Filter by active status if requested
    if (args.active_only) {
      users = users.filter(user => user.isActive);
    }
    
    // Map to safe user data
    const safeUsers = users.map(user => ({
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      created: user.created,
      lastLogin: user.lastLogin,
      isActive: user.isActive
    }));
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          users: safeUsers,
          total: safeUsers.length
        }, null, 2)
      }]
    };
  } catch (error) {
    logger.error('Error listing users:', error);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list users: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function handlePollUserContext(args: any, context: ToolContext): Promise<{ content: { type: string; text: string }[] }> {
  const { state } = args;
  if (!state) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ status: 'error', error: 'Missing state parameter' }, null, 2)
      }]
    };
  }
  const completedMap = (context.authManager as any).completedUserContexts as Map<string, { user_id: string; session_id: string }>;
  if (completedMap && completedMap.has(state)) {
    const userContext = completedMap.get(state);
    // Optionally: completedMap.delete(state); // Uncomment for one-time retrieval
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ status: 'success', userContext }, null, 2)
      }]
    };
  }
  const pendingMap = (context.authManager as any).pendingUserContextRequests as Map<string, { resolve: (userContext: { user_id: string; session_id: string }) => void, reject: (error: Error) => void }>;
  if (!pendingMap) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ status: 'error', error: 'Server misconfiguration' }, null, 2)
      }]
    };
  }
  return new Promise<{ content: { type: string; text: string }[] }>((resolve) => {
    const pending = pendingMap.get(state);
    if (!pending) {
      resolve({
        content: [{
          type: 'text',
          text: JSON.stringify({ status: 'not_found' }, null, 2)
        }]
      });
      return;
    }
    // Wait for the promise to resolve (with a timeout)
    const timeout = setTimeout(() => {
      resolve({
        content: [{
          type: 'text',
          text: JSON.stringify({ status: 'pending' }, null, 2)
        }]
      });
    }, 10000);
    pendingMap.set(state, {
      resolve: (user_context) => {
        clearTimeout(timeout);
        resolve({
          content: [{
            type: 'text',
            text: JSON.stringify({ status: 'success', userContext: user_context }, null, 2)
          }]
        });
      },
      reject: (err) => {
        clearTimeout(timeout);
        resolve({
          content: [{
            type: 'text',
            text: JSON.stringify({ status: 'error', error: err.message }, null, 2)
          }]
        });
      }
    });
  });
}