import { DatabaseManager } from './database/DatabaseManager.js';
import { JobQueue } from './database/JobQueue.js';
import { JobStatusStore } from './database/JobStatusStore.js';
import { CategorizationStore } from './categorization/CategorizationStore.js';
import { CategorizationWorker } from './categorization/CategorizationWorker.js';
import { logger } from './utils/logger.js';
import { CategorizationEngine } from './categorization/CategorizationEngine.js';
import { CacheManager } from './cache/CacheManager.js';

// Example usage of the implemented classes
async function main() {
  try {
    // Initialize database
    const dbManager = new DatabaseManager();
    await dbManager.initialize();
    
    // Initialize stores
    const jobStatusStore = new JobStatusStore(dbManager);
    await jobStatusStore.initialize();
    
    const categorizationEngine = new CategorizationEngine(dbManager, new CacheManager);
    
    // Initialize job queue
    const jobQueue = new JobQueue();
    
    // Initialize categorization worker
    const categorizationWorker = new CategorizationWorker(
      jobQueue,
      categorizationEngine
    );
    
    // Start worker
    categorizationWorker.start();
    
    // Example: Create a categorization job
    const jobId = await jobStatusStore.createJob('categorize_emails', {
      year: 2023,
      forceRefresh: false
    });
    
    logger.info(`Created job with ID: ${jobId}`);
    
    // Add job to queue
    await jobQueue.addJob(jobId);
    
    // Example: Poll for job status
    const pollInterval = setInterval(async () => {
      const job = await jobStatusStore.getJobStatus(jobId);
      
      if (!job) {
        logger.error('Job not found');
        clearInterval(pollInterval);
        return;
      }
      
      logger.info(`Job status: ${job.status}, Progress: ${job.progress || 0}%`);
      
      if (job.status === 'COMPLETED' || job.status === 'FAILED') {
        logger.info('Job finished with result:', job.results || job.error_details);
        clearInterval(pollInterval);
      }
    }, 1000);
    
    // Keep the process running for demonstration
    setTimeout(() => {
      clearInterval(pollInterval);
      categorizationWorker.stop();
      dbManager.close();
      process.exit(0);
    }, 30000);
  } catch (error) {
    logger.error('Error in main:', error);
  }
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}