/**
 * Foundational Testing Infrastructure for CleanupDeleteIntegration Tests
 * 
 * This module provides a comprehensive testing infrastructure designed to support
 * the redesigned integration tests for cleanup operations. The infrastructure
 * implements the configuration-per-test pattern with hierarchical configs,
 * database transaction isolation, structured test reporting, and better test architecture.
 * 
 * Key Components:
 * - TestScenarioRunner: Isolated test context pattern with configuration injection
 * - DatabaseTestManager: Transaction-based database isolation with automatic cleanup
 * - ConfigurationManager: Hierarchical configuration system with predefined presets
 * - TestExecutionTracker: Structured logging and decision tracking for debugging
 * - CleanupTestAssertions: Detailed assertion methods with contextual error messages
 * 
 * Usage Example:
 * ```typescript
 * import {
 *   TestScenarioRunner,
 *   ConfigurationManager,
 *   TestScenarioConfig
 * } from './infrastructure';
 * 
 * // Create a test scenario with hierarchical configuration
 * const scenario: TestScenarioConfig = {
 *   name: 'Permissive Deletion Test',
 *   category: 'permissive',
 *   emails: testEmails,
 *   policies: testPolicies,
 *   execution: { dryRun: false, maxEmails: 10 },
 *   expected: { success: true, emailsDeleted: { min: 5, max: 10 } }
 * };
 * 
 * // Execute test with full isolation and tracking
 * const runner = new TestScenarioRunner();
 * const context = await runner.createIsolatedContext(scenario);
 * const report = await runner.executeTest(context);
 * await runner.cleanupContext(context);
 * ```
 * 
 * Configuration Presets:
 * - PERMISSIVE_DELETION: Very permissive for testing deletion scenarios
 * - STRICT_SAFETY: Production-grade safety for testing safety mechanisms
 * - EDGE_CASE_TESTING: Boundary conditions and edge case scenarios
 * 
 * @author Kilo Code
 * @version 1.0.0
 */

// Type definitions and interfaces (export as types only)
export type {
  // Core types
  TestScenarioConfig,
  TestContext,
  TestExecutionReport,
  ExpectedResults,
  
  // Configuration types
  SafetyTestConfig,
  AutomationTestConfig,
  ConfigurationPreset,
  HierarchicalConfig,
  
  // Tracking and reporting types
  DecisionRecord,
  SafeguardRecord,
  RiskRecord,
  EmailProcessingTrace,
  PolicyEvaluationTrace,
  TestExecutionStats,
  
  // Assertion types
  AssertionContext,
  CleanupAssertionResult,
  ValidationFailure,
  
  // Database types
  DatabaseIsolationContext
} from './types.js';

// Core infrastructure classes
export { TestScenarioRunner } from './TestScenarioRunner';
export { DatabaseTestManager } from './DatabaseTestManager';
export { ConfigurationManager } from './ConfigurationManager';
export { TestExecutionTracker } from './TestExecutionTracker';
export { CleanupTestAssertions, CustomAssertionBuilder } from './CleanupTestAssertions';

// Import types for internal use
import type {
  TestScenarioConfig,
  ConfigurationPreset
} from './types.js';
import { TestScenarioRunner } from './TestScenarioRunner';
import { DatabaseTestManager } from './DatabaseTestManager';
import { ConfigurationManager } from './ConfigurationManager';
import { TestExecutionTracker } from './TestExecutionTracker';
import { CleanupTestAssertions } from './CleanupTestAssertions';

/**
 * Utility functions for common test infrastructure operations
 */

/**
 * Create a basic test scenario configuration with sensible defaults
 * 
 * @param name - Test scenario name
 * @param category - Test category (permissive, strict, edge_case, performance)
 * @param overrides - Configuration overrides
 * @returns Complete test scenario configuration
 */
export function createTestScenario(
  name: string,
  category: 'permissive' | 'strict' | 'edge_case' | 'performance',
  overrides: Partial<TestScenarioConfig> = {}
): TestScenarioConfig {
  const baseConfig: TestScenarioConfig = {
    name,
    description: `Test scenario: ${name}`,
    category,
    emails: [],
    policies: [],
    execution: {
      dryRun: false,
      maxEmails: 10,
      batchSize: 5,
      timeout: 30000
    },
    expected: {
      success: true,
      emailsProcessed: { min: 0 },
      emailsDeleted: { min: 0 },
      storageFreed: { min: 0 },
      errors: { maxCount: 0 }
    },
    tags: [category],
    priority: 'medium'
  };

  return { ...baseConfig, ...overrides };
}

/**
 * Create a permissive deletion test scenario
 * 
 * @param name - Test scenario name
 * @param emails - Test emails to process
 * @param policies - Test policies to apply
 * @param expectedDeleted - Expected number of emails to be deleted
 * @returns Permissive deletion test scenario
 */
