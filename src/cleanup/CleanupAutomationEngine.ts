import { DatabaseManager } from '../database/DatabaseManager.js';
import { JobQueue } from '../database/JobQueue.js';
import { DeleteManager } from '../delete/DeleteManager.js';
import { AccessPatternTracker } from './AccessPatternTracker.js';
import { StalenessScorer } from './StalenessScorer.js';
import { CleanupPolicyEngine } from './CleanupPolicyEngine.js';
import { CleanupScheduler } from './CleanupScheduler.js';
import { SystemHealthMonitor } from './SystemHealthMonitor.js';
import {
  CleanupJob,
  CleanupResults,
  AutomationStatus,
  AutomationConfig,
  CleanupPolicy,
  EmailIndex,
  JobStatus
} from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * CleanupAutomationEngine orchestrates automated email cleanup operations.
 * It integrates with all Phase 1 components and provides background automation,
 * event-driven triggers, and scheduled cleanup with comprehensive monitoring.
 */
export class CleanupAutomationEngine {
  private databaseManager: DatabaseManager;
  private jobQueue: JobQueue;
  private deleteManager: DeleteManager;
  private accessTracker: AccessPatternTracker;
  private stalenessScorer: StalenessScorer;
  private policyEngine: CleanupPolicyEngine;
  private scheduler: CleanupScheduler;
  private healthMonitor: SystemHealthMonitor;
  
  private static instance: CleanupAutomationEngine | null = null;
  private isRunning: boolean = false;
  private continuousCleanupActive: boolean = false;
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private monitoringIntervalId: NodeJS.Timeout | null = null;
  
  // Configuration
  private config: AutomationConfig = {
    continuous_cleanup: {
      enabled: false,
      target_emails_per_minute: 10,
      max_concurrent_operations: 3,
      pause_during_peak_hours: true,
      peak_hours: { start: '09:00', end: '17:00' }
    },
    event_triggers: {
      storage_threshold: {
        enabled: true,
        warning_threshold_percent: 80,
        critical_threshold_percent: 95,
        emergency_policies: []
      },
      performance_threshold: {
        enabled: true,
        query_time_threshold_ms: 1000,
        cache_hit_rate_threshold: 0.7
      },
      email_volume_threshold: {
        enabled: true,
        daily_email_threshold: 1000,
        immediate_cleanup_policies: []
      }
    }
  };

  constructor(
    databaseManager?: DatabaseManager,
    jobQueue?: JobQueue,
    deleteManager?: DeleteManager,
    accessTracker?: AccessPatternTracker,
    stalenessScorer?: StalenessScorer,
    policyEngine?: CleanupPolicyEngine
  ) {
    console.error(`CONSTRUCTOR: CleanupAutomationEngine constructor called`);
    this.databaseManager = databaseManager || DatabaseManager.getInstance();
    this.jobQueue = jobQueue || new JobQueue();
    this.accessTracker = accessTracker || AccessPatternTracker.getInstance();
    this.stalenessScorer = stalenessScorer || new StalenessScorer(this.accessTracker);
    this.policyEngine = policyEngine || CleanupPolicyEngine.getInstance();
    
    // Note: deleteManager will be injected later when available
    this.deleteManager = deleteManager!;
    
    this.scheduler = new CleanupScheduler(this);
    this.healthMonitor = new SystemHealthMonitor(this.databaseManager);
    
    this.setupJobHandlers();
  }

  set dbManager(databaseManager: DatabaseManager) {
    this.databaseManager = databaseManager;
  }

  get dbManager(): DatabaseManager {
    return this.databaseManager;
  }

  set hMonitor(healthMonitor: SystemHealthMonitor) {
    this.healthMonitor = healthMonitor;
  }
  get hMonitor() {
    return this.healthMonitor;
  }

