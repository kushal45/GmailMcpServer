import { logger } from '../utils/logger.js';

/**
 * A simple job queue implementation for managing asynchronous jobs
 */
export class JobQueue {
  // Map of user_id to array of job IDs for that user
  private userQueues: Map<string, string[]> = new Map();
  // Queue for jobs without a user_id (legacy/system jobs)
  private systemQueue: string[] = [];
  private processing: boolean = false;
  private jobHandlers: Map<string, (jobId: string, userId?: string) => Promise<void>> = new Map();

  /**
   * Add a job ID to the queue
   * @param jobId The unique identifier for the job
   * @param userId Optional user ID to associate with the job
   * @returns Promise that resolves when the job is added
   */
  async addJob(jobId: string, userId?: string): Promise<void> {
    if (userId) {
      // Add to user-specific queue
      if (!this.userQueues.has(userId)) {
        this.userQueues.set(userId, []);
      }
      this.userQueues.get(userId)!.push(jobId);
      logger.debug(`Added job ${jobId} to queue for user ${userId}. Queue length: ${this.userQueues.get(userId)!.length}`);
    } else {
      // Add to system queue
      this.systemQueue.push(jobId);
      logger.debug(`Added job ${jobId} to system queue. Queue length: ${this.systemQueue.length}`);
    }
    return Promise.resolve();
  }

  /**
   * Register a handler for a specific job type
   * @param jobType The type of job to handle
   * @param handler The function to call when processing this job type
   */
  registerJobHandler(jobType: string, handler: (jobId: string, userId?: string) => Promise<void>): void {
    this.jobHandlers.set(jobType, handler);
    logger.debug(`Registered handler for job type: ${jobType}`);
  }

  /**
   * Retrieve the next job from the queue
   * @param userId Optional user ID to retrieve jobs for a specific user
   * @returns The next job ID or null if queue is empty, along with the user ID if it's a user job
   */
  async retrieveJob(userId?: string): Promise<{jobId: string | null, userId?: string}> {
    if (userId) {
      // Retrieve from specific user queue
      const userQueue = this.userQueues.get(userId);
      if (!userQueue || userQueue.length === 0) {
        return { jobId: null };
      }
      
      const jobId = userQueue.shift();
      logger.debug(`Retrieved job ${jobId} from queue for user ${userId}`);
      return { jobId: jobId || null, userId };
    } else {
      // Try system queue first
      if (this.systemQueue.length > 0) {
        const jobId = this.systemQueue.shift();
        logger.debug(`Retrieved job ${jobId} from system queue`);
        return { jobId: jobId || null };
      }
      
      // If system queue is empty, try to retrieve from any user queue
      // This ensures jobs keep processing even if not explicitly asked for by user ID
      for (const [userId, queue] of this.userQueues.entries()) {
        if (queue.length > 0) {
          const jobId = queue.shift();
          logger.debug(`Retrieved job ${jobId} from queue for user ${userId}`);
          return { jobId: jobId || null, userId };
        }
      }
      
      return { jobId: null };
    }
  }
/**
 * Get the current queue length
 * @param userId Optional user ID to get queue length for a specific user
 * @returns The number of jobs in the queue
 */
getQueueLength(userId?: string): number {
  if (userId) {
    return this.userQueues.get(userId)?.length || 0;
  } else {
    // Sum of all queues
    let total = this.systemQueue.length;
    this.userQueues.forEach(queue => {
      total += queue.length;
    });
    return total;
  }
}



  /**
   * Clear all jobs from the queue
   * @param userId Optional user ID to clear only that user's queue
   */
  clearQueue(userId?: string): void {
    if (userId) {
      const count = this.userQueues.get(userId)?.length || 0;
      this.userQueues.set(userId, []);
      logger.debug(`Cleared ${count} jobs from queue for user ${userId}`);
    } else {
      let count = this.systemQueue.length;
      this.userQueues.forEach(queue => {
        count += queue.length;
      });
      this.systemQueue = [];
      this.userQueues.clear();
      logger.debug(`Cleared ${count} jobs from all queues`);
    }
  }
  
  /**
   * Get all job IDs for a specific user
   * @param userId The user ID to get jobs for
   * @returns Array of job IDs for the user
   */
  getUserJobs(userId: string): string[] {
    return [...(this.userQueues.get(userId) || [])];
  }
}