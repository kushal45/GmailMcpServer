#!/usr/bin/env node

/**
 * Simple test script to demonstrate the enhanced categorization return format
 */

import { DatabaseManager } from '../build/database/DatabaseManager.js';
import { CacheManager } from '../build/cache/CacheManager.js';
import { CategorizationEngine } from '../build/categorization/CategorizationEngine.js';
import { logger } from '../build/utils/logger.js';

async function testEnhancedCategorization() {
  logger.info('Testing Enhanced Categorization Return Format');
  
  try {
    // Initialize components
    const databaseManager = new DatabaseManager();
    await databaseManager.initialize();
    
    const cacheManager = new CacheManager();
    const categorizationEngine = new CategorizationEngine(databaseManager, cacheManager);
    
    // Insert a single test email
    const testEmail = {
      id: 'test-enhanced-1',
      threadId: 'thread-enhanced-1',
      subject: 'Urgent: Important Meeting Tomorrow',
      sender: 'boss@company.com',
      snippet: 'Please attend the important meeting tomorrow at 9 AM',
      date: new Date(),
      size: 1024,
      labels: ['IMPORTANT'],
      hasAttachments: false
    };
    
    // Insert test email
    await databaseManager.upsertEmailIndex(testEmail);
    logger.info('Inserted test email, running categorization...');
    
    // Run categorization with enhanced return format
    const result = await categorizationEngine.categorizeEmails({
      forceRefresh: true
    });
    
    // Display the result structure
    console.log('\n=== ENHANCED CATEGORIZATION RESULT STRUCTURE ===');
    console.log('Result keys:', Object.keys(result));
    console.log('Processed:', result.processed);
    console.log('Categories:', result.categories);
    console.log('Has emails array:', 'emails' in result);
    console.log('Has analyzer_insights:', 'analyzer_insights' in result);
    
    if (result.emails) {
      console.log('Emails array length:', result.emails.length);
      if (result.emails.length > 0) {
        console.log('First email keys:', Object.keys(result.emails[0]));
        console.log('First email category:', result.emails[0].category);
        console.log('First email importance level:', result.emails[0].importanceLevel);
      }
    }
    
    if (result.analyzer_insights) {
      console.log('Analyzer insights keys:', Object.keys(result.analyzer_insights));
    }
    
    await databaseManager.close();
    logger.info('Enhanced categorization test completed successfully');
    
  } catch (error) {
    logger.error('Error testing enhanced categorization:', error);
    process.exit(1);
  }
}

// Run the test
testEnhancedCategorization().catch(console.error);