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

  static getInstance(): JobStatusStore {
    if (!this.instance) {
      // Ensure DatabaseManager singleton exists first
      DatabaseManager.validateSingletonIntegrity();
      this.instance = new JobStatusStore();
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
    DatabaseManager.validateSingletonIntegrity();
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

  async createJob(job_type: string, request_params: any): Promise<string> {
    this.validateDatabaseInitialization();
    
    const job_id = `J${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    try {
      await this.dbManager.insertJob({
        job_id,
        job_type,
        status: JobStatus.PENDING,
        request_params,
        created_at: new Date()
      });
      
      logger.debug(`Created new job: ${job_id} of type: ${job_type} (JobStatusStore ID: ${this.getInstanceId()})`);
      return job_id;
    } catch (error) {
      logger.error(`Failed to create job: ${error}`);
      throw error;
    }
  }

  async getJobStatus(job_id: string): Promise<Job | null> {
    this.validateDatabaseInitialization();
    
    try {
      logger.debug(`Getting job status for ${job_id} (JobStatusStore ID: ${this.getInstanceId()}, DatabaseManager ID: ${this.dbManager.getInstanceId()})`);
      const job = await this.dbManager.getJob(job_id);
      return job;
    } catch (error) {
      logger.error(`Failed to get job status for ${job_id}: ${error}`);
      throw error;
    }
  }

  async cancelJob(job_id: string): Promise<void> {
    this.validateDatabaseInitialization();

    try {
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

  async listJobs(filters: {
    job_type?: string;
    status?: JobStatus;
    limit?: number;
    offset?: number;
  } = {}): Promise<Job[]> {
    this.validateDatabaseInitialization();
    
    try {
      return await this.dbManager.listJobs(filters);
    } catch (error) {
      logger.error(`Failed to list jobs: ${error}`);
      throw error;
    }
  }

  async deleteJob(job_id: string): Promise<void> {
    this.validateDatabaseInitialization();
    
    try {
      await this.dbManager.deleteJob(job_id);
      logger.debug(`Deleted job ${job_id} (JobStatusStore ID: ${this.getInstanceId()})`);
    } catch (error) {
      logger.error(`Failed to delete job ${job_id}: ${error}`);
      throw error;
    }
  }

  async cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
    this.validateDatabaseInitialization();
    
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      const deletedCount = await this.dbManager.deleteJobsOlderThan(cutoffDate);
      logger.debug(`Cleaned up ${deletedCount} jobs older than ${olderThanDays} days (JobStatusStore ID: ${this.getInstanceId()})`);
      
      return deletedCount;
    } catch (error) {
      logger.error(`Failed to clean up old jobs: ${error}`);
      throw error;
    }
  }
}