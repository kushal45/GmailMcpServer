import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import { createMockOAuth2Client, mockFs, cleanupMocks } from '../../utils/testHelpers';
import { mockCredentials, mockTokens } from '../../fixtures/mockData';
import * as fs from 'fs/promises';
import { google } from 'googleapis';

// Mock modules
jest.mock('fs/promises');
jest.mock('googleapis');

describe('AuthManager', () => {
  let authManager: AuthManager;
  let mockOAuth2Client: ReturnType<typeof createMockOAuth2Client>;
  const mockedFs = fs as jest.Mocked<typeof fs>;
  const mockedGoogle = google as jest.Mocked<typeof google>;

  beforeEach(() => {
    mockOAuth2Client = createMockOAuth2Client();
    (mockedGoogle.auth as any) = {
      OAuth2: jest.fn().mockReturnValue(mockOAuth2Client)
    };
    authManager = new AuthManager();
  });

  afterEach(() => {
    cleanupMocks();
  });

  describe('initialize', () => {
    it('should initialize OAuth2 client with credentials', async () => {
      mockedFs.readFile.mockImplementation((path: any, encoding?: any) => {
        const pathStr = String(path);
        if (pathStr.includes('credentials.json')) {
          return Promise.resolve(JSON.stringify(mockCredentials)) as any;
        }
        return Promise.reject(new Error('File not found'));
      });

      await authManager.initialize();

      expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('credentials.json'), 'utf-8');
      expect(google.auth.OAuth2).toHaveBeenCalledWith(
        mockCredentials.installed.client_id,
        mockCredentials.installed.client_secret,
        mockCredentials.installed.redirect_uris[0]
      );
    });

    it('should load existing token if available', async () => {
      mockedFs.readFile.mockImplementation((path: any, encoding?: any) => {
        const pathStr = String(path);
        if (pathStr.includes('credentials.json')) {
          return Promise.resolve(JSON.stringify(mockCredentials)) as any;
        }
        if (pathStr.includes('token.json')) {
          return Promise.resolve(JSON.stringify(mockTokens)) as any;
        }
        return Promise.reject(new Error('File not found'));
      });

      await authManager.initialize();

      expect(fs.readFile).toHaveBeenCalledWith(expect.stringContaining('token.json'), 'utf-8');
      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(mockTokens);
    });

    it('should handle missing credentials file', async () => {
      mockedFs.readFile.mockRejectedValue(new Error('ENOENT'));

      await expect(authManager.initialize()).rejects.toThrow(
        'Unable to load credentials. Please ensure credentials.json is present in the project root.'
      );
    });
  });

  describe('hasValidAuth', () => {
    beforeEach(async () => {
      mockedFs.readFile.mockImplementation((path: any, encoding?: any) => {
        const pathStr = String(path);
        if (pathStr.includes('credentials.json')) {
          return Promise.resolve(JSON.stringify(mockCredentials)) as any;
        }
        return Promise.reject(new Error('File not found'));
      });
      await authManager.initialize();
    });

    it('should return true for valid non-expired token', async () => {
      mockOAuth2Client.credentials = mockTokens;

      const result = await authManager.hasValidAuth();

      expect(result).toBe(true);
    });

    it('should return false for missing token', async () => {
      mockOAuth2Client.credentials = {};

      const result = await authManager.hasValidAuth();

      expect(result).toBe(false);
    });

    it('should refresh expired token and return true', async () => {
      const expiredTokens = {
        ...mockTokens,
        expiry_date: Date.now() - 1000 // Expired
      };
      mockOAuth2Client.credentials = expiredTokens;
      (mockOAuth2Client.refreshAccessToken as any).mockResolvedValue({
        credentials: mockTokens,
        res: {} as any
      });

      const result = await authManager.hasValidAuth();

      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false if refresh fails', async () => {
      const expiredTokens = {
        ...mockTokens,
        expiry_date: Date.now() - 1000 // Expired
      };
      mockOAuth2Client.credentials = expiredTokens;
      (mockOAuth2Client.refreshAccessToken as any).mockRejectedValue(new Error('Refresh failed'));

      const result = await authManager.hasValidAuth();

      expect(result).toBe(false);
    });
  });

  describe('refreshToken', () => {
    beforeEach(async () => {
      mockedFs.readFile.mockImplementation((path: any, encoding?: any) => {
        const pathStr = String(path);
        if (pathStr.includes('credentials.json')) {
          return Promise.resolve(JSON.stringify(mockCredentials)) as any;
        }
        return Promise.reject(new Error('File not found'));
      });
      await authManager.initialize();
    });

    it('should refresh token successfully', async () => {
      mockOAuth2Client.credentials = { ...mockTokens, refresh_token: 'refresh-token' };
      const newTokens = { ...mockTokens, access_token: 'new-access-token' };
      (mockOAuth2Client.refreshAccessToken as any).mockResolvedValue({
        credentials: newTokens,
        res: {} as any
      });
      mockedFs.writeFile.mockResolvedValue();

      await authManager.refreshToken();

      expect(mockOAuth2Client.refreshAccessToken).toHaveBeenCalled();
      expect(mockOAuth2Client.setCredentials).toHaveBeenCalledWith(newTokens);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('token.json'),
        JSON.stringify(newTokens)
      );
    });

    it('should throw error if no refresh token available', async () => {
      mockOAuth2Client.credentials = { access_token: 'token' };

      await expect(authManager.refreshToken()).rejects.toThrow('No refresh token available');
    });
  });

  describe('getAuthUrl', () => {
    beforeEach(async () => {
      mockedFs.readFile.mockImplementation((path: any, encoding?: any) => {
        const pathStr = String(path);
        if (pathStr.includes('credentials.json')) {
          return Promise.resolve(JSON.stringify(mockCredentials)) as any;
        }
        return Promise.reject(new Error('File not found'));
      });
      await authManager.initialize();
    });

    it('should generate auth URL with correct scopes', async () => {
      const mockAuthUrl = 'https://accounts.google.com/o/oauth2/auth?...';
      (mockOAuth2Client.generateAuthUrl as any).mockReturnValue(mockAuthUrl);

      const url = await authManager.getAuthUrl();

      expect(mockOAuth2Client.generateAuthUrl).toHaveBeenCalledWith({
        access_type: 'offline',
        scope: expect.arrayContaining([
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.labels'
        ]),
        prompt: 'consent'
      });
      expect(url).toBe(mockAuthUrl);
    });

    it('should include additional scopes if provided', async () => {
      const additionalScopes = ['https://www.googleapis.com/auth/drive'];
      (mockOAuth2Client.generateAuthUrl as any).mockReturnValue('https://auth.url');

      await authManager.getAuthUrl(additionalScopes);

      expect(mockOAuth2Client.generateAuthUrl).toHaveBeenCalledWith({
        access_type: 'offline',
        scope: expect.arrayContaining([
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/gmail.labels',
          'https://www.googleapis.com/auth/drive'
        ]),
        prompt: 'consent'
      });
    });
  });

  describe('getClient', () => {
    it('should return OAuth2 client when initialized', async () => {
      mockedFs.readFile.mockImplementation((path: any, encoding?: any) => {
        const pathStr = String(path);
        if (pathStr.includes('credentials.json')) {
          return Promise.resolve(JSON.stringify(mockCredentials)) as any;
        }
        return Promise.reject(new Error('File not found'));
      });
      await authManager.initialize();

      const client = authManager.getClient();

      expect(client).toBe(mockOAuth2Client);
    });

    it('should throw error when not initialized', () => {
      expect(() => authManager.getClient()).toThrow('OAuth2 client not initialized');
    });
  });

  describe('getGmailClient', () => {
    beforeEach(async () => {
      mockedFs.readFile.mockImplementation((path: any, encoding?: any) => {
        const pathStr = String(path);
        if (pathStr.includes('credentials.json')) {
          return Promise.resolve(JSON.stringify(mockCredentials)) as any;
        }
        if (pathStr.includes('token.json')) {
          return Promise.resolve(JSON.stringify(mockTokens)) as any;
        }
        return Promise.reject(new Error('File not found'));
      });
      await authManager.initialize();
    });

    it('should return Gmail client when authenticated', async () => {
      mockOAuth2Client.credentials = mockTokens;
      const mockGmailClient = { users: { messages: {} } };
      (mockedGoogle.gmail as any) = jest.fn().mockReturnValue(mockGmailClient);

      const gmailClient = await authManager.getGmailClient();

      expect(google.gmail).toHaveBeenCalledWith({
        version: 'v1',
        auth: mockOAuth2Client
      });
      expect(gmailClient).toBe(mockGmailClient);
    });

    it('should throw error when not authenticated', async () => {
      mockOAuth2Client.credentials = {};

      await expect(authManager.getGmailClient()).rejects.toThrow('Not authenticated');
    });
  });
});