import { createTestDatabaseManager, createCategorizationEngineWithRealDb } from '../build/tests/integration/categorization/helpers/testHelpers.js';
import { CategorizationWorker } from '../build/categorization/CategorizationWorker.js';
import { JobQueue } from '../build/database/JobQueue.js';
import { logger } from '../build/utils/logger.js';

async function main() {
  try {
    // Create test database manager
    const dbManager = await createTestDatabaseManager();
    
    // Create categorization engine
    const { categorizationEngine } = await createCategorizationEngineWithRealDb();
    
    // Create job queue
    const jobQueue = new JobQueue(dbManager);
    await jobQueue.initialize();
    
    // Create CategorizationWorker instance
    const worker = new CategorizationWorker(jobQueue, categorizationEngine);
    
    // Test starting the worker
    worker.start();
    
    // Let it run for a few seconds
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Test stopping the worker
    worker.stop();
    
    // Cleanup
    await dbManager.close();
  } catch (error) {
    logger.error('Error in test:', error);
  }
}

main();