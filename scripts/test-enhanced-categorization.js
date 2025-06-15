#!/usr/bin/env node

/**
 * Test script to demonstrate the enhanced categorization return format
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
    
    // Insert some test emails
    const testEmails = [
      {
        id: 'test-1',
        threadId: 'thread-1',
        subject: 'Urgent: Important Meeting Tomorrow',
        sender: 'boss@company.com',
        snippet: 'Please attend the important meeting tomorrow at 9 AM',
        date: new Date(),
        size: 1024,
        labels: ['IMPORTANT'],
        hasAttachments: false
      },
      {
        id: 'test-2',
        threadId: 'thread-2',
        subject: 'Newsletter: Weekly Updates',
        sender: 'newsletter@example.com',
        snippet: 'Here are this week\'s updates and news',
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        size: 2048,
        labels: ['CATEGORY_PROMOTIONS'],
        hasAttachments: false
      },
      {
        id: 'test-3',
        threadId: 'thread-3',
        subject: 'Spam: Get Rich Quick!',
        sender: 'spam@suspicious.com',
        snippet: 'Make money fast with this amazing opportunity',
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        size: 512,
        labels: ['SPAM'],
        hasAttachments: false
      }
    ];
    
    // Insert test emails
    for (const email of testEmails) {
      await databaseManager.upsertEmailIndex(email);
    }
    
    logger.info('Inserted test emails, running categorization...');
    
    // Run categorization with enhanced return format
    const result = await categorizationEngine.categorizeEmails({
      forceRefresh: true
    });
    
    // Debug the result object
    console.log('DEBUG: Full result object:', JSON.stringify(result, null, 2));
    
    logger.info('Enhanced Categorization Result:', {
      processed: result.processed,
      categories: result.categories,
      emailsCount: result.emails?.length || 'undefined',
      hasAnalyzerInsights: !!result.analyzer_insights
    });
    
    // Display detailed results
    console.log('\n=== ENHANCED CATEGORIZATION RESULTS ===');
    console.log(`Processed: ${result.processed} emails`);
    console.log(`Categories: High=${result.categories.high}, Medium=${result.categories.medium}, Low=${result.categories.low}`);
    console.log(`Emails returned: ${result.emails?.length || 0}`);
    
    if (result.analyzer_insights) {
      console.log('\n=== ANALYZER INSIGHTS ===');
      console.log(`Top Importance Rules: ${result.analyzer_insights.top_importance_rules?.join(', ') || 'None'}`);
      console.log(`Spam Detection Rate: ${(result.analyzer_insights.spam_detection_rate * 100).toFixed(1)}%`);
      console.log(`Average Confidence: ${(result.analyzer_insights.avg_confidence * 100).toFixed(1)}%`);
      console.log(`Age Distribution:`, result.analyzer_insights.age_distribution);
      console.log(`Size Distribution:`, result.analyzer_insights.size_distribution);
    }
    
    console.log('\n=== SAMPLE CATEGORIZED EMAILS ===');
    // if (result.emails && result.emails.length > 0) {
    //   result.emails.forEach((email, index) => {
    //     console.log(`\nEmail ${index + 1}:`);
    //     console.log(`  ID: ${email.id}`);
    //     console.log(`  Subject: ${email.subject}`);
    //     console.log(`  Category: ${email.category}`);
    //     console.log(`  Importance Level: ${email.importanceLevel}`);
    //     console.log(`  Importance Score: ${email.importanceScore}`);
    //     console.log(`  Age Category: ${email.ageCategory}`);
    //     console.log(`  Size Category: ${email.sizeCategory}`);
    //     console.log(`  Gmail Category: ${email.gmailCategory}`);
    //     console.log(`  Spam Score: ${email.spamScore}`);
    //     console.log(`  Analysis Version: ${email.analysisVersion}`);
    //     if (email.importanceMatchedRules && email.importanceMatchedRules.length > 0) {
    //       console.log(`  Matched Rules: ${email.importanceMatchedRules.join(', ')}`);
    //     }
    //   });
    // } else {
    //   console.log('No emails returned in the result');
    // }
    /**
     * search emails with specific criteria
     */
    const specificCriteria = {
      importanceLevel: 'HIGH',
      hasAttachments: false,
      dateRange: {
        from: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000), // Last 14 days
        to: new Date()
      }
    };
    const searchResults = await databaseManager.searchEmails(specificCriteria);
    console.log('\n=== SEARCH RESULTS ===');
    if (searchResults && searchResults.length > 0) {
      searchResults.forEach((email, index) => {
        console.log(`\nSearch Result ${index + 1}:`);
        console.log(`  ID: ${email.id}`);
        console.log(`  Subject: ${email.subject}`);
        console.log(`  Category: ${email.category}`);
        console.log(`  Importance Level: ${email.importanceLevel}`);
        console.log(`  Date: ${email.date}`);
        console.log(`  Sender: ${email.sender}`);
        console.log(`  Snippet: ${email.snippet}`);
        console.log(`  Labels: ${email.labels.join(', ')}`);
        console.log(`  Has Attachments: ${email.hasAttachments}`);
        console.log(`  Size: ${email.size} bytes`);
        console.log(`  Spam Score: ${email.spamScore}`);
        console.log(`  Analysis Version: ${email.analysisVersion}`);
      });
    } else {
      console.log('No emails found matching the search criteria');
    }
    
    // Clean up test data
    //for (const email of testEmails) {
      await databaseManager.deleteEmailIndexs(testEmails);
    //}
    
    await databaseManager.close();
    logger.info('Enhanced categorization test completed successfully');
    
  } catch (error) {
    logger.error('Error testing enhanced categorization:', error);
    process.exit(1);
  }
}

// Run the test
testEnhancedCategorization().catch(console.error);