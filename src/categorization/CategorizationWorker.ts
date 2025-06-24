import {JobStatusStore,JobQueue } from '../database/index.js';
import { logger } from '../utils/logger.js';
import { CategorizationEngine } from './CategorizationEngine.js';
import { JobStatus } from '../types/index.js';

/**
 * Worker that processes categorization jobs from the queue
 */
export class CategorizationWorker {
  private jobQueue: JobQueue;
  private jobStatusStore: JobStatusStore;
  private categorizationEngine: CategorizationEngine;
  private isRunning: boolean = false;

  constructor(
    jobQueue: JobQueue,
    categorizationEngine: CategorizationEngine
  ) {
    this.jobQueue = jobQueue;
    this.jobStatusStore = JobStatusStore.getInstance();
    this.categorizationEngine = categorizationEngine;
  }

  /**
   * Start the worker to process jobs
   */
  start(): void {
    if (this.isRunning) {
      logger.info('Categorization worker is already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting categorization worker', {
      timestamp: new Date().toISOString(),
      jobStatusStoreExists: !!this.jobStatusStore,
      categorizationEngineExists: !!this.categorizationEngine,
    });
    this.processNextJob();
  }

  /**
   * Stop the worker
   */
  stop(): void {
    this.isRunning = false;
    logger.info('Stopping categorization worker');
  }

  /**
   * Process the next job in the queue
   */
  private async processNextJob(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Get next job from queue for this user
      const { jobId, userId } = await this.jobQueue.retrieveJob();
      
      if (!jobId) {
        // No jobs in queue, wait and check again
        setTimeout(() => this.processNextJob(), 5000);
        return;
      }

      logger.info(`Processing categorization job: ${jobId}`);
      
      // Validate singleton integrity and database initialization before processing
      try {
        JobStatusStore.validateSingletonIntegrity();
        logger.info(`CategorizationWorker validation passed for job: ${jobId}`, {
          timestamp: new Date().toISOString(),
          jobStatusStoreId: this.jobStatusStore.getInstanceId(),
          categorizationEngineExists: !!this.categorizationEngine,
          userId
        });
      } catch (error) {
        logger.error(`CategorizationWorker validation failed for job: ${jobId}`, { error });
        throw error;
      }
      
      const job = await this.jobStatusStore.getJobStatus(jobId,userId);
      
      if (!job) {
        logger.error(`Job ${jobId} not found in database`);
        this.processNextJob();
        return;
      }

      // Update job status to IN_PROGRESS
      await this.jobStatusStore.updateJobStatus(
        jobId, 
        JobStatus.IN_PROGRESS, 
        { started_at: new Date()}
      );

      try {
        // Process the job based on parameters
        const params = job.request_params;
        const year = params.year;
        const forceRefresh = params.forceRefresh || false;
        
        // Get emails that need categorization
        const categorizationResult = await this.categorizationEngine.categorizeEmails({
          forceRefresh,
          year
        }, { user_id:userId??'default', session_id: 'default-session' });
        
        if (categorizationResult.processed === 0) {
          await this.jobStatusStore.updateJobStatus(
            jobId,
            JobStatus.COMPLETED,
            {
              completed_at: new Date(),
              results: { message: 'No emails to categorize' ,emailIds:[]}
            }
          );
          this.processNextJob();
          return;
        }
       const emailIds = categorizationResult.emails.map(email => email.id);
        // Update job status to COMPLETED
        await this.jobStatusStore.updateJobStatus(
          jobId,
          JobStatus.COMPLETED,
          {
            completed_at: new Date(),
            results: {
              processed: categorizationResult.processed,
              categorized: categorizationResult.categories,
              emailIds,
            }
          }
        );
        
        logger.info(`Completed categorization job ${jobId}`);
      } catch (error) {
        logger.error(`Error processing job ${jobId}: ${error}`);
        
        // Update job status to FAILED
        await this.jobStatusStore.updateJobStatus(
          jobId,
          JobStatus.FAILED,
          {
            completed_at: new Date(),
            error_details: error instanceof Error ? error.message : String(error)
          }
        );
      }

      // Process next job
      this.processNextJob();
    } catch (error) {
      logger.error(`Error in categorization worker: ${error}`);
      
      // Wait before trying again
      setTimeout(() => this.processNextJob(), 10000);
    }
  }
}