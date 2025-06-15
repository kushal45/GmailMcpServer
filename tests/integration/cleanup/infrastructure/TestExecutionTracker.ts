import {
  DecisionRecord,
  SafeguardRecord,
  RiskRecord,
  EmailProcessingTrace,
  PolicyEvaluationTrace,
  TestExecutionReport
} from './types';
import { logger } from '../../../../src/utils/logger';

/**
 * TestExecutionTracker provides structured logging and decision tracking for cleanup tests.
 * 
 * This class implements comprehensive execution tracking that captures:
 * - Decision points and reasoning throughout test execution
 * - Phase transitions and timing information
 * - Safety mechanism triggers and their effectiveness
 * - Risk identification and mitigation tracking
 * - Detailed debugging information for test analysis
 * 
 * Key Features:
 * - Structured decision recording with metadata
 * - Phase-based execution tracking
 * - Risk assessment and mitigation tracking
 * - Debugging-friendly error context
 * - Performance metrics collection
 * - Report generation for post-test analysis
 * 
 * @example
 * ```typescript
 * const tracker = new TestExecutionTracker();
 * await tracker.recordDecision(testId, 'policy_evaluation', 'policy_selection', {
 *   policyId: 'test-policy-1',
 *   reason: 'Selected based on criteria match',
 *   metadata: { criteria: {...} }
 * });
 * 
 * const report = await tracker.generateReport(testId);
 * ```
 */
export class TestExecutionTracker {
  private decisions: Map<string, DecisionRecord[]> = new Map();
  private phases: Map<string, Array<{ phase: string; timestamp: Date; message: string; metadata?: any }>> = new Map();
  private safeguards: Map<string, SafeguardRecord[]> = new Map();
  private risks: Map<string, RiskRecord[]> = new Map();
  private emailTraces: Map<string, EmailProcessingTrace[]> = new Map();
  private policyTraces: Map<string, PolicyEvaluationTrace[]> = new Map();
  private metrics: Map<string, Record<string, any>> = new Map();

  constructor() {
    logger.debug('TestExecutionTracker initialized');
  }