export function createPermissiveDeletionScenario(
  name: string,
  emails: any[],
  policies: any[],
  expectedDeleted: { min?: number; max?: number; exact?: number }
): TestScenarioConfig {
  return createTestScenario(name, 'permissive', {
    description: `Permissive deletion test: ${name}`,
    emails,
    policies,
    expected: {
      success: true,
      emailsProcessed: { min: expectedDeleted.min || 0, max: emails.length },
      emailsDeleted: expectedDeleted,
      storageFreed: { min: 0 },
      errors: { maxCount: 0 }
    },
    tags: ['permissive', 'deletion', 'automated']
  });
}

/**
 * Create an archive test scenario
 *
 * @param name - Test scenario name
 * @param emails - Test emails to process
 * @param policies - Test policies to apply (should have archive action)
 * @param expectedArchived - Expected number of emails to be archived
 * @returns Archive test scenario
 */
export function createArchiveScenario(
  name: string,
  emails: any[],
  policies: any[],
  expectedArchived: { min?: number; max?: number; exact?: number }
): TestScenarioConfig {
  return createTestScenario(name, 'permissive', {
    description: `Archive test: ${name}`,
    emails,
    policies,
    expected: {
      success: true,
      emailsProcessed: { min: expectedArchived.min || 0, max: emails.length },
      emailsDeleted: { exact: 0 }, // Archive operations should not delete emails
      emailsArchived: expectedArchived, // Archive operations produce archived emails
      storageFreed: { min: 0 },
      errors: { maxCount: 0 }
    },
    tags: ['permissive', 'archive', 'automated']
  });
}

/**
 * Create a strict safety test scenario
 * 
 * @param name - Test scenario name
 * @param emails - Test emails to process
 * @param policies - Test policies to apply
 * @param expectedProtected - Expected number of emails to be protected
 * @returns Strict safety test scenario
 */
export function createStrictSafetyScenario(
  name: string,
  emails: any[],
  policies: any[],
  expectedProtected: { min?: number; max?: number; exact?: number }
): TestScenarioConfig {
  return createTestScenario(name, 'strict', {
    description: `Strict safety test: ${name}`,
    emails,
    policies,
    expected: {
      success: true,
      emailsProcessed: { min: 1, max: emails.length },
      emailsDeleted: { max: emails.length - (expectedProtected.min || 0) },
      storageFreed: { min: 0 },
      errors: { maxCount: 0 },
      protectedEmails: expectedProtected
    },
    tags: ['strict', 'safety', 'protection']
  });
}

/**
 * Create a safety protection test scenario
 *
 * @param name - Test scenario name
 * @param emails - Test emails to process (should be protected)
 * @param policies - Test policies to apply (with safety restrictions)
 * @param expectedProtected - Expected number of emails to be protected
 * @returns Safety protection test scenario
 */
export function createSafetyProtectionScenario(
  name: string,
  emails: any[],
  policies: any[],
  expectedProtected: { min?: number; max?: number; exact?: number }
): TestScenarioConfig {
  return createTestScenario(name, 'strict', {
    description: `Safety protection test: ${name}`,
    emails,
    policies,
    expected: {
      success: true,
      emailsProcessed: { min: 0, max: emails.length }, // Allow 0 processing for full protection
      emailsDeleted: { exact: 0 }, // Safety protection should result in 0 deletions
      storageFreed: { min: 0 },
      errors: { maxCount: 0 },
      protectedEmails: expectedProtected
    },
    tags: ['strict', 'safety', 'protection', 'zero-deletion']
  });
}

/**
 * Create an error handling test scenario
 *
 * @param name - Test scenario name
 * @param emails - Test emails to process
 * @param policies - Test policies to apply
 * @param expectedErrors - Expected number of errors to be handled
 * @returns Error handling test scenario
 */
export function createErrorHandlingScenario(
  name: string,
  emails: any[],
  policies: any[],
  expectedErrors: { min?: number; max?: number; exact?: number }
): TestScenarioConfig {
  return createTestScenario(name, 'permissive', {
    description: `Error handling test: ${name}`,
    emails,
    policies,
    expected: {
      success: false, // Error scenarios should expect failure as success
      emailsProcessed: { min: 0, max: emails.length },
      emailsDeleted: { min: 0, max: emails.length }, // Some may succeed before errors
      storageFreed: { min: 0 },
      errors: {
        maxCount: expectedErrors.max || expectedErrors.exact || 10
      }
    },
    tags: ['permissive', 'error-handling', 'resilience']
  });
}

/**
 * Create an edge case test scenario
 * 
 * @param name - Test scenario name
 * @param emails - Test emails to process (usually 1 for edge cases)
 * @param policies - Test policies to apply
 * @returns Edge case test scenario
 */
