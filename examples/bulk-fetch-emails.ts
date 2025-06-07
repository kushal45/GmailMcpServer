import { AuthManager } from '../src/auth/AuthManager.js';
import { CacheManager } from '../src/cache/CacheManager.js';
import { DatabaseManager } from '../src/database/DatabaseManager.js';
import { EmailFetcher } from '../src/email/EmailFetcher.js';
import { logger } from '../src/utils/logger.js';

/**
 * Example: How to bulk fetch email details using the Gmail MCP Server
 * 
 * This example demonstrates:
 * 1. Setting up the required managers
 * 2. Using getEmailDetailsBulk() to fetch multiple emails at once
 * 3. Using the Gmail batch API for efficient bulk operations
 */

async function bulkFetchEmailsExample() {
  try {
    // Initialize managers
    const authManager = new AuthManager();
    const cacheManager = new CacheManager();
    const databaseManager = new DatabaseManager(); // Assuming you have a DatabaseManager for persistence
    const emailFetcher = new EmailFetcher(authManager, cacheManager, databaseManager);

    // Example 1: Fetch details for specific message IDs
    console.log('\n=== Example 1: Fetch specific emails by ID ===');
    const messageIds = [
      '18abc123def456789',  // Replace with actual message IDs
      '18abc123def456790',
      '18abc123def456791'
    ];

    const emailDetails = await emailFetcher.getEmailDetailsBulk(messageIds);
    
    console.log(`Fetched ${emailDetails.length} emails:`);
    emailDetails.forEach(email => {
      console.log(`- ${email.subject} from ${email.sender} (${email.date.toLocaleDateString()})`);
    });

    // Example 2: List emails and then fetch their details in bulk
    console.log('\n=== Example 2: List and bulk fetch ===');
    const listResult = await emailFetcher.listEmails({
      limit: 50,
      offset: 0,
      year: 2024,
      category: 'high'
    });

    console.log(`Found ${listResult.emails.length} emails matching criteria`);
    
    // The listEmails method already uses bulk fetch internally,
    // but you can also manually bulk fetch if needed
    const emailIds = listResult.emails.map(email => email.id);
    const bulkEmails = await emailFetcher.getEmailDetailsBulk(emailIds);
    
    console.log(`Bulk fetched ${bulkEmails.length} emails`);

    // Example 3: Get all message IDs and fetch in batches
    console.log('\n=== Example 3: Fetch all emails with specific query ===');
    const allMessageIds = await emailFetcher.getAllMessageIds('is:unread');
    
    console.log(`Found ${allMessageIds.length} unread messages`);
    
    // Process in chunks to avoid memory issues
    const chunkSize = 100;
    for (let i = 0; i < allMessageIds.length; i += chunkSize) {
      const chunk = allMessageIds.slice(i, i + chunkSize);
      const chunkEmails = await emailFetcher.getEmailDetailsBulk(chunk);
      
      console.log(`Processed batch ${Math.floor(i / chunkSize) + 1}: ${chunkEmails.length} emails`);
      
      // Process each email
      chunkEmails.forEach(email => {
        // Your processing logic here
        if (email.hasAttachments) {
          console.log(`Email "${email.subject}" has attachments`);
        }
      });
    }

    // Example 4: Using cache for performance
    console.log('\n=== Example 4: Demonstrating cache usage ===');
    
    // First call - will fetch from API
    console.time('First fetch');
    const firstFetch = await emailFetcher.getEmailDetailsBulk(messageIds);
    console.timeEnd('First fetch');
    
    // Second call - will use cache
    console.time('Cached fetch');
    const cachedFetch = await emailFetcher.getEmailDetailsBulk(messageIds);
    console.timeEnd('Cached fetch');
    
    console.log('Cache should be much faster!');

    // Clean up
    cacheManager.clear();

  } catch (error) {
    logger.error('Error in bulk fetch example:', error);
    console.error('Failed to fetch emails:', error);
  }
}

// Performance tips for bulk fetching
function performanceTips() {
  console.log(`
=== Performance Tips for Bulk Email Fetching ===

1. Batch Size: The default batch size is 100 (configurable via GMAIL_BATCH_SIZE env var)
   - Larger batches = fewer API calls but more memory usage
   - Smaller batches = more API calls but less memory usage

2. Caching: The EmailFetcher automatically caches results
   - Cache TTL is 1 hour by default
   - Use the same message IDs to benefit from caching

3. Rate Limiting: Gmail API has quotas
   - Daily quota: 1,000,000,000 quota units
   - Per-user rate limit: 250 quota units per user per second
   - Each messages.get call costs 5 quota units

4. Efficient Querying:
   - Use specific queries to reduce the number of emails to process
   - Filter by date, labels, or other criteria when possible

5. Error Handling:
   - The bulk fetch method handles individual email failures gracefully
   - Failed emails are logged but don't stop the entire batch

6. Memory Management:
   - Process large result sets in chunks
   - Clear cache periodically if processing many emails
  `);
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  bulkFetchEmailsExample()
    .then(() => performanceTips())
    .catch(console.error);
}

export { bulkFetchEmailsExample };