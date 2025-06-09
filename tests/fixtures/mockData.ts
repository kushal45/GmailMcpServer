import { EmailMessage, EmailIndex, SearchCriteria, ArchiveRule, SavedSearch } from '../../src/types';

export const mockEmailMessage: EmailMessage = {
  id: 'test-email-1',
  threadId: 'test-thread-1',
  labelIds: ['INBOX', 'UNREAD'],
  snippet: 'This is a test email snippet',
  payload: {
    headers: [
      { name: 'From', value: 'sender@example.com' },
      { name: 'To', value: 'recipient@example.com' },
      { name: 'Subject', value: 'Test Email Subject' },
      { name: 'Date', value: 'Mon, 1 Jan 2024 12:00:00 +0000' }
    ],
    body: {
      size: 1024,
      data: 'VGhpcyBpcyBhIHRlc3QgZW1haWwgYm9keQ=='
    }
  },
  sizeEstimate: 1024,
  historyId: '12345',
  internalDate: '1704110400000'
};

export const mockEmailIndex: EmailIndex = {
  id: 'test-email-1',
  threadId: 'test-thread-1',
  category: 'medium',
  subject: 'Test Email Subject',
  sender: 'sender@example.com',
  recipients: ['recipient@example.com'],
  date: new Date('2024-01-01T12:00:00Z'),
  year: 2024,
  size: 1024,
  hasAttachments: false,
  labels: ['INBOX', 'UNREAD'],
  snippet: 'This is a test email snippet',
  archived: false
};

export const mockSearchCriteria: SearchCriteria = {
  query: 'test',
  category: 'medium',
  yearRange: { start: 2023, end: 2024 },
  sizeRange: { min: 100, max: 10000 },
  sender: 'sender@example.com',
  hasAttachments: false,
  archived: false,
  labels: ['INBOX']
};

export const mockArchiveRule: ArchiveRule = {
  id: 'rule-1',
  name: 'Archive old emails',
  criteria: {
    category: 'low',
    olderThanDays: 90,
    sizeGreaterThan: 1000000
  },
  action: {
    method: 'gmail',
    exportFormat: 'mbox'
  },
  schedule: 'weekly',
  enabled: true,
  created: new Date('2024-01-01'),
  lastRun: new Date('2024-01-08'),
  stats: {
    totalArchived: 100,
    lastArchived: 10
  }
};

export const mockSavedSearch: SavedSearch = {
  id: 'search-1',
  name: 'Important emails',
  criteria: {
    category: 'high',
    yearRange: { start: 2024 }
  },
  created: new Date('2024-01-01'),
  lastUsed: new Date('2024-01-10'),
  resultCount: 25
};

export const mockGmailListResponse = {
  data: {
    messages: [
      { id: 'test-email-1', threadId: 'test-thread-1' },
      { id: 'test-email-2', threadId: 'test-thread-2' },
      { id: 'test-email-3', threadId: 'test-thread-3' }
    ],
    nextPageToken: 'next-page-token',
    resultSizeEstimate: 100
  }
};

export const mockGmailGetResponse = {
  data: mockEmailMessage
};

export const mockTokens = {
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  scope: 'https://www.googleapis.com/auth/gmail.readonly',
  token_type: 'Bearer',
  expiry_date: Date.now() + 3600000 // 1 hour from now
};

export const mockCredentials = {
  installed: {
    client_id: 'mock-client-id',
    client_secret: 'mock-client-secret',
    redirect_uris: ['http://localhost:3000/oauth2callback']
  }
};

export const createMockEmails = (count: number): EmailIndex[] => {
  const emails: EmailIndex[] = [];
  for (let i = 0; i < count; i++) {
    emails.push({
      ...mockEmailIndex,
      id: `test-email-${i}`,
      threadId: `test-thread-${i}`,
      subject: `Test Email ${i}`,
      date: new Date(Date.now() - i * 86400000), // Each email 1 day older
      year: new Date(Date.now() - i * 86400000).getFullYear()
    });
  }
  return emails;
};