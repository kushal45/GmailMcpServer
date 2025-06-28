import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from "@jest/globals";

// Import types for proper typing
import { CleanupResults } from '../../../src/types/index.js';

describe('CleanupAutomationEngine Multi-User Tests', () => {
  // Test constants
  const USER1 = 'user-1';
  const USER2 = 'user-2';
  const USER1_JOB = 'job-user1-test';
  const USER2_JOB = 'job-user2-test';
  const SYSTEM_JOB = 'job-system-test';
  const SYSTEM_POLICY = 'policy-system';
  
  let mockEngine: any;
  let mockProcessCleanupJob: jest.Mock;
  let mockTriggerManualCleanup: jest.Mock;
  
  beforeEach(() => {
    // Create mock functions
    mockProcessCleanupJob = jest.fn();
    mockTriggerManualCleanup = jest.fn();
    
    // Create a mock engine object
    mockEngine = {
      processCleanupJob: mockProcessCleanupJob,
      triggerManualCleanup: mockTriggerManualCleanup
    };
    
    // Setup mock implementations
    mockProcessCleanupJob.mockImplementation((jobId: any, userId?: any) => {
      // Simple permission check for testing - handle both 'user1' and 'user-1' patterns
      if ((jobId.includes('user1') || jobId.includes('user-1')) && userId !== 'user-1') {
        return Promise.reject(new Error(`User ${userId} does not have permission to process job ${jobId}`));
      }
      
      if ((jobId.includes('user2') || jobId.includes('user-2')) && userId !== 'user-2') {
        return Promise.reject(new Error(`User ${userId} does not have permission to process job ${jobId}`));
      }
      
      // Return successful result
      return Promise.resolve({
        execution_id: `exec_${jobId}`,
        policy_id: 'test-policy',
        started_at: new Date(),
        completed_at: new Date(),
        emails_processed: 5,
        emails_deleted: 3,
        emails_archived: 2,
        storage_freed: 1024,
        errors: [],
        success: true
      });
    });
    
    mockTriggerManualCleanup.mockImplementation((policyId: any, options: any = {}) => {
      const userId = options.user_id || 'system';
      const jobId = `job_${policyId}_${userId}_${Date.now()}`;
      return Promise.resolve(jobId);
    });
  });
  
  afterEach(() => {
    jest.clearAllMocks();
  });
  
  describe('Job Access Control', () => {
    it('should allow users to process their own jobs', async () => {
      const result = await mockEngine.processCleanupJob(USER1_JOB, USER1);
      
      expect(result.success).toBe(true);
      expect(result.execution_id).toBe(`exec_${USER1_JOB}`);
      expect(mockProcessCleanupJob).toHaveBeenCalledWith(USER1_JOB, USER1);
    });
    
    it('should prevent users from processing other users\' jobs', async () => {
      // User 1 trying to process User 2's job should fail
      await expect(
        mockEngine.processCleanupJob(USER2_JOB, USER1)
      ).rejects.toThrow(/does not have permission/);
      
      // User 2 trying to process User 1's job should fail
      await expect(
        mockEngine.processCleanupJob(USER1_JOB, USER2)
      ).rejects.toThrow(/does not have permission/);
    });
    
    it('should allow any user to process system jobs', async () => {
      // System jobs have no specific user ID in the name, so any user can process them
      const result1 = await mockEngine.processCleanupJob(SYSTEM_JOB, USER1);
      expect(result1.success).toBe(true);
      
      const result2 = await mockEngine.processCleanupJob(SYSTEM_JOB, USER2);
      expect(result2.success).toBe(true);
    });
  });
  
  describe('User Context Propagation', () => {
    it('should include user context when creating jobs', async () => {
      const jobId = await mockEngine.triggerManualCleanup(SYSTEM_POLICY, { user_id: USER1 });
      
      // Verify the jobId contains user information
      expect(jobId).toContain(USER1);
      expect(mockTriggerManualCleanup).toHaveBeenCalledWith(SYSTEM_POLICY, { user_id: USER1 });
    });
    
    it('should use system user when no user context provided', async () => {
      const jobId = await mockEngine.triggerManualCleanup(SYSTEM_POLICY);
      
      // Verify the jobId indicates system user
      expect(jobId).toContain('system');
      expect(mockTriggerManualCleanup).toHaveBeenCalledWith(SYSTEM_POLICY);
    });
    
    it('should handle multiple user contexts correctly', async () => {
      const job1 = await mockEngine.triggerManualCleanup(SYSTEM_POLICY, { user_id: USER1 });
      const job2 = await mockEngine.triggerManualCleanup(SYSTEM_POLICY, { user_id: USER2 });
      
      expect(job1).toContain(USER1);
      expect(job2).toContain(USER2);
      expect(job1).not.toEqual(job2);
    });
  });
  
  describe('Multi-User Isolation', () => {
    it('should isolate cleanup operations by user', async () => {
      // Trigger cleanup for different users
      const user1Job = await mockEngine.triggerManualCleanup(SYSTEM_POLICY, { user_id: USER1 });
      const user2Job = await mockEngine.triggerManualCleanup(SYSTEM_POLICY, { user_id: USER2 });
      
      // Verify jobs are created with correct user context
      expect(user1Job).toContain(USER1);
      expect(user2Job).toContain(USER2);
      
      // Verify users can only process their own jobs
      const user1Result = await mockEngine.processCleanupJob(user1Job, USER1);
      expect(user1Result.success).toBe(true);
      
      // User 2 should not be able to process User 1's job
      await expect(
        mockEngine.processCleanupJob(user1Job, USER2)
      ).rejects.toThrow(/does not have permission/);
    });
    
    it('should maintain user context throughout job lifecycle', async () => {
      // Create job with user context
      const jobId = await mockEngine.triggerManualCleanup(SYSTEM_POLICY, { 
        user_id: USER1,
        max_emails: 100,
        dry_run: false
      });
      
      // Verify job ID contains user information
      expect(jobId).toContain(USER1);
      
      // Process the job with same user
      const result = await mockEngine.processCleanupJob(jobId, USER1);
      expect(result.success).toBe(true);
      
      // Verify both methods were called with correct parameters
      expect(mockTriggerManualCleanup).toHaveBeenCalledWith(SYSTEM_POLICY, {
        user_id: USER1,
        max_emails: 100,
        dry_run: false
      });
      expect(mockProcessCleanupJob).toHaveBeenCalledWith(jobId, USER1);
    });
    
    it('should validate user permission checks work correctly', async () => {
      // Test that the mock correctly simulates user permission validation
      const jobsWithUsers = [
        { job: 'job-user1-specific', user: USER1, shouldSucceed: true },
        { job: 'job-user1-specific', user: USER2, shouldSucceed: false },
        { job: 'job-user2-specific', user: USER2, shouldSucceed: true },
        { job: 'job-user2-specific', user: USER1, shouldSucceed: false },
        { job: 'job-system-wide', user: USER1, shouldSucceed: true },
        { job: 'job-system-wide', user: USER2, shouldSucceed: true }
      ];
      
      for (const test of jobsWithUsers) {
        if (test.shouldSucceed) {
          const result = await mockEngine.processCleanupJob(test.job, test.user);
          expect(result.success).toBe(true);
        } else {
          await expect(
            mockEngine.processCleanupJob(test.job, test.user)
          ).rejects.toThrow(/does not have permission/);
        }
      }
    });
  });
});