export function createEdgeCaseScenario(
  name: string,
  emails: any[],
  policies: any[]
): TestScenarioConfig {
  return createTestScenario(name, 'edge_case', {
    description: `Edge case test: ${name}`,
    emails,
    policies,
    execution: {
      dryRun: false,
      maxEmails: 1,
      batchSize: 1,
      timeout: 60000
    },
    expected: {
      success: true,
      emailsProcessed: { min: 0, max: 1 },
      emailsDeleted: { min: 0, max: 1 },
      storageFreed: { min: 0 },
      errors: { maxCount: 0 }
    },
    tags: ['edge-case', 'boundary', 'single-email']
  });
}

/**
 * Create a performance test scenario
 * 
 * @param name - Test scenario name
 * @param emails - Large set of test emails
 * @param policies - Test policies to apply
 * @param maxExecutionTime - Maximum allowed execution time in ms
 * @returns Performance test scenario
 */
export function createPerformanceScenario(
  name: string,
  emails: any[],
  policies: any[],
  maxExecutionTime: number = 120000
): TestScenarioConfig {
  return createTestScenario(name, 'performance', {
    description: `Performance test: ${name}`,
    emails,
    policies,
    execution: {
      dryRun: false,
      maxEmails: emails.length,
      batchSize: 50,
      timeout: maxExecutionTime
    },
    expected: {
      success: false, // Performance tests focus on metrics, not cleanup success
      emailsProcessed: { min: 1, max: emails.length },
      emailsDeleted: { min: 0, max: emails.length },
      storageFreed: { min: 0 },
      errors: { maxCount: emails.length }, // Allow failures in performance tests
      performanceMetrics: {
        maxExecutionTimeMs: maxExecutionTime,
        maxMemoryUsageMB: 256
      }
    },
    tags: ['performance', 'high-volume', 'stress-test']
  });
}

/**
 * Infrastructure constants and defaults
 */
export const INFRASTRUCTURE_CONSTANTS = {
  // Default timeouts
  DEFAULT_TEST_TIMEOUT: 30000,
  DEFAULT_CLEANUP_TIMEOUT: 10000,
  DEFAULT_DATABASE_TIMEOUT: 5000,
  
  // Default batch sizes
  DEFAULT_EMAIL_BATCH_SIZE: 5,
  DEFAULT_POLICY_BATCH_SIZE: 3,
  
  // Default safety thresholds
  DEFAULT_MAX_DELETIONS_PER_TEST: 100,
  DEFAULT_MAX_ERRORS_PER_TEST: 0,
  
  // Configuration preset names
  PRESETS: {
    PERMISSIVE_DELETION: 'PERMISSIVE_DELETION',
    STRICT_SAFETY: 'STRICT_SAFETY',
    EDGE_CASE_TESTING: 'EDGE_CASE_TESTING'
  },
  
  // Test categories
  CATEGORIES: {
    PERMISSIVE: 'permissive',
    STRICT: 'strict',
    EDGE_CASE: 'edge_case',
    PERFORMANCE: 'performance'
  },
  
  // Common test tags
  TAGS: {
    AUTOMATED: 'automated',
    MANUAL: 'manual',
    DELETION: 'deletion',
    SAFETY: 'safety',
    PERFORMANCE: 'performance',
    EDGE_CASE: 'edge-case',
    INTEGRATION: 'integration',
    UNIT: 'unit'
  }
} as const;

/**
 * Infrastructure version and metadata
 */
export const INFRASTRUCTURE_VERSION = '1.0.0';
export const INFRASTRUCTURE_BUILD_DATE = new Date().toISOString();

/**
 * Quick start function for setting up infrastructure
 * 
 * @param options - Setup options
 * @returns Configured infrastructure instances
 */
export async function setupTestInfrastructure(options: {
  enableDetailedLogging?: boolean;
  enableSafetyMetrics?: boolean;
  customPresets?: ConfigurationPreset[];
} = {}) {
  const configManager = new ConfigurationManager();
  const dbManager = new DatabaseTestManager();
  const executionTracker = new TestExecutionTracker();
  const assertions = new CleanupTestAssertions();
  
  const runner = new TestScenarioRunner(
    dbManager,
    configManager,
    executionTracker,
    assertions
  );

  // Register custom presets if provided
  if (options.customPresets) {
    options.customPresets.forEach(preset => {
      configManager.registerPreset(preset);
    });
  }

  return {
    runner,
    configManager,
    dbManager,
    executionTracker,
    assertions
  };
}

/**
 * Cleanup function for test infrastructure
 * 
 * @param infrastructure - Infrastructure instances to cleanup
 */
export async function cleanupTestInfrastructure(infrastructure: {
  runner: TestScenarioRunner;
  dbManager: DatabaseTestManager;
  executionTracker: TestExecutionTracker;
}) {
  try {
    await infrastructure.runner.cleanupAllContexts();
    await infrastructure.dbManager.dispose();
    await infrastructure.executionTracker.clearAllData();
  } catch (error) {
    console.error('Failed to cleanup test infrastructure:', error);
  }
}