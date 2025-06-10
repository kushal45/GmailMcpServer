/**
 * Mock Gmail API responses for testing
 */

export const mockGmailMessages = {
  // Simple message with minimal fields
  simple: {
    id: 'simple-message',
    threadId: 'simple-thread',
    labelIds: ['INBOX'],
    snippet: 'This is a simple test message',
    sizeEstimate: 5000,
    internalDate: '1640995200000', // 2022-01-01
    payload: {
      headers: [
        { name: 'Subject', value: 'Simple Test' },
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Date', value: 'Sat, 01 Jan 2022 12:00:00 +0000' }
      ]
    }
  },
  
  // Message with attachments
  withAttachment: {
    id: 'attachment-message',
    threadId: 'attachment-thread',
    labelIds: ['INBOX'],
    snippet: 'This message has an attachment',
    sizeEstimate: 150000,
    internalDate: '1641081600000', // 2022-01-02
    payload: {
      headers: [
        { name: 'Subject', value: 'Message with Attachment' },
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Date', value: 'Sun, 02 Jan 2022 12:00:00 +0000' }
      ],
      parts: [
        {
          mimeType: 'text/plain',
          body: {
            size: 100,
            data: 'SGVsbG8gd29ybGQ=' // "Hello world" in base64
          }
        },
        {
          mimeType: 'application/pdf',
          filename: 'document.pdf',
          body: {
            size: 10000,
            attachmentId: 'attachment-id-123'
          }
        }
      ]
    }
  },
  
  // Message with nested parts
  withNestedParts: {
    id: 'nested-message',
    threadId: 'nested-thread',
    labelIds: ['INBOX'],
    snippet: 'This message has nested parts',
    sizeEstimate: 200000,
    internalDate: '1641168000000', // 2022-01-03
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'Subject', value: 'Message with Nested Parts' },
        { name: 'From', value: 'sender@example.com' },
        { name: 'To', value: 'recipient@example.com' },
        { name: 'Date', value: 'Mon, 03 Jan 2022 12:00:00 +0000' }
      ],
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: {
                size: 200,
                data: 'SGVsbG8gd29ybGQgaW4gcGxhaW4gdGV4dA==' // "Hello world in plain text" in base64
              }
            },
            {
              mimeType: 'text/html',
              body: {
                size: 300,
                data: 'PGgxPkhlbGxvIHdvcmxkIGluIEhUTUw8L2gxPg==' // "<h1>Hello world in HTML</h1>" in base64
              }
            }
          ]
        },
        {
          mimeType: 'application/pdf',
          filename: 'document.pdf',
          body: {
            size: 20000,
            attachmentId: 'attachment-id-456'
          }
        }
      ]
    }
  },
  
  // Message with missing fields
  incomplete: {
    id: 'incomplete-message',
    threadId: 'incomplete-thread',
    snippet: 'This message has missing fields',
    payload: {
      headers: [
        { name: 'Subject', value: 'Incomplete Message' }
        // Missing From, To, Date
      ]
    }
    // Missing labelIds, sizeEstimate, internalDate
  },
  
  // Message with malformed payload
  malformed: {
    id: 'malformed-message',
    threadId: 'malformed-thread',
    labelIds: ['INBOX'],
    snippet: 'This message has a malformed payload',
    sizeEstimate: 1000,
    internalDate: '1641254400000', // 2022-01-04
    payload: {
      // Missing headers
      parts: 'not-an-array' // Invalid parts
    }
  }
};

export const mockListResponse = {
  // Normal response with messages
  normal: {
    data: {
      messages: [
        { id: 'message-1', threadId: 'thread-1' },
        { id: 'message-2', threadId: 'thread-2' },
        { id: 'message-3', threadId: 'thread-3' }
      ],
      nextPageToken: 'next-page-token',
      resultSizeEstimate: 3
    }
  },
  
  // Empty response
  empty: {
    data: {
      messages: [],
      resultSizeEstimate: 0
    }
  },
  
  // Malformed response
  malformed: {
    data: {
      // Missing messages array
      resultSizeEstimate: 0
    }
  }
};