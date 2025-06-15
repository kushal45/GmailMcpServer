import { CleanupPolicy, CleanupResults, EmailIndex, StalenessScore, AutomationStatus } from '../../../../src/types/index';

/**
 * Test scenario configuration for cleanup tests
 */
export interface TestScenarioConfig {
  name: string;
  description: string;
  
  // Test data configuration
  emails: EmailIndex[];
  policies: CleanupPolicy[];
  
  // Environment configuration
  safetyConfig?: SafetyTestConfig;
  automationConfig?: AutomationTestConfig;
  
  // Execution configuration
  execution: {
    dryRun?: boolean;
    maxEmails?: number;
    batchSize?: number;
    timeout?: number;
  };
  
  // Expected results
  expected: ExpectedResults;
  
  // Test metadata
  tags?: string[];
  priority?: 'low' | 'medium' | 'high' | 'critical';
  category?: 'permissive' | 'strict' | 'edge_case' | 'performance';
}

/**
 * Safety configuration for test scenarios
 */
export interface SafetyTestConfig {
  vipDomains?: string[];
  trustedDomains?: string[];
  whitelistDomains?: string[];
  criticalAttachmentTypes?: string[];
  legalDocumentTypes?: string[];
  financialDocumentTypes?: string[];
  contractDocumentTypes?: string[];
  activeThreadDays?: number;
  minThreadMessages?: number;
  recentReplyDays?: number;
  frequentContactThreshold?: number;
  importantSenderScore?: number;
  minInteractionHistory?: number;
  legalKeywords?: string[];
  complianceTerms?: string[];
  regulatoryKeywords?: string[];
  unreadRecentDays?: number;
  unreadImportanceBoost?: number;
  protectedLabels?: string[];
  criticalLabels?: string[];
  maxDeletionsPerHour?: number;
  maxDeletionsPerDay?: number;
  bulkOperationThreshold?: number;
  largeEmailThreshold?: number;
  unusualSizeMultiplier?: number;
  recentAccessDays?: number;
  recentForwardDays?: number;
  recentModificationDays?: number;
  minStalenessScore?: number;
  maxAccessScore?: number;
  importanceScoreThreshold?: number;
  enableSafetyMetrics?: boolean;
  enableDetailedLogging?: boolean;
}

/**
 * Automation configuration for test scenarios
 */
export interface AutomationTestConfig {
  continuousCleanup?: {
    enabled: boolean;
    targetEmailsPerMinute: number;
    maxConcurrentOperations: number;
  };
  eventTriggers?: {
    storageThreshold?: {
      enabled: boolean;
      warningThresholdPercent: number;
      criticalThresholdPercent: number;
    };
    performanceThreshold?: {
      enabled: boolean;
      queryTimeThresholdMs: number;
      cacheHitRateThreshold: number;
    };
  };
}

/**
 * Expected results for test scenarios
 */
export interface ExpectedResults {
  success: boolean;
  emailsProcessed: {
    min?: number;
    max?: number;
    exact?: number;
  };
  emailsDeleted: {
    min?: number;
    max?: number;
    exact?: number;
  };
  emailsArchived?: {
    min?: number;
    max?: number;
    exact?: number;
  };
  storageFreed: {
    min?: number;
    max?: number;
  };
  errors: {
    maxCount: number;
    allowedErrorTypes?: string[];
  };
  protectedEmails?: {
    min?: number;
    max?: number;
    reasons?: string[];
  };
  safeguardsTriggerCount?: {
    min?: number;
    max?: number;
  };
  performanceMetrics?: {
    maxExecutionTimeMs?: number;
    maxMemoryUsageMB?: number;
  };
}

/**
 * Test execution context for isolated test runs
 */
export interface TestContext {
  id: string;
  scenario: TestScenarioConfig;
  
  // Isolated instances
  dbManager: any; // DatabaseManager instance
  cleanupEngine: any; // CleanupAutomationEngine instance
  policyEngine: any; // CleanupPolicyEngine instance
  deleteManager: any; // DeleteManager instance
  
  // Mock instances
  mockGmailClient: any;
  mockAuthManager: any;
  
  // Test state
  startTime: Date;
  endTime?: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
  
  // Cleanup functions
  cleanup: (() => Promise<void>)[];
}

/**
 * Test execution report for detailed analysis
 */
export interface TestExecutionReport {
  testId: string;
  scenarioName: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  
  // Execution results
  results: CleanupResults;
  actualResults: {
    emailsProcessed: number;
    emailsDeleted: number;
    emailsArchived: number;
    storageFreed: number;
    errorsCount: number;
    protectedEmailsCount: number;
  };
  
