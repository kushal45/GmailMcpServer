import { EmailIndex, EmailMessage } from '../../../../src/types/index.js';

// Mock email data for testing various scenarios
export const mockEmails: EmailIndex[] = [
  // High priority emails (should be protected by default)
  {
    id: 'email-high-1',
    threadId: 'thread-high-1',
    category: 'high',
    subject: 'Important: Contract Review',
    sender: 'ceo@company.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-15'),
    year: 2024,
    size: 150000,
    hasAttachments: true,
    labels: ['INBOX', 'IMPORTANT'],
    snippet: 'Please review the attached contract...',
    archived: false
  },
  {
    id: 'email-high-2',
    threadId: 'thread-high-2',
    category: 'high',
    subject: 'Urgent: Security Alert',
    sender: 'security@company.com',
    recipients: ['user@example.com'],
    date: new Date('2024-02-20'),
    year: 2024,
    size: 50000,
    hasAttachments: false,
    labels: ['INBOX', 'IMPORTANT', 'SECURITY'],
    snippet: 'We detected unusual activity...',
    archived: false
  },
  {
    id: 'email-high-archived',
    threadId: 'thread-high-archived',
    category: 'high',
    subject: 'Archived: Old Contract',
    sender: 'legal@company.com',
    recipients: ['user@example.com'],
    date: new Date('2023-01-10'),
    year: 2023,
    size: 200000,
    hasAttachments: true,
    labels: ['IMPORTANT'],
    snippet: 'Contract from last year...',
    archived: true,
    archiveDate: new Date('2023-12-31'),
    archiveLocation: 'gmail'
  },

  // Medium priority emails
  {
    id: 'email-medium-1',
    threadId: 'thread-medium-1',
    category: 'medium',
    subject: 'Team Meeting Notes',
    sender: 'manager@company.com',
    recipients: ['user@example.com', 'team@company.com'],
    date: new Date('2024-03-01'),
    year: 2024,
    size: 75000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'Here are the notes from today\'s meeting...',
    archived: false
  },
  {
    id: 'email-medium-2',
    threadId: 'thread-medium-2',
    category: 'medium',
    subject: 'Project Update',
    sender: 'colleague@company.com',
    recipients: ['user@example.com'],
    date: new Date('2023-11-15'),
    year: 2023,
    size: 100000,
    hasAttachments: true,
    labels: ['INBOX', 'PROJECT'],
    snippet: 'Latest project status attached...',
    archived: false
  },
  {
    id: 'email-medium-large',
    threadId: 'thread-medium-large',
    category: 'medium',
    subject: 'Large Presentation',
    sender: 'presenter@company.com',
    recipients: ['user@example.com'],
    date: new Date('2023-06-10'),
    year: 2023,
    size: 5000000, // 5MB - large file
    hasAttachments: true,
    labels: ['INBOX'],
    snippet: 'Presentation slides attached...',
    archived: false
  },

  // Low priority emails
  {
    id: 'email-low-1',
    threadId: 'thread-low-1',
    category: 'low',
    subject: 'Newsletter: March Edition',
    sender: 'newsletter@marketing.com',
    recipients: ['user@example.com'],
    date: new Date('2024-03-15'),
    year: 2024,
    size: 250000,
    hasAttachments: false,
    labels: ['INBOX', 'NEWSLETTER'],
    snippet: 'Check out our latest updates...',
    archived: false
  },
  {
    id: 'email-low-2',
    threadId: 'thread-low-2',
    category: 'low',
    subject: 'Promotional Offer',
    sender: 'sales@shop.com',
    recipients: ['user@example.com'],
    date: new Date('2023-12-20'),
    year: 2023,
    size: 180000,
    hasAttachments: false,
    labels: ['INBOX', 'PROMOTIONS'],
    snippet: 'Special discount just for you...',
    archived: false
  },
  {
    id: 'email-low-3',
    threadId: 'thread-low-3',
    category: 'low',
    subject: 'Social Media Update',
    sender: 'notifications@social.com',
    recipients: ['user@example.com'],
    date: new Date('2022-08-10'),
    year: 2022,
    size: 45000,
    hasAttachments: false,
    labels: ['INBOX', 'SOCIAL'],
    snippet: 'You have new followers...',
    archived: false
  },
  {
    id: 'email-low-archived',
    threadId: 'thread-low-archived',
    category: 'low',
    subject: 'Old Newsletter',
    sender: 'newsletter@oldsite.com',
    recipients: ['user@example.com'],
    date: new Date('2022-01-05'),
    year: 2022,
    size: 120000,
    hasAttachments: false,
    labels: ['NEWSLETTER'],
    snippet: 'January 2022 newsletter...',
    archived: true,
    archiveDate: new Date('2022-12-31'),
    archiveLocation: 'gmail'
  },

  // Emails for size testing
  {
    id: 'email-small',
    threadId: 'thread-small',
    category: 'low',
    subject: 'Quick Note',
    sender: 'friend@example.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-01'),
    year: 2024,
    size: 5000, // 5KB - small
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'Hey, just a quick note...',
    archived: false
  },
  {
    id: 'email-medium-size',
    threadId: 'thread-medium-size',
    category: 'medium',
    subject: 'Document Review',
    sender: 'reviewer@company.com',
    recipients: ['user@example.com'],
    date: new Date('2024-02-01'),
    year: 2024,
    size: 500000, // 500KB - medium size
    hasAttachments: true,
    labels: ['INBOX'],
    snippet: 'Please review the attached document...',
    archived: false
  },
  {
    id: 'email-very-large',
    threadId: 'thread-very-large',
    category: 'low',
    subject: 'Video Recording',
    sender: 'video@company.com',
    recipients: ['user@example.com'],
    date: new Date('2023-09-15'),
    year: 2023,
    size: 10000000, // 10MB - very large
    hasAttachments: true,
    labels: ['INBOX'],
    snippet: 'Recording of the webinar...',
    archived: false
  }
];

