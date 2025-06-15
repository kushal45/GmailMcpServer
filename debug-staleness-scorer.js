import { DatabaseManager } from './build/database/DatabaseManager.js';
import { CleanupPolicyEngine } from './build/cleanup/CleanupPolicyEngine.js';
import { StalenessScorer } from './build/cleanup/StalenessScorer.js';
import { AccessPatternTracker } from './build/cleanup/AccessPatternTracker.js';

console.log('=== STALENESS SCORER TEST ===');

try {
  // 1. Setup database with test data
  console.log('1. Setting up database and test data...');
  const testDir = `data/debug-staleness-${Date.now()}`;
  const dbManager = new DatabaseManager(testDir);
  await dbManager.initialize();

  // Insert test email
  const testEmail = {
    id: 'staleness-test-email-1',
    threadId: 'thread-staleness-1',
    sender: ['test@example.com'],
    recipient: ['user@example.com'],
    subject: 'Staleness Test Email',
    date: new Date(Date.now() - (5 * 24 * 60 * 60 * 1000)), // 5 days old
    category: 'medium',
    labels: ['INBOX'],
    size: 1024,
    hasAttachments: false,
    importanceScore: 3.0,
    spam_score: 0.2,
    promotional_score: 0.3
  };

  await dbManager.upsertEmailIndex(testEmail);
  console.log('✅ Test email inserted');

  // 2. Test AccessPatternTracker directly
  console.log('2. Testing AccessPatternTracker...');
  const accessTracker = AccessPatternTracker.getInstance();
  
  try {
    const accessSummary = await accessTracker.getEmailAccessSummary(testEmail.id);
    console.log('📊 Access summary:', accessSummary);
  } catch (error) {
    console.log('❌ AccessPatternTracker failed:', error.message);
  }

  // 3. Test StalenessScorer directly
  console.log('3. Testing StalenessScorer...');
  const stalenessScorer = new StalenessScorer(accessTracker);
  
  try {
    const stalenessScore = await stalenessScorer.calculateStaleness(testEmail);
    console.log('📊 Staleness score:', stalenessScore);
  } catch (error) {
    console.log('❌ StalenessScorer failed:', error.message);
    console.log('❌ Error details:', error);
  }

  // 4. Test with NULL AccessPatternTracker
  console.log('4. Testing StalenessScorer with null AccessPatternTracker...');
  try {
    const stalenessScorer2 = new StalenessScorer(null);
    const stalenessScore2 = await stalenessScorer2.calculateStaleness(testEmail);
    console.log('📊 Staleness score (null tracker):', stalenessScore2);
  } catch (error) {
    console.log('❌ StalenessScorer with null tracker failed:', error.message);
  }

  // 5. Create CleanupPolicyEngine and test evaluation
  console.log('5. Testing CleanupPolicyEngine.evaluateSingleEmail...');
  const policyEngine = new CleanupPolicyEngine(dbManager, null, null);
  
  // Create simple policy
  const simplePolicy = {
    name: 'Staleness Test Policy',
    enabled: true,
    priority: 50,
    criteria: {
      age_days_min: 1,
      importance_level_max: 'high',
      spam_score_min: 0.1,
      promotional_score_min: 0.1,
      access_score_max: 0.9  // Allow emails with access score up to 0.9
    },
    action: {
      type: 'delete',
      method: 'gmail'
    },
    safety: {
      preserve_important: false,
      max_emails_per_run: 100,
      require_confirmation: false
    },
    schedule: {
      frequency: 'daily'
    }
  };

  const policyId = await policyEngine.createPolicy(simplePolicy);
  console.log('✅ Policy created');

  // Get the created policy
  const policy = await policyEngine.getPolicy(policyId);
  
  // Test evaluateSingleEmail directly using reflection
  try {
    // Access private method using reflection
    const evaluateSingleEmailMethod = policyEngine.constructor.prototype.evaluateSingleEmail || 
                                    policyEngine.evaluateSingleEmail;
    
    if (evaluateSingleEmailMethod) {
      const result = await evaluateSingleEmailMethod.call(policyEngine, testEmail, [policy]);
      console.log('📊 Single email evaluation result:', result);
    } else {
      console.log('❌ Cannot access evaluateSingleEmail method');
    }
  } catch (error) {
    console.log('❌ evaluateSingleEmail failed:', error.message);
    console.log('❌ Error details:', error);
  }

} catch (error) {
  console.log('❌ Test setup failed:', error.message);
  console.log('❌ Error details:', error);
}

console.log('\n=== STALENESS SCORER TEST COMPLETED ===');