  static getInstance(
    databaseManager?: DatabaseManager,
    jobQueue?: JobQueue,
    deleteManager?: DeleteManager,
    accessTracker?: AccessPatternTracker,
    stalenessScorer?: StalenessScorer,
    policyEngine?: CleanupPolicyEngine
  ): CleanupAutomationEngine {
    if (!this.instance) {
      this.instance = new CleanupAutomationEngine(
        databaseManager, jobQueue, deleteManager, accessTracker, stalenessScorer, policyEngine
      );
    }
    return this.instance;
  }

  /**
   * Initialize and start the automation engine
   */
  async initialize(): Promise<void> {
    try {
      if (this.isRunning) {
        logger.warn('CleanupAutomationEngine already running');
        return;
      }

      // Initialize all components
      await this.scheduler.initialize();
      await this.healthMonitor.initialize();
      
      // Load configuration from database
      await this.loadConfiguration();
      
      // Start background services
      await this.startBackgroundServices();
      
      this.isRunning = true;
      
      logger.info('CleanupAutomationEngine initialized and started', {
        continuous_cleanup_enabled: this.config.continuous_cleanup.enabled,
        event_triggers_enabled: Object.values(this.config.event_triggers).some(t => t.enabled)
      });
    } catch (error) {
      logger.error('Failed to initialize CleanupAutomationEngine:', error);
      throw error;
    }
  }

  /**
   * Shutdown the automation engine
   */
  async shutdown(): Promise<void> {
    try {
      this.isRunning = false;
      this.continuousCleanupActive = false;
      
      // Stop background services
      if (this.cleanupIntervalId) {
        clearInterval(this.cleanupIntervalId);
        this.cleanupIntervalId = null;
      }
      
      if (this.monitoringIntervalId) {
        clearInterval(this.monitoringIntervalId);
        this.monitoringIntervalId = null;
      }
      
      // Shutdown components
      await this.scheduler.shutdown();
      await this.healthMonitor.shutdown();
      
      logger.info('CleanupAutomationEngine shutdown completed');
    } catch (error) {
      logger.error('Error during CleanupAutomationEngine shutdown:', error);
      throw error;
    }
  }

  /**
   * Set the DeleteManager (for dependency injection)
   */
  setDeleteManager(deleteManager: DeleteManager): void {
    this.deleteManager = deleteManager;
  }

