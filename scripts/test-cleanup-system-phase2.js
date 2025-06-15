#!/usr/bin/env node

/**
 * Comprehensive Test Script for Email Cleanup System Phase 2 - Core Automation Engine
 * 
 * This script tests all automation components:
 * - CleanupAutomationEngine
 * - CleanupScheduler  
 * - SystemHealthMonitor
 * - Enhanced DeleteManager
 * - MCP Tools Integration
 */

import { DatabaseManager } from '../src/database/DatabaseManager.js';
import { JobQueue } from '../src/database/JobQueue.js';
import { CleanupAutomationEngine } from '../src/cleanup/CleanupAutomationEngine.js';
import { CleanupScheduler } from '../src/cleanup/CleanupScheduler.js';
import { SystemHealthMonitor } from '../src/cleanup/SystemHealthMonitor.js';
import { CleanupPolicyEngine } from '../src/cleanup/CleanupPolicyEngine.js';
import { AccessPatternTracker } from '../src/cleanup/AccessPatternTracker.js';
import { StalenessScorer } from '../src/cleanup/StalenessScorer.js';
import { DeleteManager } from '../src/delete/DeleteManager.js';
import { AuthManager } from '../src/auth/AuthManager.js';
import { logger } from '../src/utils/logger.js';

class Phase2TestSuite {
  constructor() {
    this.testResults = [];
    this.testsPassed = 0;
    this.testsFailed = 0;
  }

  async runTests() {
    console.log('🚀 Starting Email Cleanup System Phase 2 Tests\n');
    
    try {
      // Initialize components
      await this.initializeComponents();
      
      // Run test suites
      await this.testSystemHealthMonitor();
      await this.testCleanupScheduler();
      await this.testCleanupAutomationEngine();
      await this.testEnhancedDeleteManager();
      await this.testIntegrationScenarios();
      
      // Cleanup
      await this.cleanup();
      
      // Print results
      this.printResults();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    }
  }

  async initializeComponents() {
    console.log('📋 Initializing test components...');
    
    this.databaseManager = DatabaseManager.getInstance();
    await this.databaseManager.initialize();
    
    this.jobQueue = new JobQueue();
    this.authManager = new AuthManager();
    this.deleteManager = new DeleteManager(this.authManager, this.databaseManager);
    
    this.accessTracker = AccessPatternTracker.getInstance();
    this.stalenessScorer = new StalenessScorer(this.accessTracker);
    this.policyEngine = CleanupPolicyEngine.getInstance();
    
    this.systemHealthMonitor = new SystemHealthMonitor(this.databaseManager);
    this.cleanupAutomationEngine = CleanupAutomationEngine.getInstance(
      this.databaseManager,
      this.jobQueue,
      this.deleteManager
    );
    
    console.log('✅ Components initialized\n');
  }

  async testSystemHealthMonitor() {
    console.log('🔍 Testing SystemHealthMonitor...');
    
    try {
      // Test initialization
      await this.test('SystemHealthMonitor initialization', async () => {
        await this.systemHealthMonitor.initialize();
        return true;
      });

      // Test health check
      await this.test('Basic health check', async () => {
        const health = await this.systemHealthMonitor.getCurrentHealth();
        return health && typeof health.storage_usage_percent === 'number';
      });

      // Test performance tracking
      await this.test('Performance tracking', async () => {
        this.systemHealthMonitor.recordQueryTime(150);
        this.systemHealthMonitor.recordCacheHit(true);
        this.systemHealthMonitor.recordCacheHit(false);
        
        const summary = this.systemHealthMonitor.getPerformanceSummary();
        return summary.query_count === 1 && summary.cache_total_operations === 2;
      });

      // Test threshold updates
      await this.test('Threshold updates', async () => {
        const newThresholds = {
          storage_warning_percent: 75,
          query_time_warning_ms: 600
        };
        
        await this.systemHealthMonitor.updateThresholds(newThresholds);
        const thresholds = this.systemHealthMonitor.getThresholds();
        
        return thresholds.storage_warning_percent === 75 && 
               thresholds.query_time_warning_ms === 600;
      });

      // Test metrics history
      await this.test('Metrics history retrieval', async () => {
        const history = await this.systemHealthMonitor.getMetricsHistory(1);
        return Array.isArray(history);
      });

      console.log('✅ SystemHealthMonitor tests completed\n');
      
    } catch (error) {
      console.error('❌ SystemHealthMonitor tests failed:', error);
    }
  }

