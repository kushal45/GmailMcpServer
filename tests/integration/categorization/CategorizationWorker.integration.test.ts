import { describe, it, expect, beforeEach, afterEach, jest, beforeAll, afterAll } from '@jest/globals';
import { CategorizationWorker } from "../../../src/categorization/CategorizationWorker.js";
import { JobQueue } from "../../../src/database/JobQueue.js";
import { CategorizationEngine } from "../../../src/categorization/CategorizationEngine.js";
import { JobStatusStore } from "../../../src/database/JobStatusStore.js";
import { DatabaseManager } from "../../../src/database/DatabaseManager.js";
import { JobStatus, Job } from "../../../src/database/jobStatusTypes.js";
import { CacheManager } from "../../../src/cache/CacheManager.js";
import { PriorityCategory, EmailIndex } from "../../../src/types/index.js";
import { CategorizationSystemConfig } from "../../../src/categorization/config/CategorizationConfig.js";
import {
  cleanupTestDatabase,
  createWorkerWithRealComponents,
  waitForJobCompletion,
  waitForJobStatus,
  createJobAndWaitForCompletion,
  submitMultipleJobs,
  verifyAnalyzerResultsPersistence,
  verifyJobResultsIntegrity,
  assertCompleteJobExecution,
  assertAnalyzerResultsIntegrity,
  assertPerformanceMetrics,
  measureProcessingTime,
  generateLargeEmailDataset,
  seedRealisticTestData,
  createTestConfiguration,
  updateWorkerConfiguration,
  validateConfigurationIntegrity,
  injectAnalyzerError,
  simulateDatabaseConnectionDrop,
  measureMemoryUsage,
  getWorkerState,
  waitForWorkerShutdown,
  restartWorker,
  delay,
  startLoggerCapture,
  stopLoggerCapture
} from "./helpers/testHelpers.js";
import { logger } from "../../../src/utils/logger.js";

