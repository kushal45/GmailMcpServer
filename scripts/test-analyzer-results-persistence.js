#!/usr/bin/env node

/**
 * Test script to verify that detailed analyzer results are being properly collected and persisted
 */

import { DatabaseManager } from '../build/database/DatabaseManager.js';
import { CacheManager } from '../build/cache/CacheManager.js';
import { CategorizationEngine } from '../build/categorization/CategorizationEngine.js';
import { logger } from '../build/utils/logger.js';

async function testAnalyzerResultsPersistence() {
  logger.info('Testing analyzer results persistence...');
  
  const databaseManager = new DatabaseManager();
  const cacheManager = new CacheManager();
  
  try {
    // Initialize database
    await databaseManager.initialize();
    
    // Create categorization engine
    const categorizationEngine = new CategorizationEngine(databaseManager, cacheManager);
    
    // Create a test email
    const testEmail = {
      id: 'test-analyzer-results-' + Date.now(),
      threadId: 'thread-123',
      subject: 'URGENT: Important Meeting Tomorrow',
      sender: 'boss@company.com',
      recipients: ['user@company.com'],
      date: new Date(),
      year: new Date().getFullYear(),
      size: 2048,
      hasAttachments: false,
      labels: ['IMPORTANT', 'INBOX'],
      snippet: 'Please attend the important meeting tomorrow at 9 AM. This is urgent and requires your immediate attention.',
      archived: false
    };
    
    // Insert the test email
    await databaseManager.upsertEmailIndex(testEmail);
    logger.info('Test email inserted', { emailId: testEmail.id });
    
    // Categorize the email (this should collect and persist analyzer results)
    const result = await categorizationEngine.categorizeEmails({
      forceRefresh: true,
      year: new Date().getFullYear()
    });
    
    logger.info('Categorization completed', result);
    
    // Retrieve the email to verify analyzer results were stored
    const emails = await databaseManager.searchEmails({ 
      query: testEmail.id 
    });
    
    if (emails.length === 0) {
      throw new Error('Test email not found after categorization');
    }
    
    const categorizedEmail = emails[0];
    
    // Verify analyzer results are present
    const analyzerResults = {
      // Importance Analysis
      importanceScore: categorizedEmail.importanceScore,
      importanceLevel: categorizedEmail.importanceLevel,
      importanceMatchedRules: categorizedEmail.importanceMatchedRules,
      importanceConfidence: categorizedEmail.importanceConfidence,
      
      // Date/Size Analysis
      ageCategory: categorizedEmail.ageCategory,
      sizeCategory: categorizedEmail.sizeCategory,
      recencyScore: categorizedEmail.recencyScore,
      sizePenalty: categorizedEmail.sizePenalty,
      
      // Label Classification
      gmailCategory: categorizedEmail.gmailCategory,
      spamScore: categorizedEmail.spamScore,
      promotionalScore: categorizedEmail.promotionalScore,
      socialScore: categorizedEmail.socialScore,
      spamIndicators: categorizedEmail.spamIndicators,
      promotionalIndicators: categorizedEmail.promotionalIndicators,
      socialIndicators: categorizedEmail.socialIndicators,
      
      // Analysis Metadata
      analysisTimestamp: categorizedEmail.analysisTimestamp,
      analysisVersion: categorizedEmail.analysisVersion,
      
      // Final Category
      category: categorizedEmail.category
    };
    
    logger.info('Analyzer results retrieved from database:', analyzerResults);
    
    // Verify required fields are present
    const requiredFields = [
      'importanceScore', 'importanceLevel', 'importanceConfidence',
      'ageCategory', 'sizeCategory', 'recencyScore', 'sizePenalty',
      'gmailCategory', 'spamScore', 'promotionalScore', 'socialScore',
      'analysisTimestamp', 'analysisVersion', 'category'
    ];
    
    const missingFields = requiredFields.filter(field => 
      analyzerResults[field] === undefined || analyzerResults[field] === null
    );
    
    if (missingFields.length > 0) {
      logger.error('Missing analyzer result fields:', missingFields);
      throw new Error(`Missing required analyzer result fields: ${missingFields.join(', ')}`);
    }
    
    // Verify data types and ranges
    const validations = [
      { field: 'importanceScore', type: 'number', min: -10, max: 10 },
      { field: 'importanceLevel', type: 'string', values: ['high', 'medium', 'low'] },
      { field: 'importanceConfidence', type: 'number', min: 0, max: 1 },
      { field: 'ageCategory', type: 'string', values: ['recent', 'moderate', 'old'] },
      { field: 'sizeCategory', type: 'string', values: ['small', 'medium', 'large'] },
      { field: 'recencyScore', type: 'number', min: 0, max: 1 },
      { field: 'sizePenalty', type: 'number', min: 0, max: 1 },
      { field: 'spamScore', type: 'number', min: 0, max: 1 },
      { field: 'promotionalScore', type: 'number', min: 0, max: 1 },
      { field: 'socialScore', type: 'number', min: 0, max: 1 },
      { field: 'analysisVersion', type: 'string' },
      { field: 'category', type: 'string', values: ['high', 'medium', 'low'] }
    ];
    
    for (const validation of validations) {
      const value = analyzerResults[validation.field];
      
      if (validation.type === 'number') {
        if (typeof value !== 'number' || isNaN(value)) {
          throw new Error(`${validation.field} should be a number, got: ${typeof value}`);
        }
        if (validation.min !== undefined && value < validation.min) {
          throw new Error(`${validation.field} should be >= ${validation.min}, got: ${value}`);
        }
        if (validation.max !== undefined && value > validation.max) {
          throw new Error(`${validation.field} should be <= ${validation.max}, got: ${value}`);
        }
      }
      
      if (validation.type === 'string') {
        if (typeof value !== 'string') {
          throw new Error(`${validation.field} should be a string, got: ${typeof value}`);
        }
        if (validation.values && !validation.values.includes(value)) {
          throw new Error(`${validation.field} should be one of [${validation.values.join(', ')}], got: ${value}`);
        }
      }
    }
    
    // Verify timestamp is recent
    const analysisTime = new Date(analyzerResults.analysisTimestamp);
    const timeDiff = Date.now() - analysisTime.getTime();
    if (timeDiff > 60000) { // More than 1 minute ago
      logger.warn('Analysis timestamp seems old:', { 
        analysisTimestamp: analyzerResults.analysisTimestamp,
        timeDiffMs: timeDiff 
      });
    }
    
    logger.info('✅ All analyzer results validation passed!');
    logger.info('✅ Detailed analyzer results are being properly collected and persisted');
    
    // Clean up test email
    await databaseManager.deleteEmails([testEmail.id]);
    logger.info('Test email cleaned up');
    
    return {
      success: true,
      analyzerResults,
      message: 'Analyzer results persistence test completed successfully'
    };
    
  } catch (error) {
    logger.error('Analyzer results persistence test failed:', error);
    throw error;
  } finally {
    await databaseManager.close();
  }
}

// Run the test
testAnalyzerResultsPersistence()
  .then(result => {
    console.log('\n🎉 Test Results:');
    console.log('Success:', result.success);
    console.log('Message:', result.message);
    console.log('\n📊 Sample Analyzer Results:');
    console.log(JSON.stringify(result.analyzerResults, null, 2));
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Test Failed:', error.message);
    process.exit(1);
  });