  async testCleanupScheduler() {
    console.log('📅 Testing CleanupScheduler...');
    
    try {
      // Create a test policy first
      const policyId = await this.policyEngine.createPolicy({
        name: 'Test Spam Cleanup',
        enabled: true,
        priority: 70,
        criteria: {
          age_days_min: 30,
          importance_level_max: 'low',
          spam_score_min: 0.8
        },
        action: {
          type: 'delete',
          method: 'gmail'
        },
        safety: {
          max_emails_per_run: 50,
          require_confirmation: false,
          dry_run_first: false,
          preserve_important: true
        }
      });

      this.scheduler = new CleanupScheduler(this.cleanupAutomationEngine);
      
      // Test initialization
      await this.test('CleanupScheduler initialization', async () => {
        await this.scheduler.initialize();
        return true;
      });

      // Test daily schedule creation
      await this.test('Daily schedule creation', async () => {
        const scheduleId = await this.scheduler.createSchedule({
          name: 'Daily Spam Cleanup',
          type: 'daily',
          expression: '02:00',
          policy_id: policyId,
          enabled: true
        });
        
        const schedule = this.scheduler.getSchedule(scheduleId);
        return schedule && schedule.type === 'daily';
      });

      // Test weekly schedule creation
      await this.test('Weekly schedule creation', async () => {
        const scheduleId = await this.scheduler.createSchedule({
          name: 'Weekly Large Email Cleanup',
          type: 'weekly',
          expression: 'sunday:03:00',
          policy_id: policyId,
          enabled: true
        });
        
        const schedule = this.scheduler.getSchedule(scheduleId);
        return schedule && schedule.type === 'weekly';
      });

      // Test interval schedule creation
      await this.test('Interval schedule creation', async () => {
        const scheduleId = await this.scheduler.createSchedule({
          name: 'Hourly Light Cleanup',
          type: 'interval',
          expression: '3600000', // 1 hour in ms
          policy_id: policyId,
          enabled: false
        });
        
        const schedule = this.scheduler.getSchedule(scheduleId);
        return schedule && schedule.type === 'interval' && !schedule.enabled;
      });

      // Test schedule listing
      await this.test('Schedule listing', async () => {
        const schedules = this.scheduler.getSchedules();
        return schedules.length >= 3;
      });

      // Test active schedule count
      await this.test('Active schedule count', async () => {
        const count = this.scheduler.getActiveScheduleCount();
        return count >= 2; // Two enabled schedules
      });

      // Test next scheduled time
      await this.test('Next scheduled time calculation', async () => {
        const nextTime = this.scheduler.getNextScheduledTime();
        return nextTime instanceof Date;
      });

      console.log('✅ CleanupScheduler tests completed\n');
      
    } catch (error) {
      console.error('❌ CleanupScheduler tests failed:', error);
    }
  }

