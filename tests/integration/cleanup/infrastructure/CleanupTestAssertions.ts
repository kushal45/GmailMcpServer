import {
  ExpectedResults,
  AssertionContext,
  CleanupAssertionResult,
  ValidationFailure
} from './types';
import { CleanupResults } from '../../../../src/types/index';
import { logger } from '../../../../src/utils/logger';

/**
 * CleanupTestAssertions provides detailed assertion methods with contextual error messages.
 * 
 * This class implements comprehensive test assertions specifically designed for cleanup operations,
 * providing detailed failure reporting with actionable suggestions for debugging.
 * 
 * Key Features:
 * - Detailed assertion methods with contextual error messages
 * - Actionable suggestions when assertions fail
 * - Range-based and exact value assertions
 * - Performance and safety metric validations
 * - Structured error reporting with debugging context
 * - Custom assertion builders for complex scenarios
 * 
 * @example
 * ```typescript
 * const assertions = new CleanupTestAssertions();
 * const result = await assertions.assertCleanupResults(
 *   actualResults,
 *   expectedResults,
 *   context
 * );
 * 
 * if (!result.passed) {
 *   console.error(`Assertion failed: ${result.message}`);
 *   result.suggestions?.forEach(suggestion => console.log(`- ${suggestion}`));
 * }
 * ```
 */
export class CleanupTestAssertions {
  constructor() {
    logger.debug('CleanupTestAssertions initialized');
  }

