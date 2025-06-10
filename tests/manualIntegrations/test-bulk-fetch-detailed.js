import { EmailFetcher } from '../../build/email/EmailFetcher.js';
import { AuthManager } from '../../build/auth/AuthManager.js';
import { CacheManager } from '../../build/cache/CacheManager.js';
import { DatabaseManager } from '../../build/database/DatabaseManager.js';
import { logger } from '../../build/utils/logger.js';

async function testBulkFetch() {
  let databaseManager;
  
  try {
    // Initialize managers
    const authManager = new AuthManager();
    const cacheManager = new CacheManager();
    databaseManager = new DatabaseManager();
    
    // Initialize database
    console.log('Initializing database...');
    await databaseManager.initialize();
    
    // Initialize email fetcher
    const emailFetcher = new EmailFetcher(databaseManager,authManager,cacheManager);
    
    console.log('Testing bulk email fetch...');
    
    // Enable debug logging for batch response
    logger.level = 'debug';
    
    // Test with a small batch first
    const result = await emailFetcher.listEmails({
      limit: 5,
      category: null,
      year: null,
      archived: false,
      offset: null
    });
    
    console.log(`\nSuccessfully fetched ${result.emails.length} emails out of ${result.total} total`);
    
    if (result.emails.length > 0) {
      console.log('\nEmail details:');
      result.emails.forEach((email, index) => {
        console.log(`\nEmail ${index + 1}:`);
        console.log('- ID:', email.id);
        console.log('- Subject:', email.subject);
        console.log('- From:', email.sender);
        console.log('- Date:', email.date);
        console.log('- Size:', email.size);
        console.log('- Has Attachments:', email.hasAttachments);
      });
    }
    
    // Check why some emails might have been skipped
    if (result.emails.length < 5) {
      console.log('\n⚠️  Warning: Fewer emails were fetched than requested.');
      console.log('This could be due to:');
      console.log('- Parsing errors in the batch response');
      console.log('- Deleted or inaccessible emails');
      console.log('- Permission issues');
      console.log('\nCheck the logs for more details.');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  } finally {
    // Clean up
    if (databaseManager) {
      try {
        await databaseManager.close();
        console.log('\nDatabase connection closed.');
      } catch (closeError) {
        console.error('Error closing database:', closeError);
      }
    }
  }
}

// Run the test
testBulkFetch();