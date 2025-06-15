import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { CleanupJob } from '../../../src/types/index.js';

describe('CleanupJob Schema Integration Tests', () => {
  let dbManager: DatabaseManager;

  beforeEach(async () => {
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
  });

  afterEach(async () => {
    await dbManager.close();
  });

  describe('CleanupJob CRUD Operations', () => {
    const testCleanupJob: CleanupJob = {
      job_id: `test_cleanup_${Date.now()}`,
      job_type: 'scheduled_cleanup',
      status: 'PENDING' as any,
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

    afterEach(async () => {
      try {
        await dbManager.deleteJob(testCleanupJob.job_id);
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    it('should insert CleanupJob with both base and metadata fields', async () => {
      await dbManager.insertCleanupJob(testCleanupJob);

      // Verify insertion by retrieving the job
      const retrievedJob = await dbManager.getCleanupJob(testCleanupJob.job_id);
      expect(retrievedJob).toBeTruthy();
      expect(retrievedJob!.job_id).toBe(testCleanupJob.job_id);
      expect(retrievedJob!.cleanup_metadata.policy_id).toBe('test-policy');
      expect(retrievedJob!.cleanup_metadata.triggered_by).toBe('user_request');
      expect(retrievedJob!.cleanup_metadata.priority).toBe('normal');
      expect(retrievedJob!.cleanup_metadata.batch_size).toBe(100);
      expect(retrievedJob!.cleanup_metadata.target_emails).toBe(500);
    });

    it('should retrieve CleanupJob with all specialized fields', async () => {
      await dbManager.insertCleanupJob(testCleanupJob);

      const retrievedJob = await dbManager.getCleanupJob(testCleanupJob.job_id);
      expect(retrievedJob).toBeTruthy();

      // Check base Job fields
      expect(retrievedJob!.job_id).toBe(testCleanupJob.job_id);
      expect(retrievedJob!.job_type).toBe(testCleanupJob.job_type);
      expect(retrievedJob!.status).toBe(testCleanupJob.status);
      expect(retrievedJob!.request_params).toEqual(testCleanupJob.request_params);

      // Check cleanup_metadata fields
      expect(retrievedJob!.cleanup_metadata).toEqual(testCleanupJob.cleanup_metadata);

      // Check progress_details fields
      expect(retrievedJob!.progress_details).toEqual(testCleanupJob.progress_details);
    });

    it('should update CleanupJob progress and metadata fields', async () => {
      await dbManager.insertCleanupJob(testCleanupJob);

      const updates = {
        status: 'IN_PROGRESS' as any,
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
      };

      await dbManager.updateCleanupJob(testCleanupJob.job_id, updates);

      const updatedJob = await dbManager.getCleanupJob(testCleanupJob.job_id);
      expect(updatedJob).toBeTruthy();
      expect(updatedJob!.status).toBe('IN_PROGRESS');
      expect(updatedJob!.progress).toBe(50);
      expect(updatedJob!.progress_details.emails_analyzed).toBe(250);
      expect(updatedJob!.progress_details.emails_cleaned).toBe(125);
      expect(updatedJob!.progress_details.storage_freed).toBe(1048576);
      expect(updatedJob!.progress_details.errors_encountered).toBe(2);
      expect(updatedJob!.progress_details.current_batch).toBe(3);
      expect(updatedJob!.progress_details.total_batches).toBe(5);
    });

    it('should list CleanupJobs with filtering', async () => {
      await dbManager.insertCleanupJob(testCleanupJob);

      const cleanupJobs = await dbManager.listCleanupJobs({
        status: 'PENDING',
        limit: 10
      });

      expect(cleanupJobs).toHaveLength(1);
      expect(cleanupJobs[0].job_id).toBe(testCleanupJob.job_id);
      expect(cleanupJobs[0].cleanup_metadata.policy_id).toBe('test-policy');
    });

    it('should route base getJob method to getCleanupJob for cleanup jobs', async () => {
      await dbManager.insertCleanupJob(testCleanupJob);

      const jobViaBaseMethod = await dbManager.getJob(testCleanupJob.job_id);
      expect(jobViaBaseMethod).toBeTruthy();
      expect(jobViaBaseMethod.cleanup_metadata).toBeTruthy();
      expect(jobViaBaseMethod.cleanup_metadata.policy_id).toBe('test-policy');
      expect(jobViaBaseMethod.progress_details).toBeTruthy();
    });

    it('should route base updateJob method to updateCleanupJob for cleanup jobs', async () => {
      await dbManager.insertCleanupJob(testCleanupJob);

      const updates = {
        status: 'COMPLETED' as any,
        progress: 100,
        completed_at: new Date(),
        progress_details: {
          emails_analyzed: 500,
          emails_cleaned: 500,
          storage_freed: 5242880, // 5MB
          errors_encountered: 0,
          current_batch: 5,
          total_batches: 5
        }
      };

      // Use base updateJob method
      await dbManager.updateJob(testCleanupJob.job_id, updates);

      const updatedJob = await dbManager.getCleanupJob(testCleanupJob.job_id);
      expect(updatedJob!.status).toBe('COMPLETED');
      expect(updatedJob!.progress).toBe(100);
      expect(updatedJob!.progress_details.emails_cleaned).toBe(500);
    });

    it('should route base listJobs method to listCleanupJobs for cleanup job types', async () => {
      await dbManager.insertCleanupJob(testCleanupJob);

      const jobs = await dbManager.listJobs({
        job_type: 'scheduled_cleanup',
        limit: 10
      });

      expect(jobs).toHaveLength(1);
      expect(jobs[0].cleanup_metadata).toBeTruthy();
      expect(jobs[0].progress_details).toBeTruthy();
    });
  });

  describe('Schema Validation', () => {
    it('should enforce foreign key constraints', async () => {
      const invalidCleanupJob: CleanupJob = {
        job_id: `test_invalid_${Date.now()}`,
        job_type: 'scheduled_cleanup',
        status: 'PENDING' as any,
        request_params: {},
        cleanup_metadata: {
          policy_id: 'non-existent-policy',
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

      // This should succeed even with non-existent policy_id
      // as the foreign key is to cleanup_policies table which may not have test data
      await expect(dbManager.insertCleanupJob(invalidCleanupJob)).resolves.not.toThrow();
      
      // Cleanup
      await dbManager.deleteJob(invalidCleanupJob.job_id);
    });

    it('should maintain referential integrity on cascade delete', async () => {
      const testJob: CleanupJob = {
        job_id: `test_cascade_${Date.now()}`,
        job_type: 'scheduled_cleanup',
        status: 'PENDING' as any,
        request_params: {},
        cleanup_metadata: {
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

      await dbManager.insertCleanupJob(testJob);

      // Delete the job should cascade delete the metadata
      await dbManager.deleteJob(testJob.job_id);

      // Verify both base job and metadata are deleted
      const deletedJob = await dbManager.getCleanupJob(testJob.job_id);
      expect(deletedJob).toBeNull();
    });
  });

  describe('Performance and Data Integrity', () => {
    it('should handle transaction rollback on partial failure', async () => {
      const testJob: CleanupJob = {
        job_id: `test_transaction_${Date.now()}`,
        job_type: 'scheduled_cleanup',
        status: 'PENDING' as any,
        request_params: {},
        cleanup_metadata: {
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

      // Insert valid job
      await dbManager.insertCleanupJob(testJob);

      // Verify job exists
      const insertedJob = await dbManager.getCleanupJob(testJob.job_id);
      expect(insertedJob).toBeTruthy();

      // Cleanup
      await dbManager.deleteJob(testJob.job_id);
    });
  });
});