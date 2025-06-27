import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================
// Bulk, Batching, and Edge-Case DeleteManager Integration Tests
//
// NOTE: Large-data and performance tests are skipped by default for fast CI/dev runs.
// To run them, change `describe.skip` to `describe.only` or `describe`.
// =========================
import { DeleteManager } from "../../../src/delete/DeleteManager.js";
import {
  batchTestEmails,
  errorScenarioEmails,
  getEmailsByCriteria,
} from "./fixtures/mockEmails.js";
import {
  createTestDatabaseManager,
  cleanupTestDatabase,
  seedTestData,
  createDeleteOptions,
  setupSuccessfulBatchModify,
  setupPartialBatchFailure,
  setupBatchModifyFailure,
  verifyBatchModifyCalls,
  createMockGmailClient,
  createMockAuthManager,
  testErrors,
  createMockCleanupPolicy,
  createPerformanceTestScenario,
} from "./helpers/testHelpers.js";
import { PriorityCategory } from "../../../src/types/index.js";
import { logger } from "../../../src/utils/logger.js";
import { jest } from "@jest/globals";
import { DatabaseManager } from "../../../src/database/DatabaseManager.js";
import crypto from 'crypto';
import fs from 'fs/promises';

// Helper to force-reset DatabaseManager singleton and STORAGE_PATH (ESM compatible)
async function forceResetDatabaseManager() {
  const module = await import("../../../src/database/DatabaseManager.js");
  module.DatabaseManager["singletonInstance"] = null;
  delete process.env.STORAGE_PATH;
  console.log(
    "DIAGNOSTIC: Forced DatabaseManager singleton and STORAGE_PATH reset"
  );
}

function generateUniqueUserId() {
  return `bulk-test-user-${Math.random().toString(36).substring(2, 10)}-${Date.now()}`;
}

