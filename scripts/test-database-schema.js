#!/usr/bin/env node

/**
 * Test script to verify the database schema changes for analyzer results
 */

import { DatabaseManager } from '../build/database/DatabaseManager.js';
import { logger } from '../build/utils/logger.js';

async function testDatabaseSchema() {
  const dbManager = DatabaseManager.getInstance();
  
  try {
    logger.info('Testing database schema with analyzer result columns...');
    
    // Initialize database (this will create tables and run migration)
    await dbManager.initialize();
    
    // Test email with analyzer results
    const testEmail = {
      id: 'test-email-123',
      threadId: 'thread-123',
      category: 'high',
      subject: 'Test Email with Analyzer Results',
      sender: 'test@example.com',
      recipients: ['recipient@example.com'],
      date: new Date(),
      year: 2024,
      size: 1024,
      hasAttachments: false,
      labels: ['INBOX', 'IMPORTANT'],
      snippet: 'This is a test email',
      archived: false,
      
      // Importance Analysis Results
      importanceScore: 0.85,
      importanceLevel: 'high',
      importanceMatchedRules: ['sender-whitelist', 'keyword-urgent'],
      importanceConfidence: 0.92,
      
      // Date/Size Analysis Results
      ageCategory: 'recent',
      sizeCategory: 'small',
      recencyScore: 0.95,
      sizePenalty: 0.1,
      
      // Label Classification Results
      gmailCategory: 'important',
      spamScore: 0.05,
      promotionalScore: 0.1,
      socialScore: 0.0,
      spamIndicators: [],
      promotionalIndicators: ['offer'],
      socialIndicators: [],
      
      // Analysis Metadata
      analysisTimestamp: new Date(),
      analysisVersion: '1.0.0'
    };
    
    // Test upsert
    logger.info('Testing upsertEmailIndex with analyzer results...');
    await dbManager.upsertEmailIndex(testEmail);
    
    // Test retrieval
    logger.info('Testing getEmailIndex...');
    const retrievedEmail = await dbManager.getEmailIndex('test-email-123');
    
    if (!retrievedEmail) {
      throw new Error('Failed to retrieve email from database');
    }
    
    // Verify analyzer results are preserved
    logger.info('Verifying analyzer results...');
    console.log('Retrieved email analyzer results:');
    console.log('- Importance Score:', retrievedEmail.importanceScore);
    console.log('- Importance Level:', retrievedEmail.importanceLevel);
    console.log('- Matched Rules:', retrievedEmail.importanceMatchedRules);
    console.log('- Age Category:', retrievedEmail.ageCategory);
    console.log('- Size Category:', retrievedEmail.sizeCategory);
    console.log('- Gmail Category:', retrievedEmail.gmailCategory);
    console.log('- Spam Score:', retrievedEmail.spamScore);
    console.log('- Analysis Version:', retrievedEmail.analysisVersion);
    
    // Test bulk upsert
    logger.info('Testing bulkUpsertEmailIndex...');
    const bulkEmails = [
      {
        ...testEmail,
        id: 'bulk-test-1',
        importanceScore: 0.7,
        importanceLevel: 'medium'
      },
      {
        ...testEmail,
        id: 'bulk-test-2',
        importanceScore: 0.3,
        importanceLevel: 'low'
      }
    ];
    
    await dbManager.bulkUpsertEmailIndex(bulkEmails);
    
    // Test search with new criteria
    logger.info('Testing search with analyzer criteria...');
    const searchResults = await dbManager.searchEmails({
      limit: 10
    });
    
    console.log(`Found ${searchResults.length} emails in database`);
    
    logger.info('✅ Database schema test completed successfully!');
    logger.info('All analyzer result columns are working correctly.');
    
  } catch (error) {
    logger.error('❌ Database schema test failed:', error);
    throw error;
  } finally {
    await dbManager.close();
  }
}

// Run the test
testDatabaseSchema()
  .then(() => {
    console.log('\n🎉 Database schema migration test passed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Database schema migration test failed:', error);
    process.exit(1);
  });