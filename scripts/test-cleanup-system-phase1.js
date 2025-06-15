#!/usr/bin/env node

/**
 * Email Cleanup System - Phase 1 Demonstration
 * 
 * This script demonstrates the foundation infrastructure components:
 * - AccessPatternTracker: Track email access patterns
 * - StalenessScorer: Calculate email staleness scores
 * - CleanupPolicyEngine: Manage cleanup policies and evaluate emails
 */

import { DatabaseManager } from '../src/database/DatabaseManager.js';
import { 
  AccessPatternTracker, 
  StalenessScorer, 
  CleanupPolicyEngine 
} from '../src/cleanup/index.js';
import { logger } from '../src/utils/logger.js';

// Mock email data for testing
const mockEmails = [
  {
    id: 'email_1',
    threadId: 'thread_1',
    category: 'low',
    subject: 'Special Offer - Limited Time Deal!',
    sender: 'sales@promotions.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // 180 days ago
    year: 2024,
    size: 52000,
    hasAttachments: false,
    labels: ['INBOX', 'CATEGORY_PROMOTIONS'],
    snippet: 'Amazing deals on electronics! Limited time offer...',
    archived: false,
    importanceScore: -2,
    importanceLevel: 'low',
    spamScore: 0.3,
    promotionalScore: 0.8,
    gmailCategory: 'promotions'
  },
  {
    id: 'email_2',
    threadId: 'thread_2',
    category: 'high',
    subject: 'Project Deadline Update - Action Required',
    sender: 'manager@company.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    year: 2024,
    size: 15000,
    hasAttachments: true,
    labels: ['INBOX', 'IMPORTANT'],
    snippet: 'Please review the updated project timeline...',
    archived: false,
    importanceScore: 12,
    importanceLevel: 'high',
    spamScore: 0.0,
    promotionalScore: 0.0,
    gmailCategory: 'primary'
  },
  {
    id: 'email_3',
    threadId: 'thread_3',
    category: 'medium',
    subject: 'Weekly Newsletter - Tech Updates',
    sender: 'newsletter@techblog.com',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
    year: 2024,
    size: 85000,
    hasAttachments: false,
    labels: ['INBOX'],
    snippet: 'This week in technology: AI advances, new frameworks...',
    archived: false,
    importanceScore: 2,
    importanceLevel: 'medium',
    spamScore: 0.1,
    promotionalScore: 0.4,
    gmailCategory: 'updates'
  },
  {
    id: 'email_4',
    threadId: 'thread_4',
    category: 'low',
    subject: 'URGENT: Your account has been compromised!',
    sender: 'security@fake-bank.net',
    recipients: ['user@example.com'],
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    year: 2024,
    size: 8000,
    hasAttachments: false,
    labels: ['INBOX', 'SPAM'],
    snippet: 'Click here immediately to secure your account...',
    archived: false,
    importanceScore: -8,
    importanceLevel: 'low',
    spamScore: 0.9,
    promotionalScore: 0.2,
    gmailCategory: 'spam'
  }
];

