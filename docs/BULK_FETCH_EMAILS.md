# Bulk Fetch Email Details

This document explains how to use the bulk fetch functionality in the Gmail MCP Server to efficiently retrieve details for multiple emails at once.

## Overview

The Gmail MCP Server provides bulk fetch capabilities through the `EmailFetcher` class, which uses Gmail's batch API to efficiently retrieve email details for multiple message IDs in a single request.

## Key Methods

### 1. `getEmailDetailsBulk(messageIds: string[]): Promise<EmailIndex[]>`

Fetches email details for an array of message IDs using the Gmail batch API.

**Features:**
- Automatic batching (default 100 emails per batch)
- Built-in caching for performance
- Error handling for individual email failures
- Efficient HTTP batch requests

**Example:**
```typescript
const messageIds = ['id1', 'id2', 'id3'];
const emails = await emailFetcher.getEmailDetailsBulk(messageIds);
```

### 2. `fetchEmailBatchViaHttpBatch(messageIds: string[]): Promise<EmailIndex[]>`

Internal method that implements the actual Gmail batch API calls using multipart/mixed HTTP requests.

**Features:**
- Uses Gmail's batch endpoint: `https://gmail.googleapis.com/batch/gmail/v1`
- Configurable batch size via `GMAIL_BATCH_SIZE` environment variable
- Automatic retry and error handling
- Minimal API quota usage

### 3. `getAllMessageIds(query: string): Promise<string[]>`

Retrieves all message IDs matching a specific query.

**Example:**
```typescript
// Get all unread message IDs
const unreadIds = await emailFetcher.getAllMessageIds('is:unread');

// Get all messages from 2024
const ids2024 = await emailFetcher.getAllMessageIds('after:2024/1/1 before:2025/1/1');
```

## Implementation Details

### Batch API Request Format

The bulk fetch uses Gmail's batch API with multipart/mixed format:

```
POST https://gmail.googleapis.com/batch/gmail/v1
Content-Type: multipart/mixed; boundary=batch_xyz

--batch_xyz
Content-Type: application/http

GET /gmail/v1/users/me/messages/{messageId}?format=metadata
--batch_xyz--
```

### Response Parsing

The response is also in multipart/mixed format. Each part contains:
- HTTP status code
- Headers
- JSON body with email details

### Error Handling

The implementation handles various error scenarios:
- Individual message failures don't stop the entire batch
- Malformed JSON responses are logged and skipped
- Network errors trigger retries with exponential backoff
- Rate limiting is respected with delays between batches

## Configuration

### Environment Variables

- `GMAIL_BATCH_SIZE`: Number of emails per batch (default: 100)
  ```bash
  GMAIL_BATCH_SIZE=50  # Smaller batches for limited memory
  ```

### Caching

The bulk fetch automatically caches results to improve performance:
- Cache key: Comma-separated message IDs
- Default TTL: 1 hour
- Cache can be cleared manually if needed

## Usage Examples

### Basic Bulk Fetch

```typescript
import { EmailFetcher } from './src/email/EmailFetcher.js';

// Fetch multiple emails
const messageIds = ['msg1', 'msg2', 'msg3'];
const emails = await emailFetcher.getEmailDetailsBulk(messageIds);

emails.forEach(email => {
  console.log(`${email.subject} - ${email.sender}`);
});
```

### Batch Processing Large Sets

```typescript
// Process emails in chunks
const allIds = await emailFetcher.getAllMessageIds('label:important');
const chunkSize = 100;

for (let i = 0; i < allIds.length; i += chunkSize) {
  const chunk = allIds.slice(i, i + chunkSize);
  const emails = await emailFetcher.getEmailDetailsBulk(chunk);
  
  // Process chunk
  await processEmails(emails);
  
  // Small delay to avoid rate limiting
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

### Integration with List Emails

The `listEmails` method automatically uses bulk fetch:

```typescript
const result = await emailFetcher.listEmails({
  category: 'high',
  year: 2024,
  limit: 50,
  offset: 0
});

// Already bulk-fetched with details
result.emails.forEach(email => {
  console.log(email);
});
```

## Performance Considerations

### API Quotas

Gmail API has the following quotas:
- **Daily quota**: 1,000,000,000 quota units
- **Per-user rate limit**: 250 quota units per user per second
- **Cost per operation**:
  - `messages.list`: 5 units
  - `messages.get`: 5 units
  - Batch requests: 1 unit per sub-request

### Optimization Tips

1. **Use appropriate batch sizes**
   - Larger batches (100) for better throughput
   - Smaller batches (20-50) for limited memory

2. **Implement caching**
   - Cache results to avoid redundant API calls
   - Clear cache periodically for fresh data

3. **Handle rate limiting**
   - Add delays between large batch operations
   - Implement exponential backoff for retries

4. **Filter at the source**
   - Use query parameters to reduce result sets
   - Fetch only required metadata headers

## Troubleshooting

### Common Issues

1. **JSON Parse Errors**
   - Check batch response format
   - Verify API endpoint and headers
   - Enable debug logging for response inspection

2. **Rate Limiting**
   - Reduce batch size
   - Add delays between requests
   - Check quota usage in Google Cloud Console

3. **Memory Issues**
   - Process emails in smaller chunks
   - Clear cache more frequently
   - Reduce concurrent operations

### Debug Logging

Enable debug logging to troubleshoot issues:

```typescript
import { logger } from './src/utils/logger.js';

// Set log level to debug
process.env.LOG_LEVEL = 'debug';

// Logs will show:
// - Batch API requests/responses
// - Parse errors with context
// - Cache hits/misses
```

## Best Practices

1. **Always handle errors gracefully**
   ```typescript
   try {
     const emails = await emailFetcher.getEmailDetailsBulk(ids);
   } catch (error) {
     logger.error('Bulk fetch failed:', error);
     // Fallback to individual fetches or retry
   }
   ```

2. **Monitor performance**
   ```typescript
   const start = Date.now();
   const emails = await emailFetcher.getEmailDetailsBulk(ids);
   const duration = Date.now() - start;
   logger.info(`Fetched ${emails.length} emails in ${duration}ms`);
   ```

3. **Use appropriate data structures**
   ```typescript
   // For large sets, use Maps for O(1) lookups
   const emailMap = new Map(emails.map(e => [e.id, e]));
   ```

## See Also

- [Gmail API Batch Documentation](https://developers.google.com/gmail/api/guides/batch)
- [API Quotas and Limits](https://developers.google.com/gmail/api/reference/quota)
- [Example Implementation](../examples/bulk-fetch-emails.ts)