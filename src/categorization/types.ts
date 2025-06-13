
// Re-export analyzer interfaces and types for convenience
export type {
  IAnalyzer,
  AnalysisContext,
  AnalysisResult,
  AnalyzerConfig
} from './interfaces/IAnalyzer.js';

export type {
  IImportanceAnalyzer,
  EmailAnalysisContext,
  ImportanceResult,
  ImportanceRule,
  ImportanceAnalyzerConfig,
  ImportanceRuleConfig,
  RuleResult,
  RuleCondition
} from './interfaces/IImportanceAnalyzer.js';

export type {
  IDateSizeAnalyzer,
  DateSizeResult,
  AgeCategory,
  SizeCategory,
  DateSizeAnalyzerConfig
} from './interfaces/IDateSizeAnalyzer.js';

export type {
  ILabelClassifier,
  LabelClassification,
  GmailCategory,
  SpamScore,
  LabelClassifierConfig
} from './interfaces/ILabelClassifier.js';

// Combined analysis result for orchestration
export interface CombinedAnalysisResult {
  importance: import('./interfaces/IImportanceAnalyzer.js').ImportanceResult;
  dateSize: import('./interfaces/IDateSizeAnalyzer.js').DateSizeResult;
  labelClassification: import('./interfaces/ILabelClassifier.js').LabelClassification;
  finalCategory: import('../types/index.js').PriorityCategory;
  confidence: number;
  reasoning: string[];
  processingTime: number;
}

// Analysis performance metrics
export interface AnalysisMetrics {
  totalProcessingTime: number;
  importanceAnalysisTime: number;
  dateSizeAnalysisTime: number;
  labelClassificationTime: number;
  cacheHits: number;
  cacheMisses: number;
  rulesEvaluated: number;
}

export const Labels = {
    IMPORTANT: 'important',
    NEWSLETTER: 'newsletter',
    PROMOTIONAL: 'promotional',
    SALE: 'sale',
    OFFER: 'offer',
    DISCOUNT: 'discount',
    DEAL: 'deal',
    UNWANTED: 'unwanted',
    SPAM: 'spam',
    NO_REPLY: 'no-reply',
    AUTOMATED: 'automated',
    NOTIFICATION: 'notification',
    UNSUBSCRIBE: 'unsubscribe',
    OTHER: 'other',
    CATEGORY_PROMOTIONS:"category_promotions",
    CATEGORY_SOCIAL: "category_social",
};
export type LabelsType = keyof typeof Labels;