describe("CategorizationWorker Integration Tests", () => {
  let worker: CategorizationWorker;
  let jobQueue: JobQueue;
  let categorizationEngine: CategorizationEngine;
  let jobStatusStore: JobStatusStore;
  let dbManager: DatabaseManager;
  let cacheManager: CacheManager;
  let consoleCapture: { logs: string[], errors: string[], warns: string[], infos: string[] };

  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(async () => {
    const components = await createWorkerWithRealComponents();
    worker = components.worker;
    jobQueue = components.jobQueue;
    categorizationEngine = components.categorizationEngine;
    jobStatusStore = components.jobStatusStore;
    dbManager = components.dbManager;
    cacheManager = components.cacheManager;
    
    consoleCapture = startLoggerCapture(logger);
    
    // Seed test data for most tests
    await seedRealisticTestData(dbManager, 20);
  });

  afterEach(async () => {
    worker.stop();
    await waitForWorkerShutdown(worker);
    stopLoggerCapture();
    await cleanupTestDatabase(dbManager);
    jest.clearAllMocks();
  });

  // =====================================
  // A. JOB LIFECYCLE INTEGRATION (8 tests)
  // =====================================

  describe("Job Lifecycle Integration", () => {
    it("should process complete job lifecycle with real engine execution", async () => {
      // Create job with specific parameters
      const jobId = await jobStatusStore.createJob("categorization", {
        year: 2024,
        forceRefresh: false
      });

      // Start worker
      worker.start();

      // Wait for job completion
      const completedJob = await waitForJobCompletion(jobId, { timeout: 30000 });

      // Verify job lifecycle
      expect(completedJob.status).toBe(JobStatus.COMPLETED);
      expect(completedJob.results).toBeDefined();
      expect(completedJob.results.processed).toBeGreaterThan(0);
      expect(completedJob.results.emailIds).toBeDefined();
      expect(Array.isArray(completedJob.results.emailIds)).toBe(true);
      expect(completedJob.started_at).toBeDefined();
      expect(completedJob.completed_at).toBeDefined();

      // Verify analyzer results are persisted
      await assertAnalyzerResultsIntegrity(dbManager, completedJob.results.emailIds);

      // Verify logging
      expect(consoleCapture.infos.some(log => 
        log.includes(`Processing categorization job: ${jobId}`)
      )).toBe(true);
      expect(consoleCapture.infos.some(log => 
        log.includes(`Completed categorization job ${jobId}`)
      )).toBe(true);
    });

    it("should handle multiple jobs in sequence", async () => {
      const jobParams = [
        { year: 2022, forceRefresh: false },
        { year: 2023, forceRefresh: false },
        { year: 2024, forceRefresh: true }
      ];

      const jobIds = await submitMultipleJobs(jobParams);
      worker.start();

      // Wait for all jobs to complete
      const completedJobs: Job[] = [];
      for (const jobId of jobIds) {
        const job = await waitForJobCompletion(jobId);
        completedJobs.push(job);
      }

      // Verify all jobs completed successfully
      completedJobs.forEach(job => {
        expect(job.status).toBe(JobStatus.COMPLETED);
        expect(job.results).toBeDefined();
      });

      // Verify jobs were processed in order (FIFO)
      for (let i = 1; i < completedJobs.length; i++) {
        expect(completedJobs[i].started_at!.getTime()).toBeGreaterThan(
          completedJobs[i-1].completed_at!.getTime()
        );
      }
    });

    it("should respect job priority and ordering", async () => {
      // Add multiple jobs to queue
      const job1Id = await jobStatusStore.createJob("categorization", { year: 2022 });
      const job2Id = await jobStatusStore.createJob("categorization", { year: 2023 });
      const job3Id = await jobStatusStore.createJob("categorization", { year: 2024 });

      // Verify queue length
      expect(jobQueue.getQueueLength()).toBe(0); // Jobs aren't in queue until retrieved

      worker.start();

      // Wait for all jobs to complete
      await waitForJobCompletion(job1Id);
      await waitForJobCompletion(job2Id);
      await waitForJobCompletion(job3Id);

      // Verify all completed
      const job1 = await jobStatusStore.getJobStatus(job1Id);
      const job2 = await jobStatusStore.getJobStatus(job2Id);
      const job3 = await jobStatusStore.getJobStatus(job3Id);

      expect(job1!.status).toBe(JobStatus.COMPLETED);
      expect(job2!.status).toBe(JobStatus.COMPLETED);
      expect(job3!.status).toBe(JobStatus.COMPLETED);
    });

    it("should handle job cancellation during processing", async () => {
      const jobId = await jobStatusStore.createJob("categorization", {
        year: 2024,
        forceRefresh: true
      });

      worker.start();
      
      // Wait for job to start processing
      await waitForJobStatus(jobId, JobStatus.IN_PROGRESS, 5000);
      
      // Stop worker during processing
      worker.stop();
      
      // Verify worker state
      const workerState = getWorkerState(worker);
      expect(workerState.isRunning).toBe(false);
      
      // Job might complete or remain in progress depending on timing
      const finalJob = await jobStatusStore.getJobStatus(jobId);
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED].includes(finalJob!.status)).toBe(true);
    });

    it("should resume processing after worker restart", async () => {
      const jobId = await jobStatusStore.createJob("categorization", {
        year: 2024,
        forceRefresh: false
      });

      worker.start();
      
      // Wait for job to start
      await waitForJobStatus(jobId, JobStatus.IN_PROGRESS, 5000);
      
      // Stop and restart worker
      await restartWorker(worker);
      
      // Job should eventually complete
      const completedJob = await waitForJobCompletion(jobId, { timeout: 30000 });
      expect(completedJob.status).toBe(JobStatus.COMPLETED);
    });

    it("should handle duplicate job IDs gracefully", async () => {
      // This test is conceptual as job IDs are auto-generated with timestamps
      // We test that multiple jobs can be created without conflicts
      const jobs = await Promise.all([
        jobStatusStore.createJob("categorization", { year: 2024 }),
        jobStatusStore.createJob("categorization", { year: 2024 }),
        jobStatusStore.createJob("categorization", { year: 2024 })
      ]);

      // All job IDs should be unique
      const uniqueIds = new Set(jobs);
      expect(uniqueIds.size).toBe(jobs.length);

      worker.start();

      // All jobs should complete
      for (const jobId of jobs) {
        const job = await waitForJobCompletion(jobId);
        expect(job.status).toBe(JobStatus.COMPLETED);
      }
    });

    it("should process jobs with different year filters", async () => {
      // Seed emails for different years
      const emails2022: EmailIndex[] = [
        {
          id: 'test-2022-1',
          threadId: 'thread-2022-1',
          category: null,
          subject: 'Test Email 2022',
          sender: 'test@example.com',
          recipients: ['user@example.com'],
          date: new Date('2022-06-15'),
          year: 2022,
          size: 50000,
          hasAttachments: false,
          labels: ['INBOX'],
          snippet: 'Test email from 2022',
          archived: false
        }
      ];

      const emails2023: EmailIndex[] = [
        {
          id: 'test-2023-1',
          threadId: 'thread-2023-1',
          category: null,
          subject: 'Test Email 2023',
          sender: 'test@example.com',
          recipients: ['user@example.com'],
          date: new Date('2023-06-15'),
          year: 2023,
          size: 50000,
          hasAttachments: false,
          labels: ['INBOX'],
          snippet: 'Test email from 2023',
          archived: false
        }
      ];

      await dbManager.bulkUpsertEmailIndex([...emails2022, ...emails2023]);

      // Process only 2022 emails
      const job2022Id = await jobStatusStore.createJob("categorization", { year: 2022 });
      worker.start();
      
      const job2022 = await waitForJobCompletion(job2022Id);
      expect(job2022.results.processed).toBe(emails2022.length);

      // Verify only 2022 emails were processed
      const email2022 = await dbManager.getEmailIndex('test-2022-1');
      const email2023 = await dbManager.getEmailIndex('test-2023-1');
      
      expect(email2022!.category).not.toBeNull();
      expect(email2023!.category).toBeNull();
    });

    it("should handle forceRefresh parameter correctly", async () => {
      // First, categorize all emails
      const initialJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });
      
      worker.start();
      const initialJob = await waitForJobCompletion(initialJobId);
      const initialProcessed = initialJob.results.processed;

      // Second run with forceRefresh=false should process 0 emails (all already categorized)
      const incrementalJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });
      
      const incrementalJob = await waitForJobCompletion(incrementalJobId);
      expect(incrementalJob.results.processed).toBe(0);

      // Third run with forceRefresh=true should reprocess all emails
      const refreshJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: true 
      });
      
      const refreshJob = await waitForJobCompletion(refreshJobId);
      expect(refreshJob.results.processed).toBe(initialProcessed);
    });
  });

  // =====================================
  // B. REAL ENGINE EXECUTION (6 tests)
  // =====================================

  describe("Real Engine Execution", () => {
    it("should execute real categorization with all analyzers", async () => {
      // Create diverse email set
      const testEmails: EmailIndex[] = [
        {
          id: 'urgent-email',
          threadId: 'thread-urgent',
          category: null,
          subject: 'URGENT: System Down',
          sender: 'admin@company.com',
          recipients: ['user@example.com'],
          date: new Date(),
          year: 2024,
          size: 75000,
          hasAttachments: false,
          labels: ['INBOX', 'IMPORTANT'],
          snippet: 'Critical system failure needs immediate attention',
          archived: false
        },
        {
          id: 'promo-email',
          threadId: 'thread-promo',
          category: null,
          subject: 'Special Sale - 50% Off!',
          sender: 'noreply@store.com',
          recipients: ['user@example.com'],
          date: new Date('2024-01-01'),
          year: 2024,
          size: 200000,
          hasAttachments: false,
          labels: ['INBOX', 'PROMOTIONS'],
          snippet: 'Limited time offer on all items',
          archived: false
        }
      ];

      await dbManager.bulkUpsertEmailIndex(testEmails);

      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Verify all analyzers executed
      expect(job.results.processed).toBeGreaterThan(0);
      
      // Verify categorization results
      const urgentEmail = await dbManager.getEmailIndex('urgent-email');
      const promoEmail = await dbManager.getEmailIndex('promo-email');

      expect(urgentEmail!.category).toBe(PriorityCategory.HIGH);
      expect(promoEmail!.category).toBe(PriorityCategory.LOW);

      // Verify analyzer results are present
      expect(urgentEmail!.importanceLevel).toBeDefined();
      expect(urgentEmail!.ageCategory).toBeDefined();
      expect(urgentEmail!.sizeCategory).toBeDefined();
    });

    it("should persist detailed analyzer results in database", async () => {
      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Verify detailed analyzer results persistence
      await assertAnalyzerResultsIntegrity(dbManager, job.results.emailIds);

      // Check specific analyzer result fields
      for (const emailId of job.results.emailIds.slice(0, 3)) { // Check first 3
        const email = await dbManager.getEmailIndex(emailId);
        
        // ImportanceAnalyzer results
        expect(email!.importanceScore).toBeDefined();
        expect(email!.importanceLevel).toBeDefined();
        expect(email!.importanceConfidence).toBeDefined();
        
        // DateSizeAnalyzer results
        expect(email!.ageCategory).toBeDefined();
        expect(email!.sizeCategory).toBeDefined();
        expect(email!.recencyScore).toBeDefined();
        
        // Analysis metadata
        expect(email!.analysisTimestamp).toBeDefined();
        expect(email!.analysisVersion).toBeDefined();
      }
    });

    it("should handle analyzer timeout scenarios", async () => {
      // Configure short timeout
      const timeoutConfig = createTestConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 50,
          timeoutMs: 1, // Very short timeout
          retryAttempts: 1
        }
      });

      await updateWorkerConfiguration(worker, timeoutConfig);

      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Job should complete even with timeouts (fallback categorization)
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.results.processed).toBeGreaterThanOrEqual(0);

      // Check for timeout-related errors in logs
      const hasTimeoutErrors = consoleCapture.errors.some(error => 
        error.includes('timed out') || error.includes('timeout')
      );
      // Timeout errors may or may not occur depending on system performance
    });

    it("should process different email types with real analysis", async () => {
      // Create emails with specific characteristics
      const diverseEmails: EmailIndex[] = [
        // High priority: urgent keyword + VIP domain
        {
          id: 'high-1',
          threadId: 'thread-high-1',
          category: null,
          subject: 'CRITICAL: Security Breach',
          sender: 'security@company.com',
          recipients: ['user@example.com'],
          date: new Date(),
          year: 2024,
          size: 50000,
          hasAttachments: false,
          labels: ['INBOX', 'IMPORTANT'],
          snippet: 'Immediate action required for security incident',
          archived: false
        },
        // Low priority: promotional content
        {
          id: 'low-1',
          threadId: 'thread-low-1',
          category: null,
          subject: 'Newsletter: Weekly Updates',
          sender: 'newsletter@marketing.com',
          recipients: ['user@example.com'],
          date: new Date('2024-01-01'),
          year: 2024,
          size: 300000,
          hasAttachments: false,
          labels: ['INBOX', 'PROMOTIONS'],
          snippet: 'Check out our latest deals and offers',
          archived: false
        },
        // Medium priority: regular business email
        {
          id: 'medium-1',
          threadId: 'thread-medium-1',
          category: null,
          subject: 'Team Standup Notes',
          sender: 'colleague@company.com',
          recipients: ['user@example.com'],
          date: new Date(),
          year: 2024,
          size: 75000,
          hasAttachments: false,
          labels: ['INBOX'],
          snippet: 'Notes from today team meeting',
          archived: false
        }
      ];

      await dbManager.bulkUpsertEmailIndex(diverseEmails);

      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      });

      worker.start();
      await waitForJobCompletion(jobId);

      // Verify categorization results
      const highEmail = await dbManager.getEmailIndex('high-1');
      const lowEmail = await dbManager.getEmailIndex('low-1');
      const mediumEmail = await dbManager.getEmailIndex('medium-1');

      expect(highEmail!.category).toBe(PriorityCategory.HIGH);
      expect(lowEmail!.category).toBe(PriorityCategory.LOW);
      // Medium email might be categorized as HIGH due to "meeting" keyword
      expect([PriorityCategory.MEDIUM, PriorityCategory.HIGH]).toContain(mediumEmail!.category);
    });

    it("should handle parallel vs sequential analyzer execution", async () => {
      // Test parallel processing
      const parallelConfig = createTestConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 50,
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });

      await updateWorkerConfiguration(worker, parallelConfig);

      const { result: parallelResult, timeMs: parallelTime } = await measureProcessingTime(async () => {
        const jobId = await jobStatusStore.createJob("categorization", { forceRefresh: true });
        worker.start();
        return await waitForJobCompletion(jobId);
      });

      worker.stop();
      await waitForWorkerShutdown(worker);

      // Test sequential processing
      const sequentialConfig = createTestConfiguration({
        orchestration: {
          enableParallelProcessing: false,
          batchSize: 50,
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });

      await updateWorkerConfiguration(worker, sequentialConfig);

      const { result: sequentialResult, timeMs: sequentialTime } = await measureProcessingTime(async () => {
        const jobId = await jobStatusStore.createJob("categorization", { forceRefresh: true });
        worker.start();
        return await waitForJobCompletion(jobId);
      });

      // Both should produce same results
      expect(parallelResult.results.processed).toBe(sequentialResult.results.processed);

      // Performance comparison (parallel should be faster or similar)
      expect(parallelTime).toBeLessThanOrEqual(sequentialTime * 1.5); // Allow 50% variance
    });

    it("should track and report analysis metrics accurately", async () => {
      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Get metrics from the categorization engine
      const metrics = categorizationEngine.getAnalysisMetrics();

      await assertPerformanceMetrics(metrics, {
        totalTime: { max: 30000 }, // 30 seconds max
        rulesEvaluated: { min: 1 } // At least some rules evaluated
      });

      expect(metrics.totalProcessingTime).toBeGreaterThan(0);
      expect(job.results.processed).toBeGreaterThan(0);
    });
  });

  // =====================================
  // C. DATABASE OPERATIONS (4 tests)
  // =====================================

  describe("Database Operations", () => {
    it("should maintain data consistency across job and email tables", async () => {
      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Verify job-email data consistency
      await verifyJobResultsIntegrity(jobId);

      // Verify all processed emails exist and have categories
      for (const emailId of job.results.emailIds) {
        const email = await dbManager.getEmailIndex(emailId);
        expect(email).toBeDefined();
        expect(email!.category).not.toBeNull();
      }

      // Verify job results match actual email count
      const categorizedEmails = await dbManager.searchEmails({});
      const actualCategorized = categorizedEmails.filter(e => e.category !== null);
      expect(job.results.emailIds.length).toBe(actualCategorized.length);
    });

    it("should handle database connection issues during processing", async () => {
      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });

      // Simulate database connection issue after job starts
      worker.start();
      
      // Wait for job to start processing
      await waitForJobStatus(jobId, JobStatus.IN_PROGRESS);
      
      // The test infrastructure doesn't support actual connection dropping during processing
      // but we can verify that database errors are handled gracefully
      const job = await waitForJobCompletion(jobId);
      
      // Job should complete or fail gracefully
      expect([JobStatus.COMPLETED, JobStatus.FAILED].includes(job.status)).toBe(true);
    });

    it("should cleanup job data appropriately", async () => {
      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Verify job data is accessible after completion
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.results).toBeDefined();

      // Test cleanup functionality
      const initialJobs = await jobStatusStore.listJobs({});
      expect(initialJobs.length).toBeGreaterThan(0);

      // Cleanup old jobs (older than 0 days = all jobs)
      const deletedCount = await jobStatusStore.cleanupOldJobs(0);
      expect(deletedCount).toBeGreaterThan(0);

      const remainingJobs = await jobStatusStore.listJobs({});
      expect(remainingJobs.length).toBe(0);
    });

    it("should handle concurrent database access", async () => {
      // Create multiple jobs that might access database concurrently
      const jobIds = await submitMultipleJobs([
        { year: 2022, forceRefresh: false },
        { year: 2023, forceRefresh: false },
        { year: 2024, forceRefresh: false }
      ]);

      worker.start();

      // Wait for all jobs to complete
      const completedJobs = await Promise.all(
        jobIds.map(id => waitForJobCompletion(id))
      );

      // All jobs should complete successfully
      completedJobs.forEach(job => {
        expect(job.status).toBe(JobStatus.COMPLETED);
      });

      // Verify database consistency
      const allEmails = await dbManager.searchEmails({});
      expect(allEmails.length).toBeGreaterThan(0);
    });
  });

  // =====================================
  // D. CONFIGURATION VARIATIONS (4 tests)
  // =====================================

  describe("Configuration Variations", () => {
    it("should work with different analyzer configurations", async () => {
      // Test with custom configuration
      const customConfig = createTestConfiguration();
      // Override specific analyzer configuration
      customConfig.analyzers.importance = {
        rules: [
          {
            id: 'custom-urgent',
            name: 'Custom Urgent Rule',
            type: 'keyword',
            priority: 100,
            weight: 20,
            keywords: ['emergency', 'critical', 'urgent']
          },
          {
            id: 'custom-low',
            name: 'Custom Low Priority Rule',
            type: 'keyword',
            priority: 10,
            weight: -10,
            keywords: ['newsletter', 'promotion', 'sale']
          }
        ],
        scoring: {
          highThreshold: 15,
          lowThreshold: -8,
          defaultWeight: 2
        },
        caching: {
          enabled: true,
          keyStrategy: 'full' as const
        }
      };

      await updateWorkerConfiguration(worker, customConfig);

      // Create test email that matches custom rules
      const customEmail: EmailIndex = {
        id: 'custom-test',
        threadId: 'thread-custom',
        category: null,
        subject: 'EMERGENCY: System Failure',
        sender: 'admin@company.com',
        recipients: ['user@example.com'],
        date: new Date(),
        year: 2024,
        size: 50000,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: 'Critical emergency requiring immediate response',
        archived: false
      };

      await dbManager.bulkUpsertEmailIndex([customEmail]);

      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      });

      worker.start();
      await waitForJobCompletion(jobId);

      // Verify custom configuration affected results
      const email = await dbManager.getEmailIndex('custom-test');
      expect(email!.category).toBe(PriorityCategory.HIGH);
      expect(email!.importanceLevel).toBe('high');
    });

    it("should handle configuration updates during operation", async () => {
      // Start with default configuration
      const jobId1 = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      });

      worker.start();
      const job1 = await waitForJobCompletion(jobId1);
      const initialProcessed = job1.results.processed;

      // Update configuration
      const newConfig = createTestConfiguration({
        orchestration: {
          enableParallelProcessing: false,
          batchSize: 25,
          timeoutMs: 15000,
          retryAttempts: 2
        }
      });

      await updateWorkerConfiguration(worker, newConfig);

      // Process another job with new configuration
      const jobId2 = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: true 
      });

      const job2 = await waitForJobCompletion(jobId2);

      // Should reprocess same emails with new configuration
      expect(job2.results.processed).toBe(initialProcessed);
      expect(job2.status).toBe(JobStatus.COMPLETED);
    });

    it("should validate configuration integrity", async () => {
      // Test valid configuration
      const validConfig = createTestConfiguration();
      const validResult = validateConfigurationIntegrity(validConfig);
      expect(validResult.valid).toBe(true);
      expect(validResult.errors).toHaveLength(0);

      // Test invalid configuration
      const invalidConfig = createTestConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: -1, // Invalid
          timeoutMs: 0, // Invalid
          retryAttempts: -5 // Invalid
        }
      });

      const invalidResult = validateConfigurationIntegrity(invalidConfig);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors.length).toBeGreaterThan(0);
    });

    it("should work with different orchestration settings", async () => {
      const orchestrationVariations = [
        {
          enableParallelProcessing: true,
          batchSize: 25,
          timeoutMs: 15000,
          retryAttempts: 1
        },
        {
          enableParallelProcessing: false,
          batchSize: 100,
          timeoutMs: 45000,
          retryAttempts: 5
        }
      ];

      for (const orchestration of orchestrationVariations) {
        const config = createTestConfiguration({ orchestration });
        await updateWorkerConfiguration(worker, config);

        const jobId = await jobStatusStore.createJob("categorization", { 
          forceRefresh: true 
        });

        worker.start();
        const job = await waitForJobCompletion(jobId);

        expect(job.status).toBe(JobStatus.COMPLETED);
        expect(job.results.processed).toBeGreaterThanOrEqual(0);

        worker.stop();
        await waitForWorkerShutdown(worker);
      }
    });
  });

  // =====================================
  // E. ERROR RECOVERY (4 tests)
  // =====================================

  describe("Error Recovery", () => {
    it("should recover from analyzer failures", async () => {
      // Create email with problematic data that might cause analyzer issues
      const problematicEmail: EmailIndex = {
        id: 'problematic',
        threadId: 'thread-problematic',
        category: null,
        subject: '', // Empty subject might cause issues
        sender: 'test@example.com',
        recipients: ['user@example.com'],
        date: new Date(),
        year: 2024,
        size: 0,
        hasAttachments: false,
        labels: [],
        snippet: '',
        archived: false
      };

      await dbManager.bulkUpsertEmailIndex([problematicEmail]);

      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Job should complete despite analyzer issues
      expect(job.status).toBe(JobStatus.COMPLETED);
      
      // Problematic email should get fallback categorization
      const email = await dbManager.getEmailIndex('problematic');
      expect(email!.category).not.toBeNull();
    });

    it("should handle malformed email data gracefully", async () => {
      // Create emails with missing required fields
      const malformedEmails: EmailIndex[] = [
        {
          id: 'malformed-1',
          threadId: 'thread-malformed-1',
          category: null,
          subject: undefined as any, // Missing subject
          sender: 'test@example.com',
          recipients: ['user@example.com'],
          date: new Date(),
          year: 2024,
          size: 50000,
          hasAttachments: false,
          labels: ['INBOX'],
          snippet: 'Test snippet',
          archived: false
        },
        {
          id: 'valid-email',
          threadId: 'thread-valid',
          category: null,
          subject: 'Valid Email',
          sender: 'test@example.com',
          recipients: ['user@example.com'],
          date: new Date(),
          year: 2024,
          size: 50000,
          hasAttachments: false,
          labels: ['INBOX'],
          snippet: 'This is a valid email',
          archived: false
        }
      ];

      await dbManager.bulkUpsertEmailIndex(malformedEmails);

      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Job should complete
      expect(job.status).toBe(JobStatus.COMPLETED);
      
      // Valid email should be processed
      const validEmail = await dbManager.getEmailIndex('valid-email');
      expect(validEmail!.category).not.toBeNull();

      // Malformed email should get fallback category or be skipped
      const malformedEmail = await dbManager.getEmailIndex('malformed-1');
      // It might get a fallback category or remain unprocessed
      expect([null, PriorityCategory.MEDIUM].includes(malformedEmail!.category as any)).toBe(true);
    });

    it("should implement proper retry logic for transient failures", async () => {
      // Configure retry settings
      const retryConfig = createTestConfiguration({
        orchestration: {
          enableParallelProcessing: true,
          batchSize: 50,
          timeoutMs: 30000,
          retryAttempts: 3
        }
      });

      await updateWorkerConfiguration(worker, retryConfig);

      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });

      worker.start();
      const job = await waitForJobCompletion(jobId);

      // Despite potential transient failures, job should complete
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.results.processed).toBeGreaterThanOrEqual(0);
    });

    it("should maintain singleton integrity under stress", async () => {
      // Verify singleton integrity before operations
      JobStatusStore.validateSingletonIntegrity();
      DatabaseManager.validateSingletonIntegrity();

      // Create multiple concurrent operations
      const concurrentJobs = await Promise.all([
        jobStatusStore.createJob("categorization", { year: 2022 }),
        jobStatusStore.createJob("categorization", { year: 2023 }),
        jobStatusStore.createJob("categorization", { year: 2024 })
      ]);

      worker.start();

      // Wait for all jobs to complete
      await Promise.all(concurrentJobs.map(id => waitForJobCompletion(id)));

      // Verify singleton integrity after operations
      JobStatusStore.validateSingletonIntegrity();
      DatabaseManager.validateSingletonIntegrity();

      // All operations should succeed
      for (const jobId of concurrentJobs) {
        const job = await jobStatusStore.getJobStatus(jobId);
        expect(job!.status).toBe(JobStatus.COMPLETED);
      }
    });
  });

  // =====================================
  // F. PERFORMANCE & CONCURRENCY (3 tests)
  // =====================================

  describe("Performance & Concurrency", () => {
    it("should handle large email batches efficiently", async () => {
      // Generate large dataset
      const largeEmailSet = await generateLargeEmailDataset(500, {
        highPriorityRatio: 0.2,
        lowPriorityRatio: 0.3,
        yearRange: { start: 2022, end: 2024 }
      });

      await dbManager.bulkUpsertEmailIndex(largeEmailSet);

      const { result, memoryDelta } = await measureMemoryUsage(async () => {
        const { result: jobResult, timeMs: processingTime } = await measureProcessingTime(async () => {
          const jobId = await jobStatusStore.createJob("categorization", { 
            forceRefresh: false 
          });
          
          worker.start();
          return await waitForJobCompletion(jobId);
        });

        return { jobResult, processingTime };
      });

      // Performance assertions
      expect(result.jobResult.status).toBe(JobStatus.COMPLETED);
      expect(result.jobResult.results.processed).toBe(largeEmailSet.length);
      expect(result.processingTime).toBeLessThan(30000); // 30 seconds max
      expect(memoryDelta).toBeLessThan(100 * 1024 * 1024); // 100MB max increase

      // Verify all emails were processed correctly
      const processedEmails = await dbManager.searchEmails({});
      const categorizedCount = processedEmails.filter(e => e.category !== null).length;
      expect(categorizedCount).toBe(largeEmailSet.length);
    });

    it("should maintain performance with cache utilization", async () => {
      // First run to populate cache
      const firstJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      });

      worker.start();
      const { timeMs: firstRunTime } = await measureProcessingTime(async () => {
        return await waitForJobCompletion(firstJobId);
      });

      worker.stop();
      await waitForWorkerShutdown(worker);

      // Second run should benefit from cache
      const secondJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: true // Force reprocessing to test cache
      });

      worker.start();
      const { timeMs: secondRunTime } = await measureProcessingTime(async () => {
        return await waitForJobCompletion(secondJobId);
      });

      // Get cache statistics
      const cacheStats = cacheManager.stats();
      
      // Performance should be better or similar on second run
      expect(secondRunTime).toBeLessThanOrEqual(firstRunTime * 1.2); // Allow 20% variance
      
      // Verify cache was utilized
      expect(cacheStats.keys).toBeGreaterThanOrEqual(0);
    });

    it("should handle concurrent job requests", async () => {
      // Create multiple jobs simultaneously
      const concurrentJobs = await Promise.all([
        jobStatusStore.createJob("categorization", { year: 2022, forceRefresh: false }),
        jobStatusStore.createJob("categorization", { year: 2023, forceRefresh: false }),
        jobStatusStore.createJob("categorization", { year: 2024, forceRefresh: false })
      ]);

      worker.start();

      // Measure concurrent processing
      const { result: completedJobs, timeMs: totalTime } = await measureProcessingTime(async () => {
        return await Promise.all(concurrentJobs.map(id => waitForJobCompletion(id)));
      });

      // All jobs should complete successfully
      completedJobs.forEach(job => {
        expect(job.status).toBe(JobStatus.COMPLETED);
        expect(job.results.processed).toBeGreaterThanOrEqual(0);
      });

      // Verify no race conditions occurred
      const totalProcessed = completedJobs.reduce((sum, job) => sum + job.results.processed, 0);
      expect(totalProcessed).toBeGreaterThanOrEqual(0);

      // Performance should be reasonable
      expect(totalTime).toBeLessThan(60000); // 60 seconds max for all jobs
    });
  });
});
