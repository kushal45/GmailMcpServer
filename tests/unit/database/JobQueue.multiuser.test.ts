import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";

import { JobQueue } from '../../../src/database/JobQueue.js';
import { JobStatusStore } from '../../../src/database/JobStatusStore.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { Job, JobStatus } from '../../../src/types/index.js';
import fs from 'fs/promises';
import path from 'path';

// Mock dependencies
jest.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}));

// Mock fs operations
jest.mock('fs/promises');
const mockedFs = fs as jest.Mocked<typeof fs>;

// Mock JobStatusStore
jest.mock('../../../src/database/JobStatusStore.js');

// Mock DatabaseManager
jest.mock('../../../src/database/DatabaseManager.js');

describe('JobQueue Multi-User Tests', () => {
  let jobQueue: JobQueue;
  let jobStatusStore: jest.Mocked<JobStatusStore>;
  let dbManager: jest.Mocked<DatabaseManager>;
  
  // Test users
  const testUsers = {
    user1: 'user-1',
    user2: 'user-2',
    admin: 'admin-1'
  };
  
  // Sample jobs
  const testJobs: Record<string, Job> = {
    user1Job1: {
      job_id: 'job-user1-1',
      job_type: 'categorize',
      status: JobStatus.PENDING,
      request_params: { year: 2024 },
      created_at: new Date(),
      user_id: testUsers.user1
    } as Job,
    user1Job2: {
      job_id: 'job-user1-2',
      job_type: 'archive',
      status: JobStatus.PENDING,
      request_params: { category: 'low' },
      created_at: new Date(),
      user_id: testUsers.user1
    } as Job,
    user2Job1: {
      job_id: 'job-user2-1',
      job_type: 'categorize',
      status: JobStatus.PENDING,
      request_params: { year: 2023 },
      created_at: new Date(),
      user_id: testUsers.user2
    } as Job
  };
  
  // Create mock job processor
const mockJobHandler = jest.fn() as jest.MockedFunction<(jobId: string, userId?: string) => Promise<void>>;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mocked instances
    dbManager = new DatabaseManager({ databasePath: './data' } as any) as jest.Mocked<DatabaseManager>;
    jobStatusStore = new JobStatusStore(dbManager) as jest.Mocked<JobStatusStore>;
    
    // Mock JobStatusStore methods
    (jobStatusStore.createJob as jest.Mock) = jest.fn().mockImplementation(
      (...args: unknown[]) => {
        const [job_type, request_params, user_id] = args as [string, any, string | undefined];
        const job_id = `job-${Date.now()}`;
        return Promise.resolve(job_id);
      });
    
    (jobStatusStore.getJobStatus as jest.Mock) = jest.fn().mockImplementation(
      (...args: unknown[]) => {
        const [job_id, user_id] = args as [string, string | undefined];
        // Only return jobs that belong to the specified user
        if (job_id === testJobs.user1Job1.job_id && 
            (!user_id || user_id === testUsers.user1 || user_id === testUsers.admin)) {
          return Promise.resolve(testJobs.user1Job1);
        }
        if (job_id === testJobs.user1Job2.job_id && 
            (!user_id || user_id === testUsers.user1 || user_id === testUsers.admin)) {
          return Promise.resolve(testJobs.user1Job2);
        }
        if (job_id === testJobs.user2Job1.job_id && 
            (!user_id || user_id === testUsers.user2 || user_id === testUsers.admin)) {
          return Promise.resolve(testJobs.user2Job1);
        }
        return Promise.resolve(null);
      });
    
 (jobStatusStore.updateJobStatus as any)= jest.fn().mockImplementation(async () => {
  return Promise.resolve();
});

    
    (jobStatusStore.listJobs as jest.Mock) = jest.fn().mockImplementation(
      (filters: any = {}) => {
        const jobs = Object.values(testJobs);
        // Filter by user_id if specified
        if (filters.user_id) {
          return Promise.resolve(jobs.filter(job => job.user_id === filters.user_id));
        }
        return Promise.resolve(jobs);
      }
    );
    
    // Initialize JobQueue
    jobQueue = new JobQueue();
  });  
  describe('Job Queue Management with User Context', () => {
    test('should add jobs to user-specific queues', async () => {
      // Act
      await jobQueue.addJob('job-1', testUsers.user1);
      await jobQueue.addJob('job-2', testUsers.user1);
      await jobQueue.addJob('job-3', testUsers.user2);
      await jobQueue.addJob('job-4'); // System job
      
      // Assert
      expect(jobQueue.getQueueLength(testUsers.user1)).toBe(2);
      expect(jobQueue.getQueueLength(testUsers.user2)).toBe(1);
      expect(jobQueue.getQueueLength()).toBe(4); // Total across all queues
      
      // Check user-specific jobs
      const user1Jobs = jobQueue.getUserJobs(testUsers.user1);
      expect(user1Jobs).toHaveLength(2);
      expect(user1Jobs).toContain('job-1');
      expect(user1Jobs).toContain('job-2');
      
      const user2Jobs = jobQueue.getUserJobs(testUsers.user2);
      expect(user2Jobs).toHaveLength(1);
      expect(user2Jobs).toContain('job-3');
    });
    
    test('should retrieve jobs from user-specific queues', async () => {
      // Arrange
      await jobQueue.addJob('job-1', testUsers.user1);
      await jobQueue.addJob('job-2', testUsers.user1);
      await jobQueue.addJob('job-3', testUsers.user2);
      
      // Act - Retrieve a job specifically for user1
      const user1Job = await jobQueue.retrieveJob(testUsers.user1);
      
      // Assert
      expect(user1Job.jobId).toBe('job-1');
      expect(user1Job.userId).toBe(testUsers.user1);
      expect(jobQueue.getQueueLength(testUsers.user1)).toBe(1); // One job left
      
      // Act - Retrieve a job specifically for user2
      const user2Job = await jobQueue.retrieveJob(testUsers.user2);
      
      // Assert
      expect(user2Job.jobId).toBe('job-3');
      expect(user2Job.userId).toBe(testUsers.user2);
      expect(jobQueue.getQueueLength(testUsers.user2)).toBe(0); // No jobs left
    });
    
    test('should respect user isolation when retrieving jobs', async () => {
      // Arrange
      await jobQueue.addJob('job-1', testUsers.user1);
      await jobQueue.addJob('job-2', testUsers.user2);
      
      // Act - Try to retrieve user2's job using user1 context
      const retrievedJob = await jobQueue.retrieveJob(testUsers.user1);
      
      // Assert - Should only get user1's job
      expect(retrievedJob.jobId).toBe('job-1');
      expect(retrievedJob.userId).toBe(testUsers.user1);
      
      // Act - After user1's jobs are processed, trying to get another should return null
      const emptyRetrieve = await jobQueue.retrieveJob(testUsers.user1);
      
      // Assert
      expect(emptyRetrieve.jobId).toBeNull();
      
      // But user2's job should still be in the queue
      expect(jobQueue.getQueueLength(testUsers.user2)).toBe(1);
    });
    
    test('should clear jobs by user ID', () => {
      // Arrange
      jobQueue.addJob('job-1', testUsers.user1);
      jobQueue.addJob('job-2', testUsers.user1);
      jobQueue.addJob('job-3', testUsers.user2);
      jobQueue.addJob('job-4'); // System job
      
      // Act - Clear only user1's jobs
      jobQueue.clearQueue(testUsers.user1);
      
      // Assert
      expect(jobQueue.getQueueLength(testUsers.user1)).toBe(0);
      expect(jobQueue.getQueueLength(testUsers.user2)).toBe(1);
      expect(jobQueue.getQueueLength()).toBe(2); // user2 + system job
      
      // Act - Clear all jobs
      jobQueue.clearQueue();
      
      // Assert
      expect(jobQueue.getQueueLength()).toBe(0);
    });
  });
  
  describe('Job Handler Registration', () => {
    test('should register job handlers for specific job types', () => {
      // Act
      jobQueue.registerJobHandler('categorize', mockJobHandler);
      
      // Assert - Use a workaround to check if handler is registered
      // Since the handlers map is private
      const handlers = (jobQueue as any).jobHandlers;
      expect(handlers.has('categorize')).toBe(true);
      expect(handlers.get('categorize')).toBe(mockJobHandler);
    });
    
    test('should call job handler with user context', async () => {
      // Arrange
      // Create a test handler that verifies user context
      const testHandler =jest.fn() as jest.MockedFunction<(jobId: string, userId?: string) => Promise<void>>;
      
      // Register the handler
      jobQueue.registerJobHandler('categorize', testHandler);
      
      // Add a job
      await jobQueue.addJob('job-test-1', testUsers.user1);
      
      // Mock the retrieveJob method to return our job
      jest.spyOn(jobQueue, 'retrieveJob').mockResolvedValue({
        jobId: 'job-test-1',
        userId: testUsers.user1
      });
      
      // Execute the handler (simulate processing)
      const { jobId, userId } = await jobQueue.retrieveJob(testUsers.user1);
      if (jobId && (jobQueue as any).jobHandlers.has('categorize')) {
        await (jobQueue as any).jobHandlers.get('categorize')(jobId, userId);
      }
      
      // Verify the handler was called with correct context
      expect(testHandler).toHaveBeenCalledWith('job-test-1', testUsers.user1);
    });
  });
  
  describe('Integration with JobStatusStore', () => {
    test('should handle job creation with user context', async () => {
      // This is a higher-level integration test that would normally use both JobQueue and JobStatusStore
      // Create a sample job creation flow that respects user context
      
      // Simulated high-level method
      const createAndQueueJob = async (jobType: string, params: any, userId?: string) => {
        // 1. Create job in the status store
        const jobId = await jobStatusStore.createJob(jobType, params, userId);
        
        // 2. Add to the queue
        await jobQueue.addJob(jobId, userId);
        
        return jobId;
      };
      
      // Act
      const jobId = await createAndQueueJob('categorize', { year: 2024 }, testUsers.user1);
      
      // Assert
      expect(jobStatusStore.createJob).toHaveBeenCalledWith('categorize', { year: 2024 }, testUsers.user1);
      expect(jobQueue.getQueueLength(testUsers.user1)).toBe(1);
      
      // Get jobs for user
      const userJobs = jobQueue.getUserJobs(testUsers.user1);
      expect(userJobs).toContain(jobId);
    });
    
    test('should integrate with job processing while respecting user context', async () => {
      // Create a simulated job processor that respects user context
      const processJob = async (jobId: string, userId?: string) => {
        // 1. Update job status to in progress
        await jobStatusStore.updateJobStatus(jobId, JobStatus.IN_PROGRESS, {
          started_at: new Date()
        });
        
        try {
          // 2. Get job details (with user context check)
          const job = await jobStatusStore.getJobStatus(jobId, userId);
          
          if (!job) {
            throw new Error(`Job ${jobId} not found or access denied`);
          }
          
          // 3. Process based on job type (normally this would dispatch to appropriate handler)
          // Here we just mock completion
          
          // 4. Update job status to completed
          await jobStatusStore.updateJobStatus(jobId, JobStatus.COMPLETED, {
            completed_at: new Date(),
            results: { processed: true }
          });
          
          return { success: true };
        } catch (error) {
          // Update job status to failed
          await jobStatusStore.updateJobStatus(jobId, JobStatus.FAILED, {
            error_details: (error as Error).message
          });
          
          return { success: false, error };
        }
      };
      
      // Act - Process a job for user1
      await processJob(testJobs.user1Job1.job_id, testUsers.user1);
      
      // Assert - Job status should be updated
      expect(jobStatusStore.updateJobStatus).toHaveBeenCalledWith(
        testJobs.user1Job1.job_id,
        JobStatus.IN_PROGRESS,
        expect.objectContaining({
          started_at: expect.any(Date)
        })
      );
      
      expect(jobStatusStore.updateJobStatus).toHaveBeenCalledWith(
        testJobs.user1Job1.job_id,
        JobStatus.COMPLETED,
        expect.objectContaining({
          completed_at: expect.any(Date)
        })
      );
      
      // Act - Try to process user2's job with user1 context (should fail)
      const result = await processJob(testJobs.user2Job1.job_id, testUsers.user1);
      
      // Assert - Should fail due to user context mismatch
      expect(result.success).toBe(false);
      expect(jobStatusStore.updateJobStatus).toHaveBeenCalledWith(
        testJobs.user2Job1.job_id,
        JobStatus.FAILED,
        expect.any(Object)
      );
    });
  });
});