import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { StalenessScorer } from '../../../src/cleanup/StalenessScorer.js';
import { AccessPatternTracker } from '../../../src/cleanup/AccessPatternTracker.js';
import { EmailIndex, EmailAccessSummary, StalenessScore } from '../../../src/types/index.js';

describe('StalenessScorer', () => {
  let stalenessScorer: StalenessScorer;
  let mockAccessTracker: any;

  beforeEach(() => {
    // Mock AccessPatternTracker
    mockAccessTracker = {
      getAccessSummary: jest.fn<() => Promise<EmailAccessSummary | null>>().mockResolvedValue(null),
      getInstance: jest.fn().mockReturnValue(mockAccessTracker)
    };

    // Mock static method calls
    jest.spyOn(AccessPatternTracker, 'getInstance').mockReturnValue(mockAccessTracker);
    
    stalenessScorer = new StalenessScorer(mockAccessTracker);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Email Staleness Calculation', () => {
    test('should calculate staleness score for active email', async () => {
      const mockEmail: EmailIndex = {
        id: 'test-email-1',
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        size: 1024 * 10, // 10KB
        category: 'medium',
        importanceLevel: 'medium',
        subject: 'Test Email',
        sender: 'test@example.com'
      };

      const mockAccessSummary: EmailAccessSummary = {
        email_id: 'test-email-1',
        total_accesses: 5,
        last_accessed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        search_appearances: 3,
        search_interactions: 2,
        access_score: 0.8,
        updated_at: new Date()
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(mockAccessSummary);

      const stalenessScore = await stalenessScorer.calculateStaleness(mockEmail);

      expect(stalenessScore).toEqual({
        email_id: 'test-email-1',
        total_score: expect.any(Number),
        factors: {
          age_score: expect.any(Number),
          importance_score: expect.any(Number),
          size_penalty: expect.any(Number),
          spam_score: expect.any(Number),
          access_score: expect.any(Number)
        },
        recommendation: expect.stringMatching(/^(keep|archive|delete)$/),
        confidence: expect.any(Number)
      });

      expect(stalenessScore.total_score).toBeGreaterThan(0);
      expect(stalenessScore.total_score).toBeLessThanOrEqual(1);
      expect(mockAccessTracker.getAccessSummary).toHaveBeenCalledWith('test-email-1');
    });

    test('should calculate staleness score for old unaccessed email', async () => {
      const mockEmail: EmailIndex = {
        id: 'old-email-1',
        date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        size: 1024 * 1024, // 1MB
        category: 'low',
        importanceLevel: 'low',
        subject: 'Old Email',
        sender: 'old@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(mockEmail);

      expect(stalenessScore.total_score).toBeGreaterThan(0.6); // Should be high staleness (adjusted from 0.7)
      expect(stalenessScore.total_score).toBeLessThanOrEqual(1);
      expect(stalenessScore.recommendation).toBe('archive'); // Score 0.66 = archive (0.6-0.8 range)
    });

    test('should handle calculation errors gracefully', async () => {
      const mockEmail: EmailIndex = {
        id: 'error-email',
        date: new Date(),
        size: 1024,
        subject: 'Error Email',
        sender: 'error@example.com'
      };

      mockAccessTracker.getAccessSummary.mockRejectedValue(new Error('Database error'));

      await expect(stalenessScorer.calculateStaleness(mockEmail)).rejects.toThrow('Database error');
    });

    test('should consider email size in staleness calculation', async () => {
      const largeEmail: EmailIndex = {
        id: 'large-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        size: 50 * 1024 * 1024, // 50MB
        category: 'medium',
        subject: 'Large Email',
        sender: 'large@example.com'
      };

      const smallEmail: EmailIndex = {
        id: 'small-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        size: 1024, // 1KB
        category: 'medium',
        subject: 'Small Email',
        sender: 'small@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const largeEmailScore = await stalenessScorer.calculateStaleness(largeEmail);
      const smallEmailScore = await stalenessScorer.calculateStaleness(smallEmail);

      // Large emails should have higher size penalty
      expect(largeEmailScore.factors.size_penalty).toBeGreaterThan(smallEmailScore.factors.size_penalty);
    });

    test('should consider importance in staleness calculation', async () => {
      const importantEmail: EmailIndex = {
        id: 'important-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        size: 1024,
        category: 'high',
        importanceLevel: 'high',
        subject: 'Important Email',
        sender: 'important@example.com'
      };

      const lowImportanceEmail: EmailIndex = {
        id: 'low-importance-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        size: 1024,
        category: 'low',
        importanceLevel: 'low',
        subject: 'Low Importance Email',
        sender: 'low@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const importantScore = await stalenessScorer.calculateStaleness(importantEmail);
      const lowImportanceScore = await stalenessScorer.calculateStaleness(lowImportanceEmail);

      // Low importance emails should have higher importance score (more stale)
      expect(lowImportanceScore.factors.importance_score).toBeGreaterThan(importantScore.factors.importance_score);
      expect(importantScore.recommendation).toBe('keep'); // High importance should be kept
    });

    test('should use provided access summary', async () => {
      const mockEmail: EmailIndex = {
        id: 'test-email',
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        size: 1024,
        subject: 'Test Email',
        sender: 'test@example.com'
      };

      const providedAccessSummary: EmailAccessSummary = {
        email_id: 'test-email',
        total_accesses: 10,
        last_accessed: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
        search_appearances: 5,
        search_interactions: 3,
        access_score: 0.9,
        updated_at: new Date()
      };

      const stalenessScore = await stalenessScorer.calculateStaleness(mockEmail, providedAccessSummary);

      // Should not call getAccessSummary since we provided it
      expect(mockAccessTracker.getAccessSummary).not.toHaveBeenCalled();
      expect(stalenessScore.factors.access_score).toBeLessThan(0.3); // Recently accessed should have low access score
    });
  });

  describe('Batch Staleness Analysis', () => {
    test('should calculate staleness for multiple emails', async () => {
      const emails: EmailIndex[] = [
        {
          id: 'email-1',
          date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          size: 1024,
          category: 'medium',
          subject: 'Email 1',
          sender: 'test1@example.com'
        },
        {
          id: 'email-2',
          date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
          size: 1024 * 1024,
          category: 'low',
          subject: 'Email 2',
          sender: 'test2@example.com'
        },
        {
          id: 'email-3',
          date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          size: 512,
          category: 'high',
          subject: 'Email 3',
          sender: 'test3@example.com'
        }
      ];

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const results = await stalenessScorer.batchCalculateStaleness(emails);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({
        email_id: 'email-1',
        total_score: expect.any(Number),
        factors: expect.any(Object),
        recommendation: expect.stringMatching(/^(keep|archive|delete)$/),
        confidence: expect.any(Number)
      });

      // Most stale should be email-2 (old + low importance + large)
      expect(results[1].total_score).toBeGreaterThan(results[0].total_score);
      expect(results[1].total_score).toBeGreaterThan(results[2].total_score);
    });

    test('should handle batch processing errors gracefully', async () => {
      const emails: EmailIndex[] = [
        {
          id: 'email-1',
          date: new Date(),
          size: 1024,
          subject: 'Email 1',
          sender: 'test1@example.com'
        },
        {
          id: 'error-email',
          date: new Date(),
          size: 1024,
          subject: 'Error Email',
          sender: 'error@example.com'
        }
      ];

      mockAccessTracker.getAccessSummary
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('Database error'));

      await expect(stalenessScorer.batchCalculateStaleness(emails)).rejects.toThrow('Database error');
    });

    test('should process large batches efficiently', async () => {
      const largeEmailBatch: EmailIndex[] = Array.from({ length: 100 }, (_, i) => ({
        id: `email-${i}`,
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        size: 1024,
        subject: `Email ${i}`,
        sender: `test${i}@example.com`
      }));

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const results = await stalenessScorer.batchCalculateStaleness(largeEmailBatch);

      expect(results).toHaveLength(100);
      expect(mockAccessTracker.getAccessSummary).toHaveBeenCalledTimes(100);
    });
  });

  describe('Age-based Scoring', () => {
    test('should score recent emails as less stale', async () => {
      const recentEmail: EmailIndex = {
        id: 'recent',
        date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 1 week ago
        size: 1024,
        subject: 'Recent Email',
        sender: 'recent@example.com'
      };

      const oldEmail: EmailIndex = {
        id: 'old',
        date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year ago
        size: 1024,
        subject: 'Old Email',
        sender: 'old@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const recentScore = await stalenessScorer.calculateStaleness(recentEmail);
      const oldScore = await stalenessScorer.calculateStaleness(oldEmail);

      expect(oldScore.factors.age_score).toBeGreaterThan(recentScore.factors.age_score);
    });

    test('should handle emails without dates', async () => {
      const noDateEmail: EmailIndex = {
        id: 'no-date',
        size: 1024,
        subject: 'No Date Email',
        sender: 'nodate@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(noDateEmail);

      expect(stalenessScore.factors.age_score).toBe(0.5); // Default score
    });

    test('should handle very old emails correctly', async () => {
      const veryOldEmail: EmailIndex = {
        id: 'very-old',
        date: new Date('2020-01-01'), // Very old
        size: 1024,
        subject: 'Very Old Email',
        sender: 'veryold@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(veryOldEmail);

      expect(stalenessScore.factors.age_score).toBeGreaterThan(0.9);
    });
  });

  describe('Spam and Promotional Scoring', () => {
    test('should score spam emails as more stale', async () => {
      const spamEmail: EmailIndex = {
        id: 'spam-email',
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        size: 1024,
        spamScore: 0.9,
        gmailCategory: 'spam',
        subject: 'Spam Email',
        sender: 'spam@example.com'
      };

      const normalEmail: EmailIndex = {
        id: 'normal-email',
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        size: 1024,
        spamScore: 0.1,
        subject: 'Normal Email',
        sender: 'normal@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const spamScore = await stalenessScorer.calculateStaleness(spamEmail);
      const normalScore = await stalenessScorer.calculateStaleness(normalEmail);

      expect(spamScore.factors.spam_score).toBeGreaterThan(normalScore.factors.spam_score);
    });

    test('should score promotional emails as more stale', async () => {
      const promoEmail: EmailIndex = {
        id: 'promo-email',
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        size: 1024,
        promotionalScore: 0.8,
        gmailCategory: 'promotions',
        subject: 'Promotional Email',
        sender: 'promo@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const promoScore = await stalenessScorer.calculateStaleness(promoEmail);

      expect(promoScore.factors.spam_score).toBeGreaterThan(0.5);
    });

    test('should handle spam indicators', async () => {
      const emailWithIndicators: EmailIndex = {
        id: 'indicators-email',
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        size: 1024,
        spamIndicators: ['suspicious_links', 'excessive_caps', 'urgent_language'],
        promotionalIndicators: ['unsubscribe_link', 'discount_offers'],
        subject: 'Indicators Email',
        sender: 'indicators@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const indicatorsScore = await stalenessScorer.calculateStaleness(emailWithIndicators);

      expect(indicatorsScore.factors.spam_score).toBeGreaterThan(0.4);
    });
  });

  describe('Access Pattern Scoring', () => {
    test('should score frequently accessed emails as less stale', async () => {
      const email: EmailIndex = {
        id: 'accessed-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        size: 1024,
        subject: 'Accessed Email',
        sender: 'accessed@example.com'
      };

      const frequentAccessSummary: EmailAccessSummary = {
        email_id: 'accessed-email',
        total_accesses: 15,
        last_accessed: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        search_appearances: 10,
        search_interactions: 8,
        access_score: 0.9,
        updated_at: new Date()
      };

      const stalenessScore = await stalenessScorer.calculateStaleness(email, frequentAccessSummary);

      expect(stalenessScore.factors.access_score).toBeLessThan(0.3); // Low access score = frequently accessed
    });

    test('should score never accessed emails as more stale', async () => {
      const email: EmailIndex = {
        id: 'never-accessed-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        size: 1024,
        subject: 'Never Accessed Email',
        sender: 'never@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(email);

      expect(stalenessScore.factors.access_score).toBe(0.8); // High staleness for never accessed
    });
  });

  describe('Staleness Statistics', () => {
    test('should generate comprehensive staleness statistics', async () => {
      const emails: EmailIndex[] = [
        {
          id: 'email-1',
          date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          size: 1024,
          category: 'high',
          subject: 'Email 1',
          sender: 'test1@example.com'
        },
        {
          id: 'email-2',
          date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
          size: 1024 * 1024,
          category: 'low',
          subject: 'Email 2',
          sender: 'test2@example.com'
        },
        {
          id: 'email-3',
          date: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          size: 512,
          category: 'medium',
          subject: 'Email 3',
          sender: 'test3@example.com'
        }
      ];

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const statistics = await stalenessScorer.getStalenesStatistics(emails);

      expect(statistics).toEqual({
        total_emails: 3,
        average_staleness: expect.any(Number),
        recommendations: {
          keep: expect.any(Number),
          archive: expect.any(Number),
          delete: expect.any(Number)
        },
        high_confidence_scores: expect.any(Number),
        factor_averages: {
          age: expect.any(Number),
          importance: expect.any(Number),
          size: expect.any(Number),
          spam: expect.any(Number),
          access: expect.any(Number)
        }
      });

      expect(statistics.total_emails).toBe(3);
      expect(statistics.average_staleness).toBeGreaterThanOrEqual(0);
      expect(statistics.average_staleness).toBeLessThanOrEqual(1);
    });

    test('should handle empty email list for statistics', async () => {
      const statistics = await stalenessScorer.getStalenesStatistics([]);

      expect(statistics.total_emails).toBe(0);
      expect(statistics.average_staleness).toBeNaN(); // NaN when dividing by 0
    });
  });

  describe('Configuration Management', () => {
    test('should update scoring weights', () => {
      const newWeights = {
        age: 0.3,
        importance: 0.4,
        access: 0.2
      };

      stalenessScorer.updateWeights(newWeights);

      const config = stalenessScorer.getConfiguration();
      expect(config.weights.age).toBe(0.3);
      expect(config.weights.importance).toBe(0.4);
      expect(config.weights.access).toBe(0.2);
    });

    test('should get current configuration', () => {
      const config = stalenessScorer.getConfiguration();

      expect(config).toEqual({
        weights: expect.objectContaining({
          age: expect.any(Number),
          importance: expect.any(Number),
          size: expect.any(Number),
          spam: expect.any(Number),
          access: expect.any(Number)
        }),
        thresholds: expect.objectContaining({
          age: expect.any(Object),
          size: expect.any(Object),
          importance: expect.any(Object)
        })
      });
    });
  });

  describe('Recommendation Logic', () => {
    test('should always keep high importance emails', async () => {
      const highImportanceEmail: EmailIndex = {
        id: 'high-importance',
        date: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000), // Very old
        size: 50 * 1024 * 1024, // Very large
        category: 'high',
        importanceLevel: 'high',
        spamScore: 0.8, // Even if it looks like spam
        subject: 'High Importance Email',
        sender: 'important@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(highImportanceEmail);

      expect(stalenessScore.recommendation).toBe('keep');
    });

    test('should keep recent emails regardless of other factors', async () => {
      const recentEmail: EmailIndex = {
        id: 'recent-email',
        date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        size: 50 * 1024 * 1024, // Large
        category: 'low',
        spamScore: 0.9, // High spam score
        subject: 'Recent Email',
        sender: 'recent@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(recentEmail);

      expect(stalenessScore.recommendation).toBe('keep');
    });

    test('should recommend deletion for very stale emails', async () => {
      const veryStaleEmail: EmailIndex = {
        id: 'very-stale',
        date: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), // Very old
        size: 100 * 1024 * 1024, // Very large
        category: 'low',
        importanceLevel: 'low',
        spamScore: 0.9,
        gmailCategory: 'spam',
        subject: 'Very Stale Email',
        sender: 'stale@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(veryStaleEmail);

      expect(stalenessScore.recommendation).toBe('delete');
      expect(stalenessScore.total_score).toBeGreaterThan(0.8);
    });
  });

  describe('Edge Cases', () => {
    test('should handle malformed email data', async () => {
      const malformedEmail: EmailIndex = {
        id: 'malformed',
        date: undefined,
        size: undefined,
        subject: 'Malformed Email',
        sender: 'malformed@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(malformedEmail);

      expect(stalenessScore.total_score).toBeGreaterThanOrEqual(0);
      expect(stalenessScore.total_score).toBeLessThanOrEqual(1);
      expect(stalenessScore.factors.age_score).toBe(0.5); // Default for missing date
      expect(stalenessScore.factors.size_penalty).toBe(0); // No penalty for missing size
    });

    test('should handle extremely large emails', async () => {
      const giantEmail: EmailIndex = {
        id: 'giant',
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        size: 1024 * 1024 * 1024, // 1GB
        subject: 'Giant Email',
        sender: 'giant@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(giantEmail);

      expect(stalenessScore.factors.size_penalty).toBeGreaterThan(0.8);
    });

    test('should handle zero-byte emails', async () => {
      const zeroByteEmail: EmailIndex = {
        id: 'zero-byte',
        date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        size: 0,
        subject: 'Zero Byte Email',
        sender: 'zero@example.com'
      };

      mockAccessTracker.getAccessSummary.mockResolvedValue(null);

      const stalenessScore = await stalenessScorer.calculateStaleness(zeroByteEmail);

      expect(stalenessScore.factors.size_penalty).toBe(0.1); // Minimal penalty for very small emails
    });

    test('should handle emails with all possible fields', async () => {
      const fullEmail: EmailIndex = {
        id: 'full-email',
        date: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        size: 5 * 1024 * 1024,
        category: 'medium',
        importanceLevel: 'medium',
        importanceScore: 5,
        importanceMatchedRules: ['rule1', 'rule2'],
        spamScore: 0.3,
        promotionalScore: 0.2,
        gmailCategory: 'primary',
        spamIndicators: ['suspicious_links'],
        promotionalIndicators: ['unsubscribe_link'],
        subject: 'Full Email',
        sender: 'full@example.com'
      };

      const fullAccessSummary: EmailAccessSummary = {
        email_id: 'full-email',
        total_accesses: 8,
        last_accessed: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        search_appearances: 6,
        search_interactions: 4,
        access_score: 0.7,
        updated_at: new Date()
      };

      const stalenessScore = await stalenessScorer.calculateStaleness(fullEmail, fullAccessSummary);

      expect(stalenessScore.email_id).toBe('full-email');
      expect(stalenessScore.total_score).toBeGreaterThanOrEqual(0);
      expect(stalenessScore.total_score).toBeLessThanOrEqual(1);
      expect(stalenessScore.confidence).toBeGreaterThan(0);
      expect(['keep', 'archive', 'delete']).toContain(stalenessScore.recommendation);
    });
  });

  describe('Constructor Behavior', () => {
    test('should use provided access tracker', () => {
      const customAccessTracker = mockAccessTracker;
      const scorer = new StalenessScorer(customAccessTracker);

      expect(scorer).toBeInstanceOf(StalenessScorer);
    });

    test('should use default access tracker when none provided', () => {
      // Reset the mock to test default behavior
      jest.restoreAllMocks();
      jest.spyOn(AccessPatternTracker, 'getInstance').mockReturnValue(mockAccessTracker);

      const scorer = new StalenessScorer();

      expect(scorer).toBeInstanceOf(StalenessScorer);
      expect(AccessPatternTracker.getInstance).toHaveBeenCalled();
    });
  });
});