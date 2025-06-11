import { jest } from '@jest/globals';
import sinon from 'sinon';
import { OAuth2Client } from 'google-auth-library';
import { gmail_v1 } from 'googleapis';

export const createMockOAuth2Client = (): jest.Mocked<OAuth2Client> => {
  const mockClient = {
    generateAuthUrl: jest.fn(),
    getToken: jest.fn(),
    setCredentials: jest.fn(),
    refreshAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    credentials: {},
    on: jest.fn(),
    isTokenExpiring: jest.fn(),
    refreshToken: jest.fn(),
    refreshTokenNoCache: jest.fn(),
    revokeCredentials: jest.fn(),
    verifyIdToken: jest.fn(),
    request: jest.fn(),
    getRequestHeaders: jest.fn()
  } as unknown as jest.Mocked<OAuth2Client>;

  return mockClient;
};

export const createMockGmailClient = (): jest.Mocked<gmail_v1.Gmail> => {
  const mockGmail = {
    users: {
      messages: {
        list: jest.fn(),
        get: jest.fn(),
        modify: jest.fn(),
        trash: jest.fn(),
        untrash: jest.fn(),
        delete: jest.fn(),
        batchDelete: jest.fn(),
        batchModify: jest.fn()
      },
      labels: {
        list: jest.fn(),
        get: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        patch: jest.fn()
      },
      threads: {
        list: jest.fn(),
        get: jest.fn(),
        modify: jest.fn(),
        trash: jest.fn(),
        untrash: jest.fn(),
        delete: jest.fn()
      },
      history: {
        list: jest.fn()
      },
      getProfile: jest.fn(),
      watch: jest.fn(),
      stop: jest.fn()
    }
  } as unknown as jest.Mocked<gmail_v1.Gmail>;

  return mockGmail;
};

export const mockFetch = (responses: Array<{ ok: boolean; status: number; text: () => Promise<string> }>) => {
  let callIndex = 0;
  return jest.fn().mockImplementation(() => {
    const response = responses[callIndex % responses.length];
    callIndex++;
    return Promise.resolve(response);
  });
};

export const createMockDatabase = () => {
  return {
    initialize: jest.fn(() => Promise.resolve()),
    close: jest.fn(() => Promise.resolve()),
    getEmailIndex: jest.fn(),
    upsertEmailIndex: jest.fn(() => Promise.resolve()),
    bulkUpsertEmailIndex: jest.fn(() => Promise.resolve()),
    searchEmails: jest.fn(),
    getEmailsByCategory: jest.fn(),
    getEmailsByYear: jest.fn(),
    getEmailStatistics: jest.fn(),
    markAsArchived: jest.fn(() => Promise.resolve()),
    deleteEmailIndex: jest.fn(() => Promise.resolve()),
    bulkDeleteEmailIndex: jest.fn(() => Promise.resolve()),
    saveArchiveRule: jest.fn(() => Promise.resolve()),
    getArchiveRules: jest.fn(),
    updateArchiveRuleStats: jest.fn(() => Promise.resolve()),
    saveArchiveRecord: jest.fn(() => Promise.resolve()),
    getArchiveRecords: jest.fn(),
    saveSavedSearch: jest.fn(() => Promise.resolve()),
    getSavedSearches: jest.fn(),
    updateSavedSearchUsage: jest.fn(() => Promise.resolve()),
    deleteSavedSearch: jest.fn(() => Promise.resolve()),
    getEmailCount: jest.fn(),
    saveSearch: jest.fn(),
  };
};

export const createMockCache = () => {
  const cache = new Map();
  return {
    get: jest.fn((key: string) => cache.get(key)),
    set: jest.fn((key: string, value: any) => {
      cache.set(key, value);
    }),
    delete: jest.fn((key: string) => cache.delete(key)),
    clear: jest.fn(() => cache.clear()),
    has: jest.fn((key: string) => cache.has(key))
  };
};

export const waitForAsync = (ms: number = 100): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const mockFs = {
  readFile: jest.fn(),
  writeFile: jest.fn(),
  mkdir: jest.fn(),
  access: jest.fn(),
  unlink: jest.fn(),
  readdir: jest.fn(),
  stat: jest.fn()
};

export const setupMockFs = () => {
  jest.mock('fs/promises', () => mockFs);
};

export const cleanupMocks = () => {
  jest.clearAllMocks();
  sinon.restore();
};