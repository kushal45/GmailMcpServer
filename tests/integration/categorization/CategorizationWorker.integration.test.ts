import { CategorizationWorker } from '../../../src/categorization/CategorizationWorker.js';
import { JobQueue } from '../../../src/database/JobQueue.js';
import { CategorizationEngine } from '../../../src/categorization/CategorizationEngine.js';
import { JobStatusStore } from '../../../src/database/JobStatusStore.js';
import { DatabaseManager } from '../../../src/database/DatabaseManager.js';
import { JobStatus } from '../../../src/database/jobStatusTypes.js';
import { CacheManager } from '../../../src/cache/CacheManager.js';

describe('CategorizationWorker Integration Tests', () => {
  let worker: CategorizationWorker;
  let jobQueue: JobQueue;
  let categorizationEngine: CategorizationEngine;
  let jobStatusStore: JobStatusStore;
  let dbManager: DatabaseManager;

  beforeAll(() => {
    jest.useFakeTimers();
  });

  beforeEach(async () => {
    dbManager = DatabaseManager.getInstance();
    await dbManager.initialize();
    jobStatusStore = JobStatusStore.getInstance();
    await jobStatusStore.initialize();
    jobQueue = new JobQueue();
    const cacheManager = new CacheManager();
    categorizationEngine = new CategorizationEngine(dbManager, cacheManager);
    worker = new CategorizationWorker(jobQueue, categorizationEngine);
  });

  afterEach(async () => {
    await dbManager.close();
  });

  it('should process a categorization job successfully', async () => {
    const jobId = await jobStatusStore.createJob('categorization', { year: 2023 });
    
    jest.spyOn(categorizationEngine, 'categorizeEmails').mockResolvedValue({
      processed: 10,
      categories: { high: 5, medium: 3, low: 2 },
      emails: [{ id: 'email1' }, { id: 'email2' }]
    });

    worker.start();

    await new Promise(resolve => setTimeout(resolve, 10000));

    const jobStatus = await jobStatusStore.getJobStatus(jobId);
    expect(jobStatus).not.toBeNull();
    if (jobStatus) {
      expect(jobStatus.status).toBe(JobStatus.COMPLETED);
      expect(jobStatus.results).toHaveProperty('processed', 10);
    }
  });
  it('should handle an empty job queue', async () => {
    worker.start();
    await new Promise(resolve => setTimeout(resolve, 5000));
    // No jobs should be processed
    expect(categorizationEngine.categorizeEmails).not.toHaveBeenCalled();
  });

  it('should handle failed categorization', async () => {
    const jobId = await jobStatusStore.createJob('categorization', { year: 2023 });
    
    jest.spyOn(categorizationEngine, 'categorizeEmails').mockRejectedValue(new Error('Categorization failed'));

    worker.start();
    await new Promise(resolve => setTimeout(resolve, 10000));

    const jobStatus = await jobStatusStore.getJobStatus(jobId);
    expect(jobStatus).not.toBeNull();
    if (jobStatus) {
      expect(jobStatus.status).toBe(JobStatus.FAILED);
      expect(jobStatus.error_details).toContain('Categorization failed');
    }
  });

  it('should handle categorization with no emails found', async () => {
    const jobId = await jobStatusStore.createJob('categorization', { year: 2023 });
    
    jest.spyOn(categorizationEngine, 'categorizeEmails').mockResolvedValue({
      processed: 0,
      categories: { high: 0, medium: 0, low: 0 },
      emails: []
    });

    worker.start();
    await new Promise(resolve => setTimeout(resolve, 10000));

    const jobStatus = await jobStatusStore.getJobStatus(jobId);
    expect(jobStatus).not.toBeNull();
    if (jobStatus) {
      expect(jobStatus.status).toBe(JobStatus.COMPLETED);
      expect(jobStatus.results).toHaveProperty('processed', 0);
    }
  });

  it('should handle database connection failure', async () => {
    const jobId = await jobStatusStore.createJob('categorization', { year: 2023 });
    
    jest.spyOn(dbManager, 'getJob').mockRejectedValue(new Error('Database connection failed'));

    worker.start();
    await new Promise(resolve => setTimeout(resolve, 10000));

    const jobStatus = await jobStatusStore.getJobStatus(jobId);
    expect(jobStatus).not.toBeNull();
    if (jobStatus) {
      expect(jobStatus.status).toBe(JobStatus.FAILED);
      expect(jobStatus.error_details).toContain('Database connection failed');
    }
  });

  it('should handle invalid job parameters', async () => {
    const jobId = await jobStatusStore.createJob('categorization', {});

    worker.start();
    await new Promise(resolve => setTimeout(resolve, 10000));

    const jobStatus = await jobStatusStore.getJobStatus(jobId);
    expect(jobStatus).not.toBeNull();
    if (jobStatus) {
      expect(jobStatus.status).toBe(JobStatus.FAILED);
      expect(jobStatus.error_details).toContain('Invalid job parameters');
    }
  });
});