  /**
   * Trigger manual cleanup with specified policy
   */
  async triggerManualCleanup(policyId: string, options: {
    dry_run?: boolean;
    max_emails?: number;
    force?: boolean;
  } = {}): Promise<string> {
    try {
      
      const policy = await this.policyEngine.getPolicy(policyId);
      logger.debug('Policy lookup result', {
        policyId,
        found: !!policy,
        policy_name: policy?.name
      });
      
      if (!policy) {
        // Let's also list all available policies for debugging
        const allPolicies = await this.policyEngine.getAllPolicies();
        logger.error(`Policy not found: ${policyId}`, {
          available_policies: allPolicies.map(p => ({ id: p.id, name: p.name }))
        });
        throw new Error(`Policy not found: ${policyId}`);
      }

      if (!policy.enabled && !options.force) {
        throw new Error(`Policy is disabled: ${policyId}`);
      }

      const jobId = `cleanup_manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const cleanupJob: CleanupJob = {
        job_id: jobId,
        job_type: 'scheduled_cleanup',
        status: JobStatus.PENDING,
        request_params: {
          policy_id: policyId,
          triggered_by: 'user_request',
          dry_run: options.dry_run || false,
          max_emails: options.max_emails
        },
        cleanup_metadata: {
          policy_id: policyId,
          triggered_by: 'user_request',
          priority: 'normal',
          batch_size: Math.min(options.max_emails || policy.safety.max_emails_per_run, 100),
          target_emails: options.max_emails || policy.safety.max_emails_per_run
        },
        progress_details: {
          emails_analyzed: 0,
          emails_cleaned: 0,
          storage_freed: 0,
          errors_encountered: 0,
          current_batch: 0,
          total_batches: 0
        },
        created_at: new Date()
      };

      // **FIX**: Use proper transaction management for database operations
      try {
        // Add job to queue first
        await this.jobQueue.addJob(jobId);
        
        // Insert job to database with verification
        await this.databaseManager.insertCleanupJob(cleanupJob);
        
        // **FIX**: Verify the job was actually inserted
        const insertedJob = await this.databaseManager.getCleanupJob(jobId);
        if (!insertedJob) {
          throw new Error(`Job insertion failed - job not found after insert: ${jobId}`);
        }
        
        logger.info('Manual cleanup triggered', {
          job_id: jobId,
          policy_id: policyId,
          dry_run: options.dry_run,
          max_emails: options.max_emails
        });

        return jobId;
      } catch (error) {
        logger.error('Failed to create cleanup job', {
          jobId,
          policyId,
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    } catch (error) {
      logger.error('Failed to trigger manual cleanup:', error);
      throw error;
    }
  }

  /**
   * Get current automation status
   */
  async getAutomationStatus(): Promise<AutomationStatus> {
    try {
      const activePolicies = await this.policyEngine.getActivePolicies();
      const systemHealth = await this.healthMonitor.getCurrentHealth();
      
      const lastCleanupJob = await this.databaseManager.listCleanupJobs({
        limit: 1
      });

      return {
        continuous_cleanup_running: this.continuousCleanupActive,
        scheduled_jobs_count: await this.scheduler.getActiveScheduleCount(),
        active_policies_count: activePolicies.length,
        last_cleanup_time: lastCleanupJob.length > 0 ? lastCleanupJob[0].completed_at : undefined,
        next_scheduled_cleanup: await this.scheduler.getNextScheduledTime(),
        system_health: systemHealth
      };
    } catch (error) {
      logger.error('Failed to get automation status:', error);
      throw error;
    }
  }

  /**
   * Update automation configuration
   */
  async updateConfiguration(updates: Partial<AutomationConfig>): Promise<void> {
    try {
      // Merge with existing configuration
      this.config = {
        ...this.config,
        ...updates,
        continuous_cleanup: {
          ...this.config.continuous_cleanup,
          ...updates.continuous_cleanup
        },
        event_triggers: {
          ...this.config.event_triggers,
          ...updates.event_triggers
        }
      };

      // Save to database
      await this.saveConfiguration();
      
      // Restart services if needed
      if (this.isRunning) {
        await this.restartBackgroundServices();
      }

      logger.info('Automation configuration updated', { config: this.config });
    } catch (error) {
      logger.error('Failed to update automation configuration:', error);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  getConfiguration(): AutomationConfig {
    return { ...this.config };
  }

  /**
   * Process a cleanup job
   */
  async processCleanupJob(jobId: string): Promise<CleanupResults> {
    try {
      logger.info('processCleanupJob starting', { jobId });
      
      const job = await this.databaseManager.getCleanupJob(jobId);
      logger.info('Job retrieved from database', {
        found: !!job,
        jobId: job?.job_id,
        policy_id: job?.cleanup_metadata?.policy_id,
        job_type: job?.job_type
      });
      
      if (!job) {
        throw new Error(`Job not found: ${jobId}`);
      }

      // Update job status
      await this.databaseManager.updateCleanupJob(jobId, {
        status: JobStatus.IN_PROGRESS,
        started_at: new Date()
      });

      logger.info('Processing cleanup job', { job_id: jobId, policy_id: job.cleanup_metadata?.policy_id });

      let results: CleanupResults;

      try {
        if (job.cleanup_metadata?.policy_id) {
          results = await this.executeCleanupWithPolicy(job);
        } else {
          results = await this.executeContinuousCleanup(job);
        }
        
        logger.info('Cleanup execution completed', {
          emails_processed: results.emails_processed,
          emails_deleted: results.emails_deleted,
          success: results.success
        });

        // Update job with results
        await this.databaseManager.updateCleanupJob(jobId, {
          status: JobStatus.COMPLETED,
          completed_at: new Date(),
          results: results,
          progress: 100
        });

        // Record execution in history
        await this.databaseManager.recordCleanupExecution({
          policy_id: job.cleanup_metadata?.policy_id,
          started_at: results.started_at,
          completed_at: results.completed_at,
          emails_processed: results.emails_processed,
          emails_deleted: results.emails_deleted,
          emails_archived: results.emails_archived,
          storage_freed: results.storage_freed,
          errors: results.errors,
          success: results.success
        });

        logger.info('Cleanup job completed', {
          job_id: jobId,
          emails_processed: results.emails_processed,
          emails_cleaned: results.emails_deleted + results.emails_archived,
          storage_freed: results.storage_freed,
          success: results.success
        });

        return results;
      } catch (error) {
        // Update job with error
        await this.databaseManager.updateCleanupJob(jobId, {
          status: JobStatus.FAILED,
          completed_at: new Date(),
          error_details: error instanceof Error ? error.message : String(error)
        });

        throw error;
      }
    } catch (error) {
      logger.error('Failed to process cleanup job:', error);
      throw error;
    }
  }

  /**
   * Execute cleanup with a specific policy
   */
  private async executeCleanupWithPolicy(job: CleanupJob): Promise<CleanupResults> {
    const startTime = new Date();
    const policyId = job.cleanup_metadata!.policy_id!;
    
    const policy = await this.policyEngine.getPolicy(policyId);
    
    if (!policy) {
      logger.error('🔍 DIAGNOSTIC: Policy not found', { policyId });
      throw new Error(`Policy not found: ${policyId}`);
    }

    // Get emails eligible for cleanup
    const maxEmails = job.cleanup_metadata!.target_emails;
    
    const eligibleEmails = await this.databaseManager.getEmailsForCleanup(policy, maxEmails);
    
    if (eligibleEmails.length === 0) {
      logger.warn('🔍 DIAGNOSTIC: No eligible emails found, returning early', {
        policyId,
        policy_criteria: policy.criteria
      });
      return {
        execution_id: `exec_${job.job_id}`,
        policy_id: policyId,
        started_at: startTime,
        completed_at: new Date(),
        emails_processed: 0,
        emails_deleted: 0,
        emails_archived: 0,
        storage_freed: 0,
        errors: [],
        success: true
      };
    }
    
    // Evaluate emails against policy
    
    const evaluation = await this.policyEngine.evaluateEmailsForCleanup(eligibleEmails);
    
    let emailsProcessed = 0;
    let emailsDeleted = 0;
    let emailsArchived = 0;
    let storageFreed = 0;
    const errors: string[] = [];

    if (job.request_params.dry_run) {
      // Dry run - just return what would be processed
      emailsProcessed = evaluation.cleanup_candidates.length;
      for (const candidate of evaluation.cleanup_candidates) {
        if (candidate.recommended_action === 'delete') {
          emailsDeleted++;
        } else {
          emailsArchived++;
        }
        storageFreed += candidate.email.size || 0;
      }
    } else {
      // Process candidates in batches
      const batchSize = job.cleanup_metadata!.batch_size;
      const candidates = evaluation.cleanup_candidates;
      const totalBatches = Math.ceil(candidates.length / batchSize);

      for (let i = 0; i < candidates.length; i += batchSize) {
        const batch = candidates.slice(i, i + batchSize);
        const currentBatch = Math.floor(i / batchSize) + 1;

        try {
          // Update progress
          await this.databaseManager.updateCleanupJob(job.job_id, {
            progress: Math.floor((i / candidates.length) * 100),
            progress_details: {
              ...job.progress_details,
              current_batch: currentBatch,
              total_batches: totalBatches,
              emails_analyzed: i + batch.length
            }
          });

          // Process batch
          const batchResults = await this.processBatch(batch);
          
          emailsProcessed += batch.length;
          emailsDeleted += batchResults.deleted;
          emailsArchived += batchResults.archived;
          storageFreed += batchResults.storage_freed;
          errors.push(...batchResults.errors);

          // Small delay between batches to avoid overwhelming the system
          if (i + batchSize < candidates.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          const errorMsg = `Batch ${currentBatch} failed: ${error}`;
          errors.push(errorMsg);
          logger.error(errorMsg);
        }
      }
    }

    return {
      execution_id: `exec_${job.job_id}`,
      policy_id: policyId,
      started_at: startTime,
      completed_at: new Date(),
      emails_processed: emailsProcessed,
      emails_deleted: emailsDeleted,
      emails_archived: emailsArchived,
      storage_freed: storageFreed,
      errors,
      success: errors.length === 0
    };
  }

  /**
   * Execute continuous cleanup
   */
  private async executeContinuousCleanup(job: CleanupJob): Promise<CleanupResults> {
    const startTime = new Date();
    const policies = await this.policyEngine.getActivePolicies();
    
    let totalProcessed = 0;
    let totalDeleted = 0;
    let totalArchived = 0;
    let totalStorageFreed = 0;
    const allErrors: string[] = [];

    // Process each active policy
    for (const policy of policies) {
      try {
        const policyJob: CleanupJob = {
          ...job,
          cleanup_metadata: {
            ...job.cleanup_metadata!,
            policy_id: policy.id,
            target_emails: Math.min(
              policy.safety.max_emails_per_run,
              this.config.continuous_cleanup.target_emails_per_minute
            )
          }
        };

        const policyResults = await this.executeCleanupWithPolicy(policyJob);
        
        totalProcessed += policyResults.emails_processed;
        totalDeleted += policyResults.emails_deleted;
        totalArchived += policyResults.emails_archived;
        totalStorageFreed += policyResults.storage_freed;
        allErrors.push(...policyResults.errors);
      } catch (error) {
        const errorMsg = `Policy ${policy.id} failed: ${error}`;
        allErrors.push(errorMsg);
        logger.error(errorMsg);
      }
    }

    return {
      execution_id: `exec_${job.job_id}`,
      started_at: startTime,
      completed_at: new Date(),
      emails_processed: totalProcessed,
      emails_deleted: totalDeleted,
      emails_archived: totalArchived,
      storage_freed: totalStorageFreed,
      errors: allErrors,
      success: allErrors.length === 0
    };
  }

  /**
   * Process a batch of cleanup candidates
   */
  private async processBatch(candidates: Array<{
    email: EmailIndex;
    policy: CleanupPolicy;
    recommended_action: 'archive' | 'delete';
  }>): Promise<{
    deleted: number;
    archived: number;
    storage_freed: number;
    errors: string[];
  }> {
    const deleteEmails: EmailIndex[] = [];
    const archiveEmails: EmailIndex[] = [];

    // Separate by action type
    for (const candidate of candidates) {
      if (candidate.recommended_action === 'delete') {
        deleteEmails.push(candidate.email);
      } else {
        archiveEmails.push(candidate.email);
      }
    }

    let deleted = 0;
    let archived = 0;
    let storageFreed = 0;
    const errors: string[] = [];

    // Process deletions
    if (deleteEmails.length > 0) {
      try {
        const deleteResult = await this.deleteManager.deleteEmails({
          searchCriteria: {
            ids: deleteEmails.map(email => email.id),
          },
          dryRun: false,
          skipArchived: true,
        });
        
        deleted = deleteResult.deleted;
        storageFreed += deleteEmails.reduce((sum, email) => sum + (email.size || 0), 0);
        errors.push(...deleteResult.errors);
      } catch (error) {
        errors.push(`Delete operation failed: ${error}`);
      }
    }

    // Process archiving
    if (archiveEmails.length > 0) {
      try {
        // Mark emails as archived in database
        const archiveIds = archiveEmails.map(email => email.id);
        await this.databaseManager.markEmailsAsDeleted(archiveIds);
        
        archived = archiveEmails.length;
        storageFreed += archiveEmails.reduce((sum, email) => sum + (email.size || 0), 0);
      } catch (error) {
        errors.push(`Archive operation failed: ${error}`);
      }
    }

    return { deleted, archived, storage_freed: storageFreed, errors };
  }

  /**
   * Setup job queue handlers
   */
  private setupJobHandlers(): void {
    this.jobQueue.registerJobHandler('cleanup', async (jobId: string) => {
      await this.processCleanupJob(jobId);
    });

    this.jobQueue.registerJobHandler('continuous_cleanup', async (jobId: string) => {
      await this.processCleanupJob(jobId);
    });

    this.jobQueue.registerJobHandler('scheduled_cleanup', async (jobId: string) => {
      await this.processCleanupJob(jobId);
    });

    this.jobQueue.registerJobHandler('event_cleanup', async (jobId: string) => {
      await this.processCleanupJob(jobId);
    });
  }

  /**
   * Start background services
   */
  private async startBackgroundServices(): Promise<void> {
    // Start continuous cleanup if enabled
    if (this.config.continuous_cleanup.enabled) {
      await this.startContinuousCleanup();
    }

    // Start monitoring
    await this.startMonitoring();

    // Start scheduler
    await this.scheduler.start();
  }

  /**
   * Restart background services
   */
  private async restartBackgroundServices(): Promise<void> {
    // Stop current services
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    if (this.monitoringIntervalId) {
      clearInterval(this.monitoringIntervalId);
      this.monitoringIntervalId = null;
    }

    // Restart services
    await this.startBackgroundServices();
  }

  /**
   * Start continuous cleanup
   */
  private async startContinuousCleanup(): Promise<void> {
    if (this.continuousCleanupActive) return;

    this.continuousCleanupActive = true;
    const intervalMs = Math.floor(60000 / this.config.continuous_cleanup.target_emails_per_minute);

    this.cleanupIntervalId = setInterval(async () => {
      try {
        // Check if we should pause during peak hours
        if (this.config.continuous_cleanup.pause_during_peak_hours && this.isDuringPeakHours()) {
          return;
        }

        // Check current queue load
        const queueLength = this.jobQueue.getQueueLength();
        if (queueLength >= this.config.continuous_cleanup.max_concurrent_operations) {
          return;
        }

        // Trigger continuous cleanup job
        await this.triggerContinuousCleanupJob();
      } catch (error) {
        logger.error('Continuous cleanup iteration failed:', error);
      }
    }, intervalMs);

    logger.info('Continuous cleanup started', {
      interval_ms: intervalMs,
      target_emails_per_minute: this.config.continuous_cleanup.target_emails_per_minute
    });
  }

  /**
   * Start monitoring
   */
  private async startMonitoring(): Promise<void> {
    // Monitor every 5 minutes
    this.monitoringIntervalId = setInterval(async () => {
      try {
        await this.checkEventTriggers();
      } catch (error) {
        logger.error('Monitoring check failed:', error);
      }
    }, 5 * 60 * 1000);

    logger.info('Monitoring started');
  }

  /**
   * Check if current time is during peak hours
   */
  private isDuringPeakHours(): boolean {
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    const peakStart = this.config.continuous_cleanup.peak_hours.start;
    const peakEnd = this.config.continuous_cleanup.peak_hours.end;
    
    return currentTime >= peakStart && currentTime <= peakEnd;
  }

  /**
   * Trigger a continuous cleanup job
   */
  private async triggerContinuousCleanupJob(): Promise<void> {
    const jobId = `cleanup_continuous_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const cleanupJob: CleanupJob = {
      job_id: jobId,
      job_type: 'continuous_cleanup',
      status: JobStatus.PENDING,
      request_params: {
        triggered_by: 'continuous',
        target_emails: this.config.continuous_cleanup.target_emails_per_minute
      },
      cleanup_metadata: {
        triggered_by: 'continuous',
        priority: 'low',
        batch_size: Math.min(this.config.continuous_cleanup.target_emails_per_minute, 50),
        target_emails: this.config.continuous_cleanup.target_emails_per_minute
      },
      progress_details: {
        emails_analyzed: 0,
        emails_cleaned: 0,
        storage_freed: 0,
        errors_encountered: 0,
        current_batch: 0,
        total_batches: 0
      },
      created_at: new Date()
    };

    await this.jobQueue.addJob(jobId);
    await this.databaseManager.insertCleanupJob(cleanupJob);
  }

  /**
   * Check event triggers
   */
  private async checkEventTriggers(): Promise<void> {
    const health = await this.healthMonitor.getCurrentHealth();

    // Check storage threshold
    if (this.config.event_triggers.storage_threshold.enabled) {
      const storagePercent = health.storage_usage_percent;
      const warningThreshold = this.config.event_triggers.storage_threshold.warning_threshold_percent;
      const criticalThreshold = this.config.event_triggers.storage_threshold.critical_threshold_percent;

      if (storagePercent >= criticalThreshold) {
        await this.triggerEmergencyCleanup('storage_critical');
      } else if (storagePercent >= warningThreshold) {
        await this.triggerEventCleanup('storage_warning');
      }
    }

    // Check performance threshold
    if (this.config.event_triggers.performance_threshold.enabled) {
      const queryTime = health.average_query_time_ms;
      const cacheHitRate = health.cache_hit_rate;

      if (queryTime > this.config.event_triggers.performance_threshold.query_time_threshold_ms ||
          cacheHitRate < this.config.event_triggers.performance_threshold.cache_hit_rate_threshold) {
        await this.triggerEventCleanup('performance_degradation');
      }
    }
  }

  /**
   * Trigger event-based cleanup
   */
  private async triggerEventCleanup(trigger: string): Promise<void> {
    const jobId = `cleanup_event_${trigger}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const cleanupJob: CleanupJob = {
      job_id: jobId,
      job_type: 'event_cleanup',
      status: JobStatus.PENDING,
      request_params: {
        triggered_by: trigger,
        priority: 'high'
      },
      cleanup_metadata: {
        triggered_by: trigger as any,
        priority: 'high',
        batch_size: 100,
        target_emails: 500
      },
      progress_details: {
        emails_analyzed: 0,
        emails_cleaned: 0,
        storage_freed: 0,
        errors_encountered: 0,
        current_batch: 0,
        total_batches: 0
      },
      created_at: new Date()
    };

    await this.jobQueue.addJob(jobId);
    await this.databaseManager.insertCleanupJob(cleanupJob);

    logger.warn('Event-triggered cleanup initiated', { trigger, job_id: jobId });
  }

  /**
   * Trigger emergency cleanup
   */
  private async triggerEmergencyCleanup(trigger: string): Promise<void> {
    const emergencyPolicies = this.config.event_triggers.storage_threshold.emergency_policies;
    
    for (const policyId of emergencyPolicies) {
      try {
        await this.triggerManualCleanup(policyId, {
          max_emails: 1000,
          force: true
        });
      } catch (error) {
        logger.error(`Emergency cleanup failed for policy ${policyId}:`, error);
      }
    }

    logger.error('Emergency cleanup triggered', { trigger, policies: emergencyPolicies });
  }

  /**
   * Load configuration from database
   */
  private async loadConfiguration(): Promise<void> {
    try {
      // Load from cleanup_automation_config table
      // This is a placeholder - would implement actual loading logic
      logger.debug('Loading automation configuration from database');
    } catch (error) {
      logger.warn('Failed to load configuration from database, using defaults:', error);
    }
  }

  /**
   * Save configuration to database
   */
  private async saveConfiguration(): Promise<void> {
    try {
      // Save to cleanup_automation_config table
      // This is a placeholder - would implement actual saving logic
      logger.debug('Saving automation configuration to database');
    } catch (error) {
      logger.error('Failed to save configuration to database:', error);
      throw error;
    }
  }
}