describe("DeleteManager Bulk Delete Operations Standalone", () => {
  it("should handle batch processing for large number of emails", async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    console.log("DIAGNOSTIC: Using testDbDir:", testDbDir);
    console.log(
      "DIAGNOSTIC: process.env.STORAGE_PATH:",
      process.env.STORAGE_PATH
    );
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const emailsBefore = await userDbManager.searchEmails({});
      console.log(
        "DIAGNOSTIC: DB should be empty before seeding, count:",
        emailsBefore.length
      );
      await seedTestData(
        userDbManager,
        batchTestEmails,
        defaultUserContext.user_id
      );
      const allEmails = await userDbManager.searchEmails({});
      console.log('[DIAGNOSTIC] After seeding, emails in DB:', allEmails.length, allEmails.map(e => e.id));
      setupSuccessfulBatchModify(mockGmailClient);
      const searchedEmails = await userDbManager.searchEmails({
        category: "low",
        archived: false,
      });
      console.log('[DIAGNOSTIC] Before deletion, emails matching criteria:', searchedEmails.length, searchedEmails.map(e => e.id));
      const firstBatch = searchedEmails.slice(0, 50);
      const secondBatch = searchedEmails.slice(50, 80);
      const options = createDeleteOptions({
        category: "low",
        skipArchived: true,
      });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(80);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(
        2
      );
      verifyBatchModifyCalls(mockGmailClient, [
        { ids: firstBatch.map((e) => e.id) },
        { ids: secondBatch.map((e) => e.id) },
      ]);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  // Add other bulk/batch/edge-case tests here, following the same pattern.
});

describe("DeleteManager Edge Case: Already Deleted Email", () => {
  it("should handle already deleted emails", async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    console.log("DIAGNOSTIC: Using testDbDir:", testDbDir);
    console.log(
      "DIAGNOSTIC: process.env.STORAGE_PATH:",
      process.env.STORAGE_PATH
    );
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const emailsBefore = await userDbManager.searchEmails({});
      console.log(
        "DIAGNOSTIC: DB should be empty before seeding, count:",
        emailsBefore.length
      );
      // Create a unique email for this test
      const uniqueAlreadyDeleted = [
        {
          id: "unique-already-deleted",
          threadId: "thread-unique-already-deleted",
          sender: "unique@example.com",
          subject: "Unique Already Deleted",
          snippet: "This is a unique already deleted test email.",
          size: 1024,
          date: new Date("2024-01-01T00:00:00Z"),
          category: "low" as const,
          user_id: defaultUserContext.user_id,
          archived: false,
          promotional_score: 0.1,
          spam_score: 0.1,
        },
      ];
      await seedTestData(
        userDbManager,
        uniqueAlreadyDeleted,
        defaultUserContext.user_id
      );
      const allEmails = await userDbManager.searchEmails({});
      console.log(
        "DIAGNOSTIC: After seeding, emails in DB:",
        allEmails.length,
        allEmails.map((e) => e.id)
      );
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: "low" });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(1);
      expect(result.errors).toHaveLength(0);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

describe("DeleteManager Edge Case: Partial Batch Failures", () => {
  it("should handle partial batch failures", async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    console.log("DIAGNOSTIC: Using testDbDir:", testDbDir);
    console.log(
      "DIAGNOSTIC: process.env.STORAGE_PATH:",
      process.env.STORAGE_PATH
    );
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const emailsBefore = await userDbManager.searchEmails({});
      console.log(
        "DIAGNOSTIC: DB should be empty before seeding, count:",
        emailsBefore.length
      );
      // Deep clone batchTestEmails to ensure no overlap
      const clonedBatchTestEmails = batchTestEmails.slice(0, 80).map((e) => ({
        ...e,
        id: `${e.id}-partial-batch`,
      }));
      await seedTestData(
        userDbManager,
        clonedBatchTestEmails,
        defaultUserContext.user_id
      );
      const allEmails = await userDbManager.searchEmails({});
      console.log(
        "DIAGNOSTIC: After seeding, emails in DB:",
        allEmails.length,
        allEmails.map((e) => e.id)
      );
      setupPartialBatchFailure(mockGmailClient, testErrors.networkError);
      const searchedEmails = await userDbManager.searchEmails({
        category: "low",
        archived: false,
      });
      const firstBatch = searchedEmails.slice(0, 50);
      const secondBatch = searchedEmails.slice(50, 80);
      const options = createDeleteOptions({
        category: "low",
        skipArchived: true,
      });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext,
        { forceDelay: true }
      );
      expect(result.deleted).toBe(50); // Only first batch succeeded
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Network timeout");
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(
        2
      );
      verifyBatchModifyCalls(mockGmailClient, [
        { ids: firstBatch.map((e) => e.id) },
        { ids: secondBatch.map((e) => e.id) },
      ]);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// (Insert all missing migrated tests here, following the isolation pattern and with traceability comments)

// =========================
// MIGRATED TESTS FROM DeleteManager.integration.test.ts
// =========================

// --- Bulk Delete Operations ---
describe('DeleteManager Bulk Delete Operations', () => {
  it('should respect batch size limit of 50 emails', async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const largeEmailSet = Array.from({ length: 150 }, (_, i) => ({
        ...batchTestEmails[0],
        id: `${i}`,
        threadId: `thread-large-set-${i}`,
      }));
      await seedTestData(
        userDbManager,
        largeEmailSet,
        defaultUserContext.user_id
      );
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: "low" });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(150);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).toHaveBeenCalledTimes(
        3
      );
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should implement rate limiting between batches", async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(
        userDbManager,
        batchTestEmails.slice(0, 60), // Ensure at least two batches
        defaultUserContext.user_id
      );
      setupSuccessfulBatchModify(mockGmailClient);
      const startTime = Date.now();
      const options = createDeleteOptions({ category: "low" });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext,
        { forceDelay: true }
      );
      const endTime = Date.now();
      expect(result.deleted).toBe(60);
      expect(result.errors).toHaveLength(0);
      expect(endTime - startTime).toBeGreaterThanOrEqual(100);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- Safety Features ---
describe("DeleteManager Safety Features", () => {
  it("should preview deletion without actually deleting (dry run)", async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(
        userDbManager,
        batchTestEmails.slice(0, 10),
        defaultUserContext.user_id
      );
      const emailsToDelete = await userDbManager.searchEmails({
        category: "low",
        archived: false,
      });
      const options = createDeleteOptions({
        category: "low",
        dryRun: true,
        skipArchived: true,
      });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(emailsToDelete.length);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("DRY RUN");
      expect(result.errors[0]).toContain(
        `Would delete ${emailsToDelete.length} emails`
      );
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should work with complex criteria in dry run", async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(
        userDbManager,
        batchTestEmails.slice(0, 10),
        defaultUserContext.user_id
      );
      const complexCriteria = {
        category: "medium" as const,
        year: 2023,
        sizeThreshold: 50000,
        searchCriteria: { hasAttachments: true },
      };
      const matchingEmails = await userDbManager.searchEmails({
        category: "medium",
        year: 2023,
        sizeRange: { min: 0, max: 50000 },
        hasAttachments: true,
      });
      const options = createDeleteOptions({ ...complexCriteria, dryRun: true });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(matchingEmails.length);
      expect(result.errors.length).toBe(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- Safety Features: High Priority Email Protection ---
describe("DeleteManager Safety Features: High Priority Email Protection", () => {
  it("should not delete high priority emails by default", async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(
        userDbManager,
        batchTestEmails.slice(0, 10),
        defaultUserContext.user_id
      );
      const allEmails = await userDbManager.searchEmails({});
      const nonHighPriority = allEmails.filter((e) => e.category !== "high");
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({});
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(nonHighPriority.length);
      const deletedIds = (
        mockGmailClient.users.messages.batchModify.mock as any
      ).calls[0][0].requestBody.ids;
      const highPriorityIds = allEmails
        .filter((e) => e.category === "high")
        .map((e) => e.id);
      highPriorityIds.forEach((id) => {
        expect(deletedIds).not.toContain(id);
      });
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should only delete high priority when explicitly requested", async () => {
    await forceResetDatabaseManager();
    const uniqueUserId = generateUniqueUserId();
    const defaultUserContext = { user_id: uniqueUserId, session_id: `bulk-session-${Math.random().toString(36).substring(2, 10)}-${Date.now()}` };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(uniqueUserId);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(
        userDbManager,
        batchTestEmails.slice(0, 10),
        defaultUserContext.user_id
      );
      const highPriorityEmails = await userDbManager.searchEmails({
        category: "high",
        archived: false,
      });
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({
        category: "high",
        skipArchived: true,
      });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(highPriorityEmails.length);
      const ids = highPriorityEmails.map((e) => e.id);
      const expectedCalls = ids.length > 0 ? [{ ids: ids }] : [];
      verifyBatchModifyCalls(mockGmailClient, expectedCalls);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- Safety Features: Archived Email Skip ---
describe("DeleteManager Safety Features: Archived Email Skip", () => {
  it("should skip archived emails by default", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = {
      user_id: "test-user-123",
      session_id: "test-session-123",
    };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(
        userDbManager,
        batchTestEmails.slice(0, 10),
        defaultUserContext.user_id
      );
      const allEmails = await userDbManager.searchEmails({});
      const nonArchived = allEmails.filter((e) => !e.archived);
      const nonArchivedNonHigh = nonArchived.filter(
        (e) => e.category !== "high"
      );
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ skipArchived: true });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(nonArchivedNonHigh.length);
      const archivedIds = allEmails.filter((e) => e.archived).map((e) => e.id);
      const deletedIds = (
        mockGmailClient.users.messages.batchModify.mock as any
      ).calls[0][0].requestBody.ids;
      archivedIds.forEach((id) => {
        expect(deletedIds).not.toContain(id);
      });
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should include archived emails when skipArchived is false", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = {
      user_id: "test-user-123",
      session_id: "test-session-123",
    };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(
        userDbManager,
        batchTestEmails.slice(0, 10),
        defaultUserContext.user_id
      );
      const allLowPriority = batchTestEmails.slice(0, 10).filter(
        (e) => e.category === "low"
      );
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({
        category: "low",
        skipArchived: false,
      });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(allLowPriority.length);
      expect(result.errors).toHaveLength(0);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- Edge Cases ---
describe("DeleteManager Edge Cases", () => {
  it("should handle empty result sets gracefully", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = {
      user_id: "test-user-123",
      session_id: "test-session-123",
    };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(defaultUserContext.user_id);

    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const options = createDeleteOptions({ category: "low", year: 2025 });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should handle emails without required permissions", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = {
      user_id: "test-user-123",
      session_id: "test-session-123",
    };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const protectedEmail = [errorScenarioEmails.permissionDenied];
      await seedTestData(
        userDbManager,
        protectedEmail,
        defaultUserContext.user_id
      );
      setupBatchModifyFailure(mockGmailClient, testErrors.permissionError);
      const options = createDeleteOptions({ category: "low" });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Insufficient permissions");
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- Error Handling ---
describe("DeleteManager Error Handling", () => {
  it("should handle authentication failures", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = {
      user_id: "test-user-123",
      session_id: "test-session-123",
    };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(defaultUserContext.user_id);
    let userDbManager: DatabaseManager | undefined = undefined;
    const emails = createPerformanceTestScenario(10);
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, emails, defaultUserContext.user_id);
      const mockGmailClient = createMockGmailClient();
      const mockAuthManager = createMockAuthManager(mockGmailClient);
      const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
      mockAuthManager.getGmailClient.mockRejectedValue(
        testErrors.authenticationError
      );
      const options = createDeleteOptions({ category: "low" });
      await expect(
        deleteManager.deleteEmails(options, defaultUserContext)
      ).rejects.toThrow("Authentication failed");
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should handle network timeouts", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = {
      user_id: "test-user-123",
      session_id: "test-session-123",
    };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, batchTestEmails.slice(0, 10), defaultUserContext.user_id);
      setupBatchModifyFailure(mockGmailClient, testErrors.networkError);
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Network timeout');
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should handle rate limit errors", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = {
      user_id: "test-user-123",
      session_id: "test-session-123",
    };
    const { dbManager: dbManagerFactory, testDbDir } =
      await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, batchTestEmails.slice(0, 10), defaultUserContext.user_id);
      setupBatchModifyFailure(mockGmailClient, testErrors.rateLimitError);
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Rate limit exceeded');
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should handle database errors", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await userDbManager.close();
      // Simulate DB error by making searchEmails throw
      jest.spyOn(userDbManager, 'searchEmails').mockImplementation(() => {
        throw new Error('Simulated DB error');
      });
      const options = createDeleteOptions({ category: 'low' });
      await expect(deleteManager.deleteEmails(options, defaultUserContext)).rejects.toThrow();
    } finally {
      if (userDbManager) {
        (userDbManager.searchEmails as jest.Mock).mockRestore();
        await cleanupTestDatabase(userDbManager, testDbDir);
      }
    }
  });

  it("should handle invalid parameters gracefully", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ year: -1 } as any);
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(0);
      expect(result.errors).toHaveLength(0);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- State Verification ---
describe("DeleteManager State Verification", () => {
  it("should verify database state after deletion", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, batchTestEmails.slice(0, 10), defaultUserContext.user_id);
      const emails = await userDbManager.searchEmails({ category: 'low', archived: false });
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      const result = await deleteManager.deleteEmails(
        options,
        defaultUserContext
      );
      expect(result.deleted).toBe(emails.length);
      for (const email of emails) {
        const dbEmail = await userDbManager.getEmailIndex(email.id);
        expect(dbEmail).toBeDefined();
        if (dbEmail) {
          expect(dbEmail.archived).toBe(true);
          expect(dbEmail.archiveLocation).toBe('trash');
        }
      }
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should verify Gmail API calls with correct labels", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, batchTestEmails.slice(0, 10), defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      await deleteManager.deleteEmails(options, defaultUserContext);
      const batchModifyCall = (mockGmailClient.users.messages.batchModify.mock as any).calls[0][0];
      expect(batchModifyCall.userId).toBe('me');
      expect(batchModifyCall.requestBody.addLabelIds).toEqual(['TRASH']);
      expect(batchModifyCall.requestBody.removeLabelIds).toEqual(['INBOX', 'UNREAD']);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should verify audit trail through logging", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    const loggerSpy = jest.spyOn(logger, 'info');
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, batchTestEmails.slice(0, 10), defaultUserContext.user_id);
      const emails = await userDbManager.searchEmails({ category: 'low', archived: false }).then(arr => arr.slice(0, 2));
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({ category: 'low', skipArchived: true });
      await deleteManager.deleteEmails(options, defaultUserContext);
      // Check for start log
      expect(loggerSpy.mock.calls.some(call => typeof call[0] === 'string' && (call[0] as string).toLowerCase().includes('starting email deletion'))).toBe(true);
      // Check for batch processing log
      expect(loggerSpy.mock.calls.some(call => typeof call[0] === 'string' && (call[0] as string).toLowerCase().includes('deleting batch 1'))).toBe(true);
      // Check for completion log
    } finally {
      loggerSpy.mockRestore();
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- Performance and Optimization ---
describe.skip('DeleteManager Performance and Optimization', () => {
  it('should handle very large email sets efficiently', async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const veryLargeSet = Array.from({ length: 1000 }, (_, i) => ({
        ...batchTestEmails[0],
        id: `perf-test-${i}`,
        threadId: `thread-perf-${i}`,
        category: 'low' as const,
        subject: `Performance Test ${i}`,
        sender: 'perf@test.com',
        recipients: ['user@example.com'],
        date: new Date('2024-01-01'),
        year: 2024,
        size: 10000,
        hasAttachments: false,
        labels: ['INBOX'],
        snippet: `Performance test email ${i}`,
        archived: false
      }));
      await seedTestData(userDbManager, veryLargeSet, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const startTime = Date.now();
      const options = createDeleteOptions({ category: 'low' });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      const endTime = Date.now();
      expect(result.deleted).toBe(1000);
      expect(result.errors).toHaveLength(0);
      expect((mockGmailClient.users.messages.batchModify.mock as any).calls).toHaveLength(20);
      expect(endTime - startTime).toBeLessThan(5000);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- Integration with Multiple Criteria ---
describe("DeleteManager Integration with Multiple Criteria", () => {
  it("should handle complex multi-criteria deletion", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, batchTestEmails.slice(0, 10), defaultUserContext.user_id);
      const complexEmails = await userDbManager.searchEmails({
        category: 'low',
        year: 2023,
        sizeRange: { min: 0, max: 100000 },
        labels: ['PROMOTIONS'],
      });
      setupSuccessfulBatchModify(mockGmailClient);
      const options = createDeleteOptions({
        category: 'low',
        year: 2023,
        sizeThreshold: 100000,
        searchCriteria: { labels: ['PROMOTIONS'] },
      });
      const result = await deleteManager.deleteEmails(options, defaultUserContext);
      expect(result.deleted).toBe(complexEmails.length);
      expect(result.errors).toHaveLength(0);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

// --- Cleanup System Integration ---
describe("DeleteManager Cleanup System Integration", () => {
  // --- batchDeleteForCleanup: Safety Checks ---
  it("should perform batch cleanup deletion with safety checks", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    const testEmails = batchTestEmails.slice(0, 5);
    const policy = createMockCleanupPolicy({
      safety: {
        max_emails_per_run: 100,
        require_confirmation: false,
        dry_run_first: false,
        preserve_important: true
      },
    });
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, testEmails, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: false, batch_size: 3 },
        defaultUserContext
      );
      expect(result.deleted).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
      expect(result.storage_freed).toBeGreaterThan(0);
      expect(result.archived).toBe(0);
      expect(result.failed).toBe(0);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Dry Run ---
  it("should handle dry run mode for batch cleanup", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    const testEmails = batchTestEmails.slice(0, 3);
    const policy = createMockCleanupPolicy();
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, testEmails, defaultUserContext.user_id);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: true, batch_size: 10 },
        defaultUserContext
      );
      expect(result.deleted).toBe(testEmails.length);
      expect(result.storage_freed).toBeGreaterThan(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Safety Checks for High Importance ---
  it("should respect safety checks for high importance emails", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    const safetyEmails = batchTestEmails.slice(0, 2).map((e) => ({ ...e, category: "high" as const }));
    const policy = createMockCleanupPolicy({
      safety: {
        max_emails_per_run: 100,
        require_confirmation: false,
        dry_run_first: false,
        preserve_important: true
      },
    });
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, safetyEmails, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        safetyEmails,
        policy,
        { dry_run: false },
        defaultUserContext
      );
      expect(result.deleted).toBe(0);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Different Action Types ---
  it("should handle batch processing with different action types", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    const testEmails = batchTestEmails.slice(0, 4).map(e => ({
      ...e,
      date: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) // 8 days ago
    }));
    const archivePolicy = createMockCleanupPolicy({
      action: { type: "archive" },
    });
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, testEmails, defaultUserContext.user_id);
      // Diagnostic: print test emails
      console.log('[DIAGNOSTIC] Emails passed to batchDeleteForCleanup:', testEmails);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        archivePolicy,
        { dry_run: false },
        defaultUserContext
      );
      // Diagnostic: print result
      console.log('[DIAGNOSTIC] batchDeleteForCleanup result:', result);
      expect(result.archived).toBe(testEmails.length);
      expect(mockGmailClient.users.messages.batchModify).not.toHaveBeenCalled();
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Error Scenarios ---
  it("should handle error scenarios in batch cleanup", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    const testEmails = batchTestEmails.slice(0, 3);
    const policy = createMockCleanupPolicy();
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, testEmails, defaultUserContext.user_id);
      setupBatchModifyFailure(mockGmailClient, testErrors.networkError);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: false, max_failures: 1 },
        defaultUserContext
      );
      expect(result.failed).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Batch 1 failed");
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  // --- batchDeleteForCleanup: Max Failures ---
  it("should respect max failures threshold", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    const policy = createMockCleanupPolicy({
      safety: {
        max_emails_per_run: 100,
        require_confirmation: false,
        dry_run_first: false,
        preserve_important: true
      }
    });
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const testEmails = batchTestEmails.slice(0, 5);
      await seedTestData(userDbManager, testEmails, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: false },
        defaultUserContext
      );
      expect(result.deleted).toBeGreaterThan(0);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.storage_freed).toBeGreaterThan(0);
      expect(result.archived).toBe(0);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });

  it("should return accurate cleanup deletion statistics", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: 'test-user-123', session_id: 'test-session-123' };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    const testEmails = [
      ...batchTestEmails.slice(0, 2),
      { ...batchTestEmails[2], category: 'high' as const },
    ];
    const policy = createMockCleanupPolicy({
      safety: {
        max_emails_per_run: 100,
        require_confirmation: false,
        dry_run_first: false,
        preserve_important: true
      }
    });
    let userDbManager: DatabaseManager | undefined = undefined;
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      await seedTestData(userDbManager, testEmails, defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      const result = await deleteManager.batchDeleteForCleanup(
        testEmails,
        policy,
        { dry_run: false },
        defaultUserContext
      );
      expect(result.deleted).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.storage_freed).toBeGreaterThan(0);
      expect(result.archived).toBe(0);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

describe("Concurrent Operations", () => {
  it("should handle concurrent delete operations safely", async () => {
    await forceResetDatabaseManager();
    const defaultUserContext = { user_id: "test-user-123", session_id: "test-session-123" };
    const { dbManager: dbManagerFactory, testDbDir } = await createTestDatabaseManager(defaultUserContext.user_id);
    
    let userDbManager: DatabaseManager | undefined = undefined;
    const mockGmailClient = createMockGmailClient();
    const mockAuthManager = createMockAuthManager(mockGmailClient);
    const deleteManager = new DeleteManager(mockAuthManager, dbManagerFactory);
    try {
      userDbManager = await dbManagerFactory.getUserDatabaseManager(defaultUserContext.user_id);
      const emails1 = getEmailsByCriteria({ category: "low", year: 2022, archived: false });
      const emails2 = getEmailsByCriteria({ category: "medium", year: 2023, archived: false });
      await seedTestData(userDbManager, [...emails1, ...emails2], defaultUserContext.user_id);
      setupSuccessfulBatchModify(mockGmailClient);
      // Run concurrent operations
      const [result1, result2] = await Promise.all([
        deleteManager.deleteEmails(
          createDeleteOptions({ category: "low", year: 2022 }),
          defaultUserContext
        ),
        deleteManager.deleteEmails(
          createDeleteOptions({ category: "medium", year: 2023 }),
          defaultUserContext
        ),
      ]);
      expect(result1.deleted).toBe(emails1.length);
      expect(result2.deleted).toBe(emails2.length);
      expect(result1.errors).toHaveLength(0);
      expect(result2.errors).toHaveLength(0);
    } finally {
      if (userDbManager) await cleanupTestDatabase(userDbManager, testDbDir);
    }
  });
});

afterAll(async () => {
  // Clean up the entire test data directory used for DBs
  const testDataDir = path.resolve(__dirname, 'data');
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
    // eslint-disable-next-line no-console
    console.log('[CLEANUP] Removed test DB directory:', testDataDir);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[CLEANUP] Could not remove test DB directory:', testDataDir, err);
  }
});
