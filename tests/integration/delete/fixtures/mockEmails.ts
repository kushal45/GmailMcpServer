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
  internalDate: email.date?.getTime().toString() || Date.now().toString(),
  payload: {
    headers: [
      { name: 'Subject', value: email.subject || '' },
      { name: 'From', value: email.sender || '' },
      { name: 'To', value: email.recipients?.join(', ') || '' },
      { name: 'Date', value: email.date?.toISOString() || new Date().toISOString() }
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
    if (criteria.sizeThreshold && email.size && email.size < criteria.sizeThreshold) return false;
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
    if (!email.archived && email.year) {
      acc[email.year] = (acc[email.year] || 0) + 1;
    }
    return acc;
  }, {} as Record<number, number>),
  bySize: {
    small: mockEmails.filter(e => !e.archived && e.size && e.size < 102400).length,
    medium: mockEmails.filter(e => !e.archived && e.size && e.size >= 102400 && e.size < 1048576).length,
    large: mockEmails.filter(e => !e.archived && e.size && e.size >= 1048576).length
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

// ========================
// Cleanup System Test Emails
// ========================

// Test emails for cleanup integration scenarios
export const cleanupTestEmails: EmailIndex[] = [
  // Old, low importance emails that should be candidates for cleanup
  {
    id: 'cleanup-old-low-1',
    threadId: 'thread-cleanup-old-low-1',
    category: 'low',
    subject: 'Old Newsletter',
    sender: 'newsletter@oldcompany.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
    year: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 25000,
    hasAttachments: false,
    labels: ['INBOX', 'NEWSLETTER'],
    snippet: 'Check out our latest updates...',
    archived: false,
    spam_score: 0.4, // Spam score for cleanup filtering
    promotional_score: 0.8, // Promotional score for cleanup filtering
    importanceScore: 2
  },
  {
    id: 'cleanup-old-low-2',
    threadId: 'thread-cleanup-old-low-2',
    category: 'low',
    subject: 'Promotional Sale - Expired',
    sender: 'sales@marketplace.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
    year: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 45000,
    hasAttachments: false,
    labels: ['INBOX', 'PROMOTIONS'],
    snippet: 'Limited time offer - expires soon!',
    archived: false,
    spam_score: 0.7, // Higher spam score for promotional content
    promotional_score: 0.9,
    importanceScore: 1
  },
  // Medium priority emails with mixed cleanup eligibility
  {
    id: 'cleanup-medium-mixed-1',
    threadId: 'thread-cleanup-medium-mixed-1',
    category: 'medium',
    subject: 'Team Meeting Notes',
    sender: 'team@company.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
    year: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 150000,
    hasAttachments: true,
    labels: ['INBOX', 'WORK'],
    snippet: 'Summary of team meeting discussions...',
    archived: false,
    spam_score: 0.1, // Keep low - should be protected by importance
    promotional_score: 0.1,
    importanceScore: 5
  },
  // Large, old emails that consume storage - make deletable
  {
    id: 'cleanup-large-old-1',
    threadId: 'thread-cleanup-large-old-1',
    category: 'low', // Change to low priority to make it deletable
    subject: 'Webinar Recording',
    sender: 'events@company.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
    year: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 25000000, // 25MB
    hasAttachments: true,
    labels: ['INBOX'],
    snippet: 'Recording of the annual webinar event...',
    archived: false,
    spam_score: 0.3, // Increased for cleanup eligibility
    promotional_score: 0.6, // Increased to meet promotional_score_min
    importanceScore: 3
  },
  // Spam-like emails
  {
    id: 'cleanup-spam-1',
    threadId: 'thread-cleanup-spam-1',
    category: 'low',
    subject: 'Congratulations! You have won!',
    sender: 'winner@suspicious.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 days ago
    year: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 15000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'Click here to claim your prize...',
    archived: false,
    spam_score: 0.95,
    promotional_score: 0.7,
    importanceScore: -2,
    spamIndicators: ['suspicious_links', 'winner_language', 'urgent_action']
  }
];

// Safety test emails that should NOT be deleted
export const cleanupSafetyTestEmails: EmailIndex[] = [
  // High importance emails
  {
    id: 'safety-high-1',
    threadId: 'thread-safety-high-1',
    category: 'high',
    subject: 'Contract Signature Required - URGENT',
    sender: 'legal@company.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days ago but high importance
    year: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 250000,
    hasAttachments: true,
    labels: ['INBOX', 'IMPORTANT'],
    snippet: 'Please review and sign the attached contract...',
    archived: false,
    spam_score: 0.0,
    promotional_score: 0.0,
    importanceScore: 9,
    importanceLevel: 'high'
  },
  // Very recent emails (less than 7 days)
  {
    id: 'safety-recent-1',
    threadId: 'thread-safety-recent-1',
    category: 'medium',
    subject: 'Today\'s Meeting Agenda',
    sender: 'assistant@company.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    year: new Date().getFullYear(),
    size: 50000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'Agenda for today\'s 2 PM meeting...',
    archived: false,
    spam_score: 0.0,
    promotional_score: 0.0,
    importanceScore: 6
  },
  // High importance score emails
  {
    id: 'safety-high-score-1',
    threadId: 'thread-safety-high-score-1',
    category: 'medium',
    subject: 'Security Alert: Login from New Device',
    sender: 'security@company.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000), // 50 days ago but high importance score
    year: new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 35000,
    hasAttachments: false,
    labels: ['INBOX', 'SECURITY'],
    snippet: 'We detected a login from a new device...',
    archived: false,
    spam_score: 0.0,
    promotional_score: 0.0,
    importanceScore: 8.5
  }
];

// Edge case emails for testing boundary conditions
export const cleanupEdgeCaseEmails: EmailIndex[] = [
  // Email without date
  {
    id: 'edge-no-date-1',
    threadId: 'thread-edge-no-date-1',
    category: 'low',
    subject: 'Email Without Date',
    sender: 'noreply@example.com',
    recipients: ['user@example.com'],
    // date: undefined,
    size: 10000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'This email has no date field...',
    archived: false
  },
  // Email without size
  {
    id: 'edge-no-size-1',
    threadId: 'thread-edge-no-size-1',
    category: 'medium',
    subject: 'Email Without Size',
    sender: 'noreply@example.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 75 * 24 * 60 * 60 * 1000), // 75 days ago
    year: new Date(Date.now() - 75 * 24 * 60 * 60 * 1000).getFullYear(),
    // size: undefined,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'This email has no size field...',
    archived: false
  },
  // Email with null category
  {
    id: 'edge-null-category-1',
    threadId: 'thread-edge-null-category-1',
    category: null,
    subject: 'Email With Null Category',
    sender: 'uncategorized@example.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000), // 40 days ago
    year: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 20000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'This email has null category...',
    archived: false
  },
  // Email with conflicting importance indicators
  {
    id: 'edge-conflicting-1',
    threadId: 'thread-edge-conflicting-1',
    category: 'low',
    subject: 'Conflicting Importance Signals',
    sender: 'mixed@example.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000), // 80 days ago
    year: new Date(Date.now() - 80 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 75000,
    hasAttachments: true,
    labels: ['INBOX', 'IMPORTANT'],
    snippet: 'This email has conflicting signals...',
    archived: false,
    spam_score: 0.8, // High spam score
    promotional_score: 0.9, // High promotional score
    importanceScore: 9, // But high importance score
    importanceLevel: 'high' // And high importance level
  },
  // Very large emai
  {
    id: 'edge-very-large-1',
    threadId: 'thread-edge-very-large-1',
    category: 'low',
    subject: 'Extremely Large Email',
    sender: 'bulk@example.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000), // 150 days ago
    year: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).getFullYear(),
    size: 50000000, // 50MB
    hasAttachments: true,
    labels: ['INBOX'],
    snippet: 'This email contains very large attachments...',
    archived: false,
    spam_score: 0.3,
    promotional_score: 0.4,
    importanceScore: 1
  }
];

// Performance test emails for stress testing
export const performanceTestEmails: EmailIndex[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `perf-${i}`,
  threadId: `thread-perf-${i}`,
  category: (i % 3 === 0 ? 'low' : i % 3 === 1 ? 'medium' : 'high') as any,
  subject: `Performance Test Email ${i}`,
  sender: `sender${i % 10}@example.com`,
  recipients: ['user@example.com'],
  date: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000), // Random date within last year
  year: 2023 + Math.floor(Math.random() * 2), // 2023 or 2024
  size: Math.floor(Math.random() * 1000000) + 10000, // 10KB to 1MB
  hasAttachments: Math.random() > 0.7,
  labels: ['INBOX'],
  snippet: `Performance test email content ${i}`,
  archived: false,
  spam_score: Math.random() * 0.5, // 0-0.5
  promotional_score: Math.random() * 0.8, // 0-0.8
  importanceScore: Math.random() * 10 // 0-10
}));