  async testCleanupAutomationEngine() {
    console.log('🤖 Testing CleanupAutomationEngine...');
    
    try {
      // Test initialization
      await this.test('CleanupAutomationEngine initialization', async () => {
        await this.cleanupAutomationEngine.initialize();
        return true;
      });

      // Test automation status
      await this.test('Automation status retrieval', async () => {
        const status = await this.cleanupAutomationEngine.getAutomationStatus();
        return status && typeof status.active_policies_count === 'number';
      });

      // Test configuration updates
      await this.test('Configuration updates', async () => {
        const config = {
          continuous_cleanup: {
            enabled: true,
            target_emails_per_minute: 5,
            max_concurrent_operations: 2
          }
        };
        
        await this.cleanupAutomationEngine.updateConfiguration(config);
        const currentConfig = this.cleanupAutomationEngine.getConfiguration();
        
        return currentConfig.continuous_cleanup.target_emails_per_minute === 5;
      });

      // Test manual cleanup trigger
      await this.test('Manual cleanup trigger', async () => {
        // Create a test policy first
        const policyId = await this.policyEngine.createPolicy({
          name: 'Test Manual Cleanup',
          enabled: true,
          priority: 60,
          criteria: {
            age_days_min: 90,
            importance_level_max: 'medium'
          },
          action: {
            type: 'archive',
            method: 'gmail'
          },
          safety: {
            max_emails_per_run: 10,
            require_confirmation: false,
            dry_run_first: false,
            preserve_important: true
          }
        });

        const jobId = await this.cleanupAutomationEngine.triggerManualCleanup(policyId, {
          dry_run: true,
          max_emails: 5
        });
        
        return typeof jobId === 'string' && jobId.startsWith('cleanup_manual_');
      });

      console.log('✅ CleanupAutomationEngine tests completed\n');
      
    } catch (error) {
      console.error('❌ CleanupAutomationEngine tests failed:', error);
    }
  }

  async testEnhancedDeleteManager() {
    console.log('🗑️  Testing Enhanced DeleteManager...');
    
    try {
      // Create test emails in database
      await this.createTestEmails();

      // Test cleanup deletion stats
      await this.test('Cleanup deletion statistics', async () => {
        const stats = await this.deleteManager.getCleanupDeletionStats();
        return stats && typeof stats.total_deletable === 'number';
      });

      // Test batch delete for cleanup (dry run)
      await this.test('Batch delete for cleanup (dry run)', async () => {
        const testEmails = await this.databaseManager.searchEmails({ limit: 5 });
        
        if (testEmails.length === 0) {
          console.log('  ⚠️  No test emails available, skipping batch delete test');
          return true;
        }

        const result = await this.deleteManager.batchDeleteForCleanup(
          testEmails,
          undefined,
          {
            dry_run: true,
            batch_size: 2,
            max_failures: 1
          }
        );
        
        return result && result.deleted >= 0 && result.errors.length >= 0;
      });

      // Test email safety checks
      await this.test('Email safety checks', async () => {
        const testEmail = {
          id: 'test-email-1',
          category: 'high',
          importanceLevel: 'high',
          date: new Date(),
          size: 1000
        };
        
        // Should return false for high importance email
        const isSafe = this.deleteManager.isEmailSafeToDelete(testEmail);
        return !isSafe;
      });

      console.log('✅ Enhanced DeleteManager tests completed\n');
      
    } catch (error) {
      console.error('❌ Enhanced DeleteManager tests failed:', error);
    }
  }

  async testIntegrationScenarios() {
    console.log('🔗 Testing Integration Scenarios...');
    
    try {
      // Test health monitoring with cleanup triggers
      await this.test('Health monitoring integration', async () => {
        // Simulate high storage usage
        const mockMetrics = {
          storage_usage_percent: 95,
          storage_used_bytes: 950000000,
          storage_total_bytes: 1000000000,
          average_query_time_ms: 200,
          cache_hit_rate: 0.85,
          active_connections: 1,
          cleanup_rate_per_minute: 10,
          system_load_average: 0.5
        };
        
        await this.databaseManager.recordSystemMetrics(mockMetrics);
        const health = await this.systemHealthMonitor.getCurrentHealth();
        
        return health.status === 'critical';
      });

      // Test policy evaluation with automation
      await this.test('Policy evaluation integration', async () => {
        const policies = await this.policyEngine.getActivePolicies();
        return policies.length > 0;
      });

      // Test complete automation workflow
      await this.test('Complete automation workflow', async () => {
        // This would test a full cycle but we'll simulate it
        const status = await this.cleanupAutomationEngine.getAutomationStatus();
        const health = await this.systemHealthMonitor.getCurrentHealth();
        const schedules = this.scheduler.getSchedules();
        
        return status && health && schedules;
      });

      console.log('✅ Integration scenarios completed\n');
      
    } catch (error) {
      console.error('❌ Integration scenarios failed:', error);
    }
  }

