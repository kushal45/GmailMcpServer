import { IAnalyzer, AnalysisResult } from './IAnalyzer.js';
import { EmailAnalysisContext } from './IImportanceAnalyzer.js';

/**
 * Age category enumeration
 */
export type AgeCategory = 'recent' | 'moderate' | 'old';

/**
 * Size category enumeration
 */
export type SizeCategory = 'small' | 'medium' | 'large';

/**
 * Result of date and size analysis
 */
export interface DateSizeResult extends AnalysisResult {
  ageCategory: AgeCategory;
  sizeCategory: SizeCategory;
  recencyScore: number;
  sizePenalty: number;
}

/**
 * Configuration for date and size analysis
 */
export interface DateSizeAnalyzerConfig {
  sizeThresholds: {
    small: number;    // bytes
    medium: number;   // bytes
    large: number;    // bytes
  };
  ageCategories: {
    recent: number;   // days
    moderate: number; // days
    old: number;      // days
  };
  scoring: {
    recencyWeight: number;
    sizeWeight: number;
  };
  caching: {
    enabled: boolean;
    ttl: number;
  };
}

/**
 * Interface for date and size analysis functionality
 */
export interface IDateSizeAnalyzer extends IAnalyzer {
  /**
   * Analyzes email based on date and size factors
   * @param context - Email analysis context
   * @returns Promise resolving to date/size analysis result
   */
  analyzeDateSize(context: EmailAnalysisContext): Promise<DateSizeResult>;

  /**
   * Categorizes email by age
   * @param date - Email date
   * @returns Age category
   */
  categorizeByAge(date: Date): AgeCategory;

  /**
   * Categorizes email by size
   * @param size - Email size in bytes
   * @returns Size category
   */
  categorizeBySize(size: number): SizeCategory;
}