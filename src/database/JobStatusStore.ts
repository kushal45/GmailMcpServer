import { DatabaseManager } from './DatabaseManager.js';
import { logger } from '../utils/logger.js';
import { Job, JobStatus } from "../types/index.js";


export class JobStatusStore {
  private dbManager: DatabaseManager;
  private static instance: JobStatusStore | null = null;
  private static instanceId: string = Math.random().toString(36).substr(2, 9);

  constructor(dbManager?: DatabaseManager) {
    // Prevent direct instantiation outside of getInstance()
    if (JobStatusStore.instance && JobStatusStore.instance !== this) {
      const error = `JobStatusStore: Attempted to create multiple instances. Use getInstance() instead. Current instance ID: ${JobStatusStore.instanceId}`;
      logger.error(error);
      throw new Error(error);
    }

    // Always use the DatabaseManager singleton
    this.dbManager = dbManager || DatabaseManager.getInstance();
    
    // Validate that we're using the same DatabaseManager instance
    const dbInstanceId = this.dbManager.getInstanceId();
    logger.debug(`JobStatusStore initialized with DatabaseManager instance ID: ${dbInstanceId}`, {
      jobStatusStoreInstanceId: JobStatusStore.instanceId,
      databaseManagerInstanceId: dbInstanceId,
      timestamp: new Date().toISOString()
    });
  }

  static getInstance(dbManager?: DatabaseManager): JobStatusStore {
    if (!this.instance) {
      // If a dbManager is provided, use it for the singleton (for test isolation)
      this.instance = new JobStatusStore(dbManager);
      logger.debug(`JobStatusStore singleton created with ID: ${this.instanceId}`, {
        timestamp: new Date().toISOString(),
        instanceId: this.instanceId
      });
    }
    return this.instance;
  }

  static validateSingletonIntegrity(): void {
    if (!this.instance) {
      throw new Error('JobStatusStore: No singleton instance exists. Call getInstance() first.');
    }
    // Also validate the underlying DatabaseManager
    if (!DatabaseManager.getInstance()) {
      throw new Error('DatabaseManager: No singleton instance exists. Call getInstance() first.');
    }
    logger.debug(`JobStatusStore singleton validation passed. Instance ID: ${this.instanceId}`);
  }

  getInstanceId(): string {
    return JobStatusStore.instanceId;
  }
  async initialize(): Promise<void> {
    this.validateDatabaseInitialization();
    await this.dbManager.createJobStatusTable();
  }

  private validateDatabaseInitialization(): void {
    if (!this.dbManager.isInitialized()) {
      const error = `JobStatusStore: Database not initialized. Cannot perform operations. JobStatusStore ID: ${this.getInstanceId()}, DatabaseManager ID: ${this.dbManager.getInstanceId()}`;
      logger.error(error);
      throw new Error(error);
    }
  }