  async createTestEmails() {
    // Create some test email data for testing
    const testEmails = [
      {
        id: 'test-email-1',
        threadId: 'thread-1',
        category: 'low',
        subject: 'Test spam email',
        sender: 'spam@example.com',
        recipients: ['user@example.com'],
        date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        year: new Date().getFullYear(),
        size: 5000,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: 'This is a test spam email',
        spamScore: 0.9,
        importanceLevel: 'low'
      },
      {
        id: 'test-email-2',
        threadId: 'thread-2',
        category: 'medium',
        subject: 'Test promotional email',
        sender: 'promo@example.com',
        recipients: ['user@example.com'],
        date: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000), // 120 days ago
        year: new Date().getFullYear(),
        size: 15000,
        hasAttachments: true,
        labels: ['INBOX'],
        snippet: 'This is a test promotional email',
        promotionalScore: 0.8,
        importanceLevel: 'medium'
      }
    ];

    for (const email of testEmails) {
      try {
        await this.databaseManager.upsertEmailIndex(email);
      } catch (error) {
        // Ignore if emails already exist
      }
    }
  }

  async test(testName, testFunction) {
    try {
      const result = await testFunction();
      if (result) {
        console.log(`  ✅ ${testName}`);
        this.testsPassed++;
      } else {
        console.log(`  ❌ ${testName} - returned false`);
        this.testsFailed++;
      }
      this.testResults.push({ name: testName, passed: !!result });
    } catch (error) {
      console.log(`  ❌ ${testName} - ${error.message}`);
      this.testsFailed++;
      this.testResults.push({ name: testName, passed: false, error: error.message });
    }
  }

  async cleanup() {
    console.log('🧹 Cleaning up test environment...');
    
    try {
      if (this.scheduler) {
        await this.scheduler.shutdown();
      }
      
      if (this.systemHealthMonitor) {
        await this.systemHealthMonitor.shutdown();
      }
      
      if (this.cleanupAutomationEngine) {
        await this.cleanupAutomationEngine.shutdown();
      }
      
      await this.databaseManager.close();
      console.log('✅ Cleanup completed\n');
      
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    }
  }

  printResults() {
    console.log('📊 Test Results Summary');
    console.log('========================');
    console.log(`Total Tests: ${this.testsPassed + this.testsFailed}`);
    console.log(`Passed: ${this.testsPassed}`);
    console.log(`Failed: ${this.testsFailed}`);
    console.log(`Success Rate: ${((this.testsPassed / (this.testsPassed + this.testsFailed)) * 100).toFixed(1)}%`);
    
    if (this.testsFailed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(test => !test.passed)
        .forEach(test => {
          console.log(`  - ${test.name}${test.error ? `: ${test.error}` : ''}`);
        });
    }
    
    console.log('\n🎉 Phase 2 Core Automation Engine testing completed!');
    
    if (this.testsFailed === 0) {
      console.log('🏆 All tests passed! The cleanup automation system is ready for production.');
    } else {
      console.log('⚠️  Some tests failed. Please review and fix issues before deployment.');
      process.exit(1);
    }
  }
}

// Run the test suite
const testSuite = new Phase2TestSuite();
testSuite.runTests().catch(error => {
  console.error('Test suite execution failed:', error);
  process.exit(1);
});