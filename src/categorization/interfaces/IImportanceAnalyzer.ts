import { IAnalyzer, AnalysisContext, AnalysisResult } from './IAnalyzer.js';
import { EmailIndex } from '../../types/index.js';

/**
 * Context for email importance analysis
 */
export interface EmailAnalysisContext extends AnalysisContext {
  email: EmailIndex;
  user_id: string;
  subject: string;
  sender: string;
  snippet: string;
  labels: string[];
  date: Date;
  size: number;
  hasAttachments: boolean;
}

/**
 * Result of importance analysis
 */
export interface ImportanceResult extends AnalysisResult {
  score: number;
  level: 'high' | 'medium' | 'low';
  matchedRules: string[];
  confidence: number;
}

/**
 * Configuration for importance rules
 */
export interface ImportanceRule {
  id: string;
  name: string;
  priority: number;
  condition: RuleCondition;
  weight: number;
  evaluate(context: EmailAnalysisContext): RuleResult;
}

/**
 * Rule condition interface
 */
export interface RuleCondition {
  type: string;
  [key: string]: any;
}

/**
 * Result of rule evaluation
 */
export interface RuleResult {
  matched: boolean;
  score: number;
  reason?: string;
}

/**
 * Configuration for ImportanceAnalyzer
 */
export interface ImportanceAnalyzerConfig {
  rules: ImportanceRuleConfig[];
  scoring: {
    highThreshold: number;
    lowThreshold: number;
    defaultWeight: number;
  };
  caching: {
    enabled: boolean;
    keyStrategy: 'full' | 'partial';
  };
}

/**
 * Configuration for individual importance rules
 */
export interface ImportanceRuleConfig {
  id: string;
  name: string;
  type: string;
  priority: number;
  weight: number;
  [key: string]: any;
}

/**
 * Interface for importance analysis functionality
 */
export interface IImportanceAnalyzer extends IAnalyzer {
  /**
   * Analyzes the importance of an email based on various factors
   * @param context - Email analysis context
   * @returns Promise resolving to importance analysis result
   */
  analyzeImportance(context: EmailAnalysisContext): Promise<ImportanceResult>;

  /**
   * Registers a new importance rule
   * @param rule - The importance rule to register
   */
  registerRule(rule: ImportanceRule): void;

  /**
   * Gets applicable rules for the given context
   * @param context - Email analysis context
   * @returns Array of applicable importance rules
   */
  getApplicableRules(context: EmailAnalysisContext): ImportanceRule[];
}