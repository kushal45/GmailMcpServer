import { EmailIndex } from './../../../src/types/index';
import fs from 'fs';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  jest,
} from "@jest/globals";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Ajv from "ajv";
import path from "path";
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { initializeTestEnvironment, type TestEnvironmentConfig } from './test-env-loader.js';
import { performOAuthAuthentication } from './oauth-utils.js';
import { registerUser } from './userRegistration-utils.js';

const ajv = new Ajv();

// Add interfaces for validated responses
type ListEmailsResponse = {
  emails: EmailIndex[];
  total: number;
};

// Jest timeout is now configured dynamically in beforeAll based on test environment

describe("Gmail MCP Server - All MCP Tool Combinations", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let serverProcess: any; // Track the server process for cleanup
  let userContext: { user_id: string; session_id: string } = {
    user_id: "user1",
    session_id: "sess1",
  };
  let jobId: string;
  let policyId: string;
  let testEnv: TestEnvironmentConfig;

  // Track if cleanup has been called to avoid multiple cleanups
  let cleanupCalled = false;

  // Initialize test environment configuration
  beforeAll(async () => {
    try {
      // Load and validate test environment
      testEnv = initializeTestEnvironment();

      // Set Jest timeout from test configuration
      jest.setTimeout(testEnv.test.timeout);

      // Setup test data directories
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const userProfilesPath = path.join(__dirname,testEnv.storage.dataPath, 'users');
      if (fs.existsSync(userProfilesPath)) {
        fs.rmSync(userProfilesPath, { recursive: true });
      }
      const tokenStoragePath = path.join(__dirname,testEnv.storage.dataPath, 'tokens');
      if (fs.existsSync(tokenStoragePath)) {
        fs.rmSync(tokenStoragePath, { recursive: true });
      }

      // Initialize MCP client
      transport = new StdioClientTransport({
        command: "node",
        args: ["--inspect-brk","./build/index.js"], // Removed --inspect-brk to avoid debugger handles
      });
      client = new Client({
        name: "gmail-mcp-server",
        version: "1.0.0",
        title: "Gmail MCP Server",
        description: "A server for the Gmail MCP",
      });
      await client.connect(transport);
      console.info("Client connected to transport");

      // Wait for server to be ready by polling get_system_health
      let ready = false;
      for (let i = 0; i < 10; i++) {
        try {
          await client.callTool({
            name: "get_system_health",
            arguments: {
              user_context: { user_id: "user1", session_id: "sess1" },
            },
          });
          console.info("Server is ready");
          ready = true;
          break;
        } catch (e) {
          await new Promise((res) => setTimeout(res, 500));
        }
      }
      if (!ready) {
        throw new Error("Server did not become ready in time");
      }
    } catch (error) {
      console.error("❌ Error during test setup:", error);
      // Ensure cleanup happens even if setup fails
      await cleanupResources();
      throw error;
    }
  });

  afterAll(async () => {
    await cleanupResources();

    // Additional aggressive cleanup for Jest
    await new Promise(resolve => {
      // Force close any remaining handles after a short delay
      const forceCleanupTimer = setTimeout(() => {
        console.log("🔥 Forcing cleanup of remaining handles...");

        // Kill any remaining child processes
        if (process.platform !== 'win32') {
          try {
            // Kill any node processes that might be hanging around
            require('child_process').execSync('pkill -f "node.*build/index.js" || true', { stdio: 'ignore' });
            console.log("🔪 Killed any remaining MCP server processes");
          } catch (e) {
            // Ignore errors - this is a best-effort cleanup
          }
        }

        resolve(undefined);
      }, 500);

      // Clear the timer if we don't need it
      setTimeout(() => {
        clearTimeout(forceCleanupTimer);
        resolve(undefined);
      }, 100);
    });
  });

  // Helper function for cleanup that can be called from anywhere
  async function cleanupResources() {
    if (cleanupCalled) {
      console.log("🧹 Cleanup already called, skipping...");
      return;
    }
    cleanupCalled = true;

    console.log("🧹 Cleaning up test resources...");

    // Close client connection first (synchronously to avoid timeout handles)
    if (client) {
      try {
        console.log("Closing MCP client...");
        await client.close();
        console.log("✅ MCP client closed");
      } catch (error) {
        console.warn("⚠️ Error closing client:", error.message);
        // Force close if normal close fails
        try {
          (client as any)._transport?.close?.();
        } catch (forceError) {
          console.warn("⚠️ Force close also failed:", forceError.message);
        }
      }
    }

    // Close transport connection (synchronously to avoid timeout handles)
    if (transport) {
      try {
        console.log("Closing transport...");

        // Get reference to the underlying process before closing
        serverProcess = (transport as any)._process || (transport as any).process;

        await transport.close();
        console.log("✅ Transport closed");
      } catch (error) {
        console.warn("⚠️ Error closing transport:", error.message);
        // Force close the underlying process if normal close fails
        try {
          if (serverProcess) {
            serverProcess.kill('SIGTERM');
            console.log("🔪 Forced server process termination via SIGTERM");

            // If SIGTERM doesn't work, try SIGKILL after a short delay
            setTimeout(() => {
              if (!serverProcess.killed) {
                serverProcess.kill('SIGKILL');
                console.log("🔪 Forced server process termination via SIGKILL");
              }
            }, 1000);
          } else {
            // Fallback: try to access process from transport
            const proc = (transport as any)._process || (transport as any).process;
            if (proc) {
              proc.kill('SIGTERM');
              console.log("🔪 Forced transport process termination");
            }
          }
        } catch (forceError) {
          console.warn("⚠️ Force kill also failed:", forceError.message);
        }
      }
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log("🗑️ Garbage collection triggered");
    }

    console.log("✅ Cleanup completed");
  }

  // Setup process exit handlers to ensure cleanup happens
  const setupExitHandlers = () => {
    const exitHandler = (signal: string) => {
      console.log(`\n🚨 Received ${signal}, cleaning up...`);
      cleanupResources().finally(() => {
        console.log(`✅ Cleanup completed for ${signal}`);
        process.exit(0);
      });
    };

    process.on('SIGINT', () => exitHandler('SIGINT'));
    process.on('SIGTERM', () => exitHandler('SIGTERM'));
    process.on('uncaughtException', (error) => {
      console.error('🚨 Uncaught Exception:', error);
      cleanupResources().finally(() => {
        process.exit(1);
      });
    });
    process.on('unhandledRejection', (reason, promise) => {
      console.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
      cleanupResources().finally(() => {
        process.exit(1);
      });
    });
  };

  // Setup exit handlers immediately
  setupExitHandlers();

  



  // --- AUTHENTICATION & USER REGISTRATION ---
  test("should register first user, authenticate, and register second user", async () => {
    /*
     * CORRECT FLOW FOR MULTI-USER REGISTRATION:
     *
     * 1. Register first user (no authentication required - becomes admin automatically)
     * 2. Authenticate the first user via OAuth (gets real user_id and session_id)
     * 3. Use authenticated admin context to register additional users
     *
     * This is required because:
     * - First user registration doesn't require authentication
     * - Subsequent user registrations require an authenticated admin user
     * - The userContext must contain a valid session from OAuth flow
     */

    console.info(`Step 1: Registering primary test user`);
    const registerContent= await registerUser(
     {
      email: testEnv.primaryUser.email,
      displayName: testEnv.primaryUser.displayName,
      client: client,
      isFirstUser: true,
      authenticatedUserContext: userContext
     }
    );
    console.info("Register tool response:", registerContent);
    console.info(`Primary user registered with user_id: ${registerContent.userId}`);


    
    const authenticateSchema = {
      type: "object",
      properties: {
        success: { type: "boolean" },
        user_id: { type: "string", nullable: true },
        session_id: { type: "string", nullable: true },
        authUrl: { type: "string" },
      },
      required: ["success", "authUrl"],
    };
    const validateAuthenticate = ajv.compile(authenticateSchema);
    console.info("Step 2: Authenticating primary user to get valid session");
    const resp = await client.callTool({
      name: "authenticate",
      arguments: {
        email: testEnv.primaryUser.email,
        display_name: testEnv.primaryUser.displayName,
        session_id: "sess1",
      },
    });
    const content = (resp as any).content[0].text;
    const contentObj = JSON.parse(content);
    console.info("Authenticate tool response:", contentObj);
    expect(validateAuthenticate(contentObj)).toBe(true);
    expect(contentObj.success).toBe(true);
    const authUrl = contentObj.authUrl;

    // Get test credentials from environment variables (use same email as registration)
    const testEmail = testEnv.primaryUser.email;
    const testPassword = testEnv.primaryUser.password;
    console.info("Test email:", testEmail);
    const useAppPassword = testEnv.oauth.useAppPassword;

    console.info(`Using ${useAppPassword ? 'App Password' : 'regular password'} authentication for ${testEmail}`);

    // OAuth automation using the new utility function
    console.info("Starting OAuth automation using generic flow handler");

    try {
      // Use the new OAuth utility function
      userContext = await performOAuthAuthentication(authUrl, testEmail, testPassword!, {
        headless: testEnv.oauth.headless,
        timeout: testEnv.oauth.timeout,
        retryAttempts: testEnv.oauth.retryAttempts,
        retryDelay: testEnv.oauth.retryDelay,
        captureScreenshots: testEnv.test.captureScreenshots,
        useAppPassword: useAppPassword
      });

      console.info("✅ Successfully extracted user context:", userContext);

    } catch (error) {
      console.error("OAuth automation failed:", error);

      // Check if we should use a fallback/mock session for testing
      if (process.env.USE_MOCK_OAUTH === 'true') {
        console.warn("🔄 Using mock OAuth session for testing...");
        userContext = {
          user_id: `mock_user_${Date.now()}`,
          session_id: `mock_session_${Date.now()}`
        };
        console.info("Mock user context:", userContext);
      } else {
        console.error("❌ OAuth failed and mock OAuth is not enabled. Consider setting useMockOnFailure=true in test config.");
        throw error;
      }
    }

    // Validate the session by testing it with a simple API call
    console.info("Step 2.5: Validating OAuth session with test API call...");
    try {
      const validationResp = await client.callTool({
        name: "get_user_profile",
        arguments: { user_context: userContext },
      });
      const validationContent = JSON.parse((validationResp as any).content[0].text);
      console.info("✅ Session validation successful:", validationContent);

      // Update userContext with validated user_id if different
      if (validationContent.profile?.userId && validationContent.profile.userId !== userContext.user_id) {
        console.info(`Updating user_id from ${userContext.user_id} to ${validationContent.profile.userId}`);
        userContext.user_id = validationContent.profile.userId;
      }
    } catch (sessionError) {
      console.error("❌ Session validation failed:", sessionError);
      throw new Error(`OAuth session is invalid. Session validation failed: ${sessionError.message}`);
    }

    // Now use userContext for all further tool calls
    expect(userContext.user_id).toBeDefined();
    expect(userContext.session_id).toBeDefined();
    console.info("✅ OAuth authentication and session validation completed successfully");

    console.info(`Step 3: Registering secondary test user using authenticated admin context`);

    // Now register the second user using the authenticated admin user context
    await registerUser(
     {
      email: testEnv.secondaryUser.email,
      displayName: testEnv.secondaryUser.displayName,
      role: 'user',
      client: client,
      isFirstUser: false,
      authenticatedUserContext: userContext
     }
    );
  }, 300000); // 5 minutes timeout for OAuth flow

  // --- MODULAR USER REGISTRATION EXAMPLE ---
  test("should demonstrate modular user registration functions", async () => {
    // This test shows how to use the modular registration functions
    // in other tests without repeating the authentication flow

    console.info("=== Demonstrating Modular Registration Functions ===");

    // Example 1: Register individual users with specific roles
    console.info("Example 1: Registering a regular user");
    // use authenticated user from previous context
    await registerUser(
      {
        email: "regular.user@example.com",
        displayName: "Regular User",
        role: "user",
        client: client,
        isFirstUser: false,
        authenticatedUserContext: userContext
      }
   
    );

    console.info("Example 2: Registering an admin user");
    await registerUser(
      {
        email: "admin.user@example.com",
        displayName: "Admin User",
        client: client,
        isFirstUser: true,
        authenticatedUserContext: userContext
      }
    );

    // Example 3: Using the convenience function for bulk registration
    console.info("Example 3: Using registerTestUsers for quick setup");
    // Note: This would register new test users, but we'll skip it since we already have them
    // const users = await registerTestUsers(userContext);

    console.info("✅ Modular registration functions demonstrated successfully");

    // Verify users were created by listing them
    const listUsersResp = await client.callTool({
      name: "list_users",
      arguments: { user_context: userContext },
    });
    const listUsersContent = JSON.parse((listUsersResp as any).content[0].text);
    console.info("All registered users:", listUsersContent);

    expect(listUsersContent).toHaveProperty('users');
    expect(Array.isArray(listUsersContent.users)).toBe(true);
    expect(listUsersContent.users.length).toBeGreaterThanOrEqual(4); // At least 4 users now
  }, 60000); // 1 minute timeout for user registration tests

  // --- USER MANAGEMENT ---
  test("should list, get profile, and switch user", async () => {
    const listUsersResp = await client.callTool({
      name: "list_users",
      arguments: { user_context: userContext },
    });
    console.info("List users response:", listUsersResp);

    const getUserProfileResp = await client.callTool({
      name: "get_user_profile",
      arguments: { user_context: userContext },
    });
    console.info("List users response:", listUsersResp);
    console.info("Get user profile response:", getUserProfileResp);
    await expect( client.callTool({
      name: "switch_user",
      arguments: { target_user_id: "user1", user_context: userContext },
    })).rejects.toThrow(/User with ID user1 not found/);
  }, 60000);

  // --- EMAIL MANAGEMENT ---
  test("should list, get details, and categorize emails", async () => {
    const listResp = await client.callTool({
      name: "list_emails",
      arguments: { user_context: userContext, limit: 3},
    });
    // Schema validation for list_emails response
    const listEmailsSchema = {
      type: "object",
      properties: {
        emails: { type: "array", items: { type: "object" } },
        total: { type: "number" },
      },
      required: ["emails", "total"],
    };
    const validateListEmails = ajv.compile(listEmailsSchema);
    const listEmailsContent = JSON.parse((listResp as any).content[0].text);
    expect(validateListEmails(listEmailsContent)).toBe(true);
    const emailsResp = listEmailsContent as ListEmailsResponse;
    console.info("Emails response:", listEmailsContent);
    expect(emailsResp.total).toBeGreaterThan(0);
    expect(emailsResp.emails.length).toBeGreaterThan(0);
    expect(emailsResp.emails[0].id).toBeDefined();
    expect(emailsResp.emails[0].subject).toBeDefined();
    expect(emailsResp.emails[0].sender).toBeDefined();
    expect(emailsResp.emails[0].date).toBeDefined();
    expect(emailsResp.emails[0].size).toBeDefined();
    expect(emailsResp.emails[0].labels).toBeDefined();
    expect(emailsResp.emails[0].hasAttachments).toBeDefined();
    expect(emailsResp.emails[0].archived).toBeDefined();
    expect(emailsResp.emails[0].category).toBeDefined();
    expect(emailsResp.emails[0].user_id).toBeDefined();
    expect(emailsResp.emails[0].user_id).toBe(userContext.user_id);
    expect(emailsResp.emails[0].totalEmailCount).toBeDefined();
    
    
    if (emailsResp.emails.length > 0) {
      const emailRespDetails= await client.callTool({
        name: "get_email_details",
        arguments: { id: emailsResp.emails[0].id, user_context: userContext },
      });
      const emailDetailsContent = JSON.parse((emailRespDetails as any).content[0].text);
      console.info("Email details response:", emailDetailsContent);
      expect(emailDetailsContent.id).toBe(emailsResp.emails[0].id);
    }
    const categorizeResp=await client.callTool({
      name: "categorize_emails",
      arguments: { year: 2024, force_refresh: true, user_context: userContext },
    });
    const categorizeContent = JSON.parse((categorizeResp as any).content[0].text);
    console.info("Categorize emails response:", categorizeContent);
    expect(categorizeContent).toHaveProperty('jobId');
    // sleep for some time
    await new Promise(resolve => setTimeout(resolve, 1000));
    const getJobStatusResp = await client.callTool({
      name: "get_job_status",
      arguments: { id: categorizeContent.jobId, user_context: userContext },
    });
    const getJobStatusContent = JSON.parse((getJobStatusResp as any).content[0].text);
    console.info("Get job status response:", getJobStatusContent);
    expect(getJobStatusContent).toHaveProperty('status');
    // check status to be in IN_PROGRESS or COMPLETED
    expect(['IN_PROGRESS', 'COMPLETED']).toContain(getJobStatusContent.status);
  });

  // --- SEARCH SCENARIOS ---
  test("should perform basic email search", async () => {
    const searchResp = await client.callTool({
      name: "search_emails",
      arguments: {
        query: "important",
        limit: 10,
        user_context: userContext
      },
    });
    const searchContent = JSON.parse((searchResp as any).content[0].text);
    console.info("Search response:", searchContent);
    expect(searchContent).toHaveProperty('emails');
    expect(Array.isArray(searchContent.emails)).toBe(true);
  });

  xtest("should search with advanced filters", async () => {
    const searchResp = await client.callTool({
      name: "search_emails",
      arguments: {
        query: "meeting",
        category: "high",
        has_attachments: true,
        year_range: { start: 2023, end: 2024 },
        size_range: { min: 1000, max: 1000000 },
        sender: "test@example.com",
        limit: 25,
        user_context: userContext
      },
    });
    const searchContent = JSON.parse((searchResp as any).content[0].text);
    console.info("Advanced search response:", searchContent);
    expect(searchContent).toHaveProperty('emails');
  });

  xtest("should save and retrieve saved searches", async () => {
    // Save a search
    const saveResp = await client.callTool({
      name: "save_search",
      arguments: {
        name: "Important Meetings",
        criteria: {
          query: "meeting",
          category: "high",
          has_attachments: true
        },
        user_context: userContext,
      },
    });
    const saveContent = JSON.parse((saveResp as any).content[0].text);
    console.info("Save search response:", saveContent);
    expect(saveContent.success).toBe(true);

    // List saved searches
    const listResp = await client.callTool({
      name: "list_saved_searches",
      arguments: { user_context: userContext },
    });
    const listContent = JSON.parse((listResp as any).content[0].text);
    console.info("List saved searches response:", listContent);
    expect(listContent).toHaveProperty('searches');
    expect(Array.isArray(listContent.searches)).toBe(true);
  });

  xtest("should search by different categories", async () => {
    const categories = ['high', 'medium', 'low'];

    for (const category of categories) {
      const searchResp = await client.callTool({
        name: "search_emails",
        arguments: {
          category: category,
          limit: 5,
          user_context: userContext
        },
      });
      const searchContent = JSON.parse((searchResp as any).content[0].text);
      console.info(`Search by category ${category}:`, searchContent);
      expect(searchContent).toHaveProperty('emails');
    }
  });

  // --- ARCHIVE SCENARIOS ---
  xtest("should archive emails with different methods", async () => {
    // Test Gmail archive method
    const archiveResp = await client.callTool({
      name: "archive_emails",
      arguments: {
        method: "gmail",
        category: "low",
        older_than_days: 365,
        dry_run: true,
        user_context: userContext
      },
    });
    const archiveContent = JSON.parse((archiveResp as any).content[0].text);
    console.info("Archive emails response:", archiveContent);
    expect(archiveContent).toHaveProperty('success');
  });

  xtest("should create and manage archive rules", async () => {
    // Create archive rule
    const createRuleResp = await client.callTool({
      name: "create_archive_rule",
      arguments: {
        name: "Auto-archive Low Priority",
        criteria: {
          category: "low",
          older_than_days: 90,
          size_greater_than: 5000000 // 5MB
        },
        action: {
          method: "gmail",
          export_format: "mbox"
        },
        schedule: "weekly",
        user_context: userContext,
      },
    });
    const createRuleContent = JSON.parse((createRuleResp as any).content[0].text);
    console.info("Create archive rule response:", createRuleContent);
    expect(createRuleContent.success).toBe(true);

    // List archive rules
    const listRulesResp = await client.callTool({
      name: "list_archive_rules",
      arguments: { user_context: userContext },
    });
    const listRulesContent = JSON.parse((listRulesResp as any).content[0].text);
    console.info("List archive rules response:", listRulesContent);
    expect(listRulesContent).toHaveProperty('rules');
    expect(Array.isArray(listRulesContent.rules)).toBe(true);
  });

  xtest("should export emails in different formats", async () => {
    const formats = ['json', 'mbox', 'csv'];

    for (const format of formats) {
      const exportResp = await client.callTool({
        name: "export_emails",
        arguments: {
          format: format,
          search_criteria: { category: "medium" },
          include_attachments: false,
          user_context: userContext
        },
      });
      const exportContent = JSON.parse((exportResp as any).content[0].text);
      console.info(`Export emails in ${format} format:`, exportContent);
      expect(exportContent).toHaveProperty('success');
    }
  });

  xtest("should handle archive with export method", async () => {
    const archiveExportResp = await client.callTool({
      name: "archive_emails",
      arguments: {
        method: "export",
        export_format: "json",
        export_path: "/tmp/test_archive.json",
        search_criteria: {
          category: "low",
          year: 2023
        },
        dry_run: true,
        user_context: userContext
      },
    });
    const archiveExportContent = JSON.parse((archiveExportResp as any).content[0].text);
    console.info("Archive with export response:", archiveExportContent);
    expect(archiveExportContent).toHaveProperty('success');
  });

  // --- DELETE & CLEANUP SCENARIOS ---
  xtest("should perform safe delete operations", async () => {
    // Test delete with dry run
    const deleteResp = await client.callTool({
      name: "delete_emails",
      arguments: {
        category: "low",
        year: 2022,
        size_threshold: 10000000, // 10MB
        skip_archived: true,
        dry_run: true,
        max_count: 5,
        user_context: userContext
      },
    });
    const deleteContent = JSON.parse((deleteResp as any).content[0].text);
    console.info("Delete emails (dry run) response:", deleteContent);
    expect(deleteContent).toHaveProperty('success');
    expect(deleteContent.dry_run).toBe(true);

    // Test empty trash with dry run
    const emptyTrashResp = await client.callTool({
      name: "empty_trash",
      arguments: {
        dry_run: true,
        max_count: 10,
        user_context: userContext
      },
    });
    const emptyTrashContent = JSON.parse((emptyTrashResp as any).content[0].text);
    console.info("Empty trash (dry run) response:", emptyTrashContent);
    expect(emptyTrashContent).toHaveProperty('success');
  });

  xtest("should create and manage cleanup policies", async () => {
    // Create a comprehensive cleanup policy
    const createPolicyResp = await client.callTool({
      name: "create_cleanup_policy",
      arguments: {
        name: "Comprehensive Cleanup Policy",
        enabled: true,
        priority: 75,
        criteria: {
          category: "low",
          older_than_days: 180,
          size_greater_than: 5000000,
          has_attachments: false
        },
        action: {
          type: "delete",
          confirm_before_delete: true
        },
        safety: {
          max_emails_per_run: 50,
          require_confirmation: true,
          backup_before_delete: true
        },
        schedule: {
          frequency: "weekly",
          day_of_week: "sunday",
          hour: 2
        },
        user_context: userContext,
      },
    });
    const createPolicyContent = JSON.parse((createPolicyResp as any).content[0].text);
    console.info("Create cleanup policy response:", createPolicyContent);
    expect(createPolicyContent.success).toBe(true);
    policyId = createPolicyContent.policy_id || "test-policy-id";

    // List cleanup policies
    const listPoliciesResp = await client.callTool({
      name: "list_cleanup_policies",
      arguments: { user_context: userContext },
    });
    const listPoliciesContent = JSON.parse((listPoliciesResp as any).content[0].text);
    console.info("List cleanup policies response:", listPoliciesContent);
    expect(listPoliciesContent).toHaveProperty('policies');
    expect(Array.isArray(listPoliciesContent.policies)).toBe(true);

    // Update cleanup policy
    const updatePolicyResp = await client.callTool({
      name: "update_cleanup_policy",
      arguments: {
        policy_id: policyId,
        updates: {
          enabled: false,
          priority: 25,
          name: "Updated Cleanup Policy"
        },
        user_context: userContext,
      },
    });
    const updatePolicyContent = JSON.parse((updatePolicyResp as any).content[0].text);
    console.info("Update cleanup policy response:", updatePolicyContent);
    expect(updatePolicyContent.success).toBe(true);
  });

  xtest("should trigger and monitor cleanup operations", async () => {
    // Get system health before cleanup
    const healthResp = await client.callTool({
      name: "get_system_health",
      arguments: { user_context: userContext },
    });
    const healthContent = JSON.parse((healthResp as any).content[0].text);
    console.info("System health response:", healthContent);
    expect(healthContent).toHaveProperty('status');

    // Trigger cleanup (if policy exists)
    if (policyId) {
      const triggerResp = await client.callTool({
        name: "trigger_cleanup",
        arguments: { policy_id: policyId, user_context: userContext },
      });
      const triggerContent = JSON.parse((triggerResp as any).content[0].text);
      console.info("Trigger cleanup response:", triggerContent);
      expect(triggerContent).toHaveProperty('success');
    }

    // Get cleanup status
    const statusResp = await client.callTool({
      name: "get_cleanup_status",
      arguments: { user_context: userContext },
    });
    const statusContent = JSON.parse((statusResp as any).content[0].text);
    console.info("Cleanup status response:", statusContent);
    expect(statusContent).toHaveProperty('status');

    // Get cleanup metrics
    const metricsResp = await client.callTool({
      name: "get_cleanup_metrics",
      arguments: { hours: 24, user_context: userContext },
    });
    const metricsContent = JSON.parse((metricsResp as any).content[0].text);
    console.info("Cleanup metrics response:", metricsContent);
    expect(metricsContent).toHaveProperty('metrics');

    // Get cleanup recommendations
    const recommendationsResp = await client.callTool({
      name: "get_cleanup_recommendations",
      arguments: { user_context: userContext },
    });
    const recommendationsContent = JSON.parse((recommendationsResp as any).content[0].text);
    console.info("Cleanup recommendations response:", recommendationsContent);
    expect(recommendationsContent).toHaveProperty('recommendations');
  });

  // --- JOB MANAGEMENT SCENARIOS ---
  xtest("should manage jobs effectively", async () => {
    // List jobs with different filters
    const listJobsResp = await client.callTool({
      name: "list_jobs",
      arguments: {
        limit: 20,
        offset: 0,
        status: "completed",
        user_context: userContext
      },
    });
    const listJobsContent = JSON.parse((listJobsResp as any).content[0].text);
    console.info("List jobs response:", listJobsContent);
    expect(listJobsContent).toHaveProperty('jobs');
    expect(Array.isArray(listJobsContent.jobs)).toBe(true);

    // If jobs exist, test job status retrieval
    if (listJobsContent.jobs && listJobsContent.jobs.length > 0) {
      jobId = listJobsContent.jobs[0].id;

      const jobStatusResp = await client.callTool({
        name: "get_job_status",
        arguments: { id: jobId, user_context: userContext },
      });
      const jobStatusContent = JSON.parse((jobStatusResp as any).content[0].text);
      console.info("Job status response:", jobStatusContent);
      expect(jobStatusContent).toHaveProperty('status');
      expect(jobStatusContent).toHaveProperty('id');
      expect(jobStatusContent.id).toBe(jobId);
    }
  });

  // --- COMPREHENSIVE WORKFLOW SCENARIOS ---
  xtest("should execute a complete email management workflow", async () => {
    // 1. Search for emails to categorize
    const searchResp = await client.callTool({
      name: "search_emails",
      arguments: {
        query: "newsletter OR promotion",
        limit: 10,
        user_context: userContext
      },
    });
    const searchContent = JSON.parse((searchResp as any).content[0].text);
    console.info("Workflow search response:", searchContent);

    // 2. Get detailed information about first email if available
    if (searchContent.emails && searchContent.emails.length > 0) {
      const emailId = searchContent.emails[0].id;
      const detailsResp = await client.callTool({
        name: "get_email_details",
        arguments: { id: emailId, user_context: userContext },
      });
      const detailsContent = JSON.parse((detailsResp as any).content[0].text);
      console.info("Email details response:", detailsContent);
      expect(detailsContent).toHaveProperty('email');
    }

    // 3. Create a saved search for future use
    const saveSearchResp = await client.callTool({
      name: "save_search",
      arguments: {
        name: "Marketing Emails",
        criteria: {
          query: "newsletter OR promotion",
          category: "low"
        },
        user_context: userContext,
      },
    });
    const saveSearchContent = JSON.parse((saveSearchResp as any).content[0].text);
    console.info("Save search in workflow:", saveSearchContent);

    // 4. Create an archive rule for these types of emails
    const archiveRuleResp = await client.callTool({
      name: "create_archive_rule",
      arguments: {
        name: "Auto-archive Marketing",
        criteria: {
          category: "low",
          older_than_days: 30
        },
        action: { method: "gmail" },
        schedule: "monthly",
        user_context: userContext,
      },
    });
    const archiveRuleContent = JSON.parse((archiveRuleResp as any).content[0].text);
    console.info("Archive rule creation in workflow:", archiveRuleContent);
  });

  // --- ERROR HANDLING SCENARIOS ---
  xtest("should handle invalid tool calls gracefully", async () => {
    // Test nonexistent tool
    try {
      await client.callTool({ name: "nonexistent_tool", arguments: {} });
    } catch (err: any) {
      expect(err).toHaveProperty("code");
      console.info("Expected error for nonexistent tool:", err.message);
    }

    // Test missing required parameters
    try {
      await client.callTool({ name: "list_emails", arguments: {} }); // missing user_context
    } catch (err: any) {
      expect(err).toHaveProperty("code");
      console.info("Expected error for missing user_context:", err.message);
    }

    // Test invalid user context
    try {
      await client.callTool({
        name: "list_emails",
        arguments: {
          user_context: { user_id: "invalid", session_id: "invalid" }
        }
      });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err).toHaveProperty("code");
      console.info("Expected error for invalid user context:", err.message);
    }
  });

  // --- PARAMETER VALIDATION SCENARIOS ---
  xtest("should validate different parameter combinations", async () => {
    // Test list_emails with various parameter combinations
    const paramCombinations = [
      { category: "high", limit: 5 },
      { year: 2024, archived: false },
      { has_attachments: true, size_min: 1000 },
      { category: "medium", year: 2023, limit: 10 },
      { archived: true, size_max: 5000000 }
    ];

    for (const params of paramCombinations) {
      const listResp = await client.callTool({
        name: "list_emails",
        arguments: { ...params, user_context: userContext },
      });
      const listContent = JSON.parse((listResp as any).content[0].text);
      console.info(`List emails with params ${JSON.stringify(params)}:`, listContent);
      expect(listContent).toHaveProperty('emails');
      expect(listContent).toHaveProperty('total');
    }
  });

  // --- ADVANCED INTEGRATION SCENARIOS ---
  xtest("should handle complex search and archive workflow", async () => {
    // Complex search with multiple filters
    const complexSearchResp = await client.callTool({
      name: "search_emails",
      arguments: {
        query: "meeting OR conference OR webinar",
        category: "medium",
        year_range: { start: 2023, end: 2024 },
        size_range: { min: 5000, max: 2000000 },
        has_attachments: true,
        archived: false,
        limit: 15,
        user_context: userContext
      },
    });
    const complexSearchContent = JSON.parse((complexSearchResp as any).content[0].text);
    console.info("Complex search response:", complexSearchContent);
    expect(complexSearchContent).toHaveProperty('emails');

    // Archive based on search results
    if (complexSearchContent.emails && complexSearchContent.emails.length > 0) {
      const archiveComplexResp = await client.callTool({
        name: "archive_emails",
        arguments: {
          method: "export",
          export_format: "json",
          search_criteria: {
            query: "meeting OR conference OR webinar",
            category: "medium"
          },
          dry_run: true,
          user_context: userContext
        },
      });
      const archiveComplexContent = JSON.parse((archiveComplexResp as any).content[0].text);
      console.info("Complex archive response:", archiveComplexContent);
      expect(archiveComplexContent).toHaveProperty('success');
    }
  });

  xtest("should test system monitoring and cleanup automation", async () => {
    // Create cleanup schedule
    const scheduleResp = await client.callTool({
      name: "create_cleanup_schedule",
      arguments: {
        name: "Daily Maintenance",
        type: "daily",
        expression: "0 2 * * *", // 2 AM daily
        policy_id: policyId || "default-policy",
        enabled: true,
        user_context: userContext,
      },
    });
    const scheduleContent = JSON.parse((scheduleResp as any).content[0].text);
    console.info("Create cleanup schedule response:", scheduleContent);
    expect(scheduleContent).toHaveProperty('success');

    // Update automation config
    const automationConfigResp = await client.callTool({
      name: "update_cleanup_automation_config",
      arguments: {
        config: {
          enabled: true,
          max_concurrent_jobs: 3,
          retry_failed_jobs: true,
          notification_settings: {
            email_on_completion: true,
            email_on_failure: true
          }
        },
        user_context: userContext
      },
    });
    const automationConfigContent = JSON.parse((automationConfigResp as any).content[0].text);
    console.info("Update automation config response:", automationConfigContent);
    expect(automationConfigContent).toHaveProperty('success');

    // Get comprehensive system health
    const systemHealthResp = await client.callTool({
      name: "get_system_health",
      arguments: { user_context: userContext },
    });
    const systemHealthContent = JSON.parse((systemHealthResp as any).content[0].text);
    console.info("System health response:", systemHealthContent);
    expect(systemHealthContent).toHaveProperty('status');
    expect(['healthy', 'warning', 'critical']).toContain(systemHealthContent.status);
  });

  // --- MULTI-USER SCENARIOS ---
  xtest("should handle multi-user operations", async () => {
    // Test user profile operations
    const profileResp = await client.callTool({
      name: "get_user_profile",
      arguments: { user_context: userContext },
    });
    const profileContent = JSON.parse((profileResp as any).content[0].text);
    console.info("User profile response:", profileContent);
    expect(profileContent).toHaveProperty('profile');

    // List all users (admin operation)
    const listUsersResp = await client.callTool({
      name: "list_users",
      arguments: {
        active_only: true,
        user_context: userContext
      },
    });
    const listUsersContent = JSON.parse((listUsersResp as any).content[0].text);
    console.info("List users response:", listUsersContent);
    expect(listUsersContent).toHaveProperty('users');
    expect(Array.isArray(listUsersContent.users)).toBe(true);
  });

  // --- PERFORMANCE AND EDGE CASE SCENARIOS ---
  xtest("should handle edge cases and boundary conditions", async () => {
    // Test with maximum limits
    const maxLimitResp = await client.callTool({
      name: "list_emails",
      arguments: {
        limit: 500, // Maximum allowed
        offset: 0,
        user_context: userContext
      },
    });
    const maxLimitContent = JSON.parse((maxLimitResp as any).content[0].text);
    console.info("Max limit response:", maxLimitContent);
    expect(maxLimitContent).toHaveProperty('emails');

    // Test with zero results expected
    const zeroResultsResp = await client.callTool({
      name: "search_emails",
      arguments: {
        query: "xyzabc123nonexistentquery456",
        user_context: userContext
      },
    });
    const zeroResultsContent = JSON.parse((zeroResultsResp as any).content[0].text);
    console.info("Zero results search response:", zeroResultsContent);
    expect(zeroResultsContent).toHaveProperty('emails');
    expect(zeroResultsContent.emails).toHaveLength(0);

    // Test with very specific date ranges
    const specificDateResp = await client.callTool({
      name: "search_emails",
      arguments: {
        year_range: { start: 2024, end: 2024 },
        category: "high",
        limit: 5,
        user_context: userContext
      },
    });
    const specificDateContent = JSON.parse((specificDateResp as any).content[0].text);
    console.info("Specific date range response:", specificDateContent);
    expect(specificDateContent).toHaveProperty('emails');
  });

  // --- COMPREHENSIVE TOOL COMBINATION SCENARIOS ---
  xtest("should execute comprehensive tool combinations", async () => {
    // Scenario 1: Email Discovery and Management Pipeline
    console.info("=== Starting Email Discovery Pipeline ===");

    // Step 1: Get system health before operations
    const initialHealthResp = await client.callTool({
      name: "get_system_health",
      arguments: { user_context: userContext },
    });
    const initialHealthContent = JSON.parse((initialHealthResp as any).content[0].text);
    console.info("Initial system health:", initialHealthContent);

    // Step 2: Search for different categories of emails
    const categories = ['high', 'medium', 'low'];
    const searchResults: Array<{ category: string; results: any }> = [];

    for (const category of categories) {
      const categorySearchResp = await client.callTool({
        name: "search_emails",
        arguments: {
          category: category,
          limit: 10,
          user_context: userContext
        },
      });
      const categorySearchContent = JSON.parse((categorySearchResp as any).content[0].text);
      searchResults.push({ category, results: categorySearchContent });
      console.info(`Search results for ${category} priority:`, categorySearchContent);
    }

    // Step 3: Create targeted cleanup policies based on search results
    for (const result of searchResults) {
      if (result.results.emails && result.results.emails.length > 0) {
        const policyName = `Auto-cleanup ${result.category} priority emails`;
        const createPolicyResp = await client.callTool({
          name: "create_cleanup_policy",
          arguments: {
            name: policyName,
            enabled: false, // Keep disabled for testing
            priority: result.category === 'low' ? 80 : result.category === 'medium' ? 50 : 20,
            criteria: {
              category: result.category,
              older_than_days: result.category === 'low' ? 30 : result.category === 'medium' ? 90 : 365
            },
            action: {
              type: result.category === 'low' ? 'delete' : 'archive',
              method: 'gmail'
            },
            safety: {
              max_emails_per_run: 25,
              require_confirmation: true
            },
            user_context: userContext,
          },
        });
        const createPolicyContent = JSON.parse((createPolicyResp as any).content[0].text);
        console.info(`Created policy for ${result.category}:`, createPolicyContent);
      }
    }

    // Step 4: List all created policies
    const listPoliciesResp = await client.callTool({
      name: "list_cleanup_policies",
      arguments: { user_context: userContext },
    });
    const listPoliciesContent = JSON.parse((listPoliciesResp as any).content[0].text);
    console.info("All cleanup policies:", listPoliciesContent);

    // Step 5: Get cleanup recommendations
    const recommendationsResp = await client.callTool({
      name: "get_cleanup_recommendations",
      arguments: { user_context: userContext },
    });
    const recommendationsContent = JSON.parse((recommendationsResp as any).content[0].text);
    console.info("Cleanup recommendations:", recommendationsContent);

    // Step 6: Final system health check
    const finalHealthResp = await client.callTool({
      name: "get_system_health",
      arguments: { user_context: userContext },
    });
    const finalHealthContent = JSON.parse((finalHealthResp as any).content[0].text);
    console.info("Final system health:", finalHealthContent);

    console.info("=== Email Discovery Pipeline Complete ===");

    // Verify all operations completed successfully
    expect(searchResults).toHaveLength(3);
    expect(listPoliciesContent).toHaveProperty('policies');
    expect(recommendationsContent).toHaveProperty('recommendations');
    expect(finalHealthContent).toHaveProperty('status');
  });

  // --- CLEANUP AND TEARDOWN ---
  xtest("should clean up test artifacts and verify system state", async () => {
    console.info("=== Starting Cleanup Phase ===");

    // Get all cleanup policies to clean up
    const listPoliciesResp = await client.callTool({
      name: "list_cleanup_policies",
      arguments: { user_context: userContext },
    });
    const listPoliciesContent = JSON.parse((listPoliciesResp as any).content[0].text);
    console.info("Policies to clean up:", listPoliciesContent);

    // Delete test policies (if any exist)
    if (listPoliciesContent.policies && Array.isArray(listPoliciesContent.policies)) {
      for (const policy of listPoliciesContent.policies) {
        if (policy.name && policy.name.includes('test') || policy.name.includes('Test') || policy.name.includes('Auto-cleanup')) {
          try {
            const deletePolicyResp = await client.callTool({
              name: "delete_cleanup_policy",
              arguments: { policy_id: policy.id, user_context: userContext },
            });
            const deletePolicyContent = JSON.parse((deletePolicyResp as any).content[0].text);
            console.info(`Deleted policy ${policy.name}:`, deletePolicyContent);
          } catch (error) {
            console.info(`Failed to delete policy ${policy.name}:`, error);
          }
        }
      }
    }

    // Final comprehensive system health check
    const finalSystemHealthResp = await client.callTool({
      name: "get_system_health",
      arguments: { user_context: userContext },
    });
    const finalSystemHealthContent = JSON.parse((finalSystemHealthResp as any).content[0].text);
    console.info("Final comprehensive system health:", finalSystemHealthContent);
    expect(finalSystemHealthContent).toHaveProperty('status');

    // Get final cleanup metrics
    const finalMetricsResp = await client.callTool({
      name: "get_cleanup_metrics",
      arguments: { hours: 1, user_context: userContext },
    });
    const finalMetricsContent = JSON.parse((finalMetricsResp as any).content[0].text);
    console.info("Final cleanup metrics:", finalMetricsContent);
    expect(finalMetricsContent).toHaveProperty('metrics');

    console.info("=== Cleanup Phase Complete ===");
  });
});