  /**
   * Record a decision point during test execution
   * 
   * @param testId - Unique test identifier
   * @param phase - Current execution phase
   * @param type - Type of decision being made
   * @param details - Decision details and context
   */
  async recordDecision(
    testId: string,
    phase: 'setup' | 'policy_evaluation' | 'safety_check' | 'execution' | 'cleanup',
    type: 'email_selection' | 'policy_application' | 'safety_trigger' | 'execution_decision',
    details: {
      emailId?: string;
      policyId?: string;
      reason: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      const decision: DecisionRecord = {
        timestamp: new Date(),
        phase,
        type,
        emailId: details.emailId,
        policyId: details.policyId,
        decision: `${type}_made`,
        reason: details.reason,
        metadata: details.metadata
      };

      if (!this.decisions.has(testId)) {
        this.decisions.set(testId, []);
      }

      this.decisions.get(testId)!.push(decision);

      logger.debug('Decision recorded', {
        test_id: testId,
        phase,
        type,
        reason: details.reason
      });

    } catch (error) {
      logger.error('Failed to record decision', {
        test_id: testId,
        phase,
        type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Record a phase transition or milestone
   * 
   * @param testId - Unique test identifier
   * @param phase - Current execution phase
   * @param message - Description of the phase or milestone
   * @param metadata - Additional context information
   */
  async recordPhase(
    testId: string,
    phase: 'setup' | 'policy_evaluation' | 'safety_check' | 'execution' | 'cleanup' | 'validation',
    message: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const phaseRecord = {
        phase,
        timestamp: new Date(),
        message,
        metadata
      };

      if (!this.phases.has(testId)) {
        this.phases.set(testId, []);
      }

      this.phases.get(testId)!.push(phaseRecord);

      logger.debug('Phase recorded', {
        test_id: testId,
        phase,
        message
      });

    } catch (error) {
      logger.error('Failed to record phase', {
        test_id: testId,
        phase,
        message,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Record a safeguard trigger event
   * 
   * @param testId - Unique test identifier
   * @param emailId - Email that triggered the safeguard
   * @param safeguardType - Type of safeguard that was triggered
   * @param triggered - Whether the safeguard was actually triggered
   * @param reason - Reason for the safeguard trigger
   * @param severity - Severity level of the safeguard
   * @param metadata - Additional safeguard context
   */
  async recordSafeguard(
    testId: string,
    emailId: string,
    safeguardType: string,
    triggered: boolean,
    reason: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const safeguard: SafeguardRecord = {
        timestamp: new Date(),
        emailId,
        safeguardType,
        triggered,
        reason,
        severity,
        metadata
      };

      if (!this.safeguards.has(testId)) {
        this.safeguards.set(testId, []);
      }

      this.safeguards.get(testId)!.push(safeguard);

      logger.debug('Safeguard recorded', {
        test_id: testId,
        email_id: emailId,
        safeguard_type: safeguardType,
        triggered,
        severity
      });

    } catch (error) {
      logger.error('Failed to record safeguard', {
        test_id: testId,
        email_id: emailId,
        safeguard_type: safeguardType,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Record a risk identification
   * 
   * @param testId - Unique test identifier
   * @param type - Type of risk identified
   * @param severity - Severity level of the risk
   * @param description - Description of the risk
   * @param mitigation - Mitigation strategy or action taken
   * @param emailId - Associated email ID (if applicable)
   * @param policyId - Associated policy ID (if applicable)
   */
  async recordRisk(
    testId: string,
    type: 'data_loss' | 'performance' | 'safety' | 'compliance',
    severity: 'low' | 'medium' | 'high' | 'critical',
    description: string,
    mitigation: string,
    emailId?: string,
    policyId?: string
  ): Promise<void> {
    try {
      const risk: RiskRecord = {
        timestamp: new Date(),
        type,
        severity,
        description,
        mitigation,
        emailId,
        policyId
      };

      if (!this.risks.has(testId)) {
        this.risks.set(testId, []);
      }

      this.risks.get(testId)!.push(risk);

      logger.debug('Risk recorded', {
        test_id: testId,
        risk_type: type,
        severity,
        description: description.substring(0, 100) // Truncate for logging
      });

    } catch (error) {
      logger.error('Failed to record risk', {
        test_id: testId,
        risk_type: type,
        severity,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Record email processing trace for debugging
   * 
   * @param testId - Unique test identifier
   * @param emailId - Email being processed
   * @param phase - Processing phase
   * @param action - Action being performed
   * @param result - Result of the action
   * @param reason - Reason for the result (if applicable)
   * @param duration - Processing duration in milliseconds
   * @param metadata - Additional processing context
   */
  async recordEmailTrace(
    testId: string,
    emailId: string,
    phase: string,
    action: string,
    result: 'success' | 'skipped' | 'failed' | 'protected',
    reason?: string,
    duration?: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const trace: EmailProcessingTrace = {
        emailId,
        phase,
        timestamp: new Date(),
        action,
        result,
        reason,
        duration,
        metadata
      };

      if (!this.emailTraces.has(testId)) {
        this.emailTraces.set(testId, []);
      }

      this.emailTraces.get(testId)!.push(trace);

      logger.debug('Email trace recorded', {
        test_id: testId,
        email_id: emailId,
        phase,
        action,
        result
      });

    } catch (error) {
      logger.error('Failed to record email trace', {
        test_id: testId,
        email_id: emailId,
        phase,
        action,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Record policy evaluation trace for debugging
   * 
   * @param testId - Unique test identifier
   * @param emailId - Email being evaluated
   * @param policyId - Policy being applied
   * @param criteriaEvaluation - Results of criteria evaluation
   * @param safetyChecks - Results of safety checks
   * @param finalDecision - Final decision made
   * @param reason - Reason for the decision
   * @param confidence - Confidence level of the decision
   */
  async recordPolicyTrace(
    testId: string,
    emailId: string,
    policyId: string,
    criteriaEvaluation: Record<string, boolean>,
    safetyChecks: Record<string, boolean>,
    finalDecision: 'apply' | 'skip' | 'protect',
    reason: string,
    confidence: number
  ): Promise<void> {
    try {
      const trace: PolicyEvaluationTrace = {
        emailId,
        policyId,
        timestamp: new Date(),
        criteriaEvaluation,
        safetyChecks,
        finalDecision,
        reason,
        confidence
      };

      if (!this.policyTraces.has(testId)) {
        this.policyTraces.set(testId, []);
      }

      this.policyTraces.get(testId)!.push(trace);

      logger.debug('Policy trace recorded', {
        test_id: testId,
        email_id: emailId,
        policy_id: policyId,
        final_decision: finalDecision,
        confidence
      });

    } catch (error) {
      logger.error('Failed to record policy trace', {
        test_id: testId,
        email_id: emailId,
        policy_id: policyId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Record performance or custom metrics
   * 
   * @param testId - Unique test identifier
   * @param metricName - Name of the metric
   * @param value - Metric value
   * @param metadata - Additional metric context
   */
  async recordMetric(
    testId: string,
    metricName: string,
    value: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      if (!this.metrics.has(testId)) {
        this.metrics.set(testId, {});
      }

      const testMetrics = this.metrics.get(testId)!;
      testMetrics[metricName] = {
        value,
        timestamp: new Date(),
        metadata
      };

      logger.debug('Metric recorded', {
        test_id: testId,
        metric_name: metricName,
        value: typeof value === 'object' ? JSON.stringify(value) : value
      });

    } catch (error) {
      logger.error('Failed to record metric', {
        test_id: testId,
        metric_name: metricName,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Generate a comprehensive execution report
   * 
   * @param testId - Unique test identifier
   * @returns Partial test execution report with tracking data
   */
  async generateReport(testId: string): Promise<Partial<TestExecutionReport>> {
    try {
      logger.debug('Generating execution report', { test_id: testId });

      const decisions = this.decisions.get(testId) || [];
      const phases = this.phases.get(testId) || [];
      const safeguards = this.safeguards.get(testId) || [];
      const risks = this.risks.get(testId) || [];
      const emailTraces = this.emailTraces.get(testId) || [];
      const policyTraces = this.policyTraces.get(testId) || [];
      const metrics = this.metrics.get(testId) || {};

      // Calculate phase timing
      const phaseTimings = this.calculatePhaseTimings(phases);

      // Analyze safeguard effectiveness
      const safeguardAnalysis = this.analyzeSafeguardEffectiveness(safeguards);

      // Categorize risks
      const riskAnalysis = this.categorizeRisks(risks);

      // Generate processing insights
      const processingInsights = this.generateProcessingInsights(emailTraces, policyTraces);

      const report: Partial<TestExecutionReport> = {
        decisions,
        safetyAnalysis: {
          safeguardsTriggered: safeguards,
          protectedEmailReasons: safeguardAnalysis.protectedReasons,
          risksIdentified: risks
        },
        debug: {
          logs: this.generateDebugLogs(testId),
          emailProcessingTrace: emailTraces,
          policyEvaluationTrace: policyTraces
        }
      };

      // Add custom metrics to report
      if (Object.keys(metrics).length > 0) {
        (report as any).customMetrics = metrics;
      }

      // Add analysis insights
      (report as any).analysisInsights = {
        phaseTimings,
        safeguardAnalysis,
        riskAnalysis,
        processingInsights
      };

      logger.debug('Execution report generated', {
        test_id: testId,
        decisions_count: decisions.length,
        phases_count: phases.length,
        safeguards_count: safeguards.length,
        risks_count: risks.length
      });

      return report;

    } catch (error) {
      logger.error('Failed to generate execution report', {
        test_id: testId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get all decisions for a test
   */
  async getDecisions(testId: string): Promise<DecisionRecord[]> {
    return this.decisions.get(testId) || [];
  }

  /**
   * Get all phases for a test
   */
  async getPhases(testId: string): Promise<Array<{ phase: string; timestamp: Date; message: string; metadata?: any }>> {
    return this.phases.get(testId) || [];
  }

  /**
   * Get all safeguards for a test
   */
  async getSafeguards(testId: string): Promise<SafeguardRecord[]> {
    return this.safeguards.get(testId) || [];
  }

  /**
   * Get all risks for a test
   */
  async getRisks(testId: string): Promise<RiskRecord[]> {
    return this.risks.get(testId) || [];
  }

  /**
   * Clear tracking data for a specific test
   */
  async clearTestData(testId: string): Promise<void> {
    this.decisions.delete(testId);
    this.phases.delete(testId);
    this.safeguards.delete(testId);
    this.risks.delete(testId);
    this.emailTraces.delete(testId);
    this.policyTraces.delete(testId);
    this.metrics.delete(testId);

    logger.debug('Test tracking data cleared', { test_id: testId });
  }

  /**
   * Clear all tracking data
   */
  async clearAllData(): Promise<void> {
    this.decisions.clear();
    this.phases.clear();
    this.safeguards.clear();
    this.risks.clear();
    this.emailTraces.clear();
    this.policyTraces.clear();
    this.metrics.clear();

    logger.debug('All tracking data cleared');
  }

  /**
   * Calculate phase timing information
   */
  private calculatePhaseTimings(phases: Array<{ phase: string; timestamp: Date; message: string; metadata?: any }>): Record<string, { duration: number; start: Date; end: Date }> {
    const phaseTimings: Record<string, { duration: number; start: Date; end: Date }> = {};
    const phaseStarts: Record<string, Date> = {};

    phases.forEach(phaseRecord => {
      const { phase, timestamp } = phaseRecord;
      
      if (!phaseStarts[phase]) {
        phaseStarts[phase] = timestamp;
      }

      // Update end time for each phase occurrence
      if (!phaseTimings[phase]) {
        phaseTimings[phase] = {
          duration: 0,
          start: timestamp,
          end: timestamp
        };
      }

      phaseTimings[phase].end = timestamp;
      phaseTimings[phase].duration = phaseTimings[phase].end.getTime() - phaseTimings[phase].start.getTime();
    });

    return phaseTimings;
  }

  /**
   * Analyze safeguard effectiveness
   */
  private analyzeSafeguardEffectiveness(safeguards: SafeguardRecord[]): {
    totalSafeguards: number;
    triggeredCount: number;
    effectivenessRate: number;
    protectedReasons: Record<string, number>;
    severityDistribution: Record<string, number>;
  } {
    const triggered = safeguards.filter(s => s.triggered);
    const protectedReasons: Record<string, number> = {};
    const severityDistribution: Record<string, number> = {};

    safeguards.forEach(safeguard => {
      // Count protected reasons
      protectedReasons[safeguard.reason] = (protectedReasons[safeguard.reason] || 0) + 1;
      
      // Count severity distribution
      severityDistribution[safeguard.severity] = (severityDistribution[safeguard.severity] || 0) + 1;
    });

    return {
      totalSafeguards: safeguards.length,
      triggeredCount: triggered.length,
      effectivenessRate: safeguards.length > 0 ? triggered.length / safeguards.length : 0,
      protectedReasons,
      severityDistribution
    };
  }

  /**
   * Categorize and analyze risks
   */
  private categorizeRisks(risks: RiskRecord[]): {
    totalRisks: number;
    risksByType: Record<string, number>;
    risksBySeverity: Record<string, number>;
    criticalRisks: RiskRecord[];
  } {
    const risksByType: Record<string, number> = {};
    const risksBySeverity: Record<string, number> = {};
    const criticalRisks = risks.filter(r => r.severity === 'critical');

    risks.forEach(risk => {
      risksByType[risk.type] = (risksByType[risk.type] || 0) + 1;
      risksBySeverity[risk.severity] = (risksBySeverity[risk.severity] || 0) + 1;
    });

    return {
      totalRisks: risks.length,
      risksByType,
      risksBySeverity,
      criticalRisks
    };
  }

  /**
   * Generate processing insights from traces
   */
  private generateProcessingInsights(
    emailTraces: EmailProcessingTrace[],
    policyTraces: PolicyEvaluationTrace[]
  ): {
    emailProcessingStats: Record<string, number>;
    policyDecisionStats: Record<string, number>;
    averageProcessingTime: number;
    averageConfidence: number;
  } {
    const emailProcessingStats: Record<string, number> = {};
    const policyDecisionStats: Record<string, number> = {};

    // Analyze email processing results
    emailTraces.forEach(trace => {
      emailProcessingStats[trace.result] = (emailProcessingStats[trace.result] || 0) + 1;
    });

    // Analyze policy decisions
    policyTraces.forEach(trace => {
      policyDecisionStats[trace.finalDecision] = (policyDecisionStats[trace.finalDecision] || 0) + 1;
    });

    // Calculate average processing time
    const tracesWithDuration = emailTraces.filter(t => t.duration !== undefined);
    const averageProcessingTime = tracesWithDuration.length > 0
      ? tracesWithDuration.reduce((sum, t) => sum + (t.duration || 0), 0) / tracesWithDuration.length
      : 0;

    // Calculate average confidence
    const averageConfidence = policyTraces.length > 0
      ? policyTraces.reduce((sum, t) => sum + t.confidence, 0) / policyTraces.length
      : 0;

    return {
      emailProcessingStats,
      policyDecisionStats,
      averageProcessingTime,
      averageConfidence
    };
  }

  /**
   * Generate debug logs for a test
   */
  private generateDebugLogs(testId: string): string[] {
    const logs: string[] = [];
    
    // This would typically capture actual log entries
    // For now, we'll generate summary logs based on tracked data
    const decisions = this.decisions.get(testId) || [];
    const phases = this.phases.get(testId) || [];
    const safeguards = this.safeguards.get(testId) || [];

    logs.push(`Test ${testId} tracking summary:`);
    logs.push(`- Decisions recorded: ${decisions.length}`);
    logs.push(`- Phases tracked: ${phases.length}`);
    logs.push(`- Safeguards evaluated: ${safeguards.length}`);

    return logs;
  }

  /**
   * Get tracking statistics
   */
  getStats(): {
    activeTests: number;
    totalDecisions: number;
    totalSafeguards: number;
    totalRisks: number;
  } {
    let totalDecisions = 0;
    let totalSafeguards = 0;
    let totalRisks = 0;

    this.decisions.forEach(decisions => totalDecisions += decisions.length);
    this.safeguards.forEach(safeguards => totalSafeguards += safeguards.length);
    this.risks.forEach(risks => totalRisks += risks.length);

    return {
      activeTests: this.decisions.size,
      totalDecisions,
      totalSafeguards,
      totalRisks
    };
  }
}