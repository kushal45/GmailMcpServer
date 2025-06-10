#!/usr/bin/env node

/**
 * Manual integration test script for email categorization flow
 * This script demonstrates the end-to-end categorization process
 * and can be run directly to test the categorization functionality.
 */

import { DatabaseManager } from '../src/database/DatabaseManager.js';
import { CacheManager } from '../src/cache/CacheManager.js';
import { CategorizationEngine } from '../src/categorization/CategorizationEngine.js';
import { mockEmails } from '../tests/integration/categorization/fixtures/mockEmails.js';
import { logger } from '../src/utils/logger.js';
import { PriorityCategory } from '../src/types/index.js';

// Set test mode to use in-memory database
process.env.NODE_ENV = 'test';
process.env.STORAGE_PATH = 'data/test';

async function runCategorizationTest() {
  logger.info('Starting categorization integration test');
  
  try {
    // Initialize database
    const dbManager = new DatabaseManager();
    await dbManager.initialize();
    logger.info('Database initialized');
    
    // Initialize cache
    const cacheManager = new CacheManager();
    logger.info('Cache initialized');
    
    // Create categorization engine
    const categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
    logger.info('Categorization engine created');
    
    // Seed test data
    logger.info(`Seeding ${mockEmails.length} test emails`);
    await Promise.all(mockEmails.map(email => dbManager.upsertEmailIndex(email)));
    
    // Verify uncategorized state
    const uncategorizedEmails = await dbManager.searchEmails({});
    logger.info(`Initial state: ${uncategorizedEmails.length} uncategorized emails`);
    
    // Run categorization
    logger.info('Running email categorization');
    const result = await categorizationEngine.categorizeEmails({ forceRefresh: true });
    logger.info(`Categorization completed: ${result.processed} emails processed`);
    logger.info(`Categories: High: ${result.categories[PriorityCategory.HIGH]}, Medium: ${result.categories[PriorityCategory.MEDIUM]}, Low: ${result.categories[PriorityCategory.LOW]}`);
    
    // Verify categorized state
    const highPriorityEmails = await dbManager.searchEmails({ category: PriorityCategory.HIGH });
    const mediumPriorityEmails = await dbManager.searchEmails({ category: PriorityCategory.MEDIUM });
    const lowPriorityEmails = await dbManager.searchEmails({ category: PriorityCategory.LOW });
    
    logger.info('Categorization results:');
    logger.info(`- High priority: ${highPriorityEmails.length} emails`);
    logger.info(`- Medium priority: ${mediumPriorityEmails.length} emails`);
    logger.info(`- Low priority: ${lowPriorityEmails.length} emails`);
    
    // Get statistics
    logger.info('Fetching email statistics');
    const stats = await categorizationEngine.getStatistics({ 
      groupBy: 'category', 
      includeArchived: true 
    });
    
    logger.info('Email statistics:');
    logger.info(`- Categories: ${JSON.stringify(stats.categories)}`);
    logger.info(`- Years: ${JSON.stringify(Object.keys(stats.years))}`);
    logger.info(`- Sizes: ${JSON.stringify(stats.sizes)}`);
    logger.info(`- Total: ${stats.total.count} emails, ${stats.total.size} bytes`);
    
    // Clean up
    await dbManager.close();
    logger.info('Test completed successfully');
    
    return {
      success: true,
      processed: result.processed,
      categories: result.categories
    };
  } catch (error) {
    logger.error('Test failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Run the test if this script is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runCategorizationTest()
    .then(result => {
      if (result.success) {
        logger.info('✅ Categorization test passed');
        process.exit(0);
      } else {
        logger.error('❌ Categorization test failed');
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error('Unhandled error:', error);
      process.exit(1);
    });
}

export { runCategorizationTest };