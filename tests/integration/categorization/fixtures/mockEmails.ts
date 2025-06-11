import { EmailIndex, PriorityCategory } from '../../../../src/types/index.js';

// Mock email data for categorization testing
export const mockEmails: EmailIndex[] = [
  // High priority emails
  {
    id: 'email-high-1',
    threadId: 'thread-high-1',
    category: null, // Will be categorized
    subject: 'Urgent: Action Required',
    sender: 'boss@company.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-15'),
    year: 2024,
    size: 150000,
    hasAttachments: true,
    labels: ['INBOX', 'IMPORTANT'],
    snippet: 'Please review the urgent document by EOD...',
    archived: false
  },
  {
    id: 'email-high-2',
    threadId: 'thread-high-2',
    category: null, // Will be categorized
    subject: 'Critical Security Alert',
    sender: 'security@company.com',
    recipients: ['user@example.com'],
    date: new Date('2024-02-20'),
    year: 2024,
    size: 50000,
    hasAttachments: false,
    labels: ['INBOX', 'IMPORTANT'],
    snippet: 'We detected unusual activity on your account...',
    archived: false
  },
  {
    id: 'email-high-3',
    threadId: 'thread-high-3',
    category: null, // Will be categorized
    subject: 'Meeting with Client',
    sender: 'client@client.com', // Important domain
    recipients: ['user@example.com'],
    date: new Date('2024-03-01'),
    year: 2024,
    size: 75000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'Looking forward to our meeting tomorrow...',
    archived: false
  },

  // Medium priority emails
  {
    id: 'email-medium-1',
    threadId: 'thread-medium-1',
    category: null, // Will be categorized
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
    category: null, // Will be categorized
    subject: 'Project Update',
    sender: 'colleague@company.com',
    recipients: ['user@example.com'],
    date: new Date('2023-11-15'),
    year: 2023,
    size: 100000,
    hasAttachments: true,
    labels: ['INBOX'],
    snippet: 'Latest project status attached...',
    archived: false
  },

  // Low priority emails
  {
    id: 'email-low-1',
    threadId: 'thread-low-1',
    category: null, // Will be categorized
    subject: 'Newsletter: March Edition',
    sender: 'newsletter@marketing.com',
    recipients: ['user@example.com'],
    date: new Date('2024-03-15'),
    year: 2024,
    size: 250000,
    hasAttachments: false,
    labels: ['INBOX', 'PROMOTIONS'],
    snippet: 'Check out our latest updates and offers...',
    archived: false
  },
  {
    id: 'email-low-2',
    threadId: 'thread-low-2',
    category: null, // Will be categorized
    subject: 'Special Discount',
    sender: 'noreply@shop.com',
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
    category: null, // Will be categorized
    subject: 'Your Weekly Newsletter',
    sender: 'newsletter@updates.com',
    recipients: ['user@example.com'],
    date: new Date('2022-08-10'),
    year: 2022,
    size: 45000,
    hasAttachments: false,
    labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
    snippet: 'This week\'s top stories and updates...',
    archived: false
  },
  {
    id: 'email-low-4',
    threadId: 'thread-low-4',
    category: null, // Will be categorized
    subject: 'Large Attachment',
    sender: 'automated@system.com',
    recipients: ['user@example.com'],
    date: new Date('2023-05-15'),
    year: 2023,
    size: 2000000, // 2MB
    hasAttachments: true,
    labels: ['INBOX'],
    snippet: 'System generated report attached...',
    archived: false
  }
];

// Expected categorization results
export const expectedCategories = {
  high: mockEmails.slice(0, 2), // Only first two are high with current config
  medium: [mockEmails[2], mockEmails[3], mockEmails[4]], // email-high-3, email-medium-1, email-medium-2
  low: mockEmails.slice(5)
};

// Mock statistics for testing
export const mockStatistics = {
  categories: {
    [PriorityCategory.HIGH]: 3,
    [PriorityCategory.MEDIUM]: 2,
    [PriorityCategory.LOW]: 4,
    total: 9
  },
  years: {
    2022: { count: 1, size: 45000 },
    2023: { count: 3, size: 2280000 },
    2024: { count: 5, size: 600000 }
  },
  sizes: {
    small: 1,
    medium: 7,
    large: 1,
    totalSize: 2925000
  },
  archived: {
    count: 0,
    size: 0
  },
  total: {
    count: 9,
    size: 2925000
  }
};