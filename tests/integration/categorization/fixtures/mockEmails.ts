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

// Expected categorization results based on default configuration
export const expectedCategories = {
  high: mockEmails.slice(0, 5), // First 5 emails match high priority rules (urgent/critical keywords, VIP domains, meeting keywords)
  medium: [] as EmailIndex[], // No emails fall into medium category with current test data
  low: mockEmails.slice(5) // Last 4 emails have promotional/newsletter keywords or labels
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

// Additional test emails for modular architecture testing
export const modularTestEmails: EmailIndex[] = [
  // Test email for ImportanceAnalyzer
  {
    id: 'importance-test-1',
    threadId: 'thread-importance-1',
    category: null,
    subject: 'EMERGENCY: Server down - immediate action required',
    sender: 'admin@company.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-15'),
    year: 2024,
    size: 75000,
    hasAttachments: false,
    labels: ['INBOX', 'IMPORTANT'],
    snippet: 'Critical system failure detected. Please respond ASAP.',
    archived: false
  },
  // Test email for DateSizeAnalyzer
  {
    id: 'datesize-test-1',
    threadId: 'thread-datesize-1',
    category: null,
    subject: 'Large attachment email',
    sender: 'system@automated.com',
    recipients: ['user@example.com'],
    date: new Date(), // Very recent
    year: 2024,
    size: 15000000, // 15MB - large
    hasAttachments: true,
    labels: ['INBOX'],
    snippet: 'System generated report with large attachment.',
    archived: false
  },
  // Test email for LabelClassifier
  {
    id: 'label-test-1',
    threadId: 'thread-label-1',
    category: null,
    subject: 'Special offer - 50% discount!',
    sender: 'noreply@promotions.com',
    recipients: ['user@example.com'],
    date: new Date('2024-02-01'),
    year: 2024,
    size: 120000,
    hasAttachments: false,
    labels: ['INBOX', 'PROMOTIONS', 'CATEGORY_PROMOTIONS'],
    snippet: 'Limited time offer! Save 50% on all items.',
    archived: false
  },
  // Test email for combined analysis
  {
    id: 'combined-test-1',
    threadId: 'thread-combined-1',
    category: null,
    subject: 'Meeting invitation from CEO',
    sender: 'ceo@company.com',
    recipients: ['user@example.com'],
    date: new Date(), // Recent
    year: 2024,
    size: 45000, // Small
    hasAttachments: false,
    labels: ['INBOX', 'IMPORTANT'],
    snippet: 'Please join me for an important strategy meeting.',
    archived: false
  },
  // Test email for spam detection
  {
    id: 'spam-test-1',
    threadId: 'thread-spam-1',
    category: null,
    subject: 'You have won $1,000,000!!!',
    sender: 'scammer@suspicious.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-01'),
    year: 2024,
    size: 25000,
    hasAttachments: false,
    labels: ['SPAM', 'JUNK'],
    snippet: 'Congratulations! Click here to claim your prize.',
    archived: false
  },
  // Test email for social classification
  {
    id: 'social-test-1',
    threadId: 'thread-social-1',
    category: null,
    subject: 'John Doe liked your photo',
    sender: 'notifications@facebook.com',
    recipients: ['user@example.com'],
    date: new Date('2024-01-10'),
    year: 2024,
    size: 30000,
    hasAttachments: false,
    labels: ['INBOX', 'CATEGORY_SOCIAL'],
    snippet: 'John Doe and 5 others liked your recent photo.',
    archived: false
  }
];

// All test emails combined
export const allTestEmails = [...mockEmails, ...modularTestEmails];

// Expected results for modular test emails
export const modularExpectedCategories = {
  'importance-test-1': PriorityCategory.HIGH,
  'datesize-test-1': PriorityCategory.LOW, // Large size penalty
  'label-test-1': PriorityCategory.LOW, // Promotional
  'combined-test-1': PriorityCategory.HIGH, // Important + recent + CEO
  'spam-test-1': PriorityCategory.LOW, // Spam
  'social-test-1': PriorityCategory.LOW // Social/promotional
};