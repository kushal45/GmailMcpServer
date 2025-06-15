import { EmailIndex, StalenessScore, EmailAccessSummary } from '../types/index.js';
import { AccessPatternTracker } from './AccessPatternTracker.js';
import { logger } from '../utils/logger.js';

/**
 * StalenessScorer calculates how "stale" or irrelevant emails are
 * based on multiple factors: age, importance, size, spam indicators, and access patterns.
 */
export class StalenessScorer {
  private accessTracker: AccessPatternTracker;

  // Scoring weights for different factors
  private readonly weights = {
    age: 0.25,
    importance: 0.30,
    size: 0.15,
    spam: 0.15,
    access: 0.15
  };

  // Scoring thresholds
  private readonly thresholds = {
    age: {
      recent_days: 30,
      moderate_days: 90,
      old_days: 365
    },
    size: {
      small_bytes: 102400,    // 100KB
      medium_bytes: 1048576,  // 1MB
      large_bytes: 10485760   // 10MB
    },
    importance: {
      high_score: 10,
      medium_score: 0,
      low_score: -5
    }
  };

  public customMeta:string = "";

  constructor(accessTracker?: AccessPatternTracker) {
    this.accessTracker = accessTracker || AccessPatternTracker.getInstance();
  }

  /**
   * Calculate comprehensive staleness score for an email
   */
  async calculateStaleness(email: EmailIndex, accessSummary?: EmailAccessSummary): Promise<StalenessScore> {
    try {
      // Get access summary if not provided
      if (!accessSummary) {
        const summary = await this.accessTracker.getAccessSummary(email.id);
        accessSummary = summary || undefined;
      }

      // Calculate individual factor scores
      const ageScore = this.calculateAgeScore(email.date);
      const importanceScore = this.calculateImportanceScore(email);
      const sizeScore = this.calculateSizeScore(email.size);
      const spamScore = this.calculateSpamScore(email);
      const accessScore = this.calculateAccessScore(accessSummary);

      // Calculate weighted total score
      const totalScore = 
        ageScore * this.weights.age +
        importanceScore * this.weights.importance +
        sizeScore * this.weights.size +
        spamScore * this.weights.spam +
        accessScore * this.weights.access;

      // Determine recommendation based on total score
      const recommendation = this.determineRecommendation(totalScore, email);
      
      // Calculate confidence based on factor consistency
      const confidence = this.calculateConfidence([
        ageScore, importanceScore, sizeScore, spamScore, accessScore
      ]);

      const result: StalenessScore = {
        email_id: email.id,
        total_score: Math.round(totalScore * 1000) / 1000, // Round to 3 decimal places
        factors: {
          age_score: Math.round(ageScore * 1000) / 1000,
          importance_score: Math.round(importanceScore * 1000) / 1000,
          size_penalty: Math.round(sizeScore * 1000) / 1000,
          spam_score: Math.round(spamScore * 1000) / 1000,
          access_score: Math.round(accessScore * 1000) / 1000
        },
        recommendation,
        confidence: Math.round(confidence * 1000) / 1000
      };

      logger.debug('Staleness score calculated', {
        email_id: email.id,
        total_score: result.total_score,
        recommendation: result.recommendation,
        confidence: result.confidence
      });

      return result;
    } catch (error) {
      logger.error('Failed to calculate staleness score:', error);
      throw error;
    }
  }

