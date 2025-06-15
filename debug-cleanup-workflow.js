import { DatabaseManager } from './build/database/DatabaseManager.js';
import { CleanupPolicyEngine } from './build/cleanup/CleanupPolicyEngine.js';
import { CleanupAutomationEngine } from './build/cleanup/CleanupAutomationEngine.js';
import { JobQueue } from './build/database/JobQueue.js';

console.log('=== CLEANUP WORKFLOW TEST ===');

async function testCleanupWorkflow() {
  let dbManager = null;
  let policyEngine = null;
  let cleanupEngine = null;

  try {
    console.log('1. Setting up database and test data...');
    
    // Setup database
    const testDbDir = `data/debug-workflow-${Date.now()}`;
    process.env.STORAGE_PATH = testDbDir;
    DatabaseManager.instance = null;
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();

    // Insert test emails
    const testEmails = [
      {
        id: "workflow-email-1",
        threadId: "thread-1",
        category: "low",
        subject: "Workflow Test Email 1",
        sender: "test@example.com",
        recipients: ["user@example.com"],
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        year: 2024,
        size: 15000,
        hasAttachments: false,
        labels: ["INBOX"],
        snippet: "Test email for workflow...",
        archived: false,
        spam_score: 0.9,
        promotional_score: 0.8,
        importanceScore: 1
      }
    ];

    await dbManager.bulkUpsertEmailIndex(testEmails);
    console.log('✅ Test email inserted');

    console.log('2. Creating policy engine and policy...');
    policyEngine = new CleanupPolicyEngine(dbManager, null, null, {});
    
    const testPolicy = {
      id: `workflow-policy-${Date.now()}`,
      name: "Workflow Test Policy",
      enabled: true,
      priority: 50,
      criteria: {
        age_days_min: 1,
        importance_level_max: "high",
        spam_score_min: 0.1,
        promotional_score_min: 0.1
      },
      action: { type: "delete" },
      safety: {
        max_emails_per_run: 10,
        preserve_important: false,
        require_confirmation: false,
        dry_run_first: false,
      },
      created_at: new Date(),
      updated_at: new Date(),
    };

    await policyEngine.createPolicy(testPolicy);
    console.log('✅ Policy created');

    console.log('3. Testing policy engine email selection...');
    try {
      // Test if policy engine can find emails that match criteria
      const matchingEmails = await policyEngine.evaluateEmailsForCleanup(testPolicy.id);
      console.log(`📧 Policy engine found ${matchingEmails ? matchingEmails.length : 0} matching emails`);
      
      if (matchingEmails && matchingEmails.length > 0) {
        console.log('✅ Policy engine email selection works');
      } else {
        console.error('❌ Policy engine found NO matching emails - ISSUE IN POLICY ENGINE');
        return;
      }
    } catch (error) {
      console.error('❌ Policy engine email evaluation failed:', error.message);
      return;
    }

    console.log('4. Setting up CleanupAutomationEngine...');
    const jobQueue = new JobQueue();
    
    // Create mock delete manager
    const mockDeleteManager = {
      deleteEmails: async (emailIds, options) => {
        console.log(`🗑️  Mock delete called with ${emailIds.length} emails`);
        return {
          success: true,
          deletedCount: emailIds.length,
          errors: []
        };
      }
    };

    cleanupEngine = new CleanupAutomationEngine(
      dbManager,
      jobQueue,
      mockDeleteManager,
      null, // accessTracker
      null, // stalenessScorer  
      policyEngine
    );

    // Initialize with minimal config to avoid health monitor issues
    await cleanupEngine.updateConfiguration({
      continuous_cleanup: {
        enabled: false,
        target_emails_per_minute: 1,
        max_concurrent_operations: 1,
        pause_during_peak_hours: false,
        peak_hours: { start: '09:00', end: '17:00' }
      },
      event_triggers: {
        storage_threshold: { enabled: false, warning_threshold_percent: 80, critical_threshold_percent: 95, emergency_policies: [] },
        performance_threshold: { enabled: false, query_time_threshold_ms: 1000, cache_hit_rate_threshold: 0.7 },
        email_volume_threshold: { enabled: false, daily_email_threshold: 1000, immediate_cleanup_policies: [] }
      }
    });

    await cleanupEngine.initialize();
    console.log('✅ CleanupAutomationEngine initialized');

    console.log('5. Testing manual cleanup trigger...');
    const jobId = await cleanupEngine.triggerManualCleanup(testPolicy.id, {
      dry_run: false,
      max_emails: 10,
      batch_size: 5
    });
    console.log(`📋 Manual cleanup job created: ${jobId}`);

    console.log('6. Processing cleanup job...');
    const results = await cleanupEngine.processCleanupJob(jobId);
    console.log('📊 Cleanup results:', {
      success: results.success,
      emails_processed: results.emails_processed,
      emails_deleted: results.emails_deleted,
      storage_freed: results.storage_freed,
      errors: results.errors?.length || 0
    });

    if (results.emails_processed === 0) {
      console.error('❌ CLEANUP WORKFLOW PROCESSED 0 EMAILS - ISSUE IN CLEANUP ENGINE');
    } else {
      console.log('✅ CLEANUP WORKFLOW WORKS - Original test issue must be in infrastructure setup');
    }

  } catch (error) {
    console.error('❌ Workflow test failed:', error.message);
    console.error('❌ Stack:', error.stack);
  } finally {
    try {
      if (cleanupEngine) await cleanupEngine.shutdown();
      if (dbManager) await dbManager.close();
    } catch (e) {
      console.warn('Cleanup warning:', e.message);
    }
  }
}

testCleanupWorkflow().then(() => {
  console.log('\n=== WORKFLOW TEST COMPLETED ===');
  process.exit(0);
}).catch(error => {
  console.error('❌ FATAL ERROR:', error);
  process.exit(1);
});