async function demonstratePhase1() {
  console.log('🚀 Email Cleanup System - Phase 1 Demonstration\n');

  try {
    // Initialize components
    console.log('📦 Initializing components...');
    const dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
    
    const accessTracker = AccessPatternTracker.getInstance();
    const stalenessScorer = new StalenessScorer(accessTracker);
    const policyEngine = CleanupPolicyEngine.getInstance();

    console.log('✅ Components initialized successfully\n');

    // Step 1: Insert mock emails into database
    console.log('📧 Setting up mock email data...');
    for (const email of mockEmails) {
      await dbManager.upsertEmailIndex(email);
    }
    console.log(`✅ Inserted ${mockEmails.length} mock emails\n`);

    // Step 2: Simulate access patterns
    console.log('👆 Simulating email access patterns...');
    
    // Simulate accessing important email multiple times
    await accessTracker.logEmailAccess({
      email_id: 'email_2',
      access_type: 'direct_view',
      timestamp: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      user_context: 'project_work'
    });
    
    await accessTracker.logEmailAccess({
      email_id: 'email_2',
      access_type: 'direct_view',
      timestamp: new Date(Date.now() - 12 * 60 * 60 * 1000), // 12 hours ago
      user_context: 'follow_up'
    });

    // Simulate search activity
    await accessTracker.logSearchActivity({
      search_id: 'search_1',
      query: 'project deadline',
      email_results: ['email_2', 'email_3'],
      result_interactions: ['email_2'],
      timestamp: new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours ago
    });

    // Never accessed promotional email (email_1)
    console.log('✅ Access patterns simulated\n');

    // Step 3: Calculate staleness scores
    console.log('🔍 Calculating staleness scores...');
    const stalenessResults = [];
    
    for (const email of mockEmails) {
      const score = await stalenessScorer.calculateStaleness(email);
      stalenessResults.push({ email, score });
      
      console.log(`📊 Email: ${email.subject.substring(0, 50)}...`);
      console.log(`   ID: ${email.id}`);
      console.log(`   Total Staleness: ${score.total_score}`);
      console.log(`   Recommendation: ${score.recommendation}`);
      console.log(`   Confidence: ${score.confidence}`);
      console.log(`   Factors:`);
      console.log(`     Age: ${score.factors.age_score}`);
      console.log(`     Importance: ${score.factors.importance_score}`);
      console.log(`     Size: ${score.factors.size_penalty}`);
      console.log(`     Spam: ${score.factors.spam_score}`);
      console.log(`     Access: ${score.factors.access_score}`);
      console.log('');
    }

    // Step 4: Create cleanup policies
    console.log('📋 Creating cleanup policies...');
    
    // Policy 1: Remove high-spam emails
    const spamPolicyId = await policyEngine.createPolicy({
      name: 'High Spam Cleanup',
      enabled: true,
      priority: 90,
      criteria: {
        age_days_min: 1,
        importance_level_max: 'low',
        spam_score_min: 0.8
      },
      action: {
        type: 'delete',
        method: 'gmail'
      },
      safety: {
        max_emails_per_run: 100,
        require_confirmation: false,
        dry_run_first: true,
        preserve_important: true
      },
      schedule: {
        frequency: 'daily',
        time: '02:00',
        enabled: true
      }
    });

    // Policy 2: Archive old promotional emails
    const promoPolicyId = await policyEngine.createPolicy({
      name: 'Old Promotional Archive',
      enabled: true,
      priority: 70,
      criteria: {
        age_days_min: 90,
        importance_level_max: 'medium',
        promotional_score_min: 0.6,
        no_access_days: 60
      },
      action: {
        type: 'archive',
        method: 'gmail'
      },
      safety: {
        max_emails_per_run: 500,
        require_confirmation: false,
        dry_run_first: false,
        preserve_important: true
      },
      schedule: {
        frequency: 'weekly',
        time: '01:00',
        enabled: true
      }
    });

    console.log(`✅ Created spam cleanup policy: ${spamPolicyId}`);
    console.log(`✅ Created promotional archive policy: ${promoPolicyId}\n`);

    // Step 5: Evaluate emails against policies
    console.log('⚖️  Evaluating emails against cleanup policies...');
    
    const evaluation = await policyEngine.evaluateEmailsForCleanup(mockEmails);
    
    console.log(`📈 Evaluation Summary:`);
    console.log(`   Total emails: ${evaluation.evaluation_summary.total_emails}`);
    console.log(`   Cleanup candidates: ${evaluation.evaluation_summary.candidates_count}`);
    console.log(`   Protected emails: ${evaluation.evaluation_summary.protected_count}`);
    console.log(`   Policies applied: ${evaluation.evaluation_summary.policies_applied}\n`);

    console.log('🗑️  Cleanup Candidates:');
    evaluation.cleanup_candidates.forEach((candidate, index) => {
      console.log(`   ${index + 1}. ${candidate.email.subject.substring(0, 60)}...`);
      console.log(`      Policy: ${candidate.policy.name}`);
      console.log(`      Action: ${candidate.recommended_action}`);
      console.log(`      Staleness: ${candidate.staleness_score.total_score}`);
      console.log('');
    });

    console.log('🛡️  Protected Emails:');
    evaluation.protected_emails.forEach((protectedEmail, index) => {
      console.log(`   ${index + 1}. ${protectedEmail.email.subject.substring(0, 60)}...`);
      console.log(`      Reason: ${protectedEmail.reason}`);
      console.log('');
    });

    // Step 6: Generate access analytics
    console.log('📊 Generating access pattern analytics...');
    const analytics = await accessTracker.generateAccessAnalytics(30);
    
    console.log('📈 Access Analytics (last 30 days):');
    console.log(`   Total access events: ${analytics.total_access_events}`);
    console.log(`   Unique emails accessed: ${analytics.unique_emails_accessed}`);
    console.log(`   Average accesses per email: ${analytics.average_accesses_per_email}`);
    console.log(`   Most accessed emails: ${analytics.most_accessed_emails.length}`);
    console.log('');

    // Step 7: Generate policy recommendations
    console.log('💡 Generating policy recommendations...');
    const recommendations = await policyEngine.generatePolicyRecommendations();
    
    console.log('🎯 Recommended Policies:');
    recommendations.recommended_policies.forEach((rec, index) => {
      console.log(`   ${index + 1}. ${rec.name}`);
      console.log(`      Description: ${rec.description}`);
      console.log(`      Estimated cleanup: ${rec.estimated_cleanup_count} emails`);
      console.log(`      Storage freed: ${Math.round(rec.estimated_storage_freed / 1024 / 1024)} MB`);
      console.log('');
    });

    console.log('📊 Email Analysis Summary:');
    console.log(`   Total emails: ${recommendations.analysis_summary.total_emails}`);
    console.log(`   Spam emails: ${recommendations.analysis_summary.spam_emails}`);
    console.log(`   Promotional emails: ${recommendations.analysis_summary.promotional_emails}`);
    console.log(`   Old emails: ${recommendations.analysis_summary.old_emails}`);
    console.log(`   Large emails: ${recommendations.analysis_summary.large_emails}\n`);

    // Step 8: Demonstrate staleness statistics
    console.log('📉 Generating staleness statistics...');
    const stalenessStats = await stalenessScorer.getStalenesStatistics(mockEmails);
    
    console.log('📊 Staleness Statistics:');
    console.log(`   Average staleness score: ${stalenessStats.average_staleness}`);
    console.log(`   High confidence scores: ${stalenessStats.high_confidence_scores}`);
    console.log(`   Recommendations:`);
    console.log(`     Keep: ${stalenessStats.recommendations.keep}`);
    console.log(`     Archive: ${stalenessStats.recommendations.archive}`);
    console.log(`     Delete: ${stalenessStats.recommendations.delete}`);
    console.log(`   Factor averages:`);
    console.log(`     Age: ${stalenessStats.factor_averages.age}`);
    console.log(`     Importance: ${stalenessStats.factor_averages.importance}`);
    console.log(`     Size: ${stalenessStats.factor_averages.size}`);
    console.log(`     Spam: ${stalenessStats.factor_averages.spam}`);
    console.log(`     Access: ${stalenessStats.factor_averages.access}\n`);

    console.log('✅ Phase 1 demonstration completed successfully!');
    console.log('\n🎉 Email Cleanup System Foundation Infrastructure is ready!');
    console.log('\n📋 What we accomplished in Phase 1:');
    console.log('   ✅ Access Pattern Tracking System');
    console.log('   ✅ Multi-factor Staleness Scoring');
    console.log('   ✅ Cleanup Policy Engine with Safety Mechanisms');
    console.log('   ✅ Database Schema Extensions');
    console.log('   ✅ Comprehensive Analytics and Reporting');
    console.log('\n🚀 Ready for Phase 2: Core Automation Engine!');

  } catch (error) {
    console.error('❌ Error during demonstration:', error);
    process.exit(1);
  } finally {
    // Clean up
    try {
      await DatabaseManager.getInstance().close();
    } catch (error) {
      console.error('Error closing database:', error);
    }
  }
}

// Run the demonstration
demonstratePhase1().catch(console.error);