// Mock Gmail API message format for testing
export const mockGmailMessages: Partial<EmailMessage>[] = mockEmails.map(email => ({
  id: email.id,
  threadId: email.threadId,
  labelIds: email.labels,
  snippet: email.snippet,
  sizeEstimate: email.size,
  internalDate: email.date.getTime().toString(),
  payload: {
    headers: [
      { name: 'Subject', value: email.subject },
      { name: 'From', value: email.sender },
      { name: 'To', value: email.recipients.join(', ') },
      { name: 'Date', value: email.date.toISOString() }
    ]
  }
}));

// Helper to get emails by criteria
export function getEmailsByCriteria(criteria: {
  category?: 'high' | 'medium' | 'low';
  year?: number;
  archived?: boolean;
  sizeThreshold?: number;
  ids?: string[];
}): EmailIndex[] {
  return mockEmails.filter(email => {
    if (criteria.category && email.category !== criteria.category) return false;
    if (criteria.year && email.year !== criteria.year) return false;
    if (criteria.archived !== undefined && email.archived !== criteria.archived) return false;
    if (criteria.sizeThreshold && email.size < criteria.sizeThreshold) return false;
    if (criteria.ids && !criteria.ids.includes(email.id)) return false;
    return true;
  });
}

// Get email IDs for batch testing
export const batchTestEmailIds = {
  // First batch (50 emails)
  firstBatch: Array.from({ length: 50 }, (_, i) => `batch-email-${i + 1}`),
  // Second batch (30 emails)
  secondBatch: Array.from({ length: 30 }, (_, i) => `batch-email-${i + 51}`),
  // Large batch for testing limits
  largeBatch: Array.from({ length: 150 }, (_, i) => `large-batch-email-${i + 1}`)
};

// Create mock emails for batch testing
export const batchTestEmails: EmailIndex[] = [
  ...batchTestEmailIds.firstBatch.map((id, index) => ({
    id,
    threadId: `thread-${id}`,
    category: 'low' as const,
    subject: `Batch Test Email ${index + 1}`,
    sender: 'batch@test.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-01'),
    year: 2024,
    size: 10000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: `This is batch test email ${index + 1}`,
    archived: false
  })),
  ...batchTestEmailIds.secondBatch.map((id, index) => ({
    id,
    threadId: `thread-${id}`,
    category: 'low' as const,
    subject: `Batch Test Email ${index + 51}`,
    sender: 'batch@test.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-02'),
    year: 2024,
    size: 10000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: `This is batch test email ${index + 51}`,
    archived: false
  }))
];

// Mock emails for error scenarios
export const errorScenarioEmails = {
  // Email that will fail to delete (simulate permission error)
  permissionDenied: {
    id: 'email-permission-denied',
    threadId: 'thread-permission-denied',
    category: 'low' as const,
    subject: 'Permission Test',
    sender: 'admin@protected.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-01'),
    year: 2024,
    size: 10000,
    hasAttachments: false,
    labels: ['INBOX', 'PROTECTED'],
    snippet: 'This email cannot be deleted',
    archived: false
  },
  
  // Already deleted email
  alreadyDeleted: {
    id: 'email-already-deleted',
    threadId: 'thread-already-deleted',
    category: 'low' as const,
    subject: 'Already Deleted',
    sender: 'test@example.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-01'),
    year: 2024,
    size: 10000,
    hasAttachments: false,
    labels: ['TRASH'],
    snippet: 'This email is already in trash',
    archived: false
  },
  
  // Invalid email ID
  invalidId: {
    id: 'invalid-email-id-!@#$%',
    threadId: 'invalid-thread',
    category: 'low' as const,
    subject: 'Invalid ID Test',
    sender: 'test@example.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-01'),
    year: 2024,
    size: 10000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'This email has an invalid ID',
    archived: false
  }
};

// Statistics for testing getDeleteStatistics
export const mockStatistics = {
  byCategory: {
    high: mockEmails.filter(e => e.category === 'high' && !e.archived).length,
    medium: mockEmails.filter(e => e.category === 'medium' && !e.archived).length,
    low: mockEmails.filter(e => e.category === 'low' && !e.archived).length
  },
  byYear: mockEmails.reduce((acc, email) => {
    if (!email.archived) {
      acc[email.year] = (acc[email.year] || 0) + 1;
    }
    return acc;
  }, {} as Record<number, number>),
  bySize: {
    small: mockEmails.filter(e => !e.archived && e.size < 102400).length,
    medium: mockEmails.filter(e => !e.archived && e.size >= 102400 && e.size < 1048576).length,
    large: mockEmails.filter(e => !e.archived && e.size >= 1048576).length
  },
  total: mockEmails.filter(e => !e.archived).length
};

// Trash emails for emptyTrash testing
export const trashEmails = [
  { id: 'trash-1', threadId: 'thread-trash-1' },
  { id: 'trash-2', threadId: 'thread-trash-2' },
  { id: 'trash-3', threadId: 'thread-trash-3' },
  { id: 'trash-4', threadId: 'thread-trash-4' },
  { id: 'trash-5', threadId: 'thread-trash-5' }
];