  /**
   * Calculate age score (higher = older = more stale)
   */
  private calculateAgeScore(date?: Date): number {
    if (!date) {
      return 0.5; // Default score for emails without date
    }

    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff <= this.thresholds.age.recent_days) {
      // Recent emails: 0-30 days = 0.0-0.3
      return (daysDiff / this.thresholds.age.recent_days) * 0.3;
    } else if (daysDiff <= this.thresholds.age.moderate_days) {
      // Moderate age: 31-90 days = 0.3-0.6
      const relativeAge = (daysDiff - this.thresholds.age.recent_days) / 
                         (this.thresholds.age.moderate_days - this.thresholds.age.recent_days);
      return 0.3 + (relativeAge * 0.3);
    } else if (daysDiff <= this.thresholds.age.old_days) {
      // Old emails: 91-365 days = 0.6-0.9
      const relativeAge = (daysDiff - this.thresholds.age.moderate_days) / 
                         (this.thresholds.age.old_days - this.thresholds.age.moderate_days);
      return 0.6 + (relativeAge * 0.3);
    } else {
      // Very old emails: 365+ days = 0.9-1.0
      const relativeAge = Math.min(1.0, (daysDiff - this.thresholds.age.old_days) / 365);
      return 0.9 + (relativeAge * 0.1);
    }
  }

  /**
   * Calculate importance score (higher = less important = more stale)
   */
  private calculateImportanceScore(email: EmailIndex): number {
    // Primary importance from categorization
    let baseScore = 0.5; // Default for uncategorized emails

    if (email.category === 'high') {
      baseScore = 0.1; // High importance = low staleness
    } else if (email.category === 'medium') {
      baseScore = 0.5; // Medium importance = medium staleness
    } else if (email.category === 'low') {
      baseScore = 0.8; // Low importance = high staleness
    }

    // Adjust based on importance score if available
    if (email.importanceScore !== undefined) {
      if (email.importanceScore >= this.thresholds.importance.high_score) {
        baseScore = Math.min(baseScore, 0.2);
      } else if (email.importanceScore <= this.thresholds.importance.low_score) {
        baseScore = Math.max(baseScore, 0.8);
      }
    }

    // Adjust based on importance level analysis
    if (email.importanceLevel) {
      switch (email.importanceLevel) {
        case 'high':
          baseScore = Math.min(baseScore, 0.2);
          break;
        case 'medium':
          // Keep base score
          break;
        case 'low':
          baseScore = Math.max(baseScore, 0.7);
          break;
      }
    }

    // Special handling for emails with matched importance rules
    if (email.importanceMatchedRules && email.importanceMatchedRules.length > 0) {
      // If rules were matched, it's likely more important
      baseScore = Math.min(baseScore, 0.4);
    }

    return Math.max(0, Math.min(1, baseScore));
  }

  /**
   * Calculate size score/penalty (higher = larger = more stale for cleanup)
   */
  private calculateSizeScore(size?: number): number {
    if (size === undefined || size === null) {
      return 0; // No penalty for emails without size data
    }

    if (size <= this.thresholds.size.small_bytes) {
      return 0.1; // Small emails get minimal penalty
    } else if (size <= this.thresholds.size.medium_bytes) {
      // Medium emails: linear scale from 0.1 to 0.5
      const relativeSize = (size - this.thresholds.size.small_bytes) / 
                          (this.thresholds.size.medium_bytes - this.thresholds.size.small_bytes);
      return 0.1 + (relativeSize * 0.4);
    } else if (size <= this.thresholds.size.large_bytes) {
      // Large emails: linear scale from 0.5 to 0.8
      const relativeSize = (size - this.thresholds.size.medium_bytes) / 
                          (this.thresholds.size.large_bytes - this.thresholds.size.medium_bytes);
      return 0.5 + (relativeSize * 0.3);
    } else {
      // Very large emails: 0.8-1.0
      const relativeSize = Math.min(1.0, (size - this.thresholds.size.large_bytes) / this.thresholds.size.large_bytes);
      return 0.8 + (relativeSize * 0.2);
    }
  }

  /**
   * Calculate spam score (higher spam = higher staleness)
   */
  private calculateSpamScore(email: EmailIndex): number {
    let spamScore = 0;

    // Use spam score from analysis if available
    if (email.spam_score !== undefined) {
      spamScore = Math.max(spamScore, email.spam_score);
    }

    // Check promotional score (promotional emails are candidates for cleanup)
    if (email.spam_score !== undefined) {
      spamScore = Math.max(spamScore, (email?.promotional_score||0) * 0.7); // Weight promotional lower than spam
    }

    // Check Gmail category
    if (email.gmailCategory === 'spam') {
      spamScore = Math.max(spamScore, 0.9);
    } else if (email.gmailCategory === 'promotions') {
      spamScore = Math.max(spamScore, 0.6);
    }

    // Check spam indicators
    if (email.spamIndicators && email.spamIndicators.length > 0) {
      const indicatorScore = Math.min(0.8, email.spamIndicators.length * 0.2);
      spamScore = Math.max(spamScore, indicatorScore);
    }

    // Check promotional indicators
    if (email.promotionalIndicators && email.promotionalIndicators.length > 0) {
      const indicatorScore = Math.min(0.6, email.promotionalIndicators.length * 0.15);
      spamScore = Math.max(spamScore, indicatorScore);
    }

    return Math.max(0, Math.min(1, spamScore));
  }

  /**
   * Calculate access score (higher = less accessed = more stale)
   */
  private calculateAccessScore(accessSummary?: EmailAccessSummary | null): number {
    if (!accessSummary) {
      return 0.8; // High staleness score for never-accessed emails
    }

    // Calculate days since last access
    const daysSinceAccess = (Date.now() - accessSummary.last_accessed.getTime()) / (1000 * 60 * 60 * 24);

    // Base score on recency of access
    let accessScore = 0;
    if (daysSinceAccess <= 7) {
      accessScore = 0.1; // Very recent access
    } else if (daysSinceAccess <= 30) {
      accessScore = 0.2 + ((daysSinceAccess - 7) / 23) * 0.3; // 0.2-0.5
    } else if (daysSinceAccess <= 90) {
      accessScore = 0.5 + ((daysSinceAccess - 30) / 60) * 0.3; // 0.5-0.8
    } else {
      accessScore = 0.8 + Math.min(0.2, (daysSinceAccess - 90) / 275); // 0.8-1.0
    }

    // Adjust based on total access count
    if (accessSummary.total_accesses > 10) {
      accessScore *= 0.7; // Frequently accessed emails get lower staleness
    } else if (accessSummary.total_accesses > 5) {
      accessScore *= 0.8;
    } else if (accessSummary.total_accesses > 2) {
      accessScore *= 0.9;
    }

    // Adjust based on search interactions
    if (accessSummary.search_interactions > 5) {
      accessScore *= 0.6; // Frequently interacted emails are important
    } else if (accessSummary.search_interactions > 2) {
      accessScore *= 0.8;
    }

    return Math.max(0, Math.min(1, accessScore));
  }

  /**
   * Determine cleanup recommendation based on total score
   */
  private determineRecommendation(totalScore: number, email: EmailIndex): 'keep' | 'archive' | 'delete' {
    // Safety checks - never delete high importance emails
    if (email.category === 'high' || email.importanceLevel === 'high') {
      return 'keep';
    }

    // Safety check - be conservative with recent emails
    if (email.date) {
      const daysSinceReceived = (Date.now() - email.date.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceReceived < 7) {
        return 'keep';
      }
    }

    // Determine recommendation based on score thresholds
    if (totalScore >= 0.8) {
      return 'delete'; // Very stale emails
    } else if (totalScore >= 0.6) {
      return 'archive'; // Moderately stale emails
    } else {
      return 'keep'; // Fresh or important emails
    }
  }

  /**
   * Calculate confidence based on factor consistency
   */
  private calculateConfidence(scores: number[]): number {
    if (scores.length === 0) return 0;

    // Calculate variance to determine consistency
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / scores.length;
    const standardDeviation = Math.sqrt(variance);

    // Higher variance = lower confidence
    // Normalize to 0-1 scale where low variance = high confidence
    const confidence = Math.max(0, 1 - (standardDeviation * 2));

    // Boost confidence if multiple factors agree on high staleness
    const highStaleFactors = scores.filter(score => score > 0.7).length;
    if (highStaleFactors >= 3) {
      return Math.min(1, confidence + 0.2);
    }

    // Boost confidence if multiple factors agree on low staleness
    const lowStaleFactors = scores.filter(score => score < 0.3).length;
    if (lowStaleFactors >= 3) {
      return Math.min(1, confidence + 0.2);
    }

    return confidence;
  }

  /**
   * Batch calculate staleness scores for multiple emails
   */
  async batchCalculateStaleness(emails: EmailIndex[]): Promise<StalenessScore[]> {
    try {
      const results: StalenessScore[] = [];
      const batchSize = 50;

      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (email) => {
          return this.calculateStaleness(email);
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        logger.debug('Batch processed staleness scores', {
          batch_size: batch.length,
          batch_start: i,
          total_emails: emails.length
        });
      }

      return results;
    } catch (error) {
      logger.error('Failed to batch calculate staleness scores:', error);
      throw error;
    }
  }

  /**
   * Get staleness statistics for a set of emails
   */
  async getStalenesStatistics(emails: EmailIndex[]): Promise<{
    total_emails: number;
    average_staleness: number;
    recommendations: {
      keep: number;
      archive: number;
      delete: number;
    };
    high_confidence_scores: number;
    factor_averages: {
      age: number;
      importance: number;
      size: number;
      spam: number;
      access: number;
    };
  }> {
    try {
      const scores = await this.batchCalculateStaleness(emails);

      const recommendations = {
        keep: scores.filter(s => s.recommendation === 'keep').length,
        archive: scores.filter(s => s.recommendation === 'archive').length,
        delete: scores.filter(s => s.recommendation === 'delete').length
      };

      const averageStaleness = scores.reduce((sum, score) => sum + score.total_score, 0) / scores.length;
      const highConfidenceScores = scores.filter(s => s.confidence > 0.8).length;

      const factorAverages = {
        age: scores.reduce((sum, score) => sum + score.factors.age_score, 0) / scores.length,
        importance: scores.reduce((sum, score) => sum + score.factors.importance_score, 0) / scores.length,
        size: scores.reduce((sum, score) => sum + score.factors.size_penalty, 0) / scores.length,
        spam: scores.reduce((sum, score) => sum + score.factors.spam_score, 0) / scores.length,
        access: scores.reduce((sum, score) => sum + score.factors.access_score, 0) / scores.length
      };

      return {
        total_emails: emails.length,
        average_staleness: Math.round(averageStaleness * 1000) / 1000,
        recommendations,
        high_confidence_scores: highConfidenceScores,
        factor_averages: {
          age: Math.round(factorAverages.age * 1000) / 1000,
          importance: Math.round(factorAverages.importance * 1000) / 1000,
          size: Math.round(factorAverages.size * 1000) / 1000,
          spam: Math.round(factorAverages.spam * 1000) / 1000,
          access: Math.round(factorAverages.access * 1000) / 1000
        }
      };
    } catch (error) {
      logger.error('Failed to get staleness statistics:', error);
      throw error;
    }
  }

  /**
   * Update scoring weights (for tuning)
   */
  updateWeights(newWeights: Partial<typeof this.weights>): void {
    Object.assign(this.weights, newWeights);
    
    // Ensure weights sum to 1.0
    const totalWeight = Object.values(this.weights).reduce((sum, weight) => sum + weight, 0);
    if (Math.abs(totalWeight - 1.0) > 0.001) {
      logger.warn('Staleness scorer weights do not sum to 1.0', { 
        weights: this.weights, 
        total: totalWeight 
      });
    }

    logger.info('Updated staleness scoring weights', { weights: this.weights });
  }

  /**
   * Get current scoring configuration
   */
  getConfiguration() {
    return {
      weights: { ...this.weights },
      thresholds: { ...this.thresholds }
    };
  }
}