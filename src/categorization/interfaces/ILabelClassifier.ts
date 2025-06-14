import { IAnalyzer, AnalysisResult } from './IAnalyzer.js';
import { EmailAnalysisContext } from './IImportanceAnalyzer.js';

/**
 * Gmail category enumeration
 */
export type GmailCategory = 'primary' | 'social' | 'promotions' | 'updates' | 'forums' | 'spam' | 'important' | 'other';

/**
 * Spam score interface
 */
export interface SpamScore {
  score: number;
  indicators: string[];
  confidence: number;
}

/**
 * Result of label classification
 */
export interface LabelClassification extends AnalysisResult {
  category: GmailCategory;
  spamScore: number;
  promotionalScore: number;
  socialScore: number;
  indicators: {
    spam: string[];
    promotional: string[];
    social: string[];
  };
}

/**
 * Configuration for label classifier
 */
export interface LabelClassifierConfig {
  labelMappings: {
    gmailToCategory: Record<string, GmailCategory>;
    spamLabels: string[];
    promotionalLabels: string[];
    socialLabels: string[];
  };
  scoring: {
    spamThreshold: number;
    promotionalThreshold: number;
    socialThreshold: number;
  };
  caching: {
    enabled: boolean;
    ttl: number;
  };
}

/**
 * Interface for label classification functionality
 */
export interface ILabelClassifier extends IAnalyzer {
  /**
   * Classifies email labels into categories
   * @param labels - Array of email labels
   * @returns Promise resolving to label classification result
   */
  classifyLabels(labels: string[]): Promise<LabelClassification>;

  /**
   * Detects spam indicators in labels
   * @param labels - Array of email labels
   * @returns Spam score with indicators
   */
  detectSpamIndicators(labels: string[]): SpamScore;

  /**
   * Categorizes email based on Gmail labels
   * @param labels - Array of Gmail labels
   * @returns Gmail category
   */
  categorizeByGmailLabels(labels: string[]): GmailCategory;
}