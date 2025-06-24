import {
  IDateSizeAnalyzer,
  DateSizeResult,
  AgeCategory,
  SizeCategory,
  DateSizeAnalyzerConfig,
} from "../interfaces/IDateSizeAnalyzer.js";
import { EmailAnalysisContext } from "../interfaces/IImportanceAnalyzer.js";
import {
  AnalysisContext,
  AnalysisResult,
  AnalyzerConfig,
} from "../interfaces/IAnalyzer.js";
import { CacheManager } from "../../cache/CacheManager.js";
import { logger } from "../../utils/logger.js";

/**
 * DateSizeAnalyzer implementation that categorizes emails based on
 * their date (age) and size characteristics.
 */
export class DateSizeAnalyzer implements IDateSizeAnalyzer {
  private config: DateSizeAnalyzerConfig;
  private cacheManager?: CacheManager;

  constructor(config: DateSizeAnalyzerConfig, cacheManager?: CacheManager) {
    this.config = config;
    this.cacheManager = cacheManager;
  }

  /**
   * Analyzes email based on date and size factors
   */
  async analyzeDateSize(
    context: EmailAnalysisContext
  ): Promise<DateSizeResult> {
    const cacheKey = this.generateCacheKey(context);
    // Check cache first if enabled
    if (this.config.caching.enabled && this.cacheManager) {
      const cached = this.getCachedResult(cacheKey);
      if (cached) {
        logger.debug("DateSizeAnalyzer: Cache hit", { cacheKey });
        return cached;
      }
    }

    // Perform analysis
    const ageCategory = this.categorizeByAge(context.date);
    const sizeCategory = this.categorizeBySize(context.size);
    const recencyScore = this.calculateRecencyScore(context.date);
    const sizePenalty = this.calculateSizePenalty(context.size);

    const result: DateSizeResult = {
      ageCategory,
      sizeCategory,
      recencyScore,
      sizePenalty,
    };

    // Cache result if enabled
    if (this.config.caching.enabled && this.cacheManager) {
      this.cacheResult(cacheKey, result);
    }

    logger.debug("DateSizeAnalyzer: Analysis complete", {
      ageCategory,
      sizeCategory,
      recencyScore,
      sizePenalty,
    });

    return result;
  }

  /**
   * Base analyze method implementation
   */
  async analyze(context: AnalysisContext): Promise<AnalysisResult> {
    if (!this.isEmailAnalysisContext(context)) {
      throw new Error("DateSizeAnalyzer requires EmailAnalysisContext");
    }
    return this.analyzeDateSize(context);
  }

  /**
   * Configure the analyzer
   */
  configure(config: AnalyzerConfig): void {
    if (this.isDateSizeAnalyzerConfig(config)) {
      this.config = config;
    } else {
      throw new Error("DateSizeAnalyzer requires DateSizeAnalyzerConfig");
    }
  }

  /**
   * Categorizes email by age
   */
  categorizeByAge(date: Date): AgeCategory {
    const now = new Date();
    const daysDiff = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysDiff <= this.config.ageCategories.recent) {
      return "recent";
    } else if (daysDiff <= this.config.ageCategories.moderate) {
      return "moderate";
    } else {
      return "old";
    }
  }

  /**
   * Categorizes email by size
   */
  categorizeBySize(size: number): SizeCategory {
    if (size <= this.config.sizeThresholds.small) {
      return "small";
    } else if (size <= this.config.sizeThresholds.medium) {
      return "medium";
    } else {
      return "large";
    }
  }

  /**
   * Calculate recency score (higher for more recent emails)
   */
  private calculateRecencyScore(date: Date): number {
    const now = new Date();
    const daysDiff = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Score decreases exponentially with age
    // Recent emails (0-7 days) get high scores (0.8-1.0)
    // Moderate emails (8-30 days) get medium scores (0.4-0.8)
    // Old emails (30+ days) get low scores (0.0-0.4)

    if (daysDiff <= 7) {
      return 1.0 - daysDiff / 14; // 1.0 to 0.5
    } else if (daysDiff <= 30) {
      return 0.5 - (daysDiff - 7) / 46; // 0.5 to 0.0
    } else {
      return Math.max(0, 0.2 - (daysDiff - 30) / 365); // Gradual decline to 0
    }
  }

  /**
   * Calculate size penalty (higher penalty for larger emails)
   */
  private calculateSizePenalty(size: number): number {
    const sizeInMB = size / (1024 * 1024);

    // No penalty for small emails (< 1MB)
    if (sizeInMB < 1) {
      return 0;
    }

    // Linear penalty for medium emails (1-10MB)
    if (sizeInMB <= 10) {
      return (sizeInMB - 1) * 0.1; // 0.0 to 0.9
    }

    // Higher penalty for large emails (10MB+)
    return 0.9 + Math.min(0.1, (sizeInMB - 10) * 0.01); // 0.9 to 1.0
  }

  /**
   * Generate cache key for the analysis context
   */
  private generateCacheKey(context: EmailAnalysisContext): string {
    let dateStr = "";
    if (context.date instanceof Date && !isNaN(context.date.getTime())) {
      dateStr = context.date.toISOString().split("T")[0]; // YYYY-MM-DD
    }
    const sizeCategory = this.categorizeBySize(context.size);
    return `datesize:${context.userId}:${context.email.id}:${dateStr}:${sizeCategory}`;
  }

  /**
   * Get cached result
   */
  private getCachedResult(cacheKey: string): DateSizeResult | null {
    if (!this.cacheManager) return null;

    try {
      return this.cacheManager.get<DateSizeResult>(cacheKey);
    } catch (error) {
      logger.error("DateSizeAnalyzer: Cache retrieval failed", {
        cacheKey,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: new Error().stack,
      });
      return null;
    }
  }

  /**
   * Cache analysis result
   */
  private cacheResult(cacheKey: string, result: DateSizeResult): void {
    if (!this.cacheManager) return;

    try {
      // Cache for longer since date/size analysis is relatively stable
      this.cacheManager.set(cacheKey, result, String(this.config.caching.ttl));
    } catch (error) {
      logger.error("DateSizeAnalyzer: Cache storage failed", {
        cacheKey,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: new Error().stack,
      });
    }
  }

  /**
   * Type guard for EmailAnalysisContext
   */
  private isEmailAnalysisContext(
    context: AnalysisContext
  ): context is EmailAnalysisContext {
    return (
      typeof context === "object" &&
      context !== null &&
      "email" in context &&
      "date" in context &&
      "size" in context
    );
  }

  /**
   * Type guard for DateSizeAnalyzerConfig
   */
  private isDateSizeAnalyzerConfig(
    config: AnalyzerConfig
  ): config is DateSizeAnalyzerConfig {
    return (
      typeof config === "object" &&
      config !== null &&
      "sizeThresholds" in config &&
      "ageCategories" in config &&
      "scoring" in config &&
      "caching" in config
    );
  }
}
