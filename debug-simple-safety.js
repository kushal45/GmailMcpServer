import { DatabaseManager } from './build/database/DatabaseManager.js';
import { CleanupPolicyEngine } from './build/cleanup/CleanupPolicyEngine.js';

console.log('=== SIMPLE SAFETY CONFIG TEST ===');

try {
  // 1. Test with default safety config (should protect recent emails)
  console.log('1. Testing with DEFAULT safety config...');
  
  const dbManager = DatabaseManager.getInstance();
  await dbManager.initialize();
  
  // Create policy engine with default safety config (recentAccessDays: 7)
  const defaultPolicyEngine = new CleanupPolicyEngine(dbManager, null, null, undefined);
  
  // Insert test email (5 days old - should be protected by default config)
  const recentEmail = {
    id: "recent-test-email",
    threadId: "thread-recent",
    category: "low",
    subject: "Recent Test Email",
    sender: "test@example.com",
    recipients: ["user@example.com"],
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days old
    year: 2024,
    size: 15000,
    hasAttachments: false,
    labels: ["INBOX"],
    snippet: "Recent test email...",
    archived: false,
    spam_score: 0.9,
    promotional_score: 0.8,
    importanceScore: 1
  };
  
  await dbManager.upsertEmailIndex(recentEmail);
  console.log('✅ Recent email inserted (5 days old)');
  
  // Create test policy
  const testPolicy = {
    name: "Default Safety Test Policy",
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
  
  const policyId = await defaultPolicyEngine.createPolicy(testPolicy);
  console.log('✅ Policy created');
  
  // Test evaluation with default config
  const defaultResult = await defaultPolicyEngine.evaluateEmailsForCleanup([recentEmail]);
  console.log('📧 DEFAULT config evaluation result:', {
    candidates_count: defaultResult.cleanup_candidates?.length || 0,
    protected_count: defaultResult.protected_emails?.length || 0,
    first_protection_reason: defaultResult.protected_emails?.[0]?.reason || 'No protection'
  });
  
  // 2. Test with PERMISSIVE safety config (should allow recent emails)
  console.log('\n2. Testing with PERMISSIVE safety config...');
  
  // Create policy engine with permissive safety config (recentAccessDays: 0)
  const permissiveSafetyConfig = {
    recentAccessDays: 0,  // Disable recent email protection
    maxAccessScore: 0.7,  // Set below test email's access score of 0.8 to bypass protection
    minStalenessScore: 0.0,  // No staleness requirement
    importanceScoreThreshold: 100.0,  // Very high threshold
    importantSenderScore: 999,  // Extremely high threshold to bypass sender reputation protection
activeThreadDays: 0,  // Disable active thread protection
    vipDomains: [],
    trustedDomains: [],
    protectedLabels: [],
    legalKeywords: [],
    enableDetailedLogging: true
  };
  
  console.log('📋 Permissive safety config being passed:', {
    recentAccessDays: permissiveSafetyConfig.recentAccessDays,
    maxAccessScore: permissiveSafetyConfig.maxAccessScore,
    importantSenderScore: permissiveSafetyConfig.importantSenderScore,
    activeThreadDays: permissiveSafetyConfig.activeThreadDays,
    minStalenessScore: permissiveSafetyConfig.minStalenessScore,
    importanceScoreThreshold: permissiveSafetyConfig.importanceScoreThreshold
  });
  
  const permissivePolicyEngine = new CleanupPolicyEngine(dbManager, null, null, permissiveSafetyConfig);
  
  // Create same policy in permissive engine
  const permissivePolicyId = await permissivePolicyEngine.createPolicy({
    ...testPolicy,
    name: "Permissive Safety Test Policy",
    id: `permissive-${testPolicy.name}-${Date.now()}`
  });
  console.log('✅ Permissive policy created');
  
  // Test evaluation with permissive config
  const permissiveResult = await permissivePolicyEngine.evaluateEmailsForCleanup([recentEmail]);
  console.log('📧 PERMISSIVE config evaluation result:', {
    candidates_count: permissiveResult.cleanup_candidates?.length || 0,
    protected_count: permissiveResult.protected_emails?.length || 0,
    first_protection_reason: permissiveResult.protected_emails?.[0]?.reason || 'No protection',
    first_candidate_action: permissiveResult.cleanup_candidates?.[0]?.recommended_action || 'No candidate'
  });
  
  // 3. Compare results
  console.log('\n3. COMPARISON:');
  console.log(`Default config (recentAccessDays=7): ${defaultResult.protected_emails?.length || 0} protected, ${defaultResult.cleanup_candidates?.length || 0} candidates`);
  console.log(`Permissive config (recentAccessDays=0): ${permissiveResult.protected_emails?.length || 0} protected, ${permissiveResult.cleanup_candidates?.length || 0} candidates`);
  
  if (defaultResult.protected_emails?.length > 0 && permissiveResult.cleanup_candidates?.length > 0) {
    console.log('✅ SUCCESS: Safety config is working correctly!');
    console.log('   - Default config protects recent emails');
    console.log('   - Permissive config allows cleanup of recent emails');
  } else {
    console.log('❌ ISSUE: Safety config may not be working as expected');
    console.log('   - Both configs should behave differently for recent emails');
  }
  
} catch (error) {
  console.error('❌ Simple safety test failed:', error.message);
  console.error('❌ Error details:', error);
}

console.log('\n=== SIMPLE SAFETY CONFIG TEST COMPLETED ===');