  /**
   * Create a new job with user context for multi-user support
   * @param job_type Type of job to create
   * @param request_params Parameters for the job
   * @param user_id Optional user ID to associate with the job
   * @returns Job ID of the created job
   */
  async createJob(job_type: string, request_params: any, user_id?: string): Promise<string> {
    this.validateDatabaseInitialization();
    
    const job_id = `J${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    try {
      await this.dbManager.insertJob({
        job_id,
        job_type,
        status: JobStatus.PENDING,
        request_params,
        created_at: new Date(),
        user_id // Include user_id in the job data
      });
      
      logger.debug(`Created new job: ${job_id} of type: ${job_type} for user: ${user_id || 'system'} (JobStatusStore ID: ${this.getInstanceId()})`);
      return job_id;
    } catch (error) {
      logger.error(`Failed to create job: ${error}`);
      throw error;
    }
  }

  /**
   * Get job status with user isolation
   * @param job_id Job ID to retrieve
   * @param user_id Optional user ID for permission check
   * @returns Job data or null if not found
   */
  async getJobStatus(job_id: string, user_id?: string): Promise<Job | null> {
    this.validateDatabaseInitialization();
    
    try {
      logger.debug(`Getting job status for ${job_id} (JobStatusStore ID: ${this.getInstanceId()}, DatabaseManager ID: ${this.dbManager.getInstanceId()})`);
      const job = await this.dbManager.getJob(job_id);
      
      // For multi-user support: check if job belongs to the requesting user
      if (job && user_id && job.user_id && job.user_id !== user_id) {
        logger.warn(`User ${user_id} attempted to access job ${job_id} belonging to user ${job.user_id}`);
        return null; // Don't expose jobs belonging to other users
      }
      
      return job;
    } catch (error) {
      logger.error(`Failed to get job status for ${job_id}: ${error}`);
      throw error;
    }
  }

  /**
   * Cancel a job with user permission check
   * @param job_id Job ID to cancel
   * @param user_id Optional user ID for permission check
   */
  async cancelJob(job_id: string, user_id?: string): Promise<void> {
    this.validateDatabaseInitialization();

    try {
      // Check if the job belongs to the user if user_id is provided
      if (user_id) {
        const job = await this.dbManager.getJob(job_id);
        if (job && job.user_id && job.user_id !== user_id) {
          throw new Error(`User ${user_id} does not have permission to cancel job ${job_id}`);
        }
      }
      
      await this.dbManager.updateJob(job_id, {
        status: JobStatus.CANCELLED
      });

      logger.debug(`Cancelled job: ${job_id} (JobStatusStore ID: ${this.getInstanceId()})`);
    } catch (error) {
      logger.error(`Failed to cancel job ${job_id}: ${error}`);
      throw error;
    }
  }

  async updateJobStatus(
    job_id: string,
    status: JobStatus,
    updates: {
      progress?: number;
      results?: any;
      error_details?: string;
      started_at?: Date;
      completed_at?: Date;
    } = {}
  ): Promise<void> {
    this.validateDatabaseInitialization();
    
    try {
      await this.dbManager.updateJob(job_id, {
        status,
        ...updates
      });
      
      logger.debug(`Updated job ${job_id} status to ${status} (JobStatusStore ID: ${this.getInstanceId()})`);
    } catch (error) {
      logger.error(`Failed to update job status for ${job_id}: ${error}`);
      throw error;
    }
  }

  /**
   * List jobs with user isolation
   * @param filters Filters to apply to the job list
   * @param user_id Optional user ID to filter jobs by owner
   * @returns List of jobs matching the filters
   */
  async listJobs(filters: {
    job_type?: string;
    status?: JobStatus;
    limit?: number;
    offset?: number;
    user_id?: string; // Added user_id to filters
  } = {}): Promise<Job[]> {
    this.validateDatabaseInitialization();
    
    try {
      return await this.dbManager.listJobs(filters);
    } catch (error) {
      logger.error(`Failed to list jobs: ${error}`);
      throw error;
    }
  }

  /**
   * Delete a job with user permission check
   * @param job_id Job ID to delete
   * @param user_id Optional user ID for permission check
   */
  async deleteJob(job_id: string, user_id?: string): Promise<void> {
    this.validateDatabaseInitialization();
    
    try {
      // Check if the job belongs to the user if user_id is provided
      if (user_id) {
        const job = await this.dbManager.getJob(job_id);
        if (job && job.user_id && job.user_id !== user_id) {
          throw new Error(`User ${user_id} does not have permission to delete job ${job_id}`);
        }
      }
      
      await this.dbManager.deleteJob(job_id);
      logger.debug(`Deleted job ${job_id} (JobStatusStore ID: ${this.getInstanceId()})`);
    } catch (error) {
      logger.error(`Failed to delete job ${job_id}: ${error}`);
      throw error;
    }
  }

  /**
   * Clean up old jobs with user isolation option
   * @param olderThanDays Number of days after which jobs should be cleaned up
   * @param user_id Optional user ID to clean up jobs for a specific user only
   * @returns Number of deleted jobs
   */
  async cleanupOldJobs(olderThanDays: number = 30, user_id?: string): Promise<number> {
    this.validateDatabaseInitialization();
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      let deletedCount = 0;
      
      if (user_id) {
        // If user_id is provided, use a custom query to find and delete jobs for that user
        // First, get all job IDs that match our criteria
        const timestamp = Math.floor(cutoffDate.getTime() / 1000);
        const sql = "SELECT job_id FROM job_statuses WHERE created_at < ? AND user_id = ?";
        
        // Use DatabaseManager's query method to get the jobs
        const jobs = await this.dbManager.queryAll<{job_id: string}>(sql, [timestamp, user_id]);
        
        // Delete each job individually
        for (const job of jobs) {
          await this.dbManager.deleteJob(job.job_id);
          deletedCount++;
        }
      } else {
        // For backward compatibility, if no user_id is specified, use the existing method
        deletedCount = await this.dbManager.deleteJobsOlderThan(cutoffDate);
      }
      
      logger.debug(`Cleaned up ${deletedCount} jobs older than ${olderThanDays} days${user_id ? ` for user ${user_id}` : ''} (JobStatusStore ID: ${this.getInstanceId()})`);
      
      return deletedCount;
    } catch (error) {
      logger.error(`Failed to clean up old jobs: ${error}`);
      throw error;
    }
  }

  static resetInstance(): void {
    this.instance = null;
    this.instanceId = Math.random().toString(36).substr(2, 9);
  }
}