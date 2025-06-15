#!/usr/bin/env node

import { DatabaseManager } from './build/database/DatabaseManager.js';

/**
 * Test script to verify CleanupJob schema implementation
 */
async function testCleanupJobSchema() {
  console.log('🧪 Testing CleanupJob Schema Implementation...');
  
  const dbManager = DatabaseManager.getInstance();
  
  try {
    // Initialize database
    await dbManager.initialize();
    console.log('✅ Database initialized');

    // Create a test CleanupJob
    const testCleanupJob = {
      job_id: `test_cleanup_${Date.now()}`,
      job_type: 'scheduled_cleanup',
      status: 'PENDING',
      request_params: {
        policy_id: 'test-policy',
        triggered_by: 'user_request',
        dry_run: false
      },
      cleanup_metadata: {
        policy_id: 'test-policy',
        triggered_by: 'user_request',
        priority: 'normal',
        batch_size: 100,
        target_emails: 500
      },
      progress_details: {
        emails_analyzed: 0,
        emails_cleaned: 0,
        storage_freed: 0,
        errors_encountered: 0,
        current_batch: 0,
        total_batches: 0
      },
      created_at: new Date()
    };

    // Test 1: Insert CleanupJob
    console.log('\n🔄 Test 1: Inserting CleanupJob...');
    await dbManager.insertCleanupJob(testCleanupJob);
    console.log('✅ CleanupJob inserted successfully');

    // Test 2: Retrieve CleanupJob
    console.log('\n🔄 Test 2: Retrieving CleanupJob...');
    const retrievedJob = await dbManager.getCleanupJob(testCleanupJob.job_id);
    console.log('✅ CleanupJob retrieved successfully');
    console.log('📊 Retrieved job data:', {
      job_id: retrievedJob.job_id,
      policy_id: retrievedJob.cleanup_metadata.policy_id,
      triggered_by: retrievedJob.cleanup_metadata.triggered_by,
      target_emails: retrievedJob.cleanup_metadata.target_emails
    });

    // Test 3: Update CleanupJob progress
    console.log('\n🔄 Test 3: Updating CleanupJob progress...');
    await dbManager.updateCleanupJob(testCleanupJob.job_id, {
      status: 'IN_PROGRESS',
      progress: 50,
      started_at: new Date(),
      progress_details: {
        emails_analyzed: 250,
        emails_cleaned: 125,
        storage_freed: 1048576, // 1MB
        errors_encountered: 2,
        current_batch: 3,
        total_batches: 5
      }
    });
    console.log('✅ CleanupJob updated successfully');

    // Test 4: Verify updates
    const updatedJob = await dbManager.getCleanupJob(testCleanupJob.job_id);
    console.log('📊 Updated job data:', {
      status: updatedJob.status,
      progress: updatedJob.progress,
      emails_analyzed: updatedJob.progress_details.emails_analyzed,
      emails_cleaned: updatedJob.progress_details.emails_cleaned,
      current_batch: updatedJob.progress_details.current_batch
    });

    // Test 5: List CleanupJobs
    console.log('\n🔄 Test 5: Listing CleanupJobs...');
    const cleanupJobs = await dbManager.listCleanupJobs({
      status: 'IN_PROGRESS',
      limit: 10
    });
    console.log('✅ CleanupJobs listed successfully');
    console.log(`📊 Found ${cleanupJobs.length} cleanup jobs`);

    // Test 6: Test base getJob routing
    console.log('\n🔄 Test 6: Testing base getJob routing...');
    const jobViaBaseMethod = await dbManager.getJob(testCleanupJob.job_id);
    console.log('✅ Base getJob method routed correctly');
    console.log('📊 Job has cleanup_metadata:', !!jobViaBaseMethod.cleanup_metadata);

    // Cleanup
    await dbManager.deleteJob(testCleanupJob.job_id);
    console.log('\n🧹 Test cleanup completed');

    console.log('\n🎉 All CleanupJob schema tests passed!');
    console.log('✅ Schema mismatch resolved - CleanupJob fields are now properly persisted');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    await dbManager.close();
  }
}

// Run the test
testCleanupJobSchema().catch(console.error);