/**
 * Base interface for all analyzers in the categorization system.
 * Provides common functionality for analysis operations and configuration.
 */
export interface IAnalyzer {
  /**
   * Performs analysis on the provided context
   * @param context - The analysis context containing email data
   * @returns Promise resolving to analysis result
   */
  analyze(context: AnalysisContext): Promise<AnalysisResult>;

  /**
   * Configures the analyzer with provided settings
   * @param config - Configuration object for the analyzer
   */
  configure(config: AnalyzerConfig): void;
}

/**
 * Base analysis context interface
 */
export interface AnalysisContext {
  [key: string]: any;
}

/**
 * Base analysis result interface
 */
export interface AnalysisResult {
  [key: string]: any;
}

/**
 * Base analyzer configuration interface
 */
export interface AnalyzerConfig {
  [key: string]: any;
}