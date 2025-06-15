// Email Cleanup System - Phase 1 & 2: Foundation Infrastructure & Core Automation Engine
// This module provides the core components for intelligent email cleanup

// Phase 1 Components
export { AccessPatternTracker } from './AccessPatternTracker.js';
export { StalenessScorer } from './StalenessScorer.js';
export { CleanupPolicyEngine } from './CleanupPolicyEngine.js';

// Phase 2 Components - Core Automation Engine
export { CleanupAutomationEngine } from './CleanupAutomationEngine.js';
export { CleanupScheduler } from './CleanupScheduler.js';
export { SystemHealthMonitor } from './SystemHealthMonitor.js';

// Re-export relevant types for convenience
export type {
  EmailAccessEvent,
  SearchActivityRecord,
  EmailAccessSummary,
  CleanupPolicy,
  StalenessScore,
  AutomationConfig,
  CleanupJob,
  CleanupResults,
  AutomationStatus,
  SystemMetrics,
  EmailCleanupSystemConfig
} from '../types/index.js';

// Phase 2 specific types
export type { ScheduleConfig } from './CleanupScheduler.js';
export type { HealthThresholds, SystemHealth } from './SystemHealthMonitor.js';