import { DatabaseManager } from './DatabaseManager.js';
import { logger } from '../utils/logger.js';

export enum JobStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
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
}

export class JobStatusStore {
  private dbManager: DatabaseManager;
  private static instance: JobStatusStore | null = null;

  constructor(dbManager: DatabaseManager) {
    this.dbManager = dbManager;
  }

  static getInstance(): JobStatusStore {
    if (!this.instance) {
      this.instance = new JobStatusStore(DatabaseManager.getInstance());
    }
    return this.instance;
  }
  async initialize(): Promise<void> {
    await this.dbManager.createJobStatusTable();
  }

  async createJob(job_type: string, request_params: any): Promise<string> {
    const job_id = `J${Date.now()}${Math.floor(Math.random() * 1000)}`;
    
    try {
      await this.dbManager.insertJob({
        job_id,
        job_type,
        status: JobStatus.PENDING,
        request_params,
        created_at: new Date()
      });
      
      logger.info(`Created new job: ${job_id} of type: ${job_type}`);
      return job_id;
    } catch (error) {
      logger.error(`Failed to create job: ${error}`);
      throw error;
    }
  }

  async getJobStatus(job_id: string): Promise<Job | null> {
    try {
      const job = await this.dbManager.getJob(job_id);
      return job;
    } catch (error) {
      logger.error(`Failed to get job status for ${job_id}: ${error}`);
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
    try {
      await this.dbManager.updateJob(job_id, {
        status,
        ...updates
      });
      
      logger.info(`Updated job ${job_id} status to ${status}`);
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
    try {
      return await this.dbManager.listJobs(filters);
    } catch (error) {
      logger.error(`Failed to list jobs: ${error}`);
      throw error;
    }
  }

  async deleteJob(job_id: string): Promise<void> {
    try {
      await this.dbManager.deleteJob(job_id);
      logger.info(`Deleted job ${job_id}`);
    } catch (error) {
      logger.error(`Failed to delete job ${job_id}: ${error}`);
      throw error;
    }
  }

  async cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      const deletedCount = await this.dbManager.deleteJobsOlderThan(cutoffDate);
      logger.info(`Cleaned up ${deletedCount} jobs older than ${olderThanDays} days`);
      
      return deletedCount;
    } catch (error) {
      logger.error(`Failed to clean up old jobs: ${error}`);
      throw error;
    }
  }
}