  /**
   * Assert cleanup results against expected outcomes with detailed reporting
   * 
   * @param actualResults - Actual cleanup results from test execution
   * @param expectedResults - Expected results configuration
   * @param context - Assertion context for detailed error reporting
   * @returns Detailed assertion result with debugging information
   */
  async assertCleanupResults(
    actualResults: CleanupResults,
    expectedResults: ExpectedResults,
    context: AssertionContext
  ): Promise<CleanupAssertionResult> {
    try {
      logger.debug('Asserting cleanup results', {
        test_id: context.testId,
        scenario_name: context.scenarioName
      });

      const failures: string[] = [];
      const warnings: string[] = [];
      const suggestions: string[] = [];

      // Assert overall success
      if (actualResults.success !== expectedResults.success) {
        failures.push(
          `Expected success: ${expectedResults.success}, but got: ${actualResults.success}`
        );
        
        if (!actualResults.success && actualResults.errors.length > 0) {
          suggestions.push(`Review errors: ${actualResults.errors.join(', ')}`);
        } else if (actualResults.success && expectedResults.success === false) {
          suggestions.push('Test expected failure but cleanup succeeded - review test scenario expectations');
        }
      }

      // Assert emails processed
      const emailsProcessedResult = this.assertNumericRange(
        actualResults.emails_processed,
        expectedResults.emailsProcessed,
        'emails_processed'
      );
      if (!emailsProcessedResult.passed) {
        failures.push(emailsProcessedResult.message);
        suggestions.push(...(emailsProcessedResult.suggestions || []));
      }

      // Assert emails deleted
      const emailsDeletedResult = this.assertNumericRange(
        actualResults.emails_deleted,
        expectedResults.emailsDeleted,
        'emails_deleted'
      );
      if (!emailsDeletedResult.passed) {
        failures.push(emailsDeletedResult.message);
        suggestions.push(...(emailsDeletedResult.suggestions || []));
      }

      // Assert emails archived (if specified)
      if (expectedResults.emailsArchived) {
        const emailsArchivedResult = this.assertNumericRange(
          actualResults.emails_archived || 0,
          expectedResults.emailsArchived,
          'emails_archived'
        );
        if (!emailsArchivedResult.passed) {
          failures.push(emailsArchivedResult.message);
          suggestions.push(...(emailsArchivedResult.suggestions || []));
        }
      }

      // Assert storage freed
      const storageFreedResult = this.assertNumericRange(
        actualResults.storage_freed,
        expectedResults.storageFreed,
        'storage_freed'
      );
      if (!storageFreedResult.passed) {
        failures.push(storageFreedResult.message);
        suggestions.push(...(storageFreedResult.suggestions || []));
      }

      // Assert error count
      const errorCountResult = this.assertErrorCount(
        actualResults.errors.length,
        expectedResults.errors.maxCount,
        actualResults.errors,
        expectedResults.errors.allowedErrorTypes
      );
      if (!errorCountResult.passed) {
        failures.push(errorCountResult.message);
        suggestions.push(...(errorCountResult.suggestions || []));
      }

      // Generate consistency warnings
      this.generateConsistencyWarnings(actualResults, expectedResults, warnings, suggestions);

      // Generate performance warnings if applicable
      if (expectedResults.performanceMetrics) {
        this.generatePerformanceWarnings(actualResults, expectedResults, warnings, suggestions);
      }

      const passed = failures.length === 0;
      const severity = failures.length > 0 ? 'error' : (warnings.length > 0 ? 'warning' : 'info');

      const result: CleanupAssertionResult = {
        passed,
        message: passed 
          ? 'All cleanup result assertions passed'
          : `${failures.length} assertion failure(s): ${failures.join('; ')}`,
        context,
        expected: expectedResults,
        actual: actualResults,
        severity,
        suggestions: suggestions.length > 0 ? suggestions : undefined,
        debugInfo: {
          failures,
          warnings,
          actualResultsSummary: {
            success: actualResults.success,
            emails_processed: actualResults.emails_processed,
            emails_deleted: actualResults.emails_deleted,
            emails_archived: actualResults.emails_archived,
            storage_freed: actualResults.storage_freed,
            error_count: actualResults.errors.length
          },
          expectedResultsSummary: {
            success: expectedResults.success,
            emails_processed_range: this.formatRange(expectedResults.emailsProcessed),
            emails_deleted_range: this.formatRange(expectedResults.emailsDeleted),
            storage_freed_range: this.formatRange(expectedResults.storageFreed),
            max_errors: expectedResults.errors.maxCount
          }
        }
      };

      logger.debug('Cleanup results assertion completed', {
        test_id: context.testId,
        passed,
        failures_count: failures.length,
        warnings_count: warnings.length
      });

      return result;

    } catch (error) {
      logger.error('Failed to assert cleanup results', {
        test_id: context.testId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        passed: false,
        message: `Assertion error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        context,
        expected: expectedResults,
        actual: actualResults,
        severity: 'critical',
        suggestions: ['Review test setup and assertion logic'],
        debugInfo: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Assert that a numeric value falls within the expected range
   */
  private assertNumericRange(
    actual: number,
    expected: { min?: number; max?: number; exact?: number },
    fieldName: string
  ): CleanupAssertionResult {
    const suggestions: string[] = [];

    // Check exact value first
    if (expected.exact !== undefined) {
      if (actual !== expected.exact) {
        return {
          passed: false,
          message: `Expected ${fieldName} to be exactly ${expected.exact}, but got ${actual}`,
          context: {} as AssertionContext, // Will be filled by caller
          expected: expected.exact,
          actual,
          severity: 'error',
          suggestions: [
            `Review test scenario to ensure ${expected.exact} ${fieldName} are expected`,
            `Check policy criteria and email selection logic`,
            `Verify safety mechanisms are not over-protecting emails`
          ]
        };
      }
      return {
        passed: true,
        message: `${fieldName} matches expected exact value: ${actual}`,
        context: {} as AssertionContext,
        expected: expected.exact,
        actual,
        severity: 'info'
      };
    }

    // Check range values
    if (expected.min !== undefined && actual < expected.min) {
      suggestions.push(`Increase policy scope or reduce safety restrictions to achieve minimum ${expected.min} ${fieldName}`);
      suggestions.push(`Review email selection criteria - may be too restrictive`);
      suggestions.push(`Check if safety mechanisms are over-protecting emails`);
      
      return {
        passed: false,
        message: `Expected ${fieldName} to be at least ${expected.min}, but got ${actual}`,
        context: {} as AssertionContext,
        expected: { min: expected.min },
        actual,
        severity: 'error',
        suggestions
      };
    }

    if (expected.max !== undefined && actual > expected.max) {
      suggestions.push(`Reduce policy scope or increase safety restrictions to limit ${fieldName} to maximum ${expected.max}`);
      suggestions.push(`Review email selection criteria - may be too permissive`);
      suggestions.push(`Check if batch limits are being respected`);
      
      return {
        passed: false,
        message: `Expected ${fieldName} to be at most ${expected.max}, but got ${actual}`,
        context: {} as AssertionContext,
        expected: { max: expected.max },
        actual,
        severity: 'error',
        suggestions
      };
    }

    return {
      passed: true,
      message: `${fieldName} is within expected range: ${actual}`,
      context: {} as AssertionContext,
      expected,
      actual,
      severity: 'info'
    };
  }

  /**
   * Assert error count and types
   */
  private assertErrorCount(
    actualErrorCount: number,
    maxExpectedErrors: number,
    actualErrors: string[],
    allowedErrorTypes?: string[]
  ): CleanupAssertionResult {
    const suggestions: string[] = [];

    // Check error count
    if (actualErrorCount > maxExpectedErrors) {
      suggestions.push(`Review error sources: ${actualErrors.slice(0, 3).join(', ')}${actualErrors.length > 3 ? '...' : ''}`);
      suggestions.push('Check Gmail API configuration and mock setup');
      suggestions.push('Verify network simulation and error injection logic');
      
      return {
        passed: false,
        message: `Expected at most ${maxExpectedErrors} errors, but got ${actualErrorCount}`,
        context: {} as AssertionContext,
        expected: { maxCount: maxExpectedErrors },
        actual: { count: actualErrorCount, errors: actualErrors },
        severity: 'error',
        suggestions
      };
    }

    // Check error types if specified
    if (allowedErrorTypes && allowedErrorTypes.length > 0 && actualErrors.length > 0) {
      const unexpectedErrors = actualErrors.filter(error => 
        !allowedErrorTypes.some(allowedType => error.includes(allowedType))
      );

      if (unexpectedErrors.length > 0) {
        suggestions.push(`Unexpected error types found: ${unexpectedErrors.join(', ')}`);
        suggestions.push(`Allowed error types: ${allowedErrorTypes.join(', ')}`);
        suggestions.push('Update test expectations or fix underlying issues');
        
        return {
          passed: false,
          message: `Found ${unexpectedErrors.length} unexpected error type(s)`,
          context: {} as AssertionContext,
          expected: { allowedTypes: allowedErrorTypes },
          actual: { unexpectedErrors },
          severity: 'error',
          suggestions
        };
      }
    }

    return {
      passed: true,
      message: `Error count is within expected range: ${actualErrorCount}`,
      context: {} as AssertionContext,
      expected: { maxCount: maxExpectedErrors },
      actual: { count: actualErrorCount },
      severity: 'info'
    };
  }

  /**
   * Generate consistency warnings for result analysis
   */
  private generateConsistencyWarnings(
    actualResults: CleanupResults,
    expectedResults: ExpectedResults,
    warnings: string[],
    suggestions: string[]
  ): void {
    // Check if emails were processed but none were deleted
    if (actualResults.emails_processed > 0 && actualResults.emails_deleted === 0) {
      warnings.push('Emails were processed but none were deleted - all may have been protected');
      suggestions.push('Review safety mechanisms and policy criteria');
      suggestions.push('Check if test emails match policy selection criteria');
    }

    // Check if more emails were deleted than processed (shouldn't happen)
    if (actualResults.emails_deleted > actualResults.emails_processed) {
      warnings.push('More emails deleted than processed - data inconsistency detected');
      suggestions.push('Review cleanup result calculation logic');
    }

    // Check if storage was freed but no emails were deleted
    if (actualResults.storage_freed > 0 && actualResults.emails_deleted === 0) {
      warnings.push('Storage was freed but no emails were deleted - may indicate archiving');
      suggestions.push('Verify if emails were archived instead of deleted');
    }

    // Check if errors occurred but operation was marked successful
    if (actualResults.success && actualResults.errors.length > 0) {
      warnings.push('Operation marked successful despite errors - partial success scenario');
      suggestions.push('Review error handling and success criteria logic');
    }
  }

  /**
   * Generate performance warnings if applicable
   */
  private generatePerformanceWarnings(
    actualResults: CleanupResults,
    expectedResults: ExpectedResults,
    warnings: string[],
    suggestions: string[]
  ): void {
    if (!expectedResults.performanceMetrics) return;

    const perfMetrics = expectedResults.performanceMetrics;

    // This would typically check actual performance metrics
    // For now, we'll generate generic performance suggestions
    if (actualResults.emails_processed > 100) {
      suggestions.push('Consider monitoring execution time for large email batches');
      suggestions.push('Review database query performance for bulk operations');
    }

    if (actualResults.errors.length > 0) {
      suggestions.push('Performance may be impacted by error handling overhead');
      suggestions.push('Consider optimizing error recovery mechanisms');
    }
  }

  /**
   * Assert safety mechanism effectiveness
   * 
   * @param protectedEmailsCount - Number of emails protected by safety mechanisms
   * @param expectedProtection - Expected protection configuration
   * @param context - Assertion context
   * @returns Assertion result for safety mechanism effectiveness
   */
  async assertSafetyMechanisms(
    protectedEmailsCount: number,
    expectedProtection: { min?: number; max?: number; reasons?: string[] },
    context: AssertionContext
  ): Promise<CleanupAssertionResult> {
    const suggestions: string[] = [];

    // Check protection count range
    const protectionResult = this.assertNumericRange(
      protectedEmailsCount,
      expectedProtection,
      'protected_emails'
    );

    if (!protectionResult.passed) {
      suggestions.push('Review safety configuration and policy criteria');
      suggestions.push('Check if test emails trigger expected safety mechanisms');
      suggestions.push('Verify safety threshold configurations');
    }

    return {
      ...protectionResult,
      context,
      suggestions: [...(protectionResult.suggestions || []), ...suggestions]
    };
  }

  /**
   * Assert performance metrics
   * 
   * @param actualMetrics - Actual performance metrics
   * @param expectedMetrics - Expected performance thresholds
   * @param context - Assertion context
   * @returns Assertion result for performance metrics
   */
  async assertPerformanceMetrics(
    actualMetrics: { executionTimeMs: number; memoryUsageMB: number },
    expectedMetrics: { maxExecutionTimeMs?: number; maxMemoryUsageMB?: number },
    context: AssertionContext
  ): Promise<CleanupAssertionResult> {
    const failures: string[] = [];
    const suggestions: string[] = [];

    // Check execution time
    if (expectedMetrics.maxExecutionTimeMs && actualMetrics.executionTimeMs > expectedMetrics.maxExecutionTimeMs) {
      failures.push(`Execution time ${actualMetrics.executionTimeMs}ms exceeded maximum ${expectedMetrics.maxExecutionTimeMs}ms`);
      suggestions.push('Optimize database queries and batch processing');
      suggestions.push('Review policy evaluation performance');
    }

    // Check memory usage
    if (expectedMetrics.maxMemoryUsageMB && actualMetrics.memoryUsageMB > expectedMetrics.maxMemoryUsageMB) {
      failures.push(`Memory usage ${actualMetrics.memoryUsageMB}MB exceeded maximum ${expectedMetrics.maxMemoryUsageMB}MB`);
      suggestions.push('Optimize email batch sizes and memory management');
      suggestions.push('Review object creation and cleanup patterns');
    }

    return {
      passed: failures.length === 0,
      message: failures.length === 0 
        ? 'Performance metrics within expected thresholds'
        : `Performance issues: ${failures.join('; ')}`,
      context,
      expected: expectedMetrics,
      actual: actualMetrics,
      severity: failures.length > 0 ? 'warning' : 'info',
      suggestions: suggestions.length > 0 ? suggestions : undefined
    };
  }

  /**
   * Create a custom assertion builder for complex scenarios
   * 
   * @param description - Description of the custom assertion
   * @returns Assertion builder instance
   */
  createCustomAssertion(description: string): CustomAssertionBuilder {
    return new CustomAssertionBuilder(description);
  }

  /**
   * Format a numeric range for display
   */
  private formatRange(range: { min?: number; max?: number; exact?: number }): string {
    if (range.exact !== undefined) {
      return `exactly ${range.exact}`;
    }
    
    if (range.min !== undefined && range.max !== undefined) {
      return `${range.min}-${range.max}`;
    } else if (range.min !== undefined) {
      return `≥${range.min}`;
    } else if (range.max !== undefined) {
      return `≤${range.max}`;
    }
    
    return 'any value';
  }

  /**
   * Get assertion statistics and insights
   */
  getAssertionInsights(results: CleanupAssertionResult[]): {
    totalAssertions: number;
    passedAssertions: number;
    failedAssertions: number;
    warningAssertions: number;
    commonFailureReasons: string[];
    improvementSuggestions: string[];
  } {
    const passed = results.filter(r => r.passed);
    const failed = results.filter(r => !r.passed);
    const warnings = results.filter(r => r.severity === 'warning');

    // Collect common failure patterns
    const failureReasons = failed.map(r => r.message);
    const commonFailureReasons = [...new Set(failureReasons)];

    // Collect all suggestions
    const allSuggestions = results
      .filter(r => r.suggestions)
      .flatMap(r => r.suggestions!);
    const improvementSuggestions = [...new Set(allSuggestions)];

    return {
      totalAssertions: results.length,
      passedAssertions: passed.length,
      failedAssertions: failed.length,
      warningAssertions: warnings.length,
      commonFailureReasons,
      improvementSuggestions
    };
  }
}

/**
 * Custom assertion builder for complex test scenarios
 */
export class CustomAssertionBuilder {
  private description: string;
  private conditions: Array<{ check: () => boolean; message: string; suggestions: string[] }> = [];

  constructor(description: string) {
    this.description = description;
  }

  /**
   * Add a condition to the custom assertion
   */
  addCondition(
    check: () => boolean,
    message: string,
    suggestions: string[] = []
  ): CustomAssertionBuilder {
    this.conditions.push({ check, message, suggestions });
    return this;
  }

  /**
   * Execute the custom assertion
   */
  async execute(context: AssertionContext): Promise<CleanupAssertionResult> {
    const failures: string[] = [];
    const allSuggestions: string[] = [];

    for (const condition of this.conditions) {
      try {
        if (!condition.check()) {
          failures.push(condition.message);
          allSuggestions.push(...condition.suggestions);
        }
      } catch (error) {
        failures.push(`Condition check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        allSuggestions.push('Review custom assertion logic');
      }
    }

    return {
      passed: failures.length === 0,
      message: failures.length === 0
        ? `Custom assertion '${this.description}' passed`
        : `Custom assertion '${this.description}' failed: ${failures.join('; ')}`,
      context,
      expected: { description: this.description },
      actual: { failures },
      severity: failures.length > 0 ? 'error' : 'info',
      suggestions: allSuggestions.length > 0 ? allSuggestions : undefined
    };
  }
}