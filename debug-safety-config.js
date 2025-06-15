import { DatabaseManager } from './build/database/DatabaseManager.js';
import { CleanupPolicyEngine } from './build/cleanup/CleanupPolicyEngine.js';
import { ConfigurationManager } from './tests/integration/cleanup/infrastructure/ConfigurationManager.js';
import { INFRASTRUCTURE_CONSTANTS } from './tests/integration/cleanup/infrastructure/index.js';

console.log('=== SAFETY CONFIGURATION TEST ===');

try {
  // 1. Test configuration hierarchy and preset application
  console.log('1. Testing configuration hierarchy...');
  
  const configManager = new ConfigurationManager();
  
  // Create test scenario (same as integration test)
  const testScenario = {
    name: 'Safety Config Test',
    category: 'permissive',
    emails: [],
    policies: [],
    execution: { dryRun: false, maxEmails: 10, batchSize: 5, timeout: 30000 },
    expected: { success: true, emailsDeleted: { min: 2, max: 3 } },
    tags: ['permissive']
  };
  
  console.log('📋 Initial scenario:', {
    category: testScenario.category,
    safetyConfig: testScenario.safetyConfig || 'undefined'
  });
  
  // 2. Apply PERMISSIVE_DELETION preset
  console.log('2. Applying PERMISSIVE_DELETION preset...');
  const scenarioWithPreset = configManager.applyPreset(
    testScenario,
    INFRASTRUCTURE_CONSTANTS.PRESETS.PERMISSIVE_DELETION
  );
  
  console.log('📋 Scenario after preset:', {
    category: scenarioWithPreset.category,
    safetyConfig: scenarioWithPreset.safetyConfig ? {
      recentAccessDays: scenarioWithPreset.safetyConfig.recentAccessDays,
      maxAccessScore: scenarioWithPreset.safetyConfig.maxAccessScore,
      minStalenessScore: scenarioWithPreset.safetyConfig.minStalenessScore,
      importanceScoreThreshold: scenarioWithPreset.safetyConfig.importanceScoreThreshold
    } : 'undefined'
  });
  
  // 3. Resolve configuration hierarchy
  console.log('3. Resolving configuration hierarchy...');
  const resolvedConfig = configManager.resolveConfiguration(scenarioWithPreset);
  
  console.log('📋 Final resolved config:', {
    category: resolvedConfig.category,
    safetyConfig: resolvedConfig.safetyConfig ? {
      recentAccessDays: resolvedConfig.safetyConfig.recentAccessDays,
      maxAccessScore: resolvedConfig.safetyConfig.maxAccessScore,
      minStalenessScore: resolvedConfig.safetyConfig.minStalenessScore,
      importanceScoreThreshold: resolvedConfig.safetyConfig.importanceScoreThreshold,
      vipDomains: resolvedConfig.safetyConfig.vipDomains?.length || 0,
      protectedLabels: resolvedConfig.safetyConfig.protectedLabels?.length || 0
    } : 'undefined'
  });
  
  // 4. Test CleanupPolicyEngine with resolved safety config
  console.log('4. Testing CleanupPolicyEngine with resolved safety config...');
  
  const dbManager = DatabaseManager.getInstance();
  await dbManager.initialize();
  
  // Create policy engine with resolved safety config
  const policyEngine = new CleanupPolicyEngine(
    dbManager,
    null,
    null,
    resolvedConfig.safetyConfig
  );
  
  // Insert test email (same as integration test)
  const testEmail = {
    id: "deletable-spam-1",
    threadId: "thread-spam-1",
    category: "low",
    subject: "Obvious Spam Email",
    sender: "spam@deletable-domain.com",
    recipients: ["user@example.com"],
    date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days old
    year: 2024,
    size: 15000,
    hasAttachments: false,
    labels: ["INBOX"],
    snippet: "Get rich quick scheme...",
    archived: false,
    spam_score: 0.9,
    promotional_score: 0.8,
    importanceScore: 1
  };
  
  await dbManager.upsertEmailIndex(testEmail);
  console.log('✅ Test email inserted');
  
  // Create policy with same criteria as integration test
  const testPolicy = {
    name: "Safety Config Test Policy",
    enabled: true,
    priority: 50,
    criteria: {
      age_days_min: 1,
      importance_level_max: "high",
      spam_score_min: 0.1,
      promotional_score_min: 0.1,
      access_score_max: 0.9
    },
    action: { type: "delete" },
    safety: {
      max_emails_per_run: 10,
      preserve_important: false,
      require_confirmation: false,
      dry_run_first: false,
    },
    schedule: {
      frequency: 'daily'
    }
  };
  
  const policyId = await policyEngine.createPolicy(testPolicy);
  console.log('✅ Policy created');
  
  // 5. Test email evaluation
  console.log('5. Testing email evaluation...');
  const evaluationResult = await policyEngine.evaluateEmailsForCleanup([testEmail]);
  
  console.log('📧 Evaluation result:', {
    candidates_count: evaluationResult.cleanup_candidates?.length || 0,
    protected_count: evaluationResult.protected_emails?.length || 0,
    total_emails: evaluationResult.evaluation_summary?.total_emails || 0,
    policies_applied: evaluationResult.evaluation_summary?.policies_applied || 0
  });
  
  if (evaluationResult.protected_emails?.length > 0) {
    console.log('🔒 Protection reasons:');
    evaluationResult.protected_emails.forEach((pe, i) => {
      console.log(`  ${i+1}. ${pe.email.id}: ${pe.reason}`);
    });
  }
  
  if (evaluationResult.cleanup_candidates?.length > 0) {
    console.log('🗑️ Cleanup candidates:');
    evaluationResult.cleanup_candidates.forEach((cc, i) => {
      console.log(`  ${i+1}. ${cc.email.id}: action=${cc.recommended_action}, staleness=${cc.staleness_score.total_score}`);
    });
  }
  
  console.log('✅ Safety configuration test completed successfully');
  
} catch (error) {
  console.error('❌ Safety configuration test failed:', error.message);
  console.error('❌ Error details:', error);
}

console.log('\n=== SAFETY CONFIGURATION TEST COMPLETED ===');