  // Performance metrics
  performance: {
    executionTimeMs: number;
    memoryUsageMB: number;
    peakMemoryMB: number;
    databaseQueries: number;
    apiCalls: number;
  };
  
  // Decision tracking
  decisions: DecisionRecord[];
  
  // Safety analysis
  safetyAnalysis: {
    safeguardsTriggered: SafeguardRecord[];
    protectedEmailReasons: Record<string, number>;
    risksIdentified: RiskRecord[];
  };
  
  // Validation results
  validation: {
    passed: boolean;
    failures: ValidationFailure[];
    warnings: string[];
  };
  
  // Debug information
  debug: {
    logs: string[];
    emailProcessingTrace: EmailProcessingTrace[];
    policyEvaluationTrace: PolicyEvaluationTrace[];
  };
}

/**
 * Decision record for tracking test execution decisions
 */
export interface DecisionRecord {
  timestamp: Date;
  phase: 'setup' | 'policy_evaluation' | 'safety_check' | 'execution' | 'cleanup';
  type: 'email_selection' | 'policy_application' | 'safety_trigger' | 'execution_decision';
  emailId?: string;
  policyId?: string;
  decision: string;
  reason: string;
  metadata?: Record<string, any>;
}

/**
 * Safeguard record for tracking safety mechanisms
 */
export interface SafeguardRecord {
  timestamp: Date;
  emailId: string;
  safeguardType: string;
  triggered: boolean;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

/**
 * Risk record for tracking identified risks
 */
export interface RiskRecord {
  timestamp: Date;
  type: 'data_loss' | 'performance' | 'safety' | 'compliance';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  mitigation: string;
  emailId?: string;
  policyId?: string;
}

/**
 * Validation failure record
 */
export interface ValidationFailure {
  field: string;
  expected: any;
  actual: any;
  message: string;
  severity: 'warning' | 'error' | 'critical';
}

/**
 * Email processing trace for debugging
 */
export interface EmailProcessingTrace {
  emailId: string;
  phase: string;
  timestamp: Date;
  action: string;
  result: 'success' | 'skipped' | 'failed' | 'protected';
  reason?: string;
  duration?: number;
  metadata?: Record<string, any>;
}

/**
 * Policy evaluation trace for debugging
 */
export interface PolicyEvaluationTrace {
  emailId: string;
  policyId: string;
  timestamp: Date;
  criteriaEvaluation: Record<string, boolean>;
  safetyChecks: Record<string, boolean>;
  finalDecision: 'apply' | 'skip' | 'protect';
  reason: string;
  confidence: number;
}

/**
 * Predefined configuration presets for common test scenarios
 */
export interface ConfigurationPreset {
  name: string;
  description: string;
  safetyConfig: SafetyTestConfig;
  automationConfig?: AutomationTestConfig;
  tags: string[];
}

/**
 * Database transaction isolation context
 */
export interface DatabaseIsolationContext {
  transactionId: string;
  startTime: Date;
  rollbackFunctions: (() => Promise<void>)[];
  isActive: boolean;
}

/**
 * Test execution statistics for reporting
 */
export interface TestExecutionStats {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDuration: number;
  averageDuration: number;
  categories: Record<string, {
    total: number;
    passed: number;
    failed: number;
  }>;
  riskDistribution: Record<string, number>;
  safeguardEffectiveness: Record<string, {
    triggered: number;
    prevented: number;
    effectiveness: number;
  }>;
}

/**
 * Configuration hierarchical structure
 */
export interface HierarchicalConfig {
  global: Partial<TestScenarioConfig>;
  category: Record<string, Partial<TestScenarioConfig>>;
  scenario: Record<string, Partial<TestScenarioConfig>>;
}

/**
 * Test assertion context for detailed error reporting
 */
export interface AssertionContext {
  testId: string;
  scenarioName: string;
  phase: string;
  timestamp: Date;
  emailContext?: {
    emailId: string;
    category: string;
    sender: string;
    subject: string;
  };
  policyContext?: {
    policyId: string;
    policyName: string;
    criteria: any;
  };
}

/**
 * Cleanup assertion result for detailed validation
 */
export interface CleanupAssertionResult {
  passed: boolean;
  message: string;
  context: AssertionContext;
  expected: any;
  actual: any;
  severity: 'info' | 'warning' | 'error' | 'critical';
  suggestions?: string[];
  debugInfo?: Record<string, any>;
}