import { DatabaseManager } from './build/database/DatabaseManager.js';
import { CleanupPolicyEngine } from './build/cleanup/CleanupPolicyEngine.js';

console.log('=== MINIMAL DATABASE TEST ===');

async function testDatabaseOperations() {
  let dbManager = null;
  let policyEngine = null;

  try {
    console.log('1. Creating DatabaseManager...');
    
    // Set unique test database path
    const testDbDir = `data/debug-test-${Date.now()}`;
    process.env.STORAGE_PATH = testDbDir;
    
    // Reset singleton and create fresh instance
    DatabaseManager.instance = null;
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
    console.log('✅ DatabaseManager created and initialized');

    console.log('2. Testing email insertion...');
    const testEmails = [
      {
        id: "test-email-1",
        threadId: "thread-1",
        category: "low",
        subject: "Test Email 1",
        sender: "test@example.com",
        recipients: ["user@example.com"],
        date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days old
        year: 2024,
        size: 15000,
        hasAttachments: false,
        labels: ["INBOX"],
        snippet: "Test email content...",
        archived: false,
        spam_score: 0.9,
        promotional_score: 0.8,
        importanceScore: 1
      },
      {
        id: "test-email-2",
        threadId: "thread-2",
        category: "low",
        subject: "Test Email 2",
        sender: "test2@example.com",
        recipients: ["user@example.com"],
        date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days old
        year: 2024,
        size: 25000,
        hasAttachments: false,
        labels: ["INBOX"],
        snippet: "Test email content 2...",
        archived: false,
        spam_score: 0.7,
        promotional_score: 0.9,
        importanceScore: 2
      }
    ];

    await dbManager.bulkUpsertEmailIndex(testEmails);
    console.log('✅ Emails inserted successfully');

    console.log('3. Testing email retrieval...');
    const allEmails = await dbManager.searchEmails({});
    console.log(`📧 Found ${allEmails.length} emails in database`);
    
    if (allEmails.length > 0) {
      console.log('📧 Email details:');
      allEmails.forEach((email, i) => {
        console.log(`  ${i+1}. ID: ${email.id}, Category: ${email.category}, Spam: ${email.spam_score}, Promo: ${email.promotional_score}`);
      });
    } else {
      console.error('❌ NO EMAILS FOUND - DATABASE INSERTION/RETRIEVAL FAILED');
      return;
    }

    console.log('4. Testing policy creation...');
    const testPolicy = {
      id: `test-policy-${Date.now()}`,
      name: "Debug Test Policy",
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

    // Create policy engine with no safety config to avoid complexity
    policyEngine = new CleanupPolicyEngine(dbManager, null, null, {});
    await policyEngine.createPolicy(testPolicy);
    console.log('✅ Policy created successfully');

    console.log('5. Testing policy retrieval...');
    const policies = await policyEngine.getActivePolicies();
    console.log(`📋 Found ${policies.length} policies in database`);
    
    if (policies.length > 0) {
      console.log('📋 Policy details:');
      policies.forEach((policy, i) => {
        console.log(`  ${i+1}. ID: ${policy.id}, Name: ${policy.name}, Criteria: ${JSON.stringify(policy.criteria)}`);
      });
    } else {
      console.error('❌ NO POLICIES FOUND - POLICY CREATION/RETRIEVAL FAILED');
      return;
    }

    console.log('6. Testing manual email-policy matching...');
    const matchingEmails = allEmails.filter(email => {
      const ageDays = Math.floor((Date.now() - (email.date?.getTime() || 0)) / (24 * 60 * 60 * 1000));
      const criteria = testPolicy.criteria;
      
      const matchesAge = ageDays >= criteria.age_days_min;
      const matchesImportance = email.category === 'low' || email.category === 'medium' || criteria.importance_level_max === 'high';
      const matchesSpam = (email.spam_score || 0) >= criteria.spam_score_min;
      const matchesPromo = (email.promotional_score || 0) >= criteria.promotional_score_min;
      
      console.log(`  Email ${email.id}: age=${ageDays}d ${matchesAge?'✅':'❌'}, importance=${email.category} ${matchesImportance?'✅':'❌'}, spam=${email.spam_score} ${matchesSpam?'✅':'❌'}, promo=${email.promotional_score} ${matchesPromo?'✅':'❌'}`);
      
      return matchesAge && matchesImportance && matchesSpam && matchesPromo;
    });
    
    console.log(`🎯 ${matchingEmails.length} emails should match policy criteria`);
    
    if (matchingEmails.length === 0) {
      console.error('❌ NO EMAILS MATCH CRITERIA - POLICY LOGIC ISSUE');
    } else {
      console.log('✅ DATABASE OPERATIONS WORK - ISSUE IS IN CLEANUP ENGINE OR WORKFLOW');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error('❌ Stack trace:', error.stack);
  } finally {
    // Cleanup
    try {
      if (dbManager) {
        await dbManager.close();
      }
    } catch (e) {
      console.warn('Cleanup warning:', e.message);
    }
  }
}

testDatabaseOperations().then(() => {
  console.log('\n=== TEST COMPLETED ===');
  process.exit(0);
}).catch(error => {
  console.error('❌ FATAL ERROR:', error);
  process.exit(1);
});