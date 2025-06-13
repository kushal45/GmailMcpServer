import { logger } from '../utils/logger.js';

/**
 * A simple job queue implementation for managing asynchronous jobs
 */
export class JobQueue {
  private queue: string[] = [];
  private processing: boolean = false;
  private jobHandlers: Map<string, (jobId: string) => Promise<void>> = new Map();

  /**
   * Add a job ID to the queue
   * @param jobId The unique identifier for the job
   * @returns Promise that resolves when the job is added
   */
  async addJob(jobId: string): Promise<void> {
    this.queue.push(jobId);
    logger.info(`Added job ${jobId} to queue. Queue length: ${this.queue.length}`);
    
    // Start processing if not already in progress
    if (!this.processing) {
      this.processQueue();
    }
    
    return Promise.resolve();
  }

  /**
   * Register a handler for a specific job type
   * @param jobType The type of job to handle
   * @param handler The function to call when processing this job type
   */
  registerJobHandler(jobType: string, handler: (jobId: string) => Promise<void>): void {
    this.jobHandlers.set(jobType, handler);
    logger.info(`Registered handler for job type: ${jobType}`);
  }

  /**
   * Retrieve the next job from the queue
   * @returns The next job ID or null if queue is empty
   */
  async retrieveJob(): Promise<string | null> {
    if (this.queue.length === 0) {
      return null;
    }
    
    const jobId = this.queue.shift();
    logger.debug(`Retrieved job ${jobId} from queue`);
    return jobId || null;
  }

  /**
   * Get the current queue length
   * @returns The number of jobs in the queue
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Process the queue asynchronously
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    
    try {
      while (this.queue.length > 0) {
        const jobId = await this.retrieveJob();
        
        if (jobId) {
          // In a real implementation, you would determine the job type
          // and call the appropriate handler
          logger.info(`Processing job ${jobId}`);
          
          // For now, we'll just log that we processed it
          logger.info(`Processed job ${jobId}`);
        }
      }
    } catch (error) {
      logger.error(`Error processing job queue: ${error}`);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Clear all jobs from the queue
   */
  clearQueue(): void {
    const count = this.queue.length;
    this.queue = [];
    logger.info(`Cleared ${count} jobs from queue`);
  }
}