import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CleanupPolicyEngine } from '../../../src/cleanup/CleanupPolicyEngine.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { AccessPatternTracker } from '../../../src/cleanup/AccessPatternTracker.js';
import { CleanupPolicy, EmailIndex, StalenessScore } from '../../../src/types/index.js';

describe('CleanupPolicyEngine', () => {
  let policyEngine: CleanupPolicyEngine;
  let mockDatabaseManager: any;
  let mockStalenessScorer: any;
  let mockAccessTracker: any;

  beforeEach(() => {
    // Mock DatabaseManager
    mockDatabaseManager = {
      createCleanupPolicy: jest.fn<() => Promise<string>>().mockResolvedValue('policy-123'),
      updateCleanupPolicy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
      deleteCleanupPolicy: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void),
      getCleanupPolicy: jest.fn<() => Promise<CleanupPolicy | null>>().mockResolvedValue(null),
      getActivePolicies: jest.fn<() => Promise<CleanupPolicy[]>>().mockResolvedValue([]),
      getAllPolicies: jest.fn<() => Promise<CleanupPolicy[]>>().mockResolvedValue([]),
      getEmailsForCleanup: jest.fn<() => Promise<EmailIndex[]>>().mockResolvedValue([]),
      searchEmails: jest.fn<() => Promise<EmailIndex[]>>().mockResolvedValue([]),
      // Add database reset functionality
      resetDatabase: jest.fn<() => Promise<void>>().mockResolvedValue(undefined as void)
    };

    // Mock StalenessScorer
    mockStalenessScorer = {
      calculateStaleness: jest.fn<() => Promise<StalenessScore>>().mockResolvedValue({
        email_id: 'test-email',
        total_score: 0.5,
        factors: {
          age_score: 0.4,
          importance_score: 0.5,
          size_penalty: 0.3,
          spam_score: 0.2,
          access_score: 0.6
        },
        recommendation: 'archive',
        confidence: 0.8
      })
    };

    // Mock AccessPatternTracker
    mockAccessTracker = {
      getInstance: jest.fn().mockReturnValue(mockAccessTracker)
    };

    // Mock static method calls
    jest.spyOn(DatabaseManager, 'getInstance').mockReturnValue(mockDatabaseManager);
    jest.spyOn(AccessPatternTracker, 'getInstance').mockReturnValue(mockAccessTracker);
    
    // Reset all singleton instances to prevent state sharing
    (DatabaseManager as any).instance = null;
    (AccessPatternTracker as any).instance = null;
    (CleanupPolicyEngine as any).instance = null;
    
    policyEngine = new CleanupPolicyEngine(mockDatabaseManager, mockStalenessScorer, mockAccessTracker);
  });

  afterEach(async () => {
    // Reset database state if the mock supports it
    if (mockDatabaseManager.resetDatabase) {
      await mockDatabaseManager.resetDatabase();
    }
    
    jest.restoreAllMocks();
    jest.clearAllMocks();
    
    // Reset all singleton instances
    (DatabaseManager as any).instance = null;
    (AccessPatternTracker as any).instance = null;
    (CleanupPolicyEngine as any).instance = null;
  });

  describe('Policy CRUD Operations', () => {
    test('should create a new cleanup policy successfully', async () => {
      const policyData = {
        name: 'Test Spam Cleanup',
        description: 'Remove spam emails older than 30 days',
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'low' as const,
          spam_score_min: 0.7
        },
        action: {
          type: 'delete' as const,
          method: 'gmail' as const
        },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily' as const,
          time: '02:00',
          enabled: true
        }
      };

      const policyId = await policyEngine.createPolicy(policyData);

      expect(policyId).toBe('policy-123');
      expect(mockDatabaseManager.createCleanupPolicy).toHaveBeenCalledWith(policyData);
    });

    test('should reject invalid policy during creation', async () => {
      const invalidPolicy = {
        name: '', // Invalid: empty name
        
        enabled: true,
        priority: 150, // Invalid: priority > 100
        criteria: {
          age_days_min: -5, // Invalid: negative age
          importance_level_max: 'medium' as const
        },
        action: {
          type: 'invalid' as any, // Invalid action type
          method: 'gmail' as const
        },
        safety: {
          max_emails_per_run: 0, // Invalid: must be at least 1
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'invalid' as any, // Invalid frequency
          time: '25:00', // Invalid time format
          enabled: true
        }
      };

      await expect(policyEngine.createPolicy(invalidPolicy)).rejects.toThrow('Invalid policy');
    });

    test('should update an existing policy successfully', async () => {
      const existingPolicy: CleanupPolicy = {
        id: 'policy-123',
        name: 'Existing Policy',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium'
        },
        action: {
          type: 'archive',
          method: 'gmail'
        },
        safety: {
          max_emails_per_run: 50,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getCleanupPolicy.mockResolvedValue(existingPolicy);

      const updates = {
        name: 'Updated Policy Name',
        priority: 20
      };

      await policyEngine.updatePolicy('policy-123', updates);

      expect(mockDatabaseManager.getCleanupPolicy).toHaveBeenCalledWith('policy-123');
      expect(mockDatabaseManager.updateCleanupPolicy).toHaveBeenCalledWith('policy-123', updates);
    });

    test('should reject updates to non-existent policy', async () => {
      mockDatabaseManager.getCleanupPolicy.mockResolvedValue(null);

      await expect(policyEngine.updatePolicy('non-existent', { name: 'Updated' }))
        .rejects.toThrow('Policy not found: non-existent');
    });

    test('should delete a policy successfully', async () => {
      await policyEngine.deletePolicy('policy-123');

      expect(mockDatabaseManager.deleteCleanupPolicy).toHaveBeenCalledWith('policy-123');
    });

    test('should get active policies', async () => {
      const activePolicies: CleanupPolicy[] = [
        {
          id: 'policy-1',
          name: 'Active Policy 1',
          
          enabled: true,
          priority: 10,
          criteria: {
            age_days_min: 30,
            importance_level_max: 'medium'
          },
          action: { type: 'archive', method: 'gmail' },
          safety: {
            max_emails_per_run: 50,
            require_confirmation: false,
            dry_run_first: false,
            preserve_important: true
          },
          schedule: {
            frequency: 'daily',
            time: '02:00',
            enabled: true
          },
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      mockDatabaseManager.getActivePolicies.mockResolvedValue(activePolicies);

      const result = await policyEngine.getActivePolicies();

      expect(result).toEqual(activePolicies);
      expect(mockDatabaseManager.getActivePolicies).toHaveBeenCalled();
    });

    test('should get all policies', async () => {
      const allPolicies: CleanupPolicy[] = [
        {
          id: 'policy-1',
          name: 'Policy 1',
          
          enabled: true,
          priority: 10,
          criteria: {
            age_days_min: 30,
            importance_level_max: 'medium'
          },
          action: { type: 'archive', method: 'gmail' },
          safety: {
            max_emails_per_run: 50,
            require_confirmation: false,
            dry_run_first: false,
            preserve_important: true
          },
          schedule: {
            frequency: 'daily',
            time: '02:00',
            enabled: true
          },
          created_at: new Date(),
          updated_at: new Date()
        },
        {
          id: 'policy-2',
          name: 'Policy 2',
          
          enabled: false,
          priority: 5,
          criteria: {
            age_days_min: 60,
            importance_level_max: 'low'
          },
          action: { type: 'delete', method: 'gmail' },
          safety: {
            max_emails_per_run: 25,
            require_confirmation: true,
            dry_run_first: true,
            preserve_important: true
          },
          schedule: {
            frequency: 'weekly',
            time: '03:00',
            enabled: false
          },
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      mockDatabaseManager.getAllPolicies.mockResolvedValue(allPolicies);

      const result = await policyEngine.getAllPolicies();

      expect(result).toEqual(allPolicies);
      expect(mockDatabaseManager.getAllPolicies).toHaveBeenCalled();
    });

    test('should get specific policy', async () => {
      const policy: CleanupPolicy = {
        id: 'policy-123',
        name: 'Specific Policy',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium'
        },
        action: { type: 'archive', method: 'gmail' },
        safety: {
          max_emails_per_run: 50,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getCleanupPolicy.mockResolvedValue(policy);

      const result = await policyEngine.getPolicy('policy-123');

      expect(result).toEqual(policy);
      expect(mockDatabaseManager.getCleanupPolicy).toHaveBeenCalledWith('policy-123');
    });
  });

  describe('Email Evaluation for Cleanup', () => {
    test('should evaluate emails for cleanup successfully', async () => {
      const testEmails: EmailIndex[] = [
        {
          id: 'email-1',
          date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
          size: 1024,
          category: 'low',
          spam_score: 0.8,
          subject: 'Spam Email',
          sender: 'spam@example.com'
        },
        {
          id: 'email-2',
          date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
          size: 512,
          category: 'high',
          subject: 'Important Email',
          sender: 'important@example.com'
        }
      ];

      const activePolicies: CleanupPolicy[] = [
        {
          id: 'spam-policy',
          name: 'Spam Cleanup',
          
          enabled: true,
          priority: 10,
          criteria: {
            age_days_min: 30,
            importance_level_max: 'low',
            spam_score_min: 0.7
          },
          action: { type: 'delete', method: 'gmail' },
          safety: {
            max_emails_per_run: 100,
            require_confirmation: false,
            dry_run_first: false,
            preserve_important: true
          },
          schedule: {
            frequency: 'daily',
            time: '02:00',
            enabled: true
          },
          created_at: new Date(),
          updated_at: new Date()
        }
      ];

      mockDatabaseManager.getActivePolicies.mockResolvedValue(activePolicies);
      
      // Mock staleness scores
      mockStalenessScorer.calculateStaleness
        .mockResolvedValueOnce({
          email_id: 'email-1',
          total_score: 0.8,
          factors: { age_score: 0.6, importance_score: 0.8, size_penalty: 0.1, spam_score: 0.8, access_score: 0.7 },
          recommendation: 'delete',
          confidence: 0.9
        })
        .mockResolvedValueOnce({
          email_id: 'email-2',
          total_score: 0.2,
          factors: { age_score: 0.1, importance_score: 0.1, size_penalty: 0.1, spam_score: 0.1, access_score: 0.3 },
          recommendation: 'keep',
          confidence: 0.8
        });

      const result = await policyEngine.evaluateEmailsForCleanup(testEmails);

      expect(result.cleanup_candidates).toHaveLength(1);
      expect(result.cleanup_candidates[0].email.id).toBe('email-1');
      expect(result.cleanup_candidates[0].policy.id).toBe('spam-policy');
      expect(result.cleanup_candidates[0].recommended_action).toBe('delete');

      expect(result.protected_emails).toHaveLength(1);
      expect(result.protected_emails[0].email.id).toBe('email-2');
      expect(result.protected_emails[0].reason).toContain('recent');

      expect(result.evaluation_summary).toEqual({
        total_emails: 2,
        candidates_count: 1,
        protected_count: 1,
        policies_applied: 1
      });
    });

    test('should protect high importance emails', async () => {
      const importantEmail: EmailIndex = {
        id: 'important-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
        size: 1024,
        category: 'high',
        importanceLevel: 'high',
        subject: 'Very Important Email',
        sender: 'ceo@company.com'
      };

      const aggressivePolicy: CleanupPolicy = {
        id: 'aggressive-policy',
        name: 'Aggressive Cleanup',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium'
        },
        action: { type: 'delete', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getActivePolicies.mockResolvedValue([aggressivePolicy]);

      const result = await policyEngine.evaluateEmailsForCleanup([importantEmail]);

      expect(result.cleanup_candidates).toHaveLength(0);
      expect(result.protected_emails).toHaveLength(1);
      expect(result.protected_emails[0].reason).toContain('important emails');
    });

    test('should protect very recent emails', async () => {
      const recentEmail: EmailIndex = {
        id: 'recent-email',
        date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        size: 1024,
        category: 'low',
        spam_score: 0.9,
        subject: 'Recent Spam',
        sender: 'spam@example.com'
      };

      const spamPolicy: CleanupPolicy = {
        id: 'spam-policy',
        name: 'Spam Cleanup',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 1, // Very low threshold
          importance_level_max: 'low',
          spam_score_min: 0.8
        },
        action: { type: 'delete', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getActivePolicies.mockResolvedValue([spamPolicy]);

      const result = await policyEngine.evaluateEmailsForCleanup([recentEmail]);

      expect(result.cleanup_candidates).toHaveLength(0);
      expect(result.protected_emails).toHaveLength(1);
      expect(result.protected_emails[0].reason).toContain('too recent');
    });

    test('should handle large email batches efficiently', async () => {
      const largeEmailBatch: EmailIndex[] = Array.from({ length: 250 }, (_, i) => ({
        id: `email-${i}`,
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        size: 1024,
        category: 'low',
        subject: `Email ${i}`,
        sender: `test${i}@example.com`
      }));

      mockDatabaseManager.getActivePolicies.mockResolvedValue([]);

      const result = await policyEngine.evaluateEmailsForCleanup(largeEmailBatch);

      expect(result.evaluation_summary.total_emails).toBe(250);
      expect(mockStalenessScorer.calculateStaleness).toHaveBeenCalledTimes(250);
    });
  });

  describe('Policy Validation', () => {
    test('should validate valid policy', () => {
      const validPolicy = {
        name: 'Valid Policy',
        
        enabled: true,
        priority: 50,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium' as const,
          spam_score_min: 0.5,
          promotional_score_min: 0.6,
          access_score_max: 0.8,
          no_access_days: 90,
          size_threshold_min: 1024
        },
        action: {
          type: 'archive' as const,
          method: 'gmail' as const,
          export_format: 'mbox' as const
        },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'weekly' as const,
          time: '14:30',
          enabled: true
        }
      };

      const validation = policyEngine.validatePolicy(validPolicy);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    test('should reject policy with invalid name', () => {
      const invalidPolicy = {
        name: '', // Empty name
        priority: 10
      };

      const validation = policyEngine.validatePolicy(invalidPolicy);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Policy name is required');
    });

    test('should reject policy with invalid priority', () => {
      const invalidPolicy = {
        name: 'Test Policy',
        priority: 150 // Priority > 100
      };

      const validation = policyEngine.validatePolicy(invalidPolicy);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Policy priority must be between 0 and 100');
    });

    test('should reject policy with invalid criteria values', () => {
      const invalidPolicy = {
        name: 'Test Policy',
        criteria: {
          age_days_min: -5, // Negative age
          importance_level_max: 'medium' as const,
          size_threshold_min: -100, // Negative size
          spam_score_min: 1.5, // Score > 1
          promotional_score_min: -0.5, // Score < 0
          access_score_max: 2.0, // Score > 1
          no_access_days: -10 // Negative days
        }
      };

      const validation = policyEngine.validatePolicy(invalidPolicy);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Age minimum days must be positive');
      expect(validation.errors).toContain('Size threshold must be positive');
      expect(validation.errors).toContain('Spam score must be between 0 and 1');
      expect(validation.errors).toContain('Promotional score must be between 0 and 1');
      expect(validation.errors).toContain('Access score must be between 0 and 1');
      expect(validation.errors).toContain('No access days must be positive');
    });

    test('should reject policy with invalid action settings', () => {
      const invalidPolicy = {
        name: 'Test Policy',
        action: {
          type: 'invalid_action' as any, // Invalid action type
          method: 'invalid_method' as any, // Invalid method
          export_format: 'invalid_format' as any // Invalid export format
        }
      };

      const validation = policyEngine.validatePolicy(invalidPolicy);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Action type must be either "archive" or "delete"');
      expect(validation.errors).toContain('Action method must be either "gmail" or "export"');
      expect(validation.errors).toContain('Export format must be either "mbox" or "json"');
    });

    test('should reject policy with invalid safety settings', () => {
      const invalidPolicy = {
        name: 'Test Policy',
        safety: {
          max_emails_per_run: 0, // Must be at least 1
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        }
      };

      const validation = policyEngine.validatePolicy(invalidPolicy);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Max emails per run must be at least 1');
    });

    test('should reject policy with invalid schedule settings', () => {
      const invalidPolicy = {
        name: 'Test Policy',
        schedule: {
          frequency: 'invalid_frequency' as any, // Invalid frequency
          time: '25:70', // Invalid time format
          enabled: true
        }
      };

      const validation = policyEngine.validatePolicy(invalidPolicy);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Schedule frequency must be one of: continuous, daily, weekly, monthly');
      expect(validation.errors).toContain('Schedule time must be in HH:MM format');
    });
  });

  describe('Email Matching Logic', () => {
    test('should match emails based on age criteria', async () => {
      const oldEmail: EmailIndex = {
        id: 'old-email',
        date: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000), // 100 days ago
        size: 1024,
        category: 'low',
        subject: 'Old Email',
        sender: 'old@example.com'
      };

      const ageBasedPolicy: CleanupPolicy = {
        id: 'age-policy',
        name: 'Age Based Cleanup',
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 90,
          importance_level_max: 'medium'
        },
        action: { type: 'archive', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: false
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getActivePolicies.mockResolvedValue([ageBasedPolicy]);
      mockStalenessScorer.calculateStaleness.mockResolvedValue({
        email_id: 'old-email',
        total_score: 0.7,
        factors: { age_score: 0.8, importance_score: 0.6, size_penalty: 0.1, spam_score: 0.2, access_score: 0.8 },
        recommendation: 'archive',
        confidence: 0.8
      });

      const result = await policyEngine.evaluateEmailsForCleanup([oldEmail]);

      expect(result.cleanup_candidates).toHaveLength(1);
      expect(result.cleanup_candidates[0].policy.id).toBe('age-policy');
    });

    test('should match emails based on size criteria', async () => {
      const largeEmail: EmailIndex = {
        id: 'large-email',
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        size: 20 * 1024 * 1024, // 20MB
        category: 'medium',
        subject: 'Large Email with Attachments',
        sender: 'attachments@example.com'
      };

      const sizeBasedPolicy: CleanupPolicy = {
        id: 'size-policy',
        name: 'Large Email Cleanup',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 14,
          importance_level_max: 'medium',
          size_threshold_min: 10 * 1024 * 1024 // 10MB
        },
        action: { type: 'archive', method: 'gmail' },
        safety: {
          max_emails_per_run: 50,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: false
        },
        schedule: {
          frequency: 'weekly',
          time: '03:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getActivePolicies.mockResolvedValue([sizeBasedPolicy]);
      mockStalenessScorer.calculateStaleness.mockResolvedValue({
        email_id: 'large-email',
        total_score: 0.6,
        factors: { age_score: 0.3, importance_score: 0.5, size_penalty: 0.8, spam_score: 0.1, access_score: 0.7 },
        recommendation: 'archive',
        confidence: 0.7
      });

      const result = await policyEngine.evaluateEmailsForCleanup([largeEmail]);

      expect(result.cleanup_candidates).toHaveLength(1);
      expect(result.cleanup_candidates[0].policy.id).toBe('size-policy');
    });

    test('should prioritize policies correctly', async () => {
      const testEmail: EmailIndex = {
        id: 'test-email',
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        size: 1024,
        category: 'low',
        spam_score: 0.8,
        subject: 'Test Email',
        sender: 'test@example.com'
      };

      const lowPriorityPolicy: CleanupPolicy = {
        id: 'low-priority',
        name: 'Low Priority',
        
        enabled: true,
        priority: 5,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium'
        },
        action: { type: 'archive', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: false
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      const highPriorityPolicy: CleanupPolicy = {
        id: 'high-priority',
        name: 'High Priority',
        
        enabled: true,
        priority: 20,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'low',
          spam_score_min: 0.7
        },
        action: { type: 'delete', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: false
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getActivePolicies.mockResolvedValue([lowPriorityPolicy, highPriorityPolicy]);
      mockStalenessScorer.calculateStaleness.mockResolvedValue({
        email_id: 'test-email',
        total_score: 0.8,
        factors: { age_score: 0.6, importance_score: 0.8, size_penalty: 0.1, spam_score: 0.8, access_score: 0.7 },
        recommendation: 'delete',
        confidence: 0.9
      });

      const result = await policyEngine.evaluateEmailsForCleanup([testEmail]);

      expect(result.cleanup_candidates).toHaveLength(1);
      expect(result.cleanup_candidates[0].policy.id).toBe('high-priority'); // Should use higher priority policy
      expect(result.cleanup_candidates[0].recommended_action).toBe('delete');
    });
  });

  describe('Policy Recommendations', () => {
    test('should generate policy recommendations based on email analysis', async () => {
      const mockEmails: EmailIndex[] = [
        // Spam emails
        ...Array.from({ length: 50 }, (_, i) => ({
          id: `spam-${i}`,
          date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          size: 1024,
          spam_score: 0.8,
          subject: `Spam ${i}`,
          sender: `spam${i}@example.com`
        })),
        // Promotional emails
        ...Array.from({ length: 30 }, (_, i) => ({
          id: `promo-${i}`,
          date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
          size: 2048,
          promotionalScore: 0.7,
          subject: `Promotion ${i}`,
          sender: `marketing${i}@company.com`
        })),
        // Old emails
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `old-${i}`,
          date: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // Over 1 year old
          size: 1500,
          subject: `Old Email ${i}`,
          sender: `old${i}@example.com`
        })),
        // Large emails
        ...Array.from({ length: 10 }, (_, i) => ({
          id: `large-${i}`,
          date: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
          size: 15 * 1024 * 1024, // 15MB
          subject: `Large Email ${i}`,
          sender: `large${i}@example.com`
        }))
      ];

      mockDatabaseManager.searchEmails.mockResolvedValue(mockEmails);

      const recommendations = await policyEngine.generatePolicyRecommendations();

      expect(recommendations.analysis_summary).toEqual({
        total_emails: 190,
        spam_emails: 50,
        promotional_emails: 30,
        old_emails: 100,
        large_emails: 10
      });

      expect(recommendations.recommended_policies).toHaveLength(4);
      
      const spamPolicy = recommendations.recommended_policies.find(p => p.name === 'Spam Email Cleanup');
      expect(spamPolicy).toBeDefined();
      expect(spamPolicy?.estimated_cleanup_count).toBe(50);

      const promoPolicy = recommendations.recommended_policies.find(p => p.name === 'Promotional Email Cleanup');
      expect(promoPolicy).toBeDefined();
      expect(promoPolicy?.estimated_cleanup_count).toBe(24); // 80% of 30

      const oldPolicy = recommendations.recommended_policies.find(p => p.name === 'Old Email Archive');
      expect(oldPolicy).toBeDefined();
      expect(oldPolicy?.estimated_cleanup_count).toBe(60); // 60% of 100

      const largePolicy = recommendations.recommended_policies.find(p => p.name === 'Large Email Cleanup');
      expect(largePolicy).toBeDefined();
      expect(largePolicy?.estimated_cleanup_count).toBe(7); // 70% of 10
    });

    test('should not recommend policies when thresholds are not met', async () => {
      const smallDataset: EmailIndex[] = [
        {
          id: 'email-1',
          date: new Date(),
          size: 1024,
          subject: 'Regular Email',
          sender: 'user@example.com'
        }
      ];

      mockDatabaseManager.searchEmails.mockResolvedValue(smallDataset);

      const recommendations = await policyEngine.generatePolicyRecommendations();

      expect(recommendations.recommended_policies).toHaveLength(0); // No recommendations for small dataset
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors during policy creation', async () => {
      const policyData = {
        name: 'Test Policy',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium' as const
        },
        action: { type: 'archive' as const, method: 'gmail' as const },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily' as const,
          time: '02:00',
          enabled: true
        }
      };

      mockDatabaseManager.createCleanupPolicy.mockRejectedValue(new Error('Database connection failed'));

      await expect(policyEngine.createPolicy(policyData)).rejects.toThrow('Database connection failed');
    });

    test('should handle database errors during email evaluation', async () => {
      const testEmails: EmailIndex[] = [
        {
          id: 'test-email',
          date: new Date(),
          size: 1024,
          subject: 'Test Email',
          sender: 'test@example.com'
        }
      ];

      mockDatabaseManager.getActivePolicies.mockRejectedValue(new Error('Failed to fetch policies'));

      await expect(policyEngine.evaluateEmailsForCleanup(testEmails)).rejects.toThrow('Failed to fetch policies');
    });

    test('should handle staleness scorer errors during evaluation', async () => {
      const testEmails: EmailIndex[] = [
        {
          id: 'test-email',
          date: new Date(),
          size: 1024,
          subject: 'Test Email',
          sender: 'test@example.com'
        }
      ];

      mockDatabaseManager.getActivePolicies.mockResolvedValue([]);
      mockStalenessScorer.calculateStaleness.mockRejectedValue(new Error('Staleness calculation failed'));

      await expect(policyEngine.evaluateEmailsForCleanup(testEmails)).rejects.toThrow('Staleness calculation failed');
    });
  });

  describe('Edge Cases', () => {
    test('should handle emails without dates', async () => {
      const emailWithoutDate: EmailIndex = {
        id: 'no-date-email',
        size: 1024,
        category: 'medium',
        subject: 'Email Without Date',
        sender: 'nodate@example.com'
      };

      const ageBasedPolicy: CleanupPolicy = {
        id: 'age-policy',
        name: 'Age Based Cleanup',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium'
        },
        action: { type: 'archive', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: false
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getActivePolicies.mockResolvedValue([ageBasedPolicy]);
      mockStalenessScorer.calculateStaleness.mockResolvedValue({
        email_id: 'no-date-email',
        total_score: 0.5,
        factors: { age_score: 0.5, importance_score: 0.5, size_penalty: 0.1, spam_score: 0.2, access_score: 0.6 },
        recommendation: 'archive',
        confidence: 0.6
      });

      const result = await policyEngine.evaluateEmailsForCleanup([emailWithoutDate]);

      // Email without date should not match age-based criteria
      expect(result.cleanup_candidates).toHaveLength(0);
      expect(result.protected_emails).toHaveLength(1);
    });

    test('should handle empty policy list', async () => {
      const testEmails: EmailIndex[] = [
        {
          id: 'test-email',
          date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          size: 1024,
          subject: 'Test Email',
          sender: 'test@example.com'
        }
      ];

      mockDatabaseManager.getActivePolicies.mockResolvedValue([]);

      const result = await policyEngine.evaluateEmailsForCleanup(testEmails);

      expect(result.cleanup_candidates).toHaveLength(0);
      expect(result.protected_emails).toHaveLength(1);
      expect(result.protected_emails[0].reason).toBe('No applicable policy found');
    });

    test('should handle policy with preserve_important safety setting', async () => {
      const importantEmail: EmailIndex = {
        id: 'important-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        size: 1024,
        category: 'high',
        importanceScore: 10,
        subject: 'Important Email',
        sender: 'boss@company.com'
      };

      const safePolicy: CleanupPolicy = {
        id: 'safe-policy',
        name: 'Safe Cleanup',
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium'
        },
        action: { type: 'archive', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getActivePolicies.mockResolvedValue([safePolicy]);
      mockStalenessScorer.calculateStaleness.mockResolvedValue({
        email_id: 'important-email',
        total_score: 0.3,
        factors: { age_score: 0.6, importance_score: 0.1, size_penalty: 0.1, spam_score: 0.1, access_score: 0.4 },
        recommendation: 'keep',
        confidence: 0.8
      });

      const result = await policyEngine.evaluateEmailsForCleanup([importantEmail]);

      expect(result.cleanup_candidates).toHaveLength(0);
      expect(result.protected_emails).toHaveLength(1);
      expect(result.protected_emails[0].reason).toContain('preserve important');
    });
  });

  describe('Singleton Pattern', () => {
    test('should maintain singleton instance', () => {
      const instance1 = CleanupPolicyEngine.getInstance();
      const instance2 = CleanupPolicyEngine.getInstance();

      expect(instance1).toBe(instance2);
    });

    test('should use provided dependencies in constructor', () => {
      const customEngine = new CleanupPolicyEngine(mockDatabaseManager, mockStalenessScorer, mockAccessTracker);

      expect(customEngine).toBeInstanceOf(CleanupPolicyEngine);
    });

    test('should use default dependencies when none provided', () => {
      // Reset mocks
      jest.restoreAllMocks();
      jest.spyOn(DatabaseManager, 'getInstance').mockReturnValue(mockDatabaseManager);
      jest.spyOn(AccessPatternTracker, 'getInstance').mockReturnValue(mockAccessTracker);

      const defaultEngine = new CleanupPolicyEngine();

      expect(defaultEngine).toBeInstanceOf(CleanupPolicyEngine);
      expect(DatabaseManager.getInstance).toHaveBeenCalled();
      expect(AccessPatternTracker.getInstance).toHaveBeenCalled();
    });
  });

  describe('Additional Methods', () => {
    test('should get emails for specific policy', async () => {
      const testPolicy: CleanupPolicy = {
        id: 'test-policy',
        name: 'Test Policy',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium'
        },
        action: { type: 'archive', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      const mockEmails: EmailIndex[] = [
        {
          id: 'policy-email-1',
          date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          size: 1024,
          subject: 'Policy Email 1',
          sender: 'test1@example.com'
        }
      ];

      mockDatabaseManager.getEmailsForCleanup.mockResolvedValue(mockEmails);

      const result = await policyEngine.getEmailsForPolicy(testPolicy, 50);

      expect(result).toEqual(mockEmails);
      expect(mockDatabaseManager.getEmailsForCleanup).toHaveBeenCalledWith(testPolicy, 50);
    });

    test('should handle errors when getting emails for policy', async () => {
      const testPolicy: CleanupPolicy = {
        id: 'test-policy',
        name: 'Test Policy',
        
        enabled: true,
        priority: 10,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'medium'
        },
        action: { type: 'archive', method: 'gmail' },
        safety: {
          max_emails_per_run: 100,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        },
        schedule: {
          frequency: 'daily',
          time: '02:00',
          enabled: true
        },
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDatabaseManager.getEmailsForCleanup.mockRejectedValue(new Error('Database query failed'));

      await expect(policyEngine.getEmailsForPolicy(testPolicy)).rejects.toThrow('Database query failed');
    });
  });
});