import { EmailFetcher } from '../../build/email/EmailFetcher.js';
import { AuthManager } from '../../build/auth/AuthManager.js';
import { CacheManager } from '../../build/cache/CacheManager.js';
import { DatabaseManager } from '../../build/database/DatabaseManager.js';
import { logger } from '../../build/utils/logger.js';

async function testBulkFetch() {
  try {
    // Initialize managers
    const authManager = new AuthManager();
    const cacheManager = new CacheManager();
    const databaseManager = new DatabaseManager();
    
    // Initialize email fetcher
    const emailFetcher = new EmailFetcher(authManager, cacheManager, databaseManager);
    
    console.log('Testing bulk email fetch...');
    
    // Test with a small batch first
    const result = await emailFetcher.listEmails({
      limit: 5,
      category: null,
      year: null,
      archived: false,
      offset: null
    });
    
    console.log(`Successfully fetched ${result.emails.length} emails`);
    console.log('Total emails available:', result.total);
    
    if (result.emails.length > 0) {
      console.log('\nFirst email details:');
      console.log('- ID:', result.emails[0].id);
      console.log('- Subject:', result.emails[0].subject);
      console.log('- From:', result.emails[0].sender);
      console.log('- Date:', result.emails[0].date);
    }
    
    // Test with a larger batch
    console.log('\nTesting with larger batch (20 emails)...');
    const largerResult = await emailFetcher.listEmails({
      limit: 20,
      category: null,
      year: null,
      archived: false,
      offset: null
    });
    
    console.log(`Successfully fetched ${largerResult.emails.length} emails in larger batch`);
    
  } catch (error) {
    console.error('Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testBulkFetch();