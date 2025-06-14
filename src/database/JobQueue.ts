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
    logger.debug(`Added job ${jobId} to queue. Queue length: ${this.queue.length}`);
    return Promise.resolve();
  }

  /**
   * Register a handler for a specific job type
   * @param jobType The type of job to handle
   * @param handler The function to call when processing this job type
   */
  registerJobHandler(jobType: string, handler: (jobId: string) => Promise<void>): void {
    this.jobHandlers.set(jobType, handler);
    logger.debug(`Registered handler for job type: ${jobType}`);
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
   * Clear all jobs from the queue
   */
  clearQueue(): void {
    const count = this.queue.length;
    this.queue = [];
    logger.debug(`Cleared ${count} jobs from queue`);
  }
}