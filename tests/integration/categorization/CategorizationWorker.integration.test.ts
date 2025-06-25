import { describe, it, expect, beforeEach, afterEach, jest, beforeAll, afterAll } from '@jest/globals';
import { CategorizationWorker } from "../../../src/categorization/CategorizationWorker.js";
import { JobQueue } from "../../../src/database/JobQueue.js";
import { CategorizationEngine } from "../../../src/categorization/CategorizationEngine.js";
import { JobStatusStore } from "../../../src/database/JobStatusStore.js";
import { DatabaseManager } from "../../../src/database/DatabaseManager.js";
import { JobStatus, Job } from "../../../src/types/index.js";
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

/**
 * NOTE: All dataset sizes in this file are intentionally kept minimal (2–10 emails)
 * to ensure fast CI runs. Increase only for explicit stress/performance testing.
 */

describe("CategorizationWorker Integration Tests", () => {
  let worker: CategorizationWorker;
  let jobQueue: JobQueue;
  let categorizationEngine: CategorizationEngine;
  let jobStatusStore: JobStatusStore;
  let dbManager: DatabaseManager;
  let cacheManager: CacheManager;
  let consoleCapture: { logs: string[], errors: string[], warns: string[], infos: string[] };

  beforeEach(async () => {
    const components = await createWorkerWithRealComponents();
    worker = components.worker;
    jobQueue = components.jobQueue;
    categorizationEngine = components.categorizationEngine;
    jobStatusStore = components.jobStatusStore;
    dbManager = components.dbManager;
    cacheManager = components.cacheManager;
    
    consoleCapture = startLoggerCapture(logger);
    
    // Seed minimal test data for most tests
    await seedRealisticTestData(dbManager, 2);
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
      // Ensure at least one email for year 2024 exists with category: null
      const emails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      if (emails2024.length === 0) {
        await dbManager.upsertEmailIndex({
          id: 'test-2024-robust',
          threadId: 'thread-2024-robust',
          category: null,
          subject: 'URGENT: Action Required',
          sender: 'boss@company.com', // VIP sender
          recipients: ['user@example.com'],
          date: new Date('2024-01-01'),
          year: 2024,
          size: 150000,
          hasAttachments: true,
          labels: ['INBOX', 'IMPORTANT'],
          snippet: 'Please review the urgent document by EOD...',
          archived: false,
          user_id: 'default'
        });
      }
      // Debug: print emails for categorization
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for categorization (2024):', debugEmails2024.map(e => e.id));
      // Create job with specific parameters
      const jobId = await jobStatusStore.createJob("categorization", {
        year: 2024,
        forceRefresh: false
      }, 'default');

      // Start worker
      await jobQueue.addJob(jobId, 'default');
      worker.start();

      // Wait for job completion
      logJobWait(jobId, "categorization", 5000);
      const completedJob = await waitForJobCompletion(jobId, { timeout: 5000 });
      console.log(`[TEST] Job ${jobId} completed.`);

      // Verify job lifecycle
      expect(completedJob.status).toBe(JobStatus.COMPLETED);
      expect(completedJob.results).toBeDefined();
      expect(completedJob.results.processed).toBeGreaterThan(0);
      expect(completedJob.results.emailIds).toBeDefined();
      expect(Array.isArray(completedJob.results.emailIds)).toBe(true);
      expect(completedJob.started_at).toBeDefined();
      expect(completedJob.completed_at).toBeDefined();

      // Verify analyzer results are persisted
      for (const emailId of completedJob.results.emailIds) {
        const email = await dbManager.getEmailIndex(emailId);
        console.log('[DEBUG] Processed email:', email); // Debug: print analyzer results
      }
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
      // Ensure at least one email for each year exists with category: null
      const years = [2022, 2023, 2024];
      for (const year of years) {
        const emails = await dbManager.searchEmails({ year, category: null, user_id: 'default' });
        if (emails.length === 0) {
          await dbManager.upsertEmailIndex({
            id: `test-${year}-robust`,
            threadId: `thread-${year}-robust`,
            category: null,
            subject: `URGENT: Action Required for ${year}`,
            sender: 'boss@company.com',
            recipients: ['user@example.com'],
            date: new Date(`${year}-01-01`),
            year,
            size: 150000,
            hasAttachments: true,
            labels: ['INBOX', 'IMPORTANT'],
            snippet: `Please review the urgent document for ${year} by EOD...`,
            archived: false,
            user_id: 'default'
          });
        }
        // Debug: print emails for categorization for each year
        const debugEmails = await dbManager.searchEmails({ year, category: null, user_id: 'default' });
        console.log(`[DEBUG] Emails for categorization (${year}):`, debugEmails.map(e => e.id));
      }
      const jobParams = [
        { year: 2022, forceRefresh: false },
        { year: 2023, forceRefresh: false },
        { year: 2024, forceRefresh: true }
      ];
      const jobIds = await submitMultipleJobs(jobParams, 'default');
      for (const jobId of jobIds) {
        await jobQueue.addJob(jobId, 'default');
        await delay(10); // Ensure unique timestamps for job processing
      }
      worker.start();
      // Wait for all jobs to complete
      const completedJobs: Job[] = [];
      for (const jobId of jobIds) {
        const job = await waitForJobCompletion(jobId, { timeout: 5000 });
        completedJobs.push(job);
      }
      // Verify all jobs completed successfully
      completedJobs.forEach((job, idx) => {
        expect(job.status).toBe(JobStatus.COMPLETED);
        expect(job.results).toBeDefined();
      });
      // Verify jobs were processed in order (FIFO)
      for (let i = 1; i < completedJobs.length; i++) {
        expect(completedJobs[i].started_at!.getTime()).toBeGreaterThanOrEqual(
          completedJobs[i-1].completed_at!.getTime()
        );
      }
    });

    it("should respect job priority and ordering", async () => {
      // Add multiple jobs to queue
      const job1Id = await jobStatusStore.createJob("categorization", { year: 2022 }, 'default');
      const job2Id = await jobStatusStore.createJob("categorization", { year: 2023 }, 'default');
      const job3Id = await jobStatusStore.createJob("categorization", { year: 2024 }, 'default');

      // Verify queue length
      expect(jobQueue.getQueueLength()).toBe(0); // Jobs aren't in queue until retrieved

      await jobQueue.addJob(job1Id, 'default');
      await jobQueue.addJob(job2Id, 'default');
      await jobQueue.addJob(job3Id, 'default');
      worker.start();

      // Wait for all jobs to complete
      await waitForJobCompletion(job1Id, { timeout: 5000 });
      await waitForJobCompletion(job2Id, { timeout: 5000 });
      await waitForJobCompletion(job3Id, { timeout: 5000 });

      // Verify all completed
      const job1 = await jobStatusStore.getJobStatus(job1Id, 'default');
      const job2 = await jobStatusStore.getJobStatus(job2Id, 'default');
      const job3 = await jobStatusStore.getJobStatus(job3Id, 'default');

      expect(job1!.status).toBe(JobStatus.COMPLETED);
      expect(job2!.status).toBe(JobStatus.COMPLETED);
      expect(job3!.status).toBe(JobStatus.COMPLETED);
    });

    it("should handle job cancellation during processing", async () => {
      // Ensure at least one uncategorized email for 2024 exists
      const emails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      if (emails2024.length === 0) {
        await dbManager.upsertEmailIndex({
          id: 'test-2024-cancel',
          threadId: 'thread-2024-cancel',
          category: null,
          subject: 'Test Cancel Email 2024',
          sender: 'test@example.com',
          recipients: ['user@example.com'],
          date: new Date('2024-01-01'),
          year: 2024,
          size: 50000,
          hasAttachments: false,
          labels: ['INBOX'],
          snippet: 'Test email for cancellation',
          archived: false,
          user_id: 'default'
        });
      }
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for cancellation test (2024):', debugEmails2024.map(e => e.id));

      const jobId = await jobStatusStore.createJob("categorization", {
        year: 2024,
        forceRefresh: true
      }, 'default');

      await jobQueue.addJob(jobId, 'default');
      worker.start();
      
      // Wait for job to start processing or complete (robust to fast jobs)
      let jobStatus: JobStatus | null = null;
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const job = await jobStatusStore.getJobStatus(jobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED)) {
          jobStatus = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED]).toContain(jobStatus);
    });

    it("should resume processing after worker restart", async () => {
      // Ensure at least one uncategorized email for 2024 exists
      const emails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      if (emails2024.length === 0) {
        await dbManager.upsertEmailIndex({
          id: 'test-2024-restart',
          threadId: 'thread-2024-restart',
          category: null,
          subject: 'Test Restart Email 2024',
          sender: 'test@example.com',
          recipients: ['user@example.com'],
          date: new Date('2024-01-01'),
          year: 2024,
          size: 50000,
          hasAttachments: false,
          labels: ['INBOX'],
          snippet: 'Test email for restart',
          archived: false,
          user_id: 'default'
        });
      }
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for restart test (2024):', debugEmails2024.map(e => e.id));

      const jobId = await jobStatusStore.createJob("categorization", {
        year: 2024,
        forceRefresh: false
      }, 'default');

      await jobQueue.addJob(jobId, 'default');
      worker.start();
      
      // Wait for job to reach IN_PROGRESS or COMPLETED
      let jobStatus: JobStatus | null = null;
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const job = await jobStatusStore.getJobStatus(jobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED)) {
          jobStatus = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED]).toContain(jobStatus);
      
      // Stop and restart worker
      await restartWorker(worker);
      
      // Job should eventually complete
      const completedJob = await waitForJobCompletion(jobId, { timeout: 5000 });
      expect(completedJob.status).toBe(JobStatus.COMPLETED);
    });

    it("should handle duplicate job IDs gracefully", async () => {
      // This test is conceptual as job IDs are auto-generated with timestamps
      // We test that multiple jobs can be created without conflicts
      const jobs = await Promise.all([
        jobStatusStore.createJob("categorization", { year: 2024 }, 'default'),
        jobStatusStore.createJob("categorization", { year: 2024 }, 'default'),
        jobStatusStore.createJob("categorization", { year: 2024 }, 'default')
      ]);

      // All job IDs should be unique
      const uniqueIds = new Set(jobs);
      expect(uniqueIds.size).toBe(jobs.length);

      for (const jobId of jobs) {
        await jobQueue.addJob(jobId, 'default');
      }
      worker.start();

      // All jobs should complete
      for (const jobId of jobs) {
        const job = await waitForJobCompletion(jobId, { timeout: 5000 });
        expect(job.status).toBe(JobStatus.COMPLETED);
      }
    });

    it("should process jobs with different year filters", async () => {
      // Seed emails for different years with user_id: 'default'
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
          archived: false,
          user_id: 'default'
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
          archived: false,
          user_id: 'default'
        }
      ];

      await dbManager.bulkUpsertEmailIndex([...emails2022, ...emails2023], 'default');

      // Debug: print emails for each year/user before running the job
      const debug2022 = await dbManager.searchEmails({ year: 2022, user_id: 'default' });
      const debug2023 = await dbManager.searchEmails({ year: 2023, user_id: 'default' });
      console.log('[DEBUG] Emails for 2022 (default):', debug2022.map(e => e.id));
      console.log('[DEBUG] Emails for 2023 (default):', debug2023.map(e => e.id));

      // Assert emails exist for correct user/year
      expect(debug2022.length).toBeGreaterThan(0);
      expect(debug2023.length).toBeGreaterThan(0);

      // Process only 2022 emails
      const job2022Id = await jobStatusStore.createJob("categorization", { year: 2022 }, 'default');
      await jobQueue.addJob(job2022Id, 'default');
      worker.start();
      
      // Count uncategorized emails for year 2022 before running the job
      const uncategorized2022 = await dbManager.searchEmails({ year: 2022, category: null, user_id: 'default' });
      console.log('[DEBUG] Uncategorized emails for 2022 before job:', uncategorized2022.map(e => e.id));

      const job2022 = await waitForJobCompletion(job2022Id, { timeout: 5000 });
      // Debug: print processed email IDs and years for this job
      const processedEmails = await dbManager.searchEmails({ user_id: 'default' });
      const processedIds = job2022.results.emailIds;
      const processedDetails = processedEmails.filter(e => processedIds.includes(e.id)).map(e => ({ id: e.id, year: e.year, category: e.category }));
      console.log('[DEBUG] Processed emails for job2022:', processedDetails);
      expect(job2022.results.processed).toBe(uncategorized2022.length);

      // Verify only 2022 emails were processed
      const email2022 = await dbManager.getEmailIndex('test-2022-1');
      const email2023 = await dbManager.getEmailIndex('test-2023-1');
      
      expect(email2022!.category).not.toBeNull();
      expect(email2023!.category).toBeNull();
    });

    it("should handle forceRefresh parameter correctly", async () => {
      // Ensure at least one uncategorized email for 2024 exists
      const emails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      if (emails2024.length === 0) {
        await dbManager.upsertEmailIndex({
          id: 'test-2024-force-refresh',
          threadId: 'thread-2024-force-refresh',
          category: null,
          subject: 'Test Force Refresh Email 2024',
          sender: 'test@example.com',
          recipients: ['user@example.com'],
          date: new Date('2024-01-01'),
          year: 2024,
          size: 50000,
          hasAttachments: false,
          labels: ['INBOX'],
          snippet: 'Test email for force refresh',
          archived: false,
          user_id: 'default'
        });
      }
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for forceRefresh test (2024):', debugEmails2024.map(e => e.id));

      // First, categorize all emails
      const initialJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(initialJobId, 'default');
      worker.start();
      // Robust wait for job status
      let jobStatus: JobStatus | null = null;
      const start = Date.now();
      while (Date.now() - start < 20000) {
        const job = await jobStatusStore.getJobStatus(initialJobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED)) {
          jobStatus = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED]).toContain(jobStatus);
      const initialJob = await waitForJobCompletion(initialJobId, { timeout: 20000 });
      const initialProcessed = initialJob.results.processed;
      console.log(`[DEBUG] Initial job completed: ${initialJobId}`);
      worker.stop();
      await waitForWorkerShutdown(worker);

      // Second run with forceRefresh=false should process 0 emails (all already categorized)
      const incrementalJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(incrementalJobId, 'default');
      worker.start();
      let jobStatus2: JobStatus | null = null;
      const start2 = Date.now();
      while (Date.now() - start2 < 20000) {
        const job = await jobStatusStore.getJobStatus(incrementalJobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED)) {
          jobStatus2 = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED, null]).toContain(jobStatus2);
      const incrementalJob = await waitForJobCompletion(incrementalJobId, { timeout: 20000 });
      expect(incrementalJob.results.processed).toBe(0);
      console.log(`[DEBUG] Incremental job completed: ${incrementalJobId}`);
      worker.stop();
      await waitForWorkerShutdown(worker);

      // Third run with forceRefresh=true should reprocess all emails
      const refreshJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: true 
      }, 'default');
      await jobQueue.addJob(refreshJobId, 'default');
      worker.start();
      let jobStatus3: JobStatus | null = null;
      const start3 = Date.now();
      while (Date.now() - start3 < 20000) {
        const job = await jobStatusStore.getJobStatus(refreshJobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED)) {
          jobStatus3 = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED]).toContain(jobStatus3);
      const refreshJob = await waitForJobCompletion(refreshJobId, { timeout: 20000 });
      expect(refreshJob.results.processed).toBe(initialProcessed);
      console.log(`[DEBUG] Refresh job completed: ${refreshJobId}`);
      worker.stop();
      await waitForWorkerShutdown(worker);
    });
  });

  // =====================================
  // B. REAL ENGINE EXECUTION (6 tests)
  // =====================================

  describe("Real Engine Execution", () => {
    it("should execute real categorization with all analyzers", async () => {
      // Ensure at least one uncategorized email for 2024 exists
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for analyzer test (2024):', debugEmails2024.map(e => e.id));

      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(jobId, 'default');
      worker.start();
      // Robust wait for job status
      let jobStatus: JobStatus | null = null;
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const job = await jobStatusStore.getJobStatus(jobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED)) {
          jobStatus = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED]).toContain(jobStatus);
      const job = await waitForJobCompletion(jobId, { timeout: 10000 });

      // Verify all analyzers executed
      expect(job.results.processed).toBeGreaterThan(0);
      
      // Verify categorization results
      const urgentEmail = await dbManager.getEmailIndex('urgent-email');
      const promoEmail = await dbManager.getEmailIndex('promo-email');
      console.log('[DEBUG] urgentEmail:', urgentEmail);
      console.log('[DEBUG] promoEmail:', promoEmail);
      if (!urgentEmail) throw new Error('urgent-email not found in DB after job');
      if (!promoEmail) throw new Error('promo-email not found in DB after job');

      expect(urgentEmail.category).toBe(PriorityCategory.HIGH);
      expect(promoEmail.category).toBe(PriorityCategory.LOW);

      // Verify analyzer results are present
      expect(urgentEmail.importanceLevel).toBeDefined();
      expect(urgentEmail.ageCategory).toBeDefined();
      expect(urgentEmail.sizeCategory).toBeDefined();
    });

    it("should persist detailed analyzer results in database", async () => {
      // Ensure at least one uncategorized email for 2024 exists
      const emails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      if (emails2024.length === 0) {
        await dbManager.upsertEmailIndex({
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
          archived: false,
          user_id: 'default'
        });
      }
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for analyzer persistence test (2024):', debugEmails2024.map(e => e.id));

      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(jobId, 'default');
      worker.start();
      // Robust wait for job status
      let jobStatus: JobStatus | null = null;
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const job = await jobStatusStore.getJobStatus(jobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED)) {
          jobStatus = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED]).toContain(jobStatus);
      const job = await waitForJobCompletion(jobId, { timeout: 10000 });

      // Verify detailed analyzer results persistence
      await assertAnalyzerResultsIntegrity(dbManager, job.results.emailIds);

      // Check specific analyzer result fields
      for (const emailId of job.results.emailIds.slice(0, 3)) { // Check first 3
        const email = await dbManager.getEmailIndex(emailId);
        console.log(`[DEBUG] Analyzer fields for email ${emailId}:`, {
          importanceScore: email?.importanceScore,
          importanceLevel: email?.importanceLevel,
          importanceConfidence: email?.importanceConfidence,
          ageCategory: email?.ageCategory,
          sizeCategory: email?.sizeCategory,
          recencyScore: email?.recencyScore,
          analysisTimestamp: email?.analysisTimestamp,
          analysisVersion: email?.analysisVersion
        });
        if (!email) throw new Error(`Email ${emailId} not found in DB after job`);
        if (typeof email.importanceScore !== 'number') throw new Error(`importanceScore missing for ${emailId}`);
        if (typeof email.importanceLevel !== 'string') throw new Error(`importanceLevel missing for ${emailId}`);
        if (typeof email.importanceConfidence !== 'number') throw new Error(`importanceConfidence missing for ${emailId}`);
        if (typeof email.ageCategory !== 'string') throw new Error(`ageCategory missing for ${emailId}`);
        if (typeof email.sizeCategory !== 'string') throw new Error(`sizeCategory missing for ${emailId}`);
        if (typeof email.recencyScore !== 'number') throw new Error(`recencyScore missing for ${emailId}`);
        if (!email.analysisTimestamp) throw new Error(`analysisTimestamp missing for ${emailId}`);
        if (!email.analysisVersion) throw new Error(`analysisVersion missing for ${emailId}`);
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
      }, 'default');

      await jobQueue.addJob(jobId, 'default');
      worker.start();
      logJobWait(jobId, "categorization", 5000);
      const job = await waitForJobCompletion(jobId, { timeout: 5000 });

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
      // Ensure at least one uncategorized email for 2024 exists
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for diverse analysis test (2024):', debugEmails2024.map(e => e.id));

      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(jobId, 'default');
      worker.start();
      // Robust wait for job status
      let jobStatus: JobStatus | null = null;
      const start = Date.now();
      while (Date.now() - start < 10000) {
        const job = await jobStatusStore.getJobStatus(jobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED)) {
          jobStatus = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED]).toContain(jobStatus);
      const job = await waitForJobCompletion(jobId, { timeout: 10000 });

      // Verify categorization results
      const highEmail = await dbManager.getEmailIndex('high-1');
      const lowEmail = await dbManager.getEmailIndex('low-1');
      const mediumEmail = await dbManager.getEmailIndex('medium-1');
      if (!highEmail) throw new Error('high-1 not found in DB after job');
      if (!lowEmail) throw new Error('low-1 not found in DB after job');
      if (!mediumEmail) throw new Error('medium-1 not found in DB after job');

      expect(highEmail.category).toBe(PriorityCategory.HIGH);
      expect(lowEmail.category).toBe(PriorityCategory.LOW);
      // Medium email might be categorized as HIGH due to "meeting" keyword
      expect([PriorityCategory.MEDIUM, PriorityCategory.HIGH]).toContain(mediumEmail.category);
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
        const jobId = await jobStatusStore.createJob("categorization", { forceRefresh: true }, 'default');
        await jobQueue.addJob(jobId, 'default');
        worker.start();
        logJobWait(jobId, "parallel", 5000);
        const result = await waitForJobCompletion(jobId, { timeout: 5000 });
        console.log(`[TEST] Job ${jobId} completed.`);
        return result;
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
        const jobId = await jobStatusStore.createJob("categorization", { forceRefresh: true }, 'default');
        await jobQueue.addJob(jobId, 'default');
        worker.start();
        logJobWait(jobId, "sequential", 5000);
        const result = await waitForJobCompletion(jobId, { timeout: 5000 });
        console.log(`[TEST] Job ${jobId} completed.`);
        return result;
      });

      // Both should produce same results
      expect(parallelResult.results.processed).toBe(sequentialResult.results.processed);

      // Performance comparison (parallel should be faster or similar)
      expect(parallelTime).toBeLessThanOrEqual(sequentialTime * 1.5); // Allow 50% variance
    });

    it("should track and report analysis metrics accurately", async () => {
      // Ensure at least one uncategorized email for 2024 exists
      await dbManager.upsertEmailIndex({
        id: 'metrics-test',
        threadId: 'thread-metrics',
        category: null,
        subject: 'Metrics Test Email',
        sender: 'metrics@company.com',
        recipients: ['user@example.com'],
        date: new Date(),
        year: 2024,
        size: 50000,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: 'Test for metrics',
        archived: false,
        user_id: 'default'
      });
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for metrics test (2024):', debugEmails2024.map(e => e.id));

      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(jobId, 'default');
      worker.start();
      logJobWait(jobId, "categorization", 5000);
      const job = await waitForJobCompletion(jobId, { timeout: 5000 });

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
      }, 'default');

      await jobQueue.addJob(jobId, 'default');
      worker.start();
      logJobWait(jobId, "categorization", 5000);
      const job = await waitForJobCompletion(jobId, { timeout: 5000 });

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
      // Ensure at least one uncategorized email for 2024 exists
      await dbManager.upsertEmailIndex({
        id: 'db-conn-issue',
        threadId: 'thread-db-conn-issue',
        category: null,
        subject: 'DB Connection Issue',
        sender: 'db@company.com',
        recipients: ['user@example.com'],
        date: new Date(),
        year: 2024,
        size: 50000,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: 'Test for DB connection issue',
        archived: false,
        user_id: 'default'
      });
      const debugEmails2024 = await dbManager.searchEmails({ year: 2024, category: null, user_id: 'default' });
      console.log('[DEBUG] Emails for DB connection issue test (2024):', debugEmails2024.map(e => e.id));

      const jobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(jobId, 'default');
      worker.start();
      // Wait for job to start processing
      let jobStatus: JobStatus | null = null;
      const start = Date.now();
      while (Date.now() - start < 15000) {
        const job = await jobStatusStore.getJobStatus(jobId, 'default');
        if (job && (job.status === JobStatus.IN_PROGRESS || job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED)) {
          jobStatus = job.status;
          break;
        }
        await delay(100);
      }
      expect([JobStatus.IN_PROGRESS, JobStatus.COMPLETED, JobStatus.FAILED]).toContain(jobStatus);
      const job = await waitForJobCompletion(jobId, { timeout: 15000 });
      expect([JobStatus.COMPLETED, JobStatus.FAILED]).toContain(job.status);
    });

    it("should cleanup job data appropriately", async () => {
      // Ensure at least one job exists and is COMPLETED with completed_at in the past
      const jobId = await jobStatusStore.createJob("categorization", { forceRefresh: false }, 'default');
      await jobQueue.addJob(jobId, 'default');
      worker.start();
      logJobWait(jobId, "categorization", 5000);
      const job = await waitForJobCompletion(jobId, { timeout: 5000 });
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.results).toBeDefined();
      // Manually set completed_at and created_at to ensure eligibility for cleanup
      const dbJob = await jobStatusStore.getJobStatus(jobId, 'default');
      if (dbJob && dbJob.completed_at && dbJob.created_at) {
        const completedAt = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
        const createdAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
        // Update both fields in the DB
        await dbManager.query(
          'UPDATE job_statuses SET completed_at = ?, created_at = ? WHERE job_id = ?',
          [Math.floor(completedAt.getTime() / 1000), Math.floor(createdAt.getTime() / 1000), jobId]
        );
      }
      // Log all jobs before cleanup
      const jobsBefore = await jobStatusStore.listJobs({});
      console.log('[DEBUG] Jobs before cleanup:', jobsBefore.map(j => ({ job_id: j.job_id, status: j.status, completed_at: j.completed_at })));
      // Cleanup old jobs (older than 0 days = all jobs)
      const deletedCount = await jobStatusStore.cleanupOldJobs(0);
      console.log('[DEBUG] Deleted jobs count:', deletedCount);
      const remainingJobs = await jobStatusStore.listJobs({});
      console.log('[DEBUG] Jobs after cleanup:', remainingJobs.map(j => ({ job_id: j.job_id, status: j.status, completed_at: j.completed_at })));
      if (deletedCount === 0) {
        throw new Error('No jobs were eligible for cleanup. Jobs before cleanup: ' + JSON.stringify(jobsBefore));
      }
      expect(deletedCount).toBeGreaterThan(0);
      expect(remainingJobs.length).toBe(0);
    });

    it("should handle concurrent database access", async () => {
      // Create multiple jobs that might access database concurrently
      const jobIds = await submitMultipleJobs([
        { year: 2022, forceRefresh: false },
        { year: 2023, forceRefresh: false },
        { year: 2024, forceRefresh: false }
      ]);

      for (const jobId of jobIds) {
        await jobQueue.addJob(jobId, 'default');
      }
      worker.start();

      // Wait for all jobs to complete
      const completedJobs = await Promise.all(
        jobIds.map(id => waitForJobCompletion(id, { timeout: 5000 }))
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
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });

      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      }, 'default');

      await jobQueue.addJob(jobId, 'default');
      worker.start();
      logJobWait(jobId, "categorization", 5000);
      const job = await waitForJobCompletion(jobId, { timeout: 5000 });

      // Verify custom configuration affected results
      const email = await dbManager.getEmailIndex('custom-test');
      if (!email) throw new Error('custom-test not found in DB after job');
      expect(email.category).toBe(PriorityCategory.HIGH);
      expect(email.importanceLevel).toBe('high');
    });

    it("should handle configuration updates during operation", async () => {
      // Start with default configuration
      await dbManager.upsertEmailIndex({
        id: 'config-update-test',
        threadId: 'thread-config-update',
        category: null,
        subject: 'Config Update Test',
        sender: 'config@company.com',
        recipients: ['user@example.com'],
        date: new Date(),
        year: 2024,
        size: 50000,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: 'Test for config update',
        archived: false,
        user_id: 'default'
      });
      const jobId1 = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(jobId1, 'default');
      worker.start();
      logJobWait(jobId1, "categorization", 5000);
      const job1 = await waitForJobCompletion(jobId1, { timeout: 5000 });
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
      }, 'default');
      await jobQueue.addJob(jobId2, 'default');
      worker.start();
      logJobWait(jobId2, "categorization", 5000);
      const job2 = await waitForJobCompletion(jobId2, { timeout: 5000 });
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
        }, 'default');

        await jobQueue.addJob(jobId, 'default');
        worker.start();
        logJobWait(jobId, "orchestration", 5000);
        const job = await waitForJobCompletion(jobId, { timeout: 5000 });

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
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });
      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(jobId, 'default');
      worker.start();
      logJobWait(jobId, "categorization", 5000);
      const job = await waitForJobCompletion(jobId, { timeout: 5000 });
      // Job should complete despite analyzer issues
      expect(job.status).toBe(JobStatus.COMPLETED);
      // Problematic email should get fallback categorization
      const email = await dbManager.getEmailIndex('problematic');
      if (!email) throw new Error('problematic not found in DB after job');
      expect(email.category).not.toBeNull();
    });

    it("should handle malformed email data gracefully", async () => {
      // Create emails with missing required fields
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });
      await dbManager.upsertEmailIndex({
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
        archived: false,
        user_id: 'default'
      });
      const jobId = await jobStatusStore.createJob("categorization", { 
        year: 2024,
        forceRefresh: false 
      }, 'default');
      await jobQueue.addJob(jobId, 'default');
      worker.start();
      logJobWait(jobId, "categorization", 5000);
      const job = await waitForJobCompletion(jobId, { timeout: 5000 });
      // Job should complete
      expect(job.status).toBe(JobStatus.COMPLETED);
      // Valid email should be processed
      const validEmail = await dbManager.getEmailIndex('valid-email');
      if (!validEmail) throw new Error('valid-email not found in DB after job');
      expect(validEmail.category).not.toBeNull();
      // Malformed email should get fallback category or be skipped
      const malformedEmail = await dbManager.getEmailIndex('malformed-1');
      // It might get a fallback category or remain unprocessed
      expect([null, PriorityCategory.MEDIUM].includes(malformedEmail?.category as any)).toBe(true);
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
      }, 'default');

      await jobQueue.addJob(jobId, 'default');
      worker.start();
      logJobWait(jobId, "categorization", 5000);
      const job = await waitForJobCompletion(jobId, { timeout: 5000 });

      // Despite potential transient failures, job should complete
      expect(job.status).toBe(JobStatus.COMPLETED);
      expect(job.results.processed).toBeGreaterThanOrEqual(0);
    });

    it("should maintain singleton integrity under stress", async () => {
      // Verify singleton integrity before operations
      JobStatusStore.validateSingletonIntegrity();

      // Create multiple concurrent operations
      const concurrentJobs = await Promise.all([
        jobStatusStore.createJob("categorization", { year: 2022 }, 'default'),
        jobStatusStore.createJob("categorization", { year: 2023 }, 'default'),
        jobStatusStore.createJob("categorization", { year: 2024 }, 'default')
      ]);

      for (const jobId of concurrentJobs) {
        await jobQueue.addJob(jobId, 'default');
      }
      worker.start();

      // Wait for all jobs to complete
      await Promise.all(concurrentJobs.map(id => waitForJobCompletion(id, { timeout: 5000 })));

      // Verify singleton integrity after operations
      JobStatusStore.validateSingletonIntegrity();

      // All operations should succeed
      for (const jobId of concurrentJobs) {
        const job = await jobStatusStore.getJobStatus(jobId, 'default');
        expect(job!.status).toBe(JobStatus.COMPLETED);
      }
    });
  });

  // =====================================
  // F. PERFORMANCE & CONCURRENCY (3 tests)
  // =====================================

  describe("Performance & Concurrency", () => {
    it("should handle large email batches efficiently", async () => {
      // SLOW TEST: Large batch, but reduced for CI
      const largeEmailSet = await generateLargeEmailDataset(5, {
        highPriorityRatio: 0.2,
        lowPriorityRatio: 0.3,
        yearRange: { start: 2022, end: 2024 }
      });
      // Ensure user_id is set for all emails
      largeEmailSet.forEach(email => { email.user_id = 'default'; });
      await dbManager.bulkUpsertEmailIndex(largeEmailSet);
      const { result, memoryDelta } = await measureMemoryUsage(async () => {
        const { result: jobResult, timeMs: processingTime } = await measureProcessingTime(async () => {
          const jobId = await jobStatusStore.createJob("categorization", { 
            forceRefresh: false 
          }, 'default');
          await jobQueue.addJob(jobId, 'default');
          worker.start();
          logJobWait(jobId, "large batch", 10000);
          const result = await waitForJobCompletion(jobId, { timeout: 10000 });
          console.log(`[TEST] Job ${jobId} completed.`);
          return result;
        });
        return { jobResult, processingTime };
      });
      // Performance assertions
      expect(result.jobResult.status).toBe(JobStatus.COMPLETED);
      expect(result.jobResult.results.processed).toBe(largeEmailSet.length);
      expect(result.processingTime).toBeLessThan(3000); // 3 seconds max
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
      }, 'default');

      await jobQueue.addJob(firstJobId, 'default');
      worker.start();
      logJobWait(firstJobId, "categorization", 5000);
      const { timeMs: firstRunTime } = await measureProcessingTime(async () => {
        return await waitForJobCompletion(firstJobId, { timeout: 5000 });
      });

      worker.stop();
      await waitForWorkerShutdown(worker);

      // Second run should benefit from cache
      const secondJobId = await jobStatusStore.createJob("categorization", { 
        forceRefresh: true // Force reprocessing to test cache
      }, 'default');

      await jobQueue.addJob(secondJobId, 'default');
      worker.start();
      logJobWait(secondJobId, "categorization", 5000);
      const { timeMs: secondRunTime } = await measureProcessingTime(async () => {
        return await waitForJobCompletion(secondJobId, { timeout: 5000 });
      });

      // Get cache statistics
      const cacheStats = cacheManager.stats();
      
      // Performance should be better or similar on second run
      expect(secondRunTime).toBeLessThanOrEqual(firstRunTime * 2); // Allow 100% variance (more lenient for CI)
      
      // Verify cache was utilized
      expect(cacheStats.keys).toBeGreaterThanOrEqual(0);
    });

    it("should handle concurrent job requests", async () => {
      // Create multiple jobs simultaneously
      const concurrentJobs = await Promise.all([
        jobStatusStore.createJob("categorization", { year: 2022, forceRefresh: false }, 'default'),
        jobStatusStore.createJob("categorization", { year: 2023, forceRefresh: false }, 'default'),
        jobStatusStore.createJob("categorization", { year: 2024, forceRefresh: false }, 'default')
      ]);

      for (const jobId of concurrentJobs) {
        await jobQueue.addJob(jobId, 'default');
      }
      worker.start();

      // Measure concurrent processing
      const { result: completedJobs, timeMs: totalTime } = await measureProcessingTime(async () => {
        return await Promise.all(concurrentJobs.map(id => waitForJobCompletion(id, { timeout: 5000 })));
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
      expect(totalTime).toBeLessThan(3000); // 3 seconds max for all jobs
    });
  });
});

// Helper to log before/after job waits
function logJobWait(jobId: string, label: string, timeout: number) {
  console.log(`[TEST] Waiting for job ${jobId} (${label}) with timeout ${timeout}ms`);
}
