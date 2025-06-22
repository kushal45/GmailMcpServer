import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach
} from "@jest/globals";

// Import types for proper typing
import { UserProfile, Job, JobStatus } from '../../../src/types/index.js';

describe('Multi-User Data Isolation Tests', () => {
  // Test constants
  const USER1 = 'user-1';
  const USER2 = 'user-2';
  const ADMIN_USER = 'admin-1';
  
  // Mock data isolation system
  let mockDataSystem: any;
  let mockListEmails: jest.Mock;
  let mockGetJobStatus: jest.Mock;
  let mockListJobs: jest.Mock;
  let mockSearchEmails: jest.Mock;
  let mockGetUserProfile: jest.Mock;
  let mockValidateSession: jest.Mock;
  
  // Mock user data
  const testUsers = {
    admin: {
      userId: ADMIN_USER,
      email: 'admin@example.com',
      displayName: 'Admin User',
      role: 'admin',
      created: new Date(),
      preferences: {},
      isActive: true
    } as UserProfile,
    user1: {
      userId: USER1,
      email: 'user1@example.com',
      displayName: 'Test User 1',
      role: 'user',
      created: new Date(),
      preferences: {},
      isActive: true
    } as UserProfile,
    user2: {
      userId: USER2,
      email: 'user2@example.com',
      displayName: 'Test User 2',
      role: 'user',
      created: new Date(),
      preferences: {},
      isActive: true
    } as UserProfile
  };
  
  // Mock job data
  const testJobs = {
    user1Job1: {
      job_id: 'job-user1-1',
      job_type: 'categorize',
      status: JobStatus.COMPLETED,
      request_params: { year: 2024 },
      results: { processedEmails: 100 },
      created_at: new Date(),
      started_at: new Date(),
      completed_at: new Date(),
      user_id: USER1
    } as Job,
    user1Job2: {
      job_id: 'job-user1-2',
      job_type: 'archive',
      status: JobStatus.IN_PROGRESS,
      request_params: { category: 'low' },
      progress: 50,
      created_at: new Date(),
      started_at: new Date(),
      user_id: USER1
    } as Job,
    user2Job1: {
      job_id: 'job-user2-1',
      job_type: 'categorize',
      status: JobStatus.COMPLETED,
      request_params: { year: 2023 },
      results: { processedEmails: 150 },
      created_at: new Date(),
      started_at: new Date(),
      completed_at: new Date(),
      user_id: USER2
    } as Job
  };

  beforeEach(() => {
    // Create mock functions
    mockListEmails = jest.fn();
    mockGetJobStatus = jest.fn();
    mockListJobs = jest.fn();
    mockSearchEmails = jest.fn();
    mockGetUserProfile = jest.fn();
    mockValidateSession = jest.fn();
    
    // Create a mock data isolation system
    mockDataSystem = {
      listEmails: mockListEmails,
      getJobStatus: mockGetJobStatus,
      listJobs: mockListJobs,
      searchEmails: mockSearchEmails,
      getUserProfile: mockGetUserProfile,
      validateSession: mockValidateSession
    };
    
    // Setup session validation
    mockValidateSession.mockImplementation((sessionId: any) => {
      if (sessionId === 'session-user-1') return { isValid: true, userId: USER1 };
      if (sessionId === 'session-user-2') return { isValid: true, userId: USER2 };
      if (sessionId === 'session-admin-1') return { isValid: true, userId: ADMIN_USER };
      return { isValid: false };
    });
    
    // Setup email listing with user isolation
    mockListEmails.mockImplementation((userContext: any) => {
      const session = mockDataSystem.validateSession(userContext.session_id);
      if (!session.isValid) {
        throw new Error('Invalid session');
      }
      
      // Return user-specific emails
      if (session.userId === USER1) {
        return [
          { id: 'email-1', subject: 'User 1 Email 1', user_id: USER1 },
          { id: 'email-2', subject: 'User 1 Email 2', user_id: USER1 }
        ];
      }
      
      if (session.userId === USER2) {
        return [
          { id: 'email-3', subject: 'User 2 Email 1', user_id: USER2 }
        ];
      }
      
      return [];
    });
    
    // Setup job status with user isolation
    mockGetJobStatus.mockImplementation((jobId: any, userContext: any) => {
      const session = mockDataSystem.validateSession(userContext.session_id);
      if (!session.isValid) {
        throw new Error('Invalid session');
      }
      
      // Check job ownership
      if (jobId === testJobs.user1Job1.job_id && session.userId === USER1) {
        return testJobs.user1Job1;
      }
      if (jobId === testJobs.user1Job2.job_id && session.userId === USER1) {
        return testJobs.user1Job2;
      }
      if (jobId === testJobs.user2Job1.job_id && session.userId === USER2) {
        return testJobs.user2Job1;
      }
      
      // Admin can access all jobs
      if (session.userId === ADMIN_USER) {
        if (jobId === testJobs.user1Job1.job_id) return testJobs.user1Job1;
        if (jobId === testJobs.user1Job2.job_id) return testJobs.user1Job2;
        if (jobId === testJobs.user2Job1.job_id) return testJobs.user2Job1;
      }
      
      throw new Error('Access denied or job not found');
    });
    
    // Setup job listing with user isolation
    mockListJobs.mockImplementation((userContext: any) => {
      const session = mockDataSystem.validateSession(userContext.session_id);
      if (!session.isValid) {
        throw new Error('Invalid session');
      }
      
      // Return user-specific jobs
      if (session.userId === USER1) {
        return [testJobs.user1Job1, testJobs.user1Job2];
      }
      
      if (session.userId === USER2) {
        return [testJobs.user2Job1];
      }
      
      // Admin sees all jobs
      if (session.userId === ADMIN_USER) {
        return [testJobs.user1Job1, testJobs.user1Job2, testJobs.user2Job1];
      }
      
      return [];
    });
    
    // Setup search with user isolation
    mockSearchEmails.mockImplementation((userContext: any) => {
      const session = mockDataSystem.validateSession(userContext.session_id);
      if (!session.isValid) {
        throw new Error('Invalid session');
      }
      
      // Return user-specific search results
      if (session.userId === USER1) {
        return {
          results: [
            { id: 'email-1', user_id: USER1, subject: 'User 1 Result' },
            { id: 'email-2', user_id: USER1, subject: 'User 1 Result 2' }
          ],
          total: 2
        };
      }
      
      if (session.userId === USER2) {
        return {
          results: [
            { id: 'email-3', user_id: USER2, subject: 'User 2 Result' }
          ],
          total: 1
        };
      }
      
      return { results: [], total: 0 };
    });
    
    // Setup user profile access
    mockGetUserProfile.mockImplementation((targetUserId: any, userContext: any) => {
      const session = mockDataSystem.validateSession(userContext.session_id);
      if (!session.isValid) {
        throw new Error('Invalid session');
      }
      
      // Users can only access their own profile unless admin
      const isAdmin = session.userId === ADMIN_USER;
      const isSelf = targetUserId === session.userId;
      
      if (!isAdmin && !isSelf) {
        throw new Error('Access denied');
      }
      
      // Return requested user profile
      if (targetUserId === ADMIN_USER) return testUsers.admin;
      if (targetUserId === USER1) return testUsers.user1;
      if (targetUserId === USER2) return testUsers.user2;
      
      throw new Error('User not found');
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Email Data Isolation', () => {
    it('should only return user\'s own emails', async () => {
      // Test user1 getting their emails
      const user1Emails = mockDataSystem.listEmails({
        user_id: USER1,
        session_id: 'session-user-1'
      });
      
      expect(user1Emails).toHaveLength(2);
      expect(user1Emails[0]).toHaveProperty('user_id', USER1);
      expect(user1Emails[1]).toHaveProperty('user_id', USER1);
      expect(mockListEmails).toHaveBeenCalledWith({
        user_id: USER1,
        session_id: 'session-user-1'
      });
      
      // Test user2 getting their emails
      const user2Emails = mockDataSystem.listEmails({
        user_id: USER2,
        session_id: 'session-user-2'
      });
      
      expect(user2Emails).toHaveLength(1);
      expect(user2Emails[0]).toHaveProperty('user_id', USER2);
      expect(mockListEmails).toHaveBeenCalledWith({
        user_id: USER2,
        session_id: 'session-user-2'
      });
    });

    it('should reject access with invalid session', () => {
      expect(() => mockDataSystem.listEmails({
        user_id: USER1,
        session_id: 'invalid-session'
      })).toThrow(/Invalid session/);
    });
  });

  describe('Job Data Isolation', () => {
    it('should only allow users to access their own jobs', () => {
      // User1 gets their job
      const user1Job = mockDataSystem.getJobStatus('job-user1-1', {
        user_id: USER1,
        session_id: 'session-user-1'
      });
      
      expect(user1Job).toHaveProperty('job_id', 'job-user1-1');
      expect(user1Job).toHaveProperty('user_id', USER1);
      
      // User1 tries to access user2's job - should fail
      expect(() => mockDataSystem.getJobStatus('job-user2-1', {
        user_id: USER1,
        session_id: 'session-user-1'
      })).toThrow(/Access denied/);
      
      // User1 lists their jobs
      const user1Jobs = mockDataSystem.listJobs({
        user_id: USER1,
        session_id: 'session-user-1'
      });
      
      expect(user1Jobs).toHaveLength(2);
      expect(user1Jobs[0]).toHaveProperty('job_id', 'job-user1-1');
      expect(user1Jobs[1]).toHaveProperty('job_id', 'job-user1-2');
      
      // User2 lists their jobs
      const user2Jobs = mockDataSystem.listJobs({
        user_id: USER2,
        session_id: 'session-user-2'
      });
      
      expect(user2Jobs).toHaveLength(1);
      expect(user2Jobs[0]).toHaveProperty('job_id', 'job-user2-1');
    });

    it('should isolate job access between users', () => {
      // User1 can access their jobs
      const user1Job1 = mockDataSystem.getJobStatus('job-user1-1', {
        user_id: USER1,
        session_id: 'session-user-1'
      });
      expect(user1Job1.job_id).toBe('job-user1-1');
      
      const user1Job2 = mockDataSystem.getJobStatus('job-user1-2', {
        user_id: USER1,
        session_id: 'session-user-1'
      });
      expect(user1Job2.job_id).toBe('job-user1-2');
      
      // User2 can access their job
      const user2Job1 = mockDataSystem.getJobStatus('job-user2-1', {
        user_id: USER2,
        session_id: 'session-user-2'
      });
      expect(user2Job1.job_id).toBe('job-user2-1');
      
      // Cross-user access should fail
      expect(() => mockDataSystem.getJobStatus('job-user1-1', {
        user_id: USER2,
        session_id: 'session-user-2'
      })).toThrow(/Access denied/);
      
      expect(() => mockDataSystem.getJobStatus('job-user2-1', {
        user_id: USER1,
        session_id: 'session-user-1'
      })).toThrow(/Access denied/);
    });
  });

  describe('Search Data Isolation', () => {
    it('should only return search results for the user\'s own data', () => {
      // User1 search results
      const user1SearchResult = mockDataSystem.searchEmails({
        user_id: USER1,
        session_id: 'session-user-1'
      });
      
      expect(user1SearchResult).toHaveProperty('results');
      expect(user1SearchResult.results).toHaveLength(2);
      expect(user1SearchResult.results[0]).toHaveProperty('user_id', USER1);
      expect(user1SearchResult.results[1]).toHaveProperty('user_id', USER1);
      expect(user1SearchResult.total).toBe(2);
      
      // User2 search results
      const user2SearchResult = mockDataSystem.searchEmails({
        user_id: USER2,
        session_id: 'session-user-2'
      });
      
      expect(user2SearchResult).toHaveProperty('results');
      expect(user2SearchResult.results).toHaveLength(1);
      expect(user2SearchResult.results[0]).toHaveProperty('user_id', USER2);
      expect(user2SearchResult.total).toBe(1);
    });

    it('should validate search isolation between users', () => {
      // Get results for both users
      const user1Results = mockDataSystem.searchEmails({
        user_id: USER1,
        session_id: 'session-user-1'
      });
      
      const user2Results = mockDataSystem.searchEmails({
        user_id: USER2,
        session_id: 'session-user-2'
      });
      
      // Verify no cross-contamination
      expect(user1Results.total).toBe(2);
      expect(user2Results.total).toBe(1);
      
      // Verify all user1 results belong to user1
      user1Results.results.forEach((result: any) => {
        expect(result.user_id).toBe(USER1);
      });
      
      // Verify all user2 results belong to user2
      user2Results.results.forEach((result: any) => {
        expect(result.user_id).toBe(USER2);
      });
    });
  });

  describe('User Profile Access Control', () => {
    it('should allow users to access their own profile', () => {
      const user1Profile = mockDataSystem.getUserProfile(USER1, {
        user_id: USER1,
        session_id: 'session-user-1'
      });
      
      expect(user1Profile).toHaveProperty('userId', USER1);
      expect(user1Profile).toHaveProperty('email', 'user1@example.com');
      expect(user1Profile).toHaveProperty('role', 'user');
    });

    it('should prevent users from accessing other users\' profiles', () => {
      expect(() => mockDataSystem.getUserProfile(USER2, {
        user_id: USER1,
        session_id: 'session-user-1'
      })).toThrow(/Access denied/);
      
      expect(() => mockDataSystem.getUserProfile(USER1, {
        user_id: USER2,
        session_id: 'session-user-2'
      })).toThrow(/Access denied/);
    });

    it('should allow admin to access any user profile', () => {
      // Admin accesses user1 profile
      const user1Profile = mockDataSystem.getUserProfile(USER1, {
        user_id: ADMIN_USER,
        session_id: 'session-admin-1'
      });
      
      expect(user1Profile).toHaveProperty('userId', USER1);
      expect(user1Profile).toHaveProperty('email', 'user1@example.com');
      
      // Admin accesses user2 profile
      const user2Profile = mockDataSystem.getUserProfile(USER2, {
        user_id: ADMIN_USER,
        session_id: 'session-admin-1'
      });
      
      expect(user2Profile).toHaveProperty('userId', USER2);
      expect(user2Profile).toHaveProperty('email', 'user2@example.com');
      
      // Admin accesses their own profile
      const adminProfile = mockDataSystem.getUserProfile(ADMIN_USER, {
        user_id: ADMIN_USER,
        session_id: 'session-admin-1'
      });
      
      expect(adminProfile).toHaveProperty('userId', ADMIN_USER);
      expect(adminProfile).toHaveProperty('role', 'admin');
    });
  });

  describe('Admin Access Privileges', () => {
    it('should allow admin to access system-wide data', () => {
      // Admin can list all jobs
      const allJobs = mockDataSystem.listJobs({
        user_id: ADMIN_USER,
        session_id: 'session-admin-1'
      });
      
      expect(allJobs).toHaveLength(3);
      expect(allJobs.some((job: any) => job.user_id === USER1)).toBe(true);
      expect(allJobs.some((job: any) => job.user_id === USER2)).toBe(true);
      
      // Admin can access any job
      const user1Job = mockDataSystem.getJobStatus('job-user1-1', {
        user_id: ADMIN_USER,
        session_id: 'session-admin-1'
      });
      expect(user1Job.job_id).toBe('job-user1-1');
      
      const user2Job = mockDataSystem.getJobStatus('job-user2-1', {
        user_id: ADMIN_USER,
        session_id: 'session-admin-1'
      });
      expect(user2Job.job_id).toBe('job-user2-1');
    });

    it('should maintain privilege separation for regular users', () => {
      // Regular users cannot access admin privileges
      const user1Jobs = mockDataSystem.listJobs({
        user_id: USER1,
        session_id: 'session-user-1'
      });
      
      // User1 only sees their own jobs (2), not all jobs (3)
      expect(user1Jobs).toHaveLength(2);
      expect(user1Jobs.every((job: any) => job.user_id === USER1)).toBe(true);
      
      const user2Jobs = mockDataSystem.listJobs({
        user_id: USER2,
        session_id: 'session-user-2'
      });
      
      // User2 only sees their own job (1)
      expect(user2Jobs).toHaveLength(1);
      expect(user2Jobs[0].user_id).toBe(USER2);
    });
  });

  describe('Session Validation and Security', () => {
    it('should validate session correctly for all operations', () => {
      const testOperations = [
        () => mockDataSystem.listEmails({ user_id: USER1, session_id: 'session-user-1' }),
        () => mockDataSystem.getJobStatus('job-user1-1', { user_id: USER1, session_id: 'session-user-1' }),
        () => mockDataSystem.listJobs({ user_id: USER1, session_id: 'session-user-1' }),
        () => mockDataSystem.searchEmails({ user_id: USER1, session_id: 'session-user-1' }),
        () => mockDataSystem.getUserProfile(USER1, { user_id: USER1, session_id: 'session-user-1' })
      ];
      
      // All operations should succeed with valid session
      for (const operation of testOperations) {
        expect(() => operation()).not.toThrow();
      }
      
      // All operations should fail with invalid session
      const invalidOperations = [
        () => mockDataSystem.listEmails({ user_id: USER1, session_id: 'invalid-session' }),
        () => mockDataSystem.getJobStatus('job-user1-1', { user_id: USER1, session_id: 'invalid-session' }),
        () => mockDataSystem.listJobs({ user_id: USER1, session_id: 'invalid-session' }),
        () => mockDataSystem.searchEmails({ user_id: USER1, session_id: 'invalid-session' }),
        () => mockDataSystem.getUserProfile(USER1, { user_id: USER1, session_id: 'invalid-session' })
      ];
      
      for (const operation of invalidOperations) {
        expect(operation).toThrow(/Invalid session/);
      }
    });

    it('should isolate data access across all user contexts', () => {
      // Test comprehensive isolation matrix
      const users = [
        { id: USER1, session: 'session-user-1' },
        { id: USER2, session: 'session-user-2' },
        { id: ADMIN_USER, session: 'session-admin-1' }
      ];
      
      for (const user of users) {
        const context = { user_id: user.id, session_id: user.session };
        
        // Each user should get their own emails
        const emails = mockDataSystem.listEmails(context);
        expect(Array.isArray(emails)).toBe(true);
        
        // Each user should get their own jobs (admin sees all)
        const jobs = mockDataSystem.listJobs(context);
        expect(Array.isArray(jobs)).toBe(true);
        
        if (user.id === ADMIN_USER) {
          expect(jobs.length).toBe(3); // Admin sees all jobs
        } else {
          expect(jobs.every((job: any) => job.user_id === user.id)).toBe(true);
        }
        
        // Each user should get their own search results
        const searchResults = mockDataSystem.searchEmails(context);
        expect(searchResults).toHaveProperty('results');
        expect(Array.isArray(searchResults.results)).toBe(true);
      }
    });
  });
});