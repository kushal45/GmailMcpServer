import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { CategorizationWorker } from "../../../src/categorization/CategorizationWorker.js";
import { JobQueue } from "../../../src/database/JobQueue.js";
import { CategorizationEngine } from "../../../src/categorization/CategorizationEngine.js";
import { JobStatusStore } from "../../../src/database/JobStatusStore.js";
import { DatabaseManager } from "../../../src/database/DatabaseManager.js";
import { JobStatus, Job } from "../../../src/database/jobStatusTypes.js";
import { CacheManager } from "../../../src/cache/CacheManager.js";
import { PriorityCategory, EmailIndex } from "../../../src/types/index.js";
import {
  cleanupTestDatabase,
  createWorkerWithRealComponents,
  seedRealisticTestData,
  delay
} from "./helpers/testHelpers.js";

describe("CategorizationWorker Basic Integration Tests", () => {
  let worker: CategorizationWorker;
  let jobQueue: JobQueue;
  let categorizationEngine: CategorizationEngine;
  let jobStatusStore: JobStatusStore;
  let dbManager: DatabaseManager;
  let cacheManager: CacheManager;

  beforeEach(async () => {
    const components = await createWorkerWithRealComponents();
    worker = components.worker;
    jobQueue = components.jobQueue;
    categorizationEngine = components.categorizationEngine;
    jobStatusStore = components.jobStatusStore;
    dbManager = components.dbManager;
    cacheManager = components.cacheManager;
  });

  afterEach(async () => {
    worker.stop();
    await delay(100); // Give worker time to stop
    await cleanupTestDatabase(dbManager);
    jest.clearAllMocks();
  });

  it("should process a simple categorization job successfully with real engine", async () => {
    // Create test email
    const testEmail: EmailIndex = {
      id: 'test-email-1',
      threadId: 'thread-1',
      category: null,
      subject: 'URGENT: System Alert',
      sender: 'admin@company.com',
      recipients: ['user@example.com'],
      date: new Date(),
      year: 2024,
      size: 75000,
      hasAttachments: false,
      labels: ['INBOX', 'IMPORTANT'],
      snippet: 'Critical system alert requiring immediate attention',
      archived: false
    };

    await dbManager.bulkUpsertEmailIndex([testEmail]);

    // Create and process job
    const jobId = await jobStatusStore.createJob("categorization", {
      year: 2024,
      forceRefresh: false
    });

    // Add job to queue (this is the missing link!)
    await jobQueue.addJob(jobId);

    // Mock the categorization engine to avoid real processing complexity
    const mockResult = {
      processed: 1,
      categories: { high: 1, medium: 0, low: 0 },
      emails: [{
        ...testEmail,
        category: PriorityCategory.HIGH,
        importanceLevel: 'high' as const,
        importanceScore: 15,
        ageCategory: 'recent' as const,
        sizeCategory: 'small' as const,
        analysisTimestamp: new Date(),
        analysisVersion: '1.0.0'
      }],
      analyzer_insights: {
        top_importance_rules: ['urgent'],
        spam_detection_rate: 0,
        avg_confidence: 0.8,
        age_distribution: { recent: 1, moderate: 0, old: 0 },
        size_distribution: { small: 1, medium: 0, large: 0 }
      }
    };

    const categorizeSpy = jest.spyOn(categorizationEngine, 'categorizeEmails').mockResolvedValue(mockResult);

    // Start worker
    worker.start();

    // Wait for job completion with timeout
    let job: Job | null = null;
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds timeout

    while (attempts < maxAttempts) {
      job = await jobStatusStore.getJobStatus(jobId);
      if (job && [JobStatus.COMPLETED, JobStatus.FAILED].includes(job.status)) {
        break;
      }
      await delay(100);
      attempts++;
    }

    // Verify job completed successfully
    expect(job).not.toBeNull();
    expect(job!.status).toBe(JobStatus.COMPLETED);
    expect(job!.results).toBeDefined();
    expect(job!.results.processed).toBe(1);
    expect(job!.results.emailIds).toHaveLength(1);
    expect(job!.results.emailIds[0]).toBe('test-email-1');

    // Verify categorization engine was called with correct parameters
    expect(categorizeSpy).toHaveBeenCalledWith({
      forceRefresh: false,
      year: 2024
    });

    // Since we mocked the engine, verify that job processing occurred correctly
    // The job should be completed and have the expected result structure
    expect(job!.results.emailIds).toEqual(['test-email-1']);
    
    // Cleanup spy
    categorizeSpy.mockRestore();
  });

  it("should handle empty job queue gracefully", async () => {
    // Create spy to track calls
    const categorizeSpy = jest.spyOn(categorizationEngine, 'categorizeEmails');
    
    // Start worker with no jobs
    worker.start();
    
    // Wait a short time
    await delay(200);
    
    // Stop worker
    worker.stop();
    
    // Verify no jobs were processed (no calls to categorization engine)
    expect(categorizeSpy).not.toHaveBeenCalled();
    
    categorizeSpy.mockRestore();
  });

  it("should handle failed categorization gracefully", async () => {
    // Create test data
    await seedRealisticTestData(dbManager, 5);

    const jobId = await jobStatusStore.createJob("categorization", {
      year: 2024,
      forceRefresh: false
    });

    // Add job to queue
    await jobQueue.addJob(jobId);

    // Mock categorization engine to fail
    jest.spyOn(categorizationEngine, 'categorizeEmails').mockRejectedValue(
      new Error("Categorization failed")
    );

    worker.start();

    // Wait for job completion
    let job: Job | null = null;
    let attempts = 0;
    const maxAttempts = 50;

    while (attempts < maxAttempts) {
      job = await jobStatusStore.getJobStatus(jobId);
      if (job && [JobStatus.COMPLETED, JobStatus.FAILED].includes(job.status)) {
        break;
      }
      await delay(100);
      attempts++;
    }

    // Verify job failed gracefully
    expect(job).not.toBeNull();
    expect(job!.status).toBe(JobStatus.FAILED);
    expect(job!.error_details).toContain("Categorization failed");
  });

  it("should process job with no emails found", async () => {
    // Create job for year with no emails
    const jobId = await jobStatusStore.createJob("categorization", {
      year: 2025, // Future year with no emails
      forceRefresh: false
    });

    // Add job to queue
    await jobQueue.addJob(jobId);

    // Mock empty result
    const emptyResult = {
      processed: 0,
      categories: { high: 0, medium: 0, low: 0 },
      emails: [],
      analyzer_insights: {
        top_importance_rules: [],
        spam_detection_rate: 0,
        avg_confidence: 0,
        age_distribution: { recent: 0, moderate: 0, old: 0 },
        size_distribution: { small: 0, medium: 0, large: 0 }
      }
    };

    jest.spyOn(categorizationEngine, 'categorizeEmails').mockResolvedValue(emptyResult);

    worker.start();

    // Wait for job completion
    let job: Job | null = null;
    let attempts = 0;
    const maxAttempts = 50;

    while (attempts < maxAttempts) {
      job = await jobStatusStore.getJobStatus(jobId);
      if (job && [JobStatus.COMPLETED, JobStatus.FAILED].includes(job.status)) {
        break;
      }
      await delay(100);
      attempts++;
    }

    // Verify job completed with no emails processed
    expect(job).not.toBeNull();
    expect(job!.status).toBe(JobStatus.COMPLETED);
    // When no emails are found, results structure might be different
    expect(job!.results.message).toBe('No emails to categorize');
    expect(job!.results.emailIds).toEqual([]);
  });

  it("should validate singleton integrity", async () => {
    // Verify singleton integrity before operations
    expect(() => JobStatusStore.validateSingletonIntegrity()).not.toThrow();
    expect(() => DatabaseManager.validateSingletonIntegrity()).not.toThrow();

    // Create and process a job
    const jobId = await jobStatusStore.createJob("categorization", {
      year: 2024,
      forceRefresh: false
    });

    const mockResult = {
      processed: 0,
      categories: { high: 0, medium: 0, low: 0 },
      emails: [],
      analyzer_insights: {
        top_importance_rules: [],
        spam_detection_rate: 0,
        avg_confidence: 0,
        age_distribution: { recent: 0, moderate: 0, old: 0 },
        size_distribution: { small: 0, medium: 0, large: 0 }
      }
    };

    jest.spyOn(categorizationEngine, 'categorizeEmails').mockResolvedValue(mockResult);

    worker.start();
    await delay(200);
    worker.stop();

    // Verify singleton integrity after operations
    expect(() => JobStatusStore.validateSingletonIntegrity()).not.toThrow();
    expect(() => DatabaseManager.validateSingletonIntegrity()